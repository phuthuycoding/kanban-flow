import type { ReviewLaneKind, MachineEvent, RegionRow, RegionTable, TaskState, World } from "./types.js";

// Review region: one reviewer lane per task, own and cascade demands, the own verdict.

const STUB_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The review region: reviewer lane × event. */
export const REVIEW_TABLE = {
  free: STUB_ROW,
  busy: STUB_ROW,
} satisfies RegionTable<ReviewLaneKind>;

/** Applies one event to the task's region. */
export function reviewStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  void e;
  void world;
  return t;
}
