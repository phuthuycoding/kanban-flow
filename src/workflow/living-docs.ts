import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { readMarkdownSection } from "../shared/frontmatter.js";
import { git, originDefaultRef, runGit } from "../shared/git.js";

/** The level-2 sections every living doc carries, in template order (FR-003). */
export const LIVING_DOC_HEADINGS = [
  "## Purpose",
  "## Current behaviour",
  "## Use cases",
  "## Surfaces",
  "## History",
] as const;

export interface DocsFinding {
  severity: "ERROR" | "WARNING";
  code: string;
  file: string;
  message: string;
}

export type DocsBase = { ref: string; mergeBase: string } | { skipped: string };

const SPECS_DIR = "docs/specs";
const INDEX_FILE = "README.md";
const LEGACY_ROOTS = ["docs/requirement", "docs/use-cases", "docs/testplan"] as const;
/** Same rule as `assertPathName`: contexts and feature names. */
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const RESULT_SUFFIX = "-result";

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();
const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();
const splitZ = (out: string): string[] => out.split("\0").filter(Boolean);

function listEntries(path: string) {
  return isDir(path) ? readdirSync(path, { withFileTypes: true }) : [];
}

function subdirs(path: string): string[] {
  return listEntries(path).filter((e) => e.isDirectory()).map((e) => e.name);
}

function assertRefArg(ref: string, label: string): void {
  if (!ref || ref.startsWith("-")) throw new Error(`Refusing unsafe ${label}: ${JSON.stringify(ref)}`);
}

/** The repository paths of one legacy feature under the FR-013 layout. */
function legacyPaths(context: string, feature: string): string[] {
  return [
    `docs/requirement/${context}/${feature}.md`,
    `docs/use-cases/${context}/${feature}`,
    `docs/testplan/${context}/${feature}.md`,
    `docs/testplan/${context}/${feature}${RESULT_SUFFIX}.md`,
  ];
}

/** `{context, feature}` of a repository path inside the legacy layout, or null for any other shape. */
function legacyFeatureOf(path: string): { context: string; feature: string } | null {
  const parts = path.split("/");
  if (parts.length < 4 || parts[0] !== "docs" || !NAME.test(parts[2])) return null;
  const [, root, context] = parts;
  let feature: string | null = null;
  if (root === "requirement" && parts.length === 4 && parts[3].endsWith(".md")) {
    feature = parts[3].slice(0, -3);
  } else if (root === "use-cases" && parts.length >= 5) {
    feature = parts[3];
  } else if (root === "testplan" && parts.length === 4 && parts[3].endsWith(".md")) {
    const stem = parts[3].slice(0, -3);
    feature = stem.endsWith(RESULT_SUFFIX) ? stem.slice(0, -RESULT_SUFFIX.length) : stem;
  }
  return feature !== null && NAME.test(feature) ? { context, feature } : null;
}

/**
 * Legacy features on disk per context (FR-013 layout, FR-016). `contexts` are the declared
 * contexts; without them every folder whose name follows the context naming rule is scanned.
 * Contexts with no legacy feature are left out.
 */
export function scanLegacyFeatures(root: string, contexts?: string[]): Record<string, string[]> {
  const scanned = contexts ?? [...new Set(LEGACY_ROOTS.flatMap((dir) => subdirs(join(root, dir))))].filter((c) => NAME.test(c));
  const found: Record<string, string[]> = {};
  for (const context of scanned) {
    const features = new Set<string>();
    for (const e of listEntries(join(root, "docs/use-cases", context))) {
      if (e.isDirectory() && NAME.test(e.name)) features.add(e.name);
    }
    for (const kind of ["requirement", "testplan"]) {
      for (const e of listEntries(join(root, "docs", kind, context))) {
        const hit = e.isFile() ? legacyFeatureOf(`docs/${kind}/${context}/${e.name}`) : null;
        if (hit) features.add(hit.feature);
      }
    }
    if (features.size > 0) found[context] = [...features].sort();
  }
  return found;
}

/** Targets of the markdown links in an index that point at a file in the index's own folder. */
function localLinkTargets(index: string): string[] {
  const targets: string[] = [];
  for (const match of index.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = match[1].replace(/[#?].*$/, "").replace(/^\.\//, "");
    if (!target || target.includes("/") || target.includes(":")) continue;
    targets.push(target);
  }
  return targets;
}

/**
 * Structure and index rules (FR-002, FR-003, FR-017) for `docs/specs/<context>/` folders: the
 * named contexts, or every folder under `docs/specs/` when none are named. A missing folder has
 * nothing to check. Finding files are repository-relative.
 */
export function checkLivingDocTree(dir: string, contexts?: string[]): DocsFinding[] {
  const specs = join(dir, SPECS_DIR);
  const folders = contexts ?? subdirs(specs);
  const findings: DocsFinding[] = [];
  for (const context of folders) {
    const folder = join(specs, context);
    if (!isDir(folder)) continue;
    const rel = `${SPECS_DIR}/${context}`;
    const indexRel = `${rel}/${INDEX_FILE}`;
    const markdown = listEntries(folder).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name);
    const capabilities: string[] = [];
    for (const name of markdown) {
      if (name === INDEX_FILE) continue;
      if (name.slice(0, -3).toLowerCase() === "readme") {
        findings.push({
          severity: "ERROR", code: "docs_capability_reserved", file: `${rel}/${name}`,
          message: `${rel}/${name}: README is reserved for the context index and is not a capability name`,
        });
        continue;
      }
      capabilities.push(name);
    }

    for (const name of capabilities) {
      const body = readFileSync(join(folder, name), "utf8");
      for (const heading of LIVING_DOC_HEADINGS) {
        if (readMarkdownSection(body, heading.slice(3)) !== null) continue;
        findings.push({
          severity: "ERROR", code: "docs_heading_missing", file: `${rel}/${name}`,
          message: `${rel}/${name} is missing the living-doc heading "${heading}"`,
        });
      }
    }

    const indexPath = join(folder, INDEX_FILE);
    const targets = isFile(indexPath) ? localLinkTargets(readFileSync(indexPath, "utf8")) : [];
    for (const target of new Set(targets)) {
      if (existsSync(join(folder, target))) continue;
      findings.push({
        severity: "ERROR", code: "docs_index_dangling", file: indexRel,
        message: `${indexRel} links to ${target}, which does not exist in ${rel}/`,
      });
    }
    const linked = new Set(targets);
    for (const name of capabilities) {
      if (linked.has(name)) continue;
      findings.push({
        severity: "ERROR", code: "docs_index_missing_entry", file: `${rel}/${name}`,
        message: `${rel}/${name} is not linked from ${indexRel}`,
      });
    }
  }
  return findings;
}

/**
 * The base ref of the project-wide docs check and its merge-base with HEAD (FR-017). Skipped,
 * with the reason, when no `--base` is given and origin/HEAD is not set, or when the ref shares no
 * history with HEAD. A `--base` that does not resolve throws with git's error.
 */
export function resolveDocsBase(dir: string, baseOpt: string | undefined): DocsBase {
  let ref: string;
  if (baseOpt !== undefined) {
    assertRefArg(baseOpt, "--base");
    git(dir, ["rev-parse", "--verify", `${baseOpt}^{commit}`]);
    ref = baseOpt;
  } else {
    const origin = originDefaultRef(dir);
    if (origin === null) return { skipped: "no --base given and origin/HEAD is not set" };
    const res = runGit(dir, ["rev-parse", "-q", "--verify", `${origin}^{commit}`]);
    // -q makes a missing ref exit 1 silently; anything else is a real failure.
    if (res.code === 1) return { skipped: `origin/HEAD points at ${origin}, which does not resolve to a commit` };
    if (res.code !== 0) {
      throw new Error(`git rev-parse --verify ${origin} failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
    }
    ref = origin;
  }
  const res = runGit(dir, ["merge-base", "HEAD", ref]);
  // merge-base exits 1 with no output when the histories share no commit (also a shallow clone).
  if (res.code === 1 && res.stdout.trim() === "") return { skipped: `${ref} has no merge-base with HEAD` };
  if (res.code !== 0) throw new Error(`git merge-base HEAD ${ref} failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`);
  return { ref, mergeBase: res.stdout.trim() };
}

/** `{context}/{feature}` as a whole token on some line of `section`. */
function namesToken(section: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(section);
}

/** The `## History` sections of living docs and `## Retired` sections of context indexes at HEAD. */
function namingSectionsAtHead(dir: string): string[] {
  const sections: string[] = [];
  for (const path of splitZ(git(dir, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", SPECS_DIR]))) {
    const parts = path.split("/");
    if (parts.length !== 4 || !parts[3].endsWith(".md")) continue;
    const body = git(dir, ["show", `HEAD:${path}`]);
    const section = readMarkdownSection(body, parts[3] === INDEX_FILE ? "Retired" : "History");
    if (section !== null) sections.push(section);
  }
  return sections;
}

/**
 * Rule (a) of FR-013 over the committed diff between `mergeBase` and HEAD: a legacy feature with
 * any file removed must have every file removed, and must then be named as `{context}/{feature}`
 * in a living doc's `## History` or a context index's `## Retired`. `contexts` are the declared
 * contexts; without them any folder name that follows the context naming rule counts.
 */
export function removedLegacyFindings(dir: string, mergeBase: string, contexts?: string[]): DocsFinding[] {
  assertRefArg(mergeBase, "merge-base");
  const deleted = splitZ(git(dir, [
    "diff", "--name-only", "-z", "--no-renames", "--diff-filter=D", mergeBase, "HEAD", "--", ...LEGACY_ROOTS,
  ]));
  const removed = new Map<string, { context: string; feature: string; path: string }>();
  for (const path of deleted) {
    const hit = legacyFeatureOf(path);
    if (!hit || (contexts && !contexts.includes(hit.context))) continue;
    const token = `${hit.context}/${hit.feature}`;
    if (!removed.has(token)) removed.set(token, { ...hit, path });
  }

  const findings: DocsFinding[] = [];
  let sections: string[] | null = null;
  for (const [token, { context, feature, path }] of removed) {
    const left = splitZ(git(dir, ["ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...legacyPaths(context, feature)]));
    if (left.length > 0) {
      findings.push({
        severity: "ERROR", code: "docs_legacy_half_removed", file: left[0],
        message: `Legacy feature ${token} is only partly removed: ${left.join(", ")} still exist(s); remove every file of it`,
      });
      continue;
    }
    sections ??= namingSectionsAtHead(dir);
    if (sections.some((section) => namesToken(section, token))) continue;
    findings.push({
      severity: "ERROR", code: "docs_legacy_unnamed", file: path,
      message: `Legacy feature ${token} was removed but no living doc names it: add ${token} to the ## History of a living doc under ${SPECS_DIR}/, or to the ## Retired list of a context index`,
    });
  }
  return findings;
}

/** True when any path under `docs/specs/` differs between `mergeBase` and HEAD (committed refs only). */
export function docsSpecsChanged(dir: string, mergeBase: string): boolean {
  assertRefArg(mergeBase, "merge-base");
  return splitZ(git(dir, ["diff", "--name-only", "-z", mergeBase, "HEAD", "--", SPECS_DIR])).length > 0;
}

/** Files under `docs/specs/` that HEAD adds relative to `mergeBase`; a renamed file is not an addition. */
export function addedSpecsFiles(dir: string, mergeBase: string): string[] {
  assertRefArg(mergeBase, "merge-base");
  return splitZ(git(dir, [
    "diff", "--name-only", "-z", "--find-renames", "--diff-filter=A", mergeBase, "HEAD", "--", SPECS_DIR,
  ]));
}
