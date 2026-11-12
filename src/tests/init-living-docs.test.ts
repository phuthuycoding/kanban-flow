import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cmdInit } from "../cli/commands/init.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { cmdInstall, cmdUninstall } from "../integrations/install.js";
import { MANAGED_SKILLS, copyName } from "../integrations/managed.js";
import type { ParsedArgs } from "../cli/args.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const LEGACY = ["requirement", "use-cases", "testplan"];

let root: string;
const specsReadme = () => join(root, "docs", "specs", "README.md");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-init-living-docs-"));
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf init creates the living-doc layout", () => {
  it("creates docs/specs with a README and none of the legacy dirs on the onboarding path", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(join(root, "docs", "specs"))).toBe(true);
    expect(existsSync(specsReadme())).toBe(true);
    for (const d of LEGACY) expect(existsSync(join(root, "docs", d)), d).toBe(false);
  });

  it("creates docs/specs with a README and none of the legacy dirs on the minimal path", async () => {
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(specsReadme())).toBe(true);
    for (const d of LEGACY) expect(existsSync(join(root, "docs", d)), d).toBe(false);
  });

  it("reports docs/specs and no longer the legacy docs layout in its output", async () => {
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.stdout).toContain("docs/specs");
    expect(res.stdout).not.toContain("docs/{requirement,use-cases,testplan}");
  });

  it("writes a specs README that says specs is current and the legacy dirs await consolidation", async () => {
    await cmdInit(args("init", [], { defaults: true }), root);
    const text = readFileSync(specsReadme(), "utf8");
    expect(text).toMatch(/current/i);
    for (const d of LEGACY) expect(text, d).toContain(`docs/${d}`);
    expect(text).toMatch(/legacy/i);
    expect(text).toMatch(/consolidat/i);
  });

  it.each([{ defaults: true }, { minimal: true }])("leaves a customised specs README untouched on %o", async (options) => {
    await mkdir(join(root, "docs", "specs"), { recursive: true });
    await writeFile(specsReadme(), "# My own index\n");
    const res = await cmdInit(args("init", [], options), root);
    expect(res.code, res.stdout).toBe(0);
    expect(readFileSync(specsReadme(), "utf8")).toBe("# My own index\n");
  });

  it("does not touch the project's own docs/README.md", async () => {
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs", "README.md"), "# Project docs\n");
    await cmdInit(args("init", [], { defaults: true }), root);
    expect(readFileSync(join(root, "docs", "README.md"), "utf8")).toBe("# Project docs\n");
  });
});

describe("kf uninstall --purge and docs", () => {
  it("leaves docs/specs and the legacy snapshots in place", async () => {
    await mkdir(join(root, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: root, scope: "project" });
    await mkdir(join(root, "docs", "specs"), { recursive: true });
    await writeFile(specsReadme(), "# Specs\n");
    for (const d of LEGACY) await mkdir(join(root, "docs", d), { recursive: true });

    const res = await cmdUninstall(["codex"], { cwd: root, scope: "project", purge: true, force: true });
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(join(root, ".works"))).toBe(false);
    expect(existsSync(specsReadme())).toBe(true);
    for (const d of LEGACY) expect(existsSync(join(root, "docs", d)), d).toBe(true);
  });
});

describe("the docs skill", () => {
  it("is a managed skill", () => {
    expect(MANAGED_SKILLS).toContain("docs");
  });

  it("is installed as kf-docs", async () => {
    await mkdir(join(root, ".works"), { recursive: true });
    const res = await cmdInstall(["codex"], { cwd: root, scope: "project" });
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(join(root, ".agents", "skills", copyName("docs"), "SKILL.md"))).toBe(true);
  });

  it("is reported by kf doctor when its installed copy is removed", async () => {
    const init = await cmdInit(args("init", [], { minimal: true, context: "app", agent: "codex" }), root);
    expect(init.code, init.stdout).toBe(0);
    // --agent is not recorded by init, so the config is patched the way a user's choice would be.
    const cfgPath = join(root, ".kf", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath, JSON.stringify({ ...cfg, agents: ["codex"] }, null, 2));
    const skill = join(process.env.HOME!, ".agents", "skills", "kf-docs");
    expect(existsSync(join(skill, "SKILL.md")), "init installs the docs skill").toBe(true);
    const healthy = await cmdDoctor(args("doctor"), root);
    expect(healthy.stdout).not.toContain("kf-docs");

    await rm(skill, { recursive: true, force: true });
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("kf-docs");
  });

  describe("SKILL.md", () => {
    const text = () => readFileSync(join(ROOT, "assets", "skills", "docs", "SKILL.md"), "utf8");

    it("has frontmatter naming the skill", () => {
      expect(text()).toMatch(/^---\n[\s\S]*?name:\s*docs[\s\S]*?\n---/);
    });

    it("asks for approval of the table before writing", () => {
      expect(text()).toMatch(/approv\w*[^\n]*table|table[^\n]*approv/i);
    });

    it("reads kf doctor --json and works one context per run", () => {
      expect(text()).toContain("kf doctor --json");
      expect(text()).toMatch(/one context (per|at a) (run|time)|one context per run/i);
    });

    it("runs kf validate --all --base before the PR", () => {
      expect(text()).toMatch(/kf validate --all[^\n]*--base/);
    });

    it("asks before creating its branch and never works on the default branch", () => {
      expect(text()).toMatch(/ask[^\n]*branch|branch[^\n]*ask/i);
      expect(text()).toMatch(/never[^\n]*default branch|default branch[^\n]*never/i);
    });

    it("never merges", () => {
      expect(text()).toMatch(/never[^\n]*merge|does not merge|do not merge/i);
    });
  });
});

describe("kf autoconfig CI item", () => {
  it("lists a checklist item for the living-docs CI check", async () => {
    await writeFile(join(root, "package.json"), '{"name":"x"}', "utf8");
    const res = await cmdAutoconfig({ command: "autoconfig", options: {}, positionals: [] } as ParsedArgs, root, async () => ({ code: 0, stdout: "[]", stderr: "" }));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("validate --all --strict --base");
    expect(res.stdout).toMatch(/\[[ x]\] CI\b/);
  });
});
