import { readdirSync, existsSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

import { STAGES, ARTIFACTS, STAGE_GATES, METADATA_FILE, type Stage, type ApprovalStatus, type WorkItemKind } from "./schema.js";
import { writeFileAtomic } from "../shared/paths.js";

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

export interface FeatureMeta {
  schema: string;
  feature: string;
  context: string;
  created: string;
  kind?: WorkItemKind;
  goal?: string;
  approval?: Approval;
  executionId?: string;
  status?: "archived" | "cancelled";
  cancellation?: Cancellation;
  bypasses?: Bypass[];
  /** Worker session per role, scoped to this work item. */
  sessions?: Record<string, string>;
  runs?: RunRecord[];
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
    if (parent === dir) return null;
    dir = parent;
  }
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
    || (meta.executionId !== undefined && typeof meta.executionId !== "string")
    || (meta.approval !== undefined && (!meta.approval
      || !["pending", "approved"].includes(meta.approval.status)
      || (meta.approval.contractHash !== undefined && typeof meta.approval.contractHash !== "string")))
    || (meta.bypasses !== undefined && (!Array.isArray(meta.bypasses) || !meta.bypasses.every(isBypass)))
    || (meta.sessions !== undefined && (!meta.sessions || typeof meta.sessions !== "object" || Array.isArray(meta.sessions)
      || !Object.values(meta.sessions).every((s) => typeof s === "string")))
    || (meta.runs !== undefined && (!Array.isArray(meta.runs) || !meta.runs.every(isRunRecord)))
    || (meta.status !== undefined && meta.status !== "archived" && meta.status !== "cancelled")
    || (meta.cancellation !== undefined && !isCancellation(meta.cancellation))) {
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
      for (const file of readdirSync(useCaseDir).filter((entry) => /^UC-\d+\.md$/i.test(entry)).sort()) {
        hash.update(JSON.stringify([`use-cases/${file}`, readFileSync(join(useCaseDir, file), "utf8")]));
      }
    }
  }
  return hash.digest("hex");
}

/** List all features found under a `.works` root, in stage order (brainstorm → dones). */
export function listFeatures(root: string): Feature[] {
  const out: Feature[] = [];
  // Within a stage, sort by folder name desc — the trailing timestamp approximates newest first.
  for (const stage of STAGES) {
    const stageDir = join(root, ".works", stage);
    if (!existsSync(stageDir)) continue;
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
