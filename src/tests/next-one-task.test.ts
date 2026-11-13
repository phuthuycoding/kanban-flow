import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { schedule } from "../workflow/next/schedule.js";
import type { Action, LedgerState, LoopInputs, LoopTask, NextResult, TestType } from "../workflow/next/types.js";
import { cmdNext } from "../cli/commands/next.js";
import { cmdLoopStats } from "../cli/commands/loop-stats.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

// An item with exactly one task gains nothing from a test-writer, developer and code-reviewer relay: the controller
// fills the task itself and closes it with the `implemented` line. A one-task item whose ledger already shows a seat
// keeps the old scheduling, and items with more than one task are untouched.

const ONE_TASK_RULE = "One-task item";
const ONE_TASK_REASON = "the item has one task — the controller writes the tests and the fix, commits, runs kf verify --task, no subagent";
const IMPLEMENTED = "TASK-001: implemented, test-writer seat: none, review seat: none";
const ONE_TASK_TEXT = `decide TASK-001 (${ONE_TASK_RULE}): ${ONE_TASK_REASON} — closes with ${IMPLEMENTED}`;
const ONE_TASK_DECIDE: Action = { kind: "decide", task: "TASK-001", rule: ONE_TASK_RULE, reason: ONE_TASK_REASON, closes: IMPLEMENTED };

// ---------------------------------------------------------------------------
// Ledger and input literals
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-11-01T03:00:00Z");
const stampOf = (i: number): string => new Date(T0 + i * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A ledger as `kf record` writes it: the header, then each body stamped one minute after the one before. */
const ledgerText = (bodies: string[]): string =>
  ["# Task loop ledger — feat — plan: /p", ...bodies.map((b, i) => `${b} @ ${stampOf(i)}`), ""].join("\n");

function ledgerOf(bodies: string[]): LedgerState {
  const read = readLedgerState(ledgerText(bodies));
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

const START = ["Scan: clean", "Ruling: developer cap 1 — start — one task"];

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

const run = (bodies: string[], inputs: LoopInputs): NextResult => schedule(ledgerOf(bodies), inputs, { resume: false });

const dispatches = (r: NextResult): Action[] => r.actions.filter((a) => a.kind === "dispatch");
const oneTaskDecides = (r: NextResult): Action[] => r.actions.filter((a) => a.kind === "decide" && a.rule === ONE_TASK_RULE);
const actionsFor = (r: NextResult, id: string): Action[] => r.actions.filter((a) => "task" in a && a.task === id);
const show = (r: NextResult): string => JSON.stringify(r.actions, null, 1);

// ---------------------------------------------------------------------------
// schedule()
// ---------------------------------------------------------------------------

describe("schedule: an item with exactly one task", () => {
  it("points the controller at filling the only task of a feature itself, with no seat dispatch", () => {
    const result = run(START, inputsOf([task("TASK-001")]));

    expect(dispatches(result), show(result)).toEqual([]);
    expect(oneTaskDecides(result), show(result)).toEqual([ONE_TASK_DECIDE]);
  });

  it("points the controller at filling the only task of a bug itself, with no seat dispatch", () => {
    const bugTask = task("TASK-001", { files: null });
    const result = run(START, inputsOf([bugTask], { kind: "bug", level: null }));

    expect(dispatches(result), show(result)).toEqual([]);
    expect(oneTaskDecides(result), show(result)).toEqual([ONE_TASK_DECIDE]);
  });

  it("dispatches no seat for the only task even when it carries no test type", () => {
    const result = run(START, inputsOf([task("TASK-001", { testTypes: [] })]));

    expect(dispatches(result), show(result)).toEqual([]);
    expect(oneTaskDecides(result), show(result)).toEqual([ONE_TASK_DECIDE]);
  });

  it("counts the task complete once the implemented line is ledgered, owing it nothing more", () => {
    const result = run([...START, IMPLEMENTED], inputsOf([task("TASK-001")]));

    expect(dispatches(result), show(result)).toEqual([]);
    expect(actionsFor(result, "TASK-001"), show(result)).toEqual([]);
  });

  it("runs the wave verify after the implemented line when stage commands are pinned, and only once", () => {
    const stage = { stageCommands: [["node", "-e", "process.exit(0)"]] };
    const owed = run([...START, IMPLEMENTED], inputsOf([task("TASK-001")], { ...stage, waveRecords: [] }));

    expect(dispatches(owed), show(owed)).toEqual([]);
    expect(oneTaskDecides(owed), show(owed)).toEqual([]);
    expect(owed.actions, show(owed)).toContainEqual({ kind: "verify-wave", wave: 1, command: "kf verify feat --wave 1" });

    const passed = run(
      [...START, IMPLEMENTED, "wave 1: verify started", "wave 1: verify done exit=0"],
      inputsOf([task("TASK-001")], {
        ...stage,
        waveRecords: [{ wave: 1, sha: "f".repeat(40), exit: 0, at: stampOf(5), contains: true, covers: [1] }],
      }),
    );
    expect(dispatches(passed), show(passed)).toEqual([]);
    expect(actionsFor(passed, "TASK-001"), show(passed)).toEqual([]);
    expect(passed.actions.filter((a) => a.kind === "verify-wave"), show(passed)).toEqual([]);
  });

  it("keeps the seat scheduling of a loop that already dispatched a seat for the only task", () => {
    // A loop started before one-task items were filled by the controller carries on as it began.
    const result = run([...START, "TASK-001: test-writer dispatched model=sonnet"], inputsOf([task("TASK-001")]));

    expect(oneTaskDecides(result), show(result)).toEqual([]);
    expect(result.inFlight, show(result)).toContainEqual(expect.objectContaining({ task: "TASK-001", seat: "test-writer" }));
  });

  it("still dispatches the seats of an item with two tasks", () => {
    const result = run(START, inputsOf([task("TASK-001"), task("TASK-002")]));

    expect(oneTaskDecides(result), show(result)).toEqual([]);
    expect(result.actions, show(result)).toContainEqual(expect.objectContaining({ kind: "dispatch", task: "TASK-001", seat: "test-writer" }));
    expect(result.actions, show(result)).toContainEqual(expect.objectContaining({ kind: "dispatch", task: "TASK-002", seat: "test-writer" }));
  });
});

// ---------------------------------------------------------------------------
// kf next and kf loop-stats on a real one-task item
// ---------------------------------------------------------------------------

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

let root: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-next-one-task-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261101_0900", defaultContext: "app" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A bug in implementation whose `tasks.md` lists one regression task and no implementation plan. */
async function oneTaskBug(name: string): Promise<string> {
  const dir = join(root, ".works", "implementation", `${name}_20261101_0900`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: name, context: "app", created: "20261101_0900", kind: "bug" }));
  await writeFile(join(dir, "tasks.md"), "# Tasks\n\n- [ ] 1. TASK-001: regression test and fix for the crash\n");
  return dir;
}

/** A feature in implementation whose plan has exactly one task. */
async function oneTaskFeature(name: string): Promise<string> {
  const dir = join(root, ".works", "implementation", `${name}_20261101_0900`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: name, context: "app", created: "20261101_0900" }));
  await writeFile(
    join(dir, ARTIFACTS["implementation-plan"].file),
    `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do TASK-001 | Core | - | Done | FR-001 / UC-001 | coder | src/TASK-001.ts |\n`,
  );
  return dir;
}

const args = (command: string, positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

describe("kf next on a one-task bug", () => {
  it("prints the one-task decide line and no dispatch line", async () => {
    const dir = await oneTaskBug("crash");
    await mkdir(join(dir, "loop"), { recursive: true });
    await writeFile(join(dir, "loop", "progress.md"), ledgerText(START));

    const res = await cmdNext(args("next", ["crash"]), root);

    expect(res.code, res.stdout).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines, res.stdout).toContain(ONE_TASK_TEXT);
    expect(lines.filter((l) => l.startsWith("dispatch ")), res.stdout).toEqual([]);
  });
});

describe("kf loop-stats --record on a one-task item closed by the controller", () => {
  /** Header, a clean scan, the implemented line and the wave 1 verify, with the wave log kf verify writes. */
  async function closedLedger(dir: string): Promise<void> {
    await mkdir(join(dir, "loop"), { recursive: true });
    const at = (hhmm: string): string => `2026-11-01T${hhmm}:00Z`;
    await writeFile(
      join(dir, "loop", "progress.md"),
      [
        "# Task loop ledger — x — plan: /p",
        `Scan: clean @ ${at("10:00")}`,
        `${IMPLEMENTED} @ ${at("10:20")}`,
        `wave 1: verify started @ ${at("10:21")}`,
        `wave 1: verify done exit=0 @ ${at("10:25")}`,
        "",
      ].join("\n"),
    );
    await writeFile(join(dir, "loop", "wave-1-verify.log"), `## kf verify ${new Date(at("10:25")).toISOString()} exit=0\n  ok\n`);
  }

  const historyPath = (): string => join(root, ".works", "loop-metrics.md");

  it("records a row for a one-task feature", async () => {
    await closedLedger(await oneTaskFeature("solo"));

    const res = await cmdLoopStats(args("loop-stats", ["solo"], { record: true }), root);
    const out = `${res.stdout}\n${res.stderr ?? ""}`;

    expect(out).not.toContain("no complete line for TASK-001");
    expect(res.code, out).toBe(0);
    expect(out).toContain(`recorded solo in ${historyPath()}`);
    const rows = (await readFile(historyPath(), "utf8")).split("\n").filter((l) => l.includes(" · solo · "));
    expect(rows).toHaveLength(1);
  });

  it("records a row for a one-task bug", async () => {
    await closedLedger(await oneTaskBug("crash"));

    const res = await cmdLoopStats(args("loop-stats", ["crash"], { record: true }), root);
    const out = `${res.stdout}\n${res.stderr ?? ""}`;

    expect(out).not.toContain("no complete line for TASK-001");
    expect(res.code, out).toBe(0);
    expect(out).toContain(`recorded crash in ${historyPath()}`);
    const rows = (await readFile(historyPath(), "utf8")).split("\n").filter((l) => l.includes(" · crash · "));
    expect(rows).toHaveLength(1);
  });
});
