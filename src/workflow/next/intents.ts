import { developerGated } from "./arbiter.js";
import { uiSpecs, unnamedReportShas } from "./fold.js";
import { JUDGEMENTS, closesText, commitsCloseGate } from "./judgements.js";
import { sameSha } from "./ledger-state.js";
import { shellQuote } from "./record.js";
import type {
  Action,
  ImplementerStep,
  Intent,
  IntentOrigin,
  Judgement,
  JudgementEntry,
  JudgementKind,
  LoopTask,
  MachineEventType,
  NextOptions,
  Seat,
  SeatSlot,
  TaskPhase,
  TaskPhaseKind,
  TaskState,
  VerifyDisposition,
  VerifyKind,
  VerifyState,
  World,
} from "./types.js";

// Intents: what each phase owes, before the arbiter. Total over the phases: every phase other than complete
// yields at least one intent.

const MAX_ROUNDS = 5;
const FRESH_FROM = 4;
const SEATS: readonly Seat[] = ["test-writer", "developer", "automation-writer", "code-reviewer"];

/** The at-cap judgements: printed from the at-cap phase alone, so a lifted stop or Breaker is never printed. */
const CAP_JUDGEMENTS: readonly JudgementKind[] = [
  "breaker",
  "breakerFixSpent",
  "capStop",
  "capStopFixSpent",
  "cascadeAtCapBreaker",
  "cascadeAtCapStop",
];

type ActAction = Extract<Intent, { kind: "act" }>["action"];
type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Write = Extract<Action, { kind: "write" }>;
type PhaseOf<K extends TaskPhaseKind> = Extract<TaskPhase, { kind: K }>;
type Cycle = PhaseOf<"cycle">;

const entryOf = (j: Judgement): JudgementEntry<JudgementKind> => JUDGEMENTS[j.kind] as unknown as JudgementEntry<JudgementKind>;

const act = (task: string | undefined, action: ActAction, closes: MachineEventType[], origin: IntentOrigin = "progress"): Intent => ({
  kind: "act",
  ...(task !== undefined ? { task } : {}),
  origin,
  closes,
  action,
});

const lineWrite = (feature: string, line: string, task: string): Write => ({
  kind: "write",
  task,
  line,
  record: `kf record ${feature} line -- ${shellQuote(line)}`,
});

/**
 * The `fix round R/5` line of the round that ended. Printed beside the action that ends round R — the next round's
 * developer (also while a contention re-run or an overlap hold keeps it back; only a full pool suppresses the line),
 * or the complete (at the cap, named in the decide or stop instead) — until the fold records it (`fixRoundWritten`).
 */
const FIX_ROUND_BODY = "<X> addressed, <Y> open — <one-liners>; commits <a7>,…";

/** The `fix round R/5` write of the round that ended, unless its line is already written. */
const fixRoundOwed = (t: TaskState, world: World, round: number): Intent[] => ((t.fixRoundWritten ?? 0) >= round ? [] : [fixRoundWrite(t, world, round)]);

function fixRoundWrite(t: TaskState, world: World, round: number): Intent {
  const write: Write = {
    kind: "write",
    task: t.id,
    line: `${t.id}: fix round ${round}/${MAX_ROUNDS} (${FIX_ROUND_BODY})`,
    record: `kf record ${world.inputs.feature} fix-round ${t.id} ${round} -- ${shellQuote(FIX_ROUND_BODY)}`,
  };
  return act(t.id, write, ["fixRound"]);
}

function planOf(world: World, task: string): LoopTask {
  const plan = world.inputs.tasks.find((p) => p.id === task);
  if (plan === undefined) throw new Error(`intents: ${task} is not a task of the plan`);
  return plan;
}

const inlineOf = (t: TaskState, world: World): boolean => t.inline || planOf(world, t.id).inline;

function dispatch(t: TaskState, world: World, seat: Seat, mode: Dispatch["mode"], round?: number, cascade?: string): Dispatch {
  return {
    kind: "dispatch",
    task: t.id,
    seat,
    ...(round !== undefined && round > 0 ? { round } : {}),
    ...(cascade !== undefined ? { cascade } : {}),
    mode,
    ...(seat === "developer" && inlineOf(t, world) ? { inline: true } : {}),
  };
}

const roundMode = (round: number): Dispatch["mode"] => (round < FRESH_FROM ? "resume" : "fresh");

const hashesWrite = (t: TaskState, world: World): Intent =>
  act(t.id, lineWrite(world.inputs.feature, `${t.id}: test hashes <file>=<sha> …`, t.id), ["testHashes"]);

function verifyCommand(t: TaskState, world: World, atHead: boolean): string {
  return `kf verify ${world.inputs.feature} --task ${t.id} --commits ${t.commits.join(",")}${atHead ? " --at-head" : ""}`;
}

// ---------------------------------------------------------------------------
// Judgements: every open one is printed (one decided note closes the queue's head only, so none may stay hidden).
// ---------------------------------------------------------------------------

const statusText = (status: Extract<Judgement, { kind: "seatStatus" }>["status"]): string =>
  typeof status === "string" ? status : `the unknown status "${status.unknown}"`;

const REASONS = {
  conflictScan: () => "no `Scan:` line yet: scan the plan's Files for conflicts before any seat (one planned task: Scan: clean)",
  seatStatus: (j) => `${j.task}'s ${j.seat} ended ${statusText(j.status)}`,
  commitMissing: (j) => `${j.task}'s developer is done but no commit is recorded since its dispatch at ledger line ${j.dispatchLine}`,
  verifyExit2: (j) =>
    `${j.task} verify exit 2: a changed file is outside the task's Files — replan, have the human re-approve, then record Note ${j.task}: decided — <what>`,
  verifyExit3: (j) =>
    `${j.task} verify exit 3: bad input, nothing ran — fix the call and re-run it, or report a kf error to the human; never a fix round` +
    (j.droppedShas.length > 0 ? `; the git log does not have ${j.droppedShas.join(",")}` : ""),
  verifyExit: (j) => `${j.task} verify exited ${j.exit}, outside 0–3 — read its log, then re-run the verify or rule on it`,
  verifyRouted: (j) =>
    `${j.task}'s verify failure was routed to ${j.otherTask}, which is complete, unknown or not open — rule on it; the failure stays ${j.task}'s own`,
  verifyWaitsUnreleasable: (j) =>
    `${j.task}'s verify waits for ${j.otherTask}, which can never release it (${j.why}) — a plan defect: record Note ${j.task}: decided — <what>`,
  breaker: (j) =>
    `${j.task} round ${MAX_ROUNDS} left findings or a kept verify failure open — park each with a ruling or rule on the smallest unblocking change`,
  breakerFixSpent: (j) => `${j.task}'s minimal fix past the cap is spent and left the task open — park each open finding with a ruling`,
  capStop: (j) => `${j.task} reached the five-round cap after a reopen — the human decides`,
  capStopFixSpent: (j) => `${j.task} reached the five-round cap after a reopen and its minimal fix is spent — the human decides`,
  cascadeAtCapBreaker: (j) =>
    `${j.task}'s cascade re-review after ${j.sha7} returned findings with no rounds left — park each with a ruling`,
  cascadeAtCapStop: (j) =>
    `${j.task}'s cascade re-review after ${j.sha7} returned findings with no rounds left after a reopen — the human decides`,
  invalidCeiling: (j) => j.error,
  drift: (j) =>
    `${j.task}'s report names commit ${j.sha}, dated after its open developer dispatch: read the report and record the developer's done`,
  unknownTask: (j) => `the ledger names ${j.task}, which the plan no longer has: rule on its lines before any seat for it`,
} satisfies { [K in JudgementKind]: (j: Judgement<K>) => string };

/** The events that close each judgement: its close predicate's event types. */
const CLOSES = {
  conflictScan: () => ["scan"],
  seatStatus: (j) => (commitsCloseGate(j) ? ["dispatched", "decided", "ruling", "commits"] : ["dispatched", "decided", "ruling"]),
  commitMissing: () => ["commits", "dispatched"],
  verifyExit2: () => ["decided", "verifyStarted"],
  verifyExit3: () => ["decided", "verifyStarted"],
  verifyExit: () => ["decided", "verifyStarted"],
  verifyRouted: () => ["decided"],
  verifyWaitsUnreleasable: () => ["decided"],
  breaker: () => ["parked", "decided"],
  breakerFixSpent: () => ["parked"],
  capStop: () => ["decided", "complete"],
  capStopFixSpent: () => ["complete"],
  cascadeAtCapBreaker: () => ["parked"],
  cascadeAtCapStop: () => ["complete"],
  invalidCeiling: () => ["other"],
  drift: () => ["done"],
  unknownTask: () => ["decided"],
} satisfies { [K in JudgementKind]: (j: Judgement<K>) => MachineEventType[] };

function judge(j: Judgement, t: TaskState | null): Intent {
  const entry = entryOf(j);
  const reason = (REASONS[j.kind] as (j: Judgement) => string)(j);
  const closes = (CLOSES[j.kind] as (j: Judgement) => MachineEventType[])(j);
  // A repeated decide or stop carries no once-only write: at the cap the round's last fix round line is named in the
  // decide's closes or the stop's reason, and written with the line that closes it (ruled).
  const lastRound = t !== null && CAP_JUDGEMENTS.includes(j.kind) && t.roundsUsed >= MAX_ROUNDS && (t.fixRoundWritten ?? 0) < MAX_ROUNDS;
  const fiveFive = `${j.task}: fix round ${MAX_ROUNDS}/${MAX_ROUNDS} (${FIX_ROUND_BODY})`;
  const text = closesText(entry, j, t) + (lastRound ? `, each with ${fiveFive}` : "");
  const stopReason = reason + (lastRound ? `; write ${fiveFive} with the line that closes this stop` : "");
  const action: Extract<Intent, { kind: "judge" }>["action"] =
    entry.form === "stop"
      ? { kind: "stop", ...(j.task !== undefined ? { task: j.task } : {}), reason: stopReason }
      : { kind: "decide", ...(j.task !== undefined ? { task: j.task } : {}), rule: entry.rule, reason, closes: text };
  return { kind: "judge", ...(j.task !== undefined ? { task: j.task } : {}), origin: "progress", closes, judgement: j.kind, action };
}

/** The open judgement of `kind` on `t`, or `fallback` when the fold recorded none (its opening line unknown). */
function openOr<K extends JudgementKind>(t: TaskState, kind: K, matches: (j: Judgement<K>) => boolean, fallback: Judgement<K>): Judgement<K> {
  const found = t.judgements.find((j): j is Judgement<K> => j.kind === kind && matches(j as Judgement<K>));
  return found ?? fallback;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/** The task's seat slots; in the tests phase the first-pass test-writer is the phase's writer. */
function slotsOf(t: TaskState): Record<Seat, SeatSlot> {
  return t.phase.kind === "tests" ? { ...t.seats, "test-writer": t.phase.writer } : t.seats;
}

/** FR-013: the first sha the task's report names whose commit is dated after the open developer dispatch. */
function driftSha(t: TaskState, world: World): string | null {
  const slot = t.seats.developer;
  if (slot.kind !== "running" || slot.ts === undefined) return null;
  for (const sha of world.inputs.reportCommits[t.id] ?? []) {
    const commit = world.inputs.gitLog.find((g) => g.sha.startsWith(sha) || sha.startsWith(g.sha));
    if (commit !== undefined && commit.ts > slot.ts) return commit.sha.slice(0, 7);
  }
  return null;
}

function seatIntents(t: TaskState, world: World): Intent[] {
  const slots = slotsOf(t);
  const implementerOwed = t.phase.kind === "cycle" && t.phase.implementer.kind === "owed";
  const intents: Intent[] = [];
  for (const seat of SEATS) {
    const slot = slots[seat];
    switch (slot.kind) {
      case "running": {
        const drift = seat === "developer" ? driftSha(t, world) : null;
        // Under `--resume` a developer whose report names a newer commit is not re-issued: Drift asks for its done.
        if (drift !== null && slot.origin === "resume") {
          intents.push(judge({ kind: "drift", task: t.id, openedAt: null, sha: drift }, t));
        } else if (drift !== null) {
          const entry = { task: t.id, seat, hint: `report names commit ${drift} after the dispatch` };
          intents.push({ kind: "inFlight", task: t.id, origin: "progress", closes: ["done"], entry });
        } else if (slot.origin === "resume") {
          // Under `--resume` the fold marks a lost seat `resume`: it is re-issued, never listed as in flight.
          intents.push(act(t.id, dispatch(t, world, seat, "resume", slot.round, slot.cascade), ["dispatched", "done"], "resume"));
        } else {
          intents.push({ kind: "inFlight", task: t.id, origin: "progress", closes: ["done"], entry: { task: t.id, seat } });
        }
        break;
      }
      case "gated": {
        const fallback: Judgement<"seatStatus"> = { kind: "seatStatus", task: t.id, openedAt: slot.doneLine, seat, status: slot.status, doneLine: slot.doneLine };
        if (!t.judgements.some((j) => j.kind === "seatStatus" && j.seat === seat)) intents.push(judge(fallback, t));
        break;
      }
      case "redispatchOwed":
        // A developer owed by its implementer step is dispatched once, from that step.
        if (seat === "developer" && implementerOwed) break;
        intents.push(act(t.id, dispatch(t, world, seat, slot.mode, slot.round, slot.cascade), ["dispatched"]));
        break;
      case "idle":
      case "reported":
        break;
    }
  }
  return intents;
}

const seatBusy = (slot: SeatSlot): boolean => slot.kind === "running" || slot.kind === "gated" || slot.kind === "redispatchOwed";

// ---------------------------------------------------------------------------
// Verify region
// ---------------------------------------------------------------------------

const DISPOSITIONS = {
  plainRerunOwed: (t, world) => [act(t.id, { kind: "verify", task: t.id, command: verifyCommand(t, world, false), rerun: true }, ["verifyStarted"])],
  // The held re-run is released by the arbiter from the cap's contention; its rerun note is a cap write.
  contentionHeld: () => [],
  kept: () => [],
  waits: (t, _world, d) => [
    {
      kind: "wait",
      task: t.id,
      origin: "progress",
      closes: ["watchReleased"],
      action: { kind: "wait", task: t.id, reason: `verify waits for ${d.otherTask}` },
      blockedBy: { kind: "task", task: d.otherTask },
    },
  ],
  waitsUnreleasable: (t, _world, d) => [
    judge(openOr(t, "verifyWaitsUnreleasable", () => true, { kind: "verifyWaitsUnreleasable", task: t.id, openedAt: null, otherTask: d.otherTask, why: d.why }), t),
  ],
  routedOut: (t, _world, d) => [
    {
      kind: "wait",
      task: t.id,
      origin: "progress",
      closes: ["routeAnswered"],
      action: { kind: "wait", task: t.id, reason: `verify routed to ${d.otherTask}` },
      blockedBy: { kind: "task", task: d.otherTask },
    },
  ],
  routeRejected: (t, _world, d) => [judge(openOr(t, "verifyRouted", () => true, { kind: "verifyRouted", task: t.id, openedAt: null, otherTask: d.otherTask }), t)],
  parkedAtCap: () => [],
} satisfies { [K in VerifyDisposition["kind"]]: (t: TaskState, world: World, d: Extract<VerifyDisposition, { kind: K }>) => Intent[] };

const VERIFY = {
  notDue: () => [],
  owed: (t, world, v) => [act(t.id, { kind: "verify", task: t.id, command: verifyCommand(t, world, v.atHead) }, ["verifyStarted"])],
  running: (t, world, v) =>
    v.origin === "resume"
      ? [act(t.id, { kind: "verify", task: t.id, command: verifyCommand(t, world, v.atHead === true) }, ["verifyStarted"], "resume")]
      : [{ kind: "inFlight", task: t.id, origin: "progress", closes: ["verifyDone"], entry: { task: t.id, seat: "verify" } }],
  passed: () => [],
  failed: (t, world, v) => (DISPOSITIONS[v.disposition.kind] as (t: TaskState, w: World, d: VerifyDisposition) => Intent[])(t, world, v.disposition),
  exit2Stop: (t) => [judge(openOr(t, "verifyExit2", () => true, { kind: "verifyExit2", task: t.id, openedAt: null }), t)],
  exit3Decide: (t, _world, v) => [
    judge(openOr(t, "verifyExit3", () => true, { kind: "verifyExit3", task: t.id, openedAt: null, droppedShas: v.droppedShas }), t),
  ],
  unknownExit: (t, _world, v) => [judge(openOr(t, "verifyExit", () => true, { kind: "verifyExit", task: t.id, openedAt: null, exit: v.raw }), t)],
  passedByRoute: () => [],
} satisfies { [K in VerifyKind]: (t: TaskState, world: World, v: Extract<VerifyState, { kind: K }>) => Intent[] };

/** The verify judgements the fold queued are printed with the queue; only a state with none queued gets one here. */
function verifyIntents(t: TaskState, world: World): Intent[] {
  const intents = (VERIFY[t.verify.kind] as (t: TaskState, w: World, v: VerifyState) => Intent[])(t, world, t.verify);
  return intents.filter((i) => i.kind !== "judge" || !t.judgements.some((j) => j.kind === i.judgement));
}

// ---------------------------------------------------------------------------
// Review region
// ---------------------------------------------------------------------------

function reviewIntents(t: TaskState, world: World): Intent[] {
  const { lane, demands } = t.review;
  const intents: Intent[] = [];
  for (const d of demands) {
    // A legacy cascade demand can name no dependency (`of` empty): it has no owed line to write.
    if (d.kind === "cascade" && d.phase === "lineOwed" && d.of !== "") {
      const line = `${t.id}: cascade re-review owed — after ${d.sha7} of ${d.of}`;
      const record = `kf record ${world.inputs.feature} cascade-owed ${t.id} ${d.sha7} ${d.of}`;
      intents.push(act(t.id, { kind: "write", task: t.id, line, record }, ["cascadeOwed"]));
    }
  }
  const held = lane.kind === "busy" ? lane.obligation : null;
  const heldOwn = held?.kind === "own" ? demands.find((d) => d.kind === "own") : undefined;
  const queued = demands.filter(
    (d) =>
      (d.kind === "own" && d !== heldOwn) ||
      (d.kind === "cascade" && (d.phase === "owed" || (d.phase === "lineOwed" && d.of === ""))),
  );
  if (queued.length === 0) return intents;
  if (lane.kind === "busy") {
    intents.push({
      kind: "wait",
      task: t.id,
      origin: "progress",
      closes: ["done"],
      action: { kind: "wait", task: t.id, reason: `code-reviewer of ${t.id} in flight` },
      blockedBy: { kind: "reviewer", task: t.id },
    });
    return intents;
  }
  // A reviewer re-dispatch owed by a closed gate takes the lane for its obligation.
  if (t.seats["code-reviewer"].kind === "redispatchOwed") return intents;
  const head = queued[0];
  const d = head.kind === "own" ? dispatch(t, world, "code-reviewer", "new", head.round) : dispatch(t, world, "code-reviewer", "new", head.round, head.sha7);
  intents.push(act(t.id, d, ["dispatched"]));
  return intents;
}

/**
 * The next fix round: the cycle's check pass settled (the own review reported, the verify passed or kept its failure)
 * with a fix trigger open — own findings, a kept failure, an unanswered routed-in failure or cascade findings.
 */
function nextRoundIntents(t: TaskState, world: World, c: Cycle): Intent[] {
  if (c.cycle === "minimalFix" || c.implementer.kind !== "committed" || c.round >= MAX_ROUNDS) return [];
  const { lane, demands, ownVerdict } = t.review;
  if (lane.kind !== "free" || ownVerdict === "none" || demands.some((d) => d.kind === "own")) return [];
  if (SEATS.some((s) => seatBusy(t.seats[s]))) return [];
  const v = t.verify;
  const kept = v.kind === "failed" && v.disposition.kind === "kept";
  const settled = kept || v.kind === "passed" || v.kind === "passedByRoute";
  // Own findings or a routed-in failure owe the round at once; a running verify of the old tree goes stale on its commit.
  const now = ownVerdict === "findings" || t.routedIn.some((r) => !r.answered);
  const trigger = now || (settled && (kept || demands.some((d) => d.kind === "cascade" && d.phase === "findings")));
  if (!trigger) return [];
  const round = c.round + 1;
  const next = act(t.id, dispatch(t, world, "developer", roundMode(round), round), ["dispatched"]);
  // While the pool is full the cap holds the next developer, and the line waits with it.
  if (c.round === 0 || world.pool.length >= world.cap.n) return [next];
  return [...fixRoundOwed(t, world, c.round), next];
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/** The dependency whose missing commit holds the task's developer, as the arbiter's release reads it. */
function dependencyWithoutCommit(t: TaskState, world: World): string | undefined {
  return planOf(world, t.id).dependencies.find((id) => {
    const s = world.tasks.get(id);
    return s === undefined || (s.phase.kind !== "complete" && (s.commits.length === 0 || developerGated(s)));
  });
}

/** A task whose test-writer reported: its developer waits on a dependency's commit, else on its test hashes. */
function releaseWait(t: TaskState, world: World): Intent {
  const dep = dependencyWithoutCommit(t, world);
  const reason = dep !== undefined ? `dependency ${dep} has no commit` : "no test hashes yet";
  return {
    kind: "wait",
    task: t.id,
    origin: "progress",
    closes: dep !== undefined ? ["commits"] : ["testHashes"],
    action: { kind: "wait", task: t.id, reason },
    blockedBy: { kind: "task", task: dep ?? t.id },
  };
}

/** The verify and own review of the latest developer done have not both started since it. */
function checkPassOpen(t: TaskState, since: number): boolean {
  const v = t.verify;
  const verifyStarted = (v.kind === "running" || v.kind === "passed" || v.kind === "failed") && v.line > since;
  const lane = t.review.lane;
  const slot = t.seats["code-reviewer"];
  const reviewerDispatched =
    (lane.kind === "busy" && lane.obligation.kind === "own" && lane.line > since) ||
    (slot.kind === "reported" && slot.answers > since && t.review.demands.every((d) => d.kind !== "own"));
  return !(verifyStarted && reviewerDispatched);
}

/**
 * `T: review package <shas>`: owed once the developer is done and committed, until the package line of that done. A
 * fix round's package is the commits since the head the previous review saw (FIX_BASE, 543cd17 SKILL.md:127), or the
 * round's own commits when no package was written before; the verify still runs on every commit.
 */
function packageWrite(t: TaskState, world: World): Intent[] {
  const since = t.devDoneAt;
  if (since === undefined || (t.packagedAt !== undefined && t.packagedAt > since) || t.commits.length === 0) return [];
  if (!checkPassOpen(t, since)) return [];
  const p = t.phase;
  const base = t.reviewedCommits;
  const fresh =
    p.kind !== "cycle" || p.cycle !== "round"
      ? []
      : base !== undefined
        ? t.commits.filter((sha) => !base.some((r) => sameSha(r, sha)))
        : t.commits.filter((sha) => p.commits.some((c) => sameSha(c, sha)));
  const shas = fresh.length > 0 ? fresh : t.commits;
  return [act(t.id, lineWrite(world.inputs.feature, `${t.id}: review package ${shas.join(",")}`, t.id), ["reviewPackage"])];
}

/**
 * The check pass waits for a developer resumed to commit the automation-writer's or a round seat's files: until that
 * developer is done, no verify or own review is named for the tree it is about to change. A UI task under Level full
 * also waits while its first cycle's automation-writer is running or gated, as its specs are still to be resumed.
 */
function resumeCommitPending(t: TaskState, world: World): boolean {
  const p = t.phase;
  if (p.kind !== "cycle") return false;
  const step = p.implementer;
  if (step.kind === "specsOwed" || step.kind === "specsRunning" || step.kind === "resumeCommitOwed") return true;
  // The resume-commit developer's commit is not on the task's list until its commits note: a check now would miss it.
  if (step.kind === "commitNoteOwed" && step.resume === true) return true;
  if (step.kind === "running" && step.dispatchLine > p.openedAt) return true;
  const writer = t.seats["automation-writer"].kind;
  return p.cycle === "first" && uiSpecs(t, world) && (writer === "running" || writer === "gated");
}

const checkPassIntent = (i: Intent): boolean =>
  i.kind === "act" &&
  i.origin === "progress" &&
  (i.action.kind === "verify" ||
    (i.action.kind === "write" && i.closes.includes("reviewPackage")) ||
    (i.action.kind === "dispatch" && i.action.seat === "code-reviewer" && i.action.cascade === undefined));

function commitsWrite(t: TaskState, world: World, shas: string[]): Intent {
  const list = shas.join(",");
  const write: Write = { kind: "write", task: t.id, line: `Note ${t.id}: commits ${list}`, record: `kf record ${world.inputs.feature} commits ${t.id} ${list}` };
  return act(t.id, write, ["commits"]);
}

/** Commits the task's report names on the branch that no ledger line records: an abandoned fix developer's, say. */
const unrecorded = (t: TaskState, world: World): string[] => unnamedReportShas(t, world, Infinity);

const IMPLEMENTER = {
  owed: (t, world, s) => {
    // A round seat sent instead of the developer goes first: owed again after a decision, or running now.
    if (t.writerOwed !== undefined) return [act(t.id, dispatch(t, world, t.writerOwed.seat, "new", t.writerOwed.round), ["dispatched"])];
    const roundSeat = (["test-writer", "automation-writer"] as const).some((seat) => {
      const slot = t.seats[seat];
      return slot.kind === "running" && slot.round !== undefined && slot.round === s.round;
    });
    return roundSeat ? [] : [act(t.id, dispatch(t, world, "developer", s.mode, s.round), ["dispatched"])];
  },
  running: (t) =>
    t.seats.developer.kind === "idle"
      ? [{ kind: "inFlight", task: t.id, origin: "progress", closes: ["done"], entry: { task: t.id, seat: "developer" } }]
      : [],
  roundSeatRunning: (t, _world, s) =>
    t.seats[s.seat].kind === "idle"
      ? [{ kind: "inFlight", task: t.id, origin: "progress", closes: ["done"], entry: { task: t.id, seat: s.seat } }]
      : [],
  roundHashOwed: (t, world) => [hashesWrite(t, world)],
  resumeCommitOwed: (t, world, s) => [act(t.id, dispatch(t, world, "developer", "resume", s.round), ["dispatched"])],
  specsOwed: (t, world) => [act(t.id, dispatch(t, world, "automation-writer", "new"), ["dispatched"])],
  specsRunning: (t) =>
    t.seats["automation-writer"].kind === "idle"
      ? [{ kind: "inFlight", task: t.id, origin: "progress", closes: ["done"], entry: { task: t.id, seat: "automation-writer" } }]
      : [],
  commitNoteOwed: (t, world, s) => [commitsWrite(t, world, s.shas)],
  commitMissing: (t, _world, s) =>
    t.judgements.some((j) => j.kind === "commitMissing")
      ? []
      : [judge({ kind: "commitMissing", task: t.id, openedAt: null, dispatchLine: s.dispatchLine }, t)],
  committed: (t, world) => [
    ...packageWrite(t, world),
    // A committed tree the verify region never saw is a tree no verify has run on.
    ...(t.verify.kind === "notDue" ? [act(t.id, { kind: "verify", task: t.id, command: verifyCommand(t, world, false) }, ["verifyStarted"])] : []),
  ],
} satisfies { [K in ImplementerStep["kind"]]: (t: TaskState, world: World, s: Extract<ImplementerStep, { kind: K }>) => Intent[] };

const PHASES = {
  pending: (t, world) => {
    const plan = planOf(world, t.id);
    if (plan.testTypes.includes("Unit") || plan.testTypes.includes("Integration")) {
      return [act(t.id, dispatch(t, world, "test-writer", "new"), ["dispatched"])];
    }
    return [act(t.id, lineWrite(world.inputs.feature, `${t.id}: no test-writer — <why>`, t.id), ["noTestWriter"])];
  },
  tests: (t, world, p) => {
    if (p.writer.kind === "reported" || p.hashOwed) return [hashesWrite(t, world), releaseWait(t, world)];
    if (p.writer.kind === "gated") return [releaseWait(t, world)];
    if (p.writer.kind === "idle") return [act(t.id, dispatch(t, world, "test-writer", "new"), ["dispatched"])];
    return [];
  },
  ready: (t, world) => [act(t.id, dispatch(t, world, "developer", "new"), ["dispatched"])],
  cycle: (t, world, c) => {
    const step = c.implementer;
    const own = (IMPLEMENTER[step.kind] as (t: TaskState, w: World, s: ImplementerStep) => Intent[])(t, world, step);
    const hashes = t.roundHashOwed && step.kind !== "roundHashOwed" ? [hashesWrite(t, world)] : [];
    return [...hashes, ...own, ...nextRoundIntents(t, world, c)];
  },
  atCap: (t, world, p) => {
    const cap = p.cap;
    switch (cap.kind) {
      case "breaker":
        return cap.fixSpent
          ? [judge(openOr(t, "breakerFixSpent", () => true, { kind: "breakerFixSpent", task: t.id, openedAt: null }), t)]
          : [judge(openOr(t, "breaker", () => true, { kind: "breaker", task: t.id, openedAt: null }), t)];
      case "capStop": {
        const stop = cap.fixSpent
          ? judge(openOr(t, "capStopFixSpent", () => true, { kind: "capStopFixSpent", task: t.id, openedAt: null }), t)
          : judge(openOr(t, "capStop", () => true, { kind: "capStop", task: t.id, openedAt: null }), t);
        if (cap.noted) return [stop];
        return [stop, act(t.id, lineWrite(world.inputs.feature, `Note ${t.id}: cap reached — <failure>`, t.id), ["capReached"])];
      }
      case "minimalFixOwed":
        return [act(t.id, dispatch(t, world, "developer", "fresh"), ["dispatched"])];
      case "cascadeAtCap":
        return cap.reopened
          ? [judge(openOr(t, "cascadeAtCapStop", () => true, { kind: "cascadeAtCapStop", task: t.id, openedAt: null, sha7: cap.sha7 }), t)]
          : [judge(openOr(t, "cascadeAtCapBreaker", () => true, { kind: "cascadeAtCapBreaker", task: t.id, openedAt: null, sha7: cap.sha7 }), t)];
      case "parkedClosed": {
        // A commit left on the branch is recorded first, so the verify the completion needs runs on it (FR-023).
        const shas = unrecorded(t, world);
        if (shas.length > 0) return [commitsWrite(t, world, shas)];
        return t.verify.kind === "notDue"
          ? [act(t.id, { kind: "verify", task: t.id, command: verifyCommand(t, world, false) }, ["verifyStarted"])]
          : [];
      }
    }
  },
  complete: () => [],
} satisfies { [K in TaskPhaseKind]: (t: TaskState, world: World, p: PhaseOf<K>) => Intent[] };

/** The intents of one task. */
export function intentsFor(t: TaskState, world: World): Intent[] {
  if (t.phase.kind === "complete") return [];
  if (completable(t, world)) {
    const complete = act(t.id, { kind: "complete", task: t.id }, ["complete"]);
    const p = t.phase;
    return p.kind === "cycle" && p.cycle === "round" && p.round >= 1 ? [...fixRoundOwed(t, world, p.round), complete] : [complete];
  }
  const queued = t.judgements.filter((j) => !CAP_JUDGEMENTS.includes(j.kind)).map((j) => judge(j, t));
  const phase = (PHASES[t.phase.kind] as (t: TaskState, w: World, p: TaskPhase) => Intent[])(t, world, t.phase);
  const checks = [...verifyIntents(t, world), ...reviewIntents(t, world)];
  // The committed step names the package and a first verify itself, so the hold covers the phase's intents too.
  const pending = resumeCommitPending(t, world);
  const hold = (intents: Intent[]): Intent[] => (pending ? intents.filter((i) => !checkPassIntent(i)) : intents);
  return [...hold(phase), ...seatIntents(t, world), ...hold(checks), ...queued, ...dependencyWait(t, world)];
}

/** A cap write is closed by the line it writes: a cap ruling, a no-step-up note, a rerun note. */
function capWriteCloses(line: string): MachineEventType[] {
  if (line.startsWith("Ruling: developer cap")) return ["capRuling"];
  if (line.startsWith("Note wave ")) return ["noStepUp"];
  if (/^Note \S+: verify rerun — /.test(line)) return ["verifyRerun"];
  return ["other"];
}

/** The item intents: Conflict scan, the cap's owed writes and decides, Invalid ceiling, Unknown task, Drift (resume only). */
export function itemIntents(world: World, opts: NextOptions): Intent[] {
  // Drift is a task's: its open developer seat's intents print it (seatIntents).
  void opts;
  const intents: Intent[] = [];
  if (world.scan === "none") intents.push(judge({ kind: "conflictScan", openedAt: null }, null));
  let ceilingDecide = false;
  for (const a of world.cap.owed) {
    if (a.kind === "write") {
      intents.push(act(a.task, a, capWriteCloses(a.line)));
    } else if (a.kind === "decide" && a.rule === JUDGEMENTS.invalidCeiling.rule) {
      intents.push(judge({ kind: "invalidCeiling", openedAt: null, error: a.reason }, null));
      ceilingDecide = true;
    } else {
      throw new Error(`intents: the cap owes a ${a.kind} action no item intent maps`);
    }
  }
  if (world.ceiling === "invalidUndecided" && !ceilingDecide) {
    const { error, source } = world.inputs.ceiling;
    intents.push(judge({ kind: "invalidCeiling", openedAt: null, error: error ?? `harness.developers.max (${source})` }, null));
  }
  for (const [task, { decided }] of world.unknown) {
    if (!decided) intents.push(judge({ kind: "unknownTask", task, openedAt: null }, null));
  }
  return intents;
}

/** The verify a completion accepts: a pass after the cycle's latest commit, a pass by route, or a waived failure once parked. */
function verifySettled(t: TaskState): boolean {
  const v = t.verify;
  const parked = t.phase.kind === "atCap";
  if (v.kind === "passedByRoute") return true;
  if (v.kind === "passed") {
    const since = t.phase.kind === "cycle" ? t.phase.sinceCommit : null;
    return since === null || v.line > since;
  }
  return parked && v.kind === "failed" && (v.disposition.kind === "kept" || v.disposition.kind === "parkedAtCap");
}

/** ReadyToComplete: the one predicate `complete <task>` is printed on. */
export function completable(t: TaskState, world: World): boolean {
  return ownWorkDone(t, world) && incompleteDependency(t, world) === undefined;
}

/** Everything ReadyToComplete asks of the task itself, its dependencies aside. */
function ownWorkDone(t: TaskState, world: World): boolean {
  const p = t.phase;
  const parked = p.kind === "atCap" && p.cap.kind === "parkedClosed";
  if (!parked && !(p.kind === "cycle" && p.implementer.kind === "committed")) return false;
  if (parked && unrecorded(t, world).length > 0) return false;
  if (t.judgements.length > 0) return false;
  if (SEATS.some((s) => seatBusy(t.seats[s]))) return false;
  if (!verifySettled(t)) return false;
  const { contention } = world;
  if (contention.running === t.id || contention.held.some((h) => h.task === t.id)) return false;
  const { lane, demands, ownVerdict } = t.review;
  if (lane.kind !== "free" || ownVerdict === "none" || (ownVerdict === "findings" && !parked)) return false;
  for (const d of demands) {
    if (d.kind === "own") return false;
    if (!(d.phase === "clean" || (parked && d.phase === "findings"))) return false;
  }
  return !t.routedIn.some((r) => !r.answered);
}

/** The first dependency of `t`, in plan order, that is not complete. */
const incompleteDependency = (t: TaskState, world: World): string | undefined =>
  planOf(world, t.id).dependencies.find((dep) => world.tasks.get(dep)?.phase.kind !== "complete");

/**
 * A task whose own work is done waits on its first incomplete dependency (FR-022): the wait names it, in the
 * `dependency TASK-MMM …` family the developer release already prints.
 */
function dependencyWait(t: TaskState, world: World): Intent[] {
  const dep = incompleteDependency(t, world);
  if (dep === undefined || !ownWorkDone(t, world)) return [];
  const s = world.tasks.get(dep);
  const reason = s === undefined || s.commits.length === 0 ? `dependency ${dep} has no commit` : `dependency ${dep} incomplete`;
  return [{ kind: "wait", task: t.id, origin: "progress", closes: ["complete"], action: { kind: "wait", task: t.id, reason }, blockedBy: { kind: "task", task: dep } }];
}
