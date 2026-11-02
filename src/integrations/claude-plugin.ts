import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import type { SkillScope } from "./agents.js";

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

/** Text a caller prints; ensurePlugin sets `changed` to false when claude was only asked, never written to. */
export interface PluginReport {
  code: number;
  stdout: string;
  stderr?: string;
  changed?: boolean;
}

export type PluginState =
  | { status: "missing" }
  | { status: "disabled"; scope: string; /** set only when the plugin also reads another folder than this package */ readFromFolder?: string }
  | { status: "stale"; readFromFolder: string }
  | { status: "unknown" }
  | { status: "current" };

/** A claude call that ran but whose answer kf cannot use; the message quotes what claude printed. */
export class ClaudePluginError extends Error {}

/** A claude that hangs (a prompt, a stuck network fetch) must not hang kf install or kf init with it. */
export const CLAUDE_TIMEOUT_MS = 60_000;

/** Spawns `claude` in `cwd`: a project-scope install writes `.claude/settings.json` into the directory claude runs in. */
export function claudeRunner(cwd?: string, timeoutMs = CLAUDE_TIMEOUT_MS): ClaudeRun {
  return (args) => new Promise((done, fail) => {
    const child = spawn("claude", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      fail(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) fail(new ClaudePluginError(`\`claude ${args.join(" ")}\` did not finish within ${timeoutMs / 1000}s and was killed:\n${quote({ code: 1, stdout, stderr })}`));
      else done({ code: code ?? 1, stdout, stderr });
    });
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

/** The kf plugin's state; with a scope, an install at the other scope counts as missing here. */
export async function pluginState(run: ClaudeRun = defaultRun, scope?: SkillScope): Promise<PluginState> {
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
  const wanted = scope === undefined ? undefined : claudeScope(scope);
  const entry = list.find(
    (e): e is Record<string, unknown> =>
      typeof e === "object" && e !== null && e.id === PLUGIN_ID && (wanted === undefined || e.scope === wanted),
  );
  if (!entry) return { status: "missing" };
  // installPath is the plugin cache, never the package root, so only readFromFolder says where the plugin reads from.
  const folder = typeof entry.readFromFolder === "string" ? entry.readFromFolder : undefined;
  if (entry.enabled === false) {
    const staleFolder = folder !== undefined && resolve(folder) !== resolve(PKG_ROOT) ? folder : undefined;
    return staleFolder === undefined ? { status: "disabled", scope: String(entry.scope) } : { status: "disabled", scope: String(entry.scope), readFromFolder: staleFolder };
  }
  if (folder === undefined) return { status: "unknown" };
  if (resolve(folder) !== resolve(PKG_ROOT)) return { status: "stale", readFromFolder: folder };
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
export async function ensurePlugin(scope: SkillScope, run: ClaudeRun = defaultRun): Promise<PluginReport> {
  const target = claudeScope(scope);
  try {
    const state = await pluginState(run, scope);
    switch (state.status) {
      case "missing":
        await call(run, ["plugin", "marketplace", "add", PKG_ROOT]);
        await call(run, ["plugin", "install", PLUGIN_ID, "--scope", target]);
        return { code: 0, changed: true, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} added from ${PKG_ROOT} (scope: ${target})` };
      case "disabled":
        await call(run, ["plugin", "enable", PLUGIN_NAME, "--scope", target]);
        if (state.readFromFolder !== undefined) {
          await call(run, ["plugin", "marketplace", "add", PKG_ROOT]);
          return { code: 0, changed: true, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} enabled (scope: ${target}) and marketplace ${MARKETPLACE_NAME} repointed from ${state.readFromFolder} to ${PKG_ROOT}` };
        }
        return { code: 0, changed: true, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} enabled (scope: ${target})` };
      case "stale":
        await call(run, ["plugin", "marketplace", "add", PKG_ROOT]);
        return { code: 0, changed: true, stdout: `✓ Claude Code: marketplace ${MARKETPLACE_NAME} repointed from ${state.readFromFolder || "an unknown folder"} to ${PKG_ROOT}` };
      case "unknown":
        return { code: 0, changed: false, stdout: `· Claude Code: plugin ${PLUGIN_ID} source unknown (claude does not report readFromFolder); left as it is` };
      case "current":
        return { code: 0, changed: false, stdout: `✓ Claude Code: plugin ${PLUGIN_ID} is current (${PKG_ROOT})` };
    }
  } catch (err) {
    return {
      code: 1,
      changed: false,
      stdout: `Claude Code: could not set up the ${PLUGIN_ID} plugin — ${failureReason(err)}\n${manualSteps()}`,
      stderr: "claude plugin setup failed",
    };
  }
}

/** Claude's own wording, probed, when the plugin or the marketplace is already gone. */
const PLUGIN_ABSENT = new RegExp(`Plugin "${PLUGIN_NAME}" not found`);
const MARKETPLACE_ABSENT = new RegExp(`Marketplace '${MARKETPLACE_NAME}' not found`);

/** One removal step: claude's "already gone" answer is a note, any other failure throws. */
async function removeStep(run: ClaudeRun, args: string[], absentPattern: RegExp, done: string, absent: string): Promise<string> {
  const res = await run(args);
  if (res.code === 0) return done;
  if (absentPattern.test(quote(res))) return absent;
  throw failed(args, res);
}

export async function removePlugin(scope: SkillScope, run: ClaudeRun = defaultRun): Promise<PluginReport> {
  const other: SkillScope = scope === "global" ? "project" : "global";
  const lines: string[] = [];
  try {
    lines.push(await removeStep(run, ["plugin", "uninstall", PLUGIN_NAME, "--scope", claudeScope(scope)], PLUGIN_ABSENT, `✗ Claude Code: plugin ${PLUGIN_ID} uninstalled`, `· Claude Code: plugin ${PLUGIN_ID} not installed`));
    // The marketplace is registered per user, so a kf install at the other scope still reads from it.
    if ((await pluginState(run, other)).status !== "missing") {
      lines.push(`· Claude Code: marketplace ${MARKETPLACE_NAME} kept (kf still installed at ${claudeScope(other)} scope)`);
    } else {
      lines.push(await removeStep(run, ["plugin", "marketplace", "remove", MARKETPLACE_NAME], MARKETPLACE_ABSENT, `✗ Claude Code: marketplace ${MARKETPLACE_NAME} removed`, `· Claude Code: marketplace ${MARKETPLACE_NAME} not added`));
    }
  } catch (err) {
    lines.push(`Claude Code: could not remove the ${PLUGIN_ID} plugin — ${failureReason(err)}`);
    lines.push(`Remove it by hand inside Claude Code:\n  /plugin uninstall ${PLUGIN_ID}\n  /plugin marketplace remove ${MARKETPLACE_NAME}`);
    return { code: 1, stdout: lines.join("\n"), stderr: "claude plugin removal failed" };
  }
  return { code: 0, stdout: lines.join("\n") };
}
