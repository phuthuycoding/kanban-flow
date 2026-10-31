import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A private copy of the package, so a test can change what the "next release" ships.
vi.mock("../shared/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared/paths.js")>();
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kfw-pkg-"));
  fs.cpSync(path.join(original.PKG_ROOT, "skills"), path.join(root, "skills"), { recursive: true });
  return { ...original, PKG_ROOT: root };
});

import { PKG_ROOT } from "../shared/paths.js";
import { copySkillsTo, linkOrCopySkillsTo, removeSkillsFrom, removeRetiredSkills, cmdInstall, cmdUninstall, MANAGED_SKILLS } from "../integrations/install.js";

const PKG_TRAVEL = join(PKG_ROOT, "skills", "travel");
let dir: string;
let pkgTravelSkill: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-own-"));
  pkgTravelSkill = await readFile(join(PKG_TRAVEL, "SKILL.md"), "utf8");
});
afterEach(async () => {
  await writeFile(join(PKG_TRAVEL, "SKILL.md"), pkgTravelSkill);
  await rm(dir, { recursive: true, force: true });
});

async function foreignTravel(skillsDir: string): Promise<string> {
  const travel = join(skillsDir, "travel");
  await mkdir(travel, { recursive: true });
  await writeFile(join(travel, "SKILL.md"), "---\nname: travel\n---\nmy trip planner\n");
  return travel;
}

describe("a user's own travel skill", () => {
  it("is left untouched by a project copy, which still installs the other skills and warns", async () => {
    const travel = await foreignTravel(dir);
    const res = await copySkillsTo(dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("travel");
    expect(await readFile(join(travel, "SKILL.md"), "utf8")).toContain("my trip planner");
    for (const name of MANAGED_SKILLS.filter((n) => n !== "travel")) expect(existsSync(join(dir, name, "SKILL.md"))).toBe(true);
  });

  it("is left untouched by a global link install", async () => {
    const travel = await foreignTravel(dir);
    const res = await linkOrCopySkillsTo(dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("left untouched");
    expect(lstatSync(travel).isSymbolicLink()).toBe(false);
    expect(await readFile(join(travel, "SKILL.md"), "utf8")).toContain("my trip planner");
  });

  it.skipIf(process.platform === "win32")("is a link to somewhere else and is not replaced or removed", async () => {
    const elsewhere = join(dir, "mine", "travel");
    await mkdir(elsewhere, { recursive: true });
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(elsewhere, join(skills, "travel"), "dir");

    await linkOrCopySkillsTo(skills);
    expect(lstatSync(join(skills, "travel")).isSymbolicLink()).toBe(true);
    const { removed, kept } = await removeSkillsFrom(skills);
    expect(kept).toEqual(["travel"]);
    expect(removed).not.toContain("travel");
    expect(lstatSync(join(skills, "travel")).isSymbolicLink()).toBe(true);
  });

  it("survives uninstall, which names it as kept", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const travel = await foreignTravel(join(dir, ".claude", "skills"));
    const res = await cmdUninstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kept travel");
    expect(await readFile(join(travel, "SKILL.md"), "utf8")).toContain("my trip planner");
  });

  it("survives the project cleanup a global install runs", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const projectSkills = join(dir, ".claude", "skills");
    await copySkillsTo(projectSkills);
    await rm(join(projectSkills, "travel"), { recursive: true, force: true });
    const travel = await foreignTravel(projectSkills);

    const res = await cmdInstall([], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kept travel");
    expect(existsSync(join(projectSkills, "kanban-flow"))).toBe(false);
    expect(await readFile(join(travel, "SKILL.md"), "utf8")).toContain("my trip planner");
  });
});

describe("kanban-flow's own travel entry", () => {
  it("is replaced on re-install and removed on uninstall when it is an unchanged copy", async () => {
    await copySkillsTo(dir);
    const again = await copySkillsTo(dir);
    expect(again.stdout).not.toContain("left untouched");
    const { removed, kept } = await removeSkillsFrom(dir);
    expect(removed).toContain("travel");
    expect(kept).toEqual([]);
    expect(existsSync(join(dir, "travel"))).toBe(false);
    expect(existsSync(join(dir, ".kanban-flow-skills.json"))).toBe(false);
  });

  it("is still recognised after the package's travel changes, so an upgrade replaces the older copy", async () => {
    await copySkillsTo(dir);
    await writeFile(join(PKG_TRAVEL, "SKILL.md"), `${pkgTravelSkill}\nnext release\n`);

    const res = await copySkillsTo(dir);
    expect(res.stdout).not.toContain("left untouched");
    expect(await readFile(join(dir, "travel", "SKILL.md"), "utf8")).toContain("next release");
  });

  it("is kept once the user edits the copy", async () => {
    await copySkillsTo(dir);
    await writeFile(join(dir, "travel", "SKILL.md"), "edited by me");
    const res = await copySkillsTo(dir);
    expect(res.stdout).toContain("left untouched");
    expect(await readFile(join(dir, "travel", "SKILL.md"), "utf8")).toBe("edited by me");
  });

  it.skipIf(process.platform === "win32")("is replaced when it is a link into the package", async () => {
    await symlink(PKG_TRAVEL, join(dir, "travel"), "dir");
    const res = await copySkillsTo(dir);
    expect(res.stdout).not.toContain("left untouched");
    expect(lstatSync(join(dir, "travel")).isDirectory()).toBe(true);
    expect(existsSync(join(PKG_TRAVEL, "SKILL.md"))).toBe(true);
  });
});

/** The kanban-ship SKILL.md v0.12.0 and v0.13.0 shipped, byte for byte (git show v0.13.0:skills/kanban-ship/SKILL.md). */
const RELEASED_KANBAN_SHIP = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kanban-ship-0.13.0", "SKILL.md");

describe("a copied kanban-ship from an earlier release", () => {
  let released: string;
  beforeEach(async () => {
    released = await readFile(RELEASED_KANBAN_SHIP, "utf8");
  });

  it("is removed from a skills dir", async () => {
    const ship = join(dir, "kanban-ship");
    await mkdir(ship, { recursive: true });
    await writeFile(join(ship, "SKILL.md"), released);
    const res = await removeRetiredSkills(dir);
    expect(res).toEqual({ removed: ["kanban-ship"], kept: [] });
    expect(existsSync(ship)).toBe(false);
  });

  it("is kept when the user added a file of their own beside it", async () => {
    const ship = join(dir, "kanban-ship");
    await mkdir(ship, { recursive: true });
    await writeFile(join(ship, "SKILL.md"), released);
    await writeFile(join(ship, "notes.md"), "mine");
    const res = await removeRetiredSkills(dir);
    expect(res).toEqual({ removed: [], kept: ["kanban-ship"] });
    expect(existsSync(join(ship, "notes.md"))).toBe(true);
  });

  it("is removed from the project dir when a global install cleans it", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const ship = join(dir, ".claude", "skills", "kanban-ship");
    await mkdir(ship, { recursive: true });
    await writeFile(join(ship, "SKILL.md"), released);
    const res = await cmdInstall([], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("removed retired kanban-ship");
    expect(existsSync(ship)).toBe(false);
  });
});
