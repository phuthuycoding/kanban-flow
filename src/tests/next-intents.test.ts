import { describe, it, expect } from "vitest";

import { completable, intentsFor, itemIntents } from "../workflow/next/intents.js";
import { JUDGEMENTS } from "../workflow/next/judgements.js";
import type {
  Action,
  AtCap,
  Cap,
  ImplementerStep,
  Intent,
  Judgement,
  LoopInputs,
  LoopTask,
  SeatSlot,
  TaskPhase,
  TaskState,
  VerifyState,
  World,
} from "../workflow/next/types.js";

// Seeded states: intents read a folded TaskState and a World, so these tests build them by hand and call the
// intents module directly. What `schedule()` makes of the intents (cap, holds, rank) is tested elsewhere.

const FEATURE = "demo";
const T1 = "TASK-001";
const T2 = "TASK-002";
const SHA_A = "aaaaaaa";
const SHA_B = "bbbbbbb";
const OPTS = { resume: false };

const plan = (id: string, over: Partial<LoopTask> = {}): LoopTask => ({
  id,
  dependencies: [],
  files: [`src/${id}.ts`],
  wave: 1,
  overlaps: [],
  inline: false,
  testTypes: ["Unit"],
  ...over,
});

const inputsOf = (tasks: LoopTask[]): LoopInputs => ({
  feature: FEATURE,
  kind: "feature",
  level: "full",
  tasks,
  ceiling: { max: 4, source: "default" },
  reportCommits: {},
  verifyRuns: {},
  gitLog: [],
});

const capOf = (owed: Action[] = []): Cap => ({
  n: 2,
  ceiling: 4,
  owed,
  contention: { held: [], running: null, blocksDevelopers: false },
});

const idleSeats = (): TaskState["seats"] => ({
  "test-writer": { kind: "idle" },
  developer: { kind: "idle" },
  "automation-writer": { kind: "idle" },
  "code-reviewer": { kind: "idle" },
});

function taskOf(id: string, phase: TaskPhase, over: Partial<TaskState> = {}): TaskState {
  return {
    id,
    phase,
    seats: idleSeats(),
    verify: { kind: "notDue" },
    review: { lane: { kind: "free" }, demands: [], ownVerdict: "none" },
    routedIn: [],
    judgements: [],
    roundsUsed: 0,
    reopened: false,
    inline: false,
    commits: [],
    droppedShas: [],
    ...over,
  };
}

function worldOf(states: TaskState[], over: Partial<World> = {}): World {
  const tasks = new Map(states.map((s) => [s.id, s]));
  return {
    inputs: inputsOf(states.map((s) => plan(s.id))),
    cap: capOf(),
    contention: { held: [], running: null, blocksDevelopers: false },
    scan: "done",
    ceiling: "valid",
    unknown: new Map(),
    pool: [],
    tasks,
    ...over,
  };
}

const cycle = (implementer: ImplementerStep, over: Partial<Extract<TaskPhase, { kind: "cycle" }>> = {}): TaskPhase => ({
  kind: "cycle",
  cycle: "first",
  round: 0,
  openedAt: 10,
  implementer,
  sinceCommit: null,
  commits: [],
  ...over,
});

const committedCycle = (over: Partial<Extract<TaskPhase, { kind: "cycle" }>> = {}): TaskPhase =>
  cycle({ kind: "committed" }, { sinceCommit: 20, commits: [SHA_A], ...over });

const atCap = (cap: AtCap): TaskPhase => ({ kind: "atCap", cap });

/** The intents of one seeded task, alone in its world. */
function intentsOf(t: TaskState, world: World = worldOf([t])): Intent[] {
  return intentsFor(t, world);
}

const acts = (intents: Intent[]) =>
  intents.flatMap((i) => (i.kind === "act" ? [i] : []));
const dispatchesOf = (intents: Intent[]) =>
  acts(intents).flatMap((i) => (i.action.kind === "dispatch" ? [i.action] : []));
const writesOf = (intents: Intent[]) => acts(intents).flatMap((i) => (i.action.kind === "write" ? [i.action] : []));
const verifiesOf = (intents: Intent[]) => acts(intents).flatMap((i) => (i.action.kind === "verify" ? [i.action] : []));
const judgesOf = (intents: Intent[]) => intents.flatMap((i) => (i.kind === "judge" ? [i] : []));
const waitsOf = (intents: Intent[]) => intents.flatMap((i) => (i.kind === "wait" ? [i] : []));
const inFlightOf = (intents: Intent[]) => intents.flatMap((i) => (i.kind === "inFlight" ? [i] : []));

const judgement = <K extends Judgement["kind"]>(j: Extract<Judgement, { kind: K }>): Judgement => j;

const running = (over: Partial<Extract<SeatSlot, { kind: "running" }>> = {}): SeatSlot => ({
  kind: "running",
  line: 12,
  inline: false,
  origin: "progress",
  ...over,
});

describe("intents of every phase", () => {
  const phases: [string, TaskPhase, Partial<TaskState>][] = [
    ["pending", { kind: "pending" }, {}],
    ["tests running", { kind: "tests", writer: running(), hashOwed: false }, {}],
    ["tests hash owed", { kind: "tests", writer: { kind: "reported", status: "DONE", answers: 12 }, hashOwed: true }, {}],
    ["ready", { kind: "ready" }, {}],
    ["cycle owed", cycle({ kind: "owed", mode: "new" }), {}],
    ["cycle running", cycle({ kind: "running", dispatchLine: 12, inline: false }), { seats: { ...idleSeats(), developer: running() } }],
    ["cycle round seat running", cycle({ kind: "roundSeatRunning", seat: "test-writer" }, { cycle: "round", round: 1 }), { seats: { ...idleSeats(), "test-writer": running({ round: 1 }) } }],
    ["cycle round hash owed", cycle({ kind: "roundHashOwed" }, { cycle: "round", round: 1 }), {}],
    ["cycle resume commit owed", cycle({ kind: "resumeCommitOwed", round: 1 }, { cycle: "round", round: 1 }), {}],
    ["cycle specs owed", cycle({ kind: "specsOwed" }), {}],
    ["cycle specs running", cycle({ kind: "specsRunning" }), { seats: { ...idleSeats(), "automation-writer": running() } }],
    ["cycle commit note owed", cycle({ kind: "commitNoteOwed", shas: [SHA_A] }), {}],
    ["cycle commit missing", cycle({ kind: "commitMissing", dispatchLine: 12 }), { judgements: [judgement({ kind: "commitMissing", task: T1, openedAt: 13, dispatchLine: 12 })] }],
    ["cycle committed", committedCycle(), {}],
    ["at cap breaker", atCap({ kind: "breaker", parked: [], fixSpent: false }), {}],
    ["at cap cap stop", atCap({ kind: "capStop", noted: false, fixSpent: false }), {}],
    ["at cap minimal fix owed", atCap({ kind: "minimalFixOwed", via: "breaker" }), {}],
    ["at cap cascade", atCap({ kind: "cascadeAtCap", sha7: SHA_A, reopened: false }), {}],
    ["at cap parked closed", atCap({ kind: "parkedClosed" }), {}],
  ];

  it.each(phases)("yields at least one intent while the task is in phase %s", (_name, phase, over) => {
    const t = taskOf(T1, phase, over);
    expect(intentsOf(t).length).toBeGreaterThan(0);
  });

  it("yields no intent for a complete task", () => {
    for (const how of ["complete", "implemented", "superseded"] as const) {
      expect(intentsOf(taskOf(T1, { kind: "complete", how }))).toEqual([]);
    }
  });

  it("marks a progress intent as progress and closes it with at least one event", () => {
    const intents = intentsOf(taskOf(T1, { kind: "ready" }));
    expect(intents.length).toBeGreaterThan(0);
    for (const i of intents) {
      expect(i.origin).toBe("progress");
      expect(i.closes.length).toBeGreaterThan(0);
    }
  });
});

describe("intents before the developer", () => {
  it("dispatches a new test-writer for a pending task that has Unit tests", () => {
    const intents = intentsOf(taskOf(T1, { kind: "pending" }));
    expect(dispatchesOf(intents)).toEqual([expect.objectContaining({ kind: "dispatch", task: T1, seat: "test-writer", mode: "new" })]);
    expect(intents[0].closes).toContain("dispatched");
  });

  it("writes a no test-writer line for a pending task with no Unit or Integration tests", () => {
    const t = taskOf(T1, { kind: "pending" });
    const world = worldOf([t], { inputs: inputsOf([plan(T1, { testTypes: ["UI"] })]) });
    const intents = intentsOf(t, world);
    expect(dispatchesOf(intents)).toEqual([]);
    const lines = writesOf(intents);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.startsWith(`${T1}: no test-writer — `)).toBe(true);
    expect(lines[0].record.startsWith(`kf record ${FEATURE} line -- `)).toBe(true);
    expect(intents[0].closes).toContain("noTestWriter");
  });

  it("is in flight, not owing a write, while the first-pass test-writer runs", () => {
    const intents = intentsOf(taskOf(T1, { kind: "tests", writer: running(), hashOwed: false }));
    expect(inFlightOf(intents)).toEqual([expect.objectContaining({ entry: expect.objectContaining({ task: T1, seat: "test-writer" }) })]);
    expect(writesOf(intents)).toEqual([]);
    expect(dispatchesOf(intents)).toEqual([]);
  });

  it("writes the test hashes once the test-writer is done", () => {
    const t = taskOf(T1, { kind: "tests", writer: { kind: "reported", status: "DONE", answers: 12 }, hashOwed: true });
    const lines = writesOf(intentsOf(t));
    expect(lines).toHaveLength(1);
    expect(lines[0].line.startsWith(`${T1}: test hashes`)).toBe(true);
    expect(intentsOf(t)[0].closes).toContain("testHashes");
  });

  it("dispatches a new developer once the tests are ready, inline when the task is inline", () => {
    expect(dispatchesOf(intentsOf(taskOf(T1, { kind: "ready" })))).toEqual([
      expect.objectContaining({ task: T1, seat: "developer", mode: "new" }),
    ]);
    const inline = dispatchesOf(intentsOf(taskOf(T1, { kind: "ready" }, { inline: true })));
    expect(inline).toHaveLength(1);
    expect(inline[0]).toMatchObject({ seat: "developer", inline: true });
  });
});

describe("intents of the implementer step", () => {
  it.each([
    [1, "resume"],
    [2, "resume"],
    [3, "resume"],
    [4, "fresh"],
    [5, "fresh"],
  ] as const)("dispatches the round %i developer as %s", (round, mode) => {
    const t = taskOf(T1, cycle({ kind: "owed", mode, round }, { cycle: "round", round }));
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ task: T1, seat: "developer", mode, round })]);
  });

  it("resumes the developer to commit the round's tests, with the round", () => {
    const t = taskOf(T1, cycle({ kind: "resumeCommitOwed", round: 2 }, { cycle: "round", round: 2 }));
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ task: T1, seat: "developer", mode: "resume", round: 2 })]);
  });

  it("writes the test hashes a round's test-writer owes", () => {
    const t = taskOf(T1, cycle({ kind: "roundHashOwed" }, { cycle: "round", round: 1 }));
    const lines = writesOf(intentsOf(t));
    expect(lines).toHaveLength(1);
    expect(lines[0].line.startsWith(`${T1}: test hashes`)).toBe(true);
  });

  it("dispatches a new automation-writer when specs are owed", () => {
    const t = taskOf(T1, cycle({ kind: "specsOwed" }));
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ task: T1, seat: "automation-writer", mode: "new" })]);
  });

  it("writes the commits note for shas the report names and the git log has", () => {
    const t = taskOf(T1, cycle({ kind: "commitNoteOwed", shas: [SHA_A, SHA_B] }));
    const lines = writesOf(intentsOf(t));
    expect(lines).toEqual([
      expect.objectContaining({
        task: T1,
        line: `Note ${T1}: commits ${SHA_A},${SHA_B}`,
        record: `kf record ${FEATURE} commits ${T1} ${SHA_A},${SHA_B}`,
      }),
    ]);
    expect(intentsOf(t)[0].closes).toContain("commits");
  });

  it("asks for a Commit missing decision whose closes names the note and the re-dispatch", () => {
    const t = taskOf(T1, cycle({ kind: "commitMissing", dispatchLine: 12 }), {
      judgements: [judgement({ kind: "commitMissing", task: T1, openedAt: 13, dispatchLine: 12 })],
    });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("commitMissing");
    expect(judges[0].action).toMatchObject({ kind: "decide", task: T1, rule: "Commit missing" });
    expect((judges[0].action as Extract<Action, { kind: "decide" }>).closes).toContain(`Note ${T1}: commits <sha7>`);
    expect(judges[0].closes).toEqual(expect.arrayContaining(["commits", "dispatched"]));
  });

  it("is in flight while the developer runs", () => {
    const t = taskOf(T1, cycle({ kind: "running", dispatchLine: 12, inline: false }), { seats: { ...idleSeats(), developer: running() } });
    const intents = intentsOf(t);
    expect(inFlightOf(intents)).toEqual([expect.objectContaining({ entry: expect.objectContaining({ task: T1, seat: "developer" }) })]);
    expect(dispatchesOf(intents)).toEqual([]);
  });
});

describe("intents of a seat that did not report DONE", () => {
  it("asks for a Seat status decision on a gated seat", () => {
    const t = taskOf(T1, cycle({ kind: "running", dispatchLine: 12, inline: false }), {
      seats: { ...idleSeats(), developer: { kind: "gated", status: "NEEDS_CONTEXT", doneLine: 14 } },
      judgements: [judgement({ kind: "seatStatus", task: T1, openedAt: 14, seat: "developer", status: "NEEDS_CONTEXT", doneLine: 14 })],
    });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("seatStatus");
    expect(judges[0].action).toMatchObject({ kind: "decide", task: T1, rule: "Seat status" });
  });

  it("quotes an unknown raw status in the Seat status reason", () => {
    const t = taskOf(T1, cycle({ kind: "running", dispatchLine: 12, inline: false }), {
      seats: { ...idleSeats(), developer: { kind: "gated", status: { unknown: "PARTIALLY_DONE" }, doneLine: 14 } },
      judgements: [judgement({ kind: "seatStatus", task: T1, openedAt: 14, seat: "developer", status: { unknown: "PARTIALLY_DONE" }, doneLine: 14 })],
    });
    const decide = judgesOf(intentsOf(t))[0].action as Extract<Action, { kind: "decide" }>;
    expect(decide.reason).toContain("PARTIALLY_DONE");
  });

  it("re-dispatches a seat whose gate a decision closed, with the same round and cascade", () => {
    const t = taskOf(T1, committedCycle({ cycle: "round", round: 2 }), {
      seats: { ...idleSeats(), "code-reviewer": { kind: "redispatchOwed", mode: "new", round: 2, cascade: SHA_A } },
    });
    expect(dispatchesOf(intentsOf(t))).toContainEqual(
      expect.objectContaining({ task: T1, seat: "code-reviewer", mode: "new", round: 2, cascade: SHA_A }),
    );
  });

  it("re-dispatches a developer whose gate a decision closed as a resume at its round", () => {
    const t = taskOf(T1, cycle({ kind: "owed", mode: "resume", round: 2 }, { cycle: "round", round: 2 }), {
      seats: { ...idleSeats(), developer: { kind: "redispatchOwed", mode: "resume", round: 2 } },
    });
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ seat: "developer", mode: "resume", round: 2 })]);
  });
});

describe("intents of the verify region", () => {
  const verifyT = (verify: VerifyState, over: Partial<TaskState> = {}) =>
    taskOf(T1, committedCycle(), { verify, commits: [SHA_A, SHA_B], ...over });

  it("names the verify with the task's commits when one is owed", () => {
    const verifies = verifiesOf(intentsOf(verifyT({ kind: "owed", atHead: false, why: "commit" })));
    expect(verifies).toEqual([{ kind: "verify", task: T1, command: `kf verify ${FEATURE} --task ${T1} --commits ${SHA_A},${SHA_B}` }]);
  });

  it("adds --at-head when the owed verify runs at head", () => {
    const [v] = verifiesOf(intentsOf(verifyT({ kind: "owed", atHead: true, why: "released" })));
    expect(v.command).toBe(`kf verify ${FEATURE} --task ${T1} --commits ${SHA_A},${SHA_B} --at-head`);
  });

  it("names a plain re-run of a failure that has no log block as a rerun", () => {
    const [v] = verifiesOf(intentsOf(verifyT({ kind: "failed", line: 30, disposition: { kind: "plainRerunOwed" } })));
    expect(v).toMatchObject({ kind: "verify", task: T1, rerun: true });
    expect(v.command).toBe(`kf verify ${FEATURE} --task ${T1} --commits ${SHA_A},${SHA_B}`);
  });

  it("waits for the task a failing verify waits for, blocked by that task", () => {
    const waits = waitsOf(intentsOf(verifyT({ kind: "failed", line: 30, disposition: { kind: "waits", otherTask: T2 } })));
    expect(waits).toEqual([
      expect.objectContaining({
        action: { kind: "wait", task: T1, reason: `verify waits for ${T2}` },
        blockedBy: { kind: "task", task: T2 },
      }),
    ]);
  });

  it("waits while the verify is routed to another task, blocked by that task", () => {
    const waits = waitsOf(intentsOf(verifyT({ kind: "failed", line: 30, disposition: { kind: "routedOut", otherTask: T2, line: 31 } })));
    expect(waits).toEqual([
      expect.objectContaining({
        action: { kind: "wait", task: T1, reason: `verify routed to ${T2}` },
        blockedBy: { kind: "task", task: T2 },
      }),
    ]);
  });

  it("stops on a wait that can never be released", () => {
    const t = verifyT(
      { kind: "failed", line: 30, disposition: { kind: "waitsUnreleasable", otherTask: T2, why: "overlaps and ranks later" } },
      { judgements: [judgement({ kind: "verifyWaitsUnreleasable", task: T1, openedAt: 31, otherTask: T2, why: "overlaps and ranks later" })] },
    );
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("verifyWaitsUnreleasable");
    expect(judges[0].action.kind).toBe("stop");
  });

  it("asks for a Verify routed decision when the route was rejected", () => {
    const t = verifyT(
      { kind: "failed", line: 30, disposition: { kind: "routeRejected", otherTask: T2 } },
      { judgements: [judgement({ kind: "verifyRouted", task: T1, openedAt: 31, otherTask: T2 })] },
    );
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("verifyRouted");
    expect(judges[0].action).toMatchObject({ kind: "decide", task: T1, rule: "Verify routed" });
  });

  it("stops on exit 2", () => {
    const t = verifyT({ kind: "exit2Stop" }, { judgements: [judgement({ kind: "verifyExit2", task: T1, openedAt: 31 })] });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("verifyExit2");
    expect(judges[0].action.kind).toBe("stop");
  });

  it("asks for a Verify exit 3 decision whose reason names the dropped shas", () => {
    const t = verifyT(
      { kind: "exit3Decide", droppedShas: ["ccccccc", "ddddddd"] },
      { judgements: [judgement({ kind: "verifyExit3", task: T1, openedAt: 31, droppedShas: ["ccccccc", "ddddddd"] })] },
    );
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("verifyExit3");
    const decide = judges[0].action as Extract<Action, { kind: "decide" }>;
    expect(decide).toMatchObject({ kind: "decide", rule: "Verify exit 3" });
    expect(decide.reason).toContain("ccccccc");
    expect(decide.reason).toContain("ddddddd");
  });

  it("asks for a Verify exit decision that quotes an exit code outside 0 to 3", () => {
    const t = verifyT({ kind: "unknownExit", raw: 137 }, { judgements: [judgement({ kind: "verifyExit", task: T1, openedAt: 31, exit: 137 })] });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("verifyExit");
    const decide = judges[0].action as Extract<Action, { kind: "decide" }>;
    expect(decide.rule).toBe("Verify exit");
    expect(decide.reason).toContain("137");
  });

  it("is in flight while a verify runs", () => {
    const intents = intentsOf(verifyT({ kind: "running", line: 25, rerun: false, stale: false }));
    expect(inFlightOf(intents)).toEqual([expect.objectContaining({ entry: expect.objectContaining({ task: T1, seat: "verify" }) })]);
    expect(verifiesOf(intents)).toEqual([]);
  });
});

describe("intents of the review region", () => {
  const reviewT = (over: Partial<TaskState>, phase: TaskPhase = committedCycle()) =>
    taskOf(T1, phase, { commits: [SHA_A], verify: { kind: "passed", line: 25 }, ...over });

  it("dispatches a new code-reviewer for the task's own review when the lane is free", () => {
    const t = reviewT({ review: { lane: { kind: "free" }, demands: [{ kind: "own" }], ownVerdict: "none" } });
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ task: T1, seat: "code-reviewer", mode: "new" })]);
  });

  it("gives a fix round's own review the round", () => {
    const t = reviewT(
      { review: { lane: { kind: "free" }, demands: [{ kind: "own", round: 2 }], ownVerdict: "none" } },
      committedCycle({ cycle: "round", round: 2 }),
    );
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ seat: "code-reviewer", mode: "new", round: 2 })]);
  });

  it("dispatches a cascade re-review with the cascade sha", () => {
    const t = reviewT({ review: { lane: { kind: "free" }, demands: [{ kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "owed" }], ownVerdict: "clean" } });
    expect(dispatchesOf(intentsOf(t))).toEqual([expect.objectContaining({ task: T1, seat: "code-reviewer", mode: "new", cascade: SHA_B })]);
  });

  it("writes the cascade re-review owed line before the cascade is dispatched", () => {
    const t = reviewT({ review: { lane: { kind: "free" }, demands: [{ kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "lineOwed" }], ownVerdict: "clean" } });
    expect(writesOf(intentsOf(t))).toEqual([
      expect.objectContaining({
        task: T1,
        line: `${T1}: cascade re-review owed — after ${SHA_B} of ${T2}`,
        record: `kf record ${FEATURE} cascade-owed ${T1} ${SHA_B} ${T2}`,
      }),
    ]);
    expect(intentsOf(t)[0].closes).toContain("cascadeOwed");
  });

  it("waits, blocked by the reviewer lane, while another demand is queued behind a busy lane", () => {
    const busy = { kind: "busy" as const, line: 40, obligation: { kind: "own" as const } };
    const t = reviewT({
      review: { lane: busy, demands: [{ kind: "own" }, { kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "owed" }], ownVerdict: "none" },
      seats: { ...idleSeats(), "code-reviewer": running({ line: 40 }) },
    });
    const intents = intentsOf(t);
    expect(waitsOf(intents)).toEqual([
      expect.objectContaining({
        action: { kind: "wait", task: T1, reason: `code-reviewer of ${T1} in flight` },
        blockedBy: { kind: "reviewer", task: T1 },
      }),
    ]);
    expect(dispatchesOf(intents)).toEqual([]);
  });

  // The line numbers the round that ended, and is printed only beside the action that ends that round.
  const fixRoundWritesOf = (intents: Intent[]) => acts(intents).filter((i) => i.action.kind === "write" && i.action.line.includes(": fix round "));
  const findingsAfterRound1 = () =>
    reviewT(
      { review: { lane: { kind: "free" }, demands: [], ownVerdict: "findings" }, roundsUsed: 1 },
      committedCycle({ cycle: "round", round: 1 }),
    );

  it("writes the ended round's fix round line beside the next round's developer dispatch", () => {
    const intents = intentsOf(findingsAfterRound1());
    const writes = fixRoundWritesOf(intents);
    expect(writes).toHaveLength(1);
    const write = writes[0].action as Extract<Action, { kind: "write" }>;
    expect(write.line.startsWith(`${T1}: fix round 1/5 (`)).toBe(true);
    expect(write.record.startsWith(`kf record ${FEATURE} fix-round ${T1} 1 -- `)).toBe(true);
    expect(writes[0].closes).toContain("fixRound");
    expect(dispatchesOf(intents)).toEqual([expect.objectContaining({ task: T1, seat: "developer", round: 2 })]);
  });

  it("prints no fix round line while the cap holds the next round's developer", () => {
    const t = findingsAfterRound1();
    const pool = [
      { task: T2, line: 41 },
      { task: "TASK-003", line: 42 },
    ];
    expect(fixRoundWritesOf(intentsOf(t, worldOf([t], { pool })))).toEqual([]);
  });

  it("writes the ended round's fix round line beside complete when the re-review is clean", () => {
    const t = reviewT(
      { review: { lane: { kind: "free" }, demands: [], ownVerdict: "clean" }, roundsUsed: 2 },
      committedCycle({ cycle: "round", round: 2 }),
    );
    const intents = intentsOf(t);
    const writes = fixRoundWritesOf(intents);
    expect(writes).toHaveLength(1);
    const write = writes[0].action as Extract<Action, { kind: "write" }>;
    expect(write.line.startsWith(`${T1}: fix round 2/5 (`)).toBe(true);
    expect(write.record.startsWith(`kf record ${FEATURE} fix-round ${T1} 2 -- `)).toBe(true);
    expect(acts(intents).map((i) => i.action)).toContainEqual({ kind: "complete", task: T1 });
  });
});

describe("intents at the cap", () => {
  const closesOf = (intent: Intent): string => ((intent as { action: Extract<Action, { kind: "decide" }> }).action.closes);

  it("asks for a Breaker decision offering the park close and the minimal fix", () => {
    const t = taskOf(T1, atCap({ kind: "breaker", parked: [], fixSpent: false }), { judgements: [judgement({ kind: "breaker", task: T1, openedAt: 50 })] });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("breaker");
    expect(judges[0].action).toMatchObject({ kind: "decide", task: T1, rule: JUDGEMENTS.breaker.rule });
    expect(closesOf(judges[0])).toContain(`${T1}: parked — `);
    expect(closesOf(judges[0])).toContain("minimal fix past the cap:");
    expect(judges[0].closes).toEqual(expect.arrayContaining(["parked", "decided"]));
  });

  it("offers only the park close once the minimal fix is spent", () => {
    const t = taskOf(T1, atCap({ kind: "breaker", parked: [], fixSpent: true }), { judgements: [judgement({ kind: "breakerFixSpent", task: T1, openedAt: 50 })] });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("breakerFixSpent");
    expect(closesOf(judges[0])).toContain(`${T1}: parked — `);
    expect(closesOf(judges[0])).not.toContain("minimal fix past the cap:");
  });

  it("stops a reopened task at the cap and writes the cap reached note once", () => {
    const t = taskOf(T1, atCap({ kind: "capStop", noted: false, fixSpent: false }), {
      reopened: true,
      judgements: [judgement({ kind: "capStop", task: T1, openedAt: 50 })],
    });
    const intents = intentsOf(t);
    expect(judgesOf(intents)).toEqual([expect.objectContaining({ judgement: "capStop", action: expect.objectContaining({ kind: "stop", task: T1 }) })]);
    const lines = writesOf(intents);
    expect(lines).toHaveLength(1);
    expect(lines[0].line.startsWith(`Note ${T1}: cap reached — `)).toBe(true);
    expect(lines[0].record.startsWith(`kf record ${FEATURE} line -- `)).toBe(true);
  });

  it("does not write the cap reached note again once it is noted", () => {
    const t = taskOf(T1, atCap({ kind: "capStop", noted: true, fixSpent: false }), {
      reopened: true,
      judgements: [judgement({ kind: "capStop", task: T1, openedAt: 50 })],
    });
    const intents = intentsOf(t);
    expect(writesOf(intents)).toEqual([]);
    expect(judgesOf(intents)).toHaveLength(1);
  });

  it("dispatches a fresh developer with no round for the owed minimal fix, and prints no Breaker or stop", () => {
    for (const via of ["breaker", "capStop"] as const) {
      const intents = intentsOf(taskOf(T1, atCap({ kind: "minimalFixOwed", via }), { reopened: via === "capStop" }));
      const dispatches = dispatchesOf(intents);
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0]).toMatchObject({ task: T1, seat: "developer", mode: "fresh" });
      expect(dispatches[0].round).toBeUndefined();
      expect(judgesOf(intents)).toEqual([]);
    }
  });

  it("dispatches the owed minimal fix inline when the task is inline", () => {
    const [d] = dispatchesOf(intentsOf(taskOf(T1, atCap({ kind: "minimalFixOwed", via: "breaker" }), { inline: true })));
    expect(d).toMatchObject({ seat: "developer", mode: "fresh", inline: true });
  });

  it("offers a park-only Breaker for a cascade finding at the cap of a task never reopened", () => {
    const t = taskOf(T1, atCap({ kind: "cascadeAtCap", sha7: SHA_A, reopened: false }), {
      judgements: [judgement({ kind: "cascadeAtCapBreaker", task: T1, openedAt: 50, sha7: SHA_A })],
    });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("cascadeAtCapBreaker");
    expect(judges[0].action.kind).toBe("decide");
    expect(closesOf(judges[0])).toContain(`${T1}: parked — `);
    expect(closesOf(judges[0])).not.toContain("minimal fix past the cap:");
  });

  it("stops for a cascade finding at the cap of a reopened task, closed only by superseded", () => {
    const t = taskOf(T1, atCap({ kind: "cascadeAtCap", sha7: SHA_A, reopened: true }), {
      reopened: true,
      judgements: [judgement({ kind: "cascadeAtCapStop", task: T1, openedAt: 50, sha7: SHA_A })],
    });
    const judges = judgesOf(intentsOf(t));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("cascadeAtCapStop");
    expect(judges[0].action.kind).toBe("stop");
  });

  it("yields no intent but the completion for a parked-closed task that is ready", () => {
    const t = taskOf(T1, atCap({ kind: "parkedClosed" }), {
      verify: { kind: "failed", line: 30, disposition: { kind: "parkedAtCap" } },
      review: { lane: { kind: "free" }, demands: [], ownVerdict: "findings" },
    });
    const intents = intentsOf(t);
    expect(acts(intents).map((i) => i.action.kind)).toEqual(["complete"]);
  });
});

describe("intents of a lost seat under resume", () => {
  it("re-issues a running seat of origin resume as a resume dispatch with the same round", () => {
    const t = taskOf(T1, cycle({ kind: "running", dispatchLine: 12, inline: false }, { cycle: "round", round: 2 }), {
      seats: { ...idleSeats(), developer: running({ round: 2, origin: "resume" }) },
    });
    const intents = intentsOf(t);
    const resumed = acts(intents).filter((i) => i.origin === "resume");
    expect(resumed.map((i) => i.action)).toEqual([expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 2 })]);
  });

  it("keeps a running seat of origin progress as in flight only", () => {
    const t = taskOf(T1, cycle({ kind: "running", dispatchLine: 12, inline: false }), { seats: { ...idleSeats(), developer: running() } });
    const intents = intentsOf(t);
    expect(intents.filter((i) => i.origin === "resume")).toEqual([]);
  });
});

describe("completable", () => {
  const readyT = (over: Partial<TaskState> = {}, phase: TaskPhase = committedCycle()) =>
    taskOf(T1, phase, {
      commits: [SHA_A],
      verify: { kind: "passed", line: 25 },
      review: { lane: { kind: "free" }, demands: [], ownVerdict: "clean" },
      ...over,
    });

  it("is true for a committed task whose verify passed after the commit and whose review is clean", () => {
    const t = readyT();
    expect(completable(t, worldOf([t]))).toBe(true);
  });

  it("makes the complete action the task's intent when it is completable", () => {
    const t = readyT();
    const intents = intentsOf(t);
    expect(acts(intents).map((i) => i.action)).toContainEqual({ kind: "complete", task: T1 });
  });

  it("is true when the verify passed by a route to a task that passed", () => {
    const t = readyT({ verify: { kind: "passedByRoute" } });
    expect(completable(t, worldOf([t]))).toBe(true);
  });

  it("is true for a parked-closed task whose kept verify failure and findings are waived", () => {
    const t = readyT(
      {
        verify: { kind: "failed", line: 30, disposition: { kind: "kept" } },
        review: { lane: { kind: "free" }, demands: [], ownVerdict: "findings" },
      },
      atCap({ kind: "parkedClosed" }),
    );
    expect(completable(t, worldOf([t]))).toBe(true);
  });

  it.each<[string, Partial<TaskState>, TaskPhase?]>([
    ["the implementer has not committed", {}, cycle({ kind: "commitMissing", dispatchLine: 12 })],
    ["the commit note is owed", {}, cycle({ kind: "commitNoteOwed", shas: [SHA_A] })],
    ["a resume commit is owed", {}, cycle({ kind: "resumeCommitOwed", round: 1 }, { cycle: "round", round: 1 })],
    ["round hashes are owed", {}, cycle({ kind: "roundHashOwed" }, { cycle: "round", round: 1 })],
    ["specs are owed", {}, cycle({ kind: "specsOwed" })],
    ["the verify has not run", { verify: { kind: "notDue" } }],
    ["the verify is owed", { verify: { kind: "owed", atHead: false, why: "commit" } }],
    ["the verify is running", { verify: { kind: "running", line: 25, rerun: false, stale: false } }],
    ["the verify passed before the latest commit", { verify: { kind: "passed", line: 15 } }],
    ["the verify failed and the failure is kept without a park", { verify: { kind: "failed", line: 30, disposition: { kind: "kept" } } }],
    ["the verify waits for another task", { verify: { kind: "failed", line: 30, disposition: { kind: "waits", otherTask: T2 } } }],
    ["no own review has returned", { review: { lane: { kind: "free" }, demands: [], ownVerdict: "none" } }],
    ["the own review returned findings", { review: { lane: { kind: "free" }, demands: [], ownVerdict: "findings" } }],
    ["the review lane is busy", { review: { lane: { kind: "busy", line: 40, obligation: { kind: "own" } }, demands: [], ownVerdict: "clean" } }],
    ["a cascade re-review is owed", { review: { lane: { kind: "free" }, demands: [{ kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "owed" }], ownVerdict: "clean" } }],
    ["a cascade re-review returned findings", { review: { lane: { kind: "free" }, demands: [{ kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "findings" }], ownVerdict: "clean" } }],
    ["a failure routed into the task is unanswered", { routedIn: [{ from: T2, line: 35, answered: false }] }],
    ["a seat is running", { seats: { ...idleSeats(), "code-reviewer": running() } }],
    ["a seat is gated", { seats: { ...idleSeats(), developer: { kind: "gated", status: "BLOCKED", doneLine: 14 } } }],
    ["a seat is owed a re-dispatch", { seats: { ...idleSeats(), "code-reviewer": { kind: "redispatchOwed", mode: "new" } } }],
    ["a judgement is open", { judgements: [judgement({ kind: "breaker", task: T1, openedAt: 50 })] }],
  ])("is false when %s", (_why, over, phase) => {
    const t = readyT(over, phase);
    expect(completable(t, worldOf([t]))).toBe(false);
  });

  it("is true when every cascade re-review is clean and an answered routed-in failure is no blocker", () => {
    const t = readyT({
      review: { lane: { kind: "free" }, demands: [{ kind: "cascade", sha7: SHA_B, round: 1, of: T2, phase: "clean" }], ownVerdict: "clean" },
      routedIn: [{ from: T2, line: 35, answered: true }],
    });
    expect(completable(t, worldOf([t]))).toBe(true);
  });

  it("is false while a dependency is not complete and true once it is", () => {
    const t = readyT();
    const inputs = inputsOf([plan(T1, { dependencies: [T2] }), plan(T2)]);
    const dep = (phase: TaskPhase) => taskOf(T2, phase);
    expect(completable(t, worldOf([t, dep(committedCycle())], { inputs }))).toBe(false);
    expect(completable(t, worldOf([t, dep({ kind: "complete", how: "complete" })], { inputs }))).toBe(true);
    expect(completable(t, worldOf([t, dep({ kind: "complete", how: "implemented" })], { inputs }))).toBe(true);
  });

  it("is false while contention holds or runs a re-run of the task", () => {
    const t = readyT();
    const held = worldOf([t], { contention: { held: [{ task: T1, atHead: false, kind: "rerun" }], running: null, blocksDevelopers: true } });
    const runningRerun = worldOf([t], { contention: { held: [], running: T1, blocksDevelopers: true } });
    expect(completable(t, held)).toBe(false);
    expect(completable(t, runningRerun)).toBe(false);
  });

  it("is not blocked by a contention re-run of another task", () => {
    const t = readyT();
    const other = worldOf([t], { contention: { held: [{ task: T2, atHead: false, kind: "rerun" }], running: null, blocksDevelopers: true } });
    expect(completable(t, other)).toBe(true);
  });

  it("is false for a parked-closed task with a minimal fix unfinished, and for a task at the cap with a fix owed", () => {
    for (const cap of [{ kind: "minimalFixOwed", via: "breaker" }, { kind: "breaker", parked: [60], decidedAt: 61, fixSpent: false }] as AtCap[]) {
      const t = readyT({}, atCap(cap));
      expect(completable(t, worldOf([t]))).toBe(false);
    }
  });
});

describe("item intents", () => {
  it("asks for the conflict scan until it is done", () => {
    const t = taskOf(T1, { kind: "pending" });
    const open = judgesOf(itemIntents(worldOf([t], { scan: "none" }), OPTS));
    expect(open).toHaveLength(1);
    expect(open[0].judgement).toBe("conflictScan");
    expect(open[0].action).toMatchObject({ kind: "decide", rule: "Conflict scan" });
    expect((open[0].action as Extract<Action, { kind: "decide" }>).closes.startsWith("Scan:")).toBe(true);
    expect(open[0].origin).toBe("progress");
    expect(open[0].closes).toContain("scan");
    expect(judgesOf(itemIntents(worldOf([t], { scan: "done" }), OPTS))).toEqual([]);
  });

  it("passes the cap's owed writes through as intents", () => {
    const owed: Action = {
      kind: "write",
      line: "Ruling: developer cap 2 — start — cost if wrong: <…>",
      record: `kf record ${FEATURE} line -- 'Ruling: developer cap 2 — start — cost if wrong: <…>'`,
    };
    const intents = itemIntents(worldOf([taskOf(T1, { kind: "pending" })], { cap: capOf([owed]) }), OPTS);
    expect(writesOf(intents)).toContainEqual(owed);
  });

  it("asks for a decision on an invalid ceiling until one is made", () => {
    const t = taskOf(T1, { kind: "pending" });
    const invalid = judgesOf(itemIntents(worldOf([t], { ceiling: "invalidUndecided" }), OPTS));
    expect(invalid).toHaveLength(1);
    expect(invalid[0].judgement).toBe("invalidCeiling");
    expect(invalid[0].action).toMatchObject({ kind: "decide", rule: "Invalid ceiling" });
    for (const ceiling of ["valid", "ruled"] as const) {
      expect(judgesOf(itemIntents(worldOf([t], { ceiling }), OPTS))).toEqual([]);
    }
  });

  it("asks for an Unknown task decision for each undecided unknown task only", () => {
    const t = taskOf(T1, { kind: "pending" });
    const unknown = new Map([
      ["TASK-090", { decided: false }],
      ["TASK-091", { decided: true }],
    ]);
    const judges = judgesOf(itemIntents(worldOf([t], { unknown }), OPTS));
    expect(judges).toHaveLength(1);
    expect(judges[0].judgement).toBe("unknownTask");
    expect(judges[0].action).toMatchObject({ kind: "decide", task: "TASK-090", rule: "Unknown task" });
  });

  it("yields nothing for a clean world", () => {
    const t = taskOf(T1, { kind: "pending" });
    expect(itemIntents(worldOf([t]), OPTS)).toEqual([]);
    expect(itemIntents(worldOf([t]), { resume: true })).toEqual([]);
  });
});
