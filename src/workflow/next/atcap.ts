import { JUDGEMENTS, isSuperseded } from "./judgements.js";
import type {
  AtCap,
  AtCapKind,
  Judgement,
  JudgementEntry,
  JudgementKind,
  MachineEvent,
  MachineEventOf,
  RegionHandler,
  RegionRow,
  RegionTable,
  TaskState,
  World,
} from "./types.js";

// At-cap region: the Breaker, the cap stop, the minimal fix past the cap and cascades at the cap.

const MINIMAL_FIX = "minimal fix past the cap:";

const CAP_JUDGEMENTS: readonly JudgementKind[] = [
  "breaker",
  "breakerFixSpent",
  "capStop",
  "capStopFixSpent",
  "cascadeAtCapBreaker",
  "cascadeAtCapStop",
];

type Breaker = Extract<AtCap, { kind: "breaker" }>;
type Decision = MachineEventOf<"decided"> | MachineEventOf<"ruling">;

const entryOf = (j: Judgement): JudgementEntry<JudgementKind> => JUDGEMENTS[j.kind] as unknown as JudgementEntry<JudgementKind>;

const isMinimalFix = (e: MachineEvent): boolean => e.type === "decided" && e.what.startsWith(MINIMAL_FIX);

/** The task at `cap`, its earlier at-cap judgements replaced by `opened` (if any). */
function toCap(t: TaskState, cap: AtCap, opened?: Judgement): TaskState {
  const judgements = t.judgements.filter((j) => !CAP_JUDGEMENTS.includes(j.kind));
  return { ...t, phase: { kind: "atCap", cap }, judgements: opened === undefined ? judgements : [...judgements, opened] };
}

/** Round five's cycle left a fix trigger open: the Breaker for a task never reopened, the cap stop otherwise. */
export function enterCap(t: TaskState, at: number): TaskState {
  return t.reopened
    ? toCap(t, { kind: "capStop", noted: false, fixSpent: false }, { kind: "capStop", task: t.id, openedAt: at })
    : toCap(t, { kind: "breaker", parked: [], fixSpent: false }, { kind: "breaker", task: t.id, openedAt: at });
}

/** A cascade re-review returned findings with no rounds left. */
export function enterCascadeAtCap(t: TaskState, sha7: string, at: number): TaskState {
  return t.reopened
    ? toCap(t, { kind: "cascadeAtCap", sha7, reopened: true }, { kind: "cascadeAtCapStop", task: t.id, openedAt: at, sha7 })
    : toCap(t, { kind: "cascadeAtCap", sha7, reopened: false }, { kind: "cascadeAtCapBreaker", task: t.id, openedAt: at, sha7 });
}

/**
 * The minimal fix failed or was abandoned: it is spent, the Breaker closes on a park only, the cap stop stays. A minimal
 * fix is reached from the cap stop only once its `cap reached` note is written, so the note stays written.
 */
export function fixFailed(t: TaskState, at: number): TaskState {
  return t.reopened
    ? toCap(t, { kind: "capStop", noted: true, fixSpent: true }, { kind: "capStopFixSpent", task: t.id, openedAt: at })
    : toCap(t, { kind: "breaker", parked: [], fixSpent: true }, { kind: "breakerFixSpent", task: t.id, openedAt: at });
}

// The verify runs that are the minimal fix's outcome: started once the fix developer is done and its first commit
// is recorded. VerifyState keeps only the started line, so the verdict is taken at the start and read at the failure.
// Keyed by the World, one per fold run (the inputs object can be shared by several folds), since types.ts is frozen.
const FIX_RUNS = new WeakMap<World, Set<string>>();

const runKey = (task: string, line: number): string => `${task}@${line}`;

function recordFixRun(world: World, task: string, line: number): void {
  let runs = FIX_RUNS.get(world);
  if (!runs) {
    runs = new Set();
    FIX_RUNS.set(world, runs);
  }
  runs.add(runKey(task, line));
}

const isFixRun = (world: World, task: string, line: number): boolean => FIX_RUNS.get(world)?.has(runKey(task, line)) ?? false;

const ending: RegionHandler<"complete"> = (t, e) => ({
  ...t,
  judgements: t.judgements.filter((j) => !CAP_JUDGEMENTS.includes(j.kind)),
  phase: { kind: "complete", how: isSuperseded(e.text) ? "superseded" : "complete" },
});

const implemented: RegionHandler<"implemented"> = (t) => ({
  ...t,
  judgements: t.judgements.filter((j) => !CAP_JUDGEMENTS.includes(j.kind)),
  phase: { kind: "complete", how: "implemented" },
});

const breakerOf = (t: TaskState): Breaker => {
  if (t.phase.kind !== "atCap" || t.phase.cap.kind !== "breaker") throw new Error(`at-cap region: ${t.id} is not at the Breaker`);
  return t.phase.cap;
};

const onBreakerParked: RegionHandler<"parked"> = (t, e) => {
  const b = breakerOf(t);
  if (b.fixSpent || b.decidedAt !== undefined) return toCap(t, { kind: "parkedClosed" });
  return { ...t, phase: { kind: "atCap", cap: { kind: "breaker", parked: [...b.parked, e.line], decidedAt: b.decidedAt, fixSpent: b.fixSpent } } };
};

/** A decision another region's judgement takes is not the at-cap region's (one decided note closes one gate). */
const elsewhere = (e: Decision): boolean => e.closes !== undefined && e.closes.region !== "atcap";

const onBreakerDecided: RegionHandler<"decided"> = (t, e) => {
  const b = breakerOf(t);
  if (b.fixSpent || elsewhere(e)) return t;
  if (isMinimalFix(e)) return toCap(t, { kind: "minimalFixOwed", via: "breaker" });
  if (b.parked.length > 0) return toCap(t, { kind: "parkedClosed" });
  return { ...t, phase: { kind: "atCap", cap: { ...b, decidedAt: e.line } } };
};

/** The cap stop is the human's once its `cap reached` note is written: a minimal-fix note before it decides nothing. */
const onCapStopDecided: RegionHandler<"decided"> = (t, e) => {
  if (t.phase.kind !== "atCap" || t.phase.cap.kind !== "capStop" || t.phase.cap.fixSpent || !t.phase.cap.noted) return t;
  if (!isMinimalFix(e) || elsewhere(e)) return t;
  return toCap(t, { kind: "minimalFixOwed", via: "capStop" });
};

const onCapReached: RegionHandler<"capReached"> = (t) =>
  t.phase.kind === "atCap" && t.phase.cap.kind === "capStop" ? { ...t, phase: { kind: "atCap", cap: { ...t.phase.cap, noted: true } } } : t;

/** A `cap reached` note after the minimal fix was decided, before its developer: the cap stop is back, the fix unspent. */
const onFixOwedCapReached: RegionHandler<"capReached"> = (t, e) =>
  t.phase.kind === "atCap" && t.phase.cap.kind === "minimalFixOwed" && t.phase.cap.via === "capStop"
    ? toCap(t, { kind: "capStop", noted: true, fixSpent: false }, { kind: "capStop", task: t.id, openedAt: e.line })
    : t;

/** The one fresh developer of the fix: a developer dispatch with no round opens the minimal-fix cycle. */
const onFixDispatched: RegionHandler<"dispatched"> = (t, e) => {
  if (e.seat !== "developer" || e.round !== undefined) return t;
  const inline = t.inline || e.model === "inline";
  return {
    ...t,
    inline,
    seats: { ...t.seats, developer: { kind: "running", line: e.line, ts: e.ts, inline, origin: "progress" } },
    phase: {
      kind: "cycle",
      cycle: "minimalFix",
      round: t.roundsUsed,
      openedAt: e.line,
      implementer: { kind: "running", dispatchLine: e.line, inline },
      sinceCommit: null,
      commits: t.commits,
    },
  };
};

/** A cascade finding at the cap of a task never reopened closes on a parked line; a reopened one only by superseded. */
const onCascadeParked: RegionHandler<"parked"> = (t) =>
  t.phase.kind === "atCap" && t.phase.cap.kind === "cascadeAtCap" && !t.phase.cap.reopened ? toCap(t, { kind: "parkedClosed" }) : t;

const NOOP_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  waveVerifyStarted: "noop", waveVerifyDone: "noop", waveDecided: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** Every at-cap state ends on a complete line; `complete … superseded` is the stop's only close. */
const BASE_ROW = { ...NOOP_ROW, complete: ending, implemented } satisfies RegionRow;

/** The at-cap region: AtCap × event. */
export const AT_CAP_TABLE = {
  breaker: { ...BASE_ROW, parked: onBreakerParked, decided: onBreakerDecided },
  capStop: { ...BASE_ROW, decided: onCapStopDecided, capReached: onCapReached },
  minimalFixOwed: { ...BASE_ROW, dispatched: onFixDispatched, capReached: onFixOwedCapReached },
  cascadeAtCap: { ...BASE_ROW, parked: onCascadeParked },
  parkedClosed: BASE_ROW,
} satisfies RegionTable<AtCapKind>;

/**
 * The developer of the fix closed by a decision, or re-dispatched over its open gate: the fix is abandoned. The
 * decision closes the earliest judgement that accepts it; a gated developer with no judgement on it counts too.
 */
function abandoned(t: TaskState, e: MachineEvent): Judgement | "gate" | null {
  const isDevGate = (j: Judgement): boolean => (j.kind === "seatStatus" && j.seat === "developer") || j.kind === "commitMissing";
  if (e.type === "dispatched") {
    if (e.seat !== "developer") return null;
    return t.judgements.find((j) => isDevGate(j) && entryOf(j).close(j, e, t) && entryOf(j).successor(j, e, t) === "minimalFixAbandoned") ?? null;
  }
  const decision = e as Decision;
  if (elsewhere(decision)) return null;
  const first = t.judgements.find((j) => entryOf(j).close(j, decision, t));
  if (first !== undefined) return isDevGate(first) && entryOf(first).successor(first, decision, t) === "minimalFixAbandoned" ? first : null;
  return t.seats.developer.kind === "gated" ? "gate" : null;
}

/** The fix's own cycle: an abandoned developer or a kept failure of a verify of the fix sends it back with the fix spent. */
function fixStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  if (t.phase.kind !== "cycle" || t.phase.cycle !== "minimalFix") return t;
  const c = t.phase;
  if (e.type === "dispatched" || e.type === "decided" || e.type === "ruling") {
    const gate = abandoned(t, e);
    if (gate === null) return t;
    const judgements = gate === "gate" ? t.judgements : t.judgements.filter((j) => j !== gate);
    let next: TaskState = { ...t, judgements };
    const slot = t.seats.developer;
    if (slot.kind === "gated") {
      const status = typeof slot.status === "string" ? slot.status : slot.status.unknown;
      const answers = c.implementer.kind === "running" || c.implementer.kind === "commitMissing" ? c.implementer.dispatchLine : slot.doneLine;
      next = { ...next, seats: { ...next.seats, developer: { kind: "reported", status, answers } } };
    }
    return fixFailed(next, e.line);
  }
  // A run started before the fix developer is done, or before the fix's first commit, is of the tree before the fix.
  if (e.type === "verifyStarted" && t.seats.developer.kind === "reported" && c.sinceCommit !== null && c.sinceCommit > c.openedAt) {
    recordFixRun(world, t.id, e.line);
  }
  const v = t.verify;
  if (v.kind === "failed" && v.disposition.kind === "kept" && isFixRun(world, t.id, v.line)) return fixFailed(t, e.line);
  return t;
}

/** Applies one event to the task's region. */
export function atCapStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  if (!("task" in e) || e.task !== t.id) return t;
  if (t.phase.kind === "cycle") return fixStep(t, e, world);
  if (t.phase.kind !== "atCap") return t;
  const cell = (AT_CAP_TABLE[t.phase.cap.kind] as RegionRow)[e.type] as RegionHandler<typeof e.type> | "noop";
  return cell === "noop" ? t : cell(t, e as never, world);
}
