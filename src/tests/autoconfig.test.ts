import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdAutoconfig, AGENT_COMMANDS } from "../cli/commands/autoconfig.js";
import { parseArgsCli, allCommands } from "../cli/args.js";
import { cmdInstall } from "../integrations/install.js";
import { copyName } from "../integrations/managed.js";
import { PLUGIN_ID, type ClaudeRun } from "../integrations/claude-plugin.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

let dir: string;
const pluginList = (entries: unknown[]): ClaudeRun => async () => ({ code: 0, stdout: JSON.stringify(entries), stderr: "" });
const emptyPlugins = pluginList([]);
const parsed = { command: "autoconfig", options: {}, positionals: [] } as unknown as ParsedArgs;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-autoconfig-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cmdAutoconfig", () => {
  it("prints context, checklist, rules and workflow guide for an unconfigured project", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    const res = await cmdAutoconfig(parsed, dir, emptyPlugins);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# kanban-flow agent setup briefing");
    expect(res.stdout).toContain("## Project context");
    expect(res.stdout).toContain("Detected stacks: node");
    expect(res.stdout).toContain("## Setup checklist");
    expect(res.stdout).toContain("[ ] Project config");
    expect(res.stdout).toContain("kf init --defaults");
    expect(res.stdout).toContain("## Review rules to enforce");
    expect(res.stdout).toContain("general.md");
    expect(res.stdout).toContain("## Workflow guide");
  });

  it("marks items done once the project is configured", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    await mkdir(join(dir, ".kf", "review", "rules"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), '{"schema":"kanban-flow","created":"x"}', "utf8");
    for (const f of ["general.md", "security.md", "performance.md", "node.md"]) {
      await writeFile(join(dir, ".kf", "review", "rules", f), "# rule", "utf8");
    }
    await mkdir(join(dir, ".works"), { recursive: true });

    const res = await cmdAutoconfig(parsed, dir, pluginList([{ id: PLUGIN_ID, scope: "user", enabled: true, readFromFolder: PKG_ROOT }]));
    expect(res.stdout).toContain("[x] Project config");
    expect(res.stdout).toContain("[x] kf plugin (kf@kanban-flow, Claude Code) — installed, enabled (scope: user)");
    expect(res.stdout).toContain("- Skills installed (scope: global): [claude]");
    expect(res.stdout).not.toContain("Skills for Claude Code");
    expect(res.stdout).not.toContain("Agents for Claude Code");
    expect(res.stdout).toContain("[x] Base review rules");
    expect(res.stdout).toContain("[x] Stack rule packs: node");
    expect(res.stdout).toContain("[ ] AGENTS.md");
  });

  it("leaves the plugin item open when the plugin is missing, disabled or reads another folder", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    const missing = (await cmdAutoconfig(parsed, dir, pluginList([]))).stdout;
    expect(missing).toContain("[ ] kf plugin (kf@kanban-flow, Claude Code) — not installed (scope: user)");
    expect(missing).toContain("- Skills installed (scope: global): [none]");
    const disabled = (await cmdAutoconfig(parsed, dir, pluginList([{ id: PLUGIN_ID, scope: "user", enabled: false }]))).stdout;
    expect(disabled).toContain("[ ] kf plugin (kf@kanban-flow, Claude Code) — installed but disabled (scope: user)");
    const stale = (await cmdAutoconfig(parsed, dir, pluginList([{ id: PLUGIN_ID, scope: "user", enabled: true, readFromFolder: "/elsewhere" }]))).stdout;
    expect(stale).toContain("[ ] kf plugin (kf@kanban-flow, Claude Code) — installed (scope: user) but reading /elsewhere, not this package");
    const unknown = (await cmdAutoconfig(parsed, dir, pluginList([{ id: PLUGIN_ID, scope: "user", enabled: true, installPath: PKG_ROOT }]))).stdout;
    expect(unknown).toContain("[ ] kf plugin");
    expect(unknown).not.toContain("[x] kf plugin");
  });

  it("prints the probe failure instead of swallowing it", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    const out = (await cmdAutoconfig(parsed, dir, async () => ({ code: 3, stdout: "", stderr: "boom" }))).stdout;
    expect(out).toContain("⚠ cannot check kf plugin: `claude plugin list --json` exited 3");
    expect(out).toContain("boom");
    expect(out).toContain("[ ] kf plugin");
    const absent = (await cmdAutoconfig(parsed, dir, async () => { throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" }); })).stdout;
    expect(absent).toContain("⚠ cannot check kf plugin: the `claude` CLI was not found on PATH.");
  });

  it("does not count the user's own travel skill as stale or as a project duplicate for another runtime", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), '{"schema":"kanban-flow","created":"x","agents":["codex"]}', "utf8");
    await cmdInstall(["codex"], { cwd: dir });
    const globalTravel = join(process.env.HOME!, ".agents", "skills", "travel");
    await rm(globalTravel, { recursive: true, force: true });
    await mkdir(globalTravel, { recursive: true });
    await writeFile(join(globalTravel, "SKILL.md"), "# My own travel planner\n", "utf8");
    await mkdir(join(dir, ".agents", "skills", "travel"), { recursive: true });
    await writeFile(join(dir, ".agents", "skills", "travel", "SKILL.md"), "# My project travel\n", "utf8");

    const out = (await cmdAutoconfig(parsed, dir, pluginList([]))).stdout;
    expect(out).toMatch(/- Skills installed \(scope: global\): \[codex[,\]]/);
    expect(out).toMatch(/\[x\] Skills for OpenAI Codex \(scope: global, [^\n]*\) — copied/);
    expect(out).toContain("[x] No duplicate project-scope copies (scope: global)");

    // A managed skill copy missing beside it still leaves the item open.
    await rm(join(process.env.HOME!, ".agents", "skills", copyName("plan")), { recursive: true, force: true });
    expect((await cmdAutoconfig(parsed, dir, pluginList([]))).stdout).toContain("[ ] Skills for OpenAI Codex");
  });

  it("prints a workflow guide whose commands the CLI parser accepts", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    const guide = (await cmdAutoconfig(parsed, dir, emptyPlugins)).stdout.split("## Workflow guide")[1];
    const usages = guide.split("\n").map((l) => l.trim()).filter((l) => /^kf [a-z]/.test(l));
    expect(usages.length).toBe(AGENT_COMMANDS.length);
    for (const usage of usages) {
      const argv = usage.replace(/\[[^\]]*\]/g, "").replace(/<([^>]+)>/g, (_, name: string) => name.replace(/[^a-z0-9-]/gi, "-"))
        .split(/\s+/).filter(Boolean).slice(1);
      expect(allCommands()).toContain(argv[0]);
      expect(() => parseArgsCli(argv), usage).not.toThrow();
    }
    expect(guide).not.toContain("--to");
    expect(guide).not.toContain("ctx/name");
  });

  it("prefers configured stacks over auto-detection", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), '{"schema":"kanban-flow","created":"x","stacks":["go"]}', "utf8");
    const configured = (await cmdAutoconfig(parsed, dir, emptyPlugins)).stdout;
    expect(configured).toContain("Configured stacks: go");
    expect(configured).not.toContain("stacks: node");
    await writeFile(join(dir, ".kf", "config.json"), '{"schema":"kanban-flow","created":"x"}', "utf8");
    expect((await cmdAutoconfig(parsed, dir, emptyPlugins)).stdout).toContain("Detected stacks: node");
  });
});
