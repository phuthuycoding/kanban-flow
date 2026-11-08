import { describe, it, expect } from "vitest";

import { initialTask } from "../workflow/next/fold.js";
import { verifyStep } from "../workflow/next/verify-region.js";
import type { LoopTask, MachineEvent, TaskState, VerifyRun, VerifyState, World } from "../workflow/next/types.js";

const BASE = Date.parse("2026-11-01T10:00:00Z");
const at = (minute: number): number => BASE + minute * 60_000;

type Body = MachineEvent extends infer E ? (E extends MachineEvent ? Omit<E, "line" | "ts"> : never) : never;
/** An event at `minute`; its ledger line equals the minute so lines in expectations are easy to read. */
const ev = (minute: number, body: Body): MachineEvent => ({ ...body, line: minute, ts: at(minute) }) as MachineEvent;

const EADDR = "Error: listen EADDRINUSE: address already in use :::3000";
const block = (minute: number, exit: number, text: string): VerifyRun => ({ ts: at(minute), exit, text });

function planTask(id: string, wave = 1, overlaps: string[] = []): LoopTask {
  return { id, dependencies: [], files: [`src/${id}.ts`], wave, overlaps, inline: false, testTypes: ["Unit"] };
}

function cycleTask(id: string, plan: LoopTask, extra: Partial<TaskState> = {}): TaskState {
  return {
    ...initialTask(plan),
    phase: { kind: "cycle", cycle: "first", round: 0, openedAt: 1, implementer: { kind: "committed" }, sinceCommit: 2, commits: ["abc1234"] },
    ...extra,
  };
}

interface Seed {
  runs?: Record<string, VerifyRun[]>;
  unknown?: string[];
  /** Other tasks of the plan, by id, with the state they are in. */
  others?: Record<string, Partial<TaskState>>;
  plan?: LoopTask[];
}

function worldOf(seed: Seed = {}): World {
  const plan = seed.plan ?? [planTask("TASK-001"), planTask("TASK-002"), planTask("TASK-003")];
  const tasks = new Map<string, TaskState>();
  for (const p of plan) tasks.set(p.id, cycleTask(p.id, p, seed.others?.[p.id] ?? {}));
  return {
    inputs: {
      feature: "kf-next",
      kind: "feature",
      level: null,
      tasks: plan,
      ceiling: { max: 6, source: "default" },
      reportCommits: {},
      verifyRuns: seed.runs ?? {},
      gitLog: [],
    },
    cap: { n: 2, ceiling: 6, owed: [], contention: { held: [], running: null, blocksDevelopers: false } },
    contention: { held: [], running: null, blocksDevelopers: false },
    scan: "done",
    ceiling: "valid",
    unknown: new Map((seed.unknown ?? []).map((id) => [id, { decided: false }])),
    pool: [],
    tasks,
  };
}

/** Applies the events in order to TASK-001, returning its verify state after each one. */
function play(events: MachineEvent[], seed: Seed = {}, start: Partial<TaskState> = {}): VerifyState[] {
  const world = worldOf(seed);
  let t = { ...(world.tasks.get("TASK-001") as TaskState), ...start };
  return events.map((e) => {
    t = verifyStep(t, e, world);
    return t.verify;
  });
}

const last = (states: VerifyState[]): VerifyState => states[states.length - 1];
const started = (minute: number): MachineEvent => ev(minute, { type: "verifyStarted", task: "TASK-001" });
const done = (minute: number, exit: number): MachineEvent => ev(minute, { type: "verifyDone", task: "TASK-001", exit });
const commit = (minute: number): MachineEvent => ev(minute, { type: "commits", task: "TASK-001", shas: ["def5678"] });

describe("verify region exits", () => {
  it("owes a verify at once when a commit lands", () => {
    expect(last(play([commit(2)]))).toEqual({ kind: "owed", atHead: false, why: "commit" });
  });

  it("runs from the verify started line and passes on exit 0", () => {
    const states = play([commit(2), started(3), done(4, 0)]);
    expect(states[1]).toEqual({ kind: "running", line: 3, rerun: false, stale: false });
    expect(states[2]).toEqual({ kind: "passed", line: 3 });
  });

  it("stops on exit 2", () => {
    expect(last(play([commit(2), started(3), done(4, 2)]))).toEqual({ kind: "exit2Stop" });
  });

  it("decides on exit 3, naming the task's recorded shas the git log does not have", () => {
    const states = play([commit(2), started(3), done(4, 3)], {}, { droppedShas: ["abc1234"] });
    expect(last(states)).toEqual({ kind: "exit3Decide", droppedShas: ["abc1234"] });
  });

  it.each([4, 9])("reads exit %i as an unknown exit carrying the raw code", (raw) => {
    expect(last(play([commit(2), started(3), done(4, raw)]))).toEqual({ kind: "unknownExit", raw });
  });

  it.each([2, 3, 5])("owes the verify again once a decision closes an exit %i", (exit) => {
    const states = play([commit(2), started(3), done(4, exit), ev(5, { type: "decided", task: "TASK-001", what: "ok" })]);
    expect(last(states)).toEqual({ kind: "owed", atHead: false, why: "decided" });
  });

  it("runs again when the verify starts while an exit 3 decide is open", () => {
    const states = play([commit(2), started(3), done(4, 3), started(5)]);
    expect(last(states)).toEqual({ kind: "running", line: 5, rerun: false, stale: false });
  });
});

describe("verify region stale runs", () => {
  it("marks a running verify stale when a commit lands during the run", () => {
    expect(last(play([commit(2), started(3), commit(4)]))).toEqual({ kind: "running", line: 3, rerun: false, stale: true });
  });

  it("owes the verify again, not a pass, when a stale run exits 0", () => {
    const states = play([commit(2), started(3), commit(4), done(5, 0)]);
    expect(last(states)).toMatchObject({ kind: "owed" });
  });

  it("owes a verify after a commit lands on a passed one", () => {
    expect(last(play([commit(2), started(3), done(4, 0), commit(5)]))).toEqual({ kind: "owed", atHead: false, why: "commit" });
  });

  it("owes a verify after a commit lands on a failed one", () => {
    const runs = { "TASK-001": [block(4, 1, "AssertionError: expected 1 to be 2")] };
    expect(last(play([commit(2), started(3), done(4, 1), commit(5)], { runs }))).toMatchObject({ kind: "owed", why: "commit" });
  });
});

describe("verify region plain and contention failures", () => {
  it("owes one plain re-run for a failure with no log block", () => {
    const states = play([commit(2), started(3), done(4, 1)]);
    expect(last(states)).toEqual({ kind: "failed", line: 3, disposition: { kind: "plainRerunOwed" } });
  });

  it("keeps the failure when the plain re-run also fails with no log block", () => {
    const states = play([commit(2), started(3), done(4, 1), started(5), done(6, 1)]);
    expect(last(states)).toMatchObject({ kind: "failed", line: 5, disposition: { kind: "kept" } });
  });

  it("holds a re-run for a failure whose log block names a contention signature", () => {
    const runs = { "TASK-001": [block(4, 1, EADDR)] };
    const states = play([commit(2), started(3), done(4, 1)], { runs });
    expect(last(states)).toEqual({ kind: "failed", line: 3, disposition: { kind: "contentionHeld", signature: "EADDRINUSE" } });
  });

  it("keeps a plain assertion failure that has a log block", () => {
    const runs = { "TASK-001": [block(4, 1, "AssertionError: expected 'a' to be 'b'")] };
    const states = play([commit(2), started(3), done(4, 1)], { runs });
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "kept" } });
  });

  it("reads a log block that predates the verify started as no block", () => {
    const runs = { "TASK-001": [block(1, 1, EADDR)] };
    const states = play([commit(2), started(3), done(4, 1)], { runs });
    expect(last(states)).toMatchObject({ disposition: { kind: "plainRerunOwed" } });
  });

  it("runs the held re-run as a re-run after the rerun note and a verify started", () => {
    const runs = { "TASK-001": [block(4, 1, EADDR)] };
    const states = play(
      [commit(2), started(3), done(4, 1), ev(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }), started(6)],
      { runs },
    );
    expect(last(states)).toEqual({ kind: "running", line: 6, rerun: true, stale: false });
  });

  it("keeps a failing re-run, which never holds another re-run even with a contention block", () => {
    const runs = { "TASK-001": [block(4, 1, EADDR), block(7, 1, EADDR)] };
    const states = play(
      [commit(2), started(3), done(4, 1), ev(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }), started(6), done(7, 1)],
      { runs },
    );
    expect(last(states)).toMatchObject({ kind: "failed", line: 6, disposition: { kind: "kept" } });
  });

  it("passes a re-run on exit 0", () => {
    const runs = { "TASK-001": [block(4, 1, EADDR)] };
    const states = play(
      [commit(2), started(3), done(4, 1), ev(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }), started(6), done(7, 0)],
      { runs },
    );
    expect(last(states)).toEqual({ kind: "passed", line: 6 });
  });
});

describe("verify region orphan re-runs", () => {
  const rerun = ev(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" });

  it("closes an orphan started verify in the fold when a rerun note follows it, holding the re-run again", () => {
    const states = play([commit(2), started(3), rerun]);
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "contentionHeld", signature: "EADDRINUSE" } });
  });

  it("applies the late done of the orphan normally: exit 0 passes and drops the held re-run", () => {
    const states = play([commit(2), started(3), rerun, done(6, 0)]);
    expect(last(states)).toEqual({ kind: "passed", line: 3 });
  });

  it("starts a fresh re-run after the note even when an orphan verify precedes it", () => {
    const states = play([commit(2), started(3), rerun, started(6)]);
    expect(last(states)).toEqual({ kind: "running", line: 6, rerun: true, stale: false });
  });
});

describe("verify region waits", () => {
  const waits = (other: string): MachineEvent => ev(5, { type: "verifyWaits", task: "TASK-001", file: "src/shared.ts", otherTask: other });
  const failedRun = { "TASK-001": [block(4, 1, "AssertionError: expected 1 to be 2")] };
  const prefix = [commit(2), started(3), done(4, 1)];

  it("waits for a task another verify failure names", () => {
    const states = play([...prefix, waits("TASK-002")], { runs: failedRun });
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "waits", otherTask: "TASK-002" } });
  });

  it("is released, owing a verify at the head, when the awaited task's named commit lands", () => {
    const states = play(
      [...prefix, waits("TASK-002"), ev(6, { type: "watchReleased", task: "TASK-001", from: "TASK-002" })],
      { runs: failedRun },
    );
    expect(last(states)).toEqual({ kind: "owed", atHead: true, why: "released" });
  });

  it("stays waiting when no release is delivered", () => {
    const states = play([...prefix, waits("TASK-002"), ev(6, { type: "other", text: "Note: unrelated" })], { runs: failedRun });
    expect(last(states)).toMatchObject({ disposition: { kind: "waits" } });
  });

  it("cannot be released when the awaited task is unknown", () => {
    const states = play([...prefix, waits("TASK-099")], { runs: failedRun, unknown: ["TASK-099"] });
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "waitsUnreleasable", otherTask: "TASK-099" } });
  });

  it("cannot be released when the awaited task overlaps, is not open and ranks later", () => {
    const plan = [planTask("TASK-001", 1, ["TASK-002"]), planTask("TASK-002", 2, ["TASK-001"])];
    const states = play([...prefix, waits("TASK-002")], {
      runs: failedRun,
      plan,
      others: { "TASK-002": { phase: { kind: "pending" } } },
    });
    expect(last(states)).toMatchObject({ disposition: { kind: "waitsUnreleasable", otherTask: "TASK-002" } });
  });
});

describe("verify region routed failures", () => {
  const failedRun = { "TASK-001": [block(4, 1, "AssertionError: expected 1 to be 2")] };
  const prefix = [commit(2), started(3), done(4, 1)];
  const routed = (other: string): MachineEvent => ev(5, { type: "verifyRouted", task: "TASK-001", otherTask: other });

  it("routes a failure out to an open task", () => {
    const states = play([...prefix, routed("TASK-002")], { runs: failedRun });
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "routedOut", otherTask: "TASK-002", line: 5 } });
  });

  it("rejects a route to a task that is already complete", () => {
    const states = play([...prefix, routed("TASK-002")], {
      runs: failedRun,
      others: { "TASK-002": { phase: { kind: "complete", how: "complete" } } },
    });
    expect(last(states)).toMatchObject({ disposition: { kind: "routeRejected", otherTask: "TASK-002" } });
  });

  it("rejects a route to a task the plan does not have", () => {
    const states = play([...prefix, routed("TASK-099")], { runs: failedRun, unknown: ["TASK-099"] });
    expect(last(states)).toMatchObject({ disposition: { kind: "routeRejected", otherTask: "TASK-099" } });
  });

  it("keeps the failure once a decision closes a rejected route", () => {
    const states = play([...prefix, routed("TASK-099"), ev(6, { type: "decided", task: "TASK-001", what: "own round" })], {
      runs: failedRun,
      unknown: ["TASK-099"],
    });
    expect(last(states)).toMatchObject({ kind: "failed", disposition: { kind: "kept" } });
  });

  it("passes by route when the routed-to task answers", () => {
    const states = play([...prefix, routed("TASK-002"), ev(6, { type: "routeAnswered", task: "TASK-001", from: "TASK-002" })], { runs: failedRun });
    expect(last(states)).toEqual({ kind: "passedByRoute" });
  });

  it("passes by route on a later answer even after the task verified again", () => {
    const states = play(
      [...prefix, routed("TASK-002"), ev(6, { type: "routeAnswered", task: "TASK-001", from: "TASK-002" }), ev(7, { type: "routeAnswered", task: "TASK-001", from: "TASK-002" })],
      { runs: failedRun },
    );
    expect(last(states)).toEqual({ kind: "passedByRoute" });
  });

  it("records a failure routed into this task as unanswered, at the routing line", () => {
    const world = worldOf();
    const t = verifyStep(world.tasks.get("TASK-002") as TaskState, ev(5, { type: "routedIn", task: "TASK-002", from: "TASK-001" }), world);
    expect(t.routedIn).toEqual([{ from: "TASK-001", line: 5, answered: false }]);
  });
});
