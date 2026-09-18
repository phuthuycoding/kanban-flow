import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copySkillsTo, removeSkillsFrom, MANAGED_SKILLS, cmdInstall, cmdUninstall } from "../integrations/install.js";
import { parseAgentIds, DEFAULT_AGENT, userSkillsDir, projectSkillsDir, agentById } from "../integrations/agents.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-skill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
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

describe("install/uninstall scopes", () => {
  it("cmdInstall --project copies skills into {root}/.claude/skills, not the user dir", async () => {
    const res = await cmdInstall([], { cwd: dir, project: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(join(dir, ".claude", "skills"));
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".claude", "skills", name, "SKILL.md"))).toBe(true);
    }
  });

  it("cmdUninstall --project removes project-level skills, leaving unrelated dirs intact", async () => {
    await cmdInstall([], { cwd: dir, project: true });
    await mkdir(join(dir, ".claude", "skills", "unrelated"), { recursive: true });

    const res = await cmdUninstall([], { cwd: dir, project: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`removed ${MANAGED_SKILLS.length} skills`);
    expect(existsSync(join(dir, ".claude", "skills", "unrelated"))).toBe(true);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".claude", "skills", name))).toBe(false);
    }
  });

  it("project scope resolves the .works root, not the current subdirectory", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const nested = join(dir, "services", "api");
    await mkdir(nested, { recursive: true });

    await cmdInstall([], { cwd: nested, project: true });
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(nested, ".claude", "skills"))).toBe(false);
  });

  it("cmdInstall --project with multiple agents installs each agent dir", async () => {
    const res = await cmdInstall(["claude", "codex"], { cwd: dir, project: true });
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
  });

  it("uninstall --purge --force removes skills plus .works/, .kf/ and kanban doc dirs", async () => {
    await cmdInstall([], { cwd: dir, project: true });
    await mkdir(join(dir, ".works", "dones", "x"), { recursive: true });
    await mkdir(join(dir, ".kf", "review", "rules"), { recursive: true });
    await mkdir(join(dir, "docs", "requirement"), { recursive: true });
    await mkdir(join(dir, "docs", "notes"), { recursive: true });

    const res = await cmdUninstall([], { cwd: dir, purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Purged project data");
    expect(existsSync(join(dir, ".works"))).toBe(false);
    expect(existsSync(join(dir, ".kf"))).toBe(false);
    expect(existsSync(join(dir, "docs", "requirement"))).toBe(false);
    expect(existsSync(join(dir, "docs", "notes"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow"))).toBe(false);
  });

  it("uninstall --purge without --force refuses on non-TTY and deletes nothing", async () => {
    await cmdInstall([], { cwd: dir, project: true });
    await mkdir(join(dir, ".works"), { recursive: true });

    const res = await cmdUninstall([], { cwd: dir, purge: true });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--force");
    expect(existsSync(join(dir, ".works"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills", "kanban-flow"))).toBe(true);
  });

  it("uninstall --purge --force reports when there is no project data", async () => {
    const res = await cmdUninstall([], { cwd: dir, purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No project data");
  });
});

describe("agents adapter", () => {
  it("defaults to claude", () => {
    expect(DEFAULT_AGENT).toBe("claude");
  });

  it("maps each agent to its user and project skill dirs", () => {
    expect(userSkillsDir(agentById("claude")!)).toMatch(/\.claude\/skills$/);
    expect(userSkillsDir(agentById("codex")!)).toMatch(/\.agents\/skills$/);
    expect(projectSkillsDir(agentById("kiro")!, dir)).toBe(join(dir, ".kiro", "skills"));
    expect(projectSkillsDir(agentById("opencode")!, dir)).toBe(join(dir, ".opencode", "skills"));
  });

  it("parseAgentIds de-dupes and rejects unknown ids", () => {
    expect(parseAgentIds(["claude", "claude"])).toEqual(["claude"]);
    expect(() => parseAgentIds(["claude", "bogus"])).toThrow("Unknown agent 'bogus'");
    expect(parseAgentIds(undefined)).toEqual([]);
    expect(parseAgentIds(["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});
