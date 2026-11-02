import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderForCopy } from "../integrations/skill-render.js";
import { cmdInstall, cmdUninstall, MANAGED_SKILLS, MANAGED_AGENTS } from "../integrations/install.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

const ROOT = "/tmp/target/.agents/skills";
const PLUGIN_VAR = "${CLAUDE_PLUGIN_ROOT}";

describe("renderForCopy", () => {
  it("rewrites a Skill dispatch to the kf-<name> copy", () => {
    expect(renderForCopy("run Skill(kf:plan) now", ROOT)).toBe("run Skill(kf-plan) now");
  });

  it("rewrites a slash command to the kf-<name> copy name", () => {
    expect(renderForCopy("type /kf:implement to continue", ROOT)).toBe("type kf-implement to continue");
  });

  it("points a plugin skill path at the copy dir", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/skills/flow/references/harness-tools.md`, ROOT)).toBe(`${ROOT}/kf-flow/references/harness-tools.md`);
  });

  it("points the plugin agents dir at kf-flow/agents inside the copy dir", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/agents/scout.md`, ROOT)).toBe(`${ROOT}/kf-flow/agents/scout.md`);
    expect(renderForCopy(`bodies at ${PLUGIN_VAR}/agents`, ROOT)).toBe(`bodies at ${ROOT}/kf-flow/agents`);
  });

  it("turns an Agent dispatch into an instruction to paste the agent body", () => {
    const out = renderForCopy("dispatch Agent(kf:scout) with the brief", ROOT);
    expect(out).toContain(`${ROOT}/kf-flow/agents/scout.md`);
    expect(out).toMatch(/paste/i);
    expect(out).not.toContain("Agent(kf:");
    expect(out.startsWith("dispatch ")).toBe(true);
    expect(out.endsWith(" with the brief")).toBe(true);
  });

  it("points any other plugin-root path at the package root", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/kanban-flow/review/rules`, ROOT)).toBe(`${PKG_ROOT}/kanban-flow/review/rules`);
  });

  it("leaves text without plugin patterns unchanged", () => {
    const text = "# Title\n\nPlain prose with `code`, a kf: mention in passing and a path /usr/kf/bin.\n";
    expect(renderForCopy(text, ROOT)).toBe(text);
  });

  it("never leaves the plugin root variable in its output", () => {
    const text = [`${PLUGIN_VAR}/skills/a/b.md`, `${PLUGIN_VAR}/agents`, `${PLUGIN_VAR}/other-dir/x`, `${PLUGIN_VAR}/other/y`].join("\n");
    expect(renderForCopy(text, ROOT)).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("is idempotent on its own output", () => {
    const text = `Skill(kf:plan) /kf:review Agent(kf:developer) ${PLUGIN_VAR}/skills/flow/SKILL.md ${PLUGIN_VAR}/agents ${PLUGIN_VAR}/kanban-flow/review/rules`;
    const once = renderForCopy(text, ROOT);
    expect(renderForCopy(once, ROOT)).toBe(once);
  });

  it("renders every shipped skill and agent body without a plugin root or a kf: dispatch", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".md")) files.push(p);
      }
    };
    walk(join(PKG_ROOT, "skills"));
    walk(join(PKG_ROOT, "agents"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const out = renderForCopy(readFileSync(f, "utf8"), ROOT);
      expect(out, f).not.toContain("CLAUDE_PLUGIN_ROOT");
      expect(out, f).not.toMatch(/Skill\(kf:|Agent\(kf:|\/kf:[a-z]/);
    }
  });
});

describe("shared kf-* copies for the other runtimes", () => {
  let dir: string;
  const home = () => process.env.HOME!;
  const shared = () => join(dir, ".agents", "skills");

  async function project(agents: string[]): Promise<void> {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", agents }));
  }
  const kfDirs = async (skills: string): Promise<string[]> =>
    existsSync(skills) ? (await readdir(skills)).filter((n) => n.startsWith("kf-")).sort() : [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-render-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes one rendered kf-* dir per managed skill into .agents/skills for codex and gemini together", async () => {
    await project(["codex", "gemini"]);
    const res = await cmdInstall(["codex", "gemini"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(await kfDirs(shared())).toEqual(MANAGED_SKILLS.map((n) => `kf-${n}`).sort());
    for (const n of MANAGED_SKILLS) {
      const skillMd = join(shared(), `kf-${n}`, "SKILL.md");
      expect(lstatSync(join(shared(), `kf-${n}`)).isSymbolicLink(), n).toBe(false);
      expect(lstatSync(skillMd).isSymbolicLink(), n).toBe(false);
      expect(readFileSync(skillMd, "utf8"), n).not.toContain("CLAUDE_PLUGIN_ROOT");
    }
    expect(existsSync(join(dir, ".gemini", "skills"))).toBe(false);
    const manifest = JSON.parse(await readFile(join(shared(), ".kanban-flow-skills.json"), "utf8")) as Record<string, string>;
    for (const n of MANAGED_SKILLS) expect(Object.keys(manifest), n).toContain(`kf-${n}`);
  });

  it("copies the rendered agent bodies into kf-flow/agents", async () => {
    await project(["codex"]);
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    const agentFiles = (await readdir(join(shared(), "kf-flow", "agents"))).sort();
    expect(agentFiles).toEqual(MANAGED_AGENTS.map((a) => `${a}.md`).sort());
    expect(agentFiles).toHaveLength(7);
    for (const f of agentFiles) expect(await readFile(join(shared(), "kf-flow", "agents", f), "utf8"), f).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("gives kiro its own copy in .kiro/skills", async () => {
    await project(["kiro"]);
    const res = await cmdInstall(["kiro"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(await kfDirs(join(dir, ".kiro", "skills"))).toEqual(MANAGED_SKILLS.map((n) => `kf-${n}`).sort());
    expect(existsSync(join(shared(), "kf-flow"))).toBe(false);
  });

  it("keeps a foreign kf-plan, reports it, and still installs the other copies", async () => {
    await project(["codex"]);
    await mkdir(shared(), { recursive: true });
    await writeFile(join(shared(), "kf-plan"), "my own file\n");
    const res = await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    expect(await readFile(join(shared(), "kf-plan"), "utf8")).toBe("my own file\n");
    expect(res.stdout).toContain("kf-plan");
    expect(res.stdout).toContain("left untouched");
    expect(existsSync(join(shared(), "kf-flow", "SKILL.md"))).toBe(true);
  });

  it("lists the runtimes that read the shared dir in the also-picked-up note", async () => {
    await project(["codex", "gemini"]);
    const res = await cmdInstall(["codex", "gemini"], { cwd: dir, scope: "project" });
    const line = res.stdout.split("\n").find((l) => l.includes("Also picked up by")) ?? "";
    for (const id of ["cursor", "opencode", "devin"]) expect(line, id).toContain(id);
  });

  it("writes ~/.agents/skills at global scope", async () => {
    const res = await cmdInstall(["codex"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    const names = await kfDirs(join(home(), ".agents", "skills"));
    expect(names).toEqual(MANAGED_SKILLS.map((n) => `kf-${n}`).sort());
    expect(lstatSync(join(home(), ".agents", "skills", "kf-flow", "SKILL.md")).isSymbolicLink()).toBe(false);
  });

  it("keeps the shared copy on uninstalling one runtime while another declared runtime still reads it", async () => {
    await project(["codex", "gemini"]);
    await cmdInstall(["codex", "gemini"], { cwd: dir, scope: "project" });
    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/gemini/i);
    expect(await kfDirs(shared())).toEqual(MANAGED_SKILLS.map((n) => `kf-${n}`).sort());
  });

  it("removes the shared copy when every runtime reading it is uninstalled", async () => {
    await project(["codex", "gemini"]);
    await cmdInstall(["codex", "gemini"], { cwd: dir, scope: "project" });
    expect(await kfDirs(shared())).toHaveLength(MANAGED_SKILLS.length);
    const res = await cmdUninstall(["codex", "gemini"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(await kfDirs(shared())).toEqual([]);
  });
});
