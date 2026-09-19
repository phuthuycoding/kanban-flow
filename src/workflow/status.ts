import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  STAGES,
  ARTIFACTS,
  FEATURE_ONLY_ARTIFACTS,
  STAGE_INDEX,
  PHASE_NAMES,
  type ArtifactId,
} from "./schema.js";
import { splitFrontmatter, isFilledFile } from "../shared/frontmatter.js";
import type { Feature } from "./features.js";
import { executionContractHash } from "./features.js";
import type { HarnessConfig } from "../harness/config.js";

export type ArtifactStatus = "done" | "missing" | "waiting";

export interface ArtifactState {
  id: ArtifactId;
  file: string;
  exists: boolean;
  filled: boolean;
  /** due determines whether absence blocks advancement at the current stage */
  due: boolean;
  status: ArtifactStatus;
  path: string;
  note: string;
}

export interface FeatureStatus {
  feature: Feature;
  stageIndex: number;
  artifacts: ArtifactState[];
  doneCount: number;
  dueCount: number;
  totalCount: number;
  next: ArtifactId | null;
  taskProgress: { done: number; total: number };
  /** Roles assigned to the current stage, in run order; empty when the main role does it. */
  assignedRoles: Array<{ role: string; runner: string }>;
}

function readArtifactContent(dir: string, file: string): string {
  const p = join(dir, file);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

export function countTasks(content: string): { done: number; total: number } {
  const lines = content.split("\n");
  let done = 0;
  let total = 0;
  for (const line of lines) {
    if (/^\s*- \[ \]/.test(line)) total += 1;
    else if (/^\s*- \[[xX]\]/.test(line)) {
      total += 1;
      done += 1;
    }
  }
  return { done, total };
}

function assignedFor(feature: Feature, harness: HarnessConfig | undefined): Array<{ role: string; runner: string }> {
  const chain = harness?.stages[feature.stage] ?? [];
  if (chain.length === 1 && chain[0] === harness?.main) return [];
  return chain.map((role) => ({ role, runner: harness?.roles[role]?.runner ?? "?" }));
}

/** Compute artifact completion status for a feature at its current stage. */
export function computeStatus(feature: Feature, harness?: HarnessConfig): FeatureStatus {
  const stageIndex = STAGE_INDEX[feature.stage];
  const artifacts: ArtifactState[] = [];
  let doneCount = 0;
  let dueCount = 0;

  for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
    if (feature.meta?.kind === "bug" && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const def = ARTIFACTS[id];
    const path = join(feature.dir, def.file);
    const exists = existsSync(path);
    const raw = readArtifactContent(feature.dir, def.file);
    const { fm, body } = splitFrontmatter(raw);
    const current = (id !== "testing-result" && id !== "review-report")
      || (Boolean(feature.meta?.executionId) && fm.execution === feature.meta?.executionId);
    const filled = exists && isFilledFile(raw, body) && current;
    const due = stageIndex >= def.dueFromStage;

    let status: ArtifactStatus;
    let note = "";
    if (exists && filled) {
      status = "done";
      doneCount += 1;
    } else if (due) {
      status = "missing";
      note = exists ? current ? "not filled (placeholders or empty)" : "report belongs to a different execution" : "file missing";
      dueCount += 1;
    } else {
      status = "waiting";
      const dueStage = STAGES[def.dueFromStage];
      note = `due at ${PHASE_NAMES[dueStage]}`;
    }
    artifacts.push({ id, file: def.file, exists, filled, due, status, path, note });
  }

  const tasksPath = join(feature.dir, "tasks.md");
  const taskProgress = existsSync(tasksPath)
    ? countTasks(readFileSync(tasksPath, "utf8"))
    : { done: 0, total: 0 };

  const next =
    artifacts.find((a) => a.due && a.status !== "done")?.id ?? null;

  return {
    feature,
    stageIndex,
    artifacts,
    doneCount,
    dueCount,
    totalCount: artifacts.length,
    next,
    taskProgress,
    assignedRoles: assignedFor(feature, harness),
  };
}

/** Render a human-readable status snapshot (mirrors `openspec status`). */
export function renderStatusText(s: FeatureStatus): string {
  const lines: string[] = [];
  const ready = s.artifacts.filter((a) => a.status !== "waiting");
  const done = ready.filter((a) => a.status === "done").length;
  const taskStr =
    s.taskProgress.total > 0
      ? `, tasks ${s.taskProgress.done}/${s.taskProgress.total}`
      : "";

  const approval = approvalState(s.feature);
  lines.push(`${s.feature.meta?.kind === "bug" ? "Bug" : "Feature"}: ${s.feature.name} (${s.feature.context ?? "no-context"})`);
  lines.push(`Stage: ${s.feature.stage} (${PHASE_NAMES[s.feature.stage]})   Approval: ${approval}   Artifacts: ${done}/${ready.length}${taskStr}`);
  if (s.feature.meta?.executionId) lines.push(`Execution: ${s.feature.meta.executionId}`);
  const bypasses = s.feature.meta?.bypasses ?? [];
  if (bypasses.length > 0) lines.push(`Bypasses: ${bypasses.length} (${bypasses.map((b) => `--${b.flag} → ${b.to}`).join(", ")})`);
  const cancellation = s.feature.meta?.cancellation;
  if (cancellation) {
    lines.push(`Cancelled: ${cancellation.at} by ${cancellation.by} (was ${cancellation.fromStage}) — ${cancellation.reason.split("\n")[0]}`);
  }
  if (s.assignedRoles.length > 0) lines.push(`Assigned: ${s.assignedRoles.map((a) => `${a.role} (${a.runner})`).join(" → ")} (kf run)`);
  const runs = s.feature.meta?.runs ?? [];
  if (runs.length > 0) {
    const byRole = new Map<string, number>();
    for (const r of runs) byRole.set(r.role, (byRole.get(r.role) ?? 0) + 1);
    lines.push(`Runs: ${runs.length} (${[...byRole].map(([a, n]) => `${a}×${n}`).join(", ")})`);
  }
  lines.push("");

  for (const a of s.artifacts) {
    const mark =
      a.status === "done" ? "[x]" : a.status === "missing" ? "[ ]" : "[-]";
    const suffix = a.status === "done" ? "" : `  ${a.note}`;
    lines.push(`${mark} ${a.id}${suffix}`);
  }

  if (s.next) {
    lines.push("");
    lines.push(`Next: kf instruct ${s.next} --change "${s.feature.name}"`);
  } else if (s.feature.stage === "planning" && approval !== "approved") {
    lines.push(`Next: human approval, then kf approve "${s.feature.name}"`);
  } else if (s.feature.stage === "planning" && approval === "approved") {
    lines.push(`Next: human decision — kf stage "${s.feature.name}" implementation (start) or backlog (defer)`);
  } else if (s.feature.stage === "backlog") {
    lines.push(`Next: human decision — kf stage "${s.feature.name}" implementation (start) or planning (revise)`);
  }
  return lines.join("\n");
}

/** Render a JSON-serializable status object. */
export function statusToJson(s: FeatureStatus) {
  return {
    feature: s.feature.name,
    kind: s.feature.meta?.kind ?? "feature",
    context: s.feature.context,
    stage: s.feature.stage,
    approval: approvalState(s.feature),
    executionId: s.feature.meta?.executionId ?? null,
    bypasses: s.feature.meta?.bypasses ?? [],
    cancellation: s.feature.meta?.cancellation ?? null,
    assignedRoles: s.assignedRoles,
    runs: s.feature.meta?.runs ?? [],
    artifacts: s.artifacts.map((a) => ({
      id: a.id,
      file: a.file,
      status: a.status,
      due: a.due,
      path: a.path,
      note: a.note,
    })),
    doneCount: s.doneCount,
    dueCount: s.dueCount,
    totalCount: s.totalCount,
    next: s.next,
    tasks: s.taskProgress,
  };
}

export function approvalState(feature: Feature): "pending" | "approved" | "changed" {
  const approval = feature.meta?.approval;
  if (approval?.status !== "approved") return "pending";
  return approval.contractHash && approval.contractHash === executionContractHash(feature.dir, feature.meta?.kind === "bug" ? "bug" : "feature") ? "approved" : "changed";
}
