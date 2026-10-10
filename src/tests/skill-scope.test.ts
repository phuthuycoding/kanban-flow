import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cmdInstall,
  cmdUninstall,
  copySkillsTo,
  linkOrCopySkillsTo,
  removeSkillsFrom,
  scopeFromArgs,
  agentSkillsState,
  skillEntryState,
  MANAGED_SKILLS,
} from "../integrations/install.js";
import { agentById, userSkillsDir } from "../integrations/agents.js";
import { readProjectConfig, effectiveSkillsScope } from "../project/config.js";
import { askAll, bootstrapDefaults, saveConfig } from "../project/bootstrap.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { runDoctor, applyDoctorFixes } from "../project/doctor.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

const PKG_SKILLS = join(PKG_ROOT, "skills");

let dir: string;
const home = () => process.env.HOME!;
const homeSkills = () => join(home(), ".claude", "skills");
const projectSkills = () => join(dir, ".claude", "skills");

/** `kf init --minimal` shape without the install noise. */
async function project(): Promise<void> {
  ensureWorksStructure(dir);
  await mkdir(join(dir, ".kf"), { recursive: true });
  await writeFile(
    join(dir, ".kf", "config.json"),
    JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"] }),
  );
}

/** Recursive file → sha1 map of a directory. */
function snapshot(root: string, base = root, out: Record<string, string> = {}): Record<string, string> {
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, e.name);
    if (e.isDirectory()) snapshot(p, base, out);
    else out[p.slice(base.length)] = createHash("sha1").update(readFileSync(p)).digest("hex");
  }
  return out;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-scope-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("userRel / userSkillsDir (FR-001)", () => {
  it("resolves each agent's documented user-level dir", () => {
    expect(userSkillsDir(agentById("claude")!, "/h")).toBe("/h/.claude/skills");
    expect(userSkillsDir(agentById("codex")!, "/h")).toBe("/h/.agents/skills");
    expect(userSkillsDir(agentById("opencode")!, "/h")).toBe("/h/.config/opencode/skills");
    expect(userSkillsDir(agentById("kiro")!, "/h")).toBe("/h/.kiro/skills");
    expect(userSkillsDir(agentById("devin")!, "/h")).toBe("/h/.agents/skills");
  });
});

describe("config skills.scope (FR-002)", () => {
  it("defaults to global when absent", async () => {
    expect(effectiveSkillsScope(readProjectConfig(dir))).toBe("global");
    expect(effectiveSkillsScope({})).toBe("global");
  });

  it("reads a declared scope and rejects a bad one", async () => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", skills: { scope: "project" } }));
    expect(effectiveSkillsScope(readProjectConfig(dir))).toBe("project");
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", skills: { scope: "banana" } }));
    expect(() => readProjectConfig(dir)).toThrow(/skills\.scope must be "global" or "project"/);
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", skills: "global" }));
    expect(() => readProjectConfig(dir)).toThrow(/skills\.scope/);
  });
});

describe("scopeFromArgs (FR-003, FR-008)", () => {
  it("parses --scope and the shorthand flags", () => {
    expect(scopeFromArgs({})).toBeUndefined();
    expect(scopeFromArgs({ scope: "global" })).toBe("global");
    expect(scopeFromArgs({ scope: "project" })).toBe("project");
    expect(scopeFromArgs({ global: true })).toBe("global");
    expect(scopeFromArgs({ project: true })).toBe("project");
  });

  it("rejects bad values and conflicting flags", () => {
    expect(() => scopeFromArgs({ scope: "banana" })).toThrow(/--scope must be/);
    expect(() => scopeFromArgs({ global: true, project: true })).toThrow(/cannot be combined/);
    expect(() => scopeFromArgs({ scope: "global", project: true })).toThrow(/conflicts/);
  });
});

describe("link-or-copy install (FR-001)", () => {
  it("links each managed skill into the target dir", async () => {
    const res = await linkOrCopySkillsTo(homeSkills());
    expect(res.code).toBe(0);
    expect(res.mode).toBe("link");
    for (const name of MANAGED_SKILLS) {
      const entry = join(homeSkills(), name);
      expect(lstatSync(entry).isSymbolicLink(), name).toBe(true);
      expect(existsSync(join(entry, "SKILL.md")), `${name} resolves`).toBe(true);
    }
    expect(agentSkillsState(homeSkills())).toBe("linked");
  });

  it("removes links without touching the packaged targets", async () => {
    await linkOrCopySkillsTo(homeSkills());
    const before = snapshot(PKG_SKILLS);
    const { removed } = await removeSkillsFrom(homeSkills());
    expect(removed).toHaveLength(MANAGED_SKILLS.length);
    expect(readdirSync(homeSkills())).toEqual([]);
    expect(snapshot(PKG_SKILLS), "package must be byte-identical after unlinking").toEqual(before);
  });
});

describe("install global cleans project copies (UC-003)", () => {
  it("installs ~ links and removes managed project copies, keeping unrelated skills", async () => {
    await project();
    await copySkillsTo(projectSkills());
    await mkdir(join(projectSkills(), "unrelated"), { recursive: true });

    const res = await cmdInstall([], { cwd: dir });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("(global)");
    for (const name of MANAGED_SKILLS) {
      expect(lstatSync(join(homeSkills(), name)).isSymbolicLink(), name).toBe(true);
      expect(existsSync(join(projectSkills(), name)), `${name} cleaned`).toBe(false);
    }
    expect(existsSync(join(projectSkills(), "unrelated"))).toBe(true);
    expect(res.stdout).toContain("Cleaned project copies");
  });

  it("keeps project copies when the config declared scope project (TC-008)", async () => {
    await project();
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"], skills: { scope: "project" } }),
    );
    await copySkillsTo(projectSkills());

    const res = await cmdInstall([], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(projectSkills(), name, "SKILL.md")), `${name} kept`).toBe(true);
    }
    expect(res.stdout).toContain('both scopes may now hold skills');
  });

  it("works outside a .works project, touching only ~ dirs (TC-009)", async () => {
    const res = await cmdInstall([], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(lstatSync(join(homeSkills(), "kanban-flow")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("leaves the package byte-identical after an install+uninstall cycle (TC-010)", async () => {
    const before = snapshot(PKG_SKILLS);
    await cmdInstall([], { cwd: dir, scope: "global" });
    await cmdUninstall([], { cwd: dir, scope: "global" });
    expect(snapshot(PKG_SKILLS)).toEqual(before);
    expect(existsSync(join(homeSkills(), "kanban-flow"))).toBe(false);
  });
});

describe("install project leaves global untouched (UC-004)", () => {
  it("copies into the project dir without modifying ~ entries (TC-011)", async () => {
    await project();
    await linkOrCopySkillsTo(homeSkills());
    const res = await cmdInstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    for (const name of MANAGED_SKILLS) {
      const entry = join(projectSkills(), name);
      expect(lstatSync(entry).isDirectory() && !lstatSync(entry).isSymbolicLink(), name).toBe(true);
      expect(lstatSync(join(homeSkills(), name)).isSymbolicLink(), `~ ${name}`).toBe(true);
    }
  });

  it("honors skills.scope: project on a bare install", async () => {
    await project();
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"], skills: { scope: "project" } }),
    );
    const res = await cmdInstall([], { cwd: dir });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("(project)");
    expect(existsSync(join(projectSkills(), "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(homeSkills(), "kanban-flow"))).toBe(false);
  });

  it("refuses --scope project outside .works (TC-012)", async () => {
    const res = await cmdInstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(1);
    expect(res.stderr).toBe("not a kanban project");
  });
});

describe("uninstall by scope (UC-005)", () => {
  it("removes ~ entries only and warns they are shared (TC-013)", async () => {
    await project();
    await linkOrCopySkillsTo(homeSkills());
    await copySkillsTo(projectSkills());

    const res = await cmdUninstall([], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("shared by every project");
    expect(existsSync(join(homeSkills(), "kanban-flow"))).toBe(false);
    expect(existsSync(join(projectSkills(), "kanban-flow", "SKILL.md"))).toBe(true);
  });

  it("removes project copies only, ~ links survive (TC-014)", async () => {
    await project();
    await linkOrCopySkillsTo(homeSkills());
    await copySkillsTo(projectSkills());

    const res = await cmdUninstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(existsSync(join(projectSkills(), "kanban-flow"))).toBe(false);
    expect(existsSync(join(homeSkills(), "kanban-flow", "SKILL.md"))).toBe(true);
  });

  it("works outside .works and is idempotent (TC-015)", async () => {
    await linkOrCopySkillsTo(homeSkills());
    const first = await cmdUninstall([], { cwd: dir, scope: "global" });
    expect(first.code).toBe(0);
    expect(existsSync(join(homeSkills(), "kanban-flow"))).toBe(false);
    const second = await cmdUninstall([], { cwd: dir, scope: "global" });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already clean");
  });
});

describe("init at effective scope (FR-005)", () => {
  it("kf init --defaults links skills into ~ and writes none to the project (TC-001)", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), dir);
    expect(res.code).toBe(0);
    for (const name of MANAGED_SKILLS) {
      expect(lstatSync(join(homeSkills(), name)).isSymbolicLink(), name).toBe(true);
    }
    expect(existsSync(join(dir, ".claude"))).toBe(false);
    expect(readProjectConfig(dir).skills?.scope).toBe("global");
  });

  it("kf init --minimal respects a configured skills.scope: project (TC-003)", async () => {
    await project();
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"], skills: { scope: "project" } }),
    );
    const res = await cmdInit(args("init", [], { minimal: true }), dir);
    expect(res.code).toBe(0);
    expect(existsSync(join(projectSkills(), "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(homeSkills(), "kanban-flow"))).toBe(false);
  });
});

describe("onboarding asks scope (UC-002)", () => {
  const stubRl = (answers: Record<string, string>) => ({
    question: async (prompt: string): Promise<string> => {
      for (const [key, ans] of Object.entries(answers)) if (prompt.includes(key)) return ans;
      return "";
    },
  });

  it('defaults to global and persists "project" when answered (TC-004, TC-005)', async () => {
    const d = bootstrapDefaults(dir);
    expect(d.skillScope).toBe("global");

    const a = await askAll(stubRl({ globally: "n" }) as never, dir);
    expect(a.skillScope).toBe("project");

    await project();
    saveConfig(dir, a);
    expect(readProjectConfig(dir).skills?.scope).toBe("project");
  });

  it("keeps the configured scope as the question's default (TC-005)", async () => {
    await project();
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", skills: { scope: "project" } }),
    );
    const a = await askAll(stubRl({}) as never, dir);
    expect(a.skillScope).toBe("project");
  });
});

describe("status reporting (UC-006)", () => {
  it("autoconfig prints the effective scope and per-agent status (TC-016)", async () => {
    await project();
    const parsed = args("autoconfig");
    let res = await cmdAutoconfig(parsed, dir);
    expect(res.stdout).toContain("scope: global");
    expect(res.stdout).toContain("— missing");

    await cmdInstall([], { cwd: dir });
    res = await cmdAutoconfig(parsed, dir);
    expect(res.stdout).toContain("Skills for Claude Code (scope: global");
    expect(res.stdout).toContain("— linked");
    expect(res.stdout).toContain("[x] No duplicate project-scope copies");
  });

  it("flags a content-mutated copy as stale and restores it on install (TC-017)", async () => {
    await project();
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"], skills: { scope: "project" } }),
    );
    await copySkillsTo(projectSkills());
    await writeFile(join(projectSkills(), "kanban-plan", "SKILL.md"), "tampered", "utf8");

    expect(agentSkillsState(projectSkills())).toBe("stale");
    const res = await cmdAutoconfig(args("autoconfig"), dir);
    expect(res.stdout).toContain("— stale");

    await cmdInstall([], { cwd: dir });
    expect(agentSkillsState(projectSkills())).toBe("copied");
    expect(readFileSync(join(projectSkills(), "kanban-plan", "SKILL.md"), "utf8")).toContain("kanban-plan");
  });

  it("reports a dangling link as broken and doctor --fix recreates it (TC-018)", async () => {
    await project();
    await mkdir(homeSkills(), { recursive: true });
    for (const name of MANAGED_SKILLS) {
      if (name === "kanban-flow") {
        await symlink(join(dir, "gone-target"), join(homeSkills(), name));
      } else {
        await symlink(join(PKG_SKILLS, name), join(homeSkills(), name));
      }
    }
    expect(skillEntryState(homeSkills(), "kanban-flow")).toBe("broken-link");
    expect(agentSkillsState(homeSkills())).toBe("broken-link");

    const finding = runDoctor(dir).findings.find((f) => f.area.includes("skills"));
    expect(finding?.message).toContain("broken-link");

    await applyDoctorFixes(dir);
    expect(skillEntryState(homeSkills(), "kanban-flow")).toBe("linked");
    expect(runDoctor(dir).findings.filter((f) => f.area.includes("skills"))).toEqual([]);
  });

  it("flags duplicate project copies when scope is global (TC-019)", async () => {
    await project();
    await linkOrCopySkillsTo(homeSkills());
    await copySkillsTo(projectSkills());

    const doctorFinding = runDoctor(dir).findings.find((f) => f.message.includes("shadow"));
    expect(doctorFinding?.level).toBe("WARNING");
    const res = await cmdAutoconfig(args("autoconfig"), dir);
    expect(res.stdout).toContain("Duplicate project-scope copies");

    await cmdInstall([], { cwd: dir });
    expect(existsSync(join(projectSkills(), "kanban-flow"))).toBe(false);
  });

  it("doctor reports missing at the effective scope and fixes it (TC-020)", async () => {
    await project();
    const before = runDoctor(dir);
    expect(before.ok).toBe(false);
    expect(before.findings.some((f) => f.area.includes("skills") && f.message.includes("missing"))).toBe(true);

    const fixed = await applyDoctorFixes(dir);
    expect(fixed.some((l) => l.includes("installed kanban skills for claude"))).toBe(true);
    expect(runDoctor(dir).findings.filter((f) => f.area.includes("skills"))).toEqual([]);
  });
});
