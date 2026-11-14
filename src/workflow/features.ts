import { readdirSync, existsSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { STAGES, ARTIFACTS, STAGE_GATES, METADATA_FILE, UC_FILE_PATTERN, isStageOrLegacy, type Stage, type LegacyStageName, type ApprovalStatus, type WorkItemKind } from "./schema.js";
import { writeFileAtomic } from "../shared/paths.js";
import { withLock, type LockOptions } from "../shared/lock.js";
import { recordChange, sharedMeta, withItemId, type ItemEvent } from "./item-log.js";

export interface Approval {
  status: ApprovalStatus;
  by?: string;
  at?: string;
  contractHash?: string;
  /** Set by `kf approve` from the living-docs release on; items approved earlier carry no marker and skip the docs rules. */
  livingDocs?: true;
}

/** One deliberate gate/hook bypass (`--force` / `--skip-hooks`), appended by the CLI and never removed by it. */
export interface Bypass {
  at: string;
  from: Stage | LegacyStageName | null;
  to: Stage | LegacyStageName;
  flag: "force" | "skip-hooks";
  /** Validation codes that were ignored, or `hook:<path>` for a skipped hook. */
  codes: string[];
}

/** Why a work item was stopped for good, and where it stood when that happened. */
export interface Cancellation {
  at: string;
  by: string;
  reason: string;
  fromStage: Stage | LegacyStageName;
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

export interface VerifyWaiver {
  reason: string;
  at: string;
  by: string;
}

/**
 * The contract estimate `kf approve` records: the agent minutes, the files the plan names (null when unknown, with how
 * exact the count is), the size of minutes × the learned factor against those files, and when; or none, and why.
 */
export type ItemEstimate =
  | { minutes: number; files: number | null; filesMark: "exact" | "partial" | "unknown"; size: "S" | "M" | "L" | "XL"; factor: number; at: string }
  | { none: true; reason: string; at: string };

/** The files the item's branch changed, counted when it enters review; null with the reason when it could not be counted. */
export type FilesChanged = { count: number | null; reason?: string; at: string };

export interface FeatureMeta {
  /** The item's uuid, written by `kf new`; an item of an earlier release gets one at its first lifecycle write. */
  id?: string;
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
  /** Unpushed branch the close committed canonical docs to, when the primary checkout was not a safe place for them. */
  docsBranch?: string;
  /** The commit the close made on `docsBranch`; items closed by earlier versions have none. */
  docsCommit?: string;
  /** `docsBranch` once `kf status --all` (or a done-item `kf archive`) proved it landed; replaces it so later polls skip it. */
  docsLanded?: { branch: string; by: "ancestor" | "merged-pr" | "content"; at: string };
  approval?: Approval;
  executionId?: string;
  status?: "archived" | "cancelled";
  cancellation?: Cancellation;
  bypasses?: Bypass[];
  /** Git worktree + domain allocated for implementation; absent until created. */
  worktree?: WorktreeRegistration;
  /** The human's reason to enter review with no stage verify pinned; `kf verify --stage --waive` writes it. */
  verifyWaiver?: VerifyWaiver;
  /** Progress of the removed `kf ship` pipeline. Nothing writes it now; items shipped by earlier releases still carry it, so it must keep loading. */
  ship?: ShipState;
  /** The contract estimate recorded by `kf approve`. */
  estimate?: ItemEstimate;
  /** The files changed, recorded on entering review. */
  filesChanged?: FilesChanged;
}

/** Per-step progress recorded by the removed `kf ship` pipeline — read-only legacy metadata. */
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
    || (meta.id !== undefined && typeof meta.id !== "string")
    || (meta.kind !== undefined && !["feature", "bug"].includes(meta.kind))
    || (meta.issue !== undefined && (typeof meta.issue !== "string" || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/issues\/\d+$/.test(meta.issue)))
    || (meta.pr !== undefined && (typeof meta.pr !== "string" || !/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(meta.pr)))
    || (meta.delivered !== undefined && typeof meta.delivered !== "boolean")
    || (meta.deliveredAt !== undefined && typeof meta.deliveredAt !== "string")
    // The close only ever names it docs/<context>-<feature>; it is printed in commands to copy, so nothing else passes.
    || (meta.docsBranch !== undefined && (typeof meta.docsBranch !== "string"
      || meta.docsBranch !== `docs/${meta.context}-${meta.feature}` || !/^docs\/[a-z0-9][a-z0-9_-]*$/i.test(meta.docsBranch)))
    || (meta.docsCommit !== undefined && (typeof meta.docsCommit !== "string" || !/^[0-9a-f]{40,64}$/.test(meta.docsCommit)))
    || (meta.docsLanded !== undefined && (!meta.docsLanded || typeof meta.docsLanded.branch !== "string"
      || !["ancestor", "merged-pr", "content"].includes(meta.docsLanded.by) || typeof meta.docsLanded.at !== "string"))
    || (meta.executionId !== undefined && typeof meta.executionId !== "string")
    || (meta.approval !== undefined && (!meta.approval
      || !["pending", "approved"].includes(meta.approval.status)
      || (meta.approval.contractHash !== undefined && typeof meta.approval.contractHash !== "string")
      || (meta.approval.livingDocs !== undefined && meta.approval.livingDocs !== true)))
    || (meta.bypasses !== undefined && (!Array.isArray(meta.bypasses) || !meta.bypasses.every(isBypass)))
    || (meta.status !== undefined && meta.status !== "archived" && meta.status !== "cancelled")
    || (meta.cancellation !== undefined && !isCancellation(meta.cancellation))
    || (meta.worktree !== undefined && !isWorktreeRegistration(meta.worktree))
    || (meta.verifyWaiver !== undefined && !isVerifyWaiver(meta.verifyWaiver))
    || (meta.ship !== undefined && !isShipState(meta.ship))) {
    throw new Error(`Invalid feature metadata: ${f}`);
  }
  // A measurement this release cannot read (malformed, or written by a later one) is treated as absent: it must never
  // make the item unreadable, because an unreadable item cannot close.
  if (meta.estimate !== undefined && !isItemEstimate(meta.estimate)) delete meta.estimate;
  if (meta.filesChanged !== undefined && !isFilesChanged(meta.filesChanged)) delete meta.filesChanged;
  assertPathName(meta.feature, "feature");
  assertPathName(meta.context, "context");
  return meta;
}

// History written by earlier releases names `dones` and `shipping`; an item must still load so
// the one-time migration can rewrite it, so these readers accept the legacy names alongside STAGES.
function isBypass(value: unknown): value is Bypass {
  if (!value || typeof value !== "object") return false;
  const b = value as Partial<Bypass>;
  return typeof b.at === "string" && (b.from === null || (typeof b.from === "string" && isStageOrLegacy(b.from)))
    && typeof b.to === "string" && isStageOrLegacy(b.to)
    && (b.flag === "force" || b.flag === "skip-hooks")
    && Array.isArray(b.codes) && b.codes.every((c) => typeof c === "string");
}

function isItemEstimate(value: unknown): value is ItemEstimate {
  if (!value || typeof value !== "object") return false;
  // The cast only opens the fields to reading; each one is checked below before the guard says yes.
  const e = value as Record<string, unknown>;
  if (typeof e.at !== "string") return false;
  if (e.none === true) return typeof e.reason === "string";
  return typeof e.minutes === "number" && (e.files === null || typeof e.files === "number")
    && (e.filesMark === "exact" || e.filesMark === "partial" || e.filesMark === "unknown")
    && (e.size === "S" || e.size === "M" || e.size === "L" || e.size === "XL") && typeof e.factor === "number";
}

function isFilesChanged(value: unknown): value is FilesChanged {
  if (!value || typeof value !== "object") return false;
  // The cast only opens the fields to reading; each one is checked below before the guard says yes.
  const c = value as Record<string, unknown>;
  return (c.count === null || typeof c.count === "number") && (c.reason === undefined || typeof c.reason === "string")
    && typeof c.at === "string";
}

function isVerifyWaiver(value: unknown): value is VerifyWaiver {
  if (!value || typeof value !== "object") return false;
  const w = value as Partial<VerifyWaiver>;
  return typeof w.reason === "string" && typeof w.at === "string" && typeof w.by === "string";
}

function isCancellation(value: unknown): value is Cancellation {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Cancellation>;
  return typeof c.at === "string" && typeof c.by === "string" && typeof c.reason === "string"
    && typeof c.fromStage === "string" && isStageOrLegacy(c.fromStage);
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
 * With `event`, the write is a lifecycle change: the item gets an id when it has none, and the
 * change is appended to its lifecycle log once the write has succeeded. Without it (a machine-local
 * write such as the worktree record) nothing is stamped or recorded.
 */
export async function updateFeatureMeta(
  root: string,
  name: string,
  fn: (meta: FeatureMeta) => FeatureMeta | Promise<FeatureMeta>,
  lock: LockOptions = {},
  event?: ItemEvent,
): Promise<Feature> {
  return withLock(root, name, async () => {
    const feature = findFeature(root, name);
    if (!feature?.meta) throw new Error(`Work item '${name}' disappeared or lost its metadata while it was being updated.`);
    const changed = await fn(feature.meta);
    const meta = event ? withItemId(changed, feature.dir) : changed;
    await writeFeatureMeta(feature.dir, meta);
    if (event) {
      recordChange(root, feature.dir, feature.name, event,
        { stage: feature.stage, meta: sharedMeta(feature.meta) }, { stage: feature.stage, meta: sharedMeta(meta) });
    }
    return { ...feature, meta };
  }, lock);
}

/**
 * `meta` with a proven landing of `branch` in place of its docs-branch record. The proof was
 * made outside the lock, so a record that moved on since (a re-land, another close) is kept.
 */
export function withDocsLanded(meta: FeatureMeta, branch: string, by: "ancestor" | "merged-pr" | "content"): FeatureMeta {
  if (meta.docsBranch !== branch) return meta;
  const { docsBranch: _branch, docsCommit: _commit, ...rest } = meta;
  return { ...rest, docsLanded: { branch, by, at: new Date().toISOString() } };
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

/** List all features found under a `.works` root, in stage order (brainstorm → done). */
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

/** More than one work item answers to the name; the caller has to ask for a full folder name. */
export class AmbiguousFeatureError extends Error {}

/** Find a single feature by name across all stages. */
export function findFeature(root: string, name: string): Feature | null {
  const matches = listFeatures(root).filter((f) => f.name === name || f.folder === name);
  if (matches.length > 1) {
    throw new AmbiguousFeatureError(`Ambiguous feature '${name}': select its full folder name (${matches.map((f) => f.folder).join(", ")}).`);
  }
  return matches[0] ?? null;
}

/** Ensure the workflow stage folders exist under root. */
export function ensureWorksStructure(root: string): void {
  for (const stage of STAGES) {
    mkdirSync(join(root, ".works", stage), { recursive: true });
  }
}

export function stageDir(root: string, stage: Stage): string {
  return join(root, ".works", stage);
}

export function featureFolderName(feature: string, ts: string): string {
  return `${feature}_${ts}`;
}
