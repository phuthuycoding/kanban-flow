import { completedTaskIds, taskCommits } from "./ledger-state.js";
import { shellQuote } from "./record.js";
import type { Action, Cap, LedgerEvent, LedgerState, LoopInputs, LoopTask, Seat } from "./types.js";

// FR-008, FR-009, FR-010, FR-014: verify exit codes, fix rounds, reopens, the breaker, cascades and non-DONE seat statuses,
// as `kf:implement` § 3.2, § 3.4 and Resume from the ledger steps 9–11 lay them out. Pure: no filesystem, git or clock.
// Dispatches ignore the developer cap and the holds: `schedule()` arbitrates them.

const NON_DONE = new Set(["NEEDS_CONTEXT", "BLOCKED", "DONE_WITH_CONCERNS"]);
const ROUND_SEATS: Seat[] = ["test-writer", "developer", "automation-writer"];
const MAX_ROUNDS = 5;
const FRESH_FROM = 4;

type Dispatched = Extract<LedgerEvent, { type: "dispatched" }>;
type Dispatch = Extract<Action, { kind: "dispatch" }>;

const sameSha = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

/** Index of the last event matching `pred`, or -1. */
function lastIndex(events: LedgerEvent[], pred: (e: LedgerEvent) => boolean): number {
  for (let i = events.length - 1; i >= 0; i--) if (pred(events[i])) return i;
  return -1;
}

const anyAfter = (events: LedgerEvent[], index: number, pred: (e: LedgerEvent) => boolean): boolean =>
  events.slice(index + 1).some(pred);

function verifyCommand(state: LedgerState, inputs: LoopInputs, task: string, atHead: boolean): string {
  const shas = taskCommits(state, task, inputs.reportCommits[task], inputs.gitLog).join(",");
  return `kf verify ${inputs.feature} --task ${task} --commits ${shas}${atHead ? " --at-head" : ""}`;
}

/** The cap holds a failed verify of `task` as contention, or owes its step-down: not routing's to act on. */
function heldByCap(cap: Cap, task: string): boolean {
  if (cap.contention.held.some((h) => h.task === task) || cap.contention.running === task) return true;
  return cap.owed.some((a) => a.kind === "write" && (a.line.includes(`${task} verify`) || a.line.includes(`Note ${task}: verify rerun`)));
}

/** The task's latest `code-reviewer dispatched` has its `done`. */
function reviewReported(events: LedgerEvent[], task: string): boolean {
  const i = lastIndex(events, (e) => e.type === "dispatched" && e.task === task && e.seat === "code-reviewer");
  return i !== -1 && anyAfter(events, i, (e) => e.type === "done" && e.task === task && e.seat === "code-reviewer");
}

interface VerifyView {
  /** Index of a kept `exit=1` that is this task's own failure (no waits or routed note after it). */
  keptFailure: number | null;
}

/** A judgement the human or the session owes on a task; each `decided` note closes exactly one. */
interface Gate {
  kind: "seat" | "exit2" | "exit3" | "breaker";
  /** Index of the event that opened it. */
  index: number;
  seat?: Seat;
}

/** A failed verify at `i` that the breaker takes: not a contention re-run, a wait for a neighbour or a routed failure. */
function breakerFailure(events: LedgerEvent[], cap: Cap, task: string, i: number): boolean {
  const next = events.findIndex((e, j) => j > i && e.type === "verifyStarted" && e.task === task);
  const between = next === -1 ? events.slice(i + 1) : events.slice(i + 1, next);
  if (between.some((e) => (e.type === "verifyRerun" || e.type === "verifyWaits" || e.type === "verifyRouted") && e.task === task)) return false;
  return next !== -1 || !heldByCap(cap, task);
}

/**
 * The task's gates still open at the end of the ledger. Gates open in ledger order; each `decided` note of the task
 * closes the earliest-opened gate still open at that point, so a note written for one gate never lifts another.
 * A `Ruling:` line naming the task closes its earliest open Seat status gate only.
 */
function openGates(events: LedgerEvent[], cap: Cap, task: string, reopened: boolean): Gate[] {
  let open: Gate[] = [];
  let round = 0;
  const namesTask = new RegExp(`\\b${task}(?!\\d)`);
  events.forEach((e, i) => {
    if (e.type === "verifyRouted" && e.otherTask === task && !reopened && round >= MAX_ROUNDS && !open.some((g) => g.kind === "breaker")) {
      open.push({ kind: "breaker", index: i });
    }
    if (e.type === "other" && e.text.startsWith("Ruling:") && namesTask.test(e.text)) {
      const seatGate = open.findIndex((g) => g.kind === "seat");
      if (seatGate !== -1) open.splice(seatGate, 1);
      return;
    }
    if (!("task" in e) || e.task !== task) return;
    if (isRoundSeat(e, task)) round = Math.max(round, e.round!);
    if (e.type === "dispatched") open = open.filter((g) => !(g.kind === "seat" && g.seat === e.seat));
    else if (e.type === "commits") open = open.filter((g) => !(g.kind === "seat" && g.seat === "developer"));
    else if (e.type === "verifyStarted") open = open.filter((g) => g.kind !== "exit2" && g.kind !== "exit3");
    else if (e.type === "decided") open = open.slice(1);
    else if (e.type === "done" && NON_DONE.has(e.status)) open.push({ kind: "seat", index: i, seat: e.seat });
    else if (e.type === "verifyDone" && e.exit === 2) open.push({ kind: "exit2", index: i });
    else if (e.type === "verifyDone" && e.exit === 3) open.push({ kind: "exit3", index: i });

    const breakerTrigger =
      (e.type === "done" && e.seat === "code-reviewer" && e.status === "findings") ||
      (e.type === "verifyDone" && e.exit === 1 && breakerFailure(events, cap, task, i));
    if (breakerTrigger && !reopened && round >= MAX_ROUNDS && !open.some((g) => g.kind === "breaker")) {
      open.push({ kind: "breaker", index: i });
    }
  });
  return open;
}

function seatStatus(events: LedgerEvent[], task: string, gates: Gate[]): Action[] {
  const actions: Action[] = [];
  for (const gate of gates) {
    if (gate.kind !== "seat") continue;
    const seat = gate.seat!;
    const done = events[gate.index] as Extract<LedgerEvent, { type: "done" }>;
    const commitNote = seat === "developer" && done.status === "BLOCKED" ? ` | Note ${task}: commits <sha7>` : "";
    actions.push({
      kind: "decide",
      task,
      rule: "Seat status",
      reason: `${seat} ended ${done.status}`,
      closes: `${task}: ${seat} dispatched … | Note ${task}: decided — <what>${commitNote}`,
    });
  }
  return actions;
}

const datedAfter = (inputs: LoopInputs, sha: string, ts: number): boolean =>
  inputs.gitLog.some((g) => sameSha(g.sha, sha) && g.ts >= ts);

/**
 * The task a `verify waits` note at `w` names has committed since the note: a later commits note, or a later
 * developer `done` whose review package or report names a commit dated after the note.
 */
function namedTaskCommitted(state: LedgerState, inputs: LoopInputs, w: number): boolean {
  const { events } = state;
  const waits = events[w] as Extract<LedgerEvent, { type: "verifyWaits" }>;
  const other = waits.otherTask;
  if (anyAfter(events, w, (e) => e.type === "commits" && e.task === other)) return true;
  if (!anyAfter(events, w, (e) => e.type === "done" && e.task === other && e.seat === "developer")) return false;
  const packaged = events.flatMap((e) => (e.type === "reviewPackage" && e.task === other ? e.shas : []));
  return [...packaged, ...(inputs.reportCommits[other] ?? [])].some((sha) => datedAfter(inputs, sha, waits.ts));
}

function verifyRouting(
  state: LedgerState,
  inputs: LoopInputs,
  cap: Cap,
  task: string,
  actions: Action[],
  routed: Map<string, number[]>,
  gates: Gate[],
): VerifyView {
  const { events } = state;
  const v = lastIndex(events, (e) => e.type === "verifyDone" && e.task === task);
  if (v === -1 || anyAfter(events, v, (e) => e.type === "verifyStarted" && e.task === task)) return { keptFailure: null };
  const { exit } = events[v] as Extract<LedgerEvent, { type: "verifyDone" }>;
  // No `verify started` follows `v`, so its gate is closed only by the `decided` note that the one-note-one-gate rule gives it.
  const decidedAfter = !gates.some((g) => (g.kind === "exit2" || g.kind === "exit3") && g.index === v);

  if (exit === 2) {
    if (decidedAfter) actions.push({ kind: "verify", task, command: verifyCommand(state, inputs, task, false) });
    else {
      actions.push({
        kind: "stop",
        task,
        reason: `${task} verify exit 2: a changed file is outside the task's Files — replan, have the human re-approve, then record Note ${task}: decided — <what>`,
      });
    }
    return { keptFailure: null };
  }
  if (exit === 3) {
    if (decidedAfter) actions.push({ kind: "verify", task, command: verifyCommand(state, inputs, task, false) });
    else {
      actions.push({
        kind: "decide",
        task,
        rule: "Verify exit 3",
        reason: `${task} verify exit 3: bad input, nothing ran — fix the call and re-run it, or report a kf error to the human; never a fix round`,
        closes: `Note ${task}: decided — <what> | ${task}: verify started`,
      });
    }
    return { keptFailure: null };
  }
  if (exit !== 1 || heldByCap(cap, task)) return { keptFailure: null };

  const w = lastIndex(events, (e) => e.type === "verifyWaits" && e.task === task);
  if (w > v) {
    const waits = events[w] as Extract<LedgerEvent, { type: "verifyWaits" }>;
    if (namedTaskCommitted(state, inputs, w)) {
      actions.push({ kind: "verify", task, command: verifyCommand(state, inputs, task, true) });
    } else {
      actions.push({ kind: "wait", task, reason: `verify waits for ${waits.otherTask}` });
    }
    return { keptFailure: null };
  }
  const r = lastIndex(events, (e) => e.type === "verifyRouted" && e.task === task);
  if (r > v) {
    const { otherTask } = events[r] as Extract<LedgerEvent, { type: "verifyRouted" }>;
    routed.set(otherTask, [...(routed.get(otherTask) ?? []), r]);
    return { keptFailure: null };
  }
  return { keptFailure: v };
}

const isRoundSeat = (e: LedgerEvent, task: string): e is Dispatched =>
  e.type === "dispatched" && e.task === task && e.round !== undefined && ROUND_SEATS.includes(e.seat);

function isInline(events: LedgerEvent[], t: LoopTask): boolean {
  return t.inline || events.some((e) => e.type === "inline" && e.task === t.id);
}

function developer(t: LoopTask, events: LedgerEvent[], mode: Dispatch["mode"], round: number): Dispatch {
  return { kind: "dispatch", task: t.id, seat: "developer", mode, round, ...(isInline(events, t) ? { inline: true } : {}) };
}

function fixRounds(inputs: LoopInputs, t: LoopTask, events: LedgerEvent[], view: VerifyView, routedHere: number[], gates: Gate[]): Action[] {
  const task = t.id;
  const triggers: number[] = [];
  const latestReview = lastIndex(events, (e) => e.type === "done" && e.task === task && e.seat === "code-reviewer");
  if (latestReview !== -1 && (events[latestReview] as Extract<LedgerEvent, { type: "done" }>).status === "findings") triggers.push(latestReview);
  const reported = reviewReported(events, task);
  if (view.keptFailure !== null && reported) triggers.push(view.keptFailure);
  if (routedHere.length > 0 && reported) triggers.push(Math.max(...routedHere));
  const reopenedAt = lastIndex(events, (e) => e.type === "reopened" && e.task === task);
  if (reopenedAt !== -1) triggers.push(reopenedAt);

  const answered = (i: number): boolean =>
    anyAfter(events, i, (e) => isRoundSeat(e, task));
  const due = triggers.filter((i) => !answered(i));

  const actions: Action[] = [];
  const capReached = reopenedAt !== -1 && anyAfter(events, reopenedAt, (e) => e.type === "capReached" && e.task === task);
  const stop: Action = { kind: "stop", task, reason: `${task} reached the five-round cap after a reopen — the human decides` };
  if (capReached) actions.push(stop);
  if (due.length === 0) return actions;

  const round = 1 + Math.max(0, ...events.filter((e) => isRoundSeat(e, task)).map((e) => (e as Dispatched).round!));
  if (round <= MAX_ROUNDS) {
    actions.push(developer(t, events, round < FRESH_FROM ? "resume" : "fresh", round));
  } else if (reopenedAt === -1) {
    if (gates.some((g) => g.kind === "breaker")) {
      actions.push({
        kind: "decide",
        task,
        rule: "Breaker",
        reason: `${task} round ${MAX_ROUNDS} left findings or a kept verify failure open — park each with a ruling or rule on the smallest unblocking change`,
        closes: `Note ${task}: decided — <what>`,
      });
    }
  } else if (!capReached) {
    const line = `Note ${task}: cap reached — <failure>`;
    actions.push(stop, { kind: "write", task, line, record: `kf record ${inputs.feature} line -- ${shellQuote(line)}` });
  }
  return actions;
}

function roundSeatsDone(inputs: LoopInputs, t: LoopTask, events: LedgerEvent[]): Action[] {
  const task = t.id;
  const actions: Action[] = [];
  for (const seat of ["test-writer", "automation-writer"] as Seat[]) {
    const d = lastIndex(events, (e) => e.type === "dispatched" && e.task === task && e.seat === seat);
    if (d === -1) continue;
    const dispatch = events[d] as Dispatched;
    if (dispatch.round === undefined) continue;
    const doneAt = events.findIndex((e, i) => i > d && e.type === "done" && e.task === task && e.seat === seat);
    if (doneAt === -1) continue;
    const hashed = anyAfter(events, doneAt, (e) => e.type === "testHashes" && e.task === task);
    if (!hashed) {
      const line = `${task}: test hashes <file>=<sha> …`;
      if (!actions.some((a) => a.kind === "write" && a.line === line)) {
        actions.push({ kind: "write", task, line, record: `kf record ${inputs.feature} line -- ${shellQuote(line)}` });
      }
      continue;
    }
    // A round-R developer dispatched after the round seat, even before its done, answers the resume-commit too;
    // one dispatched before the seat never saw its tests, so the resume-commit is still owed.
    const resumed =
      anyAfter(events, doneAt, (e) => e.type === "dispatched" && e.task === task && e.seat === "developer") ||
      anyAfter(events, d, (e) => e.type === "dispatched" && e.task === task && e.seat === "developer" && e.round === dispatch.round);
    if (!resumed && !actions.some((a) => a.kind === "dispatch")) actions.push(developer(t, events, "resume", dispatch.round));
  }
  return actions;
}

function fixRoundLines(inputs: LoopInputs, task: string, events: LedgerEvent[]): Action[] {
  const actions: Action[] = [];
  const rounds = new Set<number>();
  events.forEach((e, i) => {
    if (e.type !== "dispatched" || e.task !== task || e.seat !== "code-reviewer" || e.round === undefined || e.cascade !== undefined) return;
    if (!anyAfter(events, i, (x) => x.type === "done" && x.task === task && x.seat === "code-reviewer")) return;
    rounds.add(e.round);
  });
  for (const round of rounds) {
    if (events.some((e) => e.type === "fixRound" && e.task === task && e.round === round)) continue;
    const body = "<X> addressed, <Y> open — <one-liners>; commits <a7>,…";
    actions.push({
      kind: "write",
      task,
      line: `${task}: fix round ${round}/${MAX_ROUNDS} (${body})`,
      record: `kf record ${inputs.feature} fix-round ${task} ${round} -- ${shellQuote(body)}`,
    });
  }
  return actions;
}

/** Every task that depends on `task` directly or transitively. */
function dependents(tasks: LoopTask[], task: string): Set<string> {
  const found = new Set<string>();
  const queue = [task];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of tasks) {
      if (t.dependencies.includes(current) && !found.has(t.id)) {
        found.add(t.id);
        queue.push(t.id);
      }
    }
  }
  return found;
}

interface FixCommit {
  sha: string;
  round: number;
  /** Ledger index the commit lands at: positions, not stamps, order lines written in the same second. */
  landing: number;
}

/**
 * The commits H's round developers made (`developer dispatched … round=R`). Per round dispatch, the first source that
 * names any: its commits notes; else the review package of its re-review, else H's report, keeping only commits
 * H did not have before the round (dated after the dispatch, and not after H's next round dispatch).
 * A commit lands at the round developer's `done` or its commits note, whichever is earlier.
 */
function fixCommits(state: LedgerState, inputs: LoopInputs, h: string): FixCommit[] {
  const { events } = state;
  const isRoundDev = (e: LedgerEvent): e is Dispatched =>
    e.type === "dispatched" && e.task === h && e.seat === "developer" && e.round !== undefined && e.round >= 1;
  const found: FixCommit[] = [];
  events.forEach((d, i) => {
    if (!isRoundDev(d) || events.some((e, j) => j < i && isRoundDev(e) && e.round === d.round)) return;
    const next = events.findIndex((e, j) => j > i && isRoundDev(e) && e.round! > d.round!);
    const inRound = (j: number): boolean => j > i && (next === -1 || j < next);
    const doneAt = events.findIndex((e, j) => inRound(j) && e.type === "done" && e.task === h && e.seat === "developer");
    const notes = events.flatMap((e, j) => (e.type === "commits" && e.task === h && inRound(j) ? [j] : []));
    if (notes.length > 0) {
      for (const j of notes) {
        const landing = doneAt !== -1 && doneAt < j ? doneAt : j;
        for (const sha of (events[j] as Extract<LedgerEvent, { type: "commits" }>).shas) found.push({ sha, round: d.round!, landing });
      }
      return;
    }
    const madeInRound = (sha: string): boolean =>
      inputs.gitLog.some((g) => sameSha(g.sha, sha) && g.ts > d.ts && (next === -1 || g.ts <= events[next].ts));
    const packaged = events.flatMap((e, j) => (e.type === "reviewPackage" && e.task === h && inRound(j) ? [{ e, j }] : []));
    const fromPackage = packaged.flatMap(({ e }) => (e as Extract<LedgerEvent, { type: "reviewPackage" }>).shas).filter(madeInRound);
    if (fromPackage.length > 0) {
      const landing = doneAt !== -1 && doneAt < packaged[0].j ? doneAt : packaged[0].j;
      for (const sha of fromPackage) found.push({ sha, round: d.round!, landing });
      return;
    }
    if (doneAt === -1) return;
    for (const sha of (inputs.reportCommits[h] ?? []).filter(madeInRound)) found.push({ sha, round: d.round!, landing: doneAt });
  });
  return found;
}

/**
 * X is open at `landing`: no standing `complete` line there, and none after it — a reopen after the landing
 * does not revive a cascade from before it.
 */
function openAt(events: LedgerEvent[], x: string, landing: number): boolean {
  if (completedTaskIds({ events: events.slice(0, landing) }).has(x)) return false;
  return !anyAfter(events, landing, (e) => (e.type === "complete" || e.type === "implemented") && e.task === x);
}

function cascades(state: LedgerState, inputs: LoopInputs): Action[] {
  const { events } = state;
  const actions: Action[] = [];
  for (const h of inputs.tasks) {
    const owers = dependents(inputs.tasks, h.id);
    const seen = new Set<string>();
    for (const { sha, round, landing } of fixCommits(state, inputs, h.id)) {
      const sha7 = sha.slice(0, 7);
      if (seen.has(sha7)) continue;
      seen.add(sha7);
      for (const x of inputs.tasks) {
        if (!owers.has(x.id) || !openAt(events, x.id, landing)) continue;
        const firstDev = events.findIndex((d) => d.type === "dispatched" && d.task === x.id && d.seat === "developer");
        if (firstDev === -1 || firstDev >= landing) continue;
        const owed = events.some((o) => o.type === "cascadeOwed" && o.task === x.id && sameSha(o.sha, sha7));
        if (!owed) {
          const line = `${x.id}: cascade re-review owed — after ${sha7} of ${h.id}`;
          actions.push({ kind: "write", task: x.id, line, record: `kf record ${inputs.feature} cascade-owed ${x.id} ${sha7} ${h.id}` });
          continue;
        }
        const dispatched = events.some(
          (d) => d.type === "dispatched" && d.task === x.id && d.seat === "code-reviewer" && d.cascade !== undefined && sameSha(d.cascade, sha7),
        );
        if (!dispatched) actions.push({ kind: "dispatch", task: x.id, seat: "code-reviewer", mode: "new", round, cascade: sha7 });
      }
    }
  }
  return actions;
}

export function routingActions(state: LedgerState, inputs: LoopInputs, cap: Cap): Action[] {
  const { events } = state;
  const completed = completedTaskIds(state);
  const open = inputs.tasks.filter((t) => !completed.has(t.id));
  const actions: Action[] = [];
  const routed = new Map<string, number[]>();
  const views = new Map<string, VerifyView>();
  const gates = new Map<string, Gate[]>();

  for (const t of open) {
    const reopened = events.some((e) => e.type === "reopened" && e.task === t.id);
    gates.set(t.id, openGates(events, cap, t.id, reopened));
    actions.push(...seatStatus(events, t.id, gates.get(t.id)!));
    views.set(t.id, verifyRouting(state, inputs, cap, t.id, actions, routed, gates.get(t.id)!));
  }
  for (const t of open) {
    actions.push(...fixRounds(inputs, t, events, views.get(t.id)!, routed.get(t.id) ?? [], gates.get(t.id)!));
    actions.push(...roundSeatsDone(inputs, t, events));
    actions.push(...fixRoundLines(inputs, t.id, events));
  }
  actions.push(...cascades(state, inputs));
  return actions;
}
