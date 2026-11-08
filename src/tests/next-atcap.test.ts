import { describe, it, expect } from "vitest";

import { initialTask } from "../workflow/next/fold.js";
import { atCapStep } from "../workflow/next/atcap.js";
import type { AtCap, LoopInputs, MachineEvent, TaskPhase, TaskState, World } from "../workflow/next/types.js";

// The at-cap region on seeded states: the Breaker (a park and a decided note, in either order), the cap stop, the
// one minimal fix past the cap, and cascade findings at the cap.

const TASK = "TASK-001";
const SHA7 = "abc1234";
let line = 200;

const inputs: LoopInputs = {
  feature: "demo",
  kind: "feature",
  level: null,
  tasks: [{ id: TASK, dependencies: [], files: null, wave: 1, overlaps: [], inline: false, testTypes: ["Unit"] }],
  ceiling: { max: 4, source: "default" },
  reportCommits: {},
  verifyRuns: {},
  gitLog: [],
};
const world = { inputs, tasks: new Map() } as unknown as World;

const atCap = (cap: AtCap, over: Partial<TaskState> = {}): TaskState => ({
  ...initialTask(inputs.tasks[0]),
  phase: { kind: "atCap", cap },
  roundsUsed: 5,
  ...over,
});
const breaker = (over: Partial<Extract<AtCap, { kind: "breaker" }>> = {}): AtCap => ({ kind: "breaker", parked: [], fixSpent: false, ...over });

const stamp = () => ({ line: ++line, ts: line * 1000 });
const park: MachineEvent = { ...stamp(), type: "parked", task: TASK, finding: "stale lint rule" };
const decide = (what: string): MachineEvent => ({ ...stamp(), type: "decided", task: TASK, what });
const plain = (): MachineEvent => decide("accept the remaining finding");
const minimalFix = (): MachineEvent => decide("minimal fix past the cap: drop the unused branch");
const superseded: MachineEvent = { ...stamp(), type: "complete", task: TASK, text: "superseded — replaced by TASK-009" };
const dispatchDev = (extra: { round?: number } = {}): MachineEvent => ({
  ...stamp(), type: "dispatched", task: TASK, seat: "developer", model: "opus", ...extra,
});

describe("at cap: the Breaker closes on a park and a decided note in either order", () => {
  it("closes when the park comes first and the decided note second", () => {
    const afterPark = atCapStep(atCap(breaker()), park, world);
    expect(afterPark.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", parked: [park.line] } });
    const next = atCapStep(afterPark, plain(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "parkedClosed" } });
  });

  it("closes when the decided note comes first and the park second", () => {
    const decided = plain();
    const afterDecided = atCapStep(atCap(breaker()), decided, world);
    expect(afterDecided.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", decidedAt: decided.line } });
    const next = atCapStep(afterDecided, park, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "parkedClosed" } });
  });

  it("stays open on a decided note alone", () => {
    const next = atCapStep(atCap(breaker()), plain(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", parked: [] } });
  });

  it("stays open on a park alone", () => {
    const next = atCapStep(atCap(breaker()), park, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", decidedAt: undefined } });
  });

  it("ignores a park or a decided note that names another task", () => {
    const next = atCapStep(atCap(breaker({ parked: [150] })), { ...plain(), task: "TASK-002" } as MachineEvent, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker" } });
  });
});

describe("at cap: the minimal fix past the cap", () => {
  it("owes the fix from the Breaker on a minimal-fix note", () => {
    const next = atCapStep(atCap(breaker()), minimalFix(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed", via: "breaker" } });
  });

  it("owes the fix from the cap stop on a minimal-fix note", () => {
    const next = atCapStep(atCap({ kind: "capStop", noted: true, fixSpent: false }, { reopened: true }), minimalFix(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed", via: "capStop" } });
  });

  it("owes the fix, never a closed Breaker, when a park is already recorded", () => {
    const next = atCapStep(atCap(breaker({ parked: [150] })), minimalFix(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed" } });
  });

  it("owes the fix when the park comes after the minimal-fix note", () => {
    const afterFix = atCapStep(atCap(breaker()), minimalFix(), world);
    const next = atCapStep(afterFix, park, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed" } });
  });

  it("owes nothing for a minimal-fix note once the fix is spent (Breaker)", () => {
    const start = atCap(breaker({ fixSpent: true }));
    expect(atCapStep(start, minimalFix(), world).phase).toEqual(start.phase);
  });

  it("owes nothing for a minimal-fix note once the fix is spent (cap stop)", () => {
    const start = atCap({ kind: "capStop", noted: true, fixSpent: true }, { reopened: true });
    expect(atCapStep(start, minimalFix(), world).phase).toEqual(start.phase);
  });

  it("owes nothing for a second minimal-fix note while the fix is already owed", () => {
    const start = atCap({ kind: "minimalFixOwed", via: "breaker" });
    expect(atCapStep(start, minimalFix(), world).phase).toEqual(start.phase);
  });

  it("owes nothing for a second minimal-fix note while the fix runs", () => {
    const running: TaskPhase = { kind: "cycle", cycle: "minimalFix", round: 5, openedAt: 210, implementer: { kind: "running", dispatchLine: 210, inline: false }, sinceCommit: null, commits: [] };
    const start = { ...atCap(breaker()), phase: running };
    expect(atCapStep(start, minimalFix(), world).phase).toEqual(running);
  });

  it("opens the fix cycle on a round-less developer dispatch", () => {
    const next = atCapStep(atCap({ kind: "minimalFixOwed", via: "breaker" }), dispatchDev(), world);
    expect(next.phase).toMatchObject({ kind: "cycle", cycle: "minimalFix" });
  });

  it("opens the fix cycle on a round-less dispatch when the fix came by the cap stop", () => {
    const next = atCapStep(atCap({ kind: "minimalFixOwed", via: "capStop" }, { reopened: true }), dispatchDev(), world);
    expect(next.phase).toMatchObject({ kind: "cycle", cycle: "minimalFix" });
  });

  it("does not take a developer dispatch that carries a round for the fix", () => {
    const next = atCapStep(atCap({ kind: "minimalFixOwed", via: "breaker" }), dispatchDev({ round: 5 }), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed" } });
  });

  it("does not take a reviewer dispatch for the fix", () => {
    const reviewer: MachineEvent = { ...stamp(), type: "dispatched", task: TASK, seat: "code-reviewer", model: "opus" };
    const next = atCapStep(atCap({ kind: "minimalFixOwed", via: "breaker" }), reviewer, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "minimalFixOwed" } });
  });
});

describe("at cap: an abandoned fix", () => {
  const fixCycle = (reopened: boolean): TaskState => ({
    ...atCap(breaker(), { reopened }),
    phase: { kind: "cycle", cycle: "minimalFix", round: 5, openedAt: 210, implementer: { kind: "running", dispatchLine: 210, inline: false }, sinceCommit: null, commits: [] },
    seats: { ...initialTask(inputs.tasks[0]).seats, developer: { kind: "gated", status: "BLOCKED", doneLine: 215 } },
  });

  it("returns a never-reopened task to the Breaker with the fix spent when a decided note closes the fix's non-DONE status", () => {
    const next = atCapStep(fixCycle(false), plain(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", fixSpent: true } });
  });

  it("returns a reopened task to the cap stop with the fix spent when a decided note closes the fix's non-DONE status", () => {
    const next = atCapStep(fixCycle(true), plain(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "capStop", fixSpent: true } });
  });
});

describe("at cap: the cap stop", () => {
  it("notes the cap reached", () => {
    const next = atCapStep(atCap({ kind: "capStop", noted: false, fixSpent: false }, { reopened: true }), { ...stamp(), type: "capReached", task: TASK, failure: "review findings" }, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "capStop", noted: true } });
  });

  it("is not closed by a park or a plain decided note", () => {
    const start = atCap({ kind: "capStop", noted: true, fixSpent: false }, { reopened: true });
    expect(atCapStep(atCapStep(start, park, world), plain(), world).phase).toMatchObject({ kind: "atCap", cap: { kind: "capStop" } });
  });
});

describe("at cap: cascade findings", () => {
  it("closes a never-reopened cascade at the cap on a parked line", () => {
    const next = atCapStep(atCap({ kind: "cascadeAtCap", sha7: SHA7, reopened: false }), park, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "parkedClosed" } });
  });

  it("is not closed by a decided note alone", () => {
    const next = atCapStep(atCap({ kind: "cascadeAtCap", sha7: SHA7, reopened: false }), plain(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "cascadeAtCap" } });
  });

  it("owes no minimal fix for a minimal-fix note", () => {
    const next = atCapStep(atCap({ kind: "cascadeAtCap", sha7: SHA7, reopened: false }), minimalFix(), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "cascadeAtCap" } });
  });

  it("is not closed by a park once the task was reopened", () => {
    const next = atCapStep(atCap({ kind: "cascadeAtCap", sha7: SHA7, reopened: true }, { reopened: true }), park, world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "cascadeAtCap", reopened: true } });
  });
});

describe("at cap: completion", () => {
  const caps: [string, AtCap][] = [
    ["a Breaker", breaker()],
    ["a cap stop", { kind: "capStop", noted: true, fixSpent: false }],
    ["an owed minimal fix", { kind: "minimalFixOwed", via: "breaker" }],
    ["a cascade at the cap", { kind: "cascadeAtCap", sha7: SHA7, reopened: true }],
    ["a closed park", { kind: "parkedClosed" }],
  ];
  for (const [name, cap] of caps) {
    it(`completes ${name} on a superseded completion`, () => {
      const next = atCapStep(atCap(cap), superseded, world);
      expect(next.phase).toEqual({ kind: "complete", how: "superseded" });
    });
  }
});

describe("at cap: events outside the region", () => {
  it("leaves a task that is not at the cap alone", () => {
    const start = initialTask(inputs.tasks[0]);
    expect(atCapStep(start, plain(), world)).toEqual(start);
  });
});
