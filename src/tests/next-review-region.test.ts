import { describe, it, expect } from "vitest";

import { initialTask } from "../workflow/next/fold.js";
import { reviewStep } from "../workflow/next/review-region.js";
import type { LoopInputs, MachineEvent, ReviewDemand, ReviewLane, TaskPhase, TaskState, World } from "../workflow/next/types.js";

// The review region on seeded states: one reviewer lane per task, a done attributed to the obligation the lane
// holds, a stacked legacy dispatch putting the overwritten obligation back to owed.

const TASK = "TASK-001";
const SHA7 = "abc1234";
let line = 100;

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

const CYCLE: TaskPhase = { kind: "cycle", cycle: "round", round: 2, openedAt: 50, implementer: { kind: "committed" }, sinceCommit: 60, commits: [SHA7] };

function task(over: Partial<TaskState> & { lane?: ReviewLane; demands?: ReviewDemand[]; phase?: TaskPhase } = {}): TaskState {
  const base = initialTask(inputs.tasks[0]);
  const { lane, demands, ...rest } = over;
  return {
    ...base,
    phase: CYCLE,
    ...rest,
    review: { lane: lane ?? { kind: "free" }, demands: demands ?? [], ownVerdict: "none" },
  };
}

const stamp = () => ({ line: ++line, ts: line * 1000 });
const dispatchReviewer = (opts: { cascade?: string; round?: number } = {}): MachineEvent => ({
  ...stamp(), type: "dispatched", task: TASK, seat: "code-reviewer", model: "opus", ...opts,
});
const doneReviewer = (status: string): MachineEvent => ({ ...stamp(), type: "done", task: TASK, seat: "code-reviewer", status });

const OWN: ReviewDemand = { kind: "own", round: 2 };
const cascade = (phase: "lineOwed" | "owed" | "dispatched" | "clean" | "findings", sha7 = SHA7): ReviewDemand => ({
  kind: "cascade", sha7, round: 1, of: "TASK-002", phase,
});
const busy = (obligation: ReviewDemand): ReviewLane => ({ kind: "busy", line: 90, obligation });
const cascadeDemands = (t: TaskState) => t.review.demands.filter((d) => d.kind === "cascade");

describe("review region: one reviewer lane per task", () => {
  it("takes the lane for the own review when the reviewer is dispatched", () => {
    const next = reviewStep(task({ demands: [OWN] }), dispatchReviewer({ round: 2 }), world);
    expect(next.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "own" } });
  });

  it("takes the lane for a cascade re-review, naming the cascade", () => {
    const next = reviewStep(task({ demands: [cascade("owed")] }), dispatchReviewer({ cascade: SHA7 }), world);
    expect(next.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "cascade", sha7: SHA7 } });
    expect(cascadeDemands(next)[0]).toMatchObject({ sha7: SHA7, phase: "dispatched" });
  });

  it("frees the lane and records a clean own verdict when the own review is clean", () => {
    const next = reviewStep(task({ lane: busy(OWN), demands: [OWN] }), doneReviewer("clean"), world);
    expect(next.review.lane).toEqual({ kind: "free" });
    expect(next.review.ownVerdict).toBe("clean");
  });

  it("records a findings verdict when the own review has findings", () => {
    const next = reviewStep(task({ lane: busy(OWN), demands: [OWN] }), doneReviewer("findings"), world);
    expect(next.review.lane).toEqual({ kind: "free" });
    expect(next.review.ownVerdict).toBe("findings");
  });
});

describe("review region: a done is attributed to the lane's obligation", () => {
  it("does not take a clean cascade review for a clean own review", () => {
    const next = reviewStep(task({ lane: busy(cascade("dispatched")), demands: [OWN, cascade("dispatched")] }), doneReviewer("clean"), world);
    expect(next.review.ownVerdict).toBe("none");
    expect(next.review.lane).toEqual({ kind: "free" });
    expect(cascadeDemands(next)[0]).toMatchObject({ sha7: SHA7, phase: "clean" });
  });

  it("marks the cascade demand findings when the cascade review has findings, leaving the own verdict alone", () => {
    const next = reviewStep(task({ lane: busy(cascade("dispatched")), demands: [cascade("dispatched")] }), doneReviewer("findings"), world);
    expect(next.review.ownVerdict).toBe("none");
    expect(cascadeDemands(next)[0]).toMatchObject({ sha7: SHA7, phase: "findings" });
  });

  it("attributes each of two cascade reviews to its own demand, one lane run at a time", () => {
    const other = "def5678";
    const start = task({ lane: busy(cascade("dispatched", SHA7)), demands: [cascade("dispatched", SHA7), cascade("owed", other)] });
    const afterFirst = reviewStep(start, doneReviewer("clean"), world);
    expect(cascadeDemands(afterFirst).find((d) => d.kind === "cascade" && d.sha7 === SHA7)).toMatchObject({ phase: "clean" });
    expect(cascadeDemands(afterFirst).find((d) => d.kind === "cascade" && d.sha7 === other)).toMatchObject({ phase: "owed" });
    const afterSecond = reviewStep(afterFirst, dispatchReviewer({ cascade: other }), world);
    expect(afterSecond.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "cascade", sha7: other } });
  });
});

describe("review region: a non-DONE reviewer status", () => {
  for (const status of ["NEEDS_CONTEXT", "BLOCKED", "DONE_WITH_CONCERNS", "approved-ish"]) {
    it(`gates the reviewer seat on ${status} without a verdict and keeps the obligation`, () => {
      const next = reviewStep(task({ lane: busy(OWN), demands: [OWN] }), doneReviewer(status), world);
      expect(next.seats["code-reviewer"].kind).toBe("gated");
      expect(next.review.ownVerdict).toBe("none");
      expect(next.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "own" } });
    });
  }

  it("owes the same own review again once a decided note closes the gate", () => {
    const gated = task({ lane: busy(OWN), demands: [OWN], seats: { ...initialTask(inputs.tasks[0]).seats, "code-reviewer": { kind: "gated", status: "NEEDS_CONTEXT", doneLine: 95 } } });
    const next = reviewStep(gated, { ...stamp(), type: "decided", task: TASK, what: "go on" }, world);
    expect(next.seats["code-reviewer"]).toMatchObject({ kind: "redispatchOwed", round: 2 });
    expect(next.seats["code-reviewer"]).not.toHaveProperty("cascade");
    expect(next.review.ownVerdict).toBe("none");
  });

  it("owes the same cascade review again, with its cascade, once a Ruling closes the gate", () => {
    const gated = task({
      lane: busy(cascade("dispatched")),
      demands: [cascade("dispatched")],
      seats: { ...initialTask(inputs.tasks[0]).seats, "code-reviewer": { kind: "gated", status: "BLOCKED", doneLine: 95 } },
    });
    const next = reviewStep(gated, { ...stamp(), type: "ruling", task: TASK, text: "Ruling: TASK-001 — retry" }, world);
    expect(next.seats["code-reviewer"]).toMatchObject({ kind: "redispatchOwed", cascade: SHA7 });
    expect(next.review.ownVerdict).toBe("none");
  });
});

describe("review region: a stacked legacy dispatch", () => {
  it("puts an overwritten cascade obligation back to owed when an own review is dispatched over it", () => {
    const next = reviewStep(task({ lane: busy(cascade("dispatched")), demands: [OWN, cascade("dispatched")] }), dispatchReviewer({ round: 2 }), world);
    expect(next.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "own" } });
    expect(cascadeDemands(next)[0]).toMatchObject({ sha7: SHA7, phase: "owed" });
  });

  it("keeps the overwritten own review owed when a cascade review is dispatched over it", () => {
    const next = reviewStep(task({ lane: busy(OWN), demands: [OWN, cascade("owed")] }), dispatchReviewer({ cascade: SHA7 }), world);
    expect(next.review.lane).toMatchObject({ kind: "busy", obligation: { kind: "cascade", sha7: SHA7 } });
    expect(next.review.demands.some((d) => d.kind === "own")).toBe(true);
    expect(next.review.ownVerdict).toBe("none");
  });

  it("lets the single done after a stacked dispatch answer only the latest obligation", () => {
    const stacked = reviewStep(task({ lane: busy(OWN), demands: [OWN, cascade("owed")] }), dispatchReviewer({ cascade: SHA7 }), world);
    const next = reviewStep(stacked, doneReviewer("clean"), world);
    expect(next.review.ownVerdict).toBe("none");
    expect(cascadeDemands(next)[0]).toMatchObject({ phase: "clean" });
  });
});

describe("review region: cascades land on dependents", () => {
  const landed = (): MachineEvent => ({ ...stamp(), type: "cascadeLanded", task: TASK, sha7: SHA7, from: "TASK-002", round: 1 });

  it("adds a cascade demand whose owed line is not written yet", () => {
    const next = reviewStep(task(), landed(), world);
    expect(next.review.demands).toContainEqual(expect.objectContaining({ kind: "cascade", sha7: SHA7, of: "TASK-002", round: 1, phase: "lineOwed" }));
  });

  it("moves the demand to owed when the cascade owed line is written", () => {
    const owed: MachineEvent = { ...stamp(), type: "cascadeOwed", task: TASK, sha: SHA7, otherTask: "TASK-002" };
    const next = reviewStep(task({ demands: [cascade("lineOwed")] }), owed, world);
    expect(cascadeDemands(next)[0]).toMatchObject({ sha7: SHA7, phase: "owed" });
  });
});

describe("review region: a cascade review with findings", () => {
  const findingsRun = (t: TaskState) => reviewStep({ ...t, review: { ...t.review, lane: busy(cascade("dispatched")), demands: [cascade("dispatched")] } }, doneReviewer("findings"), world);

  it("leaves the task in its cycle while rounds remain", () => {
    const next = findingsRun(task({ roundsUsed: 3 }));
    expect(next.phase.kind).toBe("cycle");
    expect(cascadeDemands(next)[0]).toMatchObject({ phase: "findings" });
  });

  it("puts a never-reopened task at the cap as a cascade at the cap when no rounds are left", () => {
    const next = findingsRun(task({ roundsUsed: 5, reopened: false }));
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "cascadeAtCap", sha7: SHA7, reopened: false } });
  });

  it("marks the cascade at the cap as reopened for a reopened task", () => {
    const next = findingsRun(task({ roundsUsed: 5, reopened: true }));
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "cascadeAtCap", sha7: SHA7, reopened: true } });
  });
});

describe("review region: the minimal fix's own review", () => {
  const fixCycle = (over: Parameters<typeof task>[0] = {}): TaskState =>
    task({
      phase: { kind: "cycle", cycle: "minimalFix", round: 5, openedAt: 70, implementer: { kind: "committed" }, sinceCommit: 75, commits: [SHA7] },
      roundsUsed: 5,
      lane: busy(OWN),
      demands: [OWN],
      ...over,
    });

  it("returns a never-reopened task to the Breaker with the fix spent when the fix's own review has findings", () => {
    const next = reviewStep(fixCycle({ reopened: false }), doneReviewer("findings"), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "breaker", fixSpent: true } });
  });

  it("returns a reopened task to the cap stop with the fix spent when the fix's own review has findings", () => {
    const next = reviewStep(fixCycle({ reopened: true }), doneReviewer("findings"), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "capStop", fixSpent: true } });
  });

  it("does not count a cascade review with findings as the fix failing", () => {
    const next = reviewStep(fixCycle({ lane: busy(cascade("dispatched")), demands: [OWN, cascade("dispatched")] }), doneReviewer("findings"), world);
    expect(next.phase.kind).toBe("cycle");
  });

  it("keeps the fix running when its own review is clean", () => {
    const next = reviewStep(fixCycle(), doneReviewer("clean"), world);
    expect(next.phase).toMatchObject({ kind: "cycle", cycle: "minimalFix" });
    expect(next.review.ownVerdict).toBe("clean");
  });
});

describe("review region: the cycle verdict at round five", () => {
  const ROUND_FIVE: TaskPhase = { kind: "cycle", cycle: "round", round: 5, openedAt: 50, implementer: { kind: "committed" }, sinceCommit: 60, commits: [SHA7] };
  const ownRun = (over: Parameters<typeof task>[0] = {}): TaskState =>
    task({ phase: ROUND_FIVE, roundsUsed: 5, lane: busy(OWN), demands: [OWN], verify: { kind: "passed", line: 70 }, ...over });
  const keptFailure: TaskState["verify"] = { kind: "failed", line: 70, disposition: { kind: "kept" } };
  const unanswered = [{ from: "TASK-002", line: 80, answered: false }];

  for (const reopened of [false, true]) {
    const who = reopened ? "a reopened task" : "a task never reopened";
    const atCap = reopened ? { kind: "capStop", noted: false, fixSpent: false } : { kind: "breaker", parked: [], fixSpent: false };

    it(`puts ${who} at the cap when its own review has findings`, () => {
      const next = reviewStep(ownRun({ reopened }), doneReviewer("findings"), world);
      expect(next.phase).toMatchObject({ kind: "atCap", cap: atCap });
    });

    it(`puts ${who} at the cap when its own review is clean but a verify failure was kept`, () => {
      const next = reviewStep(ownRun({ reopened, verify: keptFailure }), doneReviewer("clean"), world);
      expect(next.phase).toMatchObject({ kind: "atCap", cap: atCap });
    });

    it(`puts ${who} at the cap when its own review is clean but a routed-in failure is unanswered`, () => {
      const next = reviewStep(ownRun({ reopened, routedIn: unanswered }), doneReviewer("clean"), world);
      expect(next.phase).toMatchObject({ kind: "atCap", cap: atCap });
    });

    it(`keeps ${who} in its cycle when nothing is left open`, () => {
      const next = reviewStep(ownRun({ reopened, routedIn: [{ ...unanswered[0], answered: true }] }), doneReviewer("clean"), world);
      expect(next.phase).toMatchObject({ kind: "cycle", cycle: "round", round: 5 });
    });

    it(`defers the cap for ${who} until its own review reports`, () => {
      const waiting = ownRun({ reopened, verify: keptFailure, lane: busy(cascade("dispatched")), demands: [OWN, cascade("dispatched")] });
      const afterCascade = reviewStep(waiting, doneReviewer("clean"), world);
      expect(afterCascade.review.ownVerdict).toBe("none");
      expect(afterCascade.phase.kind).toBe("cycle");
    });
  }
});

describe("review region: a failed minimal fix of a reopened task", () => {
  it("returns to the cap stop with its cap reached note still written when the fix's own review has findings", () => {
    const fixing = task({
      phase: { kind: "cycle", cycle: "minimalFix", round: 5, openedAt: 70, implementer: { kind: "committed" }, sinceCommit: 75, commits: [SHA7] },
      roundsUsed: 5,
      reopened: true,
      lane: busy(OWN),
      demands: [OWN],
    });
    const next = reviewStep(fixing, doneReviewer("findings"), world);
    expect(next.phase).toMatchObject({ kind: "atCap", cap: { kind: "capStop", fixSpent: true, noted: true } });
  });
});
