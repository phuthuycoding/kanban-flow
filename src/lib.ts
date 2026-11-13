/**
 * The library entry, `@phuthuycoding/kanban-flow/lib`: kf's readers and read models for another
 * program — the hosted ledger service computes status from replicated logs with the code the CLI
 * runs (#184). Re-exports only: importing this module runs no command and reads no argv, unlike
 * the CLI entry `src/index.ts`. Which exports are stable: docs/workflow/library.md.
 */

// The task-loop ledger: its reader, the fold and the measurement.
export { readLedgerState } from "./workflow/next/ledger-state.js";
export { foldWorld } from "./workflow/next/fold.js";
export { liveCap } from "./workflow/next/cap.js";
export { parseLedger, loopStats } from "./workflow/loop-stats.js";
export type {
  Action, Cap, CapCause, HeldRerun, LedgerEvent, LedgerRead, LedgerState, LoopInputs, LoopTask,
  RepairLine, TaskState, World,
} from "./workflow/next/types.js";
export type { LedgerLine, LoopStats, ParsedLedger, Seat } from "./workflow/loop-stats.js";

// The item: its metadata, its folder and its stage-verify records.
export {
  executionContractHash, findFeature, findWorksRoot, listFeatures, readFeatureMeta,
} from "./workflow/features.js";
export type { Feature, FeatureMeta } from "./workflow/features.js";
export { readStageRecords } from "./workflow/stage-record.js";
export type { StageRecord } from "./workflow/stage-record.js";
export type { ApprovalStatus, LegacyStageName, Stage, WorkItemKind } from "./workflow/schema.js";

// The lifecycle log (#183).
export { ITEM_LOG_FILE, foldItemLog, readItemLog, sharedMeta } from "./workflow/item-log.js";
export type { FoldResult, ItemEvent, ItemRecord, ItemState, SharedMeta } from "./workflow/item-log.js";

// The read models `kf status` and `kf dashboard` print.
export { computeBuckets, computeStatus, statusToJson } from "./workflow/status.js";
export type { Buckets, FeatureStatus, WaitingToMergeEntry } from "./workflow/status.js";
export type { Finding } from "./workflow/findings.js";
export type { StageEvidence } from "./workflow/stage-evidence.js";
export { dashboardData } from "./dashboard/dashboard.js";
export type { DashboardFilters } from "./dashboard/dashboard.js";
