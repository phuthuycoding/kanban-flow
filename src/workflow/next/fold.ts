import { atCapStep } from "./atcap.js";
import { JUDGEMENTS, isSuperseded } from "./judgements.js";
import { matchGitLog, sameSha, taskCommits } from "./ledger-state.js";
import { reviewStep } from "./review-region.js";
import { verifyStep } from "./verify-region.js";
import type {
  Cap,
  DecisionRegion,
  DeliveredEvent,
  DispatchMode,
  GateStatus,
  ImplementerStep,
  Judgement,
  JudgementEntry,
  JudgementKind,
  JudgementSuccessor,
  LedgerEvent,
  LedgerState,
  LoopInputs,
  LoopTask,
  MachineEvent,
  MachineEventOf,
  MachineEventType,
  RegionHandler,
  RegionRow,
  RegionTable,
  Seat,
  SeatSlot,
  TaskPhase,
  TaskPhaseKind,
  TaskState,
  World,
} from "./types.js";

// The fold: the ledger read once, in file order, into the World. Lifecycle transitions live here; verify, review and
// at-cap events go to their regions (verify-region.ts, review-region.ts, atcap.ts).

type Cycle = Extract<TaskPhase, { kind: "cycle" }>;
type Running = Extract<SeatSlot, { kind: "running" }>;
type Dispatched = MachineEventOf<"dispatched">;

const MAX_ROUNDS = 5;
const GATES: readonly string[] = ["DONE_WITH_CONCERNS", "NEEDS_CONTEXT", "BLOCKED"];

const gateStatus = (status: string): GateStatus => (GATES.includes(status) ? (status as GateStatus) : { unknown: status });
const rawStatus = (status: GateStatus): string => (typeof status === "string" ? status : status.unknown);
/** Fix rounds 1–3 resume the same developer; rounds 4–5 take a fresh one a tier up. */
const roundMode = (round: number): DispatchMode => (round <= 3 ? "resume" : "fresh");

const entryOf = (j: Judgement): JudgementEntry<JudgementKind> => JUDGEMENTS[j.kind] as unknown as JudgementEntry<JudgementKind>;

/** The judgements this region opens and closes: a non-reviewer seat's status, and Commit missing. */
const lifecycleOwns = (j: Judgement): boolean => (j.kind === "seatStatus" && j.seat !== "code-reviewer") || j.kind === "commitMissing";

const withPhase = (t: TaskState, phase: TaskPhase): TaskState => ({ ...t, phase });
const withSeat = (t: TaskState, seat: Seat, slot: SeatSlot): TaskState => ({ ...t, seats: { ...t.seats, [seat]: slot } });
const withImplementer = (t: TaskState, implementer: ImplementerStep): TaskState =>
  t.phase.kind === "cycle" ? withPhase(t, { ...t.phase, implementer }) : t;

function planTask(world: World, id: string): LoopTask | undefined {
  return world.inputs.tasks.find((p) => p.id === id);
}

/**
 * Closes every lifecycle judgement `e` accepts and returns their successors. A successor that abandons a minimal fix
 * is the at-cap region's, so its judgement is left for it.
 */
function closeOnEvent(t: TaskState, e: MachineEvent): { t: TaskState; closed: { j: Judgement; successor: JudgementSuccessor }[] } {
  const closed: { j: Judgement; successor: JudgementSuccessor }[] = [];
  const judgements = t.judgements.filter((j) => {
    if (!lifecycleOwns(j)) return true;
    const entry = entryOf(j);
    if (!entry.close(j, e, t)) return true;
    const successor = entry.successor(j, e, t);
    if (successor === "minimalFixAbandoned") return true;
    closed.push({ j, successor });
    return false;
  });
  return { t: { ...t, judgements }, closed };
}

/** The dispatch the developer's latest done answers, or the one running now. */
function devDispatchLine(t: TaskState): number | null {
  if (t.phase.kind === "cycle") {
    const step = t.phase.implementer;
    if (step.kind === "running" || step.kind === "commitMissing") return step.dispatchLine;
  }
  const slot = t.seats.developer;
  if (slot.kind === "reported") return slot.answers;
  if (slot.kind === "running") return slot.line;
  return null;
}

/** The developer resumed to commit a round seat's or the automation-writer's files after the cycle's own commit. */
function resumePurpose(t: TaskState, c: Cycle, dispatchLine: number): boolean {
  const since = c.sinceCommit;
  if (since === null || since < c.openedAt || since > dispatchLine) return false;
  return (["test-writer", "automation-writer"] as const).some((seat) => {
    const slot = t.seats[seat];
    return slot.kind === "reported" && slot.answers > since && slot.answers < dispatchLine;
  });
}

/** Rule 5: the report names commits git log has (any, when the log is empty) that no ledger line names. */
function unnamedReportShas(t: TaskState, world: World): string[] {
  const named = [...t.commits, ...t.droppedShas];
  const log = world.inputs.gitLog;
  const unnamed: string[] = [];
  for (const sha of world.inputs.reportCommits[t.id] ?? []) {
    const short = sha.slice(0, 7);
    if (log.length > 0 && !log.some((g) => sameSha(g.sha, short))) continue;
    if (named.some((n) => sameSha(n, short)) || unnamed.some((u) => sameSha(u, short))) continue;
    unnamed.push(short);
  }
  return unnamed;
}

/** A UI task under Level full: its automation-writer's specs are committed by a resumed developer. */
function uiSpecs(t: TaskState, world: World): boolean {
  const plan = planTask(world, t.id);
  const ui = plan !== undefined && (plan.testTypes.includes("UI") || plan.testTypes.includes("E2E"));
  return ui && world.inputs.level === "full";
}

function owesSpecs(t: TaskState, world: World): boolean {
  return uiSpecs(t, world) && t.seats["automation-writer"].kind === "idle";
}

/** The automation-writer ran ahead of the cycle's first developer: its specs still owe the resume-commit developer. */
function specsAhead(t: TaskState, c: Cycle, dispatchLine: number, world: World): boolean {
  const slot = t.seats["automation-writer"];
  return uiSpecs(t, world) && c.cycle === "first" && dispatchLine === c.openedAt && slot.kind === "reported" && slot.answers < dispatchLine;
}

/** The implementer after a developer DONE (or a gate that goes on as DONE), with what the ledger records now. */
function afterDevDone(t: TaskState, dispatchLine: number, at: number, world: World): TaskState {
  if (t.phase.kind !== "cycle") return t;
  const c = t.phase;
  const judgements = t.judgements.filter((j) => j.kind !== "commitMissing");
  const to = (implementer: ImplementerStep, opened: Judgement[] = []): TaskState => ({
    ...t,
    judgements: [...judgements, ...opened],
    phase: { ...c, implementer },
  });
  if (resumePurpose(t, c, dispatchLine)) return to({ kind: "committed" });
  const unnamed = unnamedReportShas(t, world);
  if (unnamed.length > 0) return to({ kind: "commitNoteOwed", shas: unnamed });
  if (c.sinceCommit === null || c.sinceCommit < dispatchLine) {
    return to({ kind: "commitMissing", dispatchLine }, [{ kind: "commitMissing", task: t.id, openedAt: at, dispatchLine }]);
  }
  if (owesSpecs(t, world)) return to({ kind: "specsOwed" });
  if (specsAhead(t, c, dispatchLine, world)) return to({ kind: "resumeCommitOwed" });
  const roundSeat = (["test-writer", "automation-writer"] as const).find((seat) => {
    const slot = t.seats[seat];
    return c.round > 0 && slot.kind === "running" && slot.round === c.round;
  });
  if (roundSeat !== undefined) return to({ kind: "roundSeatRunning", seat: roundSeat });
  return to({ kind: "committed" });
}

/** What a seat's DONE (or a gate that goes on as DONE) does to the phase; `answers` is the dispatch it answers. */
function seatDone(t: TaskState, seat: Exclude<Seat, "code-reviewer">, status: string, answers: number, at: number, world: World): TaskState {
  const reported: SeatSlot = { kind: "reported", status, answers };
  const next = withSeat(t, seat, reported);
  const phase = next.phase;
  if (phase.kind === "tests" && seat === "test-writer") return withPhase(next, { kind: "tests", writer: reported, hashOwed: true });
  if (phase.kind !== "cycle") return next;
  if (seat === "developer") return afterDevDone(next, answers, at, world);
  const step = phase.implementer;
  // A round seat sent instead of the round's developer: its tests are hashed, then the developer resumed to commit them.
  const roundSeat = (s: SeatSlot): boolean => s.kind === "running" && s.round !== undefined && s.round === phase.round;
  if ((step.kind === "roundSeatRunning" && step.seat === seat) || (step.kind === "owed" && roundSeat(t.seats[seat]))) {
    return withImplementer(next, seat === "test-writer" ? { kind: "roundHashOwed" } : { kind: "resumeCommitOwed", round: phase.round });
  }
  if (step.kind === "specsRunning" && seat === "automation-writer") return withImplementer(next, { kind: "resumeCommitOwed" });
  const slot = t.seats[seat];
  if (slot.kind === "running" && slot.round !== undefined && slot.round === phase.round) return { ...next, roundHashOwed: true };
  return next;
}

/** The dispatch a gated done answers, as its Seat status judgement recorded it. */
function gatedDispatch(j: Extract<Judgement, { kind: "seatStatus" }>): number {
  if (j.dispatchLine === undefined) throw new Error(`${j.task}: no dispatch recorded for the ${j.seat} done at line ${j.doneLine}`);
  return j.dispatchLine;
}

/** A writer whose gate a decision closed without its work: the seat is owed again, never its hashes or commit. */
function writerOwed(t: TaskState, seat: "test-writer" | "automation-writer"): TaskState {
  const idle: SeatSlot = { kind: "idle" };
  const next = withSeat(t, seat, idle);
  const phase = next.phase;
  if (phase.kind === "tests" && seat === "test-writer") return withPhase(next, { kind: "tests", writer: idle, hashOwed: false });
  if (phase.kind === "cycle" && phase.implementer.kind === "specsRunning" && seat === "automation-writer") {
    return withImplementer(next, { kind: "specsOwed" });
  }
  if (phase.kind === "cycle" && phase.round > 0) {
    const owed = { ...next, writerOwed: { seat, round: phase.round } };
    return phase.implementer.kind === "roundSeatRunning" && phase.implementer.seat === seat ? withImplementer(owed, { kind: "owed", mode: roundMode(phase.round), round: phase.round }) : owed;
  }
  return next;
}

/**
 * A gate closed by a decided note or a Ruling goes on as DONE (FR-014), answering the seat's dispatch. A writer goes on
 * as DONE only from DONE_WITH_CONCERNS; any other status leaves it with no work to hash or commit, so it is owed again.
 */
function goOnAsDone(t: TaskState, j: Extract<Judgement, { kind: "seatStatus" }>, at: number, world: World): TaskState {
  if (j.seat === "code-reviewer") return t;
  const status = rawStatus(j.status);
  if (j.seat !== "developer") {
    if (status !== "DONE_WITH_CONCERNS") return writerOwed(t, j.seat);
    return seatDone(t, j.seat, status, gatedDispatch(j), at, world);
  }
  const dispatchLine = devDispatchLine(t);
  return dispatchLine === null ? t : seatDone(t, "developer", status, dispatchLine, at, world);
}

function openCycle(t: TaskState, cycle: Cycle["cycle"], round: number, openedAt: number, implementer: ImplementerStep): TaskState {
  const sinceCommit = t.phase.kind === "cycle" ? t.phase.sinceCommit : null;
  return {
    ...t,
    roundsUsed: Math.max(t.roundsUsed, round),
    phase: { kind: "cycle", cycle, round, openedAt, implementer, sinceCommit, commits: [] },
  };
}

function dispatchInCycle(t: TaskState, c: Cycle, e: Dispatched, slot: Running): TaskState {
  const running: ImplementerStep = { kind: "running", dispatchLine: e.line, inline: slot.inline };
  const round = e.round;
  if (round !== undefined && c.cycle !== "minimalFix" && !(c.cycle === "round" && c.round === round)) {
    const implementer: ImplementerStep = e.seat === "developer" ? running : { kind: "owed", mode: roundMode(round), round };
    return openCycle(t, "round", round, e.line, implementer);
  }
  if (e.seat === "developer") return withImplementer(t, running);
  if (e.seat === "automation-writer" && round === undefined && c.implementer.kind === "specsOwed") {
    return withImplementer(t, { kind: "specsRunning" });
  }
  if (round !== undefined && c.implementer.kind === "committed") return withImplementer(t, { kind: "roundSeatRunning", seat: e.seat });
  // A round seat dispatched after a round developer's done with no commit takes the round on: the round's commit is
  // the resume-commit developer's, after the seat.
  if (round !== undefined && c.round === round && c.implementer.kind === "commitMissing") {
    return { ...withImplementer(t, { kind: "roundSeatRunning", seat: e.seat }), judgements: t.judgements.filter((j) => j.kind !== "commitMissing") };
  }
  return t;
}

const onDispatched: RegionHandler<"dispatched"> = (task, e) => {
  if (e.seat === "code-reviewer") return task;
  const closed = closeOnEvent(task, e).t;
  const t = closed.writerOwed?.seat === e.seat ? { ...closed, writerOwed: undefined } : closed;
  const inlineDev = e.seat === "developer" && e.model === "inline";
  const slot: Running = {
    kind: "running",
    line: e.line,
    ts: e.ts,
    ...(e.round !== undefined ? { round: e.round } : {}),
    ...(e.cascade !== undefined ? { cascade: e.cascade } : {}),
    // Only a `model=inline` dispatch or a later inline note is the controller's own seat; a model dispatch is spawned.
    inline: inlineDev,
    origin: "progress",
  };
  const next = withSeat({ ...t, inline: t.inline || inlineDev }, e.seat, slot);
  const phase = next.phase;
  switch (phase.kind) {
    case "pending":
    case "tests":
      if (e.seat === "test-writer") return withPhase(next, { kind: "tests", writer: slot, hashOwed: false });
      if (e.seat === "developer") return openCycle(next, "first", 0, e.line, { kind: "running", dispatchLine: e.line, inline: slot.inline });
      return next;
    case "ready":
      if (e.seat === "developer") return openCycle(next, "first", 0, e.line, { kind: "running", dispatchLine: e.line, inline: slot.inline });
      return next;
    case "cycle":
      return dispatchInCycle(next, phase, e, slot);
    default:
      return next;
  }
};

const onDone: RegionHandler<"done"> = (t, e, world) => {
  if (e.seat === "code-reviewer") return t;
  const slot = t.seats[e.seat];
  if (slot.kind !== "running") return t;
  if (e.status === "DONE") return seatDone(t, e.seat, e.status, slot.line, e.line, world);
  const gated: SeatSlot = { kind: "gated", status: gateStatus(e.status), doneLine: e.line };
  const judgement: Judgement = {
    kind: "seatStatus",
    task: t.id,
    openedAt: e.line,
    seat: e.seat,
    status: gated.status,
    doneLine: e.line,
    dispatchLine: slot.line,
  };
  const next = { ...withSeat(t, e.seat, gated), judgements: [...t.judgements, judgement] };
  if (next.phase.kind === "tests" && e.seat === "test-writer") return withPhase(next, { kind: "tests", writer: gated, hashOwed: false });
  return next;
};

const onTestHashes: RegionHandler<"testHashes"> = (task) => {
  const t = task.roundHashOwed ? { ...task, roundHashOwed: undefined } : task;
  if (t.phase.kind === "tests") return t.phase.hashOwed ? withPhase(t, { kind: "ready" }) : t;
  if (t.phase.kind === "cycle" && t.phase.implementer.kind === "roundHashOwed") {
    return withImplementer(t, { kind: "resumeCommitOwed", round: t.phase.round });
  }
  return t;
};

const toReady: RegionHandler<"noTestWriter"> = (t) => withPhase(t, { kind: "ready" });

const onComplete: RegionHandler<"complete"> = (t, e) => withPhase(t, { kind: "complete", how: isSuperseded(e.text) ? "superseded" : "complete" });

const onImplemented: RegionHandler<"implemented"> = (t) => withPhase(t, { kind: "complete", how: "implemented" });

const onCommits: RegionHandler<"commits"> = (task, e, world) => {
  if (task.phase.kind !== "cycle") return task;
  const recorded = matchGitLog(e.shas, world.inputs.gitLog).kept.length > 0;
  const noteOwed = task.phase.implementer.kind === "commitNoteOwed";
  const dispatchLine = devDispatchLine(task);
  // The cycle's own commits: a fix round's package names these, not the task's whole list.
  const own = task.phase.commits;
  const commits = [...own, ...e.shas.filter((sha, i) => !own.some((c) => sameSha(c, sha)) && !e.shas.slice(0, i).some((s) => sameSha(s, sha)))];
  let t = withPhase(task, { ...task.phase, commits, ...(recorded ? { sinceCommit: e.line } : {}) });
  const closing = closeOnEvent(t, e);
  t = closing.t;
  if (!closing.closed.some((c) => c.successor === "afterDevDone") && !noteOwed) return t;
  if (dispatchLine === null) return t;
  const gate = closing.closed.find((c) => c.j.kind === "seatStatus");
  if (gate !== undefined && gate.j.kind === "seatStatus") {
    t = withSeat(t, "developer", { kind: "reported", status: rawStatus(gate.j.status), answers: dispatchLine });
  }
  return afterDevDone(t, dispatchLine, e.line, world);
};

/** A decided note or a Ruling tagged for the lifecycle closes that judgement; a seat gate goes on as DONE. */
function onDecision(t: TaskState, e: MachineEventOf<"decided"> | MachineEventOf<"ruling">, world: World): TaskState {
  if (e.closes !== undefined && e.closes.region !== "lifecycle") return t;
  const tag = e.closes;
  const j = t.judgements.find((open) => (tag === undefined || open.openedAt === tag.judgement) && entryOf(open).close(open, e, t));
  if (j === undefined || !lifecycleOwns(j) || j.kind !== "seatStatus") return t;
  const successor = entryOf(j).successor(j, e, t);
  if (successor !== "seatAsDone") return t;
  return goOnAsDone({ ...t, judgements: t.judgements.filter((open) => open !== j) }, j, e.line, world);
}

const onDecided: RegionHandler<"decided"> = (t, e, world) => onDecision(t, e, world);
const onRuling: RegionHandler<"ruling"> = (t, e, world) => onDecision(t, e, world);

/** A fix round's summary line: the round is spent. */
const onFixRound: RegionHandler<"fixRound"> = (t, e) => ({ ...t, roundsUsed: Math.max(t.roundsUsed, e.round) });

/** A reopen starts the task's life over at the next fix round, or at the cap stop past round five. */
const onReopened: RegionHandler<"reopened"> = (t, e, world) => {
  const plan = planTask(world, t.id);
  if (plan === undefined) throw new Error(`${t.id} is reopened but is not a plan task`);
  const round = t.roundsUsed + 1;
  const base: TaskState = {
    ...initialTask(plan),
    reopened: true,
    inline: t.inline,
    roundsUsed: t.roundsUsed,
    // The round count goes on across the reopen, so a written fix round line stays written.
    ...(t.fixRoundWritten !== undefined ? { fixRoundWritten: t.fixRoundWritten } : {}),
    commits: t.commits,
    droppedShas: t.droppedShas,
  };
  if (round > MAX_ROUNDS) {
    return {
      ...base,
      phase: { kind: "atCap", cap: { kind: "capStop", noted: false, fixSpent: false } },
      judgements: [{ kind: "capStop", task: t.id, openedAt: e.line }],
    };
  }
  return openCycle(base, "round", round, e.line, { kind: "owed", mode: roundMode(round), round });
};

const NOOP_ROW = {
  dispatched: "noop", done: "noop", verifyStarted: "noop", verifyDone: "noop", developerWaits: "noop", fixQueued: "noop",
  fixRound: "noop", cascadeOwed: "noop", complete: "noop", implemented: "noop", noTestWriter: "noop", testHashes: "noop",
  reviewPackage: "noop", commits: "noop", decided: "noop", verifyRouted: "noop", verifyWaits: "noop", verifyRerun: "noop",
  reopened: onReopened, capReached: "noop", inline: "noop", parked: "noop", capRuling: "noop", noStepUp: "noop", scan: "noop",
  other: "noop", cascadeLanded: "noop", routeAnswered: "noop", routedIn: "noop", watchReleased: "noop", ruling: "noop",
} satisfies RegionRow;

const ENDINGS = { complete: onComplete, implemented: onImplemented };
const SEATS = { dispatched: onDispatched, done: onDone, decided: onDecided, ruling: onRuling };

/**
 * The lifecycle region: TaskPhase × event. The phase-independent scalars (the commit list, the inline flag) are kept
 * by `step` before the cell. An at-cap task's events are the at-cap region's; a complete task waits for a reopen.
 */
export const LIFECYCLE_TABLE = {
  pending: { ...NOOP_ROW, ...SEATS, ...ENDINGS, noTestWriter: toReady },
  tests: { ...NOOP_ROW, ...SEATS, ...ENDINGS, testHashes: onTestHashes, noTestWriter: toReady },
  ready: { ...NOOP_ROW, ...SEATS, ...ENDINGS },
  cycle: { ...NOOP_ROW, ...SEATS, ...ENDINGS, testHashes: onTestHashes, commits: onCommits, fixRound: onFixRound },
  atCap: NOOP_ROW,
  complete: NOOP_ROW,
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

/** Every task that depends on `task`, directly or transitively. */
function dependents(tasks: LoopTask[], task: string): string[] {
  const found: string[] = [];
  const queue = [task];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const t of tasks) {
      if (t.dependencies.includes(current) && !found.includes(t.id)) {
        found.push(t.id);
        queue.push(t.id);
      }
    }
  }
  return found;
}

/** Tasks a `Ruling:` line names. */
const NAMED_TASK = /TASK-\d+(?!\d)/g;

/** Folds the ledger into the World. */
export function foldWorld(state: LedgerState, inputs: LoopInputs, cap: Cap): World {
  const world: World = {
    inputs,
    cap,
    contention: cap.contention,
    scan: "none",
    ceiling: inputs.ceiling.error === undefined ? "valid" : "invalidUndecided",
    unknown: new Map(),
    pool: [],
    tasks: new Map(inputs.tasks.map((t) => [t.id, initialTask(t)])),
  };
  const known = (id: string): boolean => world.tasks.has(id);
  const wavesNamed = new Set<number>();
  const rerunSignature = new Map<string, string>();
  world.wavesNamed = wavesNamed;
  world.rerunSignature = rerunSignature;
  const apply = (id: string, e: MachineEvent): void => {
    const t = world.tasks.get(id);
    if (t !== undefined) world.tasks.set(id, step(world, t, e));
  };
  const complete = (id: string): boolean => world.tasks.get(id)?.phase.kind === "complete";
  const notice = (id: string): void => {
    if (!known(id) && !world.unknown.has(id)) world.unknown.set(id, { decided: false });
  };

  // Fold-wide positions the deliveries read: the first own review, the first developer, the latest fix-round
  // developer, the shas named so far, and who waits for or routed a failure to whom.
  const firstReview = new Set<string>();
  const firstDeveloper = new Set<string>();
  const fixRoundOf = new Map<string, number>();
  const named = new Map<string, string[]>();
  const watches = new Map<string, Set<string>>();
  const routes = new Map<string, Set<string>>();
  const deps = new Map(inputs.tasks.map((t) => [t.id, dependents(inputs.tasks, t.id)]));

  const deliver = (id: string, d: DeliveredEvent): void => apply(id, d);
  const release = (x: string, e: LedgerEvent): void => {
    for (const h of watches.get(x) ?? []) deliver(h, { type: "watchReleased", task: h, from: x, line: e.line, ts: e.ts });
    watches.delete(x);
  };
  const answer = (x: string, e: LedgerEvent): void => {
    const unfixed = e.type === "complete" || e.type === "implemented";
    for (const h of routes.get(x) ?? []) {
      deliver(h, { type: "routeAnswered", task: h, from: x, line: e.line, ts: e.ts, ...(unfixed ? { unfixed: true as const } : {}) });
    }
  };

  // A failure under a waits note is not routed on: the waits note wins until it is released.
  const waiting = (id: string): boolean => {
    const v = world.tasks.get(id)?.verify;
    return v?.kind === "failed" && v.disposition.kind === "waits";
  };

  for (const e of state.events) {
    if (e.type === "scan") world.scan = "done";
    const wave = e.type === "other" ? /^wave (\d+):/.exec(e.text) : null;
    if (wave !== null) wavesNamed.add(Number(wave[1]));
    if (e.type === "verifyRerun") rerunSignature.set(e.task, e.signature);
    if (e.type === "other" && e.text.startsWith("Ruling:") && inputs.ceiling.error !== undefined && e.text.includes(inputs.ceiling.error)) {
      world.ceiling = "ruled";
    }
    if (!("task" in e) || e.task === undefined) {
      if (e.type === "other" && e.text.startsWith("Ruling:")) {
        const ids = new Set(e.text.match(NAMED_TASK) ?? []);
        for (const id of ids) if (known(id)) deliver(id, { type: "ruling", task: id, text: e.text, line: e.line, ts: e.ts });
      }
      continue;
    }

    const h = e.task;
    notice(h);
    if (e.type === "verifyWaits" || e.type === "verifyRouted") notice(e.otherTask);
    if (e.type === "decided" && world.unknown.has(h)) world.unknown.set(h, { decided: true });
    apply(h, e);
    if (!known(h)) continue;

    if (e.type === "dispatched" && e.seat === "code-reviewer" && e.cascade === undefined) firstReview.add(h);
    if (e.type === "dispatched" && e.seat === "developer") {
      firstDeveloper.add(h);
      if (e.round !== undefined && e.round >= 1) fixRoundOf.set(h, e.round);
    }
    if (e.type === "verifyRouted" && !waiting(h)) {
      if (known(e.otherTask)) deliver(e.otherTask, { type: "routedIn", task: e.otherTask, from: h, line: e.line, ts: e.ts });
      routes.set(e.otherTask, (routes.get(e.otherTask) ?? new Set()).add(h));
    }
    if (e.type === "verifyWaits") {
      // A commit of the other task named before the note releases it too: the verify then runs at head.
      if ((named.get(e.otherTask) ?? []).length > 0 || complete(e.otherTask)) {
        deliver(h, { type: "watchReleased", task: h, from: e.otherTask, line: e.line, ts: e.ts });
      } else {
        watches.set(e.otherTask, (watches.get(e.otherTask) ?? new Set()).add(h));
      }
    }
    if ((e.type === "verifyDone" && e.exit === 0) || e.type === "parked" || e.type === "complete" || e.type === "implemented") answer(h, e);
    if (e.type === "complete" || e.type === "implemented") release(h, e);
    if (e.type === "commits" || e.type === "reviewPackage") {
      const seen = named.get(h) ?? [];
      const fresh = e.shas.filter((sha, i) => !seen.some((s) => sameSha(s, sha)) && !e.shas.slice(0, i).some((s) => sameSha(s, sha)));
      named.set(h, [...seen, ...fresh]);
      release(h, e);
      const round = fixRoundOf.get(h);
      if (!firstReview.has(h) || round === undefined) continue;
      // A fix commit after H's first own review owes a cascade re-review to each open dependent already in development.
      for (const sha of fresh) {
        for (const x of deps.get(h) ?? []) {
          if (complete(x) || !firstDeveloper.has(x)) continue;
          deliver(x, { type: "cascadeLanded", task: x, sha7: sha.slice(0, 7), from: h, round, line: e.line, ts: e.ts });
        }
      }
    }
  }

  for (const [id, t] of world.tasks) {
    const all = taskCommits(state, id, inputs.reportCommits[id], inputs.gitLog);
    const { kept, dropped } = matchGitLog(all, inputs.gitLog);
    world.tasks.set(id, { ...t, commits: kept, droppedShas: dropped });
  }
  // A re-run the cap holds is the fold's only while the task's verify still waits for it: a run a commit made stale is
  // owed again as a plain verify, and holds no developer.
  const held = cap.contention.held.filter((h) => {
    const v = world.tasks.get(h.task)?.verify;
    return v === undefined || (v.kind === "failed" && (v.disposition.kind === "contentionHeld" || v.disposition.kind === "plainRerunOwed"));
  });
  if (held.length !== cap.contention.held.length) {
    world.contention = { held, running: cap.contention.running, blocksDevelopers: held.length > 0 || cap.contention.running !== null };
  }
  world.pool = [...world.tasks.values()]
    .flatMap((t) => {
      const slot = t.seats.developer;
      if (t.phase.kind === "complete" || slot.kind !== "running" || slot.inline) return [];
      return [{ task: t.id, line: slot.line, ...(slot.round !== undefined ? { round: slot.round } : {}) }];
    })
    .sort((a, b) => a.line - b.line);
  return world;
}

/**
 * The phase-independent scalars an event changes: the task's commits against git log, the inline flag, the written
 * developer wait, and the lines of the latest developer done and review package.
 */
function scalars(t: TaskState, e: MachineEvent, world: World): TaskState {
  if (e.type === "commits" || e.type === "reviewPackage") {
    const { kept, dropped } = matchGitLog([...t.commits, ...t.droppedShas, ...e.shas], world.inputs.gitLog);
    return { ...t, commits: kept, droppedShas: dropped };
  }
  if (e.type === "developerWaits") return { ...t, waitsWritten: e.reason };
  if (e.type === "fixRound") return { ...t, fixRoundWritten: Math.max(t.fixRoundWritten ?? 0, e.round) };
  if (e.type === "done" && e.seat === "developer") return { ...t, waitsWritten: undefined, devDoneAt: e.line };
  if (e.type !== "inline") return t;
  const slot = t.seats.developer;
  let next: TaskState = { ...t, inline: true };
  if (slot.kind === "running") next = withSeat(next, "developer", { ...slot, inline: true });
  if (next.phase.kind === "cycle" && next.phase.implementer.kind === "running") {
    next = withImplementer(next, { ...next.phase.implementer, inline: true });
  }
  return next;
}

/** The region that owns judgement `j` when decision `e` closes it. */
function regionOf(j: Judgement, e: MachineEvent, t: TaskState): DecisionRegion | null {
  switch (j.kind) {
    case "seatStatus":
      if (j.seat === "code-reviewer") return "review";
      return entryOf(j).successor(j, e, t) === "minimalFixAbandoned" ? "atcap" : "lifecycle";
    case "commitMissing":
      return "lifecycle";
    case "verifyExit2":
    case "verifyExit3":
    case "verifyExit":
    case "verifyRouted":
    case "verifyWaitsUnreleasable":
      return "verify";
    case "breaker":
    case "breakerFixSpent":
    case "capStop":
    case "capStopFixSpent":
    case "cascadeAtCapBreaker":
    case "cascadeAtCapStop":
      return "atcap";
    default:
      return null;
  }
}

/** Tags a decided note or a Ruling with the one judgement it closes: the earliest open one that accepts it. */
function tagDecision(t: TaskState, e: MachineEvent): MachineEvent {
  if (e.type !== "decided" && e.type !== "ruling") return e;
  const j = t.judgements.find((open) => entryOf(open).close(open, e, t));
  const region = j === undefined ? null : regionOf(j, e, t);
  if (j === undefined || region === null) return e;
  return { ...e, closes: { region, judgement: j.openedAt } };
}

/** Applies one event to one task: the lifecycle cell of its phase, then the region cells. */
export function step(world: World, task: TaskState, event: MachineEvent): TaskState {
  // A review package naming a sha no line named before records that commit, as a commits note would.
  const e: MachineEvent =
    event.type === "reviewPackage" && event.shas.some((sha) => ![...task.commits, ...task.droppedShas].some((n) => sameSha(n, sha)))
      ? { ...event, type: "commits", fromPackage: true }
      : tagDecision(task, event);
  const t = { ...scalars(task, e, world), ...(event.type === "reviewPackage" ? { packagedAt: event.line } : {}) };
  const cell = LIFECYCLE_TABLE[t.phase.kind][e.type] as RegionHandler<MachineEventType> | "noop";
  const lifecycle = cell === "noop" ? t : cell(t, e, world);
  return atCapStep(reviewStep(verifyStep(lifecycle, e, world), e, world), e, world);
}
