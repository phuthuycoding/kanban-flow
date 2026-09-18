import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copySkillsTo, removeSkillsFrom, MANAGED_SKILLS } from "../integrations/install.js";
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
