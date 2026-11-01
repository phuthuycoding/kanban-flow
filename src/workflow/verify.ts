import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS } from "./schema.js";
import type { Feature } from "./features.js";
import { parseTaskGraph } from "./tasks.js";
import { pathAllowed } from "./allowlist.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { runGit } from "../shared/git.js";
import { readProjectConfig } from "../project/config.js";

const OUTPUT_TAIL = 2000;
const VERIFY_MAX_BUFFER = 64 * 1024 * 1024;

export type VerifyCode = 0 | 1 | 2 | 3;

export interface VerifyResult {
  code: VerifyCode;
  lines: string[];
}

/**
 * Run the verify argv list in `cwd`, in order, without a shell; returns the first failure naming the command and
 * its exit code (followed by the output tail), or null when all pass.
 */
export function runVerify(commands: string[][], cwd: string): string | null {
  for (const argv of commands) {
    // No timeout on purpose: the loop that calls kf verify owns the time budget, and a test command's own timeout still applies.
    const res = spawnSync(argv[0], argv.slice(1), {
      cwd, encoding: "utf8", maxBuffer: VERIFY_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error) {
      const code = (res.error as NodeJS.ErrnoException).code;
      return code === "ENOENT" ? `verify command not found: ${argv[0]}` : `verify command ${argv.join(" ")} could not finish: ${res.error.message}`;
    }
    if (res.status !== 0) {
      const how = res.status !== null ? `exit ${res.status}` : `signal ${res.signal}`;
      const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
      const head = `verify command failed (${how}): ${argv.join(" ")}`;
      return output ? `${head}\n${output.slice(-OUTPUT_TAIL)}` : head;
    }
  }
  return null;
}

/** The item's worktree when it has one, else the project root; the line says which. */
function itemDir(root: string, feature: Feature): { dir: string; line: string } {
  const wt = feature.meta?.worktree?.path;
  if (wt) return { dir: wt, line: `Running in the item worktree ${wt}` };
  return { dir: root, line: "no worktree — running in the project root" };
}

function runCommands(commands: string[][] | undefined, dir: string, what: "task" | "stage", lines: string[]): VerifyResult {
  if (!commands || commands.length === 0) {
    lines.push(`No ${what} verify configured (harness.verify.${what}).`);
    return { code: 0, lines };
  }
  const failure = runVerify(commands, dir);
  if (failure !== null) {
    lines.push(failure);
    return { code: 1, lines };
  }
  lines.push(`All ${commands.length} ${what} verify command(s) passed.`);
  return { code: 0, lines };
}

/** Check the files changed in `base..HEAD` against the task's Files, then run `harness.verify.task`. */
export function verifyTask(root: string, feature: Feature, taskId: string, base: string): VerifyResult {
  const bad = (reason: string): VerifyResult => ({ code: 3, lines: [reason] });
  const planPath = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  if (!existsSync(planPath)) return bad(`'${feature.name}' has no implementation plan (${ARTIFACTS["implementation-plan"].file}).`);
  const id = taskId.trim().toUpperCase();
  const task = parseTaskGraph(splitFrontmatter(readFileSync(planPath, "utf8")).body).tasks.find((t) => t.id === id);
  if (!task) return bad(`Unknown task '${taskId}': it is not in the Task Breakdown of '${feature.name}'.`);

  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return bad(`The item worktree ${dir} does not exist.`);
  if (base.startsWith("-")) return bad(`--base '${base}' is not a commit.`);
  if (runGit(dir, ["rev-parse", "-q", "--verify", `${base}^{commit}`]).code !== 0) return bad(`--base '${base}' does not resolve to a commit.`);
  if (runGit(dir, ["merge-base", "--is-ancestor", base, "HEAD"]).code !== 0) return bad(`--base '${base}' is not an ancestor of HEAD.`);

  const lines = [line];
  if (task.files === null) {
    lines.push(`${task.id} has no Files: allowlist check skipped.`);
  } else {
    // --no-renames lists a rename as a delete plus an add, so the old path is checked against Files too.
    // -z keeps names verbatim: without it git quotes non-ASCII and special characters (core.quotePath).
    const diff = runGit(dir, ["diff", "--name-only", "-z", "--no-renames", `${base}..HEAD`]);
    if (diff.code !== 0) return bad(`git diff --name-only -z --no-renames ${base}..HEAD failed in ${dir}: ${diff.stderr.trim()}`);
    const outside = diff.stdout.split("\0").filter((f) => f !== "" && !pathAllowed(f, task.files!));
    if (outside.length > 0) {
      lines.push(`${outside.length} file(s) outside ${task.id}'s Files:`, ...outside.map((f) => `  ${f}`));
      return { code: 2, lines };
    }
    lines.push(`Every changed file is inside ${task.id}'s Files.`);
  }
  return runCommands(readProjectConfig(root).harness?.verify?.task, dir, "task", lines);
}

/** Run `harness.verify.stage` in the item's directory. */
export function verifyStage(root: string, feature: Feature): VerifyResult {
  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return { code: 3, lines: [`The item worktree ${dir} does not exist.`] };
  return runCommands(readProjectConfig(root).harness?.verify?.stage, dir, "stage", [line]);
}
