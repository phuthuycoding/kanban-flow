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
import { readProjectConfig } from "../../project/config.js";
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

export const READY_REASON = "ready for ship decision";
const REASON_MAX = 700;

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
export const oneLine = (text: string, max = REASON_MAX): string => {
  const flat = text.replace(/\s*\n\s*/g, " | ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

class Refused extends Error {}

/** The four things a human pins: roles, runners, verify commands and whether worktrees are on. */
function configSnapshot(root: string): { hash: string; parts: Record<string, string> } {
  const cfg = readProjectConfig(root);
  const values = {
    "harness.roles": cfg.harness?.roles,
    "harness.runners": cfg.harness?.runners,
    "harness.verify": cfg.harness?.verify,
    "worktree.enabled": worktreeConfig(root, cfg.worktree).enabled,
  };
  return { hash: sha(values), parts: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, sha(v)])) };
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
          ? `Drive ${prev.id} of '${name}' already reached "${READY_REASON}"; the ship decision is yours (kf status --change ${name}).`
          : `'${name}' is in ${feature.stage} with no stopped drive; kf drive starts from implementation or resumes a stopped drive. Start it from implementation: kf stage ${name} implementation`;
      }
      break;
    case "brainstorm":
      return `'${name}' is in brainstorm; finish the requirement and plan first: kf stage ${name} planning`;
    case "planning":
    case "backlog":
      return approval !== "approved"
        ? approvalMessage
        : `'${name}' is in ${feature.stage}; kf drive starts from implementation. Start it first: kf stage ${name} implementation`;
    default:
      return `'${name}' is in ${feature.stage}; there is nothing to drive.`;
  }
  if (approval !== "approved") return approvalMessage;
  const cfg = readProjectConfig(root);
  if (!cfg.harness) return "No harness configured in .kf/config.json — run: kf init (seeds roles and runner presets).";
  if (!worktreeConfig(root, cfg.worktree).enabled) return WORKTREE_REQUIRED;
  if (!cfg.harness.verify?.stage?.length) {
    return `harness.verify.stage is not set in .kf/config.json; kf drive needs a human-pinned stage verify, e.g. "verify": { "stage": [["npm", "test"]] }.`;
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
      reason: `the approved plan or contract of '${name}' changed during the drive; re-approve it: kf stage ${name} planning, kf approve ${name}, kf stage ${name} implementation, then kf drive ${name}`,
    };
  }
  let snapshot: ReturnType<typeof configSnapshot>;
  try {
    snapshot = configSnapshot(root);
  } catch (err) {
    return { code: "config_changed", reason: `.kf/config.json can no longer be read: ${oneLine(message(err))}` };
  }
  if (snapshot.hash !== d.configHash) {
    const changed = Object.keys(snapshot.parts).filter((k) => snapshot.parts[k] !== d.configParts?.[k]);
    return { code: "config_changed", reason: `${changed.length > 0 ? changed.join(", ") : "the pinned configuration"} changed since the drive started; check .kf/config.json, then resume: kf drive ${name}` };
  }
  return null;
}

export type ClaimResult = { ok: true; drive: DriveState; resumed: boolean } | { ok: false; reason: string };

/**
 * Check every precondition and take the drive in one step under the item lock, so two `kf drive` calls start at most one.
 * The claim names the calling process as supervisor until a detached supervisor takes over.
 */
export async function claimDrive(root: string, name: string): Promise<ClaimResult> {
  let resumed = false;
  try {
    const updated = await updateFeatureMeta(root, name, (meta) => {
      const feature = findFeature(root, name);
      if (!feature) throw new Refused(`Unknown feature '${name}'. Run: kf list`);
      const refusal = driveRefusal(root, feature);
      if (refusal) throw new Refused(refusal);
      const prev = meta.drive;
      resumed = prev !== undefined && prev.status !== "ready";
      const snapshot = configSnapshot(root);
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
    return { ok: true, drive: updated.meta!.drive!, resumed };
  } catch (err) {
    if (err instanceof Refused) return { ok: false, reason: err.message };
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
