import { execFileSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import { seatActions } from "../workflow/next/seats.js";
import type { Action, Cap, LedgerEvent, LedgerState, LoopInputs, LoopTask, Seat, TestType } from "../workflow/next/types.js";

/** The quoted form a printed record must carry: single quotes, each ' written as '\''. */
const q = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

// Ledger events and loop inputs are built as literals: the rule module is pure and reads nothing else.

type Fields = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;

const T0 = Date.parse("2026-11-01T10:00:00Z");

function stateOf(...events: Fields[]): LedgerState {
  return { events: events.map((e, i) => ({ ...e, line: i + 3, ts: T0 + i * 60_000 }) as LedgerEvent) };
}

const scanClean: Fields = { type: "scan", clean: true };
const dispatched = (task: string, seat: Seat, extra: { model?: string; round?: number } = {}): Fields => ({
  type: "dispatched",
  task,
  seat,
  model: extra.model ?? "opus",
  ...(extra.round !== undefined ? { round: extra.round } : {}),
});
const done = (task: string, seat: Seat, status = "DONE"): Fields => ({ type: "done", task, seat, status });
const hashes = (task: string): Fields => ({ type: "testHashes", task, files: { [`src/tests/${task}.test.ts`]: "a".repeat(40) } });
const noTestWriter = (task: string): Fields => ({ type: "noTestWriter", task, reason: "docs only" });
const commitsNote = (task: string, ...shas: string[]): Fields => ({ type: "commits", task, shas });
/** A task whose test-writer finished and whose test hashes are recorded: ready for its developer. */
const testsReady = (task: string): Fields[] => [dispatched(task, "test-writer"), done(task, "test-writer"), hashes(task)];

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

function capOf(n: number, contention: Partial<Cap["contention"]> = {}): Cap {
  return { n, ceiling: 4, owed: [], contention: { held: [], running: null, blocksDevelopers: false, ...contention } };
}

const sha40 = (sha7: string): string => sha7 + "0".repeat(33);
const logOf = (...sha7s: string[]) => sha7s.map((s, i) => ({ sha: sha40(s), ts: T0 + i * 1000 }));

const dispatches = (actions: Action[], seat: Seat, taskId?: string) =>
  actions.filter((a): a is Extract<Action, { kind: "dispatch" }> => a.kind === "dispatch" && a.seat === seat && (taskId === undefined || a.task === taskId));
const writes = (actions: Action[]) => actions.filter((a): a is Extract<Action, { kind: "write" }> => a.kind === "write");
const waits = (actions: Action[], taskId: string) =>
  actions.filter((a): a is Extract<Action, { kind: "wait" }> => a.kind === "wait" && a.task === taskId);
const verifies = (actions: Action[], taskId: string) =>
  actions.filter((a): a is Extract<Action, { kind: "verify" }> => a.kind === "verify" && a.task === taskId);

describe("seatActions conflict scan", () => {
  it("asks for the conflict scan on an empty ledger and releases no seat", () => {
    const actions = seatActions(stateOf(), inputsOf([task("TASK-001"), task("TASK-002"), task("TASK-003")]), capOf(2));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "decide", rule: "Conflict scan" });
    expect((actions[0] as Extract<Action, { kind: "decide" }>).closes.startsWith("Scan:")).toBe(true);
  });

  it("asks for the same scan decide with a one-task plan", () => {
    const actions = seatActions(stateOf(), inputsOf([task("TASK-001")]), capOf(1));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "decide", rule: "Conflict scan" });
  });
});

describe("seatActions test-writers ahead", () => {
  it("releases test-writers for tasks with Unit or Integration tests and owes a no test-writer line for the rest", () => {
    const tasks = [
      task("TASK-001", { wave: 1, testTypes: ["Unit"] }),
      task("TASK-002", { wave: 2, testTypes: ["Integration"] }),
      task("TASK-003", { wave: 3, testTypes: ["UI"] }),
    ];
    const actions = seatActions(stateOf(scanClean), inputsOf(tasks), capOf(2));
    expect(actions).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "test-writer", mode: "new" },
      { kind: "dispatch", task: "TASK-002", seat: "test-writer", mode: "new" },
      expect.objectContaining({
        kind: "write",
        line: "TASK-003: no test-writer — <why>",
        record: `kf record feat line -- ${q("TASK-003: no test-writer — <why>")}`,
      }),
    ]);
    expect(dispatches(actions, "developer")).toHaveLength(0);
  });

  it("tops the test-writers up to four in flight, earliest first, and names the parallel wave line", () => {
    const ids = ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005", "TASK-006"];
    const actions = seatActions(stateOf(scanClean, dispatched("TASK-001", "test-writer")), inputsOf(ids.map((id) => task(id))), capOf(2));
    expect(dispatches(actions, "test-writer").map((a) => a.task)).toEqual(["TASK-002", "TASK-003", "TASK-004"]);
    const line = "wave 1: parallel test-writers TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006 — disjoint Files";
    expect(writes(actions).filter((w) => w.line.startsWith("wave 1:"))).toEqual([
      expect.objectContaining({ kind: "write", line, record: `kf record feat line -- ${q(line)}` }),
    ]);
  });

  it("does not name the wave line again once the ledger holds one", () => {
    const ids = ["TASK-001", "TASK-002", "TASK-003"];
    const state = stateOf(scanClean, { type: "other", text: "wave 1: parallel test-writers TASK-001, TASK-002, TASK-003 — disjoint Files" });
    const actions = seatActions(state, inputsOf(ids.map((id) => task(id))), capOf(2));
    expect(dispatches(actions, "test-writer")).toHaveLength(3);
    expect(writes(actions).filter((w) => w.line.startsWith("wave 1:"))).toHaveLength(0);
  });

  it("names a sequential wave line for the first overlapping pair and holds the later task's test-writer", () => {
    const tasks = [
      task("TASK-001"),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-003"] }),
      task("TASK-003", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-004"),
      task("TASK-005"),
    ];
    const actions = seatActions(stateOf(scanClean, dispatched("TASK-001", "test-writer")), inputsOf(tasks), capOf(2));
    expect(dispatches(actions, "test-writer").map((a) => a.task)).toEqual(["TASK-002", "TASK-004", "TASK-005"]);
    const line = "wave 1: sequential TASK-002, TASK-003 — Files overlap src/shared.ts / src/shared.ts";
    expect(writes(actions).filter((w) => w.line.startsWith("wave 1:"))).toEqual([
      expect.objectContaining({ line, record: `kf record feat line -- ${q(line)}` }),
    ]);
  });

  it("releases no test-writer for a task whose Files overlap an open task", () => {
    const tasks = [
      task("TASK-001", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-001"], wave: 2 }),
    ];
    const state = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"));
    const actions = seatActions(state, inputsOf(tasks), capOf(2));
    expect(dispatches(actions, "test-writer", "TASK-002")).toHaveLength(0);
  });

  it("releases no test-writer for a task that overlaps an earlier incomplete task not yet started", () => {
    const tasks = [
      task("TASK-001", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-001"], wave: 2 }),
    ];
    const actions = seatActions(stateOf(scanClean), inputsOf(tasks), capOf(2));
    expect(dispatches(actions, "test-writer").map((a) => a.task)).toEqual(["TASK-001"]);
  });

  it("owes the test hashes line after a test-writer's done", () => {
    const state = stateOf(scanClean, dispatched("TASK-001", "test-writer"), done("TASK-001", "test-writer"));
    const actions = seatActions(state, inputsOf([task("TASK-001")]), capOf(2));
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({
        line: "TASK-001: test hashes <file>=<sha> …",
        record: `kf record feat line -- ${q("TASK-001: test hashes <file>=<sha> …")}`,
      }),
    );
    expect(dispatches(actions, "developer")).toHaveLength(0);
    expect(waits(actions, "TASK-001")).toEqual([expect.objectContaining({ reason: "no test hashes yet" })]);
  });
});

describe("seatActions developer release", () => {
  it("holds a developer whose Files overlap an open task, naming the holder, and owes the developer waits line once", () => {
    const tasks = [
      task("TASK-001", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-001"] }),
    ];
    const reason = "Files overlap src/shared.ts / src/shared.ts (TASK-001)";
    const base = [scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002")];

    const first = seatActions(stateOf(...base), inputsOf(tasks), capOf(4));
    expect(dispatches(first, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(first, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason }]);
    expect(writes(first).filter((w) => w.line.startsWith("TASK-002: developer waits"))).toEqual([
      expect.objectContaining({
        line: `TASK-002: developer waits — ${reason}`,
        record: `kf record feat waits TASK-002 -- ${q(reason)}`,
      }),
    ]);

    const again = seatActions(stateOf(...base, { type: "developerWaits", task: "TASK-002", reason }), inputsOf(tasks), capOf(4));
    expect(waits(again, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason }]);
    expect(writes(again).filter((w) => w.line.startsWith("TASK-002: developer waits"))).toHaveLength(0);
  });

  it("releases no new developer when N are in flight and a fix round holds the next seat", () => {
    const tasks = [task("TASK-001"), task("TASK-002"), task("TASK-003")];
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      ...testsReady("TASK-002"),
      dispatched("TASK-002", "developer"),
      ...testsReady("TASK-003"),
    );
    const actions = seatActions(state, inputsOf(tasks), capOf(2), 1);
    expect(dispatches(actions, "developer")).toHaveLength(0);
    expect(waits(actions, "TASK-003")).toEqual([{ kind: "wait", task: "TASK-003", reason: "2 developers in flight" }]);
  });

  it("gives a freed seat to the fix round before a new task's developer", () => {
    const tasks = [task("TASK-001"), task("TASK-002")];
    const state = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002"));

    const withFixRound = seatActions(state, inputsOf(tasks), capOf(2), 1);
    expect(dispatches(withFixRound, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(withFixRound, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason: "2 developers in flight" }]);
    expect(writes(withFixRound)).toContainEqual(
      expect.objectContaining({ line: "TASK-002: developer waits — 2 developers in flight" }),
    );

    const withoutFixRound = seatActions(state, inputsOf(tasks), capOf(2));
    expect(dispatches(withoutFixRound, "developer", "TASK-002")).toEqual([
      { kind: "dispatch", task: "TASK-002", seat: "developer", mode: "new" },
    ]);
  });

  it("starts an inline task's developer outside the cap", () => {
    const tasks = [task("TASK-001", { wave: 1 }), task("TASK-002", { wave: 2, inline: true })];
    const state = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002"));
    const actions = seatActions(state, inputsOf(tasks), capOf(1));
    expect(dispatches(actions, "developer", "TASK-002")).toEqual([
      { kind: "dispatch", task: "TASK-002", seat: "developer", mode: "new", inline: true },
    ]);
    expect(waits(actions, "TASK-002")).toHaveLength(0);
  });

  it("counts a chain developer in an inline wave against the cap", () => {
    const tasks = [task("TASK-001", { wave: 1, inline: true }), task("TASK-002", { wave: 2 })];
    const chain = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002"));
    const held = seatActions(chain, inputsOf(tasks), capOf(1));
    expect(dispatches(held, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(held, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason: "1 developers in flight" }]);

    // The same wave filled by the controller itself leaves the seat free.
    const inlineSeat = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer", { model: "inline" }),
      { type: "inline", task: "TASK-001" },
      ...testsReady("TASK-002"),
    );
    const released = seatActions(inlineSeat, inputsOf(tasks), capOf(1));
    expect(dispatches(released, "developer", "TASK-002")).toEqual([
      { kind: "dispatch", task: "TASK-002", seat: "developer", mode: "new" },
    ]);
  });

  it("holds a developer whose dependency has no commit", () => {
    const tasks = [task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"] })];
    const state = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002"));
    const actions = seatActions(state, inputsOf(tasks), capOf(4));
    expect(dispatches(actions, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(actions, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason: "dependency TASK-001 has no commit" }]);
  });

  it("releases a developer once its dependency's developer finished with a commit", () => {
    const tasks = [task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"] })];
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer"),
      commitsNote("TASK-001", "abc1234"),
      ...testsReady("TASK-002"),
    );
    const actions = seatActions(state, inputsOf(tasks, { gitLog: logOf("abc1234") }), capOf(4));
    expect(dispatches(actions, "developer", "TASK-002")).toEqual([
      { kind: "dispatch", task: "TASK-002", seat: "developer", mode: "new" },
    ]);
  });

  it("counts a dependency whose BLOCKED developer was decided and has a commit as finished", () => {
    const tasks = [task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"] })];
    const decidedDep = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer", "BLOCKED"),
      { type: "decided", task: "TASK-001", what: "commit made, go on" },
      ...testsReady("TASK-002"),
    );
    const inputs = inputsOf(tasks, { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    expect(dispatches(seatActions(decidedDep, inputs, capOf(4)), "developer", "TASK-002")).toEqual([
      { kind: "dispatch", task: "TASK-002", seat: "developer", mode: "new" },
    ]);

    const undecidedDep = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer", "BLOCKED"),
      ...testsReady("TASK-002"),
    );
    const held = seatActions(undecidedDep, inputs, capOf(4));
    expect(dispatches(held, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(held, "TASK-002")).toEqual([{ kind: "wait", task: "TASK-002", reason: "dependency TASK-001 has no commit" }]);
  });

  it("holds a developer whose task has no test hashes yet", () => {
    const state = stateOf(scanClean, dispatched("TASK-001", "test-writer"), done("TASK-001", "test-writer"));
    const actions = seatActions(state, inputsOf([task("TASK-001")]), capOf(4));
    expect(dispatches(actions, "developer")).toHaveLength(0);
    expect(waits(actions, "TASK-001")).toEqual([{ kind: "wait", task: "TASK-001", reason: "no test hashes yet" }]);
  });

  it("holds a developer whose Files are unknown while another task is open", () => {
    const tasks = [task("TASK-001", { overlaps: ["TASK-002"] }), task("TASK-002", { files: null, overlaps: ["TASK-001"] })];
    const state = stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), noTestWriter("TASK-002"));
    const actions = seatActions(state, inputsOf(tasks), capOf(4));
    expect(dispatches(actions, "developer", "TASK-002")).toHaveLength(0);
    const held = waits(actions, "TASK-002");
    expect(held).toHaveLength(1);
    expect(held[0].reason).toMatch(/^Files overlap Files unknown \/ .+ \(TASK-001\)$/);
  });

  it("holds a developer while an earlier overlapping task is incomplete", () => {
    const tasks = [
      task("TASK-001", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-001"] }),
    ];
    const actions = seatActions(stateOf(scanClean, noTestWriter("TASK-002")), inputsOf(tasks), capOf(4));
    expect(dispatches(actions, "developer", "TASK-002")).toHaveLength(0);
    expect(waits(actions, "TASK-002")).toEqual([
      { kind: "wait", task: "TASK-002", reason: "earlier overlapping TASK-001 incomplete" },
    ]);
  });

  it("holds new developers while a contention re-run is held", () => {
    const state = stateOf(scanClean, ...testsReady("TASK-001"));
    const cap = capOf(4, { held: [{ task: "TASK-009", atHead: false, kind: "rerun" }], blocksDevelopers: true });
    const actions = seatActions(state, inputsOf([task("TASK-001")]), cap);
    expect(dispatches(actions, "developer")).toHaveLength(0);
    expect(waits(actions, "TASK-001")).toEqual([{ kind: "wait", task: "TASK-001", reason: "held re-run TASK-009" }]);
  });
});

describe("seatActions after a developer's commit", () => {
  const developed = (...extra: Fields[]) =>
    stateOf(scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), done("TASK-001", "developer"), ...extra);

  it("names the review package, the verify and the code-reviewer in one call", () => {
    const inputs = inputsOf([task("TASK-001")], {
      reportCommits: { "TASK-001": ["abc1234", "def5678"] },
      gitLog: logOf("abc1234", "def5678"),
    });
    const actions = seatActions(developed(commitsNote("TASK-001", "abc1234", "def5678")), inputs, capOf(2));
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({
        line: "TASK-001: review package abc1234,def5678",
        record: `kf record feat line -- ${q("TASK-001: review package abc1234,def5678")}`,
      }),
    );
    expect(verifies(actions, "TASK-001")).toEqual([
      expect.objectContaining({ kind: "verify", task: "TASK-001", command: "kf verify feat --task TASK-001 --commits abc1234,def5678" }),
    ]);
    expect(dispatches(actions, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new" },
    ]);
  });

  // A session that lost context between the two steps must still be told the half it did not record.
  it("still names the code-reviewer when only the verify has started", () => {
    const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const actions = seatActions(
      developed({ type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] }, { type: "verifyStarted", task: "TASK-001" }),
      inputs,
      capOf(2),
    );
    expect(verifies(actions, "TASK-001")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new" },
    ]);
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
  });

  it("still names the verify when only the code-reviewer was dispatched", () => {
    const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const actions = seatActions(
      developed({ type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] }, dispatched("TASK-001", "code-reviewer")),
      inputs,
      capOf(2),
    );
    expect(verifies(actions, "TASK-001")).toEqual([
      expect.objectContaining({ kind: "verify", task: "TASK-001", command: "kf verify feat --task TASK-001 --commits abc1234" }),
    ]);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
  });

  it("names neither half again once the verify started and the code-reviewer was dispatched", () => {
    const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const actions = seatActions(
      developed(
        { type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] },
        { type: "verifyStarted", task: "TASK-001" },
        dispatched("TASK-001", "code-reviewer"),
      ),
      inputs,
      capOf(2),
    );
    expect(verifies(actions, "TASK-001")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
  });

  it("asks for a decide when a DONE developer has no commit in any source", () => {
    const actions = seatActions(developed(), inputsOf([task("TASK-001")]), capOf(2));
    expect(actions).toContainEqual(
      expect.objectContaining({ kind: "decide", task: "TASK-001", rule: "Commit missing", closes: "Note TASK-001: commits <sha7>" }),
    );
    expect(verifies(actions, "TASK-001")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
  });

  it("treats a DONE_WITH_CONCERNS developer followed by a decided note as done and names the trio", () => {
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer", "DONE_WITH_CONCERNS"),
      { type: "decided", task: "TASK-001", what: "concerns accepted" },
    );
    const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    // The decision closes the concerns; the report's commit is still unnamed, so the note comes before the trio.
    const actions = seatActions(state, inputs, capOf(2));
    expect(writes(actions)).toContainEqual(expect.objectContaining({ line: "Note TASK-001: commits abc1234" }));
    expect(verifies(actions, "TASK-001")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
  });

  it("treats a BLOCKED developer followed by a commits note as done and names the trio", () => {
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer", "BLOCKED"),
      commitsNote("TASK-001", "abc1234"),
    );
    const actions = seatActions(state, inputsOf([task("TASK-001")], { gitLog: logOf("abc1234") }), capOf(2));
    expect(verifies(actions, "TASK-001")).toEqual([
      expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234" }),
    ]);
    expect(dispatches(actions, "code-reviewer", "TASK-001")).toHaveLength(1);
  });

  it("leaves a DONE_WITH_CONCERNS developer with no decision after it to the status rules", () => {
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer", "DONE_WITH_CONCERNS"),
    );
    const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const actions = seatActions(state, inputs, capOf(2));
    expect(verifies(actions, "TASK-001")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
    expect(actions.filter((a: Action) => a.kind === "decide")).toHaveLength(0);
  });

  it("walks a UI task under Level full through the automation-writer and the resume-commit developer before the review", () => {
    const uiTask = task("TASK-001", { testTypes: ["Unit", "UI"] });
    const one = inputsOf([uiTask], { level: "full", reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const noTrio = (actions: Action[]) => {
      expect(verifies(actions, "TASK-001")).toHaveLength(0);
      expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
      expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
    };

    const afterDeveloper = seatActions(developed(commitsNote("TASK-001", "abc1234")), one, capOf(2));
    expect(dispatches(afterDeveloper, "automation-writer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "automation-writer", mode: "new" },
    ]);
    expect(dispatches(afterDeveloper, "developer")).toHaveLength(0);
    noTrio(afterDeveloper);

    const writing = seatActions(developed(commitsNote("TASK-001", "abc1234"), dispatched("TASK-001", "automation-writer")), one, capOf(2));
    expect(dispatches(writing, "automation-writer")).toHaveLength(0);
    expect(dispatches(writing, "developer")).toHaveLength(0);
    noTrio(writing);

    const specsDone = developed(commitsNote("TASK-001", "abc1234"), dispatched("TASK-001", "automation-writer"), done("TASK-001", "automation-writer"));
    const afterSpecs = seatActions(specsDone, one, capOf(2));
    expect(dispatches(afterSpecs, "developer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "developer", mode: "resume" },
    ]);
    noTrio(afterSpecs);

    const committing = seatActions(
      developed(
        commitsNote("TASK-001", "abc1234"),
        dispatched("TASK-001", "automation-writer"),
        done("TASK-001", "automation-writer"),
        dispatched("TASK-001", "developer"),
      ),
      one,
      capOf(2),
    );
    expect(dispatches(committing, "developer")).toHaveLength(0);
    noTrio(committing);

    const two = inputsOf([uiTask], {
      level: "full",
      reportCommits: { "TASK-001": ["abc1234", "def5678"] },
      gitLog: logOf("abc1234", "def5678"),
    });
    const committed = seatActions(
      developed(
        commitsNote("TASK-001", "abc1234", "def5678"),
        dispatched("TASK-001", "automation-writer"),
        done("TASK-001", "automation-writer"),
        dispatched("TASK-001", "developer"),
        done("TASK-001", "developer"),
      ),
      two,
      capOf(2),
    );
    expect(writes(committed)).toContainEqual(expect.objectContaining({ line: "TASK-001: review package abc1234,def5678" }));
    expect(verifies(committed, "TASK-001")).toEqual([
      expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234,def5678" }),
    ]);
    expect(dispatches(committed, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new" },
    ]);
    expect(dispatches(committed, "developer")).toHaveLength(0);
    expect(dispatches(committed, "automation-writer")).toHaveLength(0);
  });

  it("holds a resume-commit developer at the cap and owes its developer waits line once", () => {
    const tasks = [task("TASK-001", { testTypes: ["Unit", "UI"] }), task("TASK-002")];
    const inputs = inputsOf(tasks, { level: "full", reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const reason = "1 developers in flight";
    const base = developed(
      commitsNote("TASK-001", "abc1234"),
      dispatched("TASK-001", "automation-writer"),
      done("TASK-001", "automation-writer"),
      ...testsReady("TASK-002"),
      dispatched("TASK-002", "developer"),
    ).events.map(({ line: _line, ts: _ts, ...e }) => e as Fields);

    const first = seatActions(stateOf(...base), inputs, capOf(1));
    expect(dispatches(first, "developer", "TASK-001")).toHaveLength(0);
    expect(waits(first, "TASK-001")).toEqual([{ kind: "wait", task: "TASK-001", reason }]);
    expect(writes(first).filter((w) => w.line.startsWith("TASK-001: developer waits"))).toEqual([
      expect.objectContaining({
        line: `TASK-001: developer waits — ${reason}`,
        record: `kf record feat waits TASK-001 -- ${q(reason)}`,
      }),
    ]);

    const again = seatActions(stateOf(...base, { type: "developerWaits", task: "TASK-001", reason }), inputs, capOf(1));
    expect(waits(again, "TASK-001")).toEqual([{ kind: "wait", task: "TASK-001", reason }]);
    expect(writes(again).filter((w) => w.line.startsWith("TASK-001: developer waits"))).toHaveLength(0);
  });

  it("still names the resume-commit developer when the automation-writer ran ahead of the developer", () => {
    const uiTask = task("TASK-001", { testTypes: ["Unit", "UI"] });
    const inputs = inputsOf([uiTask], { level: "full", reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "automation-writer"),
      done("TASK-001", "automation-writer"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer"),
      commitsNote("TASK-001", "abc1234"),
    );
    const actions = seatActions(state, inputs, capOf(2));
    expect(dispatches(actions, "developer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "developer", mode: "resume" },
    ]);
    expect(dispatches(actions, "automation-writer")).toHaveLength(0);
    expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
  });

  it("treats a DONE_WITH_CONCERNS developer followed by a Ruling line naming the task as done", () => {
    const inputs = inputsOf([task("TASK-001"), task("TASK-002")], {
      reportCommits: { "TASK-001": ["abc1234"] },
      gitLog: logOf("abc1234"),
    });
    const concerns = [scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), done("TASK-001", "developer", "DONE_WITH_CONCERNS")];

    const ruled = seatActions(
      stateOf(...concerns, { type: "other", text: "Ruling: TASK-001's wording choices stand — cost if wrong: a prose edit" }),
      inputs,
      capOf(2),
    );
    // The ruling closes the concerns; the report's commit is still unnamed, so the note comes before the trio.
    expect(writes(ruled)).toContainEqual(expect.objectContaining({ line: "Note TASK-001: commits abc1234" }));
    expect(verifies(ruled, "TASK-001")).toHaveLength(0);
    expect(dispatches(ruled, "code-reviewer")).toHaveLength(0);

    // A ruling about another task does not close this task's concerns.
    const otherRuling = seatActions(
      stateOf(...concerns, { type: "other", text: "Ruling: TASK-002 stays inside its Files — cost if wrong: a later refactor" }),
      inputs,
      capOf(2),
    );
    expect(verifies(otherRuling, "TASK-001")).toHaveLength(0);
    expect(dispatches(otherRuling, "code-reviewer")).toHaveLength(0);
    expect(writes(otherRuling).filter((w) => w.line.startsWith("Note TASK-001"))).toHaveLength(0);
  });

  it("names nothing for a fix round until the round test-writer's resume-commit developer is done", () => {
    const reviewed = [
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer"),
      { type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] } as Fields,
      { type: "verifyStarted", task: "TASK-001" } as Fields,
      dispatched("TASK-001", "code-reviewer"),
      { type: "verifyDone", task: "TASK-001", exit: 0 } as Fields,
      done("TASK-001", "code-reviewer", "findings"),
      dispatched("TASK-001", "developer", { round: 1 }),
      done("TASK-001", "developer"),
    ];
    const inputs = inputsOf([task("TASK-001")], { gitLog: logOf("abc1234", "def5678") });
    const nothingForTheRound = (actions: Action[]) => {
      expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
      expect(verifies(actions, "TASK-001")).toHaveLength(0);
      expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
      expect(actions.filter((a: Action) => a.kind === "decide" && a.task === "TASK-001")).toHaveLength(0);
    };

    const testWriterOut = [...reviewed, dispatched("TASK-001", "test-writer", { round: 1 })];
    nothingForTheRound(seatActions(stateOf(...testWriterOut), inputs, capOf(2)));

    const testWriterDone = [...testWriterOut, done("TASK-001", "test-writer"), hashes("TASK-001")];
    nothingForTheRound(seatActions(stateOf(...testWriterDone), inputs, capOf(2)));

    const resumeOut = [...testWriterDone, dispatched("TASK-001", "developer", { round: 1 })];
    nothingForTheRound(seatActions(stateOf(...resumeOut), inputs, capOf(2)));

    const resumeDone = [
      ...resumeOut,
      done("TASK-001", "developer"),
      { type: "reviewPackage", task: "TASK-001", shas: ["def5678"] } as Fields,
    ];
    const reReview = seatActions(stateOf(...resumeDone), inputs, capOf(2));
    expect(verifies(reReview, "TASK-001")).toEqual([
      expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234,def5678" }),
    ]);
    expect(dispatches(reReview, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new", round: 1 },
    ]);
  });

  it("reads a fix round's commits from its review package line when no commits note was recorded", () => {
    const state = stateOf(
      scanClean,
      ...testsReady("TASK-001"),
      dispatched("TASK-001", "developer"),
      done("TASK-001", "developer"),
      { type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] },
      { type: "verifyStarted", task: "TASK-001" },
      dispatched("TASK-001", "code-reviewer"),
      { type: "verifyDone", task: "TASK-001", exit: 0 },
      done("TASK-001", "code-reviewer", "findings"),
      dispatched("TASK-001", "developer", { round: 1 }),
      done("TASK-001", "developer"),
      { type: "reviewPackage", task: "TASK-001", shas: ["def5678", "0123abc"] },
    );
    const inputs = inputsOf([task("TASK-001")], { gitLog: logOf("abc1234", "def5678", "0123abc") });
    const actions = seatActions(state, inputs, capOf(2));
    expect(actions.filter((a: Action) => a.kind === "decide" && a.task === "TASK-001")).toHaveLength(0);
    // The package is already recorded after the round's done: it is not owed again.
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
    expect(verifies(actions, "TASK-001")).toEqual([
      expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234,def5678,0123abc" }),
    ]);
    expect(dispatches(actions, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new", round: 1 },
    ]);
  });

  it("scopes the re-review after a fix round to the commits recorded since the last review and carries the round", () => {
    const state = developed(
      commitsNote("TASK-001", "abc1234"),
      { type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] },
      { type: "verifyStarted", task: "TASK-001" },
      { type: "verifyDone", task: "TASK-001", exit: 0 },
      dispatched("TASK-001", "code-reviewer"),
      done("TASK-001", "code-reviewer"),
      { type: "fixRound", task: "TASK-001", round: 1 },
      dispatched("TASK-001", "developer", { round: 1 }),
      done("TASK-001", "developer"),
      commitsNote("TASK-001", "def5678", "0123abc"),
    );
    const inputs = inputsOf([task("TASK-001")], { gitLog: logOf("abc1234", "def5678", "0123abc") });
    const actions = seatActions(state, inputs, capOf(2));
    expect(writes(actions).filter((w) => w.line.includes("review package"))).toEqual([
      expect.objectContaining({
        line: "TASK-001: review package def5678,0123abc",
        record: `kf record feat line -- ${q("TASK-001: review package def5678,0123abc")}`,
      }),
    ]);
    expect(verifies(actions, "TASK-001")).toEqual([
      expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234,def5678,0123abc" }),
    ]);
    expect(dispatches(actions, "code-reviewer", "TASK-001")).toEqual([
      { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new", round: 1 },
    ]);
  });

  describe("when the report holds commits no ledger line names", () => {
    const noTrio = (actions: Action[]) => {
      expect(verifies(actions, "TASK-001")).toHaveLength(0);
      expect(dispatches(actions, "code-reviewer")).toHaveLength(0);
      expect(writes(actions).filter((w) => w.line.includes("review package"))).toHaveLength(0);
    };
    const notes = (actions: Action[]) => writes(actions).filter((w) => w.line.startsWith("Note TASK-001: commits"));

    it("writes the commits note with a quote-free record and names no trio yet", () => {
      const inputs = inputsOf([task("TASK-001")], {
        reportCommits: { "TASK-001": ["abc1234", "def5678"] },
        gitLog: logOf("abc1234", "def5678"),
      });
      const actions = seatActions(developed(), inputs, capOf(2));
      expect(notes(actions)).toEqual([
        expect.objectContaining({
          kind: "write",
          line: "Note TASK-001: commits abc1234,def5678",
          record: "kf record feat commits TASK-001 abc1234,def5678",
        }),
      ]);
      expect(actions.filter((a: Action) => a.kind === "decide")).toHaveLength(0);
      noTrio(actions);
    });

    it("shortens a full-length report sha to seven characters in the note and its record", () => {
      const full = sha40("abc1234");
      const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": [full] }, gitLog: logOf("abc1234") });
      const actions = seatActions(developed(), inputs, capOf(2));
      expect(notes(actions)).toEqual([
        expect.objectContaining({ line: "Note TASK-001: commits abc1234", record: "kf record feat commits TASK-001 abc1234" }),
      ]);
    });

    it("names the trio and writes no second note once the commits note is in the ledger", () => {
      const inputs = inputsOf([task("TASK-001")], {
        reportCommits: { "TASK-001": ["abc1234", "def5678"] },
        gitLog: logOf("abc1234", "def5678"),
      });
      const actions = seatActions(developed(commitsNote("TASK-001", "abc1234", "def5678")), inputs, capOf(2));
      expect(notes(actions)).toHaveLength(0);
      expect(writes(actions)).toContainEqual(expect.objectContaining({ line: "TASK-001: review package abc1234,def5678" }));
      expect(verifies(actions, "TASK-001")).toEqual([
        expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234,def5678" }),
      ]);
      expect(dispatches(actions, "code-reviewer", "TASK-001")).toEqual([
        { kind: "dispatch", task: "TASK-001", seat: "code-reviewer", mode: "new" },
      ]);
    });

    it("writes no note when a review package already names the report's commits", () => {
      const inputs = inputsOf([task("TASK-001")], { reportCommits: { "TASK-001": ["abc1234"] }, gitLog: logOf("abc1234") });
      const actions = seatActions(developed({ type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] }), inputs, capOf(2));
      expect(notes(actions)).toHaveLength(0);
      expect(verifies(actions, "TASK-001")).toEqual([
        expect.objectContaining({ command: "kf verify feat --task TASK-001 --commits abc1234" }),
      ]);
      expect(dispatches(actions, "code-reviewer", "TASK-001")).toHaveLength(1);
    });

    it("writes the note for only the report commits no ledger line names yet", () => {
      const inputs = inputsOf([task("TASK-001")], {
        reportCommits: { "TASK-001": ["abc1234", "def5678"] },
        gitLog: logOf("abc1234", "def5678"),
      });
      const actions = seatActions(developed({ type: "reviewPackage", task: "TASK-001", shas: ["abc1234"] }), inputs, capOf(2));
      expect(notes(actions)).toEqual([
        expect.objectContaining({ line: "Note TASK-001: commits def5678", record: "kf record feat commits TASK-001 def5678" }),
      ]);
    });

    it("keeps the Commit missing decide and writes no note when the report and the ledger name no commit", () => {
      const actions = seatActions(developed(), inputsOf([task("TASK-001")]), capOf(2));
      expect(actions).toContainEqual(
        expect.objectContaining({ kind: "decide", task: "TASK-001", rule: "Commit missing", closes: "Note TASK-001: commits <sha7>" }),
      );
      expect(notes(actions)).toHaveLength(0);
      noTrio(actions);
    });
  });
});

describe("seatActions printed records are shell-safe", () => {
  // The session runs the printed record in a shell: free text after `--` must reach it as one argument.
  function argsAfterDashes(record: string): string[] {
    const at = record.indexOf(" -- ");
    expect(at).toBeGreaterThan(0);
    const out = execFileSync("bash", ["-c", `printf '%s\\0' ${record.slice(at + 4)}`], { encoding: "utf8" });
    return out.split("\0").slice(0, -1);
  }

  it("quotes a developer waits reason with parentheses and survives bash as one argument", () => {
    const tasks = [
      task("TASK-001", { files: ["src/shared.ts"], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: ["src/shared.ts"], overlaps: ["TASK-001"] }),
    ];
    const base = [scanClean, ...testsReady("TASK-001"), dispatched("TASK-001", "developer"), ...testsReady("TASK-002")];
    const actions = seatActions(stateOf(...base), inputsOf(tasks), capOf(4));
    const w = writes(actions).find((x) => x.line.startsWith("TASK-002: developer waits"));
    expect(w?.record).toBe("kf record feat waits TASK-002 -- 'Files overlap src/shared.ts / src/shared.ts (TASK-001)'");
    expect(argsAfterDashes(w!.record)).toEqual(["Files overlap src/shared.ts / src/shared.ts (TASK-001)"]);
  });

  it("quotes a wave line built from file names with quotes, semicolons, dollars and backticks as one argument", () => {
    const odd = "src/it's (a); $HOME `id`.ts";
    const tasks = [
      task("TASK-001", { files: [odd], overlaps: ["TASK-002"] }),
      task("TASK-002", { files: [odd], overlaps: ["TASK-001"] }),
    ];
    const actions = seatActions(stateOf(scanClean), inputsOf(tasks), capOf(2));
    const w = writes(actions).find((x) => x.line.startsWith("wave 1:"));
    expect(w?.record).toBe(`kf record feat line -- ${q(w!.line)}`);
    expect(w!.line).toContain(odd);
    expect(argsAfterDashes(w!.record)).toEqual([w!.line]);
  });

  it("quotes the wave line record with its dash and slashes as one argument", () => {
    const ids = ["TASK-001", "TASK-002"];
    const actions = seatActions(stateOf(scanClean), inputsOf(ids.map((id) => task(id))), capOf(2));
    const w = writes(actions).find((x) => x.line.startsWith("wave 1:"));
    expect(w?.record).toBe(`kf record feat line -- '${w?.line}'`);
    expect(argsAfterDashes(w!.record)).toEqual([w!.line]);
  });
});
