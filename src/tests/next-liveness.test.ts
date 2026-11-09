import { describe, it, expect } from "vitest";

import { PLANS, checkResult, evaluate, explore, render, shrink, stepsOf, withResult } from "./support/next-explorer.js";
import type { ExploreOptions, ExploreReport, Found } from "./support/next-explorer.js";
import type { LoopInputs, NextResult } from "../workflow/next/types.js";

// FR-022 to FR-026 claim a property of every ledger `kf record` can produce, which no fixture can show. A bounded
// explorer (design § 5.4 ii) plays an obedient session over six small plans at ceilings 1 and 2 and checks every state
// it reaches: the liveness invariant LIVE (a)–(g), the independent completion oracle against every printed complete,
// a happy continuation that still reaches `finished` (no trap), and the absence of the liveness guard's stop.
//
// Bounds: at most 80 ledger lines per path and 30,000 states per plan and ceiling, split evenly over three seeds — the
// empty ledger, a task at its Breaker after five rounds of findings, and a task reopened after a round-5 complete. The
// single-task plans branch over every rare outcome (one per path) and one more review with findings; the two-task plans
// branch over the rare outcomes that act between tasks, with no further findings, inside a 9,000-state bound so the
// file runs in about a minute and a half.

const DEPTH = 80;
const SINGLE: ExploreOptions = { maxDepth: DEPTH, maxStates: 30_000, faultBudget: 1, findingsBudget: 1, faults: "all", happyBudget: 120 };
const PAIR: ExploreOptions = { maxDepth: DEPTH, maxStates: 9_000, faultBudget: 1, findingsBudget: 0, faults: "cross-task", happyBudget: 120 };

const MATRIX: { plan: string; opts: ExploreOptions }[] = [
  { plan: "P1 single task", opts: SINGLE },
  { plan: "P2 dependent pair", opts: PAIR },
  { plan: "P3 overlapping waves", opts: PAIR },
  { plan: "P4 inline chain", opts: PAIR },
  { plan: "P5 UI task at Level full", opts: SINGLE },
  { plan: "P6 bug", opts: SINGLE },
];
const CEILINGS = [1, 2];
const EXPLORE_TIMEOUT = 300_000;

const reports = new Map<string, ExploreReport>();
function reportOf(plan: string, ceiling: number, opts: ExploreOptions): ExploreReport {
  const key = `${plan} ${ceiling}`;
  let report = reports.get(key);
  if (report === undefined) {
    report = explore(PLANS[plan](ceiling), opts);
    reports.set(key, report);
  }
  return report;
}

/** A violation as the failure shows it: the clause, the minimal ledger that still shows it, and what kf next printed. */
function shown(base: LoopInputs, v: Found, opts: ExploreOptions): string {
  const minimal = shrink(base, v, opts);
  const ev = evaluate(base, minimal);
  return [
    `${v.clause}${v.task ? ` ${v.task}` : ""}${v.resume ? " (--resume)" : ""}: ${v.detail}`,
    `  minimal ledger (${minimal.length} of ${v.steps.length} lines):`,
    ...minimal.map((s) => `    ${s.body}`),
    "  kf next printed:",
    ...render(v.resume ? ev.resumed : ev.plain).map((l) => `    ${l}`),
  ].join("\n");
}

describe("kf next over every state an obedient session reaches through kf record", () => {
  for (const { plan, opts } of MATRIX) {
    for (const ceiling of CEILINGS) {
      it(`${plan} at ceiling ${ceiling}: no silent, deadlocked, repeating or premature state`, () => {
        const base = PLANS[plan](ceiling);
        const report = reportOf(plan, ceiling, opts);

        // The search reached real work, and the oracle judged real completes.
        expect(report.deepest).toBeLessThanOrEqual(DEPTH);
        expect(report.states).toBeGreaterThan(1_000);
        expect(report.states).toBeLessThanOrEqual(opts.maxStates);
        expect(report.completes).toBeGreaterThan(0);
        expect(report.coverage["Breaker printed"]).toBeGreaterThan(0);
        expect(report.coverage["cap stop printed"]).toBeGreaterThan(0);

        expect(report.violations.map((v) => shown(base, v, opts))).toEqual([]);
      }, EXPLORE_TIMEOUT);
    }
  }

  // An earlier task's seat and a later task's developer on overlapping Files were once dispatched in the same pass:
  // no two file-writing seats may run on overlapping Files at once (ruled), across passes or within one.
  it("never runs two file-writing seats on overlapping Files at once", () => {
    for (const ceiling of CEILINGS) {
      const report = reportOf("P3 overlapping waves", ceiling, PAIR);
      expect(report.coverage["overlap wait printed"]).toBeGreaterThan(0);
      expect(report.violations.filter((v) => v.clause === "overlap").map((v) => `${v.task}: ${v.detail}`)).toEqual([]);
    }
  }, EXPLORE_TIMEOUT);
});

// The checks above must be able to fail: each one catches a defect planted in a stand-in result.
describe("the explorer's checks catch a planted defect", () => {
  const p1 = PLANS["P1 single task"](2);
  const started = stepsOf([
    { event: "line", args: ["Scan:", "clean"] },
    { event: "dispatched", args: ["TASK-001", "test-writer"], model: "sonnet" },
  ]);
  const result = (over: Partial<NextResult>): NextResult => ({ feature: "explorer", n: 2, inFlight: [], actions: [], ...over });
  const clauses = (base: LoopInputs, steps: typeof started, r: NextResult): string[] => checkResult(withResult(evaluate(base, steps), r), false).map((v) => v.clause);

  it("flags an empty result and a task with no witness", () => {
    expect(clauses(p1, started, result({}))).toEqual(expect.arrayContaining(["(a)", "(b)"]));
  });

  it("flags a complete the oracle refuses", () => {
    expect(clauses(p1, started, result({ inFlight: [{ task: "TASK-001", seat: "test-writer" }], actions: [{ kind: "complete", task: "TASK-001" }] }))).toContain("oracle");
  });

  it("flags a complete printed beside another action of the task", () => {
    const r = result({ actions: [{ kind: "complete", task: "TASK-001" }, { kind: "verify", task: "TASK-001", command: "kf verify explorer --task TASK-001" }] });
    expect(clauses(p1, started, r)).toContain("(g)");
  });

  it("flags the liveness guard's stop", () => {
    const r = result({ inFlight: [{ task: "TASK-001", seat: "test-writer" }], actions: [{ kind: "stop", task: "TASK-001", reason: "kf next has no rule for TASK-001 in tests — report this with the ledger" }] });
    expect(clauses(p1, started, r)).toContain("fail-safe");
  });

  it("flags a second dispatch of an open seat", () => {
    const r = result({ inFlight: [{ task: "TASK-001", seat: "test-writer" }], actions: [{ kind: "dispatch", task: "TASK-001", seat: "test-writer", mode: "new" }] });
    expect(clauses(p1, started, r)).toContain("(e)");
  });

  it("flags a wait cycle and two file-writing seats on overlapping Files", () => {
    const p3 = PLANS["P3 overlapping waves"](2);
    const cycle = result({
      actions: [
        { kind: "wait", task: "TASK-001", reason: "waits for TASK-002" },
        { kind: "wait", task: "TASK-002", reason: "waits for TASK-001" },
      ],
    });
    expect(clauses(p3, [], cycle)).toEqual(expect.arrayContaining(["(c)", "(b)"]));
    const both = result({
      actions: [
        { kind: "dispatch", task: "TASK-001", seat: "developer", mode: "new" },
        { kind: "dispatch", task: "TASK-002", seat: "test-writer", mode: "new" },
      ],
    });
    expect(clauses(p3, [], both)).toContain("overlap");
  });
});
