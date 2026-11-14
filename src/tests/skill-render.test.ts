import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderAgentForAgy, renderAgySkillMd, renderForAgy, renderForCopy, renderSkillMd, ephemeralPackageWarning } from "../integrations/skill-render.js";
import { cmdInstall, cmdUninstall, MANAGED_SKILLS, MANAGED_AGENTS } from "../integrations/install.js";
import { runDoctor, runDoctorFixes } from "../project/doctor.js";
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

  it("rewrites a bare kf:<skill> hand-off in prose to the kf-<name> copy name", () => {
    expect(renderForCopy("Load the kf:test skill and move the feature to testing.", ROOT)).toBe("Load the kf-test skill and move the feature to testing.");
    expect(renderForCopy("kf:plan, then kf:review.", ROOT)).toBe("kf-plan, then kf-review.");
    expect(renderForCopy("(kf:implement)", ROOT)).toBe("(kf-implement)");
  });

  it("leaves a bare kf:<managed agent> as written, since no copy runtime registers an agent by that name", () => {
    expect(renderForCopy("hand the brief to kf:researcher first", ROOT)).toBe("hand the brief to kf:researcher first");
    expect(renderForCopy("subagent_type: kf:code-reviewer", ROOT)).toBe("subagent_type: kf:code-reviewer");
  });

  it("still rewrites a bare skill name when an agent name sits beside it", () => {
    expect(renderForCopy("kf:test then kf:scout", ROOT)).toBe("kf-test then kf:scout");
  });

  it("leaves kf:<unknown>, a longer name and a prefixed word alone", () => {
    const text = "see kf:nonsense and xkf:test and kf:testing-notes";
    expect(renderForCopy(text, ROOT)).toBe("see kf:nonsense and xkf:test and kf:testing-notes");
  });

  it("points a plugin skill path at the copy dir", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/assets/skills/implement/references/task-loop.md`, ROOT)).toBe(`${ROOT}/kf-implement/references/task-loop.md`);
  });

  it("points the plugin shared dir at kf-flow/shared inside the copy dir", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/assets/shared/harness-tools.md`, ROOT)).toBe(`${ROOT}/kf-flow/shared/harness-tools.md`);
  });

  it("points the plugin agents dir at kf-flow/agents inside the copy dir", () => {
    expect(renderForCopy(`${PLUGIN_VAR}/assets/agents/scout.md`, ROOT)).toBe(`${ROOT}/kf-flow/agents/scout.md`);
    expect(renderForCopy(`bodies at ${PLUGIN_VAR}/assets/agents`, ROOT)).toBe(`bodies at ${ROOT}/kf-flow/agents`);
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
    expect(renderForCopy(`${PLUGIN_VAR}/assets/review/rules`, ROOT)).toBe(`${PKG_ROOT}/assets/review/rules`);
  });

  it("leaves text without plugin patterns unchanged", () => {
    const text = "# Title\n\nPlain prose with `code`, a kf: mention in passing and a path /usr/kf/bin.\n";
    expect(renderForCopy(text, ROOT)).toBe(text);
  });

  it("never leaves the plugin root variable in its output", () => {
    const text = [`${PLUGIN_VAR}/assets/skills/a/b.md`, `${PLUGIN_VAR}/assets/agents`, `${PLUGIN_VAR}/other-dir/x`, `${PLUGIN_VAR}/other/y`].join("\n");
    expect(renderForCopy(text, ROOT)).not.toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("is idempotent on its own output", () => {
    const text = `Skill(kf:plan) /kf:review Agent(kf:developer) ${PLUGIN_VAR}/assets/skills/flow/SKILL.md ${PLUGIN_VAR}/assets/agents ${PLUGIN_VAR}/assets/review/rules`;
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
    walk(join(PKG_ROOT, "assets", "skills"));
    walk(join(PKG_ROOT, "assets", "agents"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const out = renderForCopy(readFileSync(f, "utf8"), ROOT);
      expect(out, f).not.toContain("CLAUDE_PLUGIN_ROOT");
      expect(out, f).not.toMatch(/Skill\(kf:|Agent\(kf:|\/kf:[a-z]/);
      expect(out, f).not.toMatch(new RegExp(`(?<![\\w/.:-])kf:(${MANAGED_SKILLS.join("|")})(?![\\w-])`));
    }
  });
});

describe("renderSkillMd", () => {
  it("renames the frontmatter name of an LF skill to kf-<name>", () => {
    const out = renderSkillMd("---\nname: plan\ndescription: Plans work\n---\n# Plan\n", ROOT, "plan");
    expect(out).toBe("---\nname: kf-plan\ndescription: Plans work\n---\n# Plan\n");
  });

  it("renames the name of a CRLF skill and keeps its line endings", () => {
    const out = renderSkillMd("---\r\nname: plan\r\ndescription: Plans work\r\n---\r\n# Plan\r\n", ROOT, "plan");
    expect(out).toBe("---\r\nname: kf-plan\r\ndescription: Plans work\r\n---\r\n# Plan\r\n");
  });

  it("renames a quoted name", () => {
    const out = renderSkillMd('---\nname: "plan"\ndescription: x\n---\nbody\n', ROOT, "plan");
    expect(out).toMatch(/^name:\s*["']?kf-plan["']?\s*$/m);
    expect(out).not.toContain('name: "plan"');
    expect(out).toContain("description: x");
  });

  it("returns text without frontmatter unchanged", () => {
    const text = "# Plan\n\nname: plan\n";
    expect(renderSkillMd(text, ROOT, "plan")).toBe(text);
  });

  it("leaves a name: line that sits only in the body alone", () => {
    const text = "---\ndescription: Plans work\n---\n# Plan\n\nname: plan\n";
    expect(renderSkillMd(text, ROOT, "plan")).toBe(text);
  });

  it("still renders the plugin patterns in the body", () => {
    const out = renderSkillMd("---\nname: plan\n---\nrun Skill(kf:review)\n", ROOT, "plan");
    expect(out).toContain("Skill(kf-review)");
  });
});

describe("ephemeralPackageWarning", () => {
  it("names the copy dirs and the package root", () => {
    const warning = ephemeralPackageWarning("/home/a/.agents/skills, /home/a/.kiro/skills");
    expect(warning).toContain("/home/a/.agents/skills, /home/a/.kiro/skills");
    expect(warning).toContain(PKG_ROOT);
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
    expect(res.stdout).toContain("Gemini CLI: reads the copies written for OpenAI Codex");
    const manifest = JSON.parse(await readFile(join(shared(), ".kanban-flow-skills.json"), "utf8")) as Record<string, string>;
    for (const n of MANAGED_SKILLS) expect(Object.keys(manifest), n).toContain(`kf-${n}`);
  });

  it("names every copy kf-<name> in its SKILL.md frontmatter too", async () => {
    await project(["codex"]);
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    for (const n of MANAGED_SKILLS) {
      const head = (await readFile(join(shared(), `kf-${n}`, "SKILL.md"), "utf8")).split("---")[1] ?? "";
      expect(head, n).toMatch(new RegExp(`\\nname:\\s*kf-${n}\\s*\\n`));
    }
    // Agent bodies keep their own names.
    for (const a of MANAGED_AGENTS) {
      const head = (await readFile(join(shared(), "kf-flow", "agents", `${a}.md`), "utf8")).split("---")[1] ?? "";
      expect(head, a).toMatch(new RegExp(`\\nname:\\s*${a}\\s*\\n`));
    }
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

describe("renderForAgy and renderAgentForAgy", () => {
  const plugin = join("/tmp", "agy", "plugins", "kf");
  const briefs = [
    ["assets", "skills", "implement", "references", "developer-brief.md"],
    ["assets", "skills", "implement", "references", "test-writer-brief.md"],
    ["assets", "skills", "implement", "references", "automation-writer-brief.md"],
    ["assets", "skills", "implement", "references", "task-reviewer-brief.md"],
    ["assets", "skills", "implement", "references", "re-review-brief.md"],
    ["assets", "shared", "researcher-brief.md"],
    ["assets", "skills", "review", "references", "reviewer-brief.md"],
  ];

  it("rewrites Agent dispatch fences to invoke_subagent with mapped Model tiers and keeps the foreground rule", () => {
    for (const parts of briefs) {
      const out = renderForAgy(readFileSync(join(PKG_ROOT, ...parts), "utf8"), plugin);
      expect(out, parts.join("/")).not.toContain("subagent_type:");
      expect(out, parts.join("/")).not.toContain("\n  model:");
      expect(out, parts.join("/")).toContain("invoke_subagent:");
      expect(out, parts.join("/")).toContain("TypeName:");
      expect(out, parts.join("/")).toContain("Model:");
      expect(out, parts.join("/")).not.toContain("CLAUDE_PLUGIN_ROOT");
    }
    const developer = renderForAgy(readFileSync(join(PKG_ROOT, ...briefs[0]!), "utf8"), plugin);
    expect(developer).toContain("send_message");
    expect(developer).toContain("Recipient");
    expect(developer).toContain("no `&`, `nohup`, `run_in_background`");

    const researcher = renderForAgy(readFileSync(join(PKG_ROOT, ...briefs[5]!), "utf8"), plugin);
    expect(researcher).toContain('TypeName: "researcher"');
    expect(researcher).toContain('Model: "inherit"');
  });

  it("rewrites implement, loop, ask_question, and background run_command wording", () => {
    const impl = renderForAgy(readFileSync(join(PKG_ROOT, "assets", "skills", "implement", "SKILL.md"), "utf8"), plugin);
    expect(impl).toContain("every `dispatch` is an `invoke_subagent` call you make");
    expect(impl).not.toContain("an `Agent()` call");
    expect(impl).toContain("`run_command` (`WaitMsBeforeAsync: 500`)");
    expect(impl).not.toContain("Skill(kf:");

    const loop = renderForAgy(readFileSync(join(PKG_ROOT, "assets", "skills", "implement", "references", "task-loop.md"), "utf8"), plugin);
    expect(loop).toContain("send_message");
    expect(loop).toContain("conversationId");

    const flow = renderAgySkillMd(readFileSync(join(PKG_ROOT, "assets", "skills", "flow", "SKILL.md"), "utf8"), plugin, "flow");
    expect(flow).toMatch(/\nname:\s*kf-flow\s*\n/);
    expect(flow).toContain(`follow skill kf-brainstorm (read ${join(plugin, "skills", "kf-brainstorm", "SKILL.md")})`);
    expect(flow).not.toContain("AskUserQuestion");
  });

  it("renders all 7 packaged agents into AGY subagent schemas with mapped native tools", () => {
    for (const agent of MANAGED_AGENTS) {
      const rendered = renderAgentForAgy(readFileSync(join(PKG_ROOT, "assets", "agents", `${agent}.md`), "utf8"), plugin);
      expect(rendered, agent).toMatch(new RegExp(`^---\\nname: ${agent}\\n`));
      expect(rendered, agent).toContain("subagent: true\nmainAgent: false\ntools:");
      expect(rendered, agent).not.toContain("CLAUDE_PLUGIN_ROOT");
      expect(rendered, agent).not.toMatch(/Skill\(kf:|Agent\(kf:|\/kf:[a-z]/);
    }
    const reviewer = renderAgentForAgy(readFileSync(join(PKG_ROOT, "assets", "agents", "code-reviewer.md"), "utf8"), plugin);
    expect(reviewer).toContain("  - read_file\n");
    expect(reviewer).not.toContain("  - write_file\n");
    const researcher = renderAgentForAgy(readFileSync(join(PKG_ROOT, "assets", "agents", "researcher.md"), "utf8"), plugin);
    expect(researcher).toContain("  - search_web\n");
    const automation = renderAgentForAgy(readFileSync(join(PKG_ROOT, "assets", "agents", "automation-writer.md"), "utf8"), plugin);
    expect(automation).toContain("  - call_mcp_tool\n");
  });
});

describe("kf install / uninstall --agent agy", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-agy-"));
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["agy"] }));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("installs the AGY plugin bundle, preserves foreign entries, repairs via doctor, and uninstalls cleanly", async () => {
    await writeFile(
      join(dir, ".kf", "config.json"),
      JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["agy"], skills: { scope: "project" } }),
    );
    const res = await cmdInstall(["agy"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    const root = join(dir, ".agents", "plugins", "kf");
    const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8")) as { name: string; description: string };
    expect(manifest.name).toBe("kf");
    expect(manifest.description).toContain("Antigravity plugin");

    const installedSkills = (await readdir(join(root, "skills"))).filter((n) => n.startsWith("kf-")).sort();
    expect(installedSkills).toEqual(MANAGED_SKILLS.map((n) => `kf-${n}`).sort());
    const installedAgents = (await readdir(join(root, "agents"))).filter((n) => n.endsWith(".md")).sort();
    expect(installedAgents).toEqual(MANAGED_AGENTS.map((a) => `${a}.md`).sort());
    expect(existsSync(join(root, "shared", "harness-tools.md"))).toBe(true);
    expect(existsSync(join(root, "shared", "researcher-brief.md"))).toBe(true);

    const flow = await readFile(join(root, "skills", "kf-flow", "SKILL.md"), "utf8");
    expect(flow).toMatch(/\nname:\s*kf-flow\s*\n/);
    expect(flow).not.toContain("CLAUDE_PLUGIN_ROOT");
    for (const s of MANAGED_SKILLS) {
      const content = await readFile(join(root, "skills", `kf-${s}`, "SKILL.md"), "utf8");
      const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)?.[0] ?? "";
      expect(Buffer.byteLength(content.slice(fm.length), "utf8"), s).toBeLessThanOrEqual(24_000);
    }
    const devStepPath = join(root, "skills", "kf-implement", "references", "agy-3-2-dispatch-the-developer-and-handle-its-report.md");
    expect(existsSync(devStepPath)).toBe(true);
    const devStep = await readFile(devStepPath, "utf8");
    expect(devStep).toContain('invoke_subagent(TypeName: "developer")');
    expect(devStep).not.toContain("Agent(kf:");
    expect(runDoctor(dir).findings.filter((f) => f.area.includes("kf"))).toEqual([]);

    // Doctor detects a missing agent definition and doctor --fix restores it.
    await rm(join(root, "agents", "scout.md"));
    const beforeFix = runDoctor(dir).findings.filter((f) => f.area === root);
    expect(beforeFix).toHaveLength(1);
    expect(beforeFix[0]!.level).toBe("ERROR");
    expect((await runDoctorFixes(dir)).failures).toEqual([]);
    expect(existsSync(join(root, "agents", "scout.md"))).toBe(true);

    // Foreign entries are never clobbered on reinstall or removed on uninstall.
    await rm(join(root, "skills", "kf-plan"), { recursive: true, force: true });
    await mkdir(join(root, "skills", "kf-plan"), { recursive: true });
    await writeFile(join(root, "skills", "kf-plan", "SKILL.md"), "---\nname: kf-plan\ndescription: mine\n---\nmine\n");
    const reinstall = await cmdInstall(["agy"], { cwd: dir, scope: "project" });
    expect(reinstall.stdout).toContain("left untouched");
    expect(reinstall.stdout).toContain("kf-plan");

    const gone = await cmdUninstall(["agy"], { cwd: dir, scope: "project" });
    expect(gone.code).toBe(0);
    expect(existsSync(join(root, "skills", "kf-flow"))).toBe(false);
    expect(existsSync(join(root, "agents", "developer.md"))).toBe(false);
    expect(existsSync(join(root, "skills", "kf-plan", "SKILL.md"))).toBe(true);
  });

  it("installs globally and cleans project-scope AGY copies when project scope is not declared", async () => {
    await cmdInstall(["agy"], { cwd: dir, scope: "project" });
    const projectRoot = join(dir, ".agents", "plugins", "kf");
    expect(existsSync(join(projectRoot, "plugin.json"))).toBe(true);

    const globalRes = await cmdInstall(["agy"], { cwd: dir, scope: "global" });
    expect(globalRes.code).toBe(0);
    const homePlugin = join(process.env.HOME!, ".gemini", "config", "plugins", "kf");
    expect(existsSync(join(homePlugin, "plugin.json"))).toBe(true);
    expect(existsSync(join(homePlugin, "skills", "kf-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(homePlugin, "agents", "code-reviewer.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "plugin.json"))).toBe(false);

    const uninstallGlobal = await cmdUninstall(["agy"], { cwd: dir, scope: "global" });
    expect(uninstallGlobal.code).toBe(0);
    expect(existsSync(homePlugin)).toBe(false);
  });
});
