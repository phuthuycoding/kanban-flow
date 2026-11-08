import type { VerifyKind, MachineEvent, RegionRow, RegionTable, TaskState, World } from "./types.js";

// Verify region: exits, failures, re-runs, stale runs, waits and routed failures.

const STUB_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The verify region: VerifyState × event. */
export const VERIFY_TABLE = {
  notDue: STUB_ROW,
  owed: STUB_ROW,
  running: STUB_ROW,
  passed: STUB_ROW,
  failed: STUB_ROW,
  exit2Stop: STUB_ROW,
  exit3Decide: STUB_ROW,
  unknownExit: STUB_ROW,
  passedByRoute: STUB_ROW,
} satisfies RegionTable<VerifyKind>;

/** Applies one event to the task's region. */
export function verifyStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  void e;
  void world;
  return t;
}
