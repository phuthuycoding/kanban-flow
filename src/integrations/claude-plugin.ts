import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import type { SkillScope } from "./agents.js";
import type { InstallReport } from "./install.js";

export const PLUGIN_NAME = "kf";
export const MARKETPLACE_NAME = "kanban-flow";
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

export interface ClaudeRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `claude <args>`. A claude missing from PATH rejects with an error whose `code` is "ENOENT". */
export type ClaudeRun = (args: string[]) => Promise<ClaudeRunResult>;

export type PluginState =
  | { status: "missing" }
  | { status: "disabled"; scope: string }
  | { status: "stale"; readFromFolder: string }
  | { status: "current" };

/** A claude call that ran but whose answer kf cannot use; the message quotes what claude printed. */
export class ClaudePluginError extends Error {}

/** Spawns `claude` in `cwd`: a project-scope install writes `.claude/settings.json` into the directory claude runs in. */
export function claudeRunner(cwd?: string): ClaudeRun {
  return (args) => new Promise((done, fail) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

const defaultRun = claudeRunner();

/** kf `global` is Claude Code's `user` scope; `project` is the same name in both. */
export function claudeScope(scope: SkillScope): "user" | "project" {
  return scope === "global" ? "user" : "project";
}

function quote(res: ClaudeRunResult): string {
  return [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join("\n") || "(no output)";
}

function failed(args: string[], res: ClaudeRunResult): ClaudePluginError {
  return new ClaudePluginError(`\`claude ${args.join(" ")}\` exited ${res.code}:\n${quote(res)}`);
}

async function call(run: ClaudeRun, args: string[]): Promise<ClaudeRunResult> {
  const res = await run(args);
  if (res.code !== 0) throw failed(args, res);
  return res;
}

export async function pluginState(run: ClaudeRun = defaultRun): Promise<PluginState> {
  const args = ["plugin", "list", "--json"];
  const res = await call(run, args);
  let list: unknown;
  try {
    list = JSON.parse(res.stdout);
  } catch (err) {
    throw new ClaudePluginError(`\`claude ${args.join(" ")}\` did not print JSON:\n${quote(res)}`, { cause: err });
  }
  if (!Array.isArray(list)) {
    throw new ClaudePluginError(`\`claude ${args.join(" ")}\` did not print a JSON array:\n${quote(res)}`);
  }
  const entry = list.find(
    (e): e is Record<string, unknown> => typeof e === "object" && e !== null && typeof e.id === "string" && e.id.startsWith(`${PLUGIN_NAME}@`),
  );
  if (!entry) return { status: "missing" };
  if (entry.enabled === false) return { status: "disabled", scope: String(entry.scope) };
  const folder = typeof entry.readFromFolder === "string" ? entry.readFromFolder : typeof entry.installPath === "string" ? entry.installPath : "";
  if (folder === "" || resolve(folder) !== resolve(PKG_ROOT)) return { status: "stale", readFromFolder: folder };
  return { status: "current" };
}

function manualSteps(): string {
  return `Install it by hand inside Claude Code:\n  /plugin marketplace add ${PKG_ROOT}\n  /plugin install ${PLUGIN_ID}`;
}

/** Names a claude that is absent or answered badly; anything else is a bug and propagates. */
function failureReason(err: unknown): string {
  if (err instanceof ClaudePluginError) return err.message;
  if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return "the `claude` CLI was not found on PATH.";
  throw err;
}

/** Bring the kf plugin to the state the package root asks for, writing only what differs. */
export async function ensurePlugin(scope: SkillScope, run: ClaudeRun = defaultRun): Promise<InstallReport> {
  const target = claudeScope(scope);
  try {
    const state = await pluginState(run);
    switch (state.status) {
      case "missing":
        await call(run, ["plugin", "marketplace", "add", PKG_ROOT]);
        await call(run, ["plugin", "install", PLUGIN_ID, "--scope", target]);
        return { code: 0, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} added from ${PKG_ROOT} (scope: ${target})` };
      case "disabled":
        await call(run, ["plugin", "enable", PLUGIN_NAME, "--scope", target]);
        return { code: 0, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} enabled (scope: ${target})` };
      case "stale":
        await call(run, ["plugin", "marketplace", "add", PKG_ROOT]);
        return { code: 0, stdout: `✓ Claude Code: marketplace ${MARKETPLACE_NAME} repointed from ${state.readFromFolder || "an unknown folder"} to ${PKG_ROOT}` };
      case "current":
        return { code: 0, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} is current (${PKG_ROOT})` };
    }
  } catch (err) {
    return {
      code: 1,
      stdout: `Claude Code: could not set up the ${PLUGIN_ID} plugin — ${failureReason(err)}\n${manualSteps()}`,
      stderr: "claude plugin setup failed",
    };
  }
}

/** Claude's own wording when the plugin or marketplace is already gone (probed: "... not found ..."). */
const ABSENT = /not found/i;

export async function removePlugin(scope: SkillScope, run: ClaudeRun = defaultRun): Promise<InstallReport> {
  const steps: Array<[string[], string, string]> = [
    [["plugin", "uninstall", PLUGIN_NAME, "--scope", claudeScope(scope)], `✗ Claude Code: plugin ${PLUGIN_ID} uninstalled`, `· Claude Code: plugin ${PLUGIN_ID} not installed`],
    [["plugin", "marketplace", "remove", MARKETPLACE_NAME], `✗ Claude Code: marketplace ${MARKETPLACE_NAME} removed`, `· Claude Code: marketplace ${MARKETPLACE_NAME} not added`],
  ];
  const lines: string[] = [];
  try {
    for (const [args, done, absent] of steps) {
      const res = await run(args);
      if (res.code === 0) lines.push(done);
      else if (ABSENT.test(quote(res))) lines.push(absent);
      else throw failed(args, res);
    }
  } catch (err) {
    lines.push(`Claude Code: could not remove the ${PLUGIN_ID} plugin — ${failureReason(err)}`);
    return { code: 1, stdout: lines.join("\n"), stderr: "claude plugin removal failed" };
  }
  return { code: 0, stdout: lines.join("\n") };
}
