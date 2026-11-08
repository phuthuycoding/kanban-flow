import type { LedgerEvent, LedgerState, LoopInputs, Seat } from "../../workflow/next/types.js";

// An independent completion oracle: when may `complete TASK-NNN` be printed?
//
// It is written from the completion rule of the spec (every condition a task must meet before its complete line)
// and from `kf:implement` at 543cd17 (§ 3.2 seat statuses and routing, § 3.4 the cap, the Breaker and the minimal
// fix, § Resume). It imports no scheduler module on purpose: a test that compares the scheduler with a copy of its
// own logic proves nothing. Only the ledger types are shared.

export interface OracleVerdict {
  ready: boolean;
  /** Why the task may not complete yet; empty when `ready`. */
  blockers: string[];
}

type Ev = LedgerEvent;

const MIN_FIX = /^minimal fix past the cap:/;
const CAP = 5;

const taskOf = (e: Ev): string | undefined => ("task" in e ? e.task : undefined);
const isCommit = (e: Ev, task: string): boolean => (e.type === "commits" || e.type === "reviewPackage") && e.task === task;
const sameSha = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

/** Index just after the task's latest `reopened` note: the events of its current life start here. */
function lifeStart(events: Ev[], task: string): number {
  let start = 0;
  events.forEach((e, i) => {
    if (e.type === "reopened" && e.task === task) start = i + 1;
  });
  return start;
}

/** Complete when the latest complete or implemented line of the task is not cancelled by a later reopen. */
export function isComplete(events: Ev[], task: string): boolean {
  let done = false;
  for (const e of events) {
    if ((e.type === "complete" || e.type === "implemented") && e.task === task) done = true;
    else if (e.type === "reopened" && e.task === task) done = false;
  }
  return done;
}

interface Dispatch {
  index: number;
  seat: Seat;
  round?: number;
  cascade?: string;
  /** The status of the `done` that answers it, or null while it is open. */
  status: string | null;
  /** Index of that `done`. */
  doneAt: number;
  /** A later dispatch of the same seat, round and cascade replaced it before any answer (a resumed seat). */
  superseded: boolean;
}

/**
 * Pairs each `done` with the latest unanswered dispatch of the same seat before it. A dispatch that a later
 * dispatch of the same seat, round and cascade replaced before any answer is an honest orphan, not an open seat.
 */
function dispatchesOf(events: Ev[], task: string, from: number): Dispatch[] {
  const list: Dispatch[] = [];
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.type === "dispatched" && e.task === task) {
      for (const d of list) {
        if (d.status === null && !d.superseded && d.seat === e.seat && d.round === e.round && d.cascade === e.cascade) d.superseded = true;
      }
      list.push({ index: i, seat: e.seat, round: e.round, cascade: e.cascade, status: null, doneAt: -1, superseded: false });
    } else if (e.type === "done" && e.task === task) {
      const open = list.filter((d) => d.seat === e.seat && d.status === null && !d.superseded);
      const answered = open[open.length - 1];
      if (answered) {
        answered.status = e.status;
        answered.doneAt = i;
      }
    }
  }
  return list;
}

/** A decided note, or a Ruling line naming the task, after `after`. */
function decisionAfter(events: Ev[], task: string, after: number): boolean {
  return events.some(
    (e, i) =>
      i > after &&
      ((e.type === "decided" && e.task === task) || (e.type === "other" && e.text.startsWith("Ruling:") && new RegExp(`\\b${task}\\b`).test(e.text))),
  );
}

/** The verify run a `verify started` at `start` produced: the next `verify done` of the task, if any. */
function verifyDoneAfter(events: Ev[], task: string, start: number): { index: number; exit: number } | null {
  for (let i = start + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type === "verifyDone" && e.task === task) return { index: i, exit: e.exit };
    if (e.type === "verifyStarted" && e.task === task) return null;
  }
  return null;
}

export function completionOracle(state: LedgerState, inputs: LoopInputs, task: string): OracleVerdict {
  const events = state.events;
  const blockers: string[] = [];
  const block = (why: string): void => void blockers.push(why);

  const planned = inputs.tasks.find((t) => t.id === task);
  if (!planned) return { ready: false, blockers: [`${task} is not a plan task`] };
  if (isComplete(events, task)) return { ready: false, blockers: [`${task} is already complete`] };

  for (const dep of planned.dependencies) if (!isComplete(events, dep)) block(`dependency ${dep} is not complete`);

  const from = lifeStart(events, task);
  const own = (i: number): boolean => i >= from && taskOf(events[i]) === task;
  const dispatches = dispatchesOf(events, task, from);

  // No seat of the task is open.
  for (const d of dispatches) {
    if (d.status === null && !d.superseded) block(`${d.seat} dispatched at line ${events[d.index].line} has no done`);
  }

  // No verify is open, and no contention re-run of the task is owed or running.
  const starts = events.map((e, i) => (e.type === "verifyStarted" && e.task === task && i >= from ? i : -1)).filter((i) => i !== -1);
  const lastStart = starts.length > 0 ? starts[starts.length - 1] : -1;
  const lastRun = lastStart === -1 ? null : verifyDoneAfter(events, task, lastStart);
  if (lastStart !== -1 && lastRun === null) block("a verify of the task is running");
  const rerunAt = events.findIndex((e, i) => i >= from && e.type === "verifyRerun" && e.task === task && i > lastStart);
  if (rerunAt !== -1) block("a contention re-run of the task is owed");

  // The implementer seats: each latest answer must be DONE, or a status a decided note or a Ruling has closed; such
  // a seat goes on as DONE (FR-014), whatever status it ended with.
  for (const seat of ["test-writer", "automation-writer", "developer"] as Seat[]) {
    const answered = dispatches.filter((d) => d.seat === seat && d.status !== null);
    const latest = answered[answered.length - 1];
    if (!latest) continue;
    if (latest.status === "DONE") continue;
    if (decisionAfter(events, task, latest.doneAt)) continue;
    block(`${seat} ended ${latest.status} with no closing decision`);
  }

  // A test-writer or automation-writer that ended DONE wrote tests: their hashes must be recorded after its done, or
  // the developer's commit cannot be checked against them.
  for (const d of dispatches) {
    if ((d.seat !== "test-writer" && d.seat !== "automation-writer") || d.status !== "DONE") continue;
    if (!events.some((e, i) => i > d.doneAt && e.type === "testHashes" && e.task === task)) block(`the ${d.seat} done at line ${events[d.doneAt].line} has no test hashes after it`);
  }

  // A verify waiting on another task's commit owes the task a verify started after the note, or a parked line.
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "verifyWaits" || e.task !== task) continue;
    if (!events.some((x, j) => j > i && own(j) && (x.type === "verifyStarted" || x.type === "parked"))) block(`the verify wait on ${e.otherTask} is unanswered`);
  }

  // A legacy queued fix owes the task a fix-round developer dispatched after it.
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "fixQueued" || e.task !== task) continue;
    if (!dispatches.some((d) => d.index > i && d.seat === "developer" && d.round !== undefined)) block("the queued fix has no developer");
  }

  // The developer committed: the latest developer dispatch of this life is followed by a commit of the task.
  const devs = dispatches.filter((d) => d.seat === "developer" && !d.superseded);
  const lastDev = devs[devs.length - 1];
  if (!lastDev) block("no developer ran in this life of the task");
  const commitIdx = events.map((e, i) => (i >= from && isCommit(e, task) ? i : -1)).filter((i) => i !== -1);
  const lastCommit = commitIdx.length > 0 ? commitIdx[commitIdx.length - 1] : -1;
  if (lastDev && !commitIdx.some((i) => i > lastDev.index)) block("the latest developer has no commit after its dispatch");

  // A round test-writer or automation-writer owes a developer that reports after it and commits its fixed tests.
  for (const d of dispatches) {
    if ((d.seat === "test-writer" || d.seat === "automation-writer") && d.round !== undefined && d.status !== null) {
      if (!devs.some((dev) => dev.doneAt > d.doneAt)) block(`the ${d.seat} of round ${d.round} owes a developer to commit its tests`);
    }
  }

  // The cap: parked findings plus a decided note that is not a minimal fix, in either order, waive the findings.
  const roundFive = events.findIndex((e, i) => i >= from && e.type === "dispatched" && e.task === task && (e.round ?? 0) >= CAP);
  const afterCap = (i: number): boolean => roundFive !== -1 && i > roundFive;
  const parkedAt = events.map((e, i) => (afterCap(i) && e.type === "parked" && e.task === task ? i : -1)).filter((i) => i !== -1);
  const decidedPlain = events.some((e, i) => afterCap(i) && e.type === "decided" && e.task === task && !MIN_FIX.test(e.what));
  const fixNote = events.findIndex((e, i) => afterCap(i) && e.type === "decided" && e.task === task && MIN_FIX.test(e.what));
  const minimalFix = fixNote !== -1;
  const parkedClosed = parkedAt.length > 0 && decidedPlain && !minimalFix;

  if (minimalFix) {
    const fixDev = dispatches.find((d) => d.seat === "developer" && d.round === undefined && d.index > fixNote);
    if (!fixDev) block("the minimal fix past the cap has no developer");
  }

  // The verify passed on the latest commits, passed by route, or a kept failure is waived by parking.
  const passedOnLatest = lastRun !== null && lastRun.exit === 0 && lastStart > lastCommit;
  let passedByRoute = false;
  if (lastRun !== null && lastRun.exit === 1) {
    const route = events.findIndex((e, i) => i > lastRun.index && e.type === "verifyRouted" && e.task === task);
    if (route !== -1) {
      const target = (events[route] as Extract<Ev, { type: "verifyRouted" }>).otherTask;
      passedByRoute = events.some(
        (e, i) => i > route && ((e.type === "verifyDone" && e.task === target && e.exit === 0) || (e.type === "parked" && e.task === target)),
      );
    }
  }
  const keptWaived = parkedClosed && lastRun !== null && lastRun.exit === 1;
  if (lastStart === -1) block("the task was never verified");
  else if (!(passedOnLatest || passedByRoute || keptWaived)) {
    block(lastRun === null ? "no verify result" : lastStart < lastCommit ? "no verify after the latest commit" : `the latest verify exited ${lastRun.exit}`);
  }

  // The own review: the latest non-cascade review of this life reviewed the latest commits and came back clean.
  const ownReviews = dispatches.filter((d) => d.seat === "code-reviewer" && d.cascade === undefined && !d.superseded);
  const lastOwn = ownReviews[ownReviews.length - 1];
  if (!lastOwn) block("the task has no own review");
  else if (lastOwn.status !== "clean") {
    const waived = parkedClosed && lastOwn.status === "findings";
    if (!waived) block(`the latest own review is ${lastOwn.status ?? "open"}`);
  } else if (lastOwn.index < lastCommit) block("the latest own review predates the latest commit");

  // Every cascade re-review owed is clean, cleared by a later own clean review, or parked at the cap.
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "cascadeOwed" || e.task !== task) continue;
    const cascadeClean = dispatches.some((d) => d.seat === "code-reviewer" && d.cascade !== undefined && sameSha(d.cascade, e.sha) && d.status === "clean");
    const ownClean = ownReviews.some((d) => d.index > i && d.status === "clean");
    const parkedLater = parkedClosed && parkedAt.some((p) => p > i);
    if (!(cascadeClean || ownClean || parkedLater)) block(`the cascade re-review after ${e.sha} is not clean`);
  }

  // No failure routed into the task is unanswered: a later passing verify or a parked line of the task answers it.
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== "verifyRouted" || e.otherTask !== task || i < from) continue;
    const answered = events.some(
      (x, j) => j > i && own(j) && ((x.type === "verifyDone" && x.exit === 0) || x.type === "parked"),
    );
    if (!answered) block(`the failure ${e.task} routed into the task is unanswered`);
  }

  return { ready: blockers.length === 0, blockers };
}
