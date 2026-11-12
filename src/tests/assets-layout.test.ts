import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ParsedArgs } from "../cli/args.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

describe("the packaged asset tree", () => {
  it("keeps skills, agents, templates, review packs, the GitHub hook pack and the README under assets/", () => {
    for (const rel of ["skills", "agents", "templates", "review/rules", "review/stacks", "github-hooks", "README.md"]) {
      expect(existsSync(join(repo, "assets", rel)), `assets/${rel} must exist`).toBe(true);
    }
  });

  it("holds 11 skill directories that each carry a SKILL.md", () => {
    const skillsDir = join(repo, "assets", "skills");
    const dirs = existsSync(skillsDir) ? readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
    expect(dirs).toHaveLength(11);
    for (const d of dirs) expect(existsSync(join(skillsDir, d.name, "SKILL.md")), `${d.name}/SKILL.md`).toBe(true);
  });

  it("holds the 7 agent definitions as markdown files", () => {
    const agentsDir = join(repo, "assets", "agents");
    const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort() : [];
    expect(files).toEqual([
      "automation-writer.md",
      "code-reviewer.md",
      "developer.md",
      "researcher.md",
      "scout.md",
      "spec-reviewer.md",
      "test-writer.md",
    ]);
  });

  it("leaves no skills/, agents/ or kanban-flow/ directory at the repository root", () => {
    for (const old of ["skills", "agents", "kanban-flow"]) {
      expect(statSync(join(repo, old), { throwIfNoEntry: false }), `${old}/ must be gone from the root`).toBeUndefined();
    }
  });
});

describe("the CLI reads packaged assets from assets/", () => {
  let base: string;
  let project: string;
  let home: string;
  const savedHome = process.env.HOME;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "kf-assets-layout-"));
    home = join(base, "home");
    project = join(base, "project");
    await mkdir(home, { recursive: true });
    await mkdir(project, { recursive: true });
    // The user override dir is resolved from HOME at import time, so modules are re-imported under a temp HOME.
    process.env.HOME = home;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.HOME = savedHome;
    vi.resetModules();
    await rm(base, { recursive: true, force: true });
  });

  it("points kf instruct at a template under assets/templates", async () => {
    const { ensureWorksStructure } = await import("../workflow/features.js");
    const { cmdNew } = await import("../cli/commands/new.js");
    const { cmdInstruct } = await import("../cli/commands/artifacts.js");
    await ensureWorksStructure(project);
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), project)).code).toBe(0);
    const res = await cmdInstruct(args("instruct", ["spec-requirement"], { change: "demo" }), project);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`Template (package): ${join(repo, "assets", "templates")}`);
  });

  it("copies a stack rule from assets/review/stacks", async () => {
    const { cmdRules } = await import("../cli/commands/rules.js");
    const res = await cmdRules(args("rules", [], { stack: "node" }), project);
    expect(res.code).toBe(0);
    const src = join(repo, "assets", "review", "stacks", "node.md");
    expect(existsSync(src)).toBe(true);
    expect(await readFile(join(project, ".kf", "review", "rules", "node.md"), "utf8")).toBe(readFileSync(src, "utf8"));
  });

  it("resolves a review rule with no overrides to assets/review/rules", async () => {
    const { resolveRule } = await import("../shared/paths.js");
    const hit = resolveRule(project, "general.md");
    expect(hit).toEqual({ name: "general.md", path: join(repo, "assets", "review", "rules", "general.md"), source: "package" });
  });

  it("seeds templates and rules on init from assets/", async () => {
    const { cmdInit } = await import("../cli/commands/init.js");
    const res = await cmdInit(args("init", [], { defaults: true }), project);
    expect(res.code).toBe(0);
    const tpl = join(repo, "assets", "templates");
    const rules = join(repo, "assets", "review", "rules");
    expect(existsSync(tpl)).toBe(true);
    expect(existsSync(rules)).toBe(true);
    for (const f of readdirSync(tpl)) expect(existsSync(join(project, ".kf", "templates", f)), `templates/${f}`).toBe(true);
    for (const f of readdirSync(rules).filter((n) => n.endsWith(".md") && n !== "README.md")) {
      expect(existsSync(join(project, ".kf", "review", "rules", f)), `rules/${f}`).toBe(true);
    }
  });

  it("seeds the GitHub hook pack from assets/github-hooks and doctor --fix restores a deleted hook from it", async () => {
    const { cmdInit } = await import("../cli/commands/init.js");
    const { seedGithubHooks } = await import("../project/bootstrap.js");
    const { cmdDoctor } = await import("../cli/commands/doctor.js");
    await cmdInit(args("init", [], { defaults: true }), project);
    await seedGithubHooks(project);
    const pack = join(repo, "assets", "github-hooks");
    const hooks = join(project, ".kf", "hooks");
    expect(existsSync(join(pack, "lib-github.sh"))).toBe(true);
    expect(readFileSync(join(hooks, "lib-github.sh"), "utf8")).toBe(readFileSync(join(pack, "lib-github.sh"), "utf8"));
    await rm(join(hooks, "brainstorm.sh"));
    const res = await cmdDoctor(args("doctor", [], { fix: true }), project);
    expect(res.stdout).toContain("restored .kf/hooks/brainstorm.sh");
    expect(readFileSync(join(hooks, "brainstorm.sh"), "utf8")).toBe(readFileSync(join(pack, "brainstorm.sh"), "utf8"));
  });

  it("makes kf autoconfig cite rules read from assets/review/rules", async () => {
    const { cmdAutoconfig } = await import("../cli/commands/autoconfig.js");
    await writeFile(join(project, "package.json"), '{"name":"x"}', "utf8");
    const claude = async () => ({ code: 0, stdout: "[]", stderr: "" });
    const res = await cmdAutoconfig(args("autoconfig"), project, claude);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`(package: ${join(repo, "assets", "review", "rules")}`);
  });

  it("finds no package stage hook, since assets/hooks does not exist", async () => {
    const { resolveHook } = await import("../integrations/hooks.js");
    expect(existsSync(join(repo, "assets", "hooks"))).toBe(false);
    expect(resolveHook(project, "implementation")).toBeNull();
  });
});

describe("repository walks in tests cover the moved tree", () => {
  it("scans assets and no root that no longer exists in the secrets walk", () => {
    const text = readFileSync(join(repo, "src", "tests", "secrets.test.ts"), "utf8");
    const roots = /for \(const d of (\[[^\]]*\])\) walk\(/.exec(text)?.[1];
    expect(roots, "the walk roots array must be found in secrets.test.ts").toBeDefined();
    const list = JSON.parse(roots!) as string[];
    expect(list).toContain("assets");
    // .works is gitignored and the walk skips a missing root, so only the roots this move removed are barred.
    for (const gone of ["skills", "kanban-flow"]) expect(list).not.toContain(gone);
  });
});
