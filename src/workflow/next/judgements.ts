import type { Judgement, JudgementEntry, JudgementKind, JudgementTable, MachineEvent, Seat, TaskState } from "./types.js";

// The judgement table: every decide and stop `kf next` prints for a judgement, with the lines that close it.
// `closes` lists alternatives, each a conjunction of ledger-line templates: `<task>` is the judged task, `<seat>` the
// gated seat, `<error>` the judgement's error, `<sha7>` a commit; any other `<name>` and `…` are free text the session
// fills. Every template is a line `kf record` accepts, so no judgement is a dead end.

const MINIMAL_FIX = "minimal fix past the cap:";

const decided = (e: MachineEvent, task: string | undefined): boolean => e.type === "decided" && e.task === task;

const minimalFix = (e: MachineEvent, task: string | undefined): boolean =>
  e.type === "decided" && e.task === task && e.what.startsWith(MINIMAL_FIX);

const plainDecided = (e: MachineEvent, task: string | undefined): boolean => decided(e, task) && !minimalFix(e, task);

const parked = (e: MachineEvent, task: string | undefined): boolean => e.type === "parked" && e.task === task;

const superseded = (e: MachineEvent, task: string | undefined): boolean =>
  e.type === "complete" && e.task === task && e.text.includes("superseded");

const dispatched = (e: MachineEvent, task: string | undefined, seat: Seat): boolean =>
  e.type === "dispatched" && e.task === task && e.seat === seat;

/** The Breaker's park-plus-decided close: `e` is the half that completes the pair, in either order. */
function parkPairCloses(e: MachineEvent, task: string | undefined, t: TaskState | null): boolean {
  if (t === null || t.phase.kind !== "atCap" || t.phase.cap.kind !== "breaker") return false;
  const breaker = t.phase.cap;
  if (parked(e, task)) return breaker.decidedAt !== undefined;
  return plainDecided(e, task) && breaker.parked.length > 0;
}

const PARK = "<task>: parked — <finding> — Ruling: <why>";
const DECIDED = "Note <task>: decided — <what>";
const MINIMAL_FIX_NOTE = `Note <task>: decided — ${MINIMAL_FIX} <change>`;
const SUPERSEDED = "<task>: complete (superseded — <why>)";
const VERIFY_STARTED = "<task>: verify started";
const SEAT_REDISPATCH = ["<task>: <seat> dispatched …"];
const SEAT_COMMITS = ["Note <task>: commits <sha7>"];
const DEV_REDISPATCH = ["<task>: developer dispatched …"];

/** One minimal fix per task: a developer of a minimal-fix cycle is never re-armed. */
const inMinimalFix = (t: TaskState | null | undefined): boolean => t?.phase.kind === "cycle" && t.phase.cycle === "minimalFix";

export const JUDGEMENTS: JudgementTable = {
  conflictScan: {
    rule: "Conflict scan",
    form: "decide",
    closes: [["Scan: …"]],
    close: (_j, e) => e.type === "scan",
    successor: () => "scanDone",
  },
  seatStatus: {
    rule: "Seat status",
    form: "decide",
    // A commits note closes a developer's gate only (a BLOCKED quoting `commit made`).
    closes: [SEAT_REDISPATCH, [DECIDED], ["Ruling: <task> — <what>"], SEAT_COMMITS],
    close: (j, e) =>
      dispatched(e, j.task, j.seat) ||
      decided(e, j.task) ||
      (e.type === "ruling" && e.task === j.task) ||
      (j.seat === "developer" && e.type === "commits" && e.task === j.task),
    successor: (j, e, t) => {
      if (e.type === "dispatched") return j.seat === "developer" && inMinimalFix(t) ? "minimalFixAbandoned" : "seatRunning";
      if (e.type === "commits") return "afterDevDone";
      // Closed by a decision: a review is owed again rather than taken as a verdict, and a minimal fix gets no retry.
      if (j.seat === "code-reviewer") return "seatRedispatch";
      if (j.seat === "developer" && inMinimalFix(t)) return "minimalFixAbandoned";
      return "seatAsDone";
    },
  },
  commitMissing: {
    rule: "Commit missing",
    form: "decide",
    closes: [["Note <task>: commits <sha7>"], DEV_REDISPATCH],
    close: (j, e) => (e.type === "commits" && e.task === j.task) || dispatched(e, j.task, "developer"),
    successor: (_j, e, t) => {
      if (e.type !== "dispatched") return "afterDevDone";
      return inMinimalFix(t) ? "minimalFixAbandoned" : "seatRunning";
    },
  },
  verifyExit2: {
    rule: "Verify exit 2",
    form: "stop",
    closes: [[DECIDED], [VERIFY_STARTED]],
    close: (j, e) => decided(e, j.task) || (e.type === "verifyStarted" && e.task === j.task),
    successor: (_j, e) => (e.type === "verifyStarted" ? "verifyRunning" : "verifyOwed"),
  },
  verifyExit3: {
    rule: "Verify exit 3",
    form: "decide",
    closes: [[DECIDED], [VERIFY_STARTED]],
    close: (j, e) => decided(e, j.task) || (e.type === "verifyStarted" && e.task === j.task),
    successor: (_j, e) => (e.type === "verifyStarted" ? "verifyRunning" : "verifyOwed"),
  },
  verifyExit: {
    rule: "Verify exit",
    form: "decide",
    closes: [[DECIDED], [VERIFY_STARTED]],
    close: (j, e) => decided(e, j.task) || (e.type === "verifyStarted" && e.task === j.task),
    successor: (_j, e) => (e.type === "verifyStarted" ? "verifyRunning" : "verifyOwed"),
  },
  verifyRouted: {
    rule: "Verify routed",
    form: "decide",
    closes: [[DECIDED]],
    close: (j, e) => decided(e, j.task),
    successor: () => "verifyKept",
  },
  verifyWaitsUnreleasable: {
    rule: "Verify waits",
    form: "stop",
    closes: [[DECIDED]],
    close: (j, e) => decided(e, j.task),
    successor: () => "verifyKept",
  },
  breaker: {
    rule: "Breaker",
    form: "decide",
    // A parked line and a decided note together, in either order; or the one minimal fix.
    closes: [[PARK, DECIDED], [MINIMAL_FIX_NOTE]],
    close: (j, e, t) => minimalFix(e, j.task) || parkPairCloses(e, j.task, t),
    successor: (j, e) => (minimalFix(e, j.task) ? "minimalFixOwed" : "parkedClosed"),
  },
  breakerFixSpent: {
    rule: "Breaker",
    form: "decide",
    // The minimal fix is spent: closable only by parking.
    closes: [[PARK]],
    close: (j, e) => parked(e, j.task),
    successor: () => "parkedClosed",
  },
  capStop: {
    rule: "Cap stop",
    form: "stop",
    closes: [[MINIMAL_FIX_NOTE], [SUPERSEDED]],
    close: (j, e) => minimalFix(e, j.task) || superseded(e, j.task),
    successor: (j, e) => (minimalFix(e, j.task) ? "minimalFixOwed" : "complete"),
  },
  capStopFixSpent: {
    rule: "Cap stop",
    form: "stop",
    closes: [[SUPERSEDED]],
    close: (j, e) => superseded(e, j.task),
    successor: () => "complete",
  },
  cascadeAtCapBreaker: {
    rule: "Breaker",
    form: "decide",
    closes: [[PARK]],
    close: (j, e) => parked(e, j.task),
    successor: () => "parkedClosed",
  },
  cascadeAtCapStop: {
    rule: "Cap stop",
    form: "stop",
    closes: [[SUPERSEDED]],
    close: (j, e) => superseded(e, j.task),
    successor: () => "complete",
  },
  invalidCeiling: {
    rule: "Invalid ceiling",
    form: "decide",
    closes: [["Ruling: … <error>"]],
    close: (j, e) => e.type === "other" && e.text.startsWith("Ruling:") && e.text.includes(j.error),
    successor: () => "ceilingRuled",
  },
  drift: {
    rule: "Drift",
    form: "decide",
    closes: [["<task>: developer done status=DONE"]],
    close: (j, e) => e.type === "done" && e.task === j.task && e.seat === "developer" && e.status === "DONE",
    successor: () => "afterDevDone",
  },
  unknownTask: {
    rule: "Unknown task",
    form: "decide",
    closes: [[DECIDED]],
    close: (j, e) => decided(e, j.task),
    successor: () => "unknownDecided",
  },
};

/**
 * Whether `alt` is offered for `j` in task state `t`: a commits note only to a developer seat (the only seat its close
 * predicate accepts it for), and no developer re-dispatch in a minimal-fix cycle (one recorded anyway abandons the fix).
 */
function offered(alt: string[], j: Judgement, t: TaskState | null | undefined): boolean {
  if (alt === SEAT_COMMITS) return j.kind === "seatStatus" && j.seat === "developer";
  if (alt === SEAT_REDISPATCH) return !(j.kind === "seatStatus" && j.seat === "developer" && inMinimalFix(t));
  if (alt === DEV_REDISPATCH) return !inMinimalFix(t);
  return true;
}

/**
 * The closes alternatives offered for `j` as one line of text, `<task>`, `<seat>` and `<error>` filled from `j`: the
 * lines of a conjunction joined by `and`, the alternatives by `or`. `t` is the task state, for the cycle-dependent
 * alternatives.
 */
export function closesText<K extends JudgementKind>(entry: JudgementEntry<K>, j: Judgement<K>, t?: TaskState | null): string {
  const judgement = j as Judgement;
  const fill = (template: string): string => {
    let line = template;
    if (judgement.task !== undefined) line = line.replaceAll("<task>", judgement.task);
    if (judgement.kind === "seatStatus") line = line.replaceAll("<seat>", judgement.seat);
    if (judgement.kind === "invalidCeiling") line = line.replaceAll("<error>", judgement.error);
    return line;
  };
  return entry.closes
    .filter((alt) => offered(alt, judgement, t))
    .map((alt) => alt.map(fill).join(" and "))
    .join(" or ");
}
