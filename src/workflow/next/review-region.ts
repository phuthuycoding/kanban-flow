import { enterCap, enterCascadeAtCap, fixFailed } from "./atcap.js";
import { JUDGEMENTS } from "./judgements.js";
import type {
  GateStatus,
  Judgement,
  JudgementEntry,
  JudgementKind,
  ReviewDemand,
  ReviewLane,
  ReviewLaneKind,
  MachineEvent,
  MachineEventOf,
  RegionHandler,
  RegionRow,
  RegionTable,
  TaskState,
  World,
} from "./types.js";

// Review region: one reviewer lane per task, own and cascade demands, the own verdict.

const MAX_ROUNDS = 5;
const GATES: readonly string[] = ["DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"];

type Cascade = Extract<ReviewDemand, { kind: "cascade" }>;
type Busy = Extract<ReviewLane, { kind: "busy" }>;
type Decision = MachineEventOf<"decided"> | MachineEventOf<"ruling">;

const sameSha = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);
const gateStatus = (status: string): GateStatus => (GATES.includes(status) ? (status as GateStatus) : { unknown: status });

const entryOf = (j: Judgement): JudgementEntry<JudgementKind> => JUDGEMENTS[j.kind] as unknown as JudgementEntry<JudgementKind>;

const isReviewerGate = (j: Judgement): boolean => j.kind === "seatStatus" && j.seat === "code-reviewer";

const sameObligation = (a: ReviewDemand, b: ReviewDemand): boolean =>
  a.kind === "own" ? b.kind === "own" : b.kind === "cascade" && sameSha(a.sha7, b.sha7);

const withReview = (t: TaskState, review: Partial<TaskState["review"]>): TaskState => ({ ...t, review: { ...t.review, ...review } });

/** The demands with the cascade demand for `sha7` put in `phase`. */
const cascadeTo = (demands: ReviewDemand[], sha7: string, phase: Cascade["phase"]): ReviewDemand[] =>
  demands.map((d) => (d.kind === "cascade" && sameSha(d.sha7, sha7) ? { ...d, phase } : d));

/** An obligation the lane no longer holds goes back to owed: a cascade demand to `owed`, an own demand stays queued. */
const backToOwed = (demands: ReviewDemand[], obligation: ReviewDemand): ReviewDemand[] =>
  obligation.kind === "cascade" ? cascadeTo(demands, obligation.sha7, "owed") : demands;

/** A reviewer dispatch takes the obligation it names: a cascade by its sha, else the first own demand. */
function obligationOf(demands: ReviewDemand[], e: MachineEventOf<"dispatched">): { obligation: ReviewDemand; demands: ReviewDemand[] } {
  if (e.cascade === undefined) {
    const own = demands.find((d) => d.kind === "own");
    if (own !== undefined) return { obligation: own, demands };
    const added: ReviewDemand = { kind: "own", ...(e.round !== undefined ? { round: e.round } : {}) };
    return { obligation: added, demands: [...demands, added] };
  }
  const sha7 = e.cascade;
  const match =
    demands.find((d): d is Cascade => d.kind === "cascade" && sameSha(d.sha7, sha7) && d.phase !== "clean" && d.phase !== "findings") ??
    demands.find((d): d is Cascade => d.kind === "cascade" && sameSha(d.sha7, sha7));
  if (match !== undefined) {
    const obligation: Cascade = { ...match, phase: "dispatched" };
    return { obligation, demands: demands.map((d) => (d === match ? obligation : d)) };
  }
  // A legacy cascade dispatch no landed cascade named: the dependency it re-reviews is not on the line.
  const added: Cascade = { kind: "cascade", sha7: sha7.slice(0, 7), round: e.round ?? 0, of: "", phase: "dispatched" };
  return { obligation: added, demands: [...demands, added] };
}

/** A reviewer dispatch: takes the lane, closes an open gate of the reviewer, and puts a stacked obligation back to owed. */
const onDispatched: RegionHandler<"dispatched"> = (t, e) => {
  if (e.seat !== "code-reviewer") return t;
  const lane = t.review.lane;
  let { obligation, demands } = obligationOf(t.review.demands, e);
  if (lane.kind === "busy" && !sameObligation(lane.obligation, obligation)) demands = backToOwed(demands, lane.obligation);
  const judgements = t.judgements.filter((j) => !(isReviewerGate(j) && entryOf(j).close(j, e, t)));
  return {
    ...t,
    judgements,
    seats: {
      ...t.seats,
      "code-reviewer": {
        kind: "running",
        line: e.line,
        ...(e.round !== undefined ? { round: e.round } : {}),
        ...(e.cascade !== undefined ? { cascade: e.cascade } : {}),
        inline: false,
        origin: "progress",
      },
    },
    review: { ...t.review, lane: { kind: "busy", line: e.line, obligation }, demands },
  };
};

/** A verdict of the own review the lane holds; a review dispatched before the latest commit is of an older tree. */
function ownVerdict(t: TaskState, lane: Busy, verdict: "clean" | "findings", at: number): TaskState {
  const i = t.review.demands.findIndex((d) => d.kind === "own");
  const rest = i === -1 ? t.review.demands : t.review.demands.filter((_, k) => k !== i);
  // The lane runs one review at a time, so a clean own review was dispatched after any cascade findings: it answers them.
  const demands = verdict === "clean" ? rest.map((d) => (d.kind === "cascade" && d.phase === "findings" ? { ...d, phase: "clean" as const } : d)) : rest;
  const phase = t.phase;
  const current = phase.kind !== "cycle" || phase.sinceCommit === null || lane.line > phase.sinceCommit;
  const next = withReview(t, { lane: { kind: "free" }, demands, ...(current ? { ownVerdict: verdict } : {}) });
  // The minimal fix's own review, dispatched after the fix's developer, is the fix's outcome.
  if (verdict === "findings" && phase.kind === "cycle" && phase.cycle === "minimalFix" && lane.line > phase.openedAt) return fixFailed(next, at);
  return next;
}

function cascadeVerdict(t: TaskState, obligation: Cascade, verdict: "clean" | "findings", at: number): TaskState {
  const next = withReview(t, { lane: { kind: "free" }, demands: cascadeTo(t.review.demands, obligation.sha7, verdict) });
  const phase = next.phase;
  // With rounds left the findings are a fix trigger the intents read; a cascade review never fails the minimal fix.
  if (verdict === "findings" && phase.kind === "cycle" && phase.cycle !== "minimalFix" && next.roundsUsed >= MAX_ROUNDS) {
    return enterCascadeAtCap(next, obligation.sha7, at);
  }
  return next;
}

/** A done answers the obligation the lane holds; a status other than clean or findings gates the seat, no verdict taken. */
const onDone: RegionHandler<"done"> = (t, e) => {
  const lane = t.review.lane;
  if (e.seat !== "code-reviewer" || lane.kind !== "busy" || t.seats["code-reviewer"].kind === "gated") return t;
  if (e.status === "clean" || e.status === "findings") {
    const reported: TaskState = { ...t, seats: { ...t.seats, "code-reviewer": { kind: "reported", status: e.status, answers: lane.line } } };
    return lane.obligation.kind === "own" ? ownVerdict(reported, lane, e.status, e.line) : cascadeVerdict(reported, lane.obligation, e.status, e.line);
  }
  const status = gateStatus(e.status);
  return {
    ...t,
    seats: { ...t.seats, "code-reviewer": { kind: "gated", status, doneLine: e.line } },
    judgements: [...t.judgements, { kind: "seatStatus", task: t.id, openedAt: e.line, seat: "code-reviewer", status, doneLine: e.line }],
  };
};

/**
 * A decided note or a Ruling that closes the reviewer's gate (the earliest judgement it closes; a gated reviewer with no
 * judgement on it counts too) owes the same review again: a reviewer has no DONE to go on as.
 */
function onDecision(t: TaskState, e: Decision): TaskState {
  const slot = t.seats["code-reviewer"];
  if (slot.kind !== "gated" || (e.closes !== undefined && e.closes.region !== "review")) return t;
  const first = t.judgements.find((j) => entryOf(j).close(j, e, t));
  if (first !== undefined && !(isReviewerGate(first) && entryOf(first).successor(first, e, t) === "seatRedispatch")) return t;
  const lane = t.review.lane;
  const obligation: ReviewDemand = lane.kind === "busy" ? lane.obligation : { kind: "own" };
  const round = obligation.round;
  return {
    ...t,
    judgements: first === undefined ? t.judgements : t.judgements.filter((j) => j !== first),
    seats: {
      ...t.seats,
      "code-reviewer": {
        kind: "redispatchOwed",
        mode: "new",
        ...(round !== undefined ? { round } : {}),
        ...(obligation.kind === "cascade" ? { cascade: obligation.sha7 } : {}),
      },
    },
    review: { ...t.review, lane: { kind: "free" }, demands: backToOwed(t.review.demands, obligation) },
  };
}

const onDecided: RegionHandler<"decided"> = (t, e) => onDecision(t, e);
const onRuling: RegionHandler<"ruling"> = (t, e) => onDecision(t, e);

/** A fix commit of a dependency landed: the cascade re-review is owed once its owed line is written. */
const onCascadeLanded: RegionHandler<"cascadeLanded"> = (t, e) => {
  if (t.review.demands.some((d) => d.kind === "cascade" && sameSha(d.sha7, e.sha7))) return t;
  const demand: Cascade = { kind: "cascade", sha7: e.sha7, round: e.round, of: e.from, phase: "lineOwed" };
  return withReview(t, { demands: [...t.review.demands, demand] });
};

const onCascadeOwed: RegionHandler<"cascadeOwed"> = (t, e) => {
  const demands = t.review.demands;
  if (demands.some((d) => d.kind === "cascade" && sameSha(d.sha7, e.sha))) {
    return withReview(t, {
      demands: demands.map((d) => (d.kind === "cascade" && sameSha(d.sha7, e.sha) && d.phase === "lineOwed" ? { ...d, phase: "owed" } : d)),
    });
  }
  // An owed line the fold delivered no landing for (a legacy ledger): the round it came from is not on the line.
  return withReview(t, { demands: [...demands, { kind: "cascade", sha7: e.sha.slice(0, 7), round: 0, of: e.otherTask, phase: "owed" }] });
};

/** A recorded commit (the lifecycle moved `sinceCommit` to it) is a new tree: its own review is owed, the old verdict void. */
const onCommits: RegionHandler<"commits"> = (t, e) => {
  const c = t.phase;
  if (c.kind !== "cycle" || c.sinceCommit !== e.line) return t;
  const lane = t.review.lane;
  const owns = t.review.demands.filter((d) => d.kind === "own").length;
  const queued = lane.kind === "busy" && lane.obligation.kind === "own" ? owns > 1 : owns > 0;
  const demand: ReviewDemand = { kind: "own", ...(c.cycle === "round" ? { round: c.round } : {}) };
  return withReview(t, { ownVerdict: "none", ...(queued ? {} : { demands: [...t.review.demands, demand] }) });
};

/**
 * The cycle verdict at round five: once the implementer is committed, the verify settled and the own review reported,
 * a fix trigger left open (own findings, a kept failure, an unanswered routed-in failure) puts the task at the cap.
 */
function capVerdict(t: TaskState, at: number): TaskState {
  const c = t.phase;
  if (c.kind !== "cycle" || c.cycle !== "round" || c.round < MAX_ROUNDS || c.implementer.kind !== "committed") return t;
  if (t.review.lane.kind !== "free" || t.review.ownVerdict === "none") return t;
  const v = t.verify;
  const kept = v.kind === "failed" && v.disposition.kind === "kept";
  // Own findings or a routed-in failure put the task at the cap at once, as they owe the next round below it.
  const now = t.review.ownVerdict === "findings" || t.routedIn.some((r) => !r.answered);
  return now || kept ? enterCap(t, at) : t;
}

const NOOP_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: "noop", capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

/** The cells either lane state shares: a dispatch, a decision on the reviewer's gate, cascades and commits. */
const BASE_ROW = {
  ...NOOP_ROW,
  dispatched: onDispatched,
  decided: onDecided,
  ruling: onRuling,
  cascadeLanded: onCascadeLanded,
  cascadeOwed: onCascadeOwed,
  commits: onCommits,
} satisfies RegionRow;

/** The review region: reviewer lane × event. */
export const REVIEW_TABLE = {
  free: BASE_ROW,
  busy: { ...BASE_ROW, done: onDone },
} satisfies RegionTable<ReviewLaneKind>;

/** Applies one event to the task's region. */
export function reviewStep(t: TaskState, e: MachineEvent, world: World): TaskState {
  if (!("task" in e) || e.task !== t.id) return t;
  const cell = (REVIEW_TABLE[t.review.lane.kind] as RegionRow)[e.type] as RegionHandler<typeof e.type> | "noop";
  const next = cell === "noop" ? t : cell(t, e as never, world);
  return capVerdict(next, e.line);
}
