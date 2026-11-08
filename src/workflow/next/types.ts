import type { Seat } from "../loop-stats.js";

// The contract between the ledger reader, the input reader, the rule modules and `schedule()`.
// Rule modules are pure: they read `LedgerState`, `LoopInputs` and a `Cap`, and touch no filesystem, git or clock.

export type { Seat };

/** How a dispatch reaches its seat: a new agent, the same agent resumed, or a fresh agent one tier up (fix rounds 4–5). */
export type DispatchMode = "new" | "resume" | "fresh";

export type Action =
  | {
      kind: "dispatch";
      task: string;
      seat: Seat;
      round?: number;
      cascade?: string;
      mode: DispatchMode;
      /** The controller fills this developer seat itself (an inline wave); never a spawn. */
      inline?: boolean;
    }
  | {
      kind: "verify";
      task: string;
      /** The full `kf verify …` command line to run. */
      command: string;
      rerun?: boolean;
    }
  | {
      kind: "write";
      task?: string;
      /** The ledger line body, without the ` @ <ts>` suffix. */
      line: string;
      /** The `kf record …` call that writes it. */
      record: string;
    }
  | { kind: "complete"; task: string }
  | { kind: "wait"; task: string; reason: string }
  | {
      kind: "decide";
      task?: string;
      /** The kept skill section that holds the judgement rule, e.g. `kf:implement § 3.2`. */
      rule: string;
      reason: string;
      /** The ledger line that closes this decide. */
      closes: string;
    }
  | { kind: "stop"; task?: string; reason: string }
  | { kind: "finished" };

export type ActionKind = Action["kind"];

/** A seat or verify the ledger shows open: in flight, or lost when the session says so with `--resume`. */
export interface InFlight {
  task: string;
  seat: Seat | "verify";
  /** FR-013: set when the task's report already names a commit dated after the open developer dispatch. */
  hint?: string;
}

/** What `kf next --json` prints. */
export interface NextResult {
  feature: string;
  n: number;
  inFlight: InFlight[];
  actions: Action[];
}

// ---------------------------------------------------------------------------
// Ledger state (filled by TASK-002 `readLedgerState`)
// ---------------------------------------------------------------------------

interface EventBase {
  /** 1-based line number in the ledger file. */
  line: number;
  /** Epoch ms of the line's ` @ <ts>` suffix. */
  ts: number;
}

/** How a `Ruling: developer cap …` line came about. */
export type CapCause =
  | { kind: "start" }
  | { kind: "wave"; wave: number }
  | { kind: "contention"; signature: string; task: string }
  | { kind: "ceiling"; max: number };

/**
 * One ledger line the scheduler reads, in file order. The nine grammar shapes keep their `loop-stats` names;
 * the other variants are the stamped lines of FR-016's refusal set. `other` is any other stamped line
 * (rulings, minors, briefs, waves …): kept for order, never scheduled on.
 */
export type LedgerEvent = EventBase &
  (
    | { type: "dispatched"; task: string; seat: Seat; model: string; round?: number; cascade?: string }
    | { type: "done"; task: string; seat: Seat; status: string }
    | { type: "verifyStarted"; task: string }
    | { type: "verifyDone"; task: string; exit: number }
    | { type: "developerWaits"; task: string; reason: string }
    | { type: "fixQueued"; task: string; otherTask: string }
    | { type: "fixRound"; task: string; round: number }
    | { type: "cascadeOwed"; task: string; sha: string; otherTask: string }
    | { type: "complete"; task: string; text: string }
    /** `TASK-NNN: implemented, test-writer seat: none, review seat: none` — counts as `complete`. */
    | { type: "implemented"; task: string }
    | { type: "noTestWriter"; task: string; reason: string }
    | { type: "testHashes"; task: string; files: Record<string, string> }
    | { type: "reviewPackage"; task: string; shas: string[] }
    /** `Note TASK-NNN: commits <a7>,<b7>` */
    | { type: "commits"; task: string; shas: string[] }
    /** `Note TASK-NNN: decided — <what>` */
    | { type: "decided"; task: string; what: string }
    /** `Note TASK-NNN: verify routed — TASK-MMM` */
    | { type: "verifyRouted"; task: string; otherTask: string }
    /** `Note TASK-NNN: verify waits — <file> (TASK-MMM)` */
    | { type: "verifyWaits"; task: string; file: string; otherTask: string }
    /** `Note TASK-NNN: verify rerun — contention <signature>` */
    | { type: "verifyRerun"; task: string; signature: string }
    /** `Note TASK-NNN: reopened — <testing|review|ci> <exec8>` */
    | { type: "reopened"; task: string; source: string; execution: string }
    /** `Note TASK-NNN: cap reached — <failure>` */
    | { type: "capReached"; task: string; failure: string }
    /** `Note TASK-NNN: developer seat inline` */
    | { type: "inline"; task: string }
    /** `TASK-NNN: parked — <finding> — Ruling: <why>` */
    | { type: "parked"; task: string; finding: string }
    /** `Ruling: developer cap <N> — start — …` (from null) or `Ruling: developer cap <old> → <new> — <cause> — …` */
    | { type: "capRuling"; from: number | null; to: number; cause: CapCause }
    /** `Note wave <w>: no step-up — <reason>` */
    | { type: "noStepUp"; wave: number; reason: string }
    /** Any `Scan:` line; `Scan: clean` sets `clean`. */
    | { type: "scan"; clean: boolean }
    | { type: "other"; task?: string; text: string }
  );

export type LedgerEventType = LedgerEvent["type"];

export interface LedgerState {
  /** Every stamped line after the header, in file order. */
  events: LedgerEvent[];
}

/** A ledger line `kf next` will not schedule over (FR-016). */
export interface RepairLine {
  line: number;
  text: string;
  reason: string;
}

export type LedgerRead = { ok: true; state: LedgerState } | { ok: false; repair: RepairLine[] };

// ---------------------------------------------------------------------------
// Loop inputs (filled by TASK-003 `readLoopInputs`)
// ---------------------------------------------------------------------------

export type TestType = "Unit" | "Integration" | "UI" | "E2E";

export interface LoopTask {
  id: string;
  dependencies: string[];
  /** The task's Files allowlist; null when unknown (overlaps everything). */
  files: string[] | null;
  wave: number;
  /** Ids of the other tasks whose Files are not disjoint from this one's. */
  overlaps: string[];
  /** The plan records `Execution: wave <w> inline` for this task's wave. */
  inline: boolean;
  /** Test types of the TCs whose FR or UC reference matches the task's refs (feature); for a bug, from `regression`. */
  testTypes: TestType[];
}

export interface VerifyRun {
  /** Epoch ms of the block's `## kf verify <time> exit=<n>` header. */
  ts: number;
  exit: number;
  /** The block's text, header excluded: contention is classified from it. */
  text: string;
}

export interface LoopInputs {
  feature: string;
  kind: "feature" | "bug";
  /** The Test Strategy `Level` (feature) or `Test Level` (bug), lower-cased; null when absent. */
  level: string | null;
  /** Plan order for a feature, `tasks.md` file order for a bug. */
  tasks: LoopTask[];
  /** `harness.developers.max` as `kf tasks --json` reports it. */
  ceiling: { max: number; source: string; error?: string };
  /** Raw `Commits created` shas of each `loop/task-NNN-report.md`, keyed by task id. */
  reportCommits: Record<string, string[]>;
  /** Parsed blocks of each `loop/task-NNN-verify.log`, oldest first, keyed by task id. */
  verifyRuns: Record<string, VerifyRun[]>;
  /** Commits of the item's branch since the baseline, oldest first, with committer time. */
  gitLog: { sha: string; ts: number }[];
}

/** Plan-level refusal from the input reader (bad graph, empty plan, bug `tasks.md` with no ids). */
export type InputsRead = { ok: true; inputs: LoopInputs } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Live cap (filled by TASK-004 `liveCap`)
// ---------------------------------------------------------------------------

/** A verify re-run owed after a contention-shaped failure, or a plain re-run of a failure with no log block. */
export interface HeldRerun {
  task: string;
  atHead: boolean;
  /** `rerun`: the one re-run after a step-down; `plain`: a failure with no log block, re-run once as a plain verify. */
  kind: "rerun" | "plain";
}

export interface Contention {
  /** Owed re-runs, earliest task first. */
  held: HeldRerun[];
  /** A re-run whose `verify started` has no `verify done` yet. */
  running: string | null;
  /** True while any re-run is held or running: no developer, a fix round's included, is released. */
  blocksDevelopers: boolean;
}

export interface Cap {
  /** The live cap N after every owed decision. */
  n: number;
  /** `harness.developers.max`, 1 when the config is invalid. */
  ceiling: number;
  /** The cap rulings, `no step-up` notes, `verify rerun` notes and the invalid-config decide owed now. */
  owed: Action[];
  contention: Contention;
}

// ---------------------------------------------------------------------------
// State machine: the ledger folded once, in file order, into one `TaskState` per plan task and a `World`.
// A task's life is the events after its latest `reopened` note. No module reads raw events after the fold.
// ---------------------------------------------------------------------------

/** `progress`: an intent the loop owes going forward; `resume`: a lost seat or verify re-issued under `--resume`. */
export type IntentOrigin = "progress" | "resume";

/** The options `schedule()` takes, passed on to the item intents and the arbiter. */
export interface NextOptions {
  resume: boolean;
}

/** A status outside the closed set (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED, clean, findings) keeps its raw text. */
export type GateStatus = "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED" | { unknown: string };

/** One seat of one task. */
export type SeatSlot =
  | { kind: "idle" }
  | {
      kind: "running";
      /** Ledger line of the dispatch. */
      line: number;
      round?: number;
      cascade?: string;
      inline: boolean;
      origin: IntentOrigin;
    }
  | {
      kind: "reported";
      status: string;
      /** Ledger line of the dispatch the done answers. */
      answers: number;
    }
  | {
      /** A non-DONE status: a Seat status judgement is open on it. */
      kind: "gated";
      status: GateStatus;
      doneLine: number;
    }
  | {
      /** The gate was closed by a decision: the same seat is owed again, with the same round and cascade. */
      kind: "redispatchOwed";
      mode: DispatchMode;
      round?: number;
      cascade?: string;
    };

/** Where the implementer of a cycle stands. */
export type ImplementerStep =
  | { kind: "owed"; mode: DispatchMode; round?: number }
  | { kind: "running"; dispatchLine: number; inline: boolean }
  | { kind: "roundSeatRunning"; seat: Seat }
  | { kind: "roundHashOwed" }
  | { kind: "resumeCommitOwed"; round?: number }
  | { kind: "specsOwed" }
  | { kind: "specsRunning" }
  /** The report names shas that are in the git log but in no ledger line. */
  | { kind: "commitNoteOwed"; shas: string[] }
  /** The developer is done with no commit recorded since the dispatch it answers (`dispatchLine`). */
  | { kind: "commitMissing"; dispatchLine: number }
  | { kind: "committed" };

/** A first pass, a fix round (1–5), or the one minimal fix past the cap. */
export type CycleKind = "first" | "round" | "minimalFix";

/** The task at the five-round cap with something still open. */
export type AtCap =
  /** Never reopened: closes on a parked line plus a decided note, in either order. `parked` holds ledger lines. */
  | { kind: "breaker"; parked: number[]; decidedAt?: number; fixSpent: boolean }
  /** Reopened: a stop; `noted` once its `cap reached` note is written. */
  | { kind: "capStop"; noted: boolean; fixSpent: boolean }
  | { kind: "minimalFixOwed"; via: "breaker" | "capStop" }
  /** A cascade re-review returned findings with no rounds left. */
  | { kind: "cascadeAtCap"; sha7: string; reopened: boolean }
  | { kind: "parkedClosed" };

export type AtCapKind = AtCap["kind"];

/** The task's place in its life; exactly one at a time. */
export type TaskPhase =
  | { kind: "pending" }
  /** The first-pass test-writer is open, or reported DONE (or a DWC a judgement accepted) and the hashes are owed. */
  | { kind: "tests"; writer: SeatSlot; hashOwed: boolean }
  /** Hashes written or a `no test-writer` line: the developer is not dispatched yet. */
  | { kind: "ready" }
  /** One implement → commit → check pass. */
  | {
      kind: "cycle";
      cycle: CycleKind;
      /** 0 for the first pass, 1–5 for a fix round. */
      round: number;
      /** Ledger line that opened the cycle. */
      openedAt: number;
      implementer: ImplementerStep;
      /** Ledger line of the latest commit the check pass runs against; null before the first. */
      sinceCommit: number | null;
      commits: string[];
    }
  | { kind: "atCap"; cap: AtCap }
  /** Terminal until a `reopened` note. */
  | { kind: "complete"; how: "complete" | "implemented" | "superseded" };

export type TaskPhaseKind = TaskPhase["kind"];

/** What became of a failed verify (exit 1). */
export type VerifyDisposition =
  | { kind: "plainRerunOwed" }
  | { kind: "contentionHeld"; signature: string }
  | { kind: "kept" }
  | { kind: "waits"; otherTask: string }
  /** A stop: the task waited for is unknown, or overlaps, is not open and ranks later. */
  | { kind: "waitsUnreleasable"; otherTask: string; why: string }
  | { kind: "routedOut"; otherTask: string; line: number }
  /** A route to a task that is complete, unknown or not open: a Verify routed judgement. */
  | { kind: "routeRejected"; otherTask: string }
  | { kind: "parkedAtCap" };

/** Why a verify is owed: a commit landed, a run went stale, a wait was released, or a decision closed a verify judgement. */
export type VerifyOwedCause = "commit" | "stale" | "released" | "decided";

export type VerifyState =
  | { kind: "notDue" }
  | { kind: "owed"; atHead: boolean; why: VerifyOwedCause }
  /** `line`: the `verify started` line. `stale`: a commit landed during the run. */
  | { kind: "running"; line: number; rerun: boolean; stale: boolean }
  /** `line`: the `verify started` line of the passing run. */
  | { kind: "passed"; line: number }
  /** `line`: the `verify started` line of the failing run. */
  | { kind: "failed"; line: number; disposition: VerifyDisposition }
  | { kind: "exit2Stop" }
  /** `droppedShas`: shas of the task's commits the git log does not have, named in the decide's reason. */
  | { kind: "exit3Decide"; droppedShas: string[] }
  | { kind: "unknownExit"; raw: number }
  | { kind: "passedByRoute" };

export type VerifyKind = VerifyState["kind"];

/** A review the task owes: its own, or a cascade re-review after a fix commit `sha7` of task `of`. */
export type ReviewDemand =
  | { kind: "own"; round?: number }
  | {
      kind: "cascade";
      sha7: string;
      round: number;
      of: string;
      /** `lineOwed`: the `cascade re-review owed` line is not written yet. */
      phase: "lineOwed" | "owed" | "dispatched" | "clean" | "findings";
    };

/** One code-reviewer per task at a time (FR-025); a done is attributed to the obligation the lane holds. */
export type ReviewLane = { kind: "free" } | { kind: "busy"; line: number; obligation: ReviewDemand };

export type ReviewLaneKind = ReviewLane["kind"];

export interface ReviewRegion {
  lane: ReviewLane;
  /** Owed and answered demands, oldest first; completion reads every cascade demand's phase. */
  demands: ReviewDemand[];
  /** The verdict of the latest own review since the cycle's `sinceCommit`. */
  ownVerdict: "none" | "clean" | "findings";
}

/** A failure another task's verify routed into this task. */
export interface RoutedIn {
  from: string;
  /** Ledger line of the `verify routed` note. */
  line: number;
  answered: boolean;
}

export interface TaskState {
  id: string;
  phase: TaskPhase;
  seats: Record<Seat, SeatSlot>;
  verify: VerifyState;
  review: ReviewRegion;
  routedIn: RoutedIn[];
  /** Open judgements, FIFO: one `decided` note closes the head only. */
  judgements: Judgement[];
  roundsUsed: number;
  reopened: boolean;
  /** The plan's inline flag, an inline note, or a `model=inline` dispatch. */
  inline: boolean;
  /** The task's commits, matched against the git log when it is non-empty. */
  commits: string[];
  /** The task's recorded shas the git log does not have. */
  droppedShas: string[];
}

/** An open, non-inline developer seat of a known task that is neither complete nor a decided unknown. */
export interface PoolSeat {
  task: string;
  /** Ledger line of the dispatch. */
  line: number;
  round?: number;
}

export interface World {
  inputs: LoopInputs;
  /** `liveCap()`'s output. */
  cap: Cap;
  contention: Contention;
  scan: "none" | "done";
  ceiling: "valid" | "invalidUndecided" | "ruled";
  /** Tasks the ledger names (an event's task, or a waits or routed note's other task) that the plan does not have. */
  unknown: Map<string, { decided: boolean }>;
  /** The only source of the In-flight list, of `free = n − |pool|`, and of resume (FR-024). */
  pool: PoolSeat[];
  /** Plan tasks, in plan order. */
  tasks: Map<string, TaskState>;
}

/**
 * An event the fold delivers to a task other than the line's owner, at the line's ledger position:
 * - `cascadeLanded`: a fix commit `sha7` of task `from` landed after its first own review, for a dependent open then;
 * - `routeAnswered`: the task `from`, a failure was routed to, passed, parked or completed;
 * - `routedIn`: task `from` routed its failure to this task;
 * - `watchReleased`: the task `from` a verify waits for got a named commit or completed;
 * - `ruling`: a `Ruling:` line naming this task.
 */
export type DeliveredEvent = EventBase &
  (
    | { type: "cascadeLanded"; task: string; sha7: string; from: string; round: number }
    | { type: "routeAnswered"; task: string; from: string }
    | { type: "routedIn"; task: string; from: string }
    | { type: "watchReleased"; task: string; from: string }
    | { type: "ruling"; task: string; text: string }
  );

export type MachineEvent = LedgerEvent | DeliveredEvent;

export type MachineEventType = MachineEvent["type"];

export type MachineEventOf<E extends MachineEventType> = Extract<MachineEvent, { type: E }>;

/** One (phase, event) cell of a region: a transition, or `noop` when the event changes nothing in that phase. */
export type RegionHandler<E extends MachineEventType> = (t: TaskState, e: MachineEventOf<E>, world: World) => TaskState;

export type RegionCell<E extends MachineEventType> = RegionHandler<E> | "noop";

export type RegionRow = { [E in MachineEventType]: RegionCell<E> };

/** Total over every (phase, event) pair; declare tables with `satisfies`, never `Partial`, so a missing cell fails tsc. */
export type RegionTable<K extends string> = { [P in K]: RegionRow };

/** Fields each judgement kind carries beyond its kind, task and opening line. */
export interface JudgementFields {
  conflictScan: Record<never, never>;
  seatStatus: { seat: Seat; status: GateStatus; doneLine: number };
  commitMissing: { dispatchLine: number };
  /** A stop: a changed file outside the task's Files. */
  verifyExit2: Record<never, never>;
  verifyExit3: { droppedShas: string[] };
  /** An exit outside 0–3. */
  verifyExit: { exit: number };
  /** A route to a task that is complete, unknown or not open. */
  verifyRouted: { otherTask: string };
  /** A stop: a verify waits for a task that can never release it. */
  verifyWaitsUnreleasable: { otherTask: string; why: string };
  breaker: Record<never, never>;
  breakerFixSpent: Record<never, never>;
  /** A stop: the five-round cap after a reopen. */
  capStop: Record<never, never>;
  capStopFixSpent: Record<never, never>;
  cascadeAtCapBreaker: { sha7: string };
  /** A stop: cascade findings at the cap of a reopened task. */
  cascadeAtCapStop: { sha7: string };
  invalidCeiling: { error: string };
  drift: { sha: string };
  unknownTask: Record<never, never>;
}

export type JudgementKind = keyof JudgementFields;

/** An open decide or stop the session or the human owes. `task` is absent for an item judgement. */
export type Judgement<K extends JudgementKind = JudgementKind> = K extends JudgementKind
  ? { kind: K; task?: string; openedAt: number | null } & JudgementFields[K]
  : never;

/**
 * Where a closed judgement leaves its task or the world; the owning region applies it.
 * `seatAsDone`: a seat closed by a decided note or a Ruling goes on as DONE (FR-014), so a developer then takes the
 * commit check and gets Commit missing when nothing is recorded. `afterDevDone`: the implementer resolves as after a
 * developer DONE with what the ledger now records.
 */
export type JudgementSuccessor =
  | "scanDone"
  | "seatRunning"
  | "seatAsDone"
  | "afterDevDone"
  | "verifyOwed"
  | "verifyRunning"
  | "verifyKept"
  | "parkedClosed"
  | "minimalFixOwed"
  | "complete"
  | "ceilingRuled"
  | "unknownDecided";

export interface JudgementEntry<K extends JudgementKind> {
  /** The decide's rule name; for a stop, the name it goes by in the judgement table. */
  rule: string;
  form: "decide" | "stop";
  /** The closes alternatives, one ledger-line template each, every one a line `kf record` accepts. */
  closes: string[];
  /** True when `e` closes `j`; `t` is the task before `e` (null for an item judgement). */
  close: (j: Judgement<K>, e: MachineEvent, t: TaskState | null) => boolean;
  /** Where `j` goes once `e` closed it. */
  successor: (j: Judgement<K>, e: MachineEvent) => JudgementSuccessor;
}

export type JudgementTable = { [K in JudgementKind]: JudgementEntry<K> };

/** What a wait waits for: its edge in the wait graph. */
export type WaitBlocker =
  | { kind: "task"; task: string }
  | { kind: "pool" }
  | { kind: "verify"; task: string }
  | { kind: "reviewer"; task: string };

interface IntentBase {
  task?: string;
  origin: IntentOrigin;
  /** The events that close this intent. */
  closes: MachineEventType[];
}

/** What a phase owes, before the arbiter applies the cap, holds, overlaps, the reviewer lane and rank. */
export type Intent = IntentBase &
  (
    | { kind: "act"; action: Extract<Action, { kind: "dispatch" | "verify" | "write" | "complete" }> }
    | { kind: "judge"; judgement: JudgementKind; action: Extract<Action, { kind: "decide" | "stop" }> }
    | { kind: "inFlight"; entry: InFlight }
    | { kind: "wait"; action: Extract<Action, { kind: "wait" }>; blockedBy: WaitBlocker }
  );

export type IntentKind = Intent["kind"];

/** The arbiter's output: each intent mapped to exactly one action, In-flight entry or wait with its blocker. */
export interface Arbitration {
  /** Ranked as `NextResult.actions`. */
  actions: Action[];
  inFlight: InFlight[];
  /** The blocker of every wait in `actions`, by the same object. */
  waits: { wait: Extract<Action, { kind: "wait" }>; blockedBy: WaitBlocker }[];
}
