import type { AtCapKind, MachineEvent, RegionRow, RegionTable, TaskState, World } from "./types.js";

// At-cap region: the Breaker, the cap stop, the minimal fix past the cap and cascades at the cap.

const STUB_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The at-cap region: AtCap × event. */
export const AT_CAP_TABLE = {
  breaker: STUB_ROW,
  capStop: STUB_ROW,
  minimalFixOwed: STUB_ROW,
  cascadeAtCap: STUB_ROW,
  parkedClosed: STUB_ROW,
} satisfies RegionTable<AtCapKind>;

/** Applies one event to the task's region. */
export function atCapStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  void e;
  void world;
  return t;
}
