import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import { readProjectConfig } from "../../project/config.js";
import { HARNESS_STAGES, type RunnerConfig } from "../../harness/config.js";
import { findWorksRoot } from "../../workflow/features.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** True when the runner's executable resolves on PATH (Windows also checks .cmd/.exe). */
export function cliAvailable(cli: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (cli.includes("/") || cli.includes("\\")) return existsSync(cli);
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const names = process.platform === "win32" ? [cli, `${cli}.cmd`, `${cli}.exe`] : [cli];
  return dirs.some((dir) => names.some((n) => existsSync(join(dir, n))));
}

function sessionKind(runner: RunnerConfig): string {
  if (runner.session === undefined) return "none";
  if (runner.session === "provided") return "provided";
  return "stdout" in runner.session ? "stdout" : "command";
}

function shorten(text: string | undefined, max = 60): string {
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function cmdHarness(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = findWorksRoot(cwd) ?? cwd;
  const harness = readProjectConfig(root).harness;
  if (!harness) {
    return { code: 1, stdout: "No harness configured in .kf/config.json — run: kf init (seeds roles and runner presets).", stderr: "no harness" };
  }
  const stages = HARNESS_STAGES.map((stage) => ({ stage, roles: harness.stages[stage] ?? [] }));
  const roles = Object.entries(harness.roles).map(([name, role]) => ({
    name, runner: role.runner, brief: role.brief ?? null, output: role.output ?? null,
    available: cliAvailable(harness.runners[role.runner].start[0]),
  }));
  const runners = Object.entries(harness.runners).map(([name, runner]) => ({
    name,
    cli: runner.start[0],
    available: cliAvailable(runner.start[0]),
    resume: runner.resume !== undefined,
    session: sessionKind(runner),
    usage: runner.usage ?? null,
  }));
  if (args.options.json) return { code: 0, stdout: JSON.stringify({ main: harness.main, stages, roles, runners }, null, 2) };

  const lines = [
    `main role: ${harness.main} (${harness.roles[harness.main].runner})`,
    "",
    "stages → roles:",
    ...stages.map((s) => `  ${s.stage.padEnd(14)} ${s.roles.length > 0 ? s.roles.join(" → ") : `${harness.main} (main, not handed off)`}`),
    "",
    "roles → runners:",
    ...roles.map((r) => `  ${r.name.padEnd(12)} ${r.runner.padEnd(10)} ${r.available ? "on PATH" : "missing"}${r.output ? `   output: ${r.output}` : ""}${r.brief ? `\n    ${shorten(r.brief, 96)}` : ""}`),
    "",
    "runners:",
    ...runners.map((r) => `  ${r.name.padEnd(12)} ${r.cli.padEnd(10)} ${r.available ? "on PATH" : "missing"}   resume: ${r.resume ? "yes" : "no"}   session: ${r.session}${r.usage ? `   usage: ${r.usage}` : ""}`),
  ];
  return { code: 0, stdout: lines.join("\n") };
}
