import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { checkLiveness } from "../workflow/next/liveness.js";
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

  it("prints why a task done in every way waits on its incomplete dependency, and no complete for it", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      // TASK-001 has its commit but its review is still running, so it is not complete.
      ...committedAndUnderReview("TASK-001", "aaa0001"),
      verifyDone("TASK-001", 0),
      ...committedAndUnderReview("TASK-002", "bbb0002"),
      verifyDone("TASK-002", 0),
      done("TASK-002", "code-reviewer", "clean"),
    ]);
    const inputs = inputsOf([task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"], wave: 2 })]);

    for (const resume of [false, true]) {
      const { actions } = schedule(state, inputs, { resume });

      expect(actions.filter((a) => a.kind === "wait" && a.task === "TASK-002")).toEqual([
        { kind: "wait", task: "TASK-002", reason: "dependency TASK-001 incomplete" },
      ]);
      expect(completedIn(actions)).toEqual([]);
    }
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

  describe("finished once every task is complete", () => {
    const tasks3 = inputsOf([task("TASK-001"), task("TASK-002"), task("TASK-003")]);
    const allComplete = (opts: { openSeat: boolean; waveDecided: boolean }): LedgerState =>
      stateOf([
        scan,
        capStart(2),
        complete("TASK-001", "commits aaa0001, review clean"),
        // A reviewer dispatched with no done, before its task's complete line: the complete line stands.
        ...(opts.openSeat ? [dispatched("TASK-002", "code-reviewer")] : []),
        complete("TASK-002", "commits bbb0002, review clean"),
        complete("TASK-003", "commits ccc0003, review clean"),
        ...(opts.waveDecided ? [noStepUp(1, "last wave")] : []),
      ]);

    it("prints only finished, with nothing in flight, when a completed task still has an open seat", async () => {
      const schedule = await loadSchedule();
      for (const resume of [false, true]) {
        const result = schedule(allComplete({ openSeat: true, waveDecided: true }), tasks3, { resume });

        expect(result.actions).toEqual([{ kind: "finished" }]);
        expect(result.inFlight).toEqual([]);
      }
    });

    it("prints only finished, with nothing in flight, when no seat or verify is open", async () => {
      const schedule = await loadSchedule();
      for (const resume of [false, true]) {
        const result = schedule(allComplete({ openSeat: false, waveDecided: true }), tasks3, { resume });

        expect(result.actions).toEqual([{ kind: "finished" }]);
        expect(result.inFlight).toEqual([]);
      }
    });

    it("prints no finished while a write is still owed", async () => {
      const schedule = await loadSchedule();
      // Wave 1 is complete with no step-up decision written: the decision is owed.
      const { actions } = schedule(allComplete({ openSeat: false, waveDecided: false }), tasks3, { resume: false });

      expect(actions.some((a) => a.kind === "finished")).toBe(false);
      expect(actions.some((a) => a.kind === "write" && a.line === "Note wave 1: no step-up — last wave")).toBe(true);
    });
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

describe("schedule: a reopened task at its round cap", () => {
  const capReached = (task: string): Fields => ({ type: "capReached", task, failure: "the retry loop is still unbounded" });
  const minimalFix = (task: string): Fields =>
    decided(task, "minimal fix past the cap: bound the retry loop to three attempts");

  /** TASK-001 completed, reopened, and spent its five rounds with findings; TASK-002 has not started. */
  const atCap = (...tail: Fields[]): Fields[] => [
    scan,
    capStart(2),
    ...testsReady("TASK-001"),
    ...committedAndUnderReview("TASK-001", "aaa0000"),
    verifyDone("TASK-001", 0),
    done("TASK-001", "code-reviewer", "clean"),
    complete("TASK-001", "commits aaa0000, review clean"),
    reopened("TASK-001"),
    ...fiveRoundsWithFindings("TASK-001", "aaa000"),
    capReached("TASK-001"),
    ...tail,
  ];
  const plan = (): LoopInputs => inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })]);

  it("marks the minimal fix dispatch of an inline task as inline", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(atCap(minimalFix("TASK-001")));
    const inputs = inputsOf([task("TASK-001", { inline: true }), task("TASK-002", { files: ["src/other.ts"] })]);

    const { actions } = schedule(state, inputs, { resume: false });

    expect(actions).toContainEqual({ kind: "dispatch", task: "TASK-001", seat: "developer", mode: "fresh", inline: true });
  });

  it("prints no stop and still dispatches another task once the minimal fix is decided", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(atCap(minimalFix("TASK-001")));

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    expect(dispatchesOf(actions, "TASK-002").length).toBeGreaterThan(0);
  });

  // A session that lost its context after the decided note must still see that it owes the fix's developer.
  it("names the minimal fix's developer, fresh and with no round, while it is decided but not yet dispatched, with and without resume", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(atCap(minimalFix("TASK-001")));

    for (const resume of [false, true]) {
      const { actions } = schedule(state, plan(), { resume });

      expect(actions).toContainEqual({ kind: "dispatch", task: "TASK-001", seat: "developer", mode: "fresh" });
      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
      expect(dispatchesOf(actions, "TASK-002").length).toBeGreaterThan(0);
    }
  });

  // The round-5 verify was still running when the fix was decided: its exit 1 is the failure the fix answers, not the fix failing.
  it("keeps the cap stop lifted when the round-5 verify exits 1 after the decided note and before the fix is dispatched", async () => {
    const schedule = await loadSchedule();
    const events = atCap();
    const round5Verify = events.map((e) => e.type === "verifyDone" && e.task === "TASK-001").lastIndexOf(true);
    events.splice(round5Verify, 1);
    const state = stateOf([...events, minimalFix("TASK-001"), verifyDone("TASK-001", 1)]);
    const round5Start = state.events.filter((e) => e.type === "verifyStarted" && e.task === "TASK-001").at(-1)!;
    // A logged failure with no contention signature: kept as the task's own, never held for a re-run.
    const inputs = inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })], {
      verifyRuns: { "TASK-001": [{ ts: round5Start.ts + 30_000, exit: 1, text: "FAIL src/tests/task-001.test.ts\nAssertionError: expected 2 to be 3" }] },
    });

    const { actions } = schedule(state, inputs, { resume: false });

    expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    // The fix the decided note owes is still dispatched: the exit 1 neither re-arms the cap nor holds the fix.
    expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([{ kind: "dispatch", task: "TASK-001", seat: "developer", mode: "fresh" }]);
  });

  it("keeps the stop and holds every dispatch while no minimal fix is decided", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(atCap());

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
    expect(actions.filter((a) => a.kind === "dispatch")).toEqual([]);
  });

  it("still prints the out-of-Files verify stop after the minimal fix is decided and holds every dispatch", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(minimalFix("TASK-001"), ...committedAndUnderReview("TASK-001", "bbb0001"), verifyDone("TASK-001", 2)),
    );

    const { actions } = schedule(state, plan(), { resume: false });

    const stops = actions.filter((a) => a.kind === "stop");
    expect(stops.map((a) => a.task)).toEqual(["TASK-001"]);
    expect(stops[0].reason).toContain("verify exit 2");
    expect(actions.filter((a) => a.kind === "dispatch")).toEqual([]);
  });

  it("brings the cap stop back when the cap is reached again after the minimal fix was decided", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(atCap(minimalFix("TASK-001"), capReached("TASK-001")));

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
    expect(actions.filter((a) => a.kind === "dispatch")).toEqual([]);
  });

  it("completes the task after the decided minimal fix is committed, verified and reviewed clean", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 0),
        done("TASK-001", "code-reviewer", "clean"),
      ),
    );

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    expect(completedIn(actions)).toContain("TASK-001");
  });

  // One minimal fix per task: a second failure after it is the human's again, never a silent task.
  it("brings the cap stop back when the minimal fix's review returns findings", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 0),
        done("TASK-001", "code-reviewer", "findings"),
      ),
    );

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
    expect(actions.filter((a) => a.kind === "dispatch")).toEqual([]);
    expect(completedIn(actions)).not.toContain("TASK-001");
  });

  it("brings the cap stop back when the minimal fix's verify fails with a kept exit 1", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 1),
        done("TASK-001", "code-reviewer", "clean"),
      ),
    );
    const fixStart = state.events.filter((e) => e.type === "verifyStarted" && e.task === "TASK-001").at(-1)!;
    // A logged failure with no contention signature: the task's own failure, kept rather than held for a re-run.
    const inputs = inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })], {
      verifyRuns: { "TASK-001": [{ ts: fixStart.ts + 30_000, exit: 1, text: "FAIL src/tests/task-001.test.ts\nAssertionError: expected 2 to be 3" }] },
    });

    const { actions } = schedule(state, inputs, { resume: false });

    expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
    expect(actions.filter((a) => a.kind === "dispatch")).toEqual([]);
    expect(completedIn(actions)).not.toContain("TASK-001");
  });

  describe("a minimal fix whose verify exits 1 and is then re-run", () => {
    const rerunNote = (task: string, signature: string): Fields => ({ type: "verifyRerun", task, signature });
    /** The minimal fix is committed, its verify exits 1, and the review is clean. */
    const failedFix = (): Fields[] =>
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 1),
        done("TASK-001", "code-reviewer", "clean"),
      );
    /** The same failure with the review finished first, so the plain re-run starts right after the exit 1. */
    const failedFixReviewedFirst = (): Fields[] =>
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        done("TASK-001", "code-reviewer", "clean"),
        verifyDone("TASK-001", 1),
      );
    const fixStartTs = (state: LedgerState): number =>
      state.events.filter((e) => e.type === "verifyStarted" && e.task === "TASK-001").at(-1)!.ts;
    const withLog = (state: LedgerState, text: string): LoopInputs =>
      inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })], {
        verifyRuns: { "TASK-001": [{ ts: fixStartTs(state) + 30_000, exit: 1, text }] },
      });
    const contention = "Error: listen EADDRINUSE: address already in use :::3000";

    it("keeps the stop lifted for a contention-shaped exit 1 before its rerun note is written", async () => {
      const schedule = await loadSchedule();
      const state = stateOf(failedFix());

      const { actions } = schedule(state, withLog(state, contention), { resume: false });

      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
      expect(actions).toContainEqual(
        expect.objectContaining({ kind: "write", task: "TASK-001", line: "Note TASK-001: verify rerun — contention EADDRINUSE" }),
      );
    });

    it("keeps the stop lifted for a contention-shaped exit 1 once its rerun note is written", async () => {
      const schedule = await loadSchedule();
      const state = stateOf([...failedFix(), rerunNote("TASK-001", "EADDRINUSE")]);

      const { actions } = schedule(state, withLog(state, contention), { resume: false });

      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    });

    it("keeps the stop lifted once the contention rerun has started", async () => {
      const schedule = await loadSchedule();
      const state = stateOf([...failedFix(), rerunNote("TASK-001", "EADDRINUSE"), verifyStarted("TASK-001")]);

      const { actions } = schedule(state, withLog(state, contention), { resume: false });

      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    });

    it("keeps the stop lifted for a plain exit 1 with no log once its re-run starts", async () => {
      const schedule = await loadSchedule();
      const state = stateOf([...failedFixReviewedFirst(), verifyStarted("TASK-001")]);

      const { actions } = schedule(state, plan(), { resume: false });

      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    });

    it("completes the task when the plain re-run passes", async () => {
      const schedule = await loadSchedule();
      const state = stateOf([...failedFixReviewedFirst(), verifyStarted("TASK-001"), verifyDone("TASK-001", 0)]);

      const { actions } = schedule(state, plan(), { resume: false });

      expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
      expect(completedIn(actions)).toContain("TASK-001");
    });
  });

  // One minimal fix per task: a later note never re-arms a fix that already ran.
  it("keeps the cap stop and dispatches no second fix when a second minimal-fix note follows a failed fix", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 0),
        done("TASK-001", "code-reviewer", "findings"),
        decided("TASK-001", "minimal fix past the cap: also cap the backoff delay"),
      ),
    );

    for (const resume of [false, true]) {
      const { actions } = schedule(state, plan(), { resume });

      expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
      expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([]);
      expect(completedIn(actions)).not.toContain("TASK-001");
    }
  });

  it("dispatches no second fix developer when the minimal-fix note is repeated while the fix is in flight", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(minimalFix("TASK-001"), dispatched("TASK-001", "developer"), minimalFix("TASK-001")),
    );

    const result = schedule(state, plan(), { resume: false });

    expect(dispatchesOf(result.actions, "TASK-001", "developer")).toEqual([]);
    expect(result.actions.filter((a) => a.kind === "stop")).toEqual([]);
    expect(result.inFlight).toContainEqual({ task: "TASK-001", seat: "developer" });
  });

  // The at-head re-run checks the tree as it was before the fix landed: its failure is not the fix's.
  it("keeps the cap stop lifted when a waits at-head re-run of the pre-fix tree fails after the fix is dispatched", async () => {
    const schedule = await loadSchedule();
    const events = atCap();
    const round5Verify = events.map((e) => e.type === "verifyDone" && e.task === "TASK-001").lastIndexOf(true);
    events.splice(round5Verify, 1);
    const state = stateOf([
      ...events,
      verifyDone("TASK-001", 1),
      { type: "verifyWaits", task: "TASK-001", file: "src/task-002.ts", otherTask: "TASK-002" },
      minimalFix("TASK-001"),
      dispatched("TASK-001", "developer"),
      verifyStarted("TASK-001"),
      verifyDone("TASK-001", 1),
      done("TASK-001", "developer"),
      commits("TASK-001", "bbb0001"),
    ]);
    const starts = state.events.filter((e) => e.type === "verifyStarted" && e.task === "TASK-001");
    const failure = "FAIL src/tests/task-001.test.ts\nAssertionError: expected 2 to be 3";
    // Logged failures with no contention signature: each is kept as the task's own, never held for a re-run.
    const inputs = inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })], {
      verifyRuns: {
        "TASK-001": [
          { ts: starts.at(-2)!.ts + 30_000, exit: 1, text: failure },
          { ts: starts.at(-1)!.ts + 30_000, exit: 1, text: failure },
        ],
      },
    });

    const { actions } = schedule(state, inputs, { resume: false });

    expect(actions.filter((a) => a.kind === "stop")).toEqual([]);
    // The fix's commit goes on to its own verify and review, as any committed developer's does.
    expect(verifiesOf(actions, "TASK-001")).toEqual([
      expect.objectContaining({ kind: "verify", task: "TASK-001", command: expect.stringMatching(/^kf verify feat --task TASK-001 --commits \S*bbb0001$/) }),
    ]);
    expect(dispatchesOf(actions, "TASK-001", "code-reviewer")).toHaveLength(1);
  });

  // Ruled with the human: cascade findings after the minimal fix of a reopened task leave no round and no second
  // fix, so they are the human's — a stop, never a silent task or a completion.
  it("stops when a cascade re-review after the fix returns findings", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(
      atCap(
        minimalFix("TASK-001"),
        ...committedAndUnderReview("TASK-001", "bbb0001"),
        verifyDone("TASK-001", 0),
        done("TASK-001", "code-reviewer", "clean"),
        { type: "cascadeOwed", task: "TASK-001", sha: "ccc0002", otherTask: "TASK-002" },
        { type: "dispatched", task: "TASK-001", seat: "code-reviewer", model: "sonnet", cascade: "ccc0002" },
        done("TASK-001", "code-reviewer", "findings"),
      ),
    );

    for (const resume of [false, true]) {
      const { actions } = schedule(state, plan(), { resume });

      expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
      expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([]);
      expect(completedIn(actions)).not.toContain("TASK-001");
    }
  });
});

describe("schedule: a never-reopened task past its breaker", () => {
  const minimalFix = (task: string): Fields =>
    decided(task, "minimal fix past the cap: bound the retry loop to three attempts");

  /** TASK-001 was never reopened and its fifth round still left findings; TASK-002 has not started. */
  const pastBreaker = (...tail: Fields[]): Fields[] => [
    scan,
    capStart(2),
    ...testsReady("TASK-001"),
    ...committedAndUnderReview("TASK-001", "aaa0000"),
    verifyDone("TASK-001", 0),
    done("TASK-001", "code-reviewer", "findings"),
    ...fiveRoundsWithFindings("TASK-001", "aaa000"),
    ...tail,
  ];
  const plan = (): LoopInputs => inputsOf([task("TASK-001"), task("TASK-002", { files: ["src/other.ts"] })]);
  const fixDeveloper = { kind: "dispatch", task: "TASK-001", seat: "developer", mode: "fresh" };

  // A minimal-fix ruling is not a parked closure: the task waits for the fix instead of completing on the parked lines.
  it("names the fix developer and completes only once the fix's review is clean and its verify passes, when findings are parked beside the minimal fix", async () => {
    const schedule = await loadSchedule();
    const ruled: Fields[] = [parked("TASK-001", "naming of the helper"), minimalFix("TASK-001")];
    const fixCommitted: Fields[] = [...ruled, ...committedAndUnderReview("TASK-001", "bbb0001")];

    const beforeFix = schedule(stateOf(pastBreaker(...ruled)), plan(), { resume: false }).actions;
    expect(beforeFix).toContainEqual(fixDeveloper);
    expect(completedIn(beforeFix)).not.toContain("TASK-001");

    const underReview = schedule(stateOf(pastBreaker(...fixCommitted, verifyDone("TASK-001", 0))), plan(), { resume: false }).actions;
    expect(completedIn(underReview)).not.toContain("TASK-001");

    const verifyPending = schedule(stateOf(pastBreaker(...fixCommitted, done("TASK-001", "code-reviewer", "clean"))), plan(), {
      resume: false,
    }).actions;
    expect(completedIn(verifyPending)).not.toContain("TASK-001");

    const reviewFindings = schedule(
      stateOf(pastBreaker(...fixCommitted, verifyDone("TASK-001", 0), done("TASK-001", "code-reviewer", "findings"))),
      plan(),
      { resume: false },
    ).actions;
    expect(completedIn(reviewFindings)).not.toContain("TASK-001");

    const fixClean = schedule(
      stateOf(pastBreaker(...fixCommitted, verifyDone("TASK-001", 0), done("TASK-001", "code-reviewer", "clean"))),
      plan(),
      { resume: false },
    ).actions;
    expect(completedIn(fixClean)).toContain("TASK-001");
  });

  // Without a parked line the minimal-fix note still closes the breaker: the task must not go silent.
  it("names the fix developer, fresh and with no round, when only the minimal-fix note closes the breaker, with and without resume", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(pastBreaker(minimalFix("TASK-001")));

    for (const resume of [false, true]) {
      const { actions } = schedule(state, plan(), { resume });

      expect(actions).toContainEqual(fixDeveloper);
      expect(completedIn(actions)).not.toContain("TASK-001");
    }
  });
});

describe("schedule: a dependent task owed a cascade re-review", () => {
  const H = "TASK-001";
  const X = "TASK-002";
  const FIX = "bbb0001";
  const plan = (): LoopInputs => inputsOf([task(H), task(X, { dependencies: [H], wave: 2 })]);

  /** H complete, X built, then H reopened and fixed in round 1 and complete again; X's own review is clean. */
  const fixedUnderneath = (): Fields[] => [
    scan,
    capStart(2),
    ...testsReady(H),
    ...committedAndUnderReview(H, "aaa0001"),
    verifyDone(H, 0),
    done(H, "code-reviewer", "clean"),
    complete(H, "commits aaa0001, review clean"),
    noStepUp(1, "inline"),
    ...testsReady(X),
    dispatched(X, "developer"),
    done(X, "developer"),
    commits(X, "ccc0002"),
    reviewPackage(X, "ccc0002"),
    verifyStarted(X),
    verifyDone(X, 0),
    reopened(H),
    dispatched(H, "developer", { round: 1 }),
    done(H, "developer"),
    commits(H, FIX),
    reviewPackage(H, FIX),
    verifyStarted(H),
    dispatched(H, "code-reviewer", { round: 1 }),
    verifyDone(H, 0),
    done(H, "code-reviewer", "clean"),
    fixRound(H, 1),
    complete(H, `commits aaa0001,${FIX}, review clean`),
    dispatched(X, "code-reviewer"),
    done(X, "code-reviewer", "clean"),
  ];
  const cascadeReview = (status: string): Fields[] => [
    { type: "cascadeOwed", task: X, sha: FIX, otherTask: H },
    { type: "dispatched", task: X, seat: "code-reviewer", model: "sonnet", round: 1, cascade: FIX },
    done(X, "code-reviewer", status),
  ];

  it("does not complete a task whose own review is clean while its cascade re-review ended with findings", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([...fixedUnderneath(), ...cascadeReview("findings")]);

    const { actions } = schedule(state, plan(), { resume: false });

    expect(completedIn(actions)).not.toContain(X);
  });

  it("completes a task whose own review and cascade re-review are both clean", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([...fixedUnderneath(), ...cascadeReview("clean")]);

    const { actions } = schedule(state, plan(), { resume: false });

    expect(completedIn(actions)).toContain(X);
  });

  it("completes a task whose cascade re-review ended with findings once a later own re-review is clean", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      ...fixedUnderneath(),
      ...cascadeReview("findings"),
      dispatched(X, "code-reviewer"),
      done(X, "code-reviewer", "clean"),
    ]);

    const { actions } = schedule(state, plan(), { resume: false });

    expect(completedIn(actions)).toContain(X);
  });

  // Parked findings count as a clean review at the cap; a cascade re-review's findings on that task are parked the same way.
  it("completes a task parked at the round cap whose cascade re-review ended with findings", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady(H),
      ...committedAndUnderReview(H, "aaa0001"),
      verifyDone(H, 0),
      done(H, "code-reviewer", "clean"),
      complete(H, "commits aaa0001, review clean"),
      noStepUp(1, "inline"),
      ...testsReady(X),
      ...committedAndUnderReview(X, "ccc0000"),
      verifyDone(X, 0),
      done(X, "code-reviewer", "findings"),
      ...fiveRoundsWithFindings(X, "ccc000"),
      parked(X, "naming of the helper"),
      decided(X, "breaker: findings parked at the cap"),
      reopened(H),
      dispatched(H, "developer", { round: 1 }),
      done(H, "developer"),
      commits(H, FIX),
      reviewPackage(H, FIX),
      verifyStarted(H),
      dispatched(H, "code-reviewer", { round: 1 }),
      verifyDone(H, 0),
      done(H, "code-reviewer", "clean"),
      fixRound(H, 1),
      complete(H, `commits aaa0001,${FIX}, review clean`),
      ...cascadeReview("findings"),
      parked(X, "cascade re-review: the helper still shadows the fixed export"),
      decided(X, "breaker: cascade findings parked at the cap"),
    ]);

    const { actions } = schedule(state, plan(), { resume: false });

    expect(completedIn(actions)).toContain(X);
  });

  // Recorded together, X's complete line lands after H's fix commit is named, so the cascade X owes for it is never owed.
  it("does not complete a task in the same call that names a fix commit of a task it depends on", async () => {
    const schedule = await loadSchedule();
    const M = "TASK-003";
    const fixSha = `${FIX}${"0".repeat(33)}`;
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady(H),
      ...committedAndUnderReview(H, "aaa0001"),
      verifyDone(H, 0),
      done(H, "code-reviewer", "clean"),
      complete(H, "commits aaa0001, review clean"),
      noStepUp(1, "inline"),
      ...testsReady(M),
      ...committedAndUnderReview(M, "ddd0003"),
      verifyDone(M, 0),
      done(M, "code-reviewer", "clean"),
      complete(M, "commits ddd0003, review clean"),
      noStepUp(2, "inline"),
      ...testsReady(X),
      ...committedAndUnderReview(X, "ccc0002"),
      verifyDone(X, 0),
      done(X, "code-reviewer", "clean"),
      reopened(H),
      dispatched(H, "developer", { round: 1 }),
      done(H, "developer"),
    ]);
    // X depends on H through M; M's complete line still stands after H's reopen.
    const inputs = inputsOf([task(H), task(M, { dependencies: [H], wave: 2 }), task(X, { dependencies: [M], wave: 3 })], {
      reportCommits: { [H]: [fixSha] },
    });

    const { actions } = schedule(state, inputs, { resume: false });

    expect(actions).toContainEqual(expect.objectContaining({ kind: "write", task: H, line: `Note ${H}: commits ${FIX}` }));
    expect(completedIn(actions)).not.toContain(X);
  });

  // Recorded together, a complete line would close the task before the owed re-review is ever named.
  it("does not complete a task in the same call that owes its cascade re-review line", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(fixedUnderneath());

    const { actions } = schedule(state, plan(), { resume: false });

    expect(actions).toContainEqual(
      expect.objectContaining({ kind: "write", task: X, line: `${X}: cascade re-review owed — after ${FIX} of ${H}` }),
    );
    expect(completedIn(actions)).not.toContain(X);
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

describe("schedule: the developer-waits record", () => {
  it("prints the waits reason as one single-quoted word after --", async () => {
    const schedule = await loadSchedule();
    // TASK-001 holds the only developer seat; TASK-002's review found something, so routing asks for a fix developer.
    const state = stateOf([
      scan,
      capStart(1),
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      ...testsReady("TASK-002"),
      ...committedAndUnderReview("TASK-002", "bbb0002"),
      verifyDone("TASK-002", 0),
      done("TASK-002", "code-reviewer", "findings"),
    ]);
    const inputs = inputsOf([task("TASK-001"), task("TASK-002")]);

    const { actions } = schedule(state, inputs, { resume: false });

    const writes = actions.filter((a): a is Extract<Action, { kind: "write" }> => a.kind === "write" && a.record.includes(" waits "));
    expect(writes).toHaveLength(1);
    const reason = "1 developers in flight";
    // Single quotes, each ' written as '\'' - computed here so the test does not lean on the module's helper.
    const quoted = `'${reason.replace(/'/g, `'\\''`)}'`;
    expect(writes[0].record).toBe(`kf record feat waits ${writes[0].task} -- ${quoted}`);
    expect(writes[0].line).toBe(`${writes[0].task}: developer waits — ${reason}`);
  });

  it("writes a developer's wait once and keeps the wait printed after it is recorded", async () => {
    const schedule = await loadSchedule();
    const reason = "1 developers in flight";
    const held: Fields[] = [scan, capStart(1), ...testsReady("TASK-001"), ...testsReady("TASK-002"), dispatched("TASK-001", "developer")];
    const inputs = inputsOf([task("TASK-001"), task("TASK-002")]);
    const waitsWrite = (actions: Action[]) => actions.filter((a) => a.kind === "write" && a.line === `TASK-002: developer waits — ${reason}`);

    const first = schedule(stateOf(held), inputs, { resume: false }).actions;
    expect(first).toContainEqual({ kind: "wait", task: "TASK-002", reason });
    expect(waitsWrite(first)).toHaveLength(1);

    const again = schedule(stateOf([...held, { type: "developerWaits", task: "TASK-002", reason }]), inputs, { resume: false }).actions;
    expect(again).toContainEqual({ kind: "wait", task: "TASK-002", reason });
    expect(waitsWrite(again)).toEqual([]);
  });
});

describe("schedule: one decided note closes one gate across the task's regions", () => {
  const T1 = "TASK-001";
  const built = (): Fields[] => [scan, capStart(2), ...testsReady(T1), ...committedAndUnderReview(T1, "aaa0001")];
  const exit2Stops = (actions: Action[]) => actions.filter((a) => a.kind === "stop" && a.task === T1 && a.reason.includes("verify exit 2"));
  const seatDecides = (actions: Action[]) => decidesOf(actions, "Seat status").filter((d) => d.task === T1);
  const plan = (): LoopInputs => inputsOf([task(T1)]);

  it("closes an earlier verify exit 2 stop first and a later reviewer seat status with the next note", async () => {
    const schedule = await loadSchedule();
    const events: Fields[] = [...built(), verifyDone(T1, 2), done(T1, "code-reviewer", "BLOCKED")];

    const open = schedule(stateOf(events), plan(), { resume: false }).actions;
    expect(exit2Stops(open)).toHaveLength(1);
    expect(seatDecides(open)).toHaveLength(1);

    const one = schedule(stateOf([...events, decided(T1, "plan re-approved")]), plan(), { resume: false }).actions;
    expect(exit2Stops(one)).toEqual([]);
    expect(seatDecides(one)).toHaveLength(1);

    const two = schedule(stateOf([...events, decided(T1, "plan re-approved"), decided(T1, "review goes on")]), plan(), { resume: false }).actions;
    expect(exit2Stops(two)).toEqual([]);
    expect(seatDecides(two)).toEqual([]);
  });

  it("closes an earlier reviewer seat status first and a later verify exit 2 stop with the next note", async () => {
    const schedule = await loadSchedule();
    const events: Fields[] = [...built(), done(T1, "code-reviewer", "BLOCKED"), verifyDone(T1, 2)];

    const open = schedule(stateOf(events), plan(), { resume: false }).actions;
    expect(seatDecides(open)).toHaveLength(1);
    expect(exit2Stops(open)).toHaveLength(1);

    const one = schedule(stateOf([...events, decided(T1, "review goes on")]), plan(), { resume: false }).actions;
    expect(seatDecides(one)).toEqual([]);
    expect(exit2Stops(one)).toHaveLength(1);

    const two = schedule(stateOf([...events, decided(T1, "review goes on"), decided(T1, "plan re-approved")]), plan(), { resume: false }).actions;
    expect(seatDecides(two)).toEqual([]);
    expect(exit2Stops(two)).toEqual([]);
  });
});

describe("schedule: a round test-writer closed by a decision", () => {
  const T1 = "TASK-001";
  const roundWriterGated: Fields[] = [
    scan,
    capStart(2),
    ...testsReady(T1),
    ...committedAndUnderReview(T1, "aaa0000"),
    verifyDone(T1, 0),
    done(T1, "code-reviewer", "findings"),
    dispatched(T1, "test-writer", { round: 1 }),
    done(T1, "test-writer", "NEEDS_CONTEXT"),
  ];

  // The test-writer the session sent the finding to never reported DONE: closing its gate owes it again, in its round.
  it.each([
    ["a decided note", decided(T1, "the fixture path is src/tests/fixtures/retry")],
    ["a Ruling naming the task", other(`Ruling: ${T1} — the fixture path is src/tests/fixtures/retry — cost if wrong: one more seat`)],
  ])("dispatches the round's test-writer again after %s", async (_how, close) => {
    const schedule = await loadSchedule();

    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf([...roundWriterGated, close]), inputsOf([task(T1)]), { resume });

      expect(actions).toContainEqual(expect.objectContaining({ kind: "dispatch", task: T1, seat: "test-writer", round: 1 }));
      expect(decidesOf(actions, "Seat status").filter((d) => d.task === T1)).toEqual([]);
    }
  });
});

describe("schedule: a re-run lost under the full cap", () => {
  const T1 = "TASK-001";
  const T2 = "TASK-002";
  const contention = "Error: listen EADDRINUSE: address already in use :::3000";
  const rerunNote = `Note ${T1}: verify rerun — contention EADDRINUSE`;

  /** The cap stepped down to 1 on TASK-001's contention; its re-run started and was lost; TASK-002's developer fills N. */
  const lostRerun = (): LedgerState =>
    stateOf([
      scan,
      capStart(2),
      ...testsReady(T1),
      ...testsReady(T2),
      dispatched(T2, "developer"),
      ...committedAndUnderReview(T1, "aaa0001"),
      verifyDone(T1, 1),
      { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: T1 } },
      { type: "verifyRerun", task: T1, signature: "EADDRINUSE" },
      verifyStarted(T1),
    ]);
  const inputsFor2 = (state: LedgerState): LoopInputs => {
    const firstStart = state.events.find((e) => e.type === "verifyStarted" && e.task === T1)!;
    return inputsOf([task(T1), task(T2)], { verifyRuns: { [T1]: [{ ts: firstStart.ts + 30_000, exit: 1, text: contention }] } });
  };

  it("writes the verify rerun note again under resume while the cap is full, and runs no re-run yet", async () => {
    const schedule = await loadSchedule();
    const state = lostRerun();

    const { actions } = schedule(state, inputsFor2(state), { resume: true });

    expect(actions).toContainEqual(expect.objectContaining({ kind: "write", task: T1, line: rerunNote }));
    expect(verifiesOf(actions, T1)).toEqual([]);
  });

  it("keeps the running re-run in flight without resume and owes no note", async () => {
    const schedule = await loadSchedule();
    const state = lostRerun();

    const result = schedule(state, inputsFor2(state), { resume: false });

    expect(result.inFlight).toContainEqual({ task: T1, seat: "verify" });
    expect(result.actions.filter((a) => a.kind === "write" && a.line === rerunNote)).toEqual([]);
  });
});

describe("schedule: the fix round line at the cap", () => {
  // Ruled: the fix round 5/5 line is not printed beside the repeating Breaker decide; the session writes it when it
  // closes that decide, so the decide's closes text names it.
  it("names the fix round 5/5 line in the Breaker's closes and prints no fix round write beside it", async () => {
    const schedule = await loadSchedule();
    const rounds = fiveRoundsWithFindings("TASK-001", "aaa000");
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...committedAndUnderReview("TASK-001", "aaa0000"),
      verifyDone("TASK-001", 0),
      done("TASK-001", "code-reviewer", "findings"),
      ...rounds.slice(0, -1),
    ]);

    const { actions } = schedule(state, inputsOf([task("TASK-001")]), { resume: false });

    const breaker = decidesOf(actions, "Breaker").filter((d) => d.task === "TASK-001");
    expect(breaker).toHaveLength(1);
    expect(breaker[0].closes).toContain("TASK-001: fix round 5/5");
    expect(actions.filter((a) => a.kind === "write" && a.line.startsWith("TASK-001: fix round 5/5"))).toEqual([]);
  });
});

describe("schedule: completion and witnesses of a committed task", () => {
  const T1 = "TASK-001";
  const T2 = "TASK-002";
  /** Fix round `round`: its developer done with one commit, the review package, a verify and its reviewer dispatched. */
  const committedAndUnderReviewRound = (t: string, sha: string, round: number): Fields[] => [
    dispatched(t, "developer", { round }),
    done(t, "developer"),
    commits(t, sha),
    reviewPackage(t, sha),
    verifyStarted(t),
    dispatched(t, "code-reviewer", { round }),
  ];

  // Round 5's commit landed after the last passing verify; parking the findings does not stand in for its verify.
  it("does not complete a task parked at the Breaker whose last commit has no verify after it, and owes that verify", async () => {
    const schedule = await loadSchedule();
    const events: Fields[] = [scan, capStart(2), ...testsReady(T1), ...committedAndUnderReview(T1, "aaa0000"), verifyDone(T1, 0), done(T1, "code-reviewer", "findings")];
    for (let r = 1; r <= 4; r++) {
      events.push(...committedAndUnderReviewRound(T1, `aaa000${r}`, r), verifyDone(T1, 0), done(T1, "code-reviewer", "findings"), fixRound(T1, r));
    }
    events.push(
      dispatched(T1, "developer", { round: 5 }),
      done(T1, "developer"),
      commits(T1, "aaa0005"),
      reviewPackage(T1, "aaa0005"),
      dispatched(T1, "code-reviewer", { round: 5 }),
      done(T1, "code-reviewer", "findings"),
      fixRound(T1, 5),
      parked(T1, "naming of the helper"),
      decided(T1, "findings parked at the cap"),
    );

    const { actions } = schedule(stateOf(events), inputsOf([task(T1)]), { resume: false });

    expect(completedIn(actions)).not.toContain(T1);
    expect(verifiesOf(actions, T1)).toHaveLength(1);
  });

  // A committed, reviewed-clean task whose failing verify is held for a contention re-run behind the full cap.
  it("gives a witness to a reviewed task whose contention re-run is held by the full cap", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady(T1),
      ...testsReady(T2),
      dispatched(T2, "developer"),
      ...committedAndUnderReview(T1, "aaa0001"),
      done(T1, "code-reviewer", "clean"),
      verifyDone(T1, 1),
      { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: T1 } },
      { type: "verifyRerun", task: T1, signature: "EADDRINUSE" },
    ]);
    const start = state.events.find((e) => e.type === "verifyStarted" && e.task === T1)!;
    const inputs = inputsOf([task(T1), task(T2)], {
      verifyRuns: { [T1]: [{ ts: start.ts + 30_000, exit: 1, text: "Error: listen EADDRINUSE: address already in use :::3000" }] },
    });

    const result = schedule(state, inputs, { resume: false });

    expect(checkLiveness(result, state, inputs)).toEqual({ silent: [], emptyCloses: [] });
    expect(result.actions.filter((a) => a.kind === "stop")).toEqual([]);
    expect(completedIn(result.actions)).not.toContain(T1);
  });

  // A commit landed while the verify ran, then a rerun note: one fresh verify is owed, and no developer is held for it.
  it("owes one verify and holds no developer when a rerun note follows a verify a commit made stale", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady(T1),
      ...testsReady(T2),
      ...committedAndUnderReview(T1, "aaa0001"),
      commits(T1, "aaa0002"),
      { type: "verifyRerun", task: T1, signature: "EADDRINUSE" },
    ]);

    const { actions } = schedule(state, inputsOf([task(T1), task(T2)]), { resume: false });

    expect(verifiesOf(actions, T1)).toHaveLength(1);
    expect(actions.filter((a) => a.kind === "wait" && a.task === T2 && a.reason.startsWith("held re-run"))).toEqual([]);
    expect(dispatchesOf(actions, T2, "developer")).toHaveLength(1);
  });
});

describe("schedule: a UI task under Level full owes the specs commit to the resume-commit developer", () => {
  const T1 = "TASK-001";
  const ui = task(T1, { testTypes: ["Unit", "UI"] });
  const inputs = inputsOf([ui], { level: "full" });
  const base: Fields[] = [scan, capStart(2), ...testsReady(T1)];

  // Until the specs are committed neither the verify, the own review, its package nor the completion may be named.
  const expectSpecsOwed = async (events: Fields[]): Promise<void> => {
    const schedule = await loadSchedule();
    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events), inputs, { resume });
      expect(dispatchesOf(actions, T1, "developer").map((d) => d.mode)).toEqual(["resume"]);
      expect(verifiesOf(actions, T1)).toEqual([]);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toEqual([]);
      expect(actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: review package`))).toEqual([]);
      expect(completedIn(actions)).not.toContain(T1);
    }
  };

  it("owes the resume-commit developer when the automation-writer reports after the developer's DONE", async () => {
    await expectSpecsOwed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
    ]);
  });

  it("owes the resume-commit developer when a decided note closes the automation-writer's concerns that were open at the developer's DONE", async () => {
    await expectSpecsOwed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "automation-writer", "DONE_WITH_CONCERNS"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      decided(T1, "the selector concerns are accepted"),
    ]);
  });

  it("owes the resume-commit developer when the developer was re-dispatched after Commit missing", async () => {
    await expectSpecsOwed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "automation-writer"),
      done(T1, "developer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "developer"),
    ]);
  });

  // The sent-back developer answers the Commit missing; its commit is the task's, so the specs commit is still owed after it.
  it("owes one resume developer after the developer sent back for Commit missing commits only the task commit", async () => {
    await expectSpecsOwed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "developer"),
    ]);
  });

  it("reviews with both commits once the one resume developer committed the specs after the sent-back developer", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "developer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0002"),
      done(T1, "developer"),
    ]);

    for (const resume of [false, true]) {
      const { actions } = schedule(state, inputs, { resume });
      expect(dispatchesOf(actions, T1, "developer")).toEqual([]);
      expect(actions).toContainEqual(expect.objectContaining({ kind: "write", line: `${T1}: review package aaa0001,aaa0002` }));
      expect(verifiesOf(actions, T1)).toHaveLength(1);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toHaveLength(1);
    }
  });

  it("owes one resume developer after the sent-back developer commits when its report named only the first commit", async () => {
    const schedule = await loadSchedule();
    const named = ["aaa0001"];
    const namedInputs = inputsOf([ui], {
      level: "full",
      reportCommits: { [T1]: named },
      gitLog: named.map((sha, i) => ({ sha: `${sha}${"0".repeat(33)}`, ts: 1_000 + i })),
    });
    const state = stateOf([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
    ]);

    for (const resume of [false, true]) {
      const { actions } = schedule(state, namedInputs, { resume });
      expect(dispatchesOf(actions, T1, "developer").map((d) => d.mode)).toEqual(["resume"]);
      expect(verifiesOf(actions, T1)).toEqual([]);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toEqual([]);
    }
  });

  it("reviews the task once the resume-commit developer is done with the specs commit", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0002"),
      done(T1, "developer"),
    ]);

    const { actions } = schedule(state, inputs, { resume: false });

    expect(dispatchesOf(actions, T1, "developer")).toEqual([]);
    expect(actions).toContainEqual(expect.objectContaining({ kind: "write", line: `${T1}: review package aaa0001,aaa0002` }));
    expect(verifiesOf(actions, T1)).toHaveLength(1);
    expect(dispatchesOf(actions, T1, "code-reviewer")).toHaveLength(1);
  });
});

describe("schedule: a UI task under Level full holds the check pass until its specs are resumed", () => {
  const T1 = "TASK-001";
  const ui = task(T1, { testTypes: ["Unit", "UI"] });
  const inputs = inputsOf([ui], { level: "full" });
  const base: Fields[] = [scan, capStart(2), ...testsReady(T1)];

  const expectReviewed = async (events: Fields[]): Promise<void> => {
    const schedule = await loadSchedule();
    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events), inputs, { resume });
      expect(dispatchesOf(actions, T1, "developer")).toEqual([]);
      expect(verifiesOf(actions, T1)).toHaveLength(1);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toHaveLength(1);
      expect(actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: review package`))).toHaveLength(1);
    }
  };

  // The resume-commit developer is the one dispatched after the specs and the first DONE; once it has run, nothing more is owed.
  it("owes no further resume developer once the resume-commit developer finished with no commit and a commits note followed", async () => {
    await expectReviewed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      done(T1, "developer"),
      commits(T1, "aaa0002"),
    ]);
  });

  it("owes no further resume developer when the resume developer was re-dispatched after Commit missing and then committed", async () => {
    await expectReviewed([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      done(T1, "developer"),
      dispatched(T1, "developer"),
      commits(T1, "aaa0002"),
      done(T1, "developer"),
    ]);
  });

  // The resume developer's report names its commit, so the commit is known before the commits note is written.
  const reported = ["aaa0001", "aaa0002"];
  const reportedInputs = inputsOf([ui], {
    level: "full",
    reportCommits: { [T1]: reported },
    gitLog: reported.map((sha, i) => ({ sha: `${sha}${"0".repeat(33)}`, ts: 1_000 + i })),
  });
  const expectReviewedReported = async (events: Fields[]): Promise<void> => {
    const schedule = await loadSchedule();
    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events), reportedInputs, { resume });
      expect(dispatchesOf(actions, T1, "developer")).toEqual([]);
      expect(verifiesOf(actions, T1)).toHaveLength(1);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toHaveLength(1);
      expect(actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: review package`))).toHaveLength(1);
    }
  };

  it("reviews the task when the resume developer's DONE came before its commits note and its report names the commit", async () => {
    await expectReviewedReported([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      done(T1, "developer"),
      commits(T1, "aaa0002"),
    ]);
  });

  it("reviews the task when the resume developer was re-dispatched while its commits note was owed and the report names the commit", async () => {
    await expectReviewedReported([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer"),
      dispatched(T1, "developer"),
      done(T1, "developer"),
      dispatched(T1, "developer"),
      done(T1, "developer"),
      commits(T1, "aaa0002"),
    ]);
  });

  const expectHeld = async (events: Fields[]): Promise<void> => {
    const schedule = await loadSchedule();
    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events), inputs, { resume });
      expect(verifiesOf(actions, T1)).toEqual([]);
      expect(dispatchesOf(actions, T1, "code-reviewer")).toEqual([]);
      expect(actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: review package`))).toEqual([]);
      expect(completedIn(actions)).not.toContain(T1);
    }
  };

  it("names no verify, review package or reviewer while the automation-writer is still running at the developer's DONE", async () => {
    await expectHeld([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
    ]);
  });

  it("names no verify, review package or reviewer while the automation-writer's concerns are gated before the decided note", async () => {
    await expectHeld([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "automation-writer", "DONE_WITH_CONCERNS"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
    ]);
  });

  it("names no verify, review package or reviewer when the concerns are gated after the developer's DONE and before the decided note", async () => {
    await expectHeld([
      ...base,
      dispatched(T1, "developer"),
      dispatched(T1, "automation-writer"),
      done(T1, "developer"),
      commits(T1, "aaa0001"),
      done(T1, "automation-writer", "DONE_WITH_CONCERNS"),
    ]);
  });
});

describe("schedule: a fix round's review package", () => {
  const T1 = "TASK-001";

  // A commits note written after the previous review was dispatched and before the round opened is in no review
  // package yet; the round's reviewer must see it.
  it("names a late commits note, written before the round opened, with the round's own commits", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady(T1),
      ...committedAndUnderReview(T1, "aaa0001"),
      commits(T1, "aaa0002"),
      verifyDone(T1, 0),
      done(T1, "code-reviewer", "findings"),
      dispatched(T1, "developer", { round: 1 }),
      done(T1, "developer"),
      commits(T1, "bbb0003"),
    ]);

    const { actions } = schedule(state, inputsOf([task(T1)]), { resume: false });

    expect(actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: review package`))).toEqual([
      expect.objectContaining({ kind: "write", line: `${T1}: review package aaa0002,bbb0003` }),
    ]);
  });
});

describe("schedule: a minimal-fix note before the cap reached note", () => {
  // The cap stop is entered by its `cap reached` note: a minimal-fix note written before it decides nothing yet.
  it("names no fix developer and keeps the cap stop", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...committedAndUnderReview("TASK-001", "aaa0000"),
      verifyDone("TASK-001", 0),
      done("TASK-001", "code-reviewer", "clean"),
      complete("TASK-001", "commits aaa0000, review clean"),
      reopened("TASK-001"),
      ...fiveRoundsWithFindings("TASK-001", "aaa000"),
      decided("TASK-001", "minimal fix past the cap: bound the retry loop to three attempts"),
    ]);

    for (const resume of [false, true]) {
      const { actions } = schedule(state, inputsOf([task("TASK-001")]), { resume });

      expect(dispatchesOf(actions, "TASK-001", "developer")).toEqual([]);
      expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual(["TASK-001"]);
    }
  });
});

const NO_RULE = /kf next has no rule for/;

describe("schedule: an assertion inside the arbiter", () => {
  // The plan marks two tasks overlapping although no Files entry pair overlaps: the arbiter cannot name the pair.
  // kf next must answer with the liveness guard's stop for the task, never crash.
  it("prints the liveness guard's stop instead of throwing", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([scan, capStart(2), ...testsReady("TASK-001"), ...testsReady("TASK-002"), dispatched("TASK-001", "developer")]);
    const inputs = inputsOf([
      task("TASK-001", { files: ["src/a.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/b.ts"], overlaps: ["TASK-001"] }),
    ]);

    let result: NextResult | undefined;
    expect(() => {
      result = schedule(state, inputs, { resume: false });
    }).not.toThrow();

    const guard = result!.actions.filter(
      (a) => a.kind === "stop" && a.task !== undefined && a.reason.startsWith(`kf next has no rule for ${a.task} in `) && a.reason.endsWith(" — report this with the ledger"),
    );
    expect(guard.map((a) => (a.kind === "stop" ? a.task : undefined))).toContain("TASK-002");
  });

  // The guard's stop is a stop like any other: while a task is unplaced, no progress seat of any task is dispatched.
  it("holds every other task's progress dispatch while a task gets the liveness guard's stop", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      ...testsReady("TASK-003"),
      dispatched("TASK-001", "developer"),
    ]);
    const inputs = inputsOf([
      task("TASK-001", { files: ["src/a.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/b.ts"], overlaps: ["TASK-001"] }),
      task("TASK-003", { files: ["src/c.ts"] }),
    ]);

    const result = schedule(state, inputs, { resume: false });

    const stops = result.actions.filter((a) => a.kind === "stop");
    expect(stops.map((a) => a.task)).toEqual(["TASK-002"]);
    expect(stops[0].kind === "stop" && NO_RULE.test(stops[0].reason)).toBe(true);
    expect(result.actions.filter((a) => a.kind === "dispatch")).toEqual([]);
    expect(result.actions.filter((a) => a.kind !== "finished" && a.kind !== "verify-wave" && a.task === "TASK-002" && a.kind !== "stop")).toEqual([]);
    // The held task names the stop that holds it, as a stop's hold does.
    expect(result.actions.filter((a) => a.kind === "wait" && a.task === "TASK-003" && a.reason.includes("TASK-002"))).toHaveLength(1);
    expect(result.inFlight).toContainEqual({ task: "TASK-001", seat: "developer" });
  });
});

describe("schedule: two tasks held for contention re-runs", () => {
  const T1 = "TASK-001";
  const T2 = "TASK-002";
  const T3 = "TASK-003";
  const contention = "Error: listen EADDRINUSE: address already in use :::3000";

  /** T1 and T2 reviewed clean, each verify failed on EADDRINUSE, the cap stepped down to 1 and both rerun notes written. */
  const bothHeld = (...tail: Fields[]): Fields[] => [
    scan,
    capStart(2),
    ...testsReady(T1),
    ...testsReady(T2),
    ...testsReady(T3),
    ...committedAndUnderReview(T1, "aaa0001"),
    done(T1, "code-reviewer", "clean"),
    verifyDone(T1, 1),
    ...committedAndUnderReview(T2, "bbb0001"),
    done(T2, "code-reviewer", "clean"),
    verifyDone(T2, 1),
    { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: T1 } },
    { type: "verifyRerun", task: T1, signature: "EADDRINUSE" },
    { type: "verifyRerun", task: T2, signature: "EADDRINUSE" },
    ...tail,
  ];
  const inputsFor = (state: LedgerState): LoopInputs => {
    const firstStart = (t: string) => state.events.find((e) => e.type === "verifyStarted" && e.task === t)!.ts;
    return inputsOf([task(T1), task(T2), task(T3)], {
      verifyRuns: {
        [T1]: [{ ts: firstStart(T1) + 30_000, exit: 1, text: contention }],
        [T2]: [{ ts: firstStart(T2) + 30_000, exit: 1, text: contention }],
      },
    });
  };
  const guardStops = (actions: Action[]) => actions.filter((a) => a.kind === "stop" && NO_RULE.test(a.reason));
  const heldOn = (actions: Action[], waiter: string, on: string) =>
    actions.filter((a) => a.kind === "wait" && a.task === waiter && a.reason.includes("re-run") && a.reason.endsWith(on));

  it("gives a task held while another task's re-run runs a wait on that re-run", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(bothHeld(verifyStarted(T1)));
    const inputs = inputsFor(state);

    const result = schedule(state, inputs, { resume: false });

    expect(result.inFlight).toContainEqual({ task: T1, seat: "verify" });
    expect(heldOn(result.actions, T2, T1)).toHaveLength(1);
    expect(verifiesOf(result.actions, T2)).toEqual([]);
    expect(guardStops(result.actions)).toEqual([]);
    expect(checkLiveness(result, state, inputs)).toEqual({ silent: [], emptyCloses: [] });
  });

  it("releases the first held re-run below the cap and gives the second a wait on it", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(bothHeld());
    const inputs = inputsFor(state);

    const result = schedule(state, inputs, { resume: false });

    expect(verifiesOf(result.actions, T1)).toHaveLength(1);
    expect(verifiesOf(result.actions, T2)).toEqual([]);
    expect(heldOn(result.actions, T2, T1)).toHaveLength(1);
    expect(guardStops(result.actions)).toEqual([]);
    expect(checkLiveness(result, state, inputs)).toEqual({ silent: [], emptyCloses: [] });
  });

  it("gives the second held re-run a wait on the first while the full cap holds both", async () => {
    const schedule = await loadSchedule();
    const state = stateOf(bothHeld(dispatched(T3, "developer")));
    const inputs = inputsFor(state);

    const result = schedule(state, inputs, { resume: false });

    expect(verifiesOf(result.actions, T1)).toEqual([]);
    expect(verifiesOf(result.actions, T2)).toEqual([]);
    expect(heldOn(result.actions, T2, T1)).toHaveLength(1);
    expect(guardStops(result.actions)).toEqual([]);
    expect(checkLiveness(result, state, inputs)).toEqual({ silent: [], emptyCloses: [] });
  });
});

describe("schedule: the once-only fix round 5/5 line on the cap stop path", () => {
  const T1 = "TASK-001";
  const capReached = (t: string): Fields => ({ type: "capReached", task: t, failure: "the retry loop is still unbounded" });
  const minimalFix = (t: string): Fields => decided(t, "minimal fix past the cap: bound the retry loop to three attempts");
  /** A reopened task whose fifth round left findings; its `fix round 5/5` line is not written. */
  const reopenedAtCap = (...tail: Fields[]): Fields[] => [
    scan,
    capStart(2),
    ...testsReady(T1),
    ...committedAndUnderReview(T1, "aaa0000"),
    verifyDone(T1, 0),
    done(T1, "code-reviewer", "clean"),
    complete(T1, "commits aaa0000, review clean"),
    reopened(T1),
    ...fiveRoundsWithFindings(T1, "aaa000").slice(0, -1),
    ...tail,
  ];
  const fixCommitted = (): Fields[] => [capReached(T1), minimalFix(T1), ...committedAndUnderReview(T1, "bbb0001"), verifyDone(T1, 0)];
  const plan = (): LoopInputs => inputsOf([task(T1), task("TASK-002", { files: ["src/other.ts"] })]);
  const fiveFiveWrites = (actions: Action[]) => actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T1}: fix round 5/5`));
  /** The 5/5 line is named in the task's stop reason or printed beside it, once. */
  const namesFiveFive = (actions: Action[]): boolean => {
    const stop = actions.find((a) => a.kind === "stop" && a.task === T1);
    const inReason = stop !== undefined && stop.kind === "stop" && stop.reason.includes(`${T1}: fix round 5/5`);
    return inReason || fiveFiveWrites(actions).length === 1;
  };

  it.each([
    ["the cap stop before its cap reached note", (): Fields[] => reopenedAtCap()],
    ["the cap stop after its cap reached note", (): Fields[] => reopenedAtCap(capReached(T1))],
    ["the cap stop with its minimal fix spent", (): Fields[] => reopenedAtCap(...fixCommitted(), done(T1, "code-reviewer", "findings"))],
  ])("names the unwritten fix round 5/5 line on %s", async (_where, events) => {
    const schedule = await loadSchedule();

    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events()), plan(), { resume });

      expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual([T1]);
      expect(namesFiveFive(actions)).toBe(true);
      expect(fiveFiveWrites(actions).length).toBeLessThanOrEqual(1);
    }
  });

  // TASK-002 depends on TASK-001. Both complete, then TASK-002 is reopened and spends its five rounds, the fifth clean
  // with its 5/5 line still unwritten; TASK-001 is reopened and its fix commit owes TASK-002 a cascade re-review,
  // which returns findings with no rounds left.
  it("names the unwritten fix round 5/5 line on the cascade cap stop", async () => {
    const schedule = await loadSchedule();
    const T2 = "TASK-002";
    const events: Fields[] = [
      scan,
      capStart(2),
      ...testsReady(T1),
      ...committedAndUnderReview(T1, "a000000"),
      verifyDone(T1, 0),
      done(T1, "code-reviewer", "clean"),
      complete(T1, "commits a000000, review clean"),
      ...testsReady(T2),
      ...committedAndUnderReview(T2, "c000000"),
      verifyDone(T2, 0),
      done(T2, "code-reviewer", "clean"),
      complete(T2, "commits c000000, review clean"),
      reopened(T2),
    ];
    for (let r = 1; r <= 5; r++) {
      events.push(
        dispatched(T2, "developer", { round: r }),
        done(T2, "developer"),
        commits(T2, `c00000${r}`),
        reviewPackage(T2, `c00000${r}`),
        verifyStarted(T2),
        dispatched(T2, "code-reviewer", { round: r }),
        verifyDone(T2, 0),
        done(T2, "code-reviewer", r === 5 ? "clean" : "findings"),
      );
      if (r < 5) events.push(fixRound(T2, r));
    }
    events.push(
      reopened(T1),
      dispatched(T1, "developer", { round: 1 }),
      done(T1, "developer"),
      commits(T1, "a000001"),
      { type: "cascadeOwed", task: T2, sha: "a000001", otherTask: T1 },
      { type: "dispatched", task: T2, seat: "code-reviewer", model: "sonnet", cascade: "a000001" },
      done(T2, "code-reviewer", "findings"),
    );
    const inputs = inputsOf([task(T1), task(T2, { dependencies: [T1], wave: 2 })]);

    for (const resume of [false, true]) {
      const { actions } = schedule(stateOf(events), inputs, { resume });

      const stops = actions.filter((a) => a.kind === "stop");
      expect(stops.map((a) => a.task)).toEqual([T2]);
      expect(stops[0].kind === "stop" && NO_RULE.test(stops[0].reason)).toBe(false);
      const inReason = stops[0].kind === "stop" && stops[0].reason.includes(`${T2}: fix round 5/5`);
      const writes = actions.filter((a) => a.kind === "write" && a.line.startsWith(`${T2}: fix round 5/5`));
      expect(inReason || writes.length === 1).toBe(true);
      expect(writes.length).toBeLessThanOrEqual(1);
    }
  });

  it("owes no fix round 5/5 line on the cap stop once it is written", async () => {
    const schedule = await loadSchedule();
    const events = reopenedAtCap(fixRound(T1, 5), capReached(T1));

    const { actions } = schedule(stateOf(events), plan(), { resume: false });

    expect(actions.filter((a) => a.kind === "stop").map((a) => a.task)).toEqual([T1]);
    expect(fiveFiveWrites(actions)).toEqual([]);
  });
});

describe("schedule: a task whose only wait is not printed", () => {
  const writers = ["TASK-001", "TASK-002", "TASK-003", "TASK-004"];
  const T5 = "TASK-005";

  // Four test-writers fill the window; TASK-005's writer, closed by a decision, is owed again and held by the window.
  // That wait is not printed, but it still witnesses the task: no guard stop.
  it("gives no guard stop to a task held only by the test-writer window", async () => {
    const schedule = await loadSchedule();
    const state = stateOf([
      scan,
      capStart(2),
      dispatched(T5, "test-writer"),
      done(T5, "test-writer", "NEEDS_CONTEXT"),
      ...writers.map((t) => dispatched(t, "test-writer")),
      decided(T5, "the fixture path is src/tests/fixtures/retry"),
    ]);
    const inputs = inputsOf([...writers.map((t) => task(t)), task(T5)]);

    const result = schedule(state, inputs, { resume: false });

    expect(result.actions.filter((a) => a.kind === "stop")).toEqual([]);
    expect(result.actions.filter((a) => a.kind !== "finished" && a.kind !== "verify-wave" && a.task === T5)).toEqual([]);
    for (const t of writers) expect(result.inFlight).toContainEqual({ task: t, seat: "test-writer" });
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
  "FR-009: \"Sending a finding to the test-writer or automation-writer stays the session's choice\" — kf next names the round developer, and here the session took the test-writer instead";
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
      case "verify-wave":
        return l === `verify wave ${a.wave}: ${a.command}`;
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
