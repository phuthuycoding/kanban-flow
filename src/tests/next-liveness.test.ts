import { describe, it, expect } from "vitest";

import { PLANS, checkResult, evaluate, explore, render, shrink, stepsOf, withResult, withScheduler } from "./support/next-explorer.js";
import type { ExploreOptions, ExploreReport, Found, Step } from "./support/next-explorer.js";
import { schedule } from "../workflow/next/schedule.js";
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

// What the bounds cut, pinned per plan so a change in coverage is a deliberate edit here: `truncated` when the state
// bound ends a seed's search, `depthCut` when some path is cut at the depth bound. P1 and P6 are explored exhaustively.
const MATRIX: { plan: string; opts: ExploreOptions; truncated: boolean; depthCut: boolean }[] = [
  { plan: "P1 single task", opts: SINGLE, truncated: false, depthCut: false },
  { plan: "P2 dependent pair", opts: PAIR, truncated: true, depthCut: true },
  { plan: "P3 overlapping waves", opts: PAIR, truncated: false, depthCut: true },
  { plan: "P4 inline chain", opts: PAIR, truncated: true, depthCut: true },
  { plan: "P5 UI task at Level full", opts: SINGLE, truncated: false, depthCut: true },
  { plan: "P6 bug", opts: SINGLE, truncated: false, depthCut: false },
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
  for (const { plan, opts, truncated, depthCut } of MATRIX) {
    for (const ceiling of CEILINGS) {
      it(`${plan} at ceiling ${ceiling}: no silent, deadlocked, repeating or premature state`, () => {
        const base = PLANS[plan](ceiling);
        const report = reportOf(plan, ceiling, opts);

        // The search reached real work, the bounds cut what they are pinned to cut, and the oracle judged real completes.
        expect(report.states).toBeGreaterThan(1_000);
        expect(report.states).toBeLessThanOrEqual(opts.maxStates);
        expect(report.truncated).toBe(truncated);
        if (depthCut) expect(report.cutByDepth).toBeGreaterThan(0);
        else expect(report.cutByDepth).toBe(0);
        expect(report.completes).toBeGreaterThan(0);
        expect(report.coverage["Breaker printed"]).toBeGreaterThan(0);
        expect(report.coverage["cap stop printed"]).toBeGreaterThan(0);
        expect(report.coverage["reopened"]).toBeGreaterThan(0);
        expect(report.coverage["resume re-issues a seat"]).toBeGreaterThan(0);
        if (opts.faults === "cross-task") {
          // The two-task plans exist to route and hold a failing verify between tasks.
          expect(report.coverage["verify routed"]).toBeGreaterThan(0);
          expect(report.coverage["verify waits"]).toBeGreaterThan(0);
        } else {
          expect(report.coverage["contention re-run"]).toBeGreaterThan(0);
        }

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
  const found = (base: LoopInputs, steps: Step[], r: NextResult) => checkResult(withResult(evaluate(base, steps), r), false);
  const clauses = (base: LoopInputs, steps: Step[], r: NextResult): string[] => found(base, steps, r).map((v) => v.clause);

  it("flags an empty result and a task with no witness", () => {
    expect(clauses(p1, started, result({}))).toEqual(expect.arrayContaining(["(a)", "(b)"]));
  });

  // A plan dependency kf next did not print is no witness: the dependent task must have a printed wait of its own.
  it("flags a dependent task left silent while its dependency is in flight", () => {
    const p2 = PLANS["P2 dependent pair"](2);
    const developing = stepsOf([
      { event: "line", args: ["Scan:", "clean"] },
      { event: "dispatched", args: ["TASK-001", "developer"], model: "sonnet" },
    ]);
    const inFlight = [{ task: "TASK-001", seat: "developer" as const }];
    const silent = found(p2, developing, result({ inFlight }));
    expect(silent.filter((v) => v.clause === "(b)").map((v) => v.task)).toEqual(["TASK-002"]);
    const waiting = found(p2, developing, result({ inFlight, actions: [{ kind: "wait", task: "TASK-002", reason: "waits for TASK-001" }] }));
    expect(waiting.filter((v) => v.clause === "(b)")).toEqual([]);
  });

  it("flags a decide that prints no closes", () => {
    const r = result({ inFlight: [{ task: "TASK-001", seat: "test-writer" }], actions: [{ kind: "decide", task: "TASK-001", rule: "Seat status", reason: "the seat ended oddly", closes: "" }] });
    expect(clauses(p1, started, r)).toContain("(d)");
  });

  it("flags an open developer missing from the In-flight list", () => {
    const developing = stepsOf([
      { event: "line", args: ["Scan:", "clean"] },
      { event: "dispatched", args: ["TASK-001", "developer"], model: "sonnet" },
    ]);
    const r = result({ actions: [{ kind: "wait", task: "TASK-001", reason: "waits for its developer" }] });
    expect(found(p1, developing, r).filter((v) => v.clause === "(f)").map((v) => v.detail)).toEqual([expect.stringContaining("is not in the In-flight list")]);
  });

  // FR-023: the verify passed on the task's latest commits, so a reported commit on the branch must be in its list.
  it("flags a complete whose reported commit is in no commits note", () => {
    const [scan, dispatched, done] = stepsOf([
      { event: "line", args: ["Scan:", "clean"] },
      { event: "dispatched", args: ["TASK-001", "developer"], model: "sonnet" },
      { event: "done", args: ["TASK-001", "developer"], status: "DONE" },
    ]);
    const committed: Step[] = [scan, dispatched, { ...done, mutation: { kind: "commit", task: "TASK-001", sha: `0010001${"c".repeat(33)}` } }];
    const r = result({ actions: [{ kind: "complete", task: "TASK-001" }] });
    expect(found(p1, committed, r).filter((v) => v.clause === "(g)").map((v) => v.detail)).toEqual([expect.stringContaining("its commit 0010001, in its report and on the branch, is in no commits note")]);
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

  // The search-level checks run a stand-in kf next that keeps the real one's output except where the defect is planted.
  const SMALL: ExploreOptions = { maxDepth: 80, maxStates: 600, faultBudget: 0, findingsBudget: 0, faults: "all", happyBudget: 40 };
  const searchClauses = (finishedBecomes: NextResult["actions"]): string[] =>
    withScheduler(
      (state, inputs, opts) => {
        const real = schedule(state, inputs, opts);
        return real.actions.some((a) => a.kind === "finished") ? { ...real, actions: finishedBecomes } : real;
      },
      () => explore(p1, SMALL).violations.map((v) => v.clause),
    );

  it("flags a printed action whose carrying out changes nothing", () => {
    // A second `Scan: clean` changes no World, so this decide is printed again after the session closes it.
    expect(searchClauses([{ kind: "decide", rule: "Scan", reason: "planted", closes: "Scan: …" }])).toContain("repeating");
  });

  it("flags a state from which a happy session never reaches finished", () => {
    expect(searchClauses([])).toContain("trap");
  });
});
