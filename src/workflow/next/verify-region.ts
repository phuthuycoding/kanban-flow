import { contentionSignature } from "./cap.js";
import { JUDGEMENTS } from "./judgements.js";
import type {
  Judgement,
  JudgementEntry,
  JudgementKind,
  LoopInputs,
  VerifyKind,
  MachineEvent,
  MachineEventOf,
  RegionHandler,
  RegionRow,
  RegionTable,
  TaskState,
  VerifyDisposition,
  VerifyState,
  World,
} from "./types.js";

// Verify region: exits, failures, re-runs, stale runs, waits and routed failures.

/** What a verify run needs at its `verify done` beyond the `verify started` line its state keeps. */
interface Start {
  ts: number;
  /** Started under a `verify rerun` note: its exit 1 is kept, never held again. */
  rerun: boolean;
  /** The one plain re-run of a failure with no log block. */
  plain: boolean;
}

// VerifyState keeps only the started line, but a log block belongs to a run by its time (after the start), and an
// orphan's late done must still know whether it was a re-run. Keyed by the inputs object, which every fold step shares.
const STARTS = new WeakMap<LoopInputs, Map<string, Start>>();

const startKey = (task: string, line: number): string => `${task}@${line}`;

function recordStart(world: World, task: string, line: number, start: Start): void {
  let starts = STARTS.get(world.inputs);
  if (!starts) {
    starts = new Map();
    STARTS.set(world.inputs, starts);
  }
  starts.set(startKey(task, line), start);
}

function startOf(world: World, task: string, line: number): Start {
  const start = STARTS.get(world.inputs)?.get(startKey(task, line));
  if (!start) throw new Error(`verify region: ${task} has no verify started at line ${line} in this fold`);
  return start;
}

type VerifyJudgementKind = "verifyExit2" | "verifyExit3" | "verifyExit" | "verifyRouted" | "verifyWaitsUnreleasable";

/** The verify state each verify judgement holds open; its successor applies only while the task is still there. */
const HOLDS: Record<VerifyJudgementKind, (v: VerifyState) => boolean> = {
  verifyExit2: (v) => v.kind === "exit2Stop",
  verifyExit3: (v) => v.kind === "exit3Decide",
  verifyExit: (v) => v.kind === "unknownExit",
  verifyRouted: (v) => v.kind === "failed" && v.disposition.kind === "routeRejected",
  verifyWaitsUnreleasable: (v) => v.kind === "failed" && v.disposition.kind === "waitsUnreleasable",
};

const isVerifyJudgement = (j: Judgement): j is Judgement<VerifyJudgementKind> => j.kind in HOLDS;

const entryOf = (j: Judgement): JudgementEntry<JudgementKind> => JUDGEMENTS[j.kind] as JudgementEntry<JudgementKind>;

const opened = (t: TaskState, j: Judgement): TaskState => ({ ...t, judgements: [...t.judgements, j] });

const failed = (t: TaskState, line: number, disposition: VerifyDisposition): TaskState => ({
  ...t,
  verify: { kind: "failed", line, disposition },
});

/** A failure routed into this task is answered by its later pass, park or completion. */
const answerRoutedIn = (t: TaskState): TaskState =>
  t.routedIn.some((r) => !r.answered) ? { ...t, routedIn: t.routedIn.map((r) => ({ ...r, answered: true })) } : t;

const onCommit: RegionHandler<"commits"> = (t) =>
  t.verify.kind === "running"
    ? { ...t, verify: { ...t.verify, stale: true } }
    : { ...t, verify: { kind: "owed", atHead: false, why: "commit" } };

const onStarted: RegionHandler<"verifyStarted"> = (t, e, world) => {
  // A new run closes every open exit 2, exit 3 and unknown-exit judgement, wherever it sits in the queue.
  const judgements = t.judgements.filter((j) => !(isVerifyJudgement(j) && entryOf(j).close(j, e, t)));
  const v = t.verify;
  const rerun = v.kind === "failed" && v.disposition.kind === "contentionHeld";
  const plain = v.kind === "failed" && v.disposition.kind === "plainRerunOwed";
  recordStart(world, t.id, e.line, { ts: e.ts, rerun, plain });
  const atHead = (v.kind === "owed" && v.atHead) || (v.kind === "failed" && v.disposition.kind === "waits");
  return { ...t, judgements, verify: { kind: "running", line: e.line, rerun, stale: false, ...(atHead ? { atHead } : {}) } };
};

/** Exit 1 of the run started at `line`, classified as cap.ts classifies it for the contention view. */
function exitOne(t: TaskState, e: MachineEventOf<"verifyDone">, world: World, line: number, start: Start): TaskState {
  if (start.rerun) return failed(t, line, { kind: "kept" });
  const block = (world.inputs.verifyRuns[t.id] ?? []).find((run) => run.ts > start.ts && run.ts <= e.ts);
  if (!block) return failed(t, line, { kind: start.plain ? "kept" : "plainRerunOwed" });
  const signature = contentionSignature(block.text);
  return failed(t, line, signature === null ? { kind: "kept" } : { kind: "contentionHeld", signature });
}

/**
 * A done ends the running verify, or the orphan a rerun note held (its late done, which `kf record` accepts because
 * the verify is still open in the ledger). A stale run's pass or failure is of an older tree: the verify is owed again.
 */
const onDone: RegionHandler<"verifyDone"> = (t, e, world) => {
  const v = t.verify;
  let line: number;
  let stale = false;
  if (v.kind === "running") {
    line = v.line;
    stale = v.stale;
  } else if (v.kind === "failed" && v.disposition.kind === "contentionHeld") {
    line = v.line;
  } else {
    return t;
  }
  const start = startOf(world, t.id, line);
  if (stale && (e.exit === 0 || e.exit === 1)) return { ...t, verify: { kind: "owed", atHead: false, why: "stale" } };
  switch (e.exit) {
    case 0:
      return answerRoutedIn({ ...t, verify: { kind: "passed", line } });
    case 1:
      return exitOne(t, e, world, line, start);
    case 2:
      return opened({ ...t, verify: { kind: "exit2Stop" } }, { kind: "verifyExit2", task: t.id, openedAt: e.line });
    case 3:
      return opened(
        { ...t, verify: { kind: "exit3Decide", droppedShas: t.droppedShas } },
        { kind: "verifyExit3", task: t.id, openedAt: e.line, droppedShas: t.droppedShas },
      );
    default:
      return opened({ ...t, verify: { kind: "unknownExit", raw: e.exit } }, { kind: "verifyExit", task: t.id, openedAt: e.line, exit: e.exit });
  }
};

/**
 * The orphan rule (fold only): a rerun note after a started verify with no done closes it and holds the re-run again.
 * A run that went stale tested an older tree, so the verify is owed again instead.
 */
const onRerunNote: RegionHandler<"verifyRerun"> = (t, e) => {
  if (t.verify.kind !== "running") return t;
  if (t.verify.stale) return { ...t, verify: { kind: "owed", atHead: false, why: "commit" } };
  return failed(t, t.verify.line, { kind: "contentionHeld", signature: e.signature });
};

function rank(world: World, task: string): [number, number] {
  const i = world.inputs.tasks.findIndex((p) => p.id === task);
  return i === -1 ? [Infinity, Infinity] : [world.inputs.tasks[i].wave, i];
}

const ranksLater = (world: World, a: string, b: string): boolean => {
  const [wa, ia] = rank(world, a);
  const [wb, ib] = rank(world, b);
  return wa !== wb ? wa > wb : ia > ib;
};

function overlap(world: World, a: string, b: string): boolean {
  const plan = (id: string) => world.inputs.tasks.find((p) => p.id === id);
  return (plan(a)?.overlaps.includes(b) ?? false) || (plan(b)?.overlaps.includes(a) ?? false);
}

const onWaits: RegionHandler<"verifyWaits"> = (t, e, world) => {
  const v = t.verify;
  if (v.kind !== "failed") return t;
  const other = e.otherTask;
  const x = world.tasks.get(other);
  const unreleasable = (why: string): TaskState =>
    opened(failed(t, v.line, { kind: "waitsUnreleasable", otherTask: other, why }), {
      kind: "verifyWaitsUnreleasable",
      task: t.id,
      openedAt: e.line,
      otherTask: other,
      why,
    });
  if (!x || world.unknown.has(other)) return unreleasable(`${other} is not a task of the plan`);
  // Complete or implemented already: nothing later releases the wait, so it is released now.
  if (x.phase.kind === "complete") return { ...t, verify: { kind: "owed", atHead: true, why: "released" } };
  const open = x.phase.kind === "cycle" || x.phase.kind === "atCap";
  if (!open && overlap(world, t.id, other) && ranksLater(world, other, t.id)) {
    return unreleasable(`${other} overlaps ${t.id}, is not open and ranks later`);
  }
  return failed(t, v.line, { kind: "waits", otherTask: other });
};

const onReleased: RegionHandler<"watchReleased"> = (t, e) =>
  t.verify.kind === "failed" && t.verify.disposition.kind === "waits" && t.verify.disposition.otherTask === e.from
    ? { ...t, verify: { kind: "owed", atHead: true, why: "released" } }
    : t;

/**
 * A failure can be routed only to an open task that can still take a fix round: its test-writer or developer has been
 * dispatched, it is not complete, and it is not inside its one minimal fix past the cap (which takes no further round).
 */
export function routable(world: World, other: string): boolean {
  const x = world.tasks.get(other);
  if (x === undefined || world.unknown.has(other)) return false;
  switch (x.phase.kind) {
    case "tests":
    case "atCap":
      return true;
    case "cycle":
      return x.phase.cycle !== "minimalFix";
    case "ready":
      return x.seats["test-writer"].kind !== "idle";
    default:
      return false;
  }
}

const rejectRoute = (t: TaskState, e: MachineEventOf<"verifyRouted">): TaskState =>
  opened(t, { kind: "verifyRouted", task: t.id, openedAt: e.line, otherTask: e.otherTask });

const onRouted: RegionHandler<"verifyRouted"> = (t, e, world) => {
  const v = t.verify;
  if (v.kind !== "failed") return t;
  // A waits note on the same failure holds until the named task's commit releases it; a later route does not lift it.
  if (v.disposition.kind === "waits") return t;
  const other = e.otherTask;
  if (routable(world, other)) return failed(t, v.line, { kind: "routedOut", otherTask: other, line: e.line });
  return rejectRoute(failed(t, v.line, { kind: "routeRejected", otherTask: other }), e);
};

/**
 * A route note on a verify with no result yet names a target that cannot take it: a Verify routed judgement too, once.
 * A verify that already passed or has its own judgement leaves the note nothing to route.
 */
const onRoutedUnfailed: RegionHandler<"verifyRouted"> = (t, e, world) => {
  const unresolved = t.verify.kind === "notDue" || t.verify.kind === "owed" || t.verify.kind === "running";
  if (!unresolved || routable(world, e.otherTask) || t.judgements.some((j) => j.kind === "verifyRouted")) return t;
  return rejectRoute(t, e);
};

/**
 * A pass or park of the task the failure was routed to answers it. Its complete with neither since the route leaves
 * the failure unfixed: as a route to a completed task, a Verify routed judgement.
 */
const onRouteAnswered: RegionHandler<"routeAnswered"> = (t, e) => {
  const v = t.verify;
  if (v.kind !== "failed" || v.disposition.kind !== "routedOut" || v.disposition.otherTask !== e.from) return t;
  if (e.unfixed !== true) return { ...t, verify: { kind: "passedByRoute" } };
  return opened(failed(t, v.line, { kind: "routeRejected", otherTask: e.from }), { kind: "verifyRouted", task: t.id, openedAt: e.line, otherTask: e.from });
};

/**
 * A decided note the fold tagged for this region closes that verify judgement and moves the verify on; an untagged
 * note closes the head of the queue only when it is a verify judgement.
 */
const onDecided: RegionHandler<"decided"> = (t, e) => {
  if (e.closes !== undefined && e.closes.region !== "verify") return t;
  const tag = e.closes;
  const head =
    tag === undefined
      ? t.judgements.slice(0, 1).find((j) => isVerifyJudgement(j) && entryOf(j).close(j, e, t))
      : t.judgements.find((j) => j.openedAt === tag.judgement && isVerifyJudgement(j) && entryOf(j).close(j, e, t));
  if (head === undefined || !isVerifyJudgement(head)) return t;
  const closed = { ...t, judgements: t.judgements.filter((j) => j !== head) };
  // A commit or a new run since the judgement opened already moved the verify on.
  if (!HOLDS[head.kind](t.verify)) return closed;
  const successor = entryOf(head).successor(head, e, t);
  if (successor === "verifyOwed") return { ...closed, verify: { kind: "owed", atHead: false, why: "decided" } };
  if (successor === "verifyKept" && t.verify.kind === "failed") return failed(closed, t.verify.line, { kind: "kept" });
  return closed;
};

const onRoutedIn: RegionHandler<"routedIn"> = (t, e) => ({
  ...t,
  routedIn: [...t.routedIn, { from: e.from, line: e.line, answered: false }],
});

const NOOP_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  waveVerifyStarted: "noop", waveVerifyDone: "noop", waveDecided: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The cells every verify state shares: a commit, a new run, a decision, and the routed-in record and its answers. */
const BASE_ROW = {
  ...NOOP_ROW,
  commits: onCommit,
  verifyStarted: onStarted,
  decided: onDecided,
  verifyRouted: onRoutedUnfailed,
  routedIn: onRoutedIn,
  parked: answerRoutedIn,
  complete: answerRoutedIn,
  implemented: answerRoutedIn,
} satisfies RegionRow;

/** The verify region: VerifyState × event. */
export const VERIFY_TABLE = {
  notDue: BASE_ROW,
  owed: BASE_ROW,
  running: { ...BASE_ROW, verifyDone: onDone, verifyRerun: onRerunNote },
  passed: BASE_ROW,
  failed: {
    ...BASE_ROW,
    verifyDone: onDone,
    verifyWaits: onWaits,
    watchReleased: onReleased,
    verifyRouted: onRouted,
    routeAnswered: onRouteAnswered,
  },
  exit2Stop: BASE_ROW,
  exit3Decide: BASE_ROW,
  unknownExit: BASE_ROW,
  passedByRoute: BASE_ROW,
} satisfies RegionTable<VerifyKind>;

/** Applies one event to the task's region. */
export function verifyStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  if (!("task" in e) || e.task !== t.id) return t;
  const cell = (VERIFY_TABLE[t.verify.kind] as RegionRow)[e.type] as RegionHandler<typeof e.type> | "noop";
  return cell === "noop" ? t : cell(t, e as never, world);
}
