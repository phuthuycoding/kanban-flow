import type { Cap, LedgerState, LoopInputs, LoopTask, MachineEvent, RegionRow, RegionTable, TaskPhaseKind, TaskState, World } from "./types.js";

// The fold: the ledger read once, in file order, into the World. Lifecycle transitions live here; verify, review and
// at-cap events go to their regions (verify-region.ts, review-region.ts, atcap.ts).

const STUB_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The lifecycle region: TaskPhase × event. */
export const LIFECYCLE_TABLE = {
  pending: STUB_ROW,
  tests: STUB_ROW,
  ready: STUB_ROW,
  cycle: STUB_ROW,
  atCap: STUB_ROW,
  complete: STUB_ROW,
} satisfies RegionTable<TaskPhaseKind>;

/** A plan task before any ledger line. */
export function initialTask(task: LoopTask): TaskState {
  return {
    id: task.id,
    phase: { kind: "pending" },
    seats: {
      "test-writer": { kind: "idle" },
      developer: { kind: "idle" },
      "automation-writer": { kind: "idle" },
      "code-reviewer": { kind: "idle" },
    },
    verify: { kind: "notDue" },
    review: { lane: { kind: "free" }, demands: [], ownVerdict: "none" },
    routedIn: [],
    judgements: [],
    roundsUsed: 0,
    reopened: false,
    inline: task.inline,
    commits: [],
    droppedShas: [],
  };
}

/** Folds the ledger into the World. */
export function foldWorld(state: LedgerState, inputs: LoopInputs, cap: Cap): World {
  void state;
  return {
    inputs,
    cap,
    contention: cap.contention,
    scan: "none",
    ceiling: "valid",
    unknown: new Map(),
    pool: [],
    tasks: new Map(inputs.tasks.map((t) => [t.id, initialTask(t)])),
  };
}

/** Applies one event to one task: the lifecycle cell of its phase, then the region cells. */
export function step(world: World, task: TaskState, e: MachineEvent): TaskState {
  void world;
  void e;
  return task;
}
