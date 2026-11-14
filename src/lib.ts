/**
 * The library entry, `@phuthuycoding/kanban-flow/lib`: kf's readers for another program — the
 * hosted ledger service reads replicated ledgers, lifecycle logs and item folders with the code
 * the CLI runs (#184). Re-exports only: importing this module runs no command and reads no argv,
 * unlike the CLI entry `src/index.ts`. Nothing exported here runs git or reads the host's config
 * layers, so the status read models and `findWorksRoot` stay out. Which exports are stable:
 * docs/workflow/library.md.
 */

// The task-loop ledger: its reader, the fold and the measurement.
export { readLedgerState } from "./workflow/next/ledger-state.js";
export { foldWorld } from "./workflow/next/fold.js";
export { liveCap } from "./workflow/next/cap.js";
export { parseLedger, loopStats } from "./workflow/loop-stats.js";
export type {
  Action, Cap, CapCause, DecisionRegion, DecisionTarget, EventBase, HeldRerun, LedgerEvent,
  LedgerRead, LedgerState, LoopInputs, LoopTask, RepairLine, TaskState, World,
} from "./workflow/next/types.js";
export type {
  LedgerLine, LoopStats, ParsedLedger, Seat, ShapeName, WaveShapeName,
} from "./workflow/loop-stats.js";

// The item: its metadata, its folder and its stage-verify records.
export {
  AmbiguousFeatureError, executionContractHash, findFeature, listFeatures, readFeatureMeta,
} from "./workflow/features.js";
export type {
  Approval, Bypass, Cancellation, Feature, FeatureMeta, ShipState, VerifyWaiver,
  WorktreeRegistration,
} from "./workflow/features.js";
export { readStageRecords } from "./workflow/stage-record.js";
export type { StageRecord, StepOutcome } from "./workflow/stage-record.js";
export type { ApprovalStatus, LegacyStageName, Stage, WorkItemKind } from "./workflow/schema.js";

// The lifecycle log (#183).
export { ITEM_LOG_FILE, foldItemLog, readItemLog, sharedMeta } from "./workflow/item-log.js";
export type {
  FoldResult, ItemEvent, ItemOrigin, ItemRecord, ItemState, SharedMeta,
} from "./workflow/item-log.js";
