import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir, writeFile, readFile, symlink } from "node:fs/promises";
import { existsSync, lstatSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copySkillsTo, removeSkillsFrom, removeRetiredSkills, MANAGED_SKILLS, RETIRED_SKILLS, cmdInstall, cmdUninstall } from "../integrations/install.js";
import { parseAgentIds, DEFAULT_AGENT, projectSkillsDir, agentById } from "../integrations/agents.js";
import type { Stage } from "../workflow/schema.js";

/** Skill a worker loads for each stage; backlog has no work to hand off. */
const STAGE_SKILL: Record<Stage, string | null> = {
  brainstorm: "kanban-brainstorm",
  planning: "kanban-plan",
  backlog: null,
  implementation: "kanban-implement",
  testing: "kanban-test",
  review: "kanban-review",
  done: "kanban-archive",
  cancelled: null,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-skill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("managed skills", () => {
  it("no longer installs a ship stage skill and maps the done stage to the archive skill", () => {
    expect(MANAGED_SKILLS).not.toContain("kanban-ship");
    expect(STAGE_SKILL.done).toBe("kanban-archive");
    for (const skill of Object.values(STAGE_SKILL)) if (skill) expect(MANAGED_SKILLS).toContain(skill);
  });

  it("manages the eight kanban skills plus travel and lists kanban-ship as retired", () => {
    expect(MANAGED_SKILLS).toHaveLength(9);
    expect(MANAGED_SKILLS).toContain("travel");
    expect(RETIRED_SKILLS).toEqual(["kanban-ship"]);
  });

  it.skipIf(process.platform === "win32")("keeps the executable bit of travel's estimates script when copying", async () => {
    await copySkillsTo(dir);
    const script = join(dir, "travel", "scripts", "estimates");
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, "travel", "references"))).toBe(true);
  });
});

describe("retired skills", () => {
  it.skipIf(process.platform === "win32")("removes a kanban-ship symlink that points into a kanban-flow package", async () => {
    const pkg = join(dir, "pkg", "kanban-flow", "skills", "kanban-ship");
    await mkdir(pkg, { recursive: true });
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(pkg, join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: ["kanban-ship"], kept: [] });
    expect(() => lstatSync(join(skills, "kanban-ship"))).toThrow();
    expect(existsSync(pkg)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("removes a dangling kanban-ship symlink whose target ends in kanban-flow/skills/kanban-ship", async () => {
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(join(dir, "gone", "kanban-flow", "skills", "kanban-ship"), join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res.removed).toEqual(["kanban-ship"]);
    expect(() => lstatSync(join(skills, "kanban-ship"))).toThrow();
  });

  it("leaves a foreign kanban-ship directory untouched and warns on install", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const foreign = join(dir, ".claude", "skills", "kanban-ship");
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, "SKILL.md"), "mine");

    const res = await cmdInstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kanban-ship");
    expect(res.stdout).toContain("left untouched");
    expect(await readFile(join(foreign, "SKILL.md"), "utf8")).toBe("mine");
  });

  it.skipIf(process.platform === "win32")("leaves a symlink to somewhere else untouched", async () => {
    const elsewhere = join(dir, "other", "kanban-ship");
    await mkdir(elsewhere, { recursive: true });
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(elsewhere, join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: [], kept: ["kanban-ship"] });
    expect(lstatSync(join(skills, "kanban-ship")).isSymbolicLink()).toBe(true);
  });
});

describe("copySkillsTo / removeSkillsFrom", () => {
  it("copies all managed skills into the target skill dir", async () => {
    const res = await copySkillsTo(dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`→ ${dir}/`);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(MANAGED_SKILLS));
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, name, "SKILL.md"))).toBe(true);
    }
  });

  it("removes the managed skills, leaving unrelated dirs intact", async () => {
    await copySkillsTo(dir);
    await mkdir(join(dir, "unrelated"), { recursive: true });

    const { removed } = await removeSkillsFrom(dir);
    expect(removed).toHaveLength(MANAGED_SKILLS.length);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, name))).toBe(false);
    }
    expect(existsSync(join(dir, "unrelated"))).toBe(true);
  });

  it("reports empty removal when nothing is installed", async () => {
    const { removed } = await removeSkillsFrom(dir);
    expect(removed).toHaveLength(0);
  });
});

describe("install/uninstall (project scope)", () => {
  it("cmdInstall copies skills into {root}/.claude/skills", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(join(dir, ".claude", "skills"));
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".claude", "skills", name, "SKILL.md"))).toBe(true);
    }
  });

  it("cmdInstall refuses outside a kanban project", async () => {
    const res = await cmdInstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("kf init");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("cmdUninstall removes project-level skills, leaving unrelated dirs intact", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    await mkdir(join(dir, ".claude", "skills", "unrelated"), { recursive: true });

    const res = await cmdUninstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`removed ${MANAGED_SKILLS.length} skills`);
    expect(existsSync(join(dir, ".claude", "skills", "unrelated"))).toBe(true);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".claude", "skills", name))).toBe(false);
    }
  });

  it("install resolves the .works root, not the current subdirectory", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const nested = join(dir, "services", "api");
    await mkdir(nested, { recursive: true });

    await cmdInstall([], { cwd: nested, scope: "project" });
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(nested, ".claude", "skills"))).toBe(false);
  });

  it("cmdInstall with multiple agents installs each agent dir", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall(["claude", "codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
  });

  it("uninstall --purge --force removes skills plus .works/, .kf/ and kanban doc dirs", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    await mkdir(join(dir, ".works", "done", "x"), { recursive: true });
    await mkdir(join(dir, ".kf", "review", "rules"), { recursive: true });
    await mkdir(join(dir, "docs", "requirement"), { recursive: true });
    await mkdir(join(dir, "docs", "notes"), { recursive: true });

    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Purged project data");
    expect(existsSync(join(dir, ".works"))).toBe(false);
    expect(existsSync(join(dir, ".kf"))).toBe(false);
    expect(existsSync(join(dir, "docs", "requirement"))).toBe(false);
    expect(existsSync(join(dir, "docs", "notes"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow"))).toBe(false);
  });

  it("uninstall --purge without --force refuses on non-TTY and deletes nothing", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });

    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--force");
    expect(existsSync(join(dir, ".works"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow"))).toBe(true);
  });

  it("says the .gitignore line is still there, and does not touch the file", async () => {
    // kf init can add `.works/` to .gitignore. Purge leaves it on purpose — it is the user's
    // file — but a command claiming to have purged the project data has to say what it left,
    // or the line only surfaces later when some unrelated .works/ is quietly ignored.
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    const gitignore = join(dir, ".gitignore");
    const before = "node_modules/\n\n# kanban-flow\n.works/\n";
    await writeFile(gitignore, before);

    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.stdout).toContain(".gitignore still ignores .works/");
    expect(await readFile(gitignore, "utf8"), "the file must come out byte-identical").toBe(before);
  });

  it("stays quiet when .gitignore does not mention .works/", async () => {
    // The notice is only worth anything because its absence means something.
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    await writeFile(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("stays quiet when there is no .gitignore at all", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("does not mention .gitignore when uninstalling without --purge", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    await writeFile(join(dir, ".gitignore"), "# kanban-flow\n.works/\n");
    const res = await cmdUninstall([], { cwd: dir, scope: "project" });
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("uninstall --purge --force reports when there is no project data", async () => {
    const res = await cmdUninstall([], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No project data");
  });
});

describe("agents adapter", () => {
  it("defaults to claude", () => {
    expect(DEFAULT_AGENT).toBe("claude");
  });

  it("maps each agent to its project skill dir", () => {
    expect(projectSkillsDir(agentById("claude")!, dir)).toBe(join(dir, ".claude", "skills"));
    expect(projectSkillsDir(agentById("codex")!, dir)).toBe(join(dir, ".agents", "skills"));
    expect(projectSkillsDir(agentById("kiro")!, dir)).toBe(join(dir, ".kiro", "skills"));
    expect(projectSkillsDir(agentById("opencode")!, dir)).toBe(join(dir, ".opencode", "skills"));
    expect(projectSkillsDir(agentById("devin")!, dir)).toBe(join(dir, ".devin", "skills"));
  });

  it("parseAgentIds de-dupes and rejects unknown ids", () => {
    expect(parseAgentIds(["claude", "claude"])).toEqual(["claude"]);
    expect(() => parseAgentIds(["claude", "bogus"])).toThrow("Unknown agent 'bogus'");
    expect(parseAgentIds(undefined)).toEqual([]);
    expect(parseAgentIds(["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});
