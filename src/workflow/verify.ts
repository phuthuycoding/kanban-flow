import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACTS } from "./schema.js";
import type { Feature } from "./features.js";
import { parseTaskGraph } from "./tasks.js";
import type { PlannedTask } from "./tasks.js";
import { pathAllowed } from "./allowlist.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { addDetachedWorktree, removeWorktree, runGit } from "../shared/git.js";
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

const bad = (reason: string): VerifyResult => ({ code: 3, lines: [reason] });

/** The task from the plan and the item's directory, or the exit-3 result saying why not. */
function taskAndDir(root: string, feature: Feature, taskId: string): { task: PlannedTask; dir: string; line: string } | VerifyResult {
  const planPath = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  if (!existsSync(planPath)) return bad(`'${feature.name}' has no implementation plan (${ARTIFACTS["implementation-plan"].file}).`);
  const id = taskId.trim().toUpperCase();
  const task = parseTaskGraph(splitFrontmatter(readFileSync(planPath, "utf8")).body).tasks.find((t) => t.id === id);
  if (!task) return bad(`Unknown task '${taskId}': it is not in the Task Breakdown of '${feature.name}'.`);

  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return bad(`The item worktree ${dir} does not exist.`);
  return { task, dir, line };
}

/** Push the allowlist verdict for `changed` onto `lines`; the exit-2 result when a file is outside the task's Files. */
function checkFiles(task: PlannedTask, changed: string[], lines: string[]): VerifyResult | null {
  const outside = changed.filter((f) => !pathAllowed(f, task.files!));
  if (outside.length > 0) {
    lines.push(`${outside.length} file(s) outside ${task.id}'s Files:`, ...outside.map((f) => `  ${f}`));
    return { code: 2, lines };
  }
  lines.push(`Every changed file is inside ${task.id}'s Files.`);
  return null;
}

/** Check the files changed in `base..HEAD` against the task's Files, then run `harness.verify.task`. */
export function verifyTask(root: string, feature: Feature, taskId: string, base: string): VerifyResult {
  const found = taskAndDir(root, feature, taskId);
  if ("code" in found) return found;
  const { task, dir, line } = found;
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
    const outside = checkFiles(task, diff.stdout.split("\0").filter((f) => f !== ""), lines);
    if (outside) return outside;
  }
  return runCommands(readProjectConfig(root).harness?.verify?.task, dir, "task", lines);
}

/**
 * Check the union of files changed by exactly the listed commits (each against its parent) against the task's
 * Files, then run `harness.verify.task` in a temporary detached worktree at the newest listed commit, so
 * uncommitted work in the item worktree never reaches the verify commands. `atHead` moves that worktree to HEAD:
 * parallel tasks interleave commits on one branch, so a task's own commit may not build without a neighbour's.
 */
export function verifyTaskCommits(root: string, feature: Feature, taskId: string, shas: string[], atHead = false): VerifyResult {
  const found = taskAndDir(root, feature, taskId);
  if ("code" in found) return found;
  const { task, dir } = found;
  if (shas.length === 0) return bad("--commits is empty or has an empty element.");

  const resolved: string[] = [];
  for (const sha of shas) {
    if (sha.startsWith("-")) return bad(`--commits '${sha}' is not a commit.`);
    const rev = runGit(dir, ["rev-parse", "-q", "--verify", `${sha}^{commit}`]);
    if (rev.code !== 0) return bad(`--commits '${sha}' does not resolve to a commit.`);
    const full = rev.stdout.trim();
    if (runGit(dir, ["merge-base", "--is-ancestor", full, "HEAD"]).code !== 0) return bad(`--commits '${sha}' is not an ancestor of HEAD.`);
    const parents = runGit(dir, ["rev-list", "--parents", "-n", "1", full]);
    if (parents.code !== 0) return bad(`git rev-list --parents -n 1 ${full} failed in ${dir}: ${parents.stderr.trim()}`);
    const parentCount = parents.stdout.trim().split(/\s+/).length - 1;
    if (parentCount > 1) return bad(`--commits '${sha}' is a merge commit.`);
    if (parentCount === 0) return bad(`--commits '${sha}' has no parent.`);
    if (resolved.includes(full)) return bad(`--commits lists ${full.slice(0, 7)} twice.`);
    resolved.push(full);
  }
  for (let i = 1; i < resolved.length; i++) {
    const [a, b] = [resolved[i - 1], resolved[i]];
    if (runGit(dir, ["merge-base", "--is-ancestor", a, b]).code !== 0) {
      return bad(`--commits is not in history order: ${a.slice(0, 7)} is not an ancestor of ${b.slice(0, 7)}.`);
    }
  }

  const lines: string[] = [];
  if (task.files === null) {
    lines.push(`${task.id} has no Files: allowlist check skipped.`);
  } else {
    const changed = new Set<string>();
    for (const full of resolved) {
      // Same flags as verifyTask: --no-renames checks a rename's old path too, -z keeps names verbatim.
      const diff = runGit(dir, ["diff", "--name-only", "-z", "--no-renames", `${full}^`, full]);
      if (diff.code !== 0) return bad(`git diff --name-only -z --no-renames ${full}^ ${full} failed in ${dir}: ${diff.stderr.trim()}`);
      for (const f of diff.stdout.split("\0")) if (f !== "") changed.add(f);
    }
    const outside = checkFiles(task, [...changed], lines);
    if (outside) return outside;
  }

  const commands = readProjectConfig(root).harness?.verify?.task;
  if (!commands || commands.length === 0) return runCommands(commands, dir, "task", lines);
  if (!atHead) return runDetached(dir, resolved[resolved.length - 1], commands, lines);
  const head = runGit(dir, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return bad(`git rev-parse HEAD failed in ${dir}: ${head.stderr.trim()}`);
  return runDetached(dir, head.stdout.trim(), commands, lines);
}

/** Run the task commands in a temporary detached worktree of `itemDir` at `sha`, removing it on every exit path. */
function runDetached(itemDir: string, sha: string, commands: string[][], lines: string[]): VerifyResult {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "kf-verify-")));
  const itemModules = join(itemDir, "node_modules");
  const link = join(path, "node_modules");
  let added = false;
  let linked = false;
  const cleanup = (): string | null => {
    const failures: string[] = [];
    const attempt = (step: () => void): void => {
      try {
        step();
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    };
    // Unlink first and never recurse through the link: the item's own node_modules must survive.
    if (linked) attempt(() => unlinkSync(link));
    if (added) attempt(() => removeWorktree(itemDir, path, { force: true }));
    attempt(() => rmSync(path, { recursive: true, force: true }));
    return failures.length > 0 ? `warning: could not remove the verify worktree ${path}: ${failures.join("; ")} — run git worktree prune` : null;
  };

  let result: VerifyResult;
  try {
    addDetachedWorktree(itemDir, path, sha);
    added = true;
    if (existsSync(itemModules)) {
      symlinkSync(itemModules, link, "dir");
      linked = true;
    }
    lines.push(`Running in a detached worktree at ${sha.slice(0, 7)} (${path})`);
    result = runCommands(commands, path, "task", lines);
  } catch (err) {
    const warning = cleanup();
    if (warning !== null) throw new Error(`${err instanceof Error ? err.message : String(err)}; ${warning}`, { cause: err });
    throw err;
  }
  const warning = cleanup();
  if (warning !== null) result.lines.push(warning);
  return result;
}

/** Run `harness.verify.stage` in the item's directory. */
export function verifyStage(root: string, feature: Feature): VerifyResult {
  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return { code: 3, lines: [`The item worktree ${dir} does not exist.`] };
  return runCommands(readProjectConfig(root).harness?.verify?.stage, dir, "stage", [line]);
}

/** The log `kf verify` writes beside the ledger: the ledger's verify lines are checked against it. */
export function verifyLogPath(itemDir: string, taskId: string): string {
  return join(itemDir, "loop", `${taskId.toLowerCase()}-verify.log`);
}

/** Append one run: a `## kf verify <ISO> exit=<n>` header, then the run's output indented, so output can never read as a header. */
export function appendVerifyLog(itemDir: string, taskId: string, result: VerifyResult, at: Date = new Date()): void {
  mkdirSync(join(itemDir, "loop"), { recursive: true });
  appendFileSync(verifyLogPath(itemDir, taskId), `## kf verify ${at.toISOString()} exit=${result.code}\n${result.lines.map((l) => `  ${l}`).join("\n")}\n`);
}
