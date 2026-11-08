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
