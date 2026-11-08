import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import type { Action, InFlight, LedgerEvent, LedgerState, LoopInputs, LoopTask, NextResult, Seat, TestType } from "../workflow/next/types.js";
import { ensureWorksStructure } from "../workflow/features.js";
import type { Feature } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

type Schedule = (state: LedgerState, inputs: LoopInputs, opts: { resume: boolean }) => NextResult;

// Imported per test rather than at the top so the CLI tests below run and report on their own
// when the scheduler module cannot be loaded.
async function loadSchedule(): Promise<Schedule> {
  const mod = await import("../workflow/next/schedule.js");
  return mod.schedule;
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const KF = join(PKG_ROOT, "dist", "index.js");

// ---------------------------------------------------------------------------
// Ledger and plan literals
// ---------------------------------------------------------------------------

type Fields = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;

const T0 = Date.parse("2026-11-07T03:00:00Z");
const tsAt = (i: number): number => T0 + i * 60_000;

function stateOf(events: Fields[]): LedgerState {
  return { events: events.map((e, i) => ({ ...e, line: i + 2, ts: tsAt(i) }) as LedgerEvent) };
}

const scan: Fields = { type: "scan", clean: true };
const capStart = (n: number): Fields => ({ type: "capRuling", from: null, to: n, cause: { kind: "start" } });
const other = (text: string, task?: string): Fields => ({ type: "other", text, ...(task ? { task } : {}) });
const dispatched = (task: string, seat: Seat, extra: { model?: string; round?: number } = {}): Fields => ({
  type: "dispatched",
  task,
  seat,
  model: extra.model ?? "sonnet",
  ...(extra.round !== undefined ? { round: extra.round } : {}),
});
const done = (task: string, seat: Seat, status = "DONE"): Fields => ({ type: "done", task, seat, status });
const hashes = (task: string): Fields => ({ type: "testHashes", task, files: { [`src/tests/${task.toLowerCase()}.test.ts`]: "a".repeat(40) } });
const commits = (task: string, ...shas: string[]): Fields => ({ type: "commits", task, shas });
const reviewPackage = (task: string, ...shas: string[]): Fields => ({ type: "reviewPackage", task, shas });
const verifyStarted = (task: string): Fields => ({ type: "verifyStarted", task });
const verifyDone = (task: string, exit: number): Fields => ({ type: "verifyDone", task, exit });
const complete = (task: string, text: string): Fields => ({ type: "complete", task, text });
const reopened = (task: string): Fields => ({ type: "reopened", task, source: "review", execution: "1a2b3c4d" });
const parked = (task: string, finding: string): Fields => ({ type: "parked", task, finding });
const decided = (task: string, what: string): Fields => ({ type: "decided", task, what });
const fixRound = (task: string, round: number): Fields => ({ type: "fixRound", task, round });
const noStepUp = (wave: number, reason: string): Fields => ({ type: "noStepUp", wave, reason });

/** A task whose test-writer finished and whose test hashes are recorded. */
const testsReady = (task: string): Fields[] => [dispatched(task, "test-writer"), done(task, "test-writer"), hashes(task)];

/** Developer done with one commit, its review package, a verify and a review dispatched. */
const committedAndUnderReview = (task: string, sha: string): Fields[] => [
  dispatched(task, "developer"),
  done(task, "developer"),
  commits(task, sha),
  reviewPackage(task, sha),
  verifyStarted(task),
  dispatched(task, "code-reviewer"),
];

/** Fix rounds 1..5 of `task`, each with a commit, a passing verify and a review that still has findings. */
function fiveRoundsWithFindings(task: string, shaPrefix: string): Fields[] {
  const events: Fields[] = [];
  for (let r = 1; r <= 5; r++) {
    const sha = `${shaPrefix}${r}`;
    events.push(
      dispatched(task, "developer", { round: r }),
      done(task, "developer"),
      commits(task, sha),
      reviewPackage(task, sha),
      verifyStarted(task),
      dispatched(task, "code-reviewer", { round: r }),
      verifyDone(task, 0),
      done(task, "code-reviewer", "findings"),
      fixRound(task, r),
    );
  }
  return events;
}

function task(id: string, over: Partial<LoopTask> = {}): LoopTask {
  return {
    id,
    dependencies: [],
    files: [`src/${id.toLowerCase()}.ts`],
    wave: 1,
    overlaps: [],
    inline: false,
    testTypes: ["Unit"] as TestType[],
    ...over,
  };
}

function inputsOf(tasks: LoopTask[], over: Partial<LoopInputs> = {}): LoopInputs {
  return {
    feature: "feat",
    kind: "feature",
    level: "standard",
    tasks,
    ceiling: { max: 4, source: "config" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
    ...over,
  };
}

type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Decide = Extract<Action, { kind: "decide" }>;

const dispatchesOf = (actions: Action[], taskId: string, seat?: Seat): Dispatch[] =>
  actions.filter((a): a is Dispatch => a.kind === "dispatch" && a.task === taskId && (seat === undefined || a.seat === seat));
const decidesOf = (actions: Action[], rule: string): Decide[] => actions.filter((a): a is Decide => a.kind === "decide" && a.rule === rule);
const completedIn = (actions: Action[]): string[] =>
  actions.flatMap((a) => (a.kind === "complete" ? [a.task] : []));
const verifiesOf = (actions: Action[], taskId: string) => actions.filter((a) => a.kind === "verify" && a.task === taskId);

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

describe("schedule: completion", () => {
  it("completes a routed, a parked and a clean task, and not one whose dependency is incomplete", async () => {
    const schedule = await loadSchedule();
    const events: Fields[] = [
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      ...testsReady("TASK-003"),
      ...testsReady("TASK-004"),
      ...testsReady("TASK-005"),
      ...testsReady("TASK-006"),
      // TASK-002 is the task TASK-001's failure is routed to; its own review is still running.
      ...committedAndUnderReview("TASK-002", "bbb0002"),
      // Routed: TASK-001's failing verify goes to TASK-002, whose next verify passes.
      ...committedAndUnderReview("TASK-001", "aaa0001"),
      verifyDone("TASK-001", 1),
      done("TASK-001", "code-reviewer", "clean"),
      { type: "verifyRouted", task: "TASK-001", otherTask: "TASK-002" },
      verifyDone("TASK-002", 0),
      // Parked: never reopened, round 5 leaves findings, the breaker parks them and records its decision.
      ...committedAndUnderReview("TASK-003", "ccc0000"),
      verifyDone("TASK-003", 0),
      done("TASK-003", "code-reviewer", "findings"),
      ...fiveRoundsWithFindings("TASK-003", "ccc000"),
      parked("TASK-003", "naming of the helper"),
      decided("TASK-003", "breaker: findings parked at the cap"),
      // Clean.
      ...committedAndUnderReview("TASK-004", "ddd0004"),
      verifyDone("TASK-004", 0),
      done("TASK-004", "code-reviewer", "clean"),
      // TASK-005 is done in every way, but its dependency TASK-006 is not complete (review running).
      ...committedAndUnderReview("TASK-006", "fff0006"),
      verifyDone("TASK-006", 0),
      ...committedAndUnderReview("TASK-005", "eee0005"),
      verifyDone("TASK-005", 0),
      done("TASK-005", "code-reviewer", "clean"),
    ];
    const state = stateOf(events);
    const routedStart = state.events.find((e) => e.type === "verifyStarted" && e.task === "TASK-001")!;
    const inputs = inputsOf(
      [
        task("TASK-001"),
        task("TASK-002"),
        task("TASK-003"),
        task("TASK-004"),
        task("TASK-005", { dependencies: ["TASK-006"], wave: 2 }),
        task("TASK-006"),
      ],
      { verifyRuns: { "TASK-001": [{ ts: routedStart.ts + 30_000, exit: 1, text: "FAIL src/tests/task-002.test.ts\nAssertionError: expected 2 to be 3" }] } },
    );

    const completed = completedIn(schedule(state, inputs, { resume: false }).actions);

    expect(completed).toContain("TASK-001");
    expect(completed).toContain("TASK-003");
    expect(completed).toContain("TASK-004");
    expect(completed).not.toContain("TASK-005");
  });

  it("prints finished when every task is complete, a superseded one and an implemented one included", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      complete("TASK-001", "commits aaa0001, review clean"),
      complete("TASK-002", "commits bbb0002, review clean"),
      reopened("TASK-002"),
      { type: "capReached", task: "TASK-002", failure: "the login test still fails" },
      complete("TASK-002", "commits bbb0002, superseded by contract"),
      { type: "implemented", task: "TASK-003" },
      noStepUp(1, "last wave"),
    ]);
    const inputs = inputsOf([task("TASK-001"), task("TASK-002"), task("TASK-003")]);

    expect(schedule(state, inputs, { resume: false }).actions).toEqual([{ kind: "finished" }]);
  });

  it("ignores a complete line written before the task's latest reopened note", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...committedAndUnderReview("TASK-001", "aaa0001"),
      verifyDone("TASK-001", 0),
      done("TASK-001", "code-reviewer", "clean"),
      complete("TASK-001", "commits aaa0001, review clean"),
      noStepUp(1, "inline"),
      ...testsReady("TASK-002"),
      ...committedAndUnderReview("TASK-002", "bbb0002"),
      verifyDone("TASK-002", 0),
      done("TASK-002", "code-reviewer", "clean"),
      reopened("TASK-001"),
    ]);
    const inputs = inputsOf([task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"], wave: 2 })]);

    const { actions } = schedule(state, inputs, { resume: false });

    // TASK-001's old complete line no longer counts, so its dependent cannot complete and the item is not finished.
    expect(completedIn(actions)).not.toContain("TASK-002");
    expect(actions.some((a) => a.kind === "finished")).toBe(false);
  });

  it("never completes a reopened task by parking its findings", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...committedAndUnderReview("TASK-001", "aaa0000"),
      verifyDone("TASK-001", 0),
      done("TASK-001", "code-reviewer", "clean"),
      complete("TASK-001", "commits aaa0000, review clean"),
      noStepUp(1, "inline"),
      reopened("TASK-001"),
      ...fiveRoundsWithFindings("TASK-001", "aaa000"),
      parked("TASK-001", "the retry loop is unbounded"),
      decided("TASK-001", "findings parked at the cap"),
    ]);
    const inputs = inputsOf([task("TASK-001")]);

    const { actions } = schedule(state, inputs, { resume: false });

    expect(completedIn(actions)).not.toContain("TASK-001");
    expect(actions.some((a) => a.kind === "finished")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resume, in flight and drift
// ---------------------------------------------------------------------------

describe("schedule: open seats with and without --resume", () => {
  const tasks = [task("TASK-001"), task("TASK-002")];
  const events: Fields[] = [
    scan,
    capStart(2),
    other("wave 1: parallel test-writers TASK-001, TASK-002 — disjoint Files"),
    // An honest orphan: this dispatch has no done, but a later dispatch of the same seat does.
    dispatched("TASK-001", "test-writer"),
    dispatched("TASK-001", "test-writer"),
    done("TASK-001", "test-writer"),
    hashes("TASK-001"),
    // A seat with no done.
    dispatched("TASK-002", "test-writer"),
  ];

  it("lists a seat with no done for re-dispatch with resume, and never the honest orphan", async () => {
    const schedule = await loadSchedule();
    const result = schedule(stateOf(events), inputsOf(tasks), { resume: true });

    expect(dispatchesOf(result.actions, "TASK-002", "test-writer")).toEqual([{ kind: "dispatch", task: "TASK-002", seat: "test-writer", mode: "new" }]);
    expect(dispatchesOf(result.actions, "TASK-001", "test-writer")).toEqual([]);
    expect(result.inFlight.filter((f) => f.task === "TASK-001" && f.seat === "test-writer")).toEqual([]);
  });

  it("reads a seat with no done as in flight without resume, and never the honest orphan", async () => {
    const schedule = await loadSchedule();
    const result = schedule(stateOf(events), inputsOf(tasks), { resume: false });

    expect(result.inFlight).toContainEqual({ task: "TASK-002", seat: "test-writer" });
    expect(dispatchesOf(result.actions, "TASK-002", "test-writer")).toEqual([]);
    expect(result.inFlight.filter((f) => f.task === "TASK-001" && f.seat === "test-writer")).toEqual([]);
    expect(dispatchesOf(result.actions, "TASK-001", "test-writer")).toEqual([]);
  });

  it("on resume lists every lost developer above N, keeps a pending re-run held and resumes an inline task without a spawn", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      other("wave 1: parallel test-writers TASK-001, TASK-002, TASK-003 — disjoint Files"),
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      ...testsReady("TASK-003"),
      dispatched("TASK-003", "developer"),
      done("TASK-003", "developer"),
      commits("TASK-003", "ccc0003"),
      dispatched("TASK-001", "developer"),
      dispatched("TASK-002", "developer"),
      reviewPackage("TASK-003", "ccc0003"),
      verifyStarted("TASK-003"),
      dispatched("TASK-003", "code-reviewer"),
      verifyDone("TASK-003", 1),
      // The contention step-down leaves N = 1 with two developers lost in flight.
      { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-003" } },
      { type: "verifyRerun", task: "TASK-003", signature: "EADDRINUSE" },
      // The re-run was started and lost: an open re-run verify.
      verifyStarted("TASK-003"),
      ...testsReady("TASK-004"),
      dispatched("TASK-004", "developer", { model: "inline" }),
      { type: "inline", task: "TASK-004" },
    ]);
    const firstVerify = state.events.find((e) => e.type === "verifyStarted" && e.task === "TASK-003")!;
    const inputs = inputsOf(
      [task("TASK-001"), task("TASK-002"), task("TASK-003"), task("TASK-004", { wave: 2, inline: true })],
      { verifyRuns: { "TASK-003": [{ ts: firstVerify.ts + 30_000, exit: 1, text: "Error: listen EADDRINUSE: address already in use :::3000" }] } },
    );

    const { actions } = schedule(state, inputs, { resume: true });

    expect(dispatchesOf(actions, "TASK-001", "developer")).toHaveLength(1);
    expect(dispatchesOf(actions, "TASK-002", "developer")).toHaveLength(1);
    expect(dispatchesOf(actions, "TASK-001", "developer")[0].inline).toBeFalsy();
    expect(dispatchesOf(actions, "TASK-002", "developer")[0].inline).toBeFalsy();
    expect(verifiesOf(actions, "TASK-003")).toEqual([]);
    expect(dispatchesOf(actions, "TASK-004", "developer")).toEqual([
      { kind: "dispatch", task: "TASK-004", seat: "developer", mode: "resume", inline: true },
    ]);
  });
});

describe("schedule: drift between the report and the ledger", () => {
  const events: Fields[] = [
    scan,
    capStart(2),
    other("wave 1: parallel test-writers TASK-001, TASK-002 — disjoint Files"),
    ...testsReady("TASK-001"),
    dispatched("TASK-001", "developer"),
  ];
  const state = stateOf(events);
  const dispatchTs = state.events[state.events.length - 1].ts;
  const sha = `abc1234${"0".repeat(33)}`;
  const withCommitAt = (ts: number): LoopInputs =>
    inputsOf([task("TASK-001"), task("TASK-002")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: [{ sha, ts }] });

  it("gives a drift decide instead of a re-dispatch on resume when the report names a commit newer than the dispatch", async () => {
    const schedule = await loadSchedule();
    const { actions } = schedule(state, withCommitAt(dispatchTs + 5 * 60_000), { resume: true });

    const drift = decidesOf(actions, "Drift");
    expect(drift).toHaveLength(1);
    expect(drift[0].task).toBe("TASK-001");
    expect(drift[0].closes).toBe("TASK-001: developer done status=DONE");
    expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([]);
  });

  it("keeps the seat in flight with a hint, and no decide, without resume", async () => {
    const schedule = await loadSchedule();
    const result = schedule(state, withCommitAt(dispatchTs + 5 * 60_000), { resume: false });

    expect(decidesOf(result.actions, "Drift")).toEqual([]);
    expect(result.inFlight).toContainEqual<InFlight>({ task: "TASK-001", seat: "developer", hint: "report names commit abc1234 after the dispatch" });
  });

  it("re-dispatches the developer on resume when the report's commit is older than the dispatch", async () => {
    const schedule = await loadSchedule();
    const { actions } = schedule(state, withCommitAt(dispatchTs - 5 * 60_000), { resume: true });

    expect(decidesOf(actions, "Drift")).toEqual([]);
    expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([{ kind: "dispatch", task: "TASK-001", seat: "developer", mode: "new" }]);
  });
});

// ---------------------------------------------------------------------------
// A bug's tasks and a ledger task the plan lost
// ---------------------------------------------------------------------------

describe("schedule: a bug's tasks", () => {
  // As the input reader gives a bug: file order, Files unknown, each overlapping the other; only `regression` has a Unit type.
  const tasks: LoopTask[] = [
    task("TASK-001", { files: null, overlaps: ["TASK-002"], testTypes: [] }),
    task("TASK-002", { files: null, overlaps: ["TASK-001"], testTypes: ["Unit"] }),
  ];
  const inputs = inputsOf(tasks, { kind: "bug", level: "unit" });
  const start: Fields[] = [scan, capStart(2)];
  const fixOnly: Fields = { type: "noTestWriter", task: "TASK-001", reason: "fix only; the regression task tests it" };

  it("owes the fix task a no test-writer line and opens nothing of the regression task while the fix task is incomplete", async () => {
    const schedule = await loadSchedule();
    const { actions } = schedule(stateOf(start), inputs, { resume: false });

    expect(actions.some((a) => a.kind === "write" && a.line === "TASK-001: no test-writer — <why>")).toBe(true);
    expect(dispatchesOf(actions, "TASK-001", "test-writer")).toEqual([]);
    expect(dispatchesOf(actions, "TASK-002")).toEqual([]);
  });

  it("dispatches the fix task's developer first and still holds the regression task", async () => {
    const schedule = await loadSchedule();
    const { actions } = schedule(stateOf([...start, fixOnly]), inputs, { resume: false });

    expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([{ kind: "dispatch", task: "TASK-001", seat: "developer", mode: "new" }]);
    expect(dispatchesOf(actions, "TASK-002")).toEqual([]);
  });

  it("gives the regression task a test-writer once the fix task is complete, and never the fix task", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      ...start,
      fixOnly,
      ...committedAndUnderReview("TASK-001", "aaa0001"),
      verifyDone("TASK-001", 0),
      done("TASK-001", "code-reviewer", "clean"),
      complete("TASK-001", "commits aaa0001, review clean"),
    ]);

    const { actions } = schedule(state, inputs, { resume: false });

    expect(dispatchesOf(actions, "TASK-002", "test-writer")).toEqual([{ kind: "dispatch", task: "TASK-002", seat: "test-writer", mode: "new" }]);
    expect(dispatchesOf(actions, "TASK-001", "test-writer")).toEqual([]);
  });
});

describe("schedule: a ledger task the plan no longer has", () => {
  it("gives an Unknown task decide naming it and no seat for it", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([scan, capStart(2), dispatched("TASK-009", "test-writer")]);

    const { actions } = schedule(state, inputsOf([task("TASK-001")]), { resume: false });

    const unknown = decidesOf(actions, "Unknown task");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].task).toBe("TASK-009");
    expect(unknown[0].closes).toBe("Note TASK-009: decided — <what>");
    expect(dispatchesOf(actions, "TASK-009")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fixture set and the replay (through the real readers)
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };

function writeConfig(root: string, harnessExtra: Record<string, unknown> = {}): void {
  mkdirSync(join(root, ".kf"), { recursive: true });
  writeFileSync(
    join(root, ".kf", "config.json"),
    JSON.stringify({
      schema: "kanban-flow",
      created: "20261107_1200",
      defaultContext: "app",
      harness: {
        main: "lead",
        roles: { lead: { runner: "claude" }, coder: { runner: "claude" } },
        stages: { implementation: ["coder"] },
        runners: { claude: { start: ["claude", "{prompt}"] } },
        ...harnessExtra,
      },
    }),
  );
}

/** Copies a fixture case into a temp item folder outside any git repository: the readers see no history. */
function loadCase(name: string): { root: string; feature: Feature; ledger: string } {
  const root = join(scratch("kf-next-fixture-"), "repo");
  const dir = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(dir, { recursive: true });
  writeConfig(root);
  cpSync(join(FIXTURES, name), dir, { recursive: true });
  const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir, folder: ITEM_FOLDER, meta: META };
  return { root, feature, ledger: readFileSync(join(dir, "loop", "progress.md"), "utf8") };
}

function inputsFor(root: string, feature: Feature): LoopInputs {
  const read = readLoopInputs(root, feature);
  if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);
  return read.inputs;
}

function ledgerState(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`fixture ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

/**
 * The comparable part of an action: a decide's `reason` is free prose and is not compared; a `closes` or a write's
 * `task` is compared when the expected file names it. Everything else is compared exactly.
 */
function comparable(actual: Action, expected: Record<string, unknown>): unknown {
  if (actual.kind === "decide" && expected.kind === "decide") {
    return { kind: actual.kind, task: actual.task, rule: actual.rule, ...("closes" in expected ? { closes: actual.closes } : {}) };
  }
  if (actual.kind === "write" && expected.kind === "write") {
    return { kind: actual.kind, ...("task" in expected ? { task: actual.task } : {}), line: actual.line, record: actual.record };
  }
  return actual;
}

const byTaskSeat = (a: InFlight, b: InFlight): number => `${a.task} ${a.seat}`.localeCompare(`${b.task} ${b.seat}`);

const FIXTURE_CASES = ["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"];

describe("schedule: the fixture set", () => {
  it.each(FIXTURE_CASES)("gives the expected actions for the %s ledger", async (name) => {
    const schedule = await loadSchedule();
    const { root, feature, ledger } = loadCase(name);
    const { resume = false, ...expected } = JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8")) as {
      resume?: boolean;
      n: number;
      inFlight: InFlight[];
      actions: Record<string, unknown>[];
    };

    const result = schedule(ledgerState(ledger), inputsFor(root, feature), { resume });

    expect(result.n).toBe(expected.n);
    expect([...result.inFlight].sort(byTaskSeat)).toEqual([...expected.inFlight].sort(byTaskSeat));
    expect(result.actions.map((a, i) => comparable(a, expected.actions[i] ?? {}))).toEqual(expected.actions);
  });
});

interface Deviation {
  line: number;
  why: string;
}

// Each entry is a dispatch the old loop made that the rules of `kf:implement` at 543cd17 did not call for at that
// point of the ledger; its `why` quotes the rule. A port defect is never listed here; it is fixed in the code.
const ROUND_SEAT_CHOICE =
  "§ 3.4: \"Findings about a test go to the test-writer\" — which seat a finding needs is the controller's reading of the review, not a ledger fact, so the rules call for no test-writer round seat at this prefix";
const REPLAY_DEVIATIONS: Deviation[] = [
  {
    line: 32,
    why: "§ Order and parallelism: \"a worktree runs at most the live cap N developer seats at once\", and § The live cap: \"Before the first developer dispatch the loop sets N = min(2, harness.developers.max)\" — TASK-001 (line 17) and TASK-002 (line 25) already fill N = 2; the old loop ran the whole wave",
  },
  { line: 33, why: "As line 32: a fourth developer in flight (TASK-001, TASK-002, TASK-003) above the live cap N = 2" },
  { line: 82, why: `TASK-007 round 1. ${ROUND_SEAT_CHOICE}` },
  { line: 97, why: `TASK-002 round 1. ${ROUND_SEAT_CHOICE}` },
  {
    line: 105,
    why: "§ 3.2: \"DONE_WITH_CONCERNS → read the concerns; correctness or scope concerns are addressed before review\" — TASK-002's developer ended DONE_WITH_CONCERNS on line 102 and the old loop dispatched the re-review with no ruling or decided note after it",
  },
  { line: 110, why: `TASK-002 round 2. ${ROUND_SEAT_CHOICE}` },
  {
    line: 111,
    why: "§ Contention: \"(3) dispatches no developer, and holds the re-run, until fewer than N developer seats are in flight\" and \"no developer, a fix round's included, starts until the last held re-run has finished\" — the re-run noted on line 107 starts only on line 112",
  },
  {
    line: 122,
    why: "§ Test-writers ahead: \"A test-writer never writes a file inside another open task's Files: one whose task overlaps an open task … waits for that task's complete line\" — TASK-005 overlaps TASK-002 (skills/implement/SKILL.md), complete only on line 128",
  },
  {
    line: 123,
    why: "§ Order and parallelism: \"A task's developer is dispatched only under the three dispatch conditions: … the task's test-writer is done and its test hashes are ledgered; and its Files overlap no open task\" — TASK-005's tests are hashed on line 134 and TASK-002 stays open until line 128; the old loop ran lanes by the Ruling on line 120",
  },
  { line: 124, why: "As line 123: a second lane of TASK-005's developer before its tests and while TASK-002 is open" },
  { line: 125, why: "As line 123: a third lane of TASK-005's developer before its tests and while TASK-002 is open" },
];

describe("schedule: replay of the adaptive-developer-cap ledger", () => {
  it("dispatches, at every prefix, each seat the old loop dispatched next, except the listed deviations", async () => {
    const schedule = await loadSchedule();
    const { root, feature, ledger } = loadCase("replay-adaptive-cap");
    const inputs = inputsFor(root, feature);
    const lines = ledger.split("\n");
    const deviations = new Map(REPLAY_DEVIATIONS.map((d) => [d.line, d]));
    const missed: string[] = [];
    const stale: string[] = [];

    lines.forEach((text, i) => {
      const m = /^(TASK-\d+): (test-writer|developer|code-reviewer) dispatched /.exec(text);
      if (!m) return;
      const line = i + 1;
      const [, taskId, seat] = m;
      const prefix = ledgerState(lines.slice(0, i).join("\n"));
      const { actions } = schedule(prefix, inputs, { resume: false });
      const dispatchedNow = dispatchesOf(actions, taskId, seat as Seat).length > 0;
      const deviation = deviations.get(line);
      if (deviation === undefined) {
        if (!dispatchedNow) missed.push(`line ${line}: ${text} — got ${JSON.stringify(actions)}`);
        return;
      }
      if (dispatchedNow) stale.push(`line ${line}: ${text} — got ${JSON.stringify(actions)}`);
    });

    expect(missed).toEqual([]);
    expect(stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The built `kf next` command
// ---------------------------------------------------------------------------

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

interface Repo {
  scratch: string;
  root: string;
  item: string;
}

function makeRepo(opts: { git?: boolean; harness?: Record<string, unknown>; fixture?: string } = {}): Repo {
  const base = scratch("kf-next-cli-");
  const root = join(base, "repo");
  mkdirSync(root, { recursive: true });
  if (opts.git) {
    gitIn(root, "init", "-q");
    gitIn(root, "config", "user.email", "t@t");
    gitIn(root, "config", "user.name", "t");
    writeFileSync(join(root, ".gitignore"), ".works/\n.worktrees/\n");
    gitIn(root, "add", "-A");
    gitIn(root, "commit", "-qm", "init");
  }
  ensureWorksStructure(root);
  writeConfig(root, opts.harness);
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(join(item, "loop"), { recursive: true });
  if (opts.fixture) cpSync(join(FIXTURES, opts.fixture), item, { recursive: true });
  writeFileSync(join(item, ".kfw.json"), `${JSON.stringify(META, null, 2)}\n`);
  return { scratch: base, root, item };
}

function kf(repo: Repo, ...argv: string[]): { code: number; stdout: string; stderr: string; ms: number } {
  const started = performance.now();
  const r = spawnSync(process.execPath, [KF, ...argv], { cwd: repo.root, encoding: "utf8", env: process.env });
  const ms = performance.now() - started;
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr, ms };
}

/** Where an action's line starts in the text output, searching from `from`; -1 when absent. */
function findActionLine(lines: string[], a: Action, from: number): number {
  const matches = (l: string): boolean => {
    switch (a.kind) {
      case "dispatch":
        return (
          l.startsWith(`dispatch ${a.seat} ${a.task}`) &&
          (a.round === undefined || l.includes(` round=${a.round}`)) &&
          (a.cascade === undefined || l.includes(` cascade=${a.cascade}`)) &&
          (!a.inline || l.includes(" inline"))
        );
      case "verify":
        return l === `verify ${a.task}: ${a.command}`;
      case "write":
        return l === `write: ${a.line}`;
      case "complete":
        return l === `complete ${a.task}`;
      case "wait":
        return l === `wait ${a.task}: ${a.reason}`;
      case "decide":
        return l === `decide${a.task ? ` ${a.task}` : ""} (${a.rule}): ${a.reason} — closes with ${a.closes}`;
      case "stop":
        return l === `stop${a.task ? ` ${a.task}` : ""}: ${a.reason}`;
      case "finished":
        return l === "finished";
    }
  };
  for (let i = from; i < lines.length; i++) if (matches(lines[i])) return i;
  return -1;
}

function filesWithMtimes(dir: string, skip: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      if (skip.has(path)) continue;
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else out[path] = st.mtimeMs;
    }
  };
  walk(dir);
  return out;
}

describe("kf next on a repository", () => {
  it("prints the same actions as text and as JSON, the JSON holding feature, n and actions", () => {
    const repo = makeRepo({ git: true, fixture: "contention" });

    const text = kf(repo, "next", "demo");
    const json = kf(repo, "next", "demo", "--json");

    expect(json.code).toBe(0);
    expect(text.code).toBe(0);
    const result = JSON.parse(json.stdout) as NextResult;
    expect(result.feature).toBe("demo");
    expect(typeof result.n).toBe("number");
    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);

    const lines = text.stdout.split("\n");
    let at = 0;
    for (const action of result.actions) {
      const found = findActionLine(lines, action, at);
      expect(found, `text line for ${JSON.stringify(action)}`).toBeGreaterThanOrEqual(0);
      if (action.kind === "write") expect(lines[found + 1]).toBe(`  ${action.record}`);
      at = found + 1;
    }
    const inFlightAt = lines.indexOf("In flight:", at);
    expect(inFlightAt).toBeGreaterThanOrEqual(0);
    const flightLines = lines.slice(inFlightAt + 1);
    for (const f of result.inFlight) {
      expect(flightLines.some((l) => l.includes(f.task) && l.includes(f.seat)), `in-flight line for ${f.task} ${f.seat}`).toBe(true);
    }
  });

  it("prints identical output twice, changes no file and leaves no process behind", () => {
    const repo = makeRepo({ git: true, fixture: "mid-wave" });
    const before = filesWithMtimes(repo.root, new Set([join(repo.root, ".git")]));

    const first = kf(repo, "next", "demo");
    const second = kf(repo, "next", "demo");

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(second.stdout).toBe(first.stdout);
    expect(filesWithMtimes(repo.root, new Set([join(repo.root, ".git")]))).toEqual(before);
    const left = execFileSync("ps", ["-A", "-o", "command="], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.includes(repo.scratch));
    expect(left).toEqual([]);
  });

  it("schedules a 1,000-line ledger in under a second (median of three runs)", () => {
    const repo = makeRepo({ git: true });
    const count = 80;
    const ids = Array.from({ length: count }, (_, i) => `TASK-${String(i + 1).padStart(3, "0")}`);
    const rows = ids.map((id) => `| ${id} | Do ${id} | Core | - | done | FR-001 | src/${id.toLowerCase()}.ts |`);
    writeFileSync(
      join(repo.item, "phase-2-implementation-plan.md"),
      `# Implementation Plan\n\n## Task Breakdown\n\n| Task | Description | Area | Dependencies | Expected output | FR / UC references | Files |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}\n`,
    );
    writeFileSync(
      join(repo.item, "phase-2-test-case.md"),
      "# Test Plan\n\n## TC-001\n\n| Field | Detail |\n|---|---|\n| Test case ID | TC-001 |\n| Requirement reference | FR-001 |\n| Test type | Unit |\n| Expected outcome | every task works |\n",
    );
    const body: string[] = ["Scan: clean", "Ruling: developer cap 2 — start — cost if wrong: a slow start"];
    ids.forEach((id, i) => {
      const sha = (0xa000000 + i).toString(16);
      body.push(
        `${id}: test-writer dispatched model=sonnet`,
        `${id}: test-writer done status=DONE`,
        `${id}: test hashes src/tests/${id.toLowerCase()}.test.ts=${"a".repeat(40)}`,
        `${id}: developer dispatched model=sonnet`,
        `${id}: developer done status=DONE`,
        `Note ${id}: commits ${sha}`,
        `${id}: review package ${sha}`,
        `${id}: verify started`,
        `${id}: code-reviewer dispatched model=sonnet`,
        `${id}: verify done exit=0`,
        `${id}: code-reviewer done status=clean`,
        `${id}: complete (commits ${sha}, review clean)`,
      );
    });
    while (body.length < 999) body.push(`TASK-001: minor (deferred): note ${body.length}`);
    const stamped = body.map((l, i) => `${l} @ ${new Date(T0 + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")}`);
    const ledger = [`# Task loop ledger — demo — plan: ${join(repo.item, "phase-2-implementation-plan.md")}`, ...stamped].join("\n");
    expect(ledger.split("\n")).toHaveLength(1000);
    writeFileSync(join(repo.item, "loop", "progress.md"), `${ledger}\n`);

    const runs = [kf(repo, "next", "demo"), kf(repo, "next", "demo"), kf(repo, "next", "demo")];

    for (const r of runs) expect(r.code, r.stdout + r.stderr).toBe(0);
    const median = runs.map((r) => r.ms).sort((a, b) => a - b)[1];
    expect(median).toBeLessThan(1000);
  });
});

describe("kf next refusals and edge cases", () => {
  const PLAN_HEAD =
    "# Implementation Plan\n\n## Task Breakdown\n\n| Task | Description | Area | Dependencies | Expected output | FR / UC references | Files |\n|---|---|---|---|---|---|---|\n";

  it("exits 1 with the kf tasks message for an invalid task graph", () => {
    const repo = makeRepo({ git: true });
    writeFileSync(
      join(repo.item, "phase-2-implementation-plan.md"),
      `${PLAN_HEAD}| TASK-001 | A | Core | TASK-002 | a | FR-001 | src/a.ts |\n| TASK-002 | B | Core | TASK-001 | b | FR-001 | src/b.ts |\n`,
    );
    const tasks = kf(repo, "tasks", "demo");
    expect(tasks.code).toBe(1);

    const res = kf(repo, "next", "demo");

    expect(res.code).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain(tasks.stdout.trim());
  });

  it("exits 1 with the kf tasks message for a bad harness.developers value", () => {
    const repo = makeRepo({ git: true, fixture: "mid-wave", harness: { developers: { max: 99 } } });
    const tasks = kf(repo, "tasks", "demo", "--json");
    expect(tasks.code).toBe(1);

    const res = kf(repo, "next", "demo");

    expect(res.code).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain(tasks.stdout.trim());
  });

  it("exits 1 for a plan with no tasks", () => {
    const repo = makeRepo({ git: true });
    writeFileSync(join(repo.item, "phase-2-implementation-plan.md"), PLAN_HEAD);

    const res = kf(repo, "next", "demo");

    expect(res.code).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("no planned tasks");
  });

  it("prints a decide for a ledger task the plan lost", () => {
    const repo = makeRepo({ git: true, fixture: "mid-wave" });
    const ledgerPath = join(repo.item, "loop", "progress.md");
    writeFileSync(ledgerPath, `${readFileSync(ledgerPath, "utf8")}TASK-009: test-writer dispatched model=sonnet @ 2026-11-07T11:00:00+07:00\n`);

    const res = kf(repo, "next", "demo");

    expect(res.code).toBe(0);
    expect(res.stdout.split("\n").some((l) => l.startsWith("decide TASK-009 (Unknown task): "))).toBe(true);
  });

  it("reads commits from the item's branch when a worktree item is run from the main checkout", () => {
    const repo = makeRepo({ git: true, fixture: "mid-wave" });
    const wtPath = join(repo.root, ".worktrees", "demo");
    gitIn(repo.root, "worktree", "add", "-q", "-b", "feat/demo", wtPath);
    writeFileSync(join(wtPath, "a.ts"), "export const a = 1;\n");
    gitIn(wtPath, "add", "a.ts");
    // Dated after TASK-001's developer dispatch in the ledger (10:09 +07:00).
    execFileSync("git", ["-C", wtPath, "commit", "-qm", "TASK-001: a"], {
      env: { ...process.env, GIT_COMMITTER_DATE: "2026-11-07T11:00:00+07:00", GIT_AUTHOR_DATE: "2026-11-07T11:00:00+07:00" },
    });
    const sha7 = gitIn(wtPath, "rev-parse", "--short=7", "HEAD");
    writeFileSync(
      join(repo.item, ".kfw.json"),
      `${JSON.stringify({ ...META, worktree: { path: wtPath, branch: "feat/demo", domain: "demo.localhost", port: 3000, createdAt: "20261107_1200" } }, null, 2)}\n`,
    );
    // The ledger stops right after both developers were dispatched: TASK-001's developer has no done yet.
    const ledgerPath = join(repo.item, "loop", "progress.md");
    writeFileSync(ledgerPath, `${readFileSync(ledgerPath, "utf8").split("\n").slice(0, 12).join("\n")}\n`);
    writeFileSync(join(repo.item, "loop", "task-001-report.md"), `# TASK-001 report\n\n## Commits created\n- ${sha7} TASK-001: a\n`);

    const res = kf(repo, "next", "demo", "--json");

    expect(res.code, res.stdout + res.stderr).toBe(0);
    const result = JSON.parse(res.stdout) as NextResult;
    expect(result.inFlight).toContainEqual({ task: "TASK-001", seat: "developer", hint: `report names commit ${sha7} after the dispatch` });
  });
});
