import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findWorksRoot } from "../workflow/features.js";

export const USER_KABAN_DIR = resolve(homedir(), ".kf");

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dir;
}

export const PKG_ROOT = findPackageRoot();
export const PKG_TEMPLATES_DIR = join(PKG_ROOT, "kanban-flow", "templates");
export const PKG_RULES_DIR = join(PKG_ROOT, "kanban-flow", "review", "rules");

export interface TemplateSource {
  name: string;
  path: string;
  source: "project" | "user" | "package";
}

/**
 * Find a kanban-flow config dir relative to project root (project overrides).
 * Project layout: {project}/.kf/{templates|hooks|review/rules}
 */
function projectKabanDir(cwd: string): string {
  return join(findWorksRoot(cwd) ?? cwd, ".kf");
}

/** Resolve one template file. Precedence: project → user → package. */
export function resolveTemplate(
  cwd: string,
  template: string,
): TemplateSource | null {
  const candidates: Array<[TemplateSource["source"], string]> = [
    ["project", join(projectKabanDir(cwd), "templates", template)],
    ["user", join(USER_KABAN_DIR, "templates", template)],
    ["package", join(PKG_TEMPLATES_DIR, template)],
  ];
  for (const [source, path] of candidates) {
    if (existsSync(path)) return { name: template, path, source };
  }
  return null;
}

/** Resolve a review rule file. Precedence: project → user → package. */
export function resolveRule(
  cwd: string,
  rule: string,
): TemplateSource | null {
  const candidates: Array<[TemplateSource["source"], string]> = [
    ["project", join(projectKabanDir(cwd), "review", "rules", rule)],
    ["user", join(USER_KABAN_DIR, "review", "rules", rule)],
    ["package", join(PKG_RULES_DIR, rule)],
  ];
  for (const [source, path] of candidates) {
    if (existsSync(path)) return { name: rule, path, source };
  }
  return null;
}

/** Read a template's raw text (for `kf instruct`). */
export async function readTemplate(cwd: string, template: string): Promise<string | null> {
  const resolved = resolveTemplate(cwd, template);
  if (!resolved) return null;
  return (await import("node:fs/promises")).readFile(resolved.path, "utf8");
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await ensureDir(dirname(file));
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: existsSync(file) ? statSync(file).mode & 0o777 : 0o600 });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}
