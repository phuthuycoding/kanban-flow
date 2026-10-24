import { readdirSync, existsSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { STAGES, ARTIFACTS, STAGE_GATES, METADATA_FILE, UC_FILE_PATTERN, type Stage, type ApprovalStatus, type WorkItemKind } from "./schema.js";
import { writeFileAtomic } from "../shared/paths.js";
import { withLock } from "../shared/lock.js";
import { isPidAlive } from "../shared/process.js";

export interface Approval {
  status: ApprovalStatus;
  by?: string;
  at?: string;
  contractHash?: string;
}

/** One deliberate gate/hook bypass (`--force` / `--skip-hooks`), appended by the CLI and never removed by it. */
export interface Bypass {
  at: string;
  from: Stage | null;
  to: Stage;
  flag: "force" | "skip-hooks";
  /** Validation codes that were ignored, or `hook:<path>` for a skipped hook. */
  codes: string[];
}

/** Why a work item was stopped for good, and where it stood when that happened. */
export interface Cancellation {
  at: string;
  by: string;
  reason: string;
  fromStage: Stage;
}

export type RunStatus = "running" | "done" | "failed" | "timeout" | "reset";

/** One `kf run` invocation of a worker agent for a stage; appended by the CLI, updated when the worker exits. */
export interface RunRecord {
  id: string;
  /** Job in the workflow (writer, coder…); also the session key for this work item. */
  role: string;
  /** Runner that actually executed the role, kept so a role can change model later. */
  runner: string;
  stage: Stage;
  mode: "start" | "resume";
  session?: string;
  at: string;
  /** Log path relative to the feature dir so it moves with the folder. */
  log: string;
  /** Position in the stage's role chain, so a chain that stopped early is visible. */
  chain?: { id: string; index: number; total: number };
  /** Task id when this run executed one planned task (`kf run --task`). */
  task?: string;
  status: RunStatus;
  exitCode?: number;
  pid?: number;
  supervisorPid?: number;
  endedAt?: string;
  statusLine?: string | null;
  summary?: string;
  warning?: string;
  error?: string;
  usage?: { input: number; output: number; costUsd?: number };
}

/** The worktree record an item's `.kfw.json` carries once it has an environment. */
export interface WorktreeRegistration {
  path: string;
  branch: string;
  domain: string;
  port: number;
  createdAt: string;
}

function isWorktreeRegistration(value: unknown): value is WorktreeRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const w = value as Partial<WorktreeRegistration>;
  return typeof w.path === "string" && typeof w.branch === "string"
    && typeof w.domain === "string" && typeof w.port === "number"
    && (w.createdAt === undefined || typeof w.createdAt === "string");
}

export interface FeatureMeta {
  schema: string;
  feature: string;
  context: string;
  created: string;
  kind?: WorkItemKind;
  goal?: string;
  /** URL of the GitHub issue this work item mirrors to; written by `kf issues` or a stage hook. */
  issue?: string;
  /** URL of the pull request that delivers this work item; written by `kf issues link`. */
  pr?: string;
  /** Set by `kf archive` — archive is the delivery gate and stamps this last in its pass. */
  delivered?: boolean;
  deliveredAt?: string;
  approval?: Approval;
  executionId?: string;
  status?: "archived" | "cancelled";
  cancellation?: Cancellation;
  bypasses?: Bypass[];
  /** Worker session per role, scoped to this work item. */
  sessions?: Record<string, string>;
  runs?: RunRecord[];
  /** Git worktree + domain allocated for implementation; absent until created. */
  worktree?: WorktreeRegistration;
  /** Ship pipeline progress; written by `kf ship`, absent until it first runs. */
  ship?: ShipState;
  /** Per-task progress of the task harness, keyed by task id; tasks with no entry are pending or ready (computed). */
  tasks?: Record<string, TaskState>;
  /** State of the item's `kf drive`; written only by the driver and `kf drive --stop`. */
  drive?: DriveState;
}

export const DRIVE_STATUSES = ["running", "stopped", "ready"] as const;
export type DriveStatus = (typeof DRIVE_STATUSES)[number];

export const DRIVE_STOP_CODES = [
  "loop_limit", "requirement_bug", "worker_blocked", "plan_change_needed", "tasks_blocked", "verify_failed",
  "transition_refused", "approval_changed", "config_changed", "budget", "stopped_by_user", "git_error", "internal_error",
] as const;
export type DriveStopCode = (typeof DRIVE_STOP_CODES)[number];

export interface DriveState {
  id: string;
  status: DriveStatus;
  /** Where the driver is (or stopped): implementation | repair | verify | testing | review. */
  step: string;
  /** Repair loops used; shared by testing and review. */
  loops: number;
  /** Worker runs started by this drive, retries and repairs included. */
  runs: number;
  stopCode?: DriveStopCode;
  reason?: string;
  nextCommand?: string;
  /** Hash of harness.roles, harness.runners, harness.verify and worktree.enabled when the drive (re)started. */
  configHash: string;
  /** The same four sections hashed one by one, so a change can be named. */
  configParts?: Record<string, string>;
  /** Approval fingerprint at (re)start; a different one stops the drive. */
  approvalHash?: string;
  /** Report file (in the item folder) a pending repair run must fix; set while step is `repair`. */
  repairReport?: string;
  /** Warnings the driver recorded, e.g. a failed drive-stop hook. */
  warnings?: string[];
  supervisorPid?: number;
  startedAt: string;
  updatedAt: string;
}

/** A drive is live while it is running and its supervisor (the detached process, or the claiming CLI until it hands over) answers. */
export function driveLive(drive: DriveState | undefined): boolean {
  return drive?.status === "running" && isPidAlive(drive.supervisorPid);
}

function isDriveState(value: unknown): value is DriveState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const d = value as Partial<DriveState>;
  const int = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return typeof d.id === "string" && typeof d.status === "string" && (DRIVE_STATUSES as readonly string[]).includes(d.status)
    && typeof d.step === "string" && int(d.loops) && int(d.runs)
    && (d.stopCode === undefined || (DRIVE_STOP_CODES as readonly string[]).includes(d.stopCode))
    && (d.reason === undefined || typeof d.reason === "string")
    && (d.nextCommand === undefined || typeof d.nextCommand === "string")
    && typeof d.configHash === "string"
    && (d.configParts === undefined || (!!d.configParts && typeof d.configParts === "object" && !Array.isArray(d.configParts)
      && Object.values(d.configParts).every((h) => typeof h === "string")))
    && (d.approvalHash === undefined || typeof d.approvalHash === "string")
    && (d.repairReport === undefined || typeof d.repairReport === "string")
    && (d.warnings === undefined || (Array.isArray(d.warnings) && d.warnings.every((w) => typeof w === "string")))
    && (d.supervisorPid === undefined || int(d.supervisorPid))
    && typeof d.startedAt === "string" && typeof d.updatedAt === "string";
}

export const TASK_STATES = ["pending", "ready", "running", "verifying", "merging", "done", "failed", "blocked"] as const;
export type TaskStateName = (typeof TASK_STATES)[number];

export interface TaskState {
  state: TaskStateName;
  reason?: string;
  attempts?: number;
  branch?: string;
  base?: string;
  mergeSha?: string;
  /** Item branch HEAD recorded just before a task merge; the reset target when verify fails. */
  preMergeSha?: string;
  session?: string;
  updatedAt?: string;
}

function isTaskState(value: unknown): value is TaskState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const t = value as Partial<TaskState>;
  return typeof t.state === "string" && (TASK_STATES as readonly string[]).includes(t.state)
    && (t.reason === undefined || typeof t.reason === "string")
    && (t.attempts === undefined || (typeof t.attempts === "number" && Number.isInteger(t.attempts) && t.attempts >= 0))
    && (t.branch === undefined || typeof t.branch === "string")
    && (t.base === undefined || typeof t.base === "string")
    && (t.mergeSha === undefined || typeof t.mergeSha === "string")
    && (t.preMergeSha === undefined || typeof t.preMergeSha === "string")
    && (t.session === undefined || typeof t.session === "string")
    && (t.updatedAt === undefined || typeof t.updatedAt === "string");
}

/** Per-step ship progress so `kf ship` stays resumable/idempotent. */
export interface ShipState {
  /** ISO stamp — PR created/recorded (meta.pr is the value itself). */
  published?: string;
  /** ISO stamp — `gh pr merge --auto` scheduled once under merge:auto. */
  autoMerge?: string;
  /** ISO stamp — gh observed the recorded PR merged. */
  merged?: string;
  /** "done" | "skipped" — release step outcome. */
  release?: "done" | "skipped";
  releaseTag?: string;
  /** "done" | "skipped" — changelog step outcome. */
  changelog?: "done" | "skipped";
}

function isShipState(value: unknown): value is ShipState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const s = value as Partial<ShipState>;
  return (s.published === undefined || typeof s.published === "string")
    && (s.autoMerge === undefined || typeof s.autoMerge === "string")
    && (s.merged === undefined || typeof s.merged === "string")
    && (s.release === undefined || s.release === "done" || s.release === "skipped")
    && (s.releaseTag === undefined || typeof s.releaseTag === "string")
    && (s.changelog === undefined || s.changelog === "done" || s.changelog === "skipped");
}

export interface Feature {
  name: string;
  context: string | null;
  stage: Stage;
  dir: string;
  folder: string;
  meta: FeatureMeta | null;
  /** Set when .kfw.json exists but failed to parse/validate. */
  metaError?: string;
}

/** Walk up from cwd to find the directory containing `.works/`. */
export function findWorksRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".works"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return worksRootViaGitCommonDir(resolve(start));
}

/**
 * `.works/` is gitignored, so a linked worktree never carries it — walking up from a
 * worktree finds nothing. `git rev-parse --git-common-dir` then points back at the
 * main checkout's `.git`, whose parent is the project root kf actually manages.
 */
function worksRootViaGitCommonDir(start: string): string | null {
  // `git -C` needs a directory that exists — climb to the nearest one that does.
  let dir = resolve(start);
  while (!existsSync(dir) || !statSync(dir).isDirectory()) {
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  let commonDir: string;
  try {
    commonDir = execFileSync(
      "git",
      ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return null; // not inside a git worktree — nothing more to try
  }
  if (!commonDir) return null;
  const mainRoot = dirname(commonDir);
  return existsSync(join(mainRoot, ".works")) ? mainRoot : null;
}

/** A feature folder is `{feature}_{YYYYMMDD_HHmm}` (timestamp trailing part). */
export function parseFolderName(folder: string): { name: string; ts: string | null } {
  const m = /^(.+?)_(\d{8}_\d{4})$/.exec(folder);
  if (m) return { name: m[1], ts: m[2] };
  return { name: folder, ts: null };
}

export function readFeatureMeta(dir: string): FeatureMeta | null {
  const f = join(dir, METADATA_FILE);
  if (!existsSync(f)) return null;
  let meta: FeatureMeta | null;
  try {
    meta = JSON.parse(readFileSync(f, "utf8")) as FeatureMeta | null;
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid JSON in feature metadata: ${f}`, { cause: err });
    throw err;
  }
  if (!meta || meta.schema !== "kanban-flow" || typeof meta.feature !== "string"
    || typeof meta.context !== "string" || typeof meta.created !== "string"
    || (meta.kind !== undefined && !["feature", "bug"].includes(meta.kind))
    || (meta.issue !== undefined && (typeof meta.issue !== "string" || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/issues\/\d+$/.test(meta.issue)))
    || (meta.pr !== undefined && (typeof meta.pr !== "string" || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(meta.pr)))
    || (meta.delivered !== undefined && typeof meta.delivered !== "boolean")
    || (meta.deliveredAt !== undefined && typeof meta.deliveredAt !== "string")
    || (meta.executionId !== undefined && typeof meta.executionId !== "string")
    || (meta.approval !== undefined && (!meta.approval
      || !["pending", "approved"].includes(meta.approval.status)
      || (meta.approval.contractHash !== undefined && typeof meta.approval.contractHash !== "string")))
    || (meta.bypasses !== undefined && (!Array.isArray(meta.bypasses) || !meta.bypasses.every(isBypass)))
    || (meta.sessions !== undefined && (!meta.sessions || typeof meta.sessions !== "object" || Array.isArray(meta.sessions)
      || !Object.values(meta.sessions).every((s) => typeof s === "string")))
    || (meta.runs !== undefined && (!Array.isArray(meta.runs) || !meta.runs.every(isRunRecord)))
    || (meta.status !== undefined && meta.status !== "archived" && meta.status !== "cancelled")
    || (meta.cancellation !== undefined && !isCancellation(meta.cancellation))
    || (meta.worktree !== undefined && !isWorktreeRegistration(meta.worktree))
    || (meta.ship !== undefined && !isShipState(meta.ship))
    || (meta.tasks !== undefined && (!meta.tasks || typeof meta.tasks !== "object" || Array.isArray(meta.tasks)
      || !Object.values(meta.tasks).every(isTaskState)))
    || (meta.drive !== undefined && !isDriveState(meta.drive))) {
    throw new Error(`Invalid feature metadata: ${f}`);
  }
  assertPathName(meta.feature, "feature");
  assertPathName(meta.context, "context");
  return meta;
}

function isBypass(value: unknown): value is Bypass {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Bypass>;
  return typeof b.at === "string" && (b.from === null || (typeof b.from === "string" && STAGES.includes(b.from)))
    && typeof b.to === "string" && STAGES.includes(b.to)
    && (b.flag === "force" || b.flag === "skip-hooks")
    && Array.isArray(b.codes) && b.codes.every((c) => typeof c === "string");
}

function isCancellation(value: unknown): value is Cancellation {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Cancellation>;
  return typeof c.at === "string" && typeof c.by === "string" && typeof c.reason === "string"
    && typeof c.fromStage === "string" && STAGES.includes(c.fromStage);
}

const RUN_STATUSES = ["running", "done", "failed", "timeout", "reset"];

function isRunRecord(value: unknown): value is RunRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<RunRecord>;
  if (r.chain !== undefined && (typeof r.chain !== "object" || r.chain === null
    || typeof r.chain.id !== "string" || typeof r.chain.index !== "number" || typeof r.chain.total !== "number")) return false;
  if (r.task !== undefined && typeof r.task !== "string") return false;
  return typeof r.id === "string" && typeof r.role === "string" && typeof r.runner === "string"
    && typeof r.stage === "string" && STAGES.includes(r.stage)
    && (r.mode === "start" || r.mode === "resume") && typeof r.at === "string" && typeof r.log === "string"
    && typeof r.status === "string" && RUN_STATUSES.includes(r.status);
}

export async function writeFeatureMeta(
  dir: string,
  meta: FeatureMeta,
): Promise<void> {
  await writeFileAtomic(join(dir, METADATA_FILE), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Read-modify-write of one item's `.kfw.json` under its lock. The item is re-found by name
 * inside the lock because a stage move may have renamed its folder since the caller looked.
 */
export async function updateFeatureMeta(
  root: string,
  name: string,
  fn: (meta: FeatureMeta) => FeatureMeta | Promise<FeatureMeta>,
): Promise<Feature> {
  return withLock(root, name, async () => {
    const feature = findFeature(root, name);
    if (!feature?.meta) throw new Error(`Work item '${name}' disappeared or lost its metadata while it was being updated.`);
    const meta = await fn(feature.meta);
    await writeFeatureMeta(feature.dir, meta);
    return { ...feature, meta };
  });
}

export function assertPathName(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) {
    throw new Error(`Invalid ${label} '${value}': use letters, digits, hyphens or underscores, starting with a letter or digit.`);
  }
}

export function executionContractHash(dir: string, kind: WorkItemKind = "feature"): string | null {
  const hash = createHash("sha256");
  const contractArtifacts = kind === "bug"
    ? (["spec-requirement"] as const)
    : (["spec-requirement", ...STAGE_GATES.planning] as const);
  for (const id of contractArtifacts) {
    const file = ARTIFACTS[id].file;
    const path = join(dir, file);
    if (!existsSync(path)) return null;
    hash.update(JSON.stringify([file, readFileSync(path, "utf8")]));
  }
  if (kind === "feature") {
    const useCaseDir = join(dir, "use-cases");
    if (existsSync(useCaseDir)) {
      for (const file of readdirSync(useCaseDir).filter((entry) => UC_FILE_PATTERN.test(entry)).sort()) {
        hash.update(JSON.stringify([`use-cases/${file}`, readFileSync(join(useCaseDir, file), "utf8")]));
      }
    }
  }
  return hash.digest("hex");
}

/** True only for a real, readable directory. Anything else is not a stage we can walk. */
function isDirectory(path: string): boolean {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats !== undefined && stats.isDirectory();
}

/** List all features found under a `.works` root, in stage order (brainstorm → dones). */
export function listFeatures(root: string): Feature[] {
  const out: Feature[] = [];
  // Within a stage, sort by folder name desc — the trailing timestamp approximates newest first.
  for (const stage of STAGES) {
    const stageDir = join(root, ".works", stage);
    // A stage path that is not a directory — a stray file, a dangling link — used to reach
    // readdirSync and throw ENOTDIR out of every command that lists work items. A malformed
    // tree is exactly when `kf list` and `kf doctor` have to keep working; `kf doctor` reports
    // the missing stage separately, so skipping here loses nothing.
    if (!isDirectory(stageDir)) continue;
    const folders = readdirSync(stageDir)
      .map((folder) => {
        const dir = join(stageDir, folder);
        // `throwIfNoEntry: false` covers exactly one case: a symlink whose target is gone. That
        // used to throw a raw ENOENT out of every command that lists features, so one dangling
        // link made `kf list` — the command you run to find out what is wrong — unusable. Any
        // other stat failure (EACCES, ELOOP) still propagates; this is not a blanket guard.
        //
        // A missing target falls through rather than returning null: if the name looks like a
        // work item it is reported with no metadata, so `kf validate` calls it invalid instead
        // of the item silently disappearing.
        const stats = statSync(dir, { throwIfNoEntry: false });
        if (stats && !stats.isDirectory()) return null;
        const parsed = parseFolderName(folder);
        let meta: FeatureMeta | null = null;
        let metaError: string | undefined;
        try {
          meta = readFeatureMeta(dir);
        } catch (err) {
          metaError = err instanceof Error ? err.message : String(err);
        }
        if (!meta && !metaError && !parsed.ts) return null;
        return { folder, dir, name: (meta && meta.feature) || parsed.name, meta, metaError };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => (b.folder.localeCompare(a.folder)));
    for (const f of folders) {
      out.push({
        name: f.name,
        context: f.meta ? f.meta.context : null,
        stage,
        dir: f.dir,
        folder: f.folder,
        meta: f.meta,
        metaError: f.metaError,
      });
    }
  }
  return out;
}

/** Find a single feature by name across all stages. */
export function findFeature(root: string, name: string): Feature | null {
  const matches = listFeatures(root).filter((f) => f.name === name || f.folder === name);
  if (matches.length > 1) {
    throw new Error(`Ambiguous feature '${name}': select its full folder name (${matches.map((f) => f.folder).join(", ")}).`);
  }
  return matches[0] ?? null;
}

/** Ensure the workflow folders and canonical documentation roots exist under root. */
export function ensureWorksStructure(root: string): void {
  for (const stage of STAGES) {
    mkdirSync(join(root, ".works", stage), { recursive: true });
  }
  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    mkdirSync(join(root, "docs", docsDir), { recursive: true });
  }
}

export function stageDir(root: string, stage: Stage): string {
  return join(root, ".works", stage);
}

export function featureFolderName(feature: string, ts: string): string {
  return `${feature}_${ts}`;
}
