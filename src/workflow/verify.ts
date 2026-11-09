import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACTS } from "./schema.js";
import type { Feature } from "./features.js";
import { parseTaskGraph, taskView } from "./tasks.js";
import type { PlannedTask } from "./tasks.js";
import { pathAllowed } from "./allowlist.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { addDetachedWorktree, removeWorktree, runGit, trackedChanges } from "../shared/git.js";
import { readProjectConfig } from "../project/config.js";
import { readLoopInputs } from "./next/inputs.js";
import type { StageRecord, StepOutcome } from "./stage-record.js";

const OUTPUT_TAIL = 2000;
const VERIFY_MAX_BUFFER = 64 * 1024 * 1024;

export type VerifyCode = 0 | 1 | 2 | 3;

export interface VerifyResult {
  code: VerifyCode;
  lines: string[];
}

export interface StepsResult {
  steps: StepOutcome[];
  /** stdout then stderr of every command that ran, in order. */
  output: string;
  /** The text `runVerify` returns: the first failure, or null when all pass. */
  failure: string | null;
}

/**
 * Run the verify argv list in `cwd`, in order, without a shell, stopping at the first failure; every configured
 * command gets an outcome, those after the failure `not-run`.
 */
export function runVerifySteps(commands: string[][], cwd: string): StepsResult {
  const steps: StepOutcome[] = [];
  let output = "";
  let failure: string | null = null;
  for (const argv of commands) {
    if (failure !== null) {
      steps.push({ argv, outcome: "not-run" });
      continue;
    }
    // No timeout on purpose: the loop that calls kf verify owns the time budget, and a test command's own timeout still applies.
    const res = spawnSync(argv[0], argv.slice(1), {
      cwd, encoding: "utf8", maxBuffer: VERIFY_MAX_BUFFER, stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error) {
      const code = (res.error as NodeJS.ErrnoException).code;
      failure = code === "ENOENT" ? `verify command not found: ${argv[0]}` : `verify command ${argv.join(" ")} could not finish: ${res.error.message}`;
      steps.push({ argv, outcome: "not-started", error: failure });
      continue;
    }
    const ran = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    output += ran;
    if (res.status === 0) {
      steps.push({ argv, outcome: "exit", code: 0 });
      continue;
    }
    if (res.status !== null) steps.push({ argv, outcome: "exit", code: res.status });
    else steps.push({ argv, outcome: "signal", signal: String(res.signal) });
    const how = res.status !== null ? `exit ${res.status}` : `signal ${res.signal}`;
    const head = `verify command failed (${how}): ${argv.join(" ")}`;
    const trimmed = ran.trim();
    failure = trimmed ? `${head}\n${trimmed.slice(-OUTPUT_TAIL)}` : head;
  }
  return { steps, output, failure };
}

/**
 * Run the verify argv list in `cwd`, in order, without a shell; returns the first failure naming the command and
 * its exit code (followed by the output tail), or null when all pass.
 */
export function runVerify(commands: string[][], cwd: string): string | null {
  return runVerifySteps(commands, cwd).failure;
}

/** The item's worktree when it has one, else the project root; the line says which. */
function itemDir(root: string, feature: Feature): { dir: string; line: string } {
  const wt = feature.meta?.worktree?.path;
  if (wt) return { dir: wt, line: `Running in the item worktree ${wt}` };
  return { dir: root, line: "no worktree — running in the project root" };
}

function runCommands(commands: string[][] | undefined, dir: string, what: "task" | "stage", lines: string[], named = false): VerifyResult {
  if (!commands || commands.length === 0) {
    lines.push(`No ${what} verify configured (harness.verify.${what}).`);
    return { code: 0, lines };
  }
  const { steps, failure } = runVerifySteps(commands, dir);
  if (named) for (const step of steps) if (step.outcome === "exit" || step.outcome === "signal") lines.push(`Ran: ${step.argv.join(" ")}`);
  if (failure !== null) {
    lines.push(failure);
    return { code: 1, lines };
  }
  lines.push(`All ${commands.length} ${what} verify command(s) passed.`);
  return { code: 0, lines };
}

const bad = (reason: string): VerifyResult => ({ code: 3, lines: [reason] });

/** The related-tests argv: the pinned command with the files appended as argv elements, never joined into a shell string. */
export function relatedArgv(related: string[], files: string[]): string[] {
  return [...related, ...files];
}

/**
 * The files a task changed, repo-relative and sorted: `base..HEAD`, or the union of each listed commit against its
 * parent. Deleted files are dropped and a rename gives its new path, because these are the files a test can still load.
 */
export function taskChangedFiles(dir: string, range: { base: string } | { commits: string[] }): string[] {
  const diffs = "base" in range ? [[`${range.base}..HEAD`]] : range.commits.map((sha) => [`${sha}^`, sha]);
  const files = new Set<string>();
  for (const spec of diffs) {
    const diff = runGit(dir, ["diff", "--name-only", "-z", "--diff-filter=d", "-M", ...spec]);
    if (diff.code !== 0) throw new Error(`git diff --name-only ${spec.join(" ")} failed in ${dir}: ${diff.stderr.trim()}`);
    for (const f of diff.stdout.split("\0")) if (f !== "") files.add(f);
  }
  return [...files].sort();
}

/** Pinned `harness.verify.related`, or null when the project has none (the task tier then runs exactly as before). */
function pinnedRelated(root: string): string[] | null {
  const related = readProjectConfig(root).harness?.verify?.related;
  return related && related.length > 0 ? related : null;
}

/**
 * The task tier: `harness.verify.task` in order, then the related command with the task's changed files that exist in
 * `dir` appended. Every command that ran is named on a `Ran:` line. `changed` is read only here, so a project with no
 * related command never runs the extra diff.
 */
function runTaskTier(root: string, dir: string, sha: string, changed: () => string[], lines: string[]): VerifyResult {
  const commands = [...(readProjectConfig(root).harness?.verify?.task ?? [])];
  const related = pinnedRelated(root);
  if (related === null) return runCommands(commands, dir, "task", lines);
  const existing = changed().filter((f) => existsSync(join(dir, f)));
  if (existing.length > 0) commands.push(relatedArgv(related, existing));
  else lines.push(`No related tests: the task changed no file that exists at ${sha.slice(0, 7)}.`);
  return runCommands(commands, dir, "task", lines, true);
}

/** A bug has no plan: its tasks are the TASK-### checkbox lines of tasks.md, with Files unknown. */
function bugTaskAndDir(root: string, feature: Feature, taskId: string): { task: PlannedTask; dir: string; line: string } | VerifyResult {
  const read = readLoopInputs(root, feature);
  if (!read.ok) return bad(read.reason);
  const id = taskId.trim().toUpperCase();
  const found = read.inputs.tasks.find((t) => t.id === id);
  if (!found) return bad(`Unknown task '${taskId}': it is not in tasks.md of '${feature.name}'.`);

  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return bad(`The item worktree ${dir} does not exist.`);
  return { task: { id: found.id, description: "", dependencies: [], files: null }, dir, line };
}

/** The task from the plan and the item's directory, or the exit-3 result saying why not. */
function taskAndDir(root: string, feature: Feature, taskId: string): { task: PlannedTask; dir: string; line: string } | VerifyResult {
  if (feature.meta?.kind === "bug") return bugTaskAndDir(root, feature, taskId);
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
  if (pinnedRelated(root) === null) return runCommands(readProjectConfig(root).harness?.verify?.task, dir, "task", lines);
  const head = runGit(dir, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return bad(`git rev-parse HEAD failed in ${dir}: ${head.stderr.trim()}`);
  return runTaskTier(root, dir, head.stdout.trim(), () => taskChangedFiles(dir, { base }), lines);
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

  const taskCommands = readProjectConfig(root).harness?.verify?.task;
  if ((taskCommands ?? []).length === 0 && pinnedRelated(root) === null) return runCommands(taskCommands, dir, "task", lines);
  const changed = (): string[] => taskChangedFiles(dir, { commits: resolved });
  const tier = (path: string, sha: string): VerifyResult => runTaskTier(root, path, sha, changed, lines);
  if (!atHead) {
    const sha = resolved[resolved.length - 1];
    return runDetached(dir, sha, `Running in a detached worktree at ${sha.slice(0, 7)}`, lines, (path) => tier(path, sha));
  }
  const head = runGit(dir, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return bad(`git rev-parse HEAD failed in ${dir}: ${head.stderr.trim()}`);
  const sha = head.stdout.trim();
  return runDetached(dir, sha, `Running in a detached worktree at ${sha.slice(0, 7)}`, lines, (path) => tier(path, sha));
}

/**
 * The wave tier: `harness.verify.stage` once for a plan wave, in a temporary detached worktree at the HEAD of the
 * item's directory, so files written ahead for later waves (uncommitted tests) never reach the run. The run is a stage
 * record tagged with the wave; the review gate reads it like any other.
 */
export function verifyWave(root: string, feature: Feature, wave: number): VerifyResult & { record?: StageRecord } {
  const waves = feature.meta?.kind === "bug" ? new Set([1]) : new Set(taskView(feature).map((r) => r.wave));
  if (!waves.has(wave)) return bad(`Wave ${wave} has no task in the plan of '${feature.name}'.`);
  const { dir } = itemDir(root, feature);
  if (!existsSync(dir)) return bad(`The item worktree ${dir} does not exist.`);
  const commands = readProjectConfig(root).harness?.verify?.stage;
  if (!commands || commands.length === 0) return runCommands(commands, dir, "stage", []);
  const head = runGit(dir, ["rev-parse", "HEAD"]);
  if (head.code !== 0) return bad(`git rev-parse HEAD failed in ${dir}: ${head.stderr.trim()}`);
  const sha = head.stdout.trim();
  let record: StageRecord | undefined;
  const result = runDetached(dir, sha, `Running wave ${wave} verify in a detached worktree at ${sha.slice(0, 7)}`, [], (path, lines) => {
    const { steps, output, failure } = runVerifySteps(commands, path);
    const code = failure !== null ? 1 : 0;
    lines.push(failure ?? `All ${commands.length} stage verify command(s) passed.`);
    record = { at: new Date().toISOString(), sha, clean: true, commands: steps, outputSha256: createHash("sha256").update(output).digest("hex"), exit: code, wave };
    return { code, lines };
  });
  return record ? { ...result, record } : result;
}

/** Run `run` in a temporary detached worktree of `itemDir` at `sha`, removing it on every exit path. */
function runDetached(itemDir: string, sha: string, label: string, lines: string[], run: (path: string, lines: string[]) => VerifyResult): VerifyResult {
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
    lines.push(`${label} (${path})`);
    result = run(path, lines);
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
export function verifyStage(root: string, feature: Feature): VerifyResult & { record?: StageRecord } {
  const { dir, line } = itemDir(root, feature);
  if (!existsSync(dir)) return { code: 3, lines: [`The item worktree ${dir} does not exist.`] };
  const commands = readProjectConfig(root).harness?.verify?.stage;
  if (!commands || commands.length === 0) return runCommands(commands, dir, "stage", [line]);

  // HEAD and cleanliness are taken before the commands run: a command that edits a tracked file must not clean the record.
  const head = runGit(dir, ["rev-parse", "HEAD"]);
  const clean = head.code === 0 && trackedChanges(dir).length === 0;
  const lines = [line];
  const { steps, output, failure } = runVerifySteps(commands, dir);
  if (failure !== null) lines.push(failure);
  else lines.push(`All ${commands.length} stage verify command(s) passed.`);
  const code = failure !== null ? 1 : 0;
  if (head.code !== 0) {
    lines.push(`No stage record: ${dir} has no HEAD commit to record.`);
    return { code, lines };
  }
  const record: StageRecord = {
    at: new Date().toISOString(),
    sha: head.stdout.trim(),
    clean,
    commands: steps,
    outputSha256: createHash("sha256").update(output).digest("hex"),
    exit: code,
  };
  return { code, lines, record };
}

/** The log of a wave's runs, beside the ledger; not `task-NNN-verify.log`, which `kf next` and `kf loop-stats` read as a task's. */
export function waveVerifyLogPath(itemDir: string, wave: number): string {
  return join(itemDir, "loop", `wave-${wave}-verify.log`);
}

/** Append one wave run, in the task log's format. */
export function appendWaveVerifyLog(itemDir: string, wave: number, result: VerifyResult, at: Date = new Date()): void {
  mkdirSync(join(itemDir, "loop"), { recursive: true });
  appendFileSync(waveVerifyLogPath(itemDir, wave), `## kf verify ${at.toISOString()} exit=${result.code}\n${result.lines.join("\n").split("\n").map((l) => `  ${l}`).join("\n")}\n`);
}

/** The log `kf verify` writes beside the ledger: the ledger's verify lines are checked against it. */
export function verifyLogPath(itemDir: string, taskId: string): string {
  return join(itemDir, "loop", `${taskId.toLowerCase()}-verify.log`);
}

/** Append one run: a `## kf verify <ISO> exit=<n>` header, then the run's output indented, so output can never read as a header. */
export function appendVerifyLog(itemDir: string, taskId: string, result: VerifyResult, at: Date = new Date()): void {
  mkdirSync(join(itemDir, "loop"), { recursive: true });
  appendFileSync(verifyLogPath(itemDir, taskId), `## kf verify ${at.toISOString()} exit=${result.code}\n${result.lines.join("\n").split("\n").map((l) => `  ${l}`).join("\n")}\n`);
}
