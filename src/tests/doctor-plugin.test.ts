import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, symlink, chmod, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let dir: string;
let root: string;
let bin: string;
let log: string;
let prevPath: string | undefined;

const entry = (over: Record<string, unknown> = {}) => ({
  id: "kf@kanban-flow",
  scope: "user",
  enabled: true,
  readFromFolder: PKG_ROOT,
  ...over,
});

/**
 * A `claude` on PATH that logs its argv and answers `plugin list --json` from KF_STUB_LIST. A
 * `plugin install` switches the list to KF_STUB_INSTALLED, so a repair can be seen to take effect.
 */
async function writeStub(): Promise<void> {
  const script = [
    "#!/bin/sh",
    'echo "$*" >> "$KF_STUB_LOG"',
    'if [ -n "$KF_STUB_FAIL" ] && [ "$1 $2" = "plugin marketplace" ]; then echo "boom" >&2; exit 1; fi',
    'if [ "$1 $2" = "plugin list" ]; then',
    '  if [ -f "$KF_STUB_STATE" ]; then cat "$KF_STUB_STATE"; else echo "${KF_STUB_LIST:-[]}"; fi',
    "fi",
    'if [ "$1 $2" = "plugin install" ] && [ -n "$KF_STUB_INSTALLED" ]; then echo "$KF_STUB_INSTALLED" > "$KF_STUB_STATE"; fi',
    // A stale path is fixed by registering the marketplace again; no reinstall follows.
    'if [ "$1 $2 $3" = "plugin marketplace add" ] && [ -n "$KF_STUB_AFTER_ADD" ]; then echo "$KF_STUB_AFTER_ADD" > "$KF_STUB_STATE"; fi',
    "exit 0",
    "",
  ].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

/** The finding lines (not the path header), so a temp dir name can never satisfy a match. */
const findingLines = (stdout: string) => stdout.split("\n").filter((l) => /^\s+\[(ERROR|WARNING)\]/.test(l));
const calls = async () => (existsSync(log) ? (await readFile(log, "utf8")).split("\n").filter(Boolean) : []);
const setList = (list: unknown) => {
  process.env.KF_STUB_LIST = typeof list === "string" ? list : JSON.stringify(list);
};

/** A project configured for one agent, as init leaves it, with the claude/codex install residue cleared from HOME. */
async function project(agent: string): Promise<void> {
  setList([]);
  const res = await cmdInit(args("init", [], { minimal: true, context: "app", agent }), root);
  expect(res.code).toBe(0);
  // --minimal does not record the agent, so the config is patched the way a user's choice would be.
  const cfgPath = join(root, ".kf", "config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
  await writeFile(cfgPath, JSON.stringify({ ...cfg, agents: [agent] }, null, 2));
  const home = process.env.HOME!;
  for (const rel of [".claude", ".agents"]) await rm(join(home, rel), { recursive: true, force: true });
  await rm(log, { force: true });
  await rm(join(dir, "state.json"), { force: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-doctor-pl-"));
  root = join(dir, "proj");
  bin = join(dir, "bin");
  log = join(dir, "claude.log");
  await mkdir(root);
  await mkdir(bin);
  await writeStub();
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.KF_STUB_LOG = log;
  process.env.KF_STUB_STATE = join(dir, "state.json");
  delete process.env.KF_STUB_LIST;
  delete process.env.KF_STUB_INSTALLED;
  delete process.env.KF_STUB_AFTER_ADD;
  delete process.env.KF_STUB_FAIL;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const k of ["KF_STUB_LOG", "KF_STUB_STATE", "KF_STUB_LIST", "KF_STUB_INSTALLED", "KF_STUB_AFTER_ADD", "KF_STUB_FAIL"]) delete process.env[k];
  await rm(dir, { recursive: true, force: true });
});

describe("kf doctor and the kf plugin for claude", () => {
  it("is healthy when the plugin is current and no skill or agent copies exist", async () => {
    await project("claude");
    setList([entry()]);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.stdout).not.toMatch(/\[ERROR\]/);
    expect(res.code).toBe(0);
  });

  it("reports a missing plugin as a problem", async () => {
    await project("claude");
    setList([]);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).not.toBe(0);
    expect(findingLines(res.stdout).some((l) => /plugin/i.test(l) && /missing|not installed/i.test(l))).toBe(true);
  });

  it("reports a disabled plugin as a problem", async () => {
    await project("claude");
    setList([entry({ enabled: false })]);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).not.toBe(0);
    expect(findingLines(res.stdout).some((l) => /plugin/i.test(l) && /disabled/i.test(l))).toBe(true);
  });

  it("reports a plugin registered at another path as stale and names that path", async () => {
    await project("claude");
    setList([entry({ readFromFolder: "/old/nvm/lib/node_modules/kanban-flow" })]);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).not.toBe(0);
    const line = findingLines(res.stdout).find((l) => /plugin/i.test(l) && /stale/i.test(l));
    expect(line).toBeDefined();
    expect(line).toContain("/old/nvm/lib/node_modules/kanban-flow");
  });

  it("with --fix and a claude on PATH, adds the marketplace and installs the plugin, then re-checks healthy", async () => {
    await project("claude");
    setList([]);
    process.env.KF_STUB_INSTALLED = JSON.stringify([entry()]);
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    const log = await calls();
    const add = log.indexOf(`plugin marketplace add ${PKG_ROOT}`);
    const install = log.findIndex((l) => l.startsWith("plugin install kf@kanban-flow"));
    expect(add).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(add);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toMatch(/\[ERROR\]/);
  });

  it("with --fix on a stale path, points the marketplace at the running package again", async () => {
    await project("claude");
    setList([entry({ readFromFolder: "/old/kf" })]);
    process.env.KF_STUB_AFTER_ADD = JSON.stringify([entry()]);
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(await calls()).toContain(`plugin marketplace add ${PKG_ROOT}`);
    expect(res.code).toBe(0);
  });

  it("with --fix and no claude on PATH, prints the manual plugin commands and exits non-zero", async () => {
    await project("claude");
    // Keep the system dirs so doctor's other tools resolve; claude lives under ~/.local/bin, not here.
    const empty = join(dir, "empty");
    await mkdir(empty);
    process.env.PATH = `${empty}:/usr/bin:/bin`;
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("/plugin marketplace add");
    expect(res.stdout).toContain("/plugin install");
  });
});

describe("kf doctor for a runtime that gets skill copies", () => {
  it("reports missing kf-* copies and --fix installs them", async () => {
    await project("codex");
    setList([]);
    const skills = join(process.env.HOME!, ".agents", "skills");
    const before = await cmdDoctor(args("doctor"), root);
    expect(before.code).not.toBe(0);
    expect(before.stdout).toContain("kf-");

    const fixed = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(fixed.code).toBe(0);
    expect(existsSync(join(skills, "kf-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(skills, "kf-plan", "SKILL.md"))).toBe(true);
  });

  it("does not ask the claude CLI about the plugin when claude is not configured", async () => {
    await project("codex");
    await cmdDoctor(args("doctor"), root);
    expect((await calls()).filter((l) => l.startsWith("plugin"))).toEqual([]);
  });
});

describe("kf doctor and legacy leftovers", () => {
  const OLD_NAMES = ["kanban-flow", "kanban-brainstorm", "kanban-plan", "kanban-implement", "kanban-test", "kanban-review", "kanban-archive", "kanban-bug"];

  async function seedLeftovers(): Promise<{ owned: string[]; foreignTravel: string }> {
    const home = process.env.HOME!;
    const owned: string[] = [];
    const claudeSkills = join(home, ".claude", "skills");
    await mkdir(claudeSkills, { recursive: true });
    for (const name of OLD_NAMES) {
      const target = join(claudeSkills, name);
      await mkdir(target);
      await writeFile(join(target, "SKILL.md"), `---\nname: ${name}\n---\nold\n`);
      owned.push(target);
    }
    for (const rel of [".gemini/skills", ".cursor/skills", ".config/opencode/skills"]) {
      const target = join(home, rel, "kanban-plan");
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), "old copy\n");
      owned.push(target);
    }
    const agents = join(home, ".claude", "agents");
    await mkdir(agents, { recursive: true });
    const agent = join(agents, "developer.md");
    await symlink(join(PKG_ROOT, "agents", "developer.md"), agent);
    owned.push(agent);
    const foreignTravel = join(home, ".agents", "skills", "travel");
    await mkdir(foreignTravel, { recursive: true });
    await writeFile(join(foreignTravel, "SKILL.md"), "my trip planner\n");
    return { owned, foreignTravel };
  }

  it("reports the leftovers, and --fix removes the owned ones and leaves the unowned travel alone", async () => {
    await project("claude");
    setList([entry()]);
    const { owned, foreignTravel } = await seedLeftovers();

    const before = await cmdDoctor(args("doctor"), root);
    expect(before.stdout).toContain("kanban-plan");
    expect(before.stdout).toContain(".gemini/skills");
    expect(before.stdout).toContain(".cursor/skills");
    expect(before.stdout).toContain(".config/opencode/skills");
    for (const path of owned) expect(existsSync(path), path).toBe(true);

    const fixed = await cmdDoctor(args("doctor", [], { fix: true }), root);
    for (const path of owned) expect(existsSync(path), path).toBe(false);
    expect(await readFile(join(foreignTravel, "SKILL.md"), "utf8")).toBe("my trip planner\n");
    expect(fixed.code).toBe(0);
    expect(fixed.stdout).not.toContain("[ERROR]");
  });

  it("never flags or touches a user's bare-name test, plan or review skill, with or without --fix", async () => {
    await project("claude");
    setList([entry()]);
    const skills = join(process.env.HOME!, ".claude", "skills");
    for (const name of ["test", "plan", "review"]) {
      await mkdir(join(skills, name), { recursive: true });
      await writeFile(join(skills, name, "SKILL.md"), `my ${name}\n`);
    }
    const before = await cmdDoctor(args("doctor"), root);
    const fixed = await cmdDoctor(args("doctor", [], { fix: true }), root);
    for (const out of [before.stdout, fixed.stdout]) {
      expect(out).not.toMatch(/\[(ERROR|WARNING)\][^\n]*skills/);
    }
    expect((await readdir(skills)).sort()).toEqual(["plan", "review", "test"]);
    for (const name of ["test", "plan", "review"]) {
      expect(await readFile(join(skills, name, "SKILL.md"), "utf8")).toBe(`my ${name}\n`);
    }
    expect(before.code).toBe(0);
  });
});

describe("kf doctor probe failures", () => {
  it("calls an unusable claude answer 'state unknown', as a warning that does not fail the verdict", async () => {
    await project("claude");
    setList("garbage-out");
    const res = await cmdDoctor(args("doctor"), root);
    const line = findingLines(res.stdout).find((l) => l.includes("kf plugin state unknown:"));
    expect(line).toBeDefined();
    expect(line).toContain("[WARNING]");
    expect(res.stdout).not.toContain("cannot check kf plugin");
  });

  it("keeps 'cannot check' for a claude that is not on PATH, still a warning", async () => {
    await project("claude");
    const empty = join(dir, "empty");
    await mkdir(empty);
    process.env.PATH = `${empty}:/usr/bin:/bin`;
    const res = await cmdDoctor(args("doctor"), root);
    const line = findingLines(res.stdout).find((l) => l.includes("cannot check kf plugin:"));
    expect(line).toBeDefined();
    expect(line).toContain("[WARNING]");
    expect(res.stdout).not.toContain("kf plugin state unknown");
  });
});

describe("kf doctor --fix when the plugin cannot be repaired", () => {
  it("leaves the legacy entries in place and exits non-zero", async () => {
    await project("claude");
    setList([]);
    process.env.KF_STUB_FAIL = "1";
    const skills = join(process.env.HOME!, ".claude", "skills");
    const legacy = join(skills, "kanban-plan");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "SKILL.md"), "old\n");
    const agent = join(process.env.HOME!, ".claude", "agents", "developer.md");
    await mkdir(join(process.env.HOME!, ".claude", "agents"), { recursive: true });
    await symlink(join(PKG_ROOT, "agents", "developer.md"), agent);

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.code).not.toBe(0);
    expect(existsSync(join(legacy, "SKILL.md"))).toBe(true);
    expect((await lstat(agent)).isSymbolicLink()).toBe(true);
    expect(res.stdout).not.toContain("removed legacy");
  });
});

describe("kf doctor legacy leftovers at both scopes", () => {
  /** skills.scope=project, so the plugin and copy checks use the project scope; the leftovers sit at both. */
  async function projectScoped(): Promise<{ homeLeftover: string; projectLeftover: string }> {
    await project("claude");
    const cfgPath = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath, JSON.stringify({ ...cfg, skills: { scope: "project" } }, null, 2));
    setList([entry({ scope: "project" })]);
    const homeLeftover = join(process.env.HOME!, ".claude", "skills", "kanban-plan");
    const projectLeftover = join(root, ".claude", "skills", "kanban-bug");
    for (const d of [homeLeftover, projectLeftover]) {
      await mkdir(d, { recursive: true });
      await writeFile(join(d, "SKILL.md"), "old\n");
    }
    return { homeLeftover, projectLeftover };
  }

  it("reports the user-scope leftover and the project-scope one", async () => {
    await projectScoped();
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.stdout).toContain("kanban-plan");
    expect(res.stdout).toContain("kanban-bug");
  });

  it("--fix removes both, whichever scope the project is configured for", async () => {
    const { homeLeftover, projectLeftover } = await projectScoped();
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(existsSync(homeLeftover)).toBe(false);
    expect(existsSync(projectLeftover)).toBe(false);
  });

  it("does the same for a global-scope project with a leftover in the project dir", async () => {
    await project("claude");
    setList([entry()]);
    const projectLeftover = join(root, ".claude", "skills", "kanban-bug");
    await mkdir(projectLeftover, { recursive: true });
    await writeFile(join(projectLeftover, "SKILL.md"), "old\n");
    expect((await cmdDoctor(args("doctor"), root)).stdout).toContain("kanban-bug");
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(existsSync(projectLeftover)).toBe(false);
  });
});

describe("kf doctor and entries kf does not own", () => {
  it("warns about a kanban-* link pointing outside the package and --fix leaves it in place", async () => {
    await project("claude");
    setList([entry()]);
    const skills = join(process.env.HOME!, ".claude", "skills");
    await mkdir(skills, { recursive: true });
    const elsewhere = join(dir, "mine", "bug");
    await mkdir(elsewhere, { recursive: true });
    const link = join(skills, "kanban-bug");
    await symlink(elsewhere, link, "dir");

    const before = await cmdDoctor(args("doctor"), root);
    const line = findingLines(before.stdout).find((l) => l.includes("kanban-bug"));
    expect(line).toBeDefined();
    expect(line).toContain("[WARNING]");
    expect(line).toContain("not owned by kf, left alone");
    expect(before.code).toBe(0);

    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
  });
});
