import { describe, it, expect } from "vitest";

import { arbitrate } from "../workflow/next/arbiter.js";
import type {
  Action,
  Arbitration,
  Contention,
  HeldRerun,
  Intent,
  IntentOrigin,
  JudgementKind,
  LoopInputs,
  LoopTask,
  PoolSeat,
  ReviewDemand,
  ReviewLane,
  Seat,
  TaskPhase,
  TaskState,
  World,
} from "../workflow/next/types.js";

// The arbiter is tested on seeded worlds and intents: no ledger, no fold. Each case builds the World the fold would
// hand over and the intents the phases owe, and reads the Arbitration back.

type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Wait = Extract<Action, { kind: "wait" }>;

const NO_CONTENTION: Contention = { held: [], running: null, blocksDevelopers: false };

function loopTask(id: string, over: Partial<LoopTask> = {}): LoopTask {
  return {
    id,
    dependencies: [],
    files: [`src/${id.toLowerCase()}.ts`],
    wave: 1,
    overlaps: [],
    inline: false,
    testTypes: ["Unit"],
    ...over,
  };
}

const idle = { kind: "idle" } as const;

interface TaskSeed {
  phase?: TaskPhase;
  commits?: string[];
  inline?: boolean;
  review?: { lane?: ReviewLane; demands?: ReviewDemand[] };
  developerSeat?: TaskState["seats"]["developer"];
}

function taskState(id: string, seed: TaskSeed = {}): TaskState {
  return {
    id,
    phase: seed.phase ?? { kind: "pending" },
    seats: {
      "test-writer": idle,
      developer: seed.developerSeat ?? idle,
      "automation-writer": idle,
      "code-reviewer": idle,
    },
    verify: { kind: "notDue" },
    review: { lane: seed.review?.lane ?? { kind: "free" }, demands: seed.review?.demands ?? [], ownVerdict: "none" },
    routedIn: [],
    judgements: [],
    roundsUsed: 0,
    reopened: false,
    inline: seed.inline ?? false,
    commits: seed.commits ?? [],
    droppedShas: [],
  };
}

const tw = (line = 3): TaskPhase => ({
  kind: "tests",
  writer: { kind: "running", line, inline: false, origin: "progress" },
  hashOwed: false,
});
const cycle = (): TaskPhase => ({
  kind: "cycle",
  cycle: "first",
  round: 0,
  openedAt: 5,
  implementer: { kind: "committed" },
  sinceCommit: 6,
  commits: [],
});
const complete: TaskPhase = { kind: "complete", how: "complete" };

interface WorldSeed {
  tasks: LoopTask[];
  states?: Record<string, TaskSeed>;
  n?: number;
  pool?: PoolSeat[];
  contention?: Contention;
  inputs?: Partial<LoopInputs>;
}

function worldOf(seed: WorldSeed): World {
  const contention = seed.contention ?? NO_CONTENTION;
  return {
    inputs: {
      feature: "feat",
      kind: "feature",
      level: "standard",
      tasks: seed.tasks,
      ceiling: { max: 4, source: "config" },
      reportCommits: {},
      verifyRuns: {},
      gitLog: [],
      ...seed.inputs,
    },
    cap: { n: seed.n ?? 2, ceiling: 4, owed: [], contention },
    contention,
    scan: "done",
    ceiling: "valid",
    unknown: new Map(),
    pool: seed.pool ?? [],
    tasks: new Map(seed.tasks.map((t) => [t.id, taskState(t.id, seed.states?.[t.id])])),
  };
}

const poolSeat = (task: string, line = 10): PoolSeat => ({ task, line });

// Intent builders.
const act = (action: Extract<Intent, { kind: "act" }>["action"], origin: IntentOrigin = "progress"): Intent => ({
  kind: "act",
  action,
  origin,
  task: "task" in action ? action.task : undefined,
  closes: [],
});
const dev = (task: string, extra: Partial<Dispatch> = {}, origin: IntentOrigin = "progress"): Intent =>
  act({ kind: "dispatch", task, seat: "developer", mode: "new", ...extra }, origin);
const seatDispatch = (task: string, seat: Seat, extra: Partial<Dispatch> = {}, origin: IntentOrigin = "progress"): Intent =>
  act({ kind: "dispatch", task, seat, mode: "new", ...extra }, origin);
const write = (task: string | undefined, line: string): Intent =>
  act({ kind: "write", ...(task !== undefined ? { task } : {}), line, record: `kf record feat note -- ${line}` });
const verify = (task: string, origin: IntentOrigin = "progress"): Intent =>
  act({ kind: "verify", task, command: `kf verify feat --task ${task} --commits abc1234` }, origin);
const complete$ = (task: string): Intent => act({ kind: "complete", task });
const stop = (task?: string): Intent => ({
  kind: "judge",
  judgement: "verifyExit2" satisfies JudgementKind,
  action: { kind: "stop", ...(task !== undefined ? { task } : {}), reason: "a stop" },
  origin: "progress",
  ...(task !== undefined ? { task } : {}),
  closes: [],
});
const decide = (task?: string): Intent => ({
  kind: "judge",
  judgement: (task === undefined ? "conflictScan" : "commitMissing") satisfies JudgementKind,
  action: { kind: "decide", ...(task !== undefined ? { task } : {}), rule: "a rule", reason: "a decide", closes: "a line" },
  origin: "progress",
  ...(task !== undefined ? { task } : {}),
  closes: [],
});
const inFlight = (task: string, seat: Seat | "verify"): Intent => ({
  kind: "inFlight",
  entry: { task, seat },
  origin: "progress",
  task,
  closes: [],
});

const run = (world: World, intents: Intent[], resume = false): Arbitration => arbitrate(world, intents, { resume });

const dispatches = (r: Arbitration): Dispatch[] => r.actions.filter((a): a is Dispatch => a.kind === "dispatch");
const dispatchedTasks = (r: Arbitration, seat?: Seat): string[] =>
  dispatches(r)
    .filter((d) => seat === undefined || d.seat === seat)
    .map((d) => d.task);
const waitsOf = (r: Arbitration, task: string): Wait[] =>
  r.actions.filter((a): a is Wait => a.kind === "wait" && a.task === task);

describe("arbiter: the developer pool against the live cap", () => {
  it("grants as many new developers as the cap leaves free, in plan order, and makes the rest wait", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003")], n: 2, pool: [poolSeat("TASK-009")] });
    const r = run(world, [dev("TASK-001"), dev("TASK-002"), dev("TASK-003")]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-001"]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["2 developers in flight"]);
    expect(waitsOf(r, "TASK-003").map((w) => w.reason)).toEqual(["2 developers in flight"]);
  });

  it("names the pool as the blocker of a developer held by a full cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 1, pool: [poolSeat("TASK-009")] });
    const r = run(world, [dev("TASK-001")]);
    expect(r.waits).toHaveLength(1);
    expect(r.waits[0].wait.task).toBe("TASK-001");
    expect(r.waits[0].blockedBy).toEqual({ kind: "pool" });
  });

  it("returns each wait in actions as the same object the waits list names", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 1, pool: [poolSeat("TASK-009")] });
    const r = run(world, [dev("TASK-001")]);
    const wait = r.actions.find((a) => a.kind === "wait");
    expect(wait).toBeDefined();
    expect(r.waits[0].wait).toBe(wait);
  });

  it("owes a developer waits line with the reason for a developer held by a full cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 1, pool: [poolSeat("TASK-009")] });
    const r = run(world, [dev("TASK-001")]);
    const lines = r.actions.filter((a): a is Extract<Action, { kind: "write" }> => a.kind === "write");
    expect(lines).toHaveLength(1);
    expect(lines[0].task).toBe("TASK-001");
    expect(lines[0].line).toBe("TASK-001: developer waits — 1 developers in flight");
    expect(lines[0].record).toBe("kf record feat waits TASK-001 -- '1 developers in flight'");
  });

  it("grants nothing when the pool already fills the cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 2, pool: [poolSeat("TASK-007"), poolSeat("TASK-008")] });
    const r = run(world, [dev("TASK-001")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(waitsOf(r, "TASK-001").map((w) => w.reason)).toEqual(["2 developers in flight"]);
  });

  it.each([
    ["a fix-round developer", dev("TASK-002", { mode: "resume", round: 2 })],
    ["a resume-commit developer", dev("TASK-002", { mode: "resume" })],
    ["a minimal-fix developer", dev("TASK-002", { mode: "fresh" })],
  ])("grants %s before a new developer when one seat is free", (_name, first) => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 1 });
    const r = run(world, [dev("TASK-001"), first]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-002"]);
    expect(waitsOf(r, "TASK-001").map((w) => w.reason)).toEqual(["1 developers in flight"]);
  });

  it("lets an inline developer bypass a full cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001", { inline: true })], n: 1, pool: [poolSeat("TASK-009")] });
    const r = run(world, [dev("TASK-001", { inline: true })]);
    expect(dispatches(r)).toEqual([expect.objectContaining({ task: "TASK-001", seat: "developer", inline: true })]);
    expect(waitsOf(r, "TASK-001")).toEqual([]);
  });

  it("does not spend a free seat on an inline developer", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001", { inline: true }), loopTask("TASK-002")], n: 1 });
    const r = run(world, [dev("TASK-001", { inline: true }), dev("TASK-002")]);
    expect(dispatchedTasks(r, "developer").sort()).toEqual(["TASK-001", "TASK-002"]);
  });

  it("does not count a seat outside the pool against the cap", () => {
    // An orphan seat of a completed or unknown task is not in the pool, so it holds nothing.
    const world = worldOf({ tasks: [loopTask("TASK-002")], n: 1, pool: [] });
    const r = run(world, [dev("TASK-002")]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-002"]);
  });
});

describe("arbiter: contention", () => {
  const held = (task: string, atHead = false): HeldRerun => ({ task, atHead, kind: "rerun" });
  const blocked = (h: HeldRerun[], running: string | null = null): Contention => ({ held: h, running, blocksDevelopers: h.length > 0 || running !== null });
  const reruns = (r: Arbitration): Extract<Action, { kind: "verify" }>[] =>
    r.actions.filter((a): a is Extract<Action, { kind: "verify" }> => a.kind === "verify" && a.rerun === true);

  it("holds every ungranted developer, a fix round's included, behind a held re-run", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003")],
      n: 3,
      pool: [poolSeat("TASK-003")],
      contention: blocked([held("TASK-001")]),
    });
    const r = run(world, [dev("TASK-002"), dev("TASK-003", { mode: "resume", round: 1 })]);
    expect(dispatchedTasks(r, "developer")).toEqual([]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["held re-run TASK-001"]);
    expect(waitsOf(r, "TASK-003").map((w) => w.reason)).toEqual(["held re-run TASK-001"]);
  });

  it("lets an inline developer pass a held re-run", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { inline: true })],
      n: 3,
      contention: blocked([held("TASK-001")]),
    });
    const r = run(world, [dev("TASK-002", { inline: true })]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-002"]);
  });

  it("releases the earliest held re-run once, while developers are below the cap", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002")],
      n: 2,
      pool: [poolSeat("TASK-003")],
      contention: blocked([held("TASK-001"), held("TASK-002")]),
    });
    const r = run(world, []);
    expect(reruns(r).map((v) => v.task)).toEqual(["TASK-001"]);
    expect(reruns(r)[0].command).toContain("kf verify feat --task TASK-001");
  });

  it("runs the released re-run at head when the held entry says so", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 2, contention: blocked([held("TASK-001", true)]) });
    const r = run(world, []);
    expect(reruns(r)[0].command).toContain("--at-head");
  });

  it("holds the re-run while developers fill the cap", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 1,
      pool: [poolSeat("TASK-003")],
      contention: blocked([held("TASK-001")]),
    });
    const r = run(world, [dev("TASK-002")]);
    expect(reruns(r)).toEqual([]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["held re-run TASK-001"]);
  });

  it("releases no second re-run while one runs", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002")],
      n: 2,
      contention: blocked([held("TASK-002")], "TASK-001"),
    });
    const r = run(world, [dev("TASK-002")]);
    expect(reruns(r)).toEqual([]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["running re-run TASK-001"]);
    expect(r.waits[0].blockedBy).toEqual({ kind: "verify", task: "TASK-001" });
  });

  it("names a running re-run, not a held one, when developers wait on a lone running re-run", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 3, contention: blocked([], "TASK-001") });
    const r = run(world, [dev("TASK-002")]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["running re-run TASK-001"]);
  });

  it("re-emits a lost running re-run as a re-run when developers are below the cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 2, contention: blocked([], "TASK-001") });
    const r = run(world, [verify("TASK-001", "resume")], true);
    expect(reruns(r).map((v) => v.task)).toEqual(["TASK-001"]);
  });
});

describe("arbiter: resume", () => {
  it("keeps a resumed seat when an item stop holds every progress dispatch", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 3 });
    const r = run(world, [stop(), seatDispatch("TASK-001", "developer", { mode: "new" }, "resume"), dev("TASK-002")], true);
    expect(dispatchedTasks(r)).toEqual(["TASK-001"]);
    expect(r.actions.some((a) => a.kind === "stop")).toBe(true);
  });

  it("keeps a resumed seat when a task decide holds its own task", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 3 });
    const r = run(world, [decide("TASK-001"), seatDispatch("TASK-001", "code-reviewer", {}, "resume")], true);
    expect(dispatchedTasks(r)).toEqual(["TASK-001"]);
  });

  it("keeps a resumed verify under a hold", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 3 });
    const r = run(world, [decide("TASK-001"), verify("TASK-001", "resume")], true);
    expect(r.actions.filter((a) => a.kind === "verify")).toHaveLength(1);
  });

  it("keeps a resumed developer when the pool fills the cap", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 1, pool: [poolSeat("TASK-001")] });
    const r = run(world, [dev("TASK-001", {}, "resume")], true);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-001"]);
    expect(waitsOf(r, "TASK-001")).toEqual([]);
  });

  it("keeps a resumed developer behind a held re-run", () => {
    const contention: Contention = { held: [{ task: "TASK-002", atHead: false, kind: "rerun" }], running: null, blocksDevelopers: true };
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 3, pool: [poolSeat("TASK-001")], contention });
    const r = run(world, [dev("TASK-001", {}, "resume")], true);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-001"]);
  });

  it("names a resumed seat once when a progress intent owes the same dispatch", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 3 });
    const r = run(world, [dev("TASK-001", {}, "resume"), dev("TASK-001")], true);
    expect(dispatches(r).filter((d) => d.task === "TASK-001" && d.seat === "developer")).toHaveLength(1);
  });

  it("marks a resumed developer inline when the plan says its wave is inline", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001", { inline: true })], n: 3 });
    const r = run(world, [dev("TASK-001", {}, "resume")], true);
    expect(dispatches(r)[0].inline).toBe(true);
  });

  it("marks a resumed developer inline when its open seat was filled inline", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 3,
      states: { "TASK-001": { developerSeat: { kind: "running", line: 7, inline: true, origin: "resume" } } },
    });
    const r = run(world, [dev("TASK-001", {}, "resume")], true);
    expect(dispatches(r)[0].inline).toBe(true);
  });

  it("leaves a resumed developer a spawned seat when neither the row nor the plan is inline", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 3,
      states: { "TASK-001": { developerSeat: { kind: "running", line: 7, inline: false, origin: "resume" } } },
    });
    const r = run(world, [dev("TASK-001", {}, "resume")], true);
    expect(dispatches(r)[0].inline ?? false).toBe(false);
  });

  it("lists an in-flight intent as an in-flight entry and nothing else", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 3, pool: [poolSeat("TASK-001")] });
    const r = run(world, [inFlight("TASK-001", "developer"), inFlight("TASK-001", "verify")]);
    expect(r.inFlight).toEqual([
      { task: "TASK-001", seat: "developer" },
      { task: "TASK-001", seat: "verify" },
    ]);
    expect(r.actions).toEqual([]);
  });

  it("keeps an in-flight entry under a stop", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 3, pool: [poolSeat("TASK-001")] });
    const r = run(world, [stop(), inFlight("TASK-001", "developer")]);
    expect(r.inFlight).toEqual([{ task: "TASK-001", seat: "developer" }]);
  });
});

describe("arbiter: holds by origin", () => {
  const two = (): World => worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 4 });

  it("holds every progress dispatch while an item stop stands", () => {
    const r = run(two(), [stop(), dev("TASK-001"), seatDispatch("TASK-002", "test-writer")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(r.actions.filter((a) => a.kind === "stop")).toHaveLength(1);
  });

  it("holds every progress dispatch while a task-less decide stands", () => {
    const r = run(two(), [decide(), dev("TASK-001"), seatDispatch("TASK-002", "code-reviewer")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(r.actions.filter((a) => a.kind === "decide")).toHaveLength(1);
  });

  it("holds every progress dispatch while a stop names one task", () => {
    const r = run(two(), [stop("TASK-001"), dev("TASK-002")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(r.actions.filter((a) => a.kind === "stop")).toHaveLength(1);
  });

  it("does not hold other intents for the same reason", () => {
    const r = run(two(), [stop(), write("TASK-002", "TASK-002: no test-writer — docs only")]);
    expect(r.actions.filter((a) => a.kind === "write")).toHaveLength(1);
  });

  it("holds only the deciding task's progress intents under a task decide", () => {
    const r = run(two(), [
      decide("TASK-001"),
      dev("TASK-001"),
      verify("TASK-001"),
      write("TASK-001", "TASK-001: test hashes a=b"),
      complete$("TASK-001"),
      dev("TASK-002"),
    ]);
    expect(r.actions.map((a) => a.kind).sort()).toEqual(["decide", "dispatch"]);
    expect(dispatchedTasks(r)).toEqual(["TASK-002"]);
  });

  it("does not spend a free seat on a held dispatch", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 1 });
    const r = run(world, [decide("TASK-001"), dev("TASK-001"), dev("TASK-002")]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-002"]);
  });
});

describe("arbiter: dependencies", () => {
  it("makes a new developer wait for a dependency that has no commit", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { dependencies: ["TASK-001"] })],
      states: { "TASK-001": { phase: cycle(), commits: [] } },
    });
    const r = run(world, [dev("TASK-002")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["dependency TASK-001 has no commit"]);
    expect(r.waits[0].blockedBy).toEqual({ kind: "task", task: "TASK-001" });
  });

  it("releases a new developer once the dependency has a commit", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { dependencies: ["TASK-001"] })],
      states: { "TASK-001": { phase: cycle(), commits: ["abc1234"] } },
    });
    expect(dispatchedTasks(run(world, [dev("TASK-002")]))).toEqual(["TASK-002"]);
  });

  it("releases a new developer once the dependency is complete", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { dependencies: ["TASK-001"] })],
      states: { "TASK-001": { phase: complete } },
    });
    expect(dispatchedTasks(run(world, [dev("TASK-002")]))).toEqual(["TASK-002"]);
  });

  it("releases a new developer once the dependency is implemented without a commit line", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { dependencies: ["TASK-001"] })],
      states: { "TASK-001": { phase: { kind: "complete", how: "implemented" } } },
    });
    expect(dispatchedTasks(run(world, [dev("TASK-002")]))).toEqual(["TASK-002"]);
  });
});

describe("arbiter: overlaps and the test-writer window", () => {
  const shared = { files: ["src/shared.ts"] };

  it("holds a developer behind an open overlapping task and names the Files pair", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
      states: { "TASK-001": { phase: cycle(), commits: ["abc1234"] } },
    });
    const r = run(world, [dev("TASK-002")]);
    expect(dispatchedTasks(r)).toEqual([]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["Files overlap src/shared.ts / src/shared.ts (TASK-001)"]);
    expect(r.waits[0].blockedBy).toEqual({ kind: "task", task: "TASK-001" });
  });

  it("holds a developer behind an earlier incomplete overlapping task that is not open", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
    });
    const r = run(world, [dev("TASK-002")]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["earlier overlapping TASK-001 incomplete"]);
  });

  it("ranks overlapping tasks by wave before plan position", () => {
    const world = worldOf({
      tasks: [
        loopTask("TASK-001", { ...shared, wave: 2, overlaps: ["TASK-002"] }),
        loopTask("TASK-002", { ...shared, wave: 1, overlaps: ["TASK-001"] }),
      ],
      n: 4,
    });
    const r = run(world, [dev("TASK-001")]);
    expect(waitsOf(r, "TASK-001").map((w) => w.reason)).toEqual(["earlier overlapping TASK-002 incomplete"]);
  });

  it("does not hold the earlier of two overlapping tasks", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
    });
    expect(dispatchedTasks(run(world, [dev("TASK-001")]))).toEqual(["TASK-001"]);
  });

  it("does not hold on an overlapping task that is complete", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
      states: { "TASK-001": { phase: complete } },
    });
    expect(dispatchedTasks(run(world, [dev("TASK-002")]))).toEqual(["TASK-002"]);
  });

  it("treats a task with unknown Files as overlapping every other task", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002", { files: null })],
      n: 4,
    });
    const r = run(world, [dev("TASK-002")]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["earlier overlapping TASK-001 incomplete"]);
  });

  it("dispatches an earlier task's test-writer while a later overlapping task is open", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] }), loopTask("TASK-003")],
      n: 4,
      states: { "TASK-002": { phase: tw() } },
    });
    const r = run(world, [seatDispatch("TASK-001", "test-writer"), seatDispatch("TASK-003", "test-writer")]);
    expect(dispatchedTasks(r, "test-writer")).toEqual(["TASK-001", "TASK-003"]);
    expect(waitsOf(r, "TASK-001")).toEqual([]);
  });

  it("makes a later open task's developer wait on the earlier overlapping task and name it", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
      states: { "TASK-002": { phase: tw() } },
    });
    const r = run(world, [seatDispatch("TASK-001", "test-writer"), dev("TASK-002")]);
    expect(dispatchedTasks(r)).toEqual(["TASK-001"]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["earlier overlapping TASK-001 incomplete"]);
    expect(r.waits.find((w) => w.wait.task === "TASK-002")?.blockedBy).toEqual({ kind: "task", task: "TASK-001" });
  });

  it("dispatches a reopened earlier task's round developer and makes the later open task wait on it, with no wait cycle", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }), loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] })],
      n: 4,
      states: { "TASK-001": { phase: cycle(), commits: ["abc1234"] }, "TASK-002": { phase: tw() } },
    });
    const r = run(world, [dev("TASK-001", { mode: "resume", round: 1 }), dev("TASK-002")]);
    expect(dispatchedTasks(r, "developer")).toEqual(["TASK-001"]);
    const blocking = r.waits.find((w) => w.wait.task === "TASK-002");
    expect(blocking?.blockedBy).toEqual({ kind: "task", task: "TASK-001" });
    const edges = new Map<string, string>();
    for (const w of r.waits) if (w.blockedBy.kind === "task") edges.set(w.wait.task!, w.blockedBy.task);
    for (const start of edges.keys()) {
      const seen = new Set<string>([start]);
      for (let at = edges.get(start); at !== undefined; at = edges.get(at)) {
        expect(seen.has(at), `wait cycle through ${at}`).toBe(false);
        seen.add(at);
      }
    }
  });

  it("holds a later task's test-writer behind an open overlapping task that ranks earlier", () => {
    const world = worldOf({
      tasks: [
        loopTask("TASK-001", { ...shared, overlaps: ["TASK-002"] }),
        loopTask("TASK-002", { ...shared, overlaps: ["TASK-001"] }),
        loopTask("TASK-003"),
      ],
      n: 4,
      states: { "TASK-001": { phase: tw() } },
    });
    const r = run(world, [seatDispatch("TASK-002", "test-writer"), seatDispatch("TASK-003", "test-writer")]);
    expect(dispatchedTasks(r, "test-writer")).toEqual(["TASK-003"]);
    expect(waitsOf(r, "TASK-002").map((w) => w.reason)).toEqual(["Files overlap src/shared.ts / src/shared.ts (TASK-001)"]);
    expect(r.waits.find((w) => w.wait.task === "TASK-002")?.blockedBy).toEqual({ kind: "task", task: "TASK-001" });
  });

  it("dispatches test-writers for disjoint tasks side by side", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002")], n: 4 });
    const r = run(world, [seatDispatch("TASK-001", "test-writer"), seatDispatch("TASK-002", "test-writer")]);
    expect(dispatchedTasks(r, "test-writer")).toEqual(["TASK-001", "TASK-002"]);
  });

  it("opens at most four test-writers, in plan order, and names the rest", () => {
    const ids = ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005"];
    const world = worldOf({ tasks: ids.map((id) => loopTask(id)), n: 4 });
    const r = run(world, ids.map((id) => seatDispatch(id, "test-writer")));
    expect(dispatchedTasks(r, "test-writer")).toEqual(["TASK-001", "TASK-002", "TASK-003", "TASK-004"]);
    expect(waitsOf(r, "TASK-005")).toHaveLength(1);
  });

  it("counts an open test-writer against the window of four", () => {
    const ids = ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005"];
    const world = worldOf({
      tasks: ids.map((id) => loopTask(id)),
      n: 4,
      states: { "TASK-001": { phase: tw() }, "TASK-002": { phase: tw() } },
    });
    const r = run(world, ["TASK-003", "TASK-004", "TASK-005"].map((id) => seatDispatch(id, "test-writer")));
    expect(dispatchedTasks(r, "test-writer")).toEqual(["TASK-003", "TASK-004"]);
  });
});

describe("arbiter: the reviewer lane", () => {
  const own: ReviewDemand = { kind: "own" };
  const cascade: ReviewDemand = { kind: "cascade", sha7: "abc1234", round: 1, of: "TASK-002", phase: "owed" };
  const reviewers = (r: Arbitration): Dispatch[] => dispatches(r).filter((d) => d.seat === "code-reviewer");

  it("dispatches the oldest demand and makes the other wait for the reviewer in flight", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 4,
      states: { "TASK-001": { phase: cycle(), review: { demands: [cascade, own] } } },
    });
    const r = run(world, [
      seatDispatch("TASK-001", "code-reviewer"),
      seatDispatch("TASK-001", "code-reviewer", { cascade: "abc1234" }),
    ]);
    expect(reviewers(r)).toEqual([expect.objectContaining({ task: "TASK-001", cascade: "abc1234" })]);
    expect(waitsOf(r, "TASK-001").map((w) => w.reason)).toEqual(["code-reviewer of TASK-001 in flight"]);
    expect(r.waits[0].blockedBy).toEqual({ kind: "reviewer", task: "TASK-001" });
  });

  it("dispatches the own review first when it is the older demand", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 4,
      states: { "TASK-001": { phase: cycle(), review: { demands: [own, cascade] } } },
    });
    const r = run(world, [
      seatDispatch("TASK-001", "code-reviewer", { cascade: "abc1234" }),
      seatDispatch("TASK-001", "code-reviewer"),
    ]);
    expect(reviewers(r)).toEqual([expect.objectContaining({ task: "TASK-001" })]);
    expect(reviewers(r)[0].cascade).toBeUndefined();
    expect(waitsOf(r, "TASK-001")).toHaveLength(1);
  });

  it("makes a review demand wait while the task's reviewer lane is busy", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 4,
      states: { "TASK-001": { phase: cycle(), review: { lane: { kind: "busy", line: 9, obligation: own }, demands: [own, cascade] } } },
      pool: [],
    });
    const r = run(world, [seatDispatch("TASK-001", "code-reviewer", { cascade: "abc1234" }), inFlight("TASK-001", "code-reviewer")]);
    expect(reviewers(r)).toEqual([]);
    expect(waitsOf(r, "TASK-001").map((w) => w.reason)).toEqual(["code-reviewer of TASK-001 in flight"]);
    expect(r.inFlight).toEqual([{ task: "TASK-001", seat: "code-reviewer" }]);
  });

  it("runs the reviewers of different tasks side by side", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002")],
      n: 4,
      states: {
        "TASK-001": { phase: cycle(), review: { demands: [own] } },
        "TASK-002": { phase: cycle(), review: { demands: [own] } },
      },
    });
    const r = run(world, [seatDispatch("TASK-001", "code-reviewer"), seatDispatch("TASK-002", "code-reviewer")]);
    expect(reviewers(r).map((d) => d.task)).toEqual(["TASK-001", "TASK-002"]);
  });

  it("does not spend a developer seat on a reviewer", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001")],
      n: 1,
      pool: [poolSeat("TASK-009")],
      states: { "TASK-001": { phase: cycle(), review: { demands: [own] } } },
    });
    expect(reviewers(run(world, [seatDispatch("TASK-001", "code-reviewer")]))).toHaveLength(1);
  });
});

describe("arbiter: dedupe and rank", () => {
  it("keeps one action of two identical intents", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001")], n: 4 });
    const line = "TASK-001: no test-writer — docs only";
    const r = run(world, [write("TASK-001", line), write("TASK-001", line)]);
    expect(r.actions.filter((a) => a.kind === "write")).toHaveLength(1);
  });

  it("ranks stop, decide, write, verify, dispatch, complete, wait", () => {
    const world = worldOf({
      tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003"), loopTask("TASK-004"), loopTask("TASK-005")],
      n: 4,
    });
    const waitIntent: Intent = {
      kind: "wait",
      action: { kind: "wait", task: "TASK-005", reason: "verify waits for TASK-001" },
      blockedBy: { kind: "verify", task: "TASK-001" },
      origin: "progress",
      task: "TASK-005",
      closes: [],
    };
    // A stop item-wide would hold the dispatch, so the stop and decide are the only holds-free pair: use a stop-free mix
    // for the dispatch and rank the judgements apart.
    const mixed = run(world, [
      waitIntent,
      complete$("TASK-004"),
      dev("TASK-003"),
      verify("TASK-002"),
      write("TASK-001", "TASK-001: no test-writer — docs only"),
    ]);
    expect(mixed.actions.map((a) => a.kind)).toEqual(["write", "verify", "dispatch", "complete", "wait"]);
    const judged = run(world, [decide("TASK-001"), stop("TASK-002"), write("TASK-003", "TASK-003: no test-writer — docs only")]);
    expect(judged.actions.map((a) => a.kind)).toEqual(["stop", "decide", "write"]);
  });

  it("ranks new dispatches by seat, then plan order", () => {
    const ids = ["TASK-001", "TASK-002", "TASK-003", "TASK-004"];
    const world = worldOf({ tasks: ids.map((id) => loopTask(id)), n: 8 });
    const r = run(world, [
      seatDispatch("TASK-004", "code-reviewer"),
      seatDispatch("TASK-003", "automation-writer"),
      dev("TASK-002"),
      seatDispatch("TASK-002", "test-writer"),
      seatDispatch("TASK-001", "test-writer"),
      dev("TASK-001"),
    ]);
    expect(dispatches(r).map((d) => `${d.task} ${d.seat}`)).toEqual([
      "TASK-001 developer",
      "TASK-002 developer",
      "TASK-001 test-writer",
      "TASK-002 test-writer",
      "TASK-003 automation-writer",
      "TASK-004 code-reviewer",
    ]);
  });

  it("ranks a fix-round or resume developer ahead of a new dispatch", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003")], n: 8 });
    const r = run(world, [
      seatDispatch("TASK-001", "test-writer"),
      dev("TASK-003", { mode: "resume", round: 2 }),
      dev("TASK-002"),
    ]);
    expect(dispatches(r).map((d) => `${d.task} ${d.seat}`)).toEqual(["TASK-003 developer", "TASK-002 developer", "TASK-001 test-writer"]);
  });

  it("ranks resumed seats first, in the order the intents list them", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003")], n: 8 });
    const r = run(
      world,
      [
        seatDispatch("TASK-001", "test-writer"),
        seatDispatch("TASK-003", "code-reviewer", {}, "resume"),
        seatDispatch("TASK-002", "automation-writer", {}, "resume"),
      ],
      true,
    );
    expect(dispatches(r).map((d) => `${d.task} ${d.seat}`)).toEqual(["TASK-003 code-reviewer", "TASK-002 automation-writer", "TASK-001 test-writer"]);
  });
});

describe("arbiter: every intent has one output", () => {
  it("maps an act, a judge, an in-flight entry and a wait to one output each", () => {
    const world = worldOf({ tasks: [loopTask("TASK-001"), loopTask("TASK-002"), loopTask("TASK-003")], n: 4, pool: [poolSeat("TASK-003")] });
    const waitIntent: Intent = {
      kind: "wait",
      action: { kind: "wait", task: "TASK-002", reason: "verify routed to TASK-003" },
      blockedBy: { kind: "task", task: "TASK-003" },
      origin: "progress",
      task: "TASK-002",
      closes: [],
    };
    const r = run(world, [write("TASK-001", "TASK-001: no test-writer — docs only"), decide("TASK-001"), inFlight("TASK-003", "developer"), waitIntent]);
    expect(r.inFlight).toEqual([{ task: "TASK-003", seat: "developer" }]);
    expect(r.waits).toHaveLength(1);
    expect(r.waits[0].blockedBy).toEqual({ kind: "task", task: "TASK-003" });
    // The decide holds TASK-001's own write: its witness is the decide, not silence.
    expect(r.actions.map((a) => a.kind).sort()).toEqual(["decide", "wait"]);
  });
});
