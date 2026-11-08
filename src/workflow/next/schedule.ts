import { liveCap } from "./cap.js";
import { completedTaskIds, openSeats, openVerifies, taskCommits } from "./ledger-state.js";
import { shellQuote } from "./record.js";
import { routingActions } from "./routing.js";
import { seatActions } from "./seats.js";
import type { Action, Cap, HeldRerun, InFlight, LedgerEvent, LedgerState, LoopInputs, LoopTask, NextResult, Seat } from "./types.js";

// FR-001, FR-003, FR-007, FR-011, FR-012, FR-013: `schedule()` arbitrates the rule modules into the actions due now,
// as `kf:implement` lays out Resume from the ledger, § 3.5, Order and parallelism, Contention and Controller work
// while a seat runs. Pure: no filesystem, git or clock.

type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Dispatched = Extract<LedgerEvent, { type: "dispatched" }>;
type Done = Extract<LedgerEvent, { type: "done" }>;

const SEAT_ORDER: Seat[] = ["test-writer", "developer", "automation-writer", "code-reviewer"];
const KIND_ORDER: Action["kind"][] = ["stop", "decide", "write", "verify", "dispatch", "complete", "wait", "finished"];
const MAX_ROUNDS = 5;

const sameSha = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);
const taskOf = (e: LedgerEvent): string | undefined => ("task" in e ? e.task : undefined);
const actionTask = (a: Action): string | undefined => ("task" in a ? a.task : undefined);

/** The task's events after its latest `reopened` note. */
function sinceReopen(events: LedgerEvent[], task: string): LedgerEvent[] {
  const own = events.filter((e) => taskOf(e) === task);
  const at = own.map((e) => e.type).lastIndexOf("reopened");
  return own.slice(at + 1);
}

/** A `verify waits` note after the task's latest `verify done`: its next verify runs `--at-head`. */
function atHead(events: LedgerEvent[], task: string): boolean {
  const lastDone = events.map((e) => e.type === "verifyDone" && e.task === task).lastIndexOf(true);
  return events.some((e, i) => i > lastDone && e.type === "verifyWaits" && e.task === task);
}

function verifyCommand(state: LedgerState, inputs: LoopInputs, task: string, head: boolean): string {
  const shas = taskCommits(state, task, inputs.reportCommits[task], inputs.gitLog).join(",");
  return `kf verify ${inputs.feature} --task ${task} --commits ${shas}${head ? " --at-head" : ""}`;
}

function isInlineSeat(events: LedgerEvent[], seat: { task: string; seat: Seat; line: number }): boolean {
  if (seat.seat !== "developer") return false;
  const dispatch = events.find((e): e is Dispatched => e.type === "dispatched" && e.line === seat.line);
  return dispatch?.model === "inline" || events.some((e) => e.type === "inline" && e.task === seat.task && e.line > seat.line);
}

/** FR-013: a sha the task's report names whose commit is dated after the open developer dispatch. */
function driftSha(inputs: LoopInputs, task: string, dispatchTs: number): string | null {
  for (const sha of inputs.reportCommits[task] ?? []) {
    const commit = inputs.gitLog.find((g) => sameSha(g.sha, sha));
    if (commit !== undefined && commit.ts > dispatchTs) return commit.sha.slice(0, 7);
  }
  return null;
}

/** The breaker closed: a `decided` note after the `parked` lines that follow round 5. */
function breakerClosed(own: LedgerEvent[]): boolean {
  const r5 = own.findIndex((e) => e.type === "dispatched" && e.round !== undefined && e.round >= MAX_ROUNDS);
  if (r5 === -1) return false;
  const parkedAt = own.findIndex((e, i) => i > r5 && e.type === "parked");
  return parkedAt !== -1 && own.some((e, i) => i > parkedAt && e.type === "decided");
}

/** The index of the latest `decided — minimal fix past the cap:` note after the task's latest `cap reached` note, or -1. */
function minimalFixDecidedAt(events: LedgerEvent[], task: string): number {
  const capAt = events.map((e) => e.type === "capReached" && e.task === task).lastIndexOf(true);
  if (capAt === -1) return -1;
  const at = events.map((e) => e.type === "decided" && e.task === task && e.what.startsWith("minimal fix past the cap:")).lastIndexOf(true);
  return at > capAt ? at : -1;
}

/**
 * The minimal fix decided at `decidedAt` failed: a code-reviewer `findings` or a kept verify exit 1 of the task follows it.
 * An exit 1 is not kept when a rerun, waits or routed note answers it before the task's next verify start, when that
 * start follows it with no line of the task between (the plain re-run), or, as the latest, while the cap holds its re-run.
 */
function minimalFixFailed(events: LedgerEvent[], cap: Cap, task: string, decidedAt: number): boolean {
  const after = events.slice(decidedAt + 1).filter((e) => taskOf(e) === task);
  if (after.some((e) => e.type === "done" && e.seat === "code-reviewer" && e.status === "findings")) return true;
  const heldNow =
    cap.contention.held.some((h) => h.task === task) ||
    cap.contention.running === task ||
    cap.owed.some((a) => a.kind === "write" && (a.line.includes(`${task} verify`) || a.line.includes(`Note ${task}: verify rerun`)));
  return after.some((e, i) => {
    if (e.type !== "verifyDone" || e.exit !== 1) return false;
    const rest = after.slice(i + 1);
    const nextStart = rest.findIndex((x) => x.type === "verifyStarted");
    if (nextStart === 0) return false;
    const answered = (nextStart === -1 ? rest : rest.slice(0, nextStart)).some(
      (x) => x.type === "verifyRerun" || x.type === "verifyWaits" || x.type === "verifyRouted",
    );
    if (answered) return false;
    return nextStart !== -1 || !heldNow;
  });
}

/** FR-011: the task's `complete` line is due now. */
function completionDue(state: LedgerState, inputs: LoopInputs, t: LoopTask, completed: Set<string>, open: Set<string>): boolean {
  const { events } = state;
  if (open.has(t.id)) return false;
  if (!t.dependencies.every((d) => completed.has(d))) return false;
  const reopened = events.some((e) => e.type === "reopened" && e.task === t.id);
  const own = sinceReopen(events, t.id);
  const parkedAtCap = !reopened && breakerClosed(own);

  const devDone = own.filter((e): e is Done => e.type === "done" && e.seat === "developer").at(-1);
  if (devDone === undefined) return false;
  const doneCounts =
    devDone.status === "DONE" ||
    ((devDone.status === "DONE_WITH_CONCERNS" || devDone.status === "BLOCKED") &&
      own.some((e) => (e.type === "decided" || e.type === "commits") && e.line > devDone.line));
  if (!doneCounts) return false;

  const lastCommit = Math.max(...own.filter((e) => e.type === "commits" || (e.type === "done" && e.seat === "developer")).map((e) => e.line));
  const verify = own.filter((e): e is Extract<LedgerEvent, { type: "verifyDone" }> => e.type === "verifyDone" && e.line > lastCommit).at(-1);
  if (verify === undefined) return false;
  if (verify.exit !== 0) {
    const routed = own.filter((e): e is Extract<LedgerEvent, { type: "verifyRouted" }> => e.type === "verifyRouted" && e.line > verify.line).at(-1);
    let passed = false;
    if (routed !== undefined) {
      const x = routed.otherTask;
      const next = events.find((e) => e.line > routed.line && e.type === "verifyDone" && e.task === x);
      passed =
        (next?.type === "verifyDone" && next.exit === 0) || events.some((e) => e.line > routed.line && e.type === "parked" && e.task === x);
    }
    if (!passed && !(verify.exit === 1 && parkedAtCap)) return false;
  }

  const answeredBy = (e: Done): Dispatched | undefined =>
    own.filter((d): d is Dispatched => d.type === "dispatched" && d.seat === "code-reviewer" && d.line < e.line).at(-1);
  const reviewerDones = own.filter((e): e is Done => e.type === "done" && e.seat === "code-reviewer");
  const reviews = reviewerDones.filter((e) => answeredBy(e)?.cascade === undefined);
  const review = reviews.at(-1);
  if (review === undefined) return false;
  if (review.status !== "clean" && !parkedAtCap) return false;

  for (const owed of own) {
    if (owed.type !== "cascadeOwed") continue;
    const answer = own
      .filter((e): e is Dispatched => e.type === "dispatched" && e.seat === "code-reviewer" && e.cascade !== undefined && sameSha(e.cascade, owed.sha))
      .at(-1);
    if (answer === undefined) return false;
    const answerDone = reviewerDones.find((e) => answeredBy(e) === answer);
    if (answerDone === undefined) return false;
    // A cascade re-review with findings is a fix round: only a later own re-review that ends clean closes it.
    if (answerDone.status !== "clean" && !reviews.some((e) => e.line > answerDone.line && e.status === "clean")) return false;
  }
  return true;
}

export function schedule(state: LedgerState, inputs: LoopInputs, opts: { resume: boolean }): NextResult {
  const { events } = state;
  const f = inputs.feature;
  const known = new Set(inputs.tasks.map((t) => t.id));
  const planIndex = new Map(inputs.tasks.map((t, i) => [t.id, i]));

  const cap = liveCap(state, inputs);
  const n = cap.n;
  const owed: Action[] = [...cap.owed];

  // Unknown tasks: the ledger names a task the plan no longer has.
  const unknown: string[] = [];
  for (const e of events) {
    const task = taskOf(e);
    if (task !== undefined && !known.has(task) && !unknown.includes(task)) unknown.push(task);
  }
  for (const task of unknown) {
    if (events.some((e) => e.type === "decided" && e.task === task)) continue;
    owed.push({
      kind: "decide",
      task,
      rule: "Unknown task",
      reason: `the ledger names ${task}, which the plan no longer has: rule on its lines before any seat for it`,
      closes: `Note ${task}: decided — <what>`,
    });
  }

  // Open seats and verifies: re-dispatched with --resume, in flight without (FR-012, FR-013).
  // A task with a standing complete line is never re-dispatched (Resume from the ledger): its open seats and verifies are closed.
  const completed = completedTaskIds(state);
  const seats = openSeats(state).filter((s) => known.has(s.task) && !completed.has(s.task));
  const verifies = openVerifies(state).filter((v) => known.has(v.task) && !completed.has(v.task));
  const inFlight: InFlight[] = [];
  const resumed: Dispatch[] = [];
  const resumeVerifies: Action[] = [];
  const drift: Action[] = [];
  for (const s of seats) {
    const dispatch = events.find((e): e is Dispatched => e.type === "dispatched" && e.line === s.line)!;
    const sha = s.seat === "developer" ? driftSha(inputs, s.task, dispatch.ts) : null;
    if (!opts.resume) {
      inFlight.push({ task: s.task, seat: s.seat, ...(sha !== null ? { hint: `report names commit ${sha} after the dispatch` } : {}) });
      continue;
    }
    if (sha !== null) {
      drift.push({
        kind: "decide",
        task: s.task,
        rule: "Drift",
        reason: `${s.task}'s report names commit ${sha}, dated after its open developer dispatch: read the report and record the developer's done`,
        closes: `${s.task}: developer done status=DONE`,
      });
      continue;
    }
    const inline = isInlineSeat(events, s);
    resumed.push({
      kind: "dispatch",
      task: s.task,
      seat: s.seat,
      mode: inline ? "resume" : "new",
      ...(dispatch.round !== undefined ? { round: dispatch.round } : {}),
      ...(dispatch.cascade !== undefined ? { cascade: dispatch.cascade } : {}),
      ...(inline ? { inline: true } : {}),
    });
  }
  const developersInFlight = seats.filter((s) => s.seat === "developer" && !isInlineSeat(events, s)).length;

  // A re-run's open verify stays under the hold of FR-007: it is the one re-run, released only under the cap.
  let rerunReleased: Action | null = null;
  const lostRerun = opts.resume && cap.contention.running !== null && verifies.some((v) => v.task === cap.contention.running);
  for (const v of verifies) {
    if (!opts.resume) {
      inFlight.push({ task: v.task, seat: "verify" });
      continue;
    }
    if (v.task === cap.contention.running) continue;
    resumeVerifies.push({ kind: "verify", task: v.task, command: verifyCommand(state, inputs, v.task, atHead(events, v.task)) });
  }
  if (developersInFlight < n) {
    let release: HeldRerun | { task: string; atHead: boolean } | null = null;
    if (lostRerun) release = { task: cap.contention.running!, atHead: atHead(events, cap.contention.running!) };
    else if (cap.contention.running === null && cap.contention.held.length > 0) release = cap.contention.held[0];
    if (release !== null) {
      rerunReleased = { kind: "verify", task: release.task, command: verifyCommand(state, inputs, release.task, release.atHead), rerun: true };
    }
  }

  // Routing, then the developer seats it asks for under the cap (FR-003, FR-007).
  const routing = routingActions(state, inputs, cap);
  const routingOther = routing.filter((a) => !(a.kind === "dispatch" && a.seat === "developer"));
  const routingDevelopers = routing.filter((a): a is Dispatch => a.kind === "dispatch" && a.seat === "developer");
  routingDevelopers.sort((a, b) => planIndex.get(a.task)! - planIndex.get(b.task)!);

  const capped: Action[] = [];
  let free = n - developersInFlight;
  let granted = 0;
  const heldTask = cap.contention.held[0]?.task ?? cap.contention.running;
  for (const d of routingDevelopers) {
    if (d.inline) {
      capped.push(d);
      continue;
    }
    if (cap.contention.blocksDevelopers) {
      capped.push({ kind: "wait", task: d.task, reason: `held re-run ${heldTask}` });
      continue;
    }
    if (free > 0) {
      capped.push(d);
      free--;
      granted++;
      continue;
    }
    const reason = `${n} developers in flight`;
    capped.push({ kind: "wait", task: d.task, reason });
    const own = events.filter((e) => taskOf(e) === d.task);
    const lastDone = own.filter((e) => e.type === "done" && e.seat === "developer").at(-1)?.line ?? -1;
    const latest = own.filter((e): e is Extract<LedgerEvent, { type: "developerWaits" }> => e.type === "developerWaits" && e.line > lastDone).at(-1);
    if (latest?.reason !== reason) {
      capped.push({ kind: "write", task: d.task, line: `${d.task}: developer waits — ${reason}`, record: `kf record ${f} waits ${d.task} -- ${shellQuote(reason)}` });
    }
  }
  const seatOut = seatActions(state, inputs, cap, granted);

  // Completion (FR-011).
  const openTasks = new Set([...openSeats(state).map((s) => s.task), ...openVerifies(state).map((v) => v.task)]);
  const completes: Action[] = inputs.tasks
    .filter((t) => !completed.has(t.id) && completionDue(state, inputs, t, completed, openTasks))
    .map((t) => ({ kind: "complete", task: t.id }));

  let actions: Action[] = [
    ...owed,
    ...drift,
    ...(rerunReleased !== null ? [rerunReleased] : []),
    ...resumeVerifies,
    ...resumed,
    ...routingOther,
    ...capped,
    ...seatOut,
    ...completes,
  ];

  // A task owed a cascade re-review line or dispatch in this call is not complete: recorded together, the owed review is never named.
  const cascadeDue = new Set<string>();
  for (const a of actions) {
    if (a.kind === "dispatch" && a.cascade !== undefined) cascadeDue.add(a.task);
    if (a.kind === "write" && a.task !== undefined && a.line.startsWith(`${a.task}: cascade re-review owed`)) cascadeDue.add(a.task);
  }
  actions = actions.filter((a) => !(a.kind === "complete" && cascadeDue.has(a.task)));

  // A resumed seat is not dispatched a second time by a rule module.
  const resumedKey = new Set(resumed.map((d) => `${d.task} ${d.seat}`));
  actions = actions.filter((a) => !(a.kind === "dispatch" && !resumed.includes(a) && resumedKey.has(`${a.task} ${a.seat}`)));

  // A cap stop is lifted once the session's minimal fix past the cap is decided after the task's latest `cap reached`,
  // and comes back once that fix fails: one minimal fix per task, a second failure is the human's.
  actions = actions.filter((a) => {
    if (a.kind !== "stop" || a.task === undefined || !a.reason.includes("five-round cap after a reopen")) return true;
    const decidedAt = minimalFixDecidedAt(events, a.task);
    return decidedAt === -1 || minimalFixFailed(events, cap, a.task, decidedAt);
  });

  // Holds: a stop holds every dispatch; a task-less decide every dispatch; a task decide its own task's later actions.
  const stops = actions.some((a) => a.kind === "stop");
  const globalDecide = actions.some((a) => a.kind === "decide" && a.task === undefined);
  const decidedTasks = new Set(actions.flatMap((a) => (a.kind === "decide" && a.task !== undefined ? [a.task] : [])));
  actions = actions.filter((a) => {
    if (a.kind === "dispatch" && (stops || globalDecide)) return false;
    const task = actionTask(a);
    if (task === undefined || !decidedTasks.has(task)) return true;
    return !(a.kind === "dispatch" || a.kind === "verify" || a.kind === "write" || a.kind === "complete");
  });

  // One action per identical shape: two modules may owe the same line.
  const seen = new Set<string>();
  actions = actions.filter((a) => {
    const key = JSON.stringify(a);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (inputs.tasks.every((t) => completed.has(t.id)) && actions.length === 0) {
    return { feature: f, n, inFlight, actions: [{ kind: "finished" }] };
  }

  const dispatchGroup = (d: Dispatch): number => {
    if (resumed.includes(d)) return 0;
    if (d.seat === "developer" && (d.mode !== "new" || d.round !== undefined)) return 1;
    return 2;
  };
  const rank = (a: Action, i: number): number[] => {
    const kind = KIND_ORDER.indexOf(a.kind);
    if (a.kind !== "dispatch") return [kind, 0, 0, 0, i];
    const group = dispatchGroup(a);
    if (group === 0) return [kind, 0, 0, 0, i];
    return [kind, group, SEAT_ORDER.indexOf(a.seat), planIndex.get(a.task) ?? Infinity, i];
  };
  const ranked = actions.map((a, i) => ({ a, r: rank(a, i) }));
  ranked.sort((x, y) => {
    for (let k = 0; k < x.r.length; k++) if (x.r[k] !== y.r[k]) return x.r[k] - y.r[k];
    return 0;
  });
  return { feature: f, n, inFlight, actions: ranked.map((x) => x.a) };
}
