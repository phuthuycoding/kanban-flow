import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, symlink, copyFile, chmod } from "node:fs/promises";
import { lstatSync, existsSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInstall, cmdUninstall, removeLegacy, MANAGED_AGENTS } from "../integrations/install.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { SkillScope } from "../integrations/agents.js";

const LEGACY = [
  ["kanban-flow", "flow"],
  ["kanban-brainstorm", "brainstorm"],
  ["kanban-plan", "plan"],
  ["kanban-implement", "implement"],
  ["kanban-test", "test"],
  ["kanban-review", "review"],
  ["kanban-archive", "archive"],
  ["kanban-bug", "bug"],
] as const;

const PROJECT_RUNTIME_DIRS = [".agents/skills", ".gemini/skills", ".cursor/skills", ".kiro/skills", ".opencode/skills", ".devin/skills"];
const USER_RUNTIME_DIRS = [".agents/skills", ".gemini/skills", ".cursor/skills", ".kiro/skills", ".config/opencode/skills"];

let dir: string;
let proj: string;
let home: string;
let bin: string;
let prevPath: string | undefined;

/** A `claude` on PATH that accepts every plugin call, so install and uninstall reach the migration step. */
async function writeStub(): Promise<void> {
  const script = ["#!/bin/sh", 'if [ "$1 $2" = "plugin list" ]; then echo "[]"; fi', "exit 0", ""].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-migration-"));
  proj = join(dir, "proj");
  bin = join(dir, "bin");
  home = process.env.HOME!;
  await mkdir(proj);
  await mkdir(bin);
  await writeStub();
  ensureWorksStructure(proj);
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(dir, { recursive: true, force: true });
});

const base = (scope: SkillScope) => (scope === "project" ? proj : home);
const present = (p: string) => {
  try {
    lstatSync(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
};

interface Seed {
  skills: string;
  agents: string;
  runtimeSkillDirs: string[];
  /** Every entry kf owns and a migration must remove. */
  owned: string[];
}

/** What kf 0.14 and earlier left behind at one scope: kanban-* entries, a kf travel, loose agents, per-runtime copies. */
async function seedLegacy(scope: SkillScope, travel: "owned" | "foreign" = "owned"): Promise<Seed> {
  const root = base(scope);
  const skills = join(root, ".claude", "skills");
  const agents = join(root, ".claude", "agents");
  await mkdir(skills, { recursive: true });
  await mkdir(agents, { recursive: true });
  const owned: string[] = [];

  for (const [i, [entry, bare]] of LEGACY.entries()) {
    const target = join(skills, entry);
    if (i % 2 === 0) {
      await mkdir(target);
      await writeFile(join(target, "SKILL.md"), `---\nname: ${entry}\n---\nold body\n`);
      // A local edit does not make the directory the user's: the kanban- prefix is kf's.
      if (i === 0) await writeFile(join(target, "notes.md"), "my local edit\n");
    } else {
      await symlink(join(PKG_ROOT, "skills", bare), target, "dir");
    }
    owned.push(target);
  }

  const travelPath = join(skills, "travel");
  if (travel === "owned") {
    await symlink(join(PKG_ROOT, "skills", "travel"), travelPath, "dir");
    owned.push(travelPath);
  } else {
    await mkdir(travelPath);
    await writeFile(join(travelPath, "SKILL.md"), "---\nname: travel\n---\nmy trip planner\n");
  }

  for (const name of MANAGED_AGENTS) {
    const target = join(agents, `${name}.md`);
    const packaged = join(PKG_ROOT, "agents", `${name}.md`);
    if (scope === "global") await symlink(packaged, target);
    else await copyFile(packaged, target);
    owned.push(target);
  }

  const runtimeSkillDirs = (scope === "project" ? PROJECT_RUNTIME_DIRS : USER_RUNTIME_DIRS).map((rel) => join(root, rel));
  for (const runtimeDir of runtimeSkillDirs) {
    for (const [entry] of LEGACY) {
      const target = join(runtimeDir, entry);
      await mkdir(target, { recursive: true });
      await writeFile(join(target, "SKILL.md"), `---\nname: ${entry}\n---\nold copy\n`);
      owned.push(target);
    }
  }
  return { skills, agents, runtimeSkillDirs, owned };
}

async function snapshot(root: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const full = join(root, rel);
  for (const e of await readdir(full, { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isSymbolicLink()) out[r] = `-> ${readlinkSync(join(root, r))}`;
    else if (e.isDirectory()) Object.assign(out, await snapshot(root, r));
    else out[r] = await readFile(join(root, r), "utf8");
  }
  return out;
}

describe.each<SkillScope>(["project", "global"])("legacy migration at %s scope", (scope) => {
  it("removes every kf-owned legacy entry: kanban-* links and dirs, an owned travel, loose agents, per-runtime copies", async () => {
    const seed = await seedLegacy(scope);
    await removeLegacy(proj, scope);
    for (const path of seed.owned) expect(present(path), path).toBe(false);
  });

  it("covers the opencode user-scope dir and the project-only devin dir exactly as the old table did", async () => {
    const seed = await seedLegacy(scope);
    const opencode = scope === "project" ? join(proj, ".opencode/skills") : join(home, ".config/opencode/skills");
    expect(seed.runtimeSkillDirs).toContain(opencode);
    await removeLegacy(proj, scope);
    expect(present(join(opencode, "kanban-plan"))).toBe(false);
  });

  it("keeps a travel it does not own and a user's skill beside the legacy entries", async () => {
    const seed = await seedLegacy(scope, "foreign");
    const mine = join(seed.skills, "review");
    await mkdir(mine);
    await writeFile(join(mine, "SKILL.md"), "my review skill\n");
    await removeLegacy(proj, scope);
    expect(await readFile(join(seed.skills, "travel", "SKILL.md"), "utf8")).toBe("---\nname: travel\n---\nmy trip planner\n");
    expect(await readFile(join(mine, "SKILL.md"), "utf8")).toBe("my review skill\n");
    for (const path of seed.owned) expect(present(path), path).toBe(false);
  });

  it("leaves a kanban-* link that points outside the package, and a loose agent file kf does not own", async () => {
    const seed = await seedLegacy(scope);
    const elsewhere = join(dir, "mine", "bug");
    await mkdir(elsewhere, { recursive: true });
    const bugLink = join(seed.skills, "kanban-bug");
    await rm(bugLink, { recursive: true, force: true });
    await symlink(elsewhere, bugLink, "dir");
    const agent = join(seed.agents, "scout.md");
    await rm(agent);
    await writeFile(agent, "---\nname: scout\n---\nmy own scout\n");

    await removeLegacy(proj, scope);

    expect(lstatSync(bugLink).isSymbolicLink()).toBe(true);
    expect(await readFile(agent, "utf8")).toBe("---\nname: scout\n---\nmy own scout\n");
    expect(present(join(seed.skills, "kanban-plan"))).toBe(false);
    expect(present(join(seed.agents, "developer.md"))).toBe(false);
  });

  it("kf install removes the owned entries and lists them; the unowned travel is untouched and reported", async () => {
    const seed = await seedLegacy(scope, "foreign");
    const res = await cmdInstall(["claude"], { cwd: proj, scope });
    expect(res.code).toBe(0);
    for (const path of seed.owned) expect(present(path), path).toBe(false);
    // The listing, not a mention elsewhere in the output, is what tells the user what was removed.
    const removedLines = res.stdout.split("\n").filter((l) => l.includes("removed legacy")).join("\n");
    for (const [entry] of LEGACY) expect(removedLines).toContain(entry);
    expect(res.stdout).toContain("travel");
    expect(await readFile(join(seed.skills, "travel", "SKILL.md"), "utf8")).toContain("my trip planner");
  });

  it("kf install keeps the legacy entries when the plugin cannot be set up, and exits non-zero", async () => {
    // The old copies are the only working install until the plugin is in place.
    await writeFile(join(bin, "claude"), ["#!/bin/sh", 'if [ "$1 $2" = "plugin list" ]; then echo "[]"; exit 0; fi', "echo boom >&2", "exit 1", ""].join("\n"));
    const seed = await seedLegacy(scope, "foreign");
    const res = await cmdInstall(["claude"], { cwd: proj, scope });
    expect(res.code).not.toBe(0);
    for (const path of seed.owned) expect(present(path), path).toBe(true);
    expect(res.stdout).not.toContain("removed legacy");
  });

  it("kf uninstall removes the same set", async () => {
    const seed = await seedLegacy(scope, "foreign");
    const res = await cmdUninstall(["claude"], { cwd: proj, scope });
    expect(res.code).toBe(0);
    for (const path of seed.owned) expect(present(path), path).toBe(false);
    expect(await readFile(join(seed.skills, "travel", "SKILL.md"), "utf8")).toContain("my trip planner");
  });
});

/** Every bare phase name an earlier release's kanban-<name> skill had; a user may own a skill under any of them. */
const BARE_NAMES = LEGACY.map(([, bare]) => bare);

describe.each<SkillScope>(["project", "global"])("bare-name skills at %s scope", (scope) => {
  it("install, uninstall and removeLegacy never write, modify or delete a user's test, plan or review skill", async () => {
    const root = base(scope);
    const skills = join(root, ".claude", "skills");
    for (const name of BARE_NAMES) {
      await mkdir(join(skills, name), { recursive: true });
      await writeFile(join(skills, name, "SKILL.md"), `my ${name}\n`);
    }
    await seedLegacy(scope);
    const mineBefore = Object.fromEntries(
      Object.entries(await snapshot(skills)).filter(([p]) => BARE_NAMES.some((n) => p.startsWith(`${n}/`))),
    );
    expect(Object.keys(mineBefore).sort()).toEqual(BARE_NAMES.map((n) => `${n}/SKILL.md`).sort());

    await removeLegacy(proj, scope);
    await cmdInstall(["claude"], { cwd: proj, scope });
    await cmdUninstall(["claude"], { cwd: proj, scope });

    const after = await snapshot(skills);
    for (const [path, body] of Object.entries(mineBefore)) expect(after[path]).toBe(body);
    expect(existsSync(join(skills, "test", "SKILL.md"))).toBe(true);
  });

  it("keeps a user's bare-name symlink and the directory it points to", async () => {
    const root = base(scope);
    const skills = join(root, ".claude", "skills");
    await mkdir(skills, { recursive: true });
    const elsewhere = join(dir, "mine");
    const links: string[] = [];
    for (const name of BARE_NAMES) {
      await mkdir(join(elsewhere, name), { recursive: true });
      await writeFile(join(elsewhere, name, "SKILL.md"), `my ${name}\n`);
      await symlink(join(elsewhere, name), join(skills, name), "dir");
      links.push(join(skills, name));
    }
    await seedLegacy(scope);

    await removeLegacy(proj, scope);
    await cmdInstall(["claude"], { cwd: proj, scope });
    await cmdUninstall(["claude"], { cwd: proj, scope });

    for (const name of BARE_NAMES) {
      expect(lstatSync(join(skills, name)).isSymbolicLink(), name).toBe(true);
      expect(readlinkSync(join(skills, name)), name).toBe(join(elsewhere, name));
      expect(await readFile(join(elsewhere, name, "SKILL.md"), "utf8")).toBe(`my ${name}\n`);
    }
  });
});

describe.each<SkillScope>(["project", "global"])("a retired kanban-ship at %s scope on a claude-only install", (scope) => {
  const released = () => readFile(join(PKG_ROOT, "src", "tests", "fixtures", "kanban-ship-0.13.0", "SKILL.md"), "utf8");

  it("kf install removes an owned kanban-ship copy and lists it", async () => {
    const ship = join(base(scope), ".claude", "skills", "kanban-ship");
    await mkdir(ship, { recursive: true });
    await writeFile(join(ship, "SKILL.md"), await released());
    const res = await cmdInstall(["claude"], { cwd: proj, scope });
    expect(res.code).toBe(0);
    expect(present(ship)).toBe(false);
    expect(res.stdout.split("\n").filter((l) => l.includes("removed") && l.includes("kanban-ship"))).not.toHaveLength(0);
  });

  it.skipIf(process.platform === "win32")("kf install removes a kanban-ship link into the package", async () => {
    const skills = join(base(scope), ".claude", "skills");
    await mkdir(skills, { recursive: true });
    const ship = join(skills, "kanban-ship");
    await symlink(join(PKG_ROOT, "skills", "kanban-ship"), ship, "dir");
    const res = await cmdInstall(["claude"], { cwd: proj, scope });
    expect(res.code).toBe(0);
    expect(present(ship)).toBe(false);
  });

  it("kf install keeps a kanban-ship it does not own", async () => {
    const ship = join(base(scope), ".claude", "skills", "kanban-ship");
    await mkdir(ship, { recursive: true });
    await writeFile(join(ship, "SKILL.md"), "my own ship skill\n");
    await cmdInstall(["claude"], { cwd: proj, scope });
    expect(await readFile(join(ship, "SKILL.md"), "utf8")).toBe("my own ship skill\n");
  });

  it("removeLegacy removes the owned copy and keeps the foreign one", async () => {
    const owned = join(base(scope), ".claude", "skills", "kanban-ship");
    await mkdir(owned, { recursive: true });
    await writeFile(join(owned, "SKILL.md"), await released());
    await removeLegacy(proj, scope);
    expect(present(owned)).toBe(false);

    await mkdir(owned, { recursive: true });
    await writeFile(join(owned, "SKILL.md"), "my own ship skill\n");
    await removeLegacy(proj, scope);
    expect(await readFile(join(owned, "SKILL.md"), "utf8")).toBe("my own ship skill\n");
  });
});
