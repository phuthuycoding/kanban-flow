import { describe, it, expect, afterEach } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkLiveness } from "../workflow/next/liveness.js";
import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { schedule } from "../workflow/next/schedule.js";
import type { Action, InFlight, LedgerEvent, LedgerState, LoopInputs, LoopTask, NextResult } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const NOTHING_SILENT = { silent: [], emptyCloses: [] };

// ---------------------------------------------------------------------------
// Fixtures through the real readers
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };

function loadCase(name: string): { ledger: string; inputs: LoopInputs } {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "kf-next-liveness-"))), "repo");
  scratchDirs.push(dirname(root));
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(item, { recursive: true });
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
      },
    }),
  );
  cpSync(join(FIXTURES, name), item, { recursive: true });
  const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir: item, folder: ITEM_FOLDER, meta: META };
  const read = readLoopInputs(root, feature);
  if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);
  return { ledger: readFileSync(join(item, "loop", "progress.md"), "utf8"), inputs: read.inputs };
}

function ledgerState(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

const FIXTURE_CASES = ["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"];

describe("checkLiveness on what the scheduler prints today", () => {
  it.each(FIXTURE_CASES)("finds no silent task and no decide without closes for the %s ledger", (name) => {
    const { ledger, inputs } = loadCase(name);
    const { resume = false } = JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8")) as { resume?: boolean };
    const state = ledgerState(ledger);
    const result = schedule(state, inputs, { resume });

    expect(checkLiveness(result, state, inputs)).toEqual(NOTHING_SILENT);
  });

  it("finds no silent task at any prefix of the adaptive-cap replay", () => {
    const { ledger, inputs } = loadCase("replay-adaptive-cap");
    const lines = ledger.split("\n");
    const flagged: string[] = [];
    for (let i = 1; i <= lines.length; i++) {
      const state = ledgerState(lines.slice(0, i).join("\n"));
      const report = checkLiveness(schedule(state, inputs, { resume: false }), state, inputs);
      if (report.silent.length > 0 || report.emptyCloses.length > 0) flagged.push(`prefix ${i}: ${JSON.stringify(report)}`);
    }
    expect(flagged).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Hand-built results
// ---------------------------------------------------------------------------

type Fields = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;

const T0 = Date.parse("2026-11-07T03:00:00Z");

function stateOf(events: Fields[]): LedgerState {
  return { events: events.map((e, i) => ({ ...e, line: i + 2, ts: T0 + i * 60_000 }) as LedgerEvent) };
}

function task(id: string, extra: Partial<LoopTask> = {}): LoopTask {
  const n = id.slice(5);
  return { id, dependencies: [], files: [`src/task-${n}.ts`], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"], ...extra };
}

function inputsOf(tasks: LoopTask[]): LoopInputs {
  return {
    feature: "demo",
    kind: "feature",
    level: "standard",
    tasks,
    ceiling: { max: 4, source: "config" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
  };
}

const resultOf = (actions: Action[], inFlight: InFlight[] = []): NextResult => ({ feature: "demo", n: 2, inFlight, actions });

const scan: Fields = { type: "scan", clean: true };
const capStart: Fields = { type: "capRuling", from: null, to: 2, cause: { kind: "start" } };
const testsReady = (t: string): Fields[] => [
  { type: "dispatched", task: t, seat: "test-writer", model: "sonnet" },
  { type: "done", task: t, seat: "test-writer", status: "DONE" },
  { type: "testHashes", task: t, files: { [`src/tests/${t.toLowerCase()}.test.ts`]: "a".repeat(40) } },
];

describe("checkLiveness on hand-built results", () => {
  it("flags every open task when the output has no action and nothing in flight", () => {
    const state = stateOf([
      scan,
      capStart,
      ...testsReady("TASK-001"),
      { type: "dispatched", task: "TASK-001", seat: "developer", model: "sonnet" },
      { type: "done", task: "TASK-001", seat: "developer", status: "NEEDS_CONTEXT" },
      { type: "decided", task: "TASK-001", what: "supply the schema" },
    ]);

    expect(checkLiveness(resultOf([]), state, inputsOf([task("TASK-001")]))).toEqual({ silent: ["TASK-001"], emptyCloses: [] });
  });

  it("flags a task whose only witness is a cap wait while no developer is in flight or dispatched", () => {
    const state = stateOf([
      scan,
      { type: "capRuling", from: null, to: 1, cause: { kind: "start" } },
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      { type: "dispatched", task: "TASK-001", seat: "developer", model: "sonnet" },
      { type: "complete", task: "TASK-001", text: "superseded by contract" },
    ]);
    const result = resultOf([{ kind: "wait", task: "TASK-002", reason: "1 developers in flight" }]);

    expect(checkLiveness(result, state, inputsOf([task("TASK-001"), task("TASK-002")]))).toEqual({ silent: ["TASK-002"], emptyCloses: [] });
  });

  it("flags both tasks of a wait cycle that ends in no action or in-flight entry", () => {
    const state = stateOf([
      scan,
      capStart,
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      { type: "dispatched", task: "TASK-001", seat: "developer", model: "sonnet" },
      { type: "done", task: "TASK-001", seat: "developer", status: "DONE" },
      { type: "commits", task: "TASK-001", shas: ["aaaaaaa"] },
      { type: "verifyStarted", task: "TASK-001" },
      { type: "verifyDone", task: "TASK-001", exit: 1 },
      { type: "verifyWaits", task: "TASK-001", file: "src/task-002.ts", otherTask: "TASK-002" },
    ]);
    const result = resultOf([
      { kind: "wait", task: "TASK-001", reason: "verify waits for TASK-002" },
      { kind: "wait", task: "TASK-002", reason: "earlier overlapping TASK-001 incomplete" },
    ]);

    const report = checkLiveness(result, state, inputsOf([task("TASK-001"), task("TASK-002")]));

    expect([...report.silent].sort()).toEqual(["TASK-001", "TASK-002"]);
    expect(report.emptyCloses).toEqual([]);
  });

  it("names a decide whose closes is empty", () => {
    const state = stateOf([scan, capStart, ...testsReady("TASK-001"), { type: "dispatched", task: "TASK-001", seat: "developer", model: "sonnet" }, { type: "done", task: "TASK-001", seat: "developer", status: "BLOCKED" }]);
    const decide: Action = { kind: "decide", task: "TASK-001", rule: "Seat status", reason: "developer ended BLOCKED", closes: "" };

    expect(checkLiveness(resultOf([decide]), state, inputsOf([task("TASK-001")]))).toEqual({ silent: [], emptyCloses: [decide] });
  });

  it("accepts a wait whose blocker is in flight", () => {
    const state = stateOf([
      scan,
      capStart,
      ...testsReady("TASK-001"),
      ...testsReady("TASK-002"),
      { type: "dispatched", task: "TASK-001", seat: "developer", model: "sonnet" },
    ]);
    const result = resultOf([{ kind: "wait", task: "TASK-002", reason: "dependency TASK-001 has no commit" }], [{ task: "TASK-001", seat: "developer" }]);

    const tasks = [task("TASK-001"), task("TASK-002", { dependencies: ["TASK-001"], wave: 2 })];
    expect(checkLiveness(result, state, inputsOf(tasks))).toEqual(NOTHING_SILENT);
  });

  it("needs no witness once every task is complete and the output is finished", () => {
    const state = stateOf([scan, capStart, { type: "implemented", task: "TASK-001" }]);

    expect(checkLiveness(resultOf([{ kind: "finished" }]), state, inputsOf([task("TASK-001")]))).toEqual(NOTHING_SILENT);
  });
});
