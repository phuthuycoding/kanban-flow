import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS } from "../../workflow/schema.js";
import { splitFrontmatter } from "../../shared/frontmatter.js";
import {
  driveLive, findFeature, updateFeatureMeta,
  type DriveState, type DriveStopCode, type Feature,
} from "../../workflow/features.js";
import { approvalState } from "../../workflow/status.js";
import { checkTaskGraph, parseTaskGraph, type PlannedTask } from "../../workflow/tasks.js";
import { type Transition } from "../../workflow/transition.js";
import { ProjectConfigError, readProjectConfig, resolveDriveConfig, type DriveConfig, type DriveConfigSource } from "../../project/config.js";
import { type HarnessConfig } from "../config.js";
import { worktreeConfig } from "../../worktree/config.js";
import { isPidAlive } from "../../shared/process.js";
import { PKG_ROOT } from "../../shared/paths.js";
import { liveRecords } from "../run.js";
import { WORKTREE_REQUIRED } from "../task-run.js";
import { finishDrive } from "./control.js";

export interface DriveDeps {
  /** Stage moves go through this; tests pass a spy. It is only ever called without force or skipHooks. */
  transition?: Transition;
  timeoutMs?: number;
}

export interface DriveOutcome {
  status: "ready" | "stopped";
  stopCode?: DriveStopCode;
  reason: string;
  nextCommand: string;
  loops: number;
  runs: number;
}

export interface Stop {
  code: DriveStopCode;
  reason: string;
  /** Someone else (`--stop`) already recorded this stop; the supervisor must not write it again. */
  external?: boolean;
}

export type Step = "implementation" | "repair" | "verify" | "testing" | "review";

export const readyReason = (feature: string): string => `ready — review PASS: merge the PR, kf status --change ${feature} closes the item`;
const REASON_MAX = 700;

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const oneLine = (text: string, max = REASON_MAX): string => {
  const flat = text.replace(/\s*\n\s*/g, " | ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

class Refused extends Error {}

/** Where a stop or refusal tells the human to look: the resolved file and which of the three places it is. */
export const configWhere = (resolved: Pick<DriveConfig, "file" | "source">): string => `${resolved.file} (config source: ${resolved.source})`;

/** A running drive whose resolved config stopped parsing: the edit that broke it is a config change. */
export const brokenConfigStop = (name: string, err: ProjectConfigError): Stop => ({
  code: "config_changed",
  reason: `the drive config no longer parses: ${oneLine(message(err))}; fix it, then resume: kf drive ${name} --accept-config`,
});

// Every top-level harness key; the `satisfies` makes a new HarnessConfig key a compile error until it is hashed here.
const HARNESS_KEYS = Object.keys({
  main: true, roles: true, stages: true, runners: true, verify: true, parallel: true, retries: true, maxLoops: true, budget: true,
} satisfies Record<keyof HarnessConfig, true>) as (keyof HarnessConfig)[];

/**
 * The parts that hold the commands a drive runs. They are pinned as their JSON value rather than a hash, so a stop and
 * a resume can show the old and the new argv: the worktree copy they are read from is one workers can write.
 */
const ARGV_PARTS: Record<string, number> = { "harness.runners": 2, "harness.verify": 1 };
const json = (value: unknown): string => JSON.stringify(value ?? null);

interface ConfigSnapshot { hash: string; parts: Record<string, string>; values: Record<string, unknown>; source: DriveConfigSource; file: string }

/**
 * The whole harness block, one part per top-level key so a stop can name what changed, plus whether worktrees are on,
 * read from the source the drive resolves. Task merges can change the item worktree's copy, so nothing in it is
 * exempt. The source itself is part of the hash, so a drive never silently switches files.
 */
function configSnapshot(root: string, feature: Feature): ConfigSnapshot {
  const { cfg, source, file } = resolveDriveConfig(root, feature);
  const values: Record<string, unknown> = { "config.source": source };
  for (const key of HARNESS_KEYS) values[`harness.${key}`] = cfg.harness?.[key];
  values["worktree.enabled"] = worktreeConfig(root, cfg.worktree).enabled;
  const parts = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k in ARGV_PARTS ? json(v) : sha(v)]));
  return { hash: sha(values), parts, values, source, file };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const shown = (v: unknown): string => (v === undefined ? "(not set)" : JSON.stringify(v));

/** `key: old → new` for every leaf that differs, descending `depth` levels of objects (runner name, then field). */
function describeChange(key: string, before: unknown, after: unknown, depth: number): string[] {
  if (json(before) === json(after)) return [];
  if (depth > 0 && (before === undefined || isRecord(before)) && (after === undefined || isRecord(after))) {
    const b = (before ?? {}) as Record<string, unknown>;
    const a = (after ?? {}) as Record<string, unknown>;
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].sort().flatMap((k) => describeChange(`${key}.${k}`, b[k], a[k], depth - 1));
  }
  return [`${key}: ${shown(before)} → ${shown(after)}`];
}

/** A pinned part still matches; a drive pinned before argv parts were kept as values stored their hash. */
const partSame = (pinned: string | undefined, snapshot: ConfigSnapshot, key: string): boolean =>
  pinned === snapshot.parts[key] || pinned === sha(snapshot.values[key]);

/** What differs between the pinned config and `snapshot`: argv parts as `old → new` lines, the rest by name. */
function configChanges(pinned: Record<string, string> | undefined, snapshot: ConfigSnapshot): { argv: string[]; other: string[] } {
  const argv: string[] = [];
  const other: string[] = [];
  for (const key of Object.keys(snapshot.parts)) {
    const old = pinned?.[key];
    if (partSame(old, snapshot, key)) continue;
    const depth = ARGV_PARTS[key];
    if (depth === undefined) {
      other.push(key);
    } else if (old === undefined || /^[0-9a-f]{64}$/.test(old)) {
      argv.push(`${key}: (pinned value not recorded) → ${shown(snapshot.values[key])}`);
    } else {
      argv.push(...describeChange(key, JSON.parse(old) ?? undefined, snapshot.values[key], depth));
    }
  }
  return { argv, other };
}

const changeSummary = (c: { argv: string[]; other: string[] }): string =>
  [...c.argv, ...c.other.map((k) => `${k} changed`)].join("; ") || "the pinned configuration changed";

/**
 * Runner and verify argv that `kf run` reads from the item worktree copy and that differ from the primary
 * `.kf/config.json`, as a warning; null when they come from elsewhere or match. Workers can write the worktree copy.
 */
export function worktreeArgvWarning(root: string, resolved: DriveConfig): string | null {
  if (resolved.source !== "worktree") return null;
  const head = `⚠ Runner and verify commands are read from the item worktree copy ${configWhere(resolved)}, which workers can edit`;
  let primary: DriveConfig["cfg"]["harness"];
  try {
    primary = readProjectConfig(root).harness;
  } catch (err) {
    if (!(err instanceof ProjectConfigError)) throw err;
    return `${head}; they could not be compared with the primary copy, which does not parse: ${oneLine(message(err))}`;
  }
  const lines = [
    ...describeChange("harness.runners", primary?.runners, resolved.cfg.harness?.runners, ARGV_PARTS["harness.runners"]),
    ...describeChange("harness.verify", primary?.verify, resolved.cfg.harness?.verify, ARGV_PARTS["harness.verify"]),
  ];
  if (lines.length === 0) return null;
  return [`${head}, and differ from the primary .kf/config.json (primary → worktree):`, ...lines.map((l) => `  ${l}`)].join("\n");
}

export function nextCommandFor(code: DriveStopCode, feature: string): string {
  switch (code) {
    case "requirement_bug":
    case "approval_changed":
    case "plan_change_needed":
      return `kf stage ${feature} planning`;
    case "tasks_blocked":
    case "git_error":
      return `kf tasks ${feature}`;
    case "config_changed":
      return `kf drive ${feature} --accept-config`;
    default:
      return `kf drive ${feature}`;
  }
}

export function readPlannedTasks(feature: Feature): PlannedTask[] {
  const planFile = join(feature.dir, ARTIFACTS["implementation-plan"].file);
  return existsSync(planFile) ? parseTaskGraph(splitFrontmatter(readFileSync(planFile, "utf8")).body).tasks : [];
}

/** Why `kf drive` cannot start or resume right now; null when it can. Pure reads, so it can run inside the claim lock. */
function driveRefusal(root: string, feature: Feature): string | null {
  const name = feature.name;
  const meta = feature.meta;
  if (!meta) return `'${name}' has no metadata (.kfw.json).`;
  const prev = meta.drive;
  if (driveLive(prev)) {
    return `Drive ${prev!.id} of '${name}' is already live (supervisor pid ${prev!.supervisorPid}, step ${prev!.step}). Check: kf drive ${name} --status`;
  }
  const approval = approvalState(feature);
  const approvalMessage = `The execution contract of '${name}' is ${approval === "changed" ? "changed since approval" : "not approved"}; return to planning and run: kf approve ${name}`;
  const resumable = prev !== undefined && (prev.status === "stopped" || prev.status === "running");
  switch (feature.stage) {
    case "implementation":
      break;
    case "testing":
    case "review":
      if (!resumable) {
        const ready = prev?.status === "ready";
        return ready
          ? `Drive ${prev.id} of '${name}' already reached "${readyReason(name)}" (kf status --change ${name}).`
          : `'${name}' is in ${feature.stage} with no stopped drive; kf drive starts from implementation or resumes a stopped drive. Start it from implementation: kf stage ${name} implementation`;
      }
      break;
    case "brainstorm":
      return `'${name}' is in brainstorm; finish the requirement and plan first: kf stage ${name} planning`;
    case "planning":
    case "backlog":
      if (approval !== "approved") return approvalMessage;
      return feature.stage === "planning"
        ? `'${name}' is in planning; kf drive starts from implementation. Start it first: kf approve ${name}`
        : `'${name}' is in backlog; kf drive starts from implementation. Start it first: kf stage ${name} implementation`;
    default:
      return `'${name}' is in ${feature.stage}; there is nothing to drive.`;
  }
  if (approval !== "approved") return approvalMessage;
  const resolved = resolveDriveConfig(root, feature);
  const { cfg, source, file, looked } = resolved;
  if (!cfg.harness) {
    return source === "primary"
      ? `No harness configured in .kf/config.json; looked in ${looked.join(", ")} — run: kf init (seeds roles and runner presets).`
      : `No harness configured in ${file} (config source: ${source}) — run: kf init (seeds roles and runner presets).`;
  }
  if (!worktreeConfig(root, cfg.worktree).enabled) return source === "primary" ? WORKTREE_REQUIRED : `${WORKTREE_REQUIRED} Read from ${configWhere(resolved)}.`;
  if (!cfg.harness.verify?.stage?.length) {
    return `harness.verify.stage is not set in ${configWhere(resolved)}; kf drive needs a human-pinned stage verify, e.g. "verify": { "stage": [["npm", "test"]] }.`;
  }
  if (!meta.worktree) return `'${name}' has no item worktree; enter implementation with worktrees enabled: kf stage ${name} implementation`;
  if (meta.kind !== "bug") {
    const errors = checkTaskGraph(feature, cfg.harness).filter((f) => f.severity === "ERROR");
    if (errors.length > 0) return [`Task graph of '${name}' is invalid; fix the plan:`, ...errors.map((f) => `ERROR ${f.code}: ${f.message}`)].join("\n");
  }
  const busy = liveRecords(meta.runs).find((r) => isPidAlive(r.supervisorPid));
  if (busy) return `Run ${busy.id} (${busy.role}${busy.task ? `, ${busy.task}` : ""}) is still running for '${name}'. Wait for it or check: kf runs ${name}`;
  return null;
}

/**
 * The config half of driveRefusal, read from the config the drive itself resolves: an item worktree, worktrees on and
 * a pinned harness.verify.stage. `kf status` and `kf approve` use it to name `kf drive` as the next step.
 */
export function driveConfigReady(root: string, feature: Feature): boolean {
  if (!feature.meta?.worktree) return false;
  let cfg: DriveConfig["cfg"];
  try {
    cfg = resolveDriveConfig(root, feature).cfg;
  } catch (err) {
    // The parse error is the drive's to report: claimDrive refuses with it, so kf drive is still the step to name.
    if (err instanceof ProjectConfigError) return true;
    throw err;
  }
  return (cfg.harness?.verify?.stage?.length ?? 0) > 0 && worktreeConfig(root, cfg.worktree).enabled;
}

/** Approval, config and `--stop` as seen right now for a running drive; the first thing that changed. */
export function driveBoundary(root: string, feature: Feature, id: string): Stop | null {
  const name = feature.name;
  const d = feature.meta?.drive;
  if (!d || d.id !== id || d.status !== "running") {
    return { code: d?.stopCode ?? "stopped_by_user", reason: d?.reason ?? "the drive was stopped from outside", external: true };
  }
  if (approvalState(feature) !== "approved" || (d.approvalHash !== undefined && feature.meta?.approval?.contractHash !== d.approvalHash)) {
    return {
      code: "approval_changed",
      reason: `the approved plan or contract of '${name}' changed during the drive; re-approve it: kf stage ${name} planning, kf approve ${name}, then kf drive ${name}`,
    };
  }
  let snapshot: ConfigSnapshot;
  try {
    snapshot = configSnapshot(root, feature);
  } catch (err) {
    // An edit that broke the config is a config change; a git or file-system failure propagates to the supervisor's
    // boundary, which logs its stack and stops with internal_error.
    if (!(err instanceof ProjectConfigError)) throw err;
    return brokenConfigStop(name, err);
  }
  if (snapshot.hash !== d.configHash) {
    return {
      code: "config_changed",
      reason: `the drive config changed since the drive started (${changeSummary(configChanges(d.configParts, snapshot))}); check ${configWhere(snapshot)}, then resume: kf drive ${name} --accept-config`,
    };
  }
  return null;
}

/** `accepted`: the config changes a resume with `acceptConfig` re-pinned, `old → new` for argv; empty when none. */
export type ClaimResult = { ok: true; drive: DriveState; resumed: boolean; accepted: string[] } | { ok: false; reason: string };

/**
 * A resume re-pins the config. When the runner or verify argv changed since the pin, or the drive stopped on
 * config_changed and the config still differs, that takes `acceptConfig`: the human sees the new argv first.
 */
function resumeConfigCheck(name: string, prev: DriveState, snapshot: ConfigSnapshot, acceptConfig: boolean): { refusal: string } | { accepted: string[] } {
  if (snapshot.hash === prev.configHash) return { accepted: [] };
  const changes = configChanges(prev.configParts, snapshot);
  const lines = [...changes.argv, ...changes.other.map((k) => `${k} changed`)];
  if (acceptConfig || (changes.argv.length === 0 && prev.stopCode !== "config_changed")) return { accepted: lines };
  return {
    refusal: [
      `The drive config of '${name}' changed since drive ${prev.id} pinned it; ${configWhere(snapshot)} now differs:`,
      ...lines.map((l) => `  ${l}`),
      `Check these commands, then resume with them: kf drive ${name} --accept-config`,
    ].join("\n"),
  };
}

/**
 * Check every precondition and take the drive in one step under the item lock, so two `kf drive` calls start at most one.
 * The claim names the calling process as supervisor until a detached supervisor takes over.
 */
export async function claimDrive(root: string, name: string, opts: { acceptConfig?: boolean } = {}): Promise<ClaimResult> {
  let resumed = false;
  let accepted: string[] = [];
  try {
    const updated = await updateFeatureMeta(root, name, (meta) => {
      const feature = findFeature(root, name);
      if (!feature) throw new Refused(`Unknown feature '${name}'. Run: kf list`);
      const refusal = driveRefusal(root, feature);
      if (refusal) throw new Refused(refusal);
      const prev = meta.drive;
      resumed = prev !== undefined && prev.status !== "ready";
      const snapshot = configSnapshot(root, feature);
      if (resumed) {
        const checked = resumeConfigCheck(name, prev!, snapshot, opts.acceptConfig === true);
        if ("refusal" in checked) throw new Refused(checked.refusal);
        accepted = checked.accepted;
      }
      const now = new Date().toISOString();
      const drive: DriveState = {
        id: resumed ? prev!.id : randomUUID().slice(0, 8),
        status: "running",
        step: resumed ? prev!.step : "implementation",
        loops: resumed ? prev!.loops : 0,
        runs: resumed ? prev!.runs : 0,
        configHash: snapshot.hash,
        configParts: snapshot.parts,
        ...(meta.approval?.contractHash ? { approvalHash: meta.approval.contractHash } : {}),
        ...(resumed && prev!.repairReport ? { repairReport: prev!.repairReport } : {}),
        supervisorPid: process.pid,
        startedAt: resumed ? prev!.startedAt : now,
        updatedAt: now,
      };
      return { ...meta, drive };
    });
    return { ok: true, drive: updated.meta!.drive!, resumed, accepted };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.message };
    // A config that does not parse is the human's to fix, like any other refusal; `kf drive --watch` resumes a stopped
    // drive through here, so this is where it shows why it cannot.
    if (err instanceof ProjectConfigError) return { ok: false, reason: `The drive config of '${name}' does not parse: ${oneLine(message(err))}; fix it, then run: kf drive ${name}` };
    throw err;
  }
}

/** Start the supervisor as another `kf` process so it outlives the caller, then hand the claim over to its pid. */
export async function startDetachedDrive(root: string, name: string, drive: DriveState): Promise<number> {
  const entry = join(PKG_ROOT, "dist", "index.js");
  const child = spawn(process.execPath, [entry, "drive", name, "--supervise", drive.id], { cwd: root, detached: true, stdio: "ignore", env: process.env });
  let pid: number;
  try {
    pid = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => resolve(child.pid!));
    });
  } catch (err) {
    await finishDrive(root, name, drive.id, { status: "stopped", stopCode: "internal_error", reason: `could not start the supervisor: ${message(err)}`, nextCommand: `kf drive ${name}` });
    throw err;
  }
  child.unref();
  await patchDrive(root, name, drive.id, { supervisorPid: pid });
  return pid;
}

/** Patch the drive record when it is still ours; false when another drive or a stop replaced it. */
export async function patchDrive(root: string, name: string, id: string, patch: Partial<DriveState>): Promise<boolean> {
  let applied = false;
  await updateFeatureMeta(root, name, (meta) => {
    const d = meta.drive;
    if (!d || d.id !== id || d.status !== "running") return meta;
    applied = true;
    return { ...meta, drive: { ...d, ...patch, updatedAt: new Date().toISOString() } };
  });
  return applied;
}
