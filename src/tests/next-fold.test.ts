import { describe, it, expect } from "vitest";

import { LIFECYCLE_TABLE, foldWorld } from "../workflow/next/fold.js";
import type { Cap, LedgerEvent, LoopInputs, LoopTask, TaskState, World } from "../workflow/next/types.js";

// Seeded events go straight into foldWorld: this file tests the lifecycle region of the fold, not the ledger reader.

type Spec = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;

const FIRST_LINE = 3;
const lineOf = (index: number): number => FIRST_LINE + index;

const sha = (prefix: string): string => prefix.padEnd(40, "0");

const task = (id: string, extra: Partial<LoopTask> = {}): LoopTask => ({
  id, dependencies: [], files: [], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"], ...extra,
});

const CAP: Cap = { n: 2, ceiling: 2, owed: [], contention: { held: [], running: null, blocksDevelopers: false } };

function fold(specs: Spec[], opts: { tasks?: LoopTask[]; gitLog?: LoopInputs["gitLog"]; reportCommits?: LoopInputs["reportCommits"]; level?: string | null } = {}): World {
  const events = specs.map((s, i) => ({ ...s, line: lineOf(i), ts: 1_000 + i }) as LedgerEvent);
  const inputs: LoopInputs = {
    feature: "f", kind: "feature", level: opts.level ?? null, tasks: opts.tasks ?? [task("TASK-001")],
    ceiling: { max: 2, source: "default" }, reportCommits: opts.reportCommits ?? {}, verifyRuns: {}, gitLog: opts.gitLog ?? [],
  };
  return foldWorld({ events }, inputs, CAP);
}

function taskOf(world: World, id = "TASK-001"): TaskState {
  const t = world.tasks.get(id);
  if (!t) throw new Error(`the world has no task ${id}`);
  return t;
}

const tw = (id: string, round?: number): Spec => ({ type: "dispatched", task: id, seat: "test-writer", model: "sonnet", ...(round ? { round } : {}) });
const dev = (id: string, extra: { round?: number; model?: string } = {}): Spec => ({
  type: "dispatched", task: id, seat: "developer", model: extra.model ?? "sonnet", ...(extra.round ? { round: extra.round } : {}),
});
const done = (id: string, seat: "test-writer" | "developer" | "automation-writer" | "code-reviewer", status: string): Spec => ({ type: "done", task: id, seat, status });
const hashes = (id: string): Spec => ({ type: "testHashes", task: id, files: { "a.test.ts": "a".repeat(40) } });
const commits = (id: string, ...shas: string[]): Spec => ({ type: "commits", task: id, shas });
const decided = (id: string, what = "go on"): Spec => ({ type: "decided", task: id, what });
const ruling = (...ids: string[]): Spec => ({ type: "other", text: `Ruling: ${ids.join(", ")} — keep the test as written` });
const TASK = "TASK-001";

// Reaches a task whose developer is dispatched in the first pass.
const toDeveloper: Spec[] = [{ type: "noTestWriter", task: TASK, reason: "docs only" }];

describe("the lifecycle table", () => {
  it("has a cell for every event in every phase", () => {
    const events = Object.keys(LIFECYCLE_TABLE.pending).sort();
    for (const phase of ["pending", "tests", "ready", "cycle", "atCap", "complete"] as const) {
      expect(Object.keys(LIFECYCLE_TABLE[phase]).sort()).toEqual(events);
    }
    expect(events).toContain("ruling");
    expect(events).toContain("cascadeLanded");
  });

  it("gives the lifecycle events of each phase a transition rather than a noop", () => {
    const row = (phase: keyof typeof LIFECYCLE_TABLE, event: string): unknown => (LIFECYCLE_TABLE[phase] as Record<string, unknown>)[event];
    expect(row("pending", "noTestWriter")).not.toBe("noop");
    expect(row("pending", "dispatched")).not.toBe("noop");
    expect(row("pending", "complete")).not.toBe("noop");
    expect(row("pending", "implemented")).not.toBe("noop");
    expect(row("tests", "done")).not.toBe("noop");
    expect(row("tests", "testHashes")).not.toBe("noop");
    expect(row("ready", "dispatched")).not.toBe("noop");
    expect(row("cycle", "done")).not.toBe("noop");
    expect(row("cycle", "commits")).not.toBe("noop");
    expect(row("complete", "reopened")).not.toBe("noop");
  });
});

describe("a task before and around its test-writer", () => {
  it("starts every plan task pending, in plan order", () => {
    const world = fold([], { tasks: [task("TASK-001"), task("TASK-002")] });
    expect([...world.tasks.keys()]).toEqual(["TASK-001", "TASK-002"]);
    expect(taskOf(world).phase).toEqual({ kind: "pending" });
    expect(world.pool).toEqual([]);
  });

  it("moves to ready on a no test-writer line", () => {
    expect(taskOf(fold(toDeveloper)).phase).toEqual({ kind: "ready" });
  });

  it("opens the tests phase with a running writer when the test-writer is dispatched", () => {
    const t = taskOf(fold([tw(TASK)]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: false, writer: { kind: "running", line: lineOf(0) } });
    expect(t.seats["test-writer"]).toMatchObject({ kind: "running", line: lineOf(0), inline: false, origin: "progress" });
  });

  it("owes the hashes once the test-writer reports DONE", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE")]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: true });
    expect(t.seats["test-writer"]).toEqual({ kind: "reported", status: "DONE", answers: lineOf(0) });
  });

  it("is ready after the hashes line", () => {
    expect(taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE"), hashes(TASK)])).phase).toEqual({ kind: "ready" });
  });

  it("gates a test-writer that reports DONE_WITH_CONCERNS behind a Seat status judgement and owes no hashes yet", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE_WITH_CONCERNS")]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: false });
    expect(t.seats["test-writer"]).toEqual({ kind: "gated", status: "DONE_WITH_CONCERNS", doneLine: lineOf(1) });
    expect(t.judgements[0]).toMatchObject({ kind: "seatStatus", task: TASK, seat: "test-writer", status: "DONE_WITH_CONCERNS", openedAt: lineOf(1) });
  });

  it("ignores hashes that follow a test-writer done that does not count", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "NEEDS_CONTEXT"), hashes(TASK)]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: false });
  });

  it("owes the hashes when a decided note accepts a test-writer's concerns", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE_WITH_CONCERNS"), decided(TASK)]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: true });
    expect(t.judgements).toEqual([]);
  });

  it("owes the hashes when a Ruling naming the task accepts a test-writer's concerns", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE_WITH_CONCERNS"), ruling(TASK)]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: true });
    expect(t.judgements).toEqual([]);
  });

  it.each([["decided note", decided(TASK)], ["Ruling", ruling(TASK)]] as const)(
    "records the dispatch line as the answered line when a %s closes a test-writer's concerns",
    (_name, decision) => {
      const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "DONE_WITH_CONCERNS"), decision]));
      expect(t.seats["test-writer"]).toEqual({ kind: "reported", status: "DONE_WITH_CONCERNS", answers: lineOf(0) });
    },
  );

  it.each([
    ["decided note", "NEEDS_CONTEXT", decided(TASK)],
    ["Ruling", "NEEDS_CONTEXT", ruling(TASK)],
    ["decided note", "BLOCKED", decided(TASK)],
    ["Ruling", "BLOCKED", ruling(TASK)],
    ["decided note", "FAILED", decided(TASK)],
    ["Ruling", "FAILED", ruling(TASK)],
  ] as const)("owes a test-writer redispatch, never the hashes, when a %s closes a test-writer that ended %s", (_name, status, decision) => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", status), decision]));
    expect(t.judgements).toEqual([]);
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: false });
    expect(t.seats["test-writer"]).toEqual({ kind: "idle" });
  });

  it("does not take the hashes of a test-writer closed by a decision after it ended NEEDS_CONTEXT", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "NEEDS_CONTEXT"), decided(TASK), hashes(TASK)]));
    expect(t.phase).toMatchObject({ kind: "tests", hashOwed: false });
  });

  it("runs the test-writer again when it is re-dispatched after a gate", () => {
    const t = taskOf(fold([tw(TASK), done(TASK, "test-writer", "NEEDS_CONTEXT"), tw(TASK)]));
    expect(t.seats["test-writer"]).toMatchObject({ kind: "running", line: lineOf(2) });
    expect(t.judgements).toEqual([]);
  });
});

describe("the first developer pass", () => {
  it("opens a first cycle with a running implementer when the developer is dispatched", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK)]));
    expect(t.phase).toMatchObject({ kind: "cycle", cycle: "first", round: 0, openedAt: lineOf(1), implementer: { kind: "running", dispatchLine: lineOf(1), inline: false } });
    expect(t.seats.developer).toMatchObject({ kind: "running", line: lineOf(1), inline: false, origin: "progress" });
  });

  it("opens the first cycle for a developer dispatched on a legacy ledger with no test-writer line", () => {
    expect(taskOf(fold([dev(TASK)])).phase).toMatchObject({ kind: "cycle", cycle: "first", implementer: { kind: "running" } });
  });

  it("treats a model=inline dispatch as an inline developer", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK, { model: "inline" })]));
    expect(t.inline).toBe(true);
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "running", inline: true } });
    expect(t.seats.developer).toMatchObject({ kind: "running", inline: true });
  });

  it("marks the task inline from the plan flag or from an inline note", () => {
    expect(taskOf(fold([], { tasks: [task(TASK, { inline: true })] })).inline).toBe(true);
    expect(taskOf(fold([{ type: "inline", task: TASK }])).inline).toBe(true);
    expect(taskOf(fold([])).inline).toBe(false);
  });

  it("is committed when the developer reports DONE and a commits note follows", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" }, sinceCommit: lineOf(3), commits: ["aaaaaaa"] });
    expect(t.judgements).toEqual([]);
  });

  it("is committed when the commits note came before the developer's done", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), commits(TASK, "aaaaaaa"), done(TASK, "developer", "DONE")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" } });
  });

  it("records the developer's DONE as the seat's report", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE")]));
    expect(t.seats.developer).toMatchObject({ kind: "reported", status: "DONE", answers: lineOf(1) });
  });

  it("owes a Commit missing decision when the developer is DONE with no commit recorded", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "commitMissing", dispatchLine: lineOf(1) } });
    expect(t.judgements[0]).toMatchObject({ kind: "commitMissing", task: TASK, dispatchLine: lineOf(1) });
  });

  it("closes Commit missing on a commits note and resolves the implementer as committed", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" } });
    expect(t.judgements).toEqual([]);
  });

  it("runs the developer again, and drops the Commit missing decision, when the developer is re-dispatched", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), dev(TASK)]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "running", dispatchLine: lineOf(3) } });
    expect(t.judgements).toEqual([]);
    expect(t.seats.developer).toMatchObject({ kind: "running", line: lineOf(3) });
  });

  it("owes a commits note when the report names shas that git log has and the ledger does not", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE")], {
      reportCommits: { [TASK]: ["abc1234"] },
      gitLog: [{ sha: sha("abc1234"), ts: 1 }],
    });
    const implementer = (taskOf(world).phase as { implementer: { kind: string; shas?: string[] } }).implementer;
    expect(implementer.kind).toBe("commitNoteOwed");
    expect(implementer.shas).toHaveLength(1);
    expect(implementer.shas![0].startsWith("abc1234")).toBe(true);
  });

  it("owes the automation-writer's specs after the commit of a UI task at Level full", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa")], {
      tasks: [task(TASK, { testTypes: ["Unit", "UI"] })],
      level: "full",
    });
    expect(taskOf(world).phase).toMatchObject({ kind: "cycle", implementer: { kind: "specsOwed" } });
  });

  it("does not owe specs for a UI task below Level full", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa")], {
      tasks: [task(TASK, { testTypes: ["UI"] })],
      level: "standard",
    });
    expect(taskOf(world).phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" } });
  });
});

describe("a developer seat closed by a decision", () => {
  it.each(["NEEDS_CONTEXT", "BLOCKED", "DONE_WITH_CONCERNS"])("gates a developer that reports %s behind a Seat status judgement", (status) => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", status)]));
    expect(t.seats.developer).toEqual({ kind: "gated", status, doneLine: lineOf(2) });
    expect(t.judgements[0]).toMatchObject({ kind: "seatStatus", task: TASK, seat: "developer", status, openedAt: lineOf(2) });
  });

  it("gates a developer status outside the closed set and keeps its raw text", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "FAILED")]));
    expect(t.seats.developer).toEqual({ kind: "gated", status: { unknown: "FAILED" }, doneLine: lineOf(2) });
    expect(t.judgements[0]).toMatchObject({ kind: "seatStatus", status: { unknown: "FAILED" } });
  });

  it("runs the developer again when it is re-dispatched after the gate", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "NEEDS_CONTEXT"), dev(TASK)]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "running", dispatchLine: lineOf(3) } });
    expect(t.judgements).toEqual([]);
  });

  it("goes on as DONE after a decided note, so a developer with no commit gets Commit missing instead of silence", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "NEEDS_CONTEXT"), decided(TASK, "supply the schema")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "commitMissing", dispatchLine: lineOf(1) } });
    expect(t.judgements.map((j) => j.kind)).toEqual(["commitMissing"]);
  });

  it("goes on as DONE after a Ruling naming the task", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "NEEDS_CONTEXT"), ruling(TASK)]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "commitMissing" } });
    expect(t.judgements.map((j) => j.kind)).toEqual(["commitMissing"]);
  });

  it("goes on as DONE after a decided note on a BLOCKED developer, and is committed when a commit exists", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), commits(TASK, "aaaaaaa"), done(TASK, "developer", "BLOCKED"), decided(TASK, "test fixed")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" } });
    expect(t.judgements).toEqual([]);
  });

  it("closes a BLOCKED developer's gate on a commits note and resolves the implementer as committed", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "BLOCKED"), commits(TASK, "aaaaaaa")]));
    expect(t.phase).toMatchObject({ kind: "cycle", implementer: { kind: "committed" } });
    expect(t.judgements).toEqual([]);
  });

  it("leaves a gated developer open when a decided note names another task", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "NEEDS_CONTEXT"), decided("TASK-002")], { tasks: [task(TASK), task("TASK-002")] });
    expect(taskOf(world).seats.developer).toMatchObject({ kind: "gated" });
    expect(taskOf(world).judgements.map((j) => j.kind)).toEqual(["seatStatus"]);
  });

  it("closes one gate per decided note, earliest first", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "NEEDS_CONTEXT"), tw(TASK), done(TASK, "test-writer", "BLOCKED"), decided(TASK)]);
    const t = taskOf(world);
    const open = t.judgements.filter((j) => j.kind === "seatStatus");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ seat: "test-writer" });
  });

  it("closes the gate of each task a Ruling names", () => {
    const world = fold(
      [
        { type: "noTestWriter", task: TASK, reason: "docs" }, { type: "noTestWriter", task: "TASK-002", reason: "docs" },
        dev(TASK), dev("TASK-002"), done(TASK, "developer", "NEEDS_CONTEXT"), done("TASK-002", "developer", "NEEDS_CONTEXT"),
        ruling(TASK, "TASK-002"),
      ],
      { tasks: [task(TASK), task("TASK-002")] },
    );
    for (const id of [TASK, "TASK-002"]) {
      expect(taskOf(world, id).judgements.map((j) => j.kind)).toEqual(["commitMissing"]);
    }
  });

  it("ignores a decided note when no judgement is open", () => {
    const before = taskOf(fold([...toDeveloper, dev(TASK)]));
    const after = taskOf(fold([...toDeveloper, dev(TASK), decided(TASK)]));
    expect(before.phase).toMatchObject({ kind: "cycle", implementer: { kind: "running" } });
    expect(after.phase).toEqual(before.phase);
    expect(after.judgements).toEqual([]);
  });
});

describe("an automation-writer seat closed by a decision", () => {
  const uiTask = task(TASK, { testTypes: ["Unit", "UI"] });
  const toSpecs: Spec[] = [...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa"), { type: "dispatched", task: TASK, seat: "automation-writer", model: "sonnet" }];

  it.each([["decided note", decided(TASK)], ["Ruling", ruling(TASK)]] as const)(
    "records the dispatch line as the answered line when a %s closes its concerns",
    (_name, decision) => {
      const t = taskOf(fold([...toSpecs, done(TASK, "automation-writer", "DONE_WITH_CONCERNS"), decision], { tasks: [uiTask], level: "full" }));
      expect(t.seats["automation-writer"]).toEqual({ kind: "reported", status: "DONE_WITH_CONCERNS", answers: lineOf(4) });
    },
  );
});

describe("a fix round's developer", () => {
  const firstPass: Spec[] = [...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa")];

  it("owes Commit missing when the round's developer is DONE with no commit after its own dispatch", () => {
    const t = taskOf(fold([...firstPass, { type: "fixRound", task: TASK, round: 1 }, dev(TASK, { round: 1 }), done(TASK, "developer", "DONE")]));
    expect(t.phase).toMatchObject({ kind: "cycle", cycle: "round", round: 1, implementer: { kind: "commitMissing", dispatchLine: lineOf(5) } });
    expect(t.judgements[0]).toMatchObject({ kind: "commitMissing", dispatchLine: lineOf(5) });
  });

  it("is committed once a commits note follows the round's dispatch", () => {
    const t = taskOf(fold([...firstPass, { type: "fixRound", task: TASK, round: 1 }, dev(TASK, { round: 1 }), done(TASK, "developer", "DONE"), commits(TASK, "bbbbbbb")]));
    expect(t.phase).toMatchObject({ kind: "cycle", round: 1, implementer: { kind: "committed" }, sinceCommit: lineOf(7) });
    expect(t.judgements).toEqual([]);
  });
});

describe("completion and reopening", () => {
  it("is complete on a complete line", () => {
    expect(taskOf(fold([...toDeveloper, { type: "complete", task: TASK, text: "ok" }])).phase).toEqual({ kind: "complete", how: "complete" });
  });

  it("stays how complete when the complete note says not superseded", () => {
    const t = taskOf(fold([...toDeveloper, { type: "complete", task: TASK, text: "complete (not superseded — the cascade is still live)" }]));
    expect(t.phase).toEqual({ kind: "complete", how: "complete" });
  });

  it("is how superseded only on a complete note that says superseded by", () => {
    const t = taskOf(fold([...toDeveloper, { type: "complete", task: TASK, text: "complete (superseded by TASK-002)" }]));
    expect(t.phase).toEqual({ kind: "complete", how: "superseded" });
  });

  it("is complete on an implemented line", () => {
    expect(taskOf(fold([{ type: "implemented", task: TASK }])).phase).toEqual({ kind: "complete", how: "implemented" });
  });

  it("starts a fix round when a complete task is reopened, and marks it reopened", () => {
    const t = taskOf(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa"), { type: "complete", task: TASK, text: "ok" }, { type: "reopened", task: TASK, source: "ci", execution: "1a2b3c4d" }]));
    expect(t.reopened).toBe(true);
    expect(t.phase).toMatchObject({ kind: "cycle", cycle: "round" });
  });

  it("does not mark a task that was never reopened", () => {
    expect(taskOf(fold([{ type: "implemented", task: TASK }])).reopened).toBe(false);
  });

  it("reads a task's life as the events after its latest reopen, so an earlier running developer does not survive it", () => {
    const t = taskOf(fold([dev(TASK), { type: "complete", task: TASK, text: "ok" }, { type: "reopened", task: TASK, source: "ci", execution: "1a2b3c4d" }]));
    expect(t.seats.developer.kind).not.toBe("running");
  });

  it("does not let another task's events change a task's phase", () => {
    const world = fold([tw("TASK-002")], { tasks: [task(TASK), task("TASK-002")] });
    expect(taskOf(world).phase).toEqual({ kind: "pending" });
    expect(taskOf(world, "TASK-002").phase).toMatchObject({ kind: "tests" });
  });

  it("keeps an implemented task complete when a later dispatch names it, until a reopen", () => {
    const world = fold([{ type: "implemented", task: "TASK-002" }, tw("TASK-002")], { tasks: [task(TASK), task("TASK-002")] });
    expect(taskOf(world, "TASK-002").phase).toEqual({ kind: "complete", how: "implemented" });
  });
});

describe("the developer pool", () => {
  it("holds the open non-inline developer rows of known tasks, with their dispatch line and round", () => {
    const world = fold([...toDeveloper, dev(TASK)]);
    expect(world.pool).toEqual([{ task: TASK, line: lineOf(1) }]);
  });

  it("carries the round of a fix-round developer", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa"), { type: "fixRound", task: TASK, round: 2 }, dev(TASK, { round: 2 })]);
    expect(world.pool).toEqual([{ task: TASK, line: lineOf(5), round: 2 }]);
  });

  it("leaves out an inline developer", () => {
    expect(fold([...toDeveloper, dev(TASK, { model: "inline" })]).pool).toEqual([]);
  });

  it("leaves out a developer that has reported", () => {
    expect(fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE")]).pool).toEqual([]);
  });

  it("leaves out a developer whose task is complete, so an orphan seat does not hold the cap", () => {
    const world = fold([...toDeveloper, dev(TASK), { type: "complete", task: TASK, text: "superseded by contract" }]);
    expect(world.pool).toEqual([]);
  });

  it("leaves out a developer of an implemented task", () => {
    expect(fold([dev(TASK), { type: "implemented", task: TASK }]).pool).toEqual([]);
  });

  it("leaves out a developer of a task the plan does not have", () => {
    expect(fold([dev("TASK-009")]).pool).toEqual([]);
  });

  it("lists the rows in dispatch order", () => {
    const world = fold([...toDeveloper, { type: "noTestWriter", task: "TASK-002", reason: "docs" }, dev("TASK-002"), dev(TASK)], { tasks: [task(TASK), task("TASK-002")] });
    expect(world.pool.map((p) => p.task)).toEqual(["TASK-002", TASK]);
  });

  it("counts the developer of a reopened task again once it is dispatched", () => {
    const world = fold([...toDeveloper, { type: "complete", task: TASK, text: "ok" }, { type: "reopened", task: TASK, source: "ci", execution: "1a2b3c4d" }, dev(TASK)]);
    expect(world.pool.map((p) => p.task)).toEqual([TASK]);
  });
});

describe("tasks the plan does not have", () => {
  it("collects a task named by an event", () => {
    const world = fold([dev("TASK-009")]);
    expect(world.unknown.get("TASK-009")).toEqual({ decided: false });
    expect(world.unknown.has(TASK)).toBe(false);
  });

  it("marks the unknown task decided once a decided note names it", () => {
    expect(fold([dev("TASK-009"), decided("TASK-009", "dropped by replan")]).unknown.get("TASK-009")).toEqual({ decided: true });
  });

  it("collects the other task of a verify waits note", () => {
    const world = fold([{ type: "verifyWaits", task: TASK, file: "src/x.ts", otherTask: "TASK-008" }]);
    expect(world.unknown.has("TASK-008")).toBe(true);
  });

  it("collects the other task of a verify routed note", () => {
    const world = fold([{ type: "verifyRouted", task: TASK, otherTask: "TASK-008" }]);
    expect(world.unknown.has("TASK-008")).toBe(true);
  });

  it("does not collect a plan task", () => {
    const world = fold([{ type: "verifyRouted", task: TASK, otherTask: "TASK-002" }], { tasks: [task(TASK), task("TASK-002")] });
    expect(world.unknown.size).toBe(0);
  });
});

describe("a task's commits against git log", () => {
  it("keeps the commits git log has and names the dropped ones", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "aaaaaaa", "deadbee")], { gitLog: [{ sha: sha("aaaaaaa"), ts: 1 }] });
    const t = taskOf(world);
    expect(t.commits).toEqual(["aaaaaaa"]);
    expect(t.droppedShas).toEqual(["deadbee"]);
  });

  it("matches a short sha against a full one in either direction", () => {
    const world = fold([commits(TASK, sha("bbbbbbb"), "ccccccc")], { gitLog: [{ sha: "bbbbbbb", ts: 1 }, { sha: sha("ccccccc"), ts: 2 }] });
    expect(taskOf(world).droppedShas).toEqual([]);
    expect(taskOf(world).commits).toHaveLength(2);
  });

  it("keeps every commit when git log is empty", () => {
    const t = taskOf(fold([commits(TASK, "aaaaaaa", "deadbee")]));
    expect(t.commits).toEqual(["aaaaaaa", "deadbee"]);
    expect(t.droppedShas).toEqual([]);
  });

  it("orders the commits as git log does", () => {
    const world = fold([commits(TASK, "bbbbbbb", "aaaaaaa")], { gitLog: [{ sha: sha("aaaaaaa"), ts: 1 }, { sha: sha("bbbbbbb"), ts: 2 }] });
    expect(taskOf(world).commits).toEqual(["aaaaaaa", "bbbbbbb"]);
  });

  it("does not count a dropped sha as a recorded commit for the commit check", () => {
    const world = fold([...toDeveloper, dev(TASK), done(TASK, "developer", "DONE"), commits(TASK, "deadbee")], { gitLog: [{ sha: sha("aaaaaaa"), ts: 1 }] });
    expect(taskOf(world).commits).toEqual([]);
    expect(taskOf(world).droppedShas).toEqual(["deadbee"]);
  });
});
