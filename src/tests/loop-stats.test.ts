import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

/*
 * Every expected figure below is computed by hand from the ledger definitions
 * (pairing, UTC intervals, union, waits), never by running the code.
 *
 * two-tasks.ledger.md — all +07:00, minutes counted from 10:00.
 *   test-writer   L3→L5  [0,10]=10 opus      L4→L8   [2,14]=12 sonnet     count 2, sum 22, median 11
 *   developer     L7→L10 [11,31]=20 opus     L12→L18 [33,53]=20 sonnet
 *                 L19→L23 [54,64]=10 opus                                  count 3, sum 50, median 20
 *   code-reviewer L14→L15 [36,46]=10 opus    L22→L24 [59,65]=6 sonnet
 *                 L29→L30 [68,72]=4 sonnet   L28→L32 [68,74]=6 opus       count 4, sum 26, median (6+6)/2=6
 *   verify        L11→L13 [32,35]=3   L20→L21 [54,58]=4   L26→L27 [65,68]=3  count 3, sum 10, median 3
 *   seat = 22+50+0+26 = 98; verify = 10
 *   union: [0,31] (0-10, 2-14, 11-31) = 31; [32,53] (32-35, 33-53, 36-46) = 21;
 *          [54,74] (54-64, 54-58, 59-65, 65-68 touching, 68-72 touching, 68-74) = 20 → busy 72
 *   saved = 98+10-72 = 36; wall = 10:00 (L3) → 11:15 (L33, last complete) = 75; controller = 75-72 = 3
 *   waits: L9 10:15 → L12 10:33 = 18; L17 10:47 → L19 10:54 = 7 → 25
 *   rounds 1 (L16), cascades 1 (L25), tasks 2
 *   byModel: tw/opus 10, tw/sonnet 12, dev/opus 20+10=30, dev/sonnet 20, cr/opus 10+6=16, cr/sonnet 6+4=10
 *   other-timed: L2 wave, L6 test hashes, L34 ruling = 3; untimed: L35, L36 = 2
 *
 * resumed.ledger.md — mixed +07:00 and Z, minutes counted from 03:00Z (= 10:00+07:00).
 *   L3 developer dispatched 03:00Z is left open (orphan) because L6 pairs with the later L5.
 *   developer     L5 03:21Z → L6 10:41+07:00 = 03:41Z → [21,41]=20 opus
 *   code-reviewer L7 done has no earlier dispatched → unparsed
 *                 L8 03:43Z → L11 11:03+07:00 = 04:03Z → [43,63]=20 sonnet
 *   verify        L9 10:45+07:00 = 03:45Z → L10 03:50Z → [45,50]=5 (nested inside [43,63])
 *   test-writer   L12 04:03Z → L13 04:13Z → [63,73]=10 sonnet (touches [43,63])
 *   L14 "dispatchd" → unparsed; L19 carries a second suffix → body fails its shape → unparsed
 *   L17 04:16Z dispatched → L18 04:10Z done: done before dispatched → both unparsed, not counted
 *   seat = 20+20+10 = 50; verify = 5; union [21,41]=20 + [43,73]=30 → busy 50; saved = 50+5-50 = 5
 *   wall = 03:00Z (L3, earliest dispatched) → 04:20Z (L20, last complete) = 80; controller = 80-50 = 30
 *   unparsed [7,14,17,18,19]; orphans [3]; other-timed L4, L15 = 2; untimed L21, L22 = 2 (L22 has no
 *   timestamp, so it is not a fix round: rounds 0); L2 is blank and skipped
 *
 * mid-loop.ledger.md — all Z, minutes counted from 09:00; no complete line → in progress.
 *   test-writer L2→L4 [0,12]=12, L3→L6 [1,16]=15 → count 2, sum 27, median 13.5
 *   developer   L5→L8 [13,40]=27; verify L9 started without done → orphan
 *   seat 54; union [0,40]=40 → busy 40; saved 14; wall 09:00 → 09:45 (L10, last timestamped line) = 45;
 *   controller 5; L7 waits with no later developer dispatched of TASK-002 → open wait, waits 0
 *
 * history-two-rows.md — alpha (tasks 2) and beta (tasks 4); medians of two rows are their means.
 *   per task: controller 40/2=20, 60/4=15 → 17.5; test-writer 10, 10 → 10; developer 30/2=15, 104/4=26 → 20.5;
 *   code-reviewer 16/2=8, 24/4=6 → 7; verify 6/2=3, 12/4=3 → 3; waits 8/2=4, 20/4=5 → 4.5
 *   largest: developer 20.5
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "loop-stats");
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");

const HEADER = "date · feature · tasks · wall · busy · controller · saved · waits · test-writer · developer · automation-writer · code-reviewer · verify · rounds · cascades · untimed";
const JSON_KEYS = [
  "feature", "inProgress", "wallMinutes", "seats", "verify", "seatMinutes", "verifyMinutes", "busyMinutes",
  "savedMinutes", "controllerMinutes", "waitMinutes", "rounds", "cascades", "tasks", "byModel", "unparsed",
  "orphans", "openWaits", "otherTimed", "untimed",
];

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const expected = (name: string): Record<string, unknown> => JSON.parse(fixture(`${name}.expected.json`)) as Record<string, unknown>;
const loopStatsModule = () => import("../workflow/loop-stats.js");
const loopStatsCommand = () => import("../cli/commands/loop-stats.js");

const utc = (hh: number, mm: number): number => Date.UTC(2026, 10, 1, hh, mm, 0);

async function statsOf(name: string): Promise<Record<string, unknown>> {
  const { parseLedger, loopStats } = await loopStatsModule();
  return loopStats(parseLedger(fixture(`${name}.ledger.md`))) as unknown as Record<string, unknown>;
}

/** The figures object leaves the task count shape open (ids or a count); the CLI JSON fixes it as a count. */
function taskCount(value: unknown): unknown {
  return Array.isArray(value) ? value.length : value;
}

function withoutTasks(obj: Record<string, unknown>): Record<string, unknown> {
  const { tasks: _tasks, ...rest } = obj;
  return rest;
}

describe("loop figures from a ledger", () => {
  it("computes every figure of a two-task loop with a fix round, a wait, a cascade and two models", async () => {
    const stats = await statsOf("two-tasks");
    const want = expected("two-tasks");
    expect(stats).toMatchObject(withoutTasks(want));
    expect(taskCount(stats.tasks)).toBe(2);
  });

  it("keeps controller minutes equal to wall minus busy and saved equal to seat plus verify minus busy", async () => {
    const stats = await statsOf("two-tasks");
    expect(stats.controllerMinutes).toBe((stats.wallMinutes as number) - (stats.busyMinutes as number));
    expect(stats.savedMinutes).toBe((stats.seatMinutes as number) + (stats.verifyMinutes as number) - (stats.busyMinutes as number));
    expect(stats.busyMinutes).toBe(72);
  });

  it("pairs a done with the re-dispatch after a resume and lists the orphaned dispatch", async () => {
    const stats = await statsOf("resumed");
    expect((stats.seats as Record<string, unknown>).developer).toEqual({ count: 1, sum: 20, median: 20 });
    expect(stats.orphans).toEqual([3]);
  });

  it("reads intervals in UTC across +07:00 and Z offsets, none negative", async () => {
    const stats = await statsOf("resumed");
    const want = expected("resumed");
    expect(stats).toMatchObject(withoutTasks(want));
    expect(taskCount(stats.tasks)).toBe(2);
    const seats = stats.seats as Record<string, { sum: number; median: number }>;
    for (const seat of Object.values(seats)) {
      expect(seat.sum).toBeGreaterThanOrEqual(0);
      expect(seat.median).toBeGreaterThanOrEqual(0);
    }
    for (const minutes of Object.values(stats.byModel as Record<string, number>)) expect(minutes).toBeGreaterThanOrEqual(0);
  });

  it("counts each minute once in busy time when intervals nest or touch", async () => {
    const stats = await statsOf("resumed");
    // Seat 50 + verify 5 overlap by the nested verify interval; the touching seat intervals add no overlap.
    expect(stats.busyMinutes).toBe(50);
    expect(stats.savedMinutes).toBe(5);
  });

  it("lists by line a done with no earlier dispatch, a done before its dispatch, a misspelt shape and a doubled suffix as unparsed", async () => {
    const stats = await statsOf("resumed");
    expect(stats.unparsed).toEqual([7, 14, 17, 18, 19]);
  });

  it("counts timed lines without a shape keyword as other-timed and lines without a timestamp as untimed", async () => {
    const stats = await statsOf("resumed");
    expect(stats.otherTimed).toBe(2);
    expect(stats.untimed).toBe(2);
    expect(stats.rounds).toBe(0);
  });

  it("reports a mid-loop ledger as in progress with wall time to the last timestamped line", async () => {
    const stats = await statsOf("mid-loop");
    const want = expected("mid-loop");
    expect(stats).toMatchObject(withoutTasks(want));
    expect(stats.inProgress).toBe(true);
    expect(stats.wallMinutes).toBe(45);
    expect(taskCount(stats.tasks)).toBe(2);
  });
});

describe("ledger line classification", () => {
  it("classifies every non-blank line after the header with its 1-based line number", async () => {
    const { parseLedger } = await loopStatsModule();
    const parsed = parseLedger(fixture("resumed.ledger.md"));
    const kinds = Object.fromEntries(parsed.lines.map((l) => [l.line, l.kind]));
    expect(Object.keys(kinds).map(Number)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    expect(kinds).toMatchObject({
      3: "shape", 4: "other-timed", 5: "shape", 6: "shape", 7: "shape", 14: "unparsed", 15: "other-timed",
      17: "shape", 18: "shape", 19: "unparsed", 20: "shape", 21: "untimed", 22: "untimed",
    });
  });

  it("captures task, seat, model and the UTC instant of a dispatched line written with an offset", async () => {
    const { parseLedger } = await loopStatsModule();
    const line = parseLedger(fixture("resumed.ledger.md")).lines.find((l) => l.line === 3);
    expect(line).toMatchObject({ kind: "shape", shape: "dispatched", task: "TASK-001", seat: "developer", model: "opus", ts: utc(3, 0) });
  });

  it("names each of the nine ledger shapes", async () => {
    const { parseLedger, LEDGER_SHAPES } = await loopStatsModule();
    expect(Object.keys(LEDGER_SHAPES).sort()).toEqual(
      ["cascadeOwed", "complete", "developerWaits", "dispatched", "done", "fixQueued", "fixRound", "verifyDone", "verifyStarted"],
    );
    const shapes = Object.fromEntries(parseLedger(fixture("two-tasks.ledger.md")).lines.map((l) => [l.line, l.shape]));
    expect(shapes).toMatchObject({
      3: "dispatched", 5: "done", 9: "developerWaits", 11: "verifyStarted", 13: "verifyDone",
      16: "fixRound", 17: "fixQueued", 25: "cascadeOwed", 33: "complete",
    });
  });
});

describe("history file helpers", () => {
  it("reads no history when the file is missing", async () => {
    const dir = realpathSync(await mkdtemp(join(tmpdir(), "kf-loop-history-")));
    try {
      const { readHistory } = await loopStatsModule();
      expect(readHistory(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

let root: string;

async function item(feature: string, taskIds: string[], ledger: string | null): Promise<string> {
  const dir = join(root, ".works", "implementation", `${feature}_20261101_0900`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature, context: "app", created: "20261101_0900" }));
  const rows = taskIds.map((id) => `| ${id} | Do ${id} | Core | - | Done | FR-001 / UC-001 | coder | src/${id}.ts |`);
  await writeFile(join(dir, ARTIFACTS["implementation-plan"].file), `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n`);
  if (ledger !== null) {
    await mkdir(join(dir, "loop"), { recursive: true });
    await writeFile(join(dir, "loop", "progress.md"), fixture(ledger));
  }
  return dir;
}

const cliArgs = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "loop-stats", positionals, options });

async function run(positionals: string[], options: Record<string, unknown> = {}): Promise<{ code: number; out: string; stdout: string }> {
  const { cmdLoopStats } = await loopStatsCommand();
  const res = await cmdLoopStats(cliArgs(positionals, options), root);
  return { code: res.code, stdout: res.stdout, out: `${res.stdout}\n${res.stderr ?? ""}` };
}

const historyPath = (): string => join(root, ".works", "loop-metrics.md");
const nonBlank = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "");

const F_ROW = "2026-11-01 · f · 2 · 75 · 72 · 3 · 36 · 25 · 22 · 50 · 0 · 26 · 10 · 1 · 1 · 2";

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-loop-stats-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261101_0900", defaultContext: "app" }));
  await item("f", ["TASK-001", "TASK-002"], "two-tasks.ledger.md");
  await item("g", ["TASK-001", "TASK-002", "TASK-003"], "mid-loop.ledger.md");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf loop-stats <feature>", () => {
  it("prints the same figures as JSON, keys in the documented order", async () => {
    const res = await run(["f"], { json: true });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(JSON_KEYS);
    expect(out).toEqual({ feature: "f", ...expected("two-tasks") });
  });

  it("prints a text report with every figure", async () => {
    const res = await run(["f"]);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines[0]).toBe("Loop stats — f");
    const text = res.stdout;
    expect(text).toMatch(/^wall\b.*\b75\.0 min$/m);
    expect(text).toMatch(/^busy\b.*\b72\.0 min$/m);
    expect(text).toMatch(/^controller\b.*\b3\.0 min$/m);
    expect(text).toMatch(/^saved\b.*\b36\.0 min$/m);
    expect(text).toMatch(/^waits\b.*\b25\.0 min$/m);
    expect(text).toMatch(/^seat minutes\b.*\b98\.0 min$/m);
    expect(lines).toContain("test-writer: 2 × median 11.0 min, sum 22.0 min");
    expect(lines).toContain("developer: 3 × median 20.0 min, sum 50.0 min");
    expect(lines).toContain("automation-writer: 0 × median 0.0 min, sum 0.0 min");
    expect(lines).toContain("code-reviewer: 4 × median 6.0 min, sum 26.0 min");
    expect(lines).toContain("verify: 3 × median 3.0 min, sum 10.0 min");
    expect(text).toMatch(/^rounds\b\D*1$/m);
    expect(text).toMatch(/^cascades\b\D*1$/m);
    expect(text).toMatch(/^tasks\b\D*2$/m);
    const byModel = lines.find((l) => l.startsWith("by model: "));
    expect(byModel).toBeDefined();
    for (const entry of ["test-writer/opus 10.0 min", "test-writer/sonnet 12.0 min", "developer/opus 30.0 min",
      "developer/sonnet 20.0 min", "code-reviewer/opus 16.0 min", "code-reviewer/sonnet 10.0 min"]) {
      expect(byModel).toContain(entry);
    }
    expect(lines).toContain("unparsed lines: none");
    expect(lines).toContain("orphan dispatches: none");
    expect(lines).toContain("open waits: none");
    expect(lines).toContain("other timed lines: 3");
    expect(lines).toContain("untimed lines: 2");
  });

  it("says in progress for a mid-loop ledger, in text and in JSON", async () => {
    const text = await run(["g"]);
    expect(text.code).toBe(0);
    expect(text.stdout.split("\n")[0]).toBe("Loop stats — g (in progress)");
    const json = await run(["g"], { json: true });
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ feature: "g", ...expected("mid-loop") });
  });

  it("exits 1 naming the path when the item has no ledger", async () => {
    const dir = await item("h", ["TASK-001"], null);
    const res = await run(["h"]);
    expect(res.code).toBe(1);
    expect(res.out).toContain(`no ledger: ${join(dir, "loop", "progress.md")}`);
  });

  it("exits 1 naming the path when the ledger has no timestamped seat line", async () => {
    const dir = await item("u", ["TASK-001"], "untimed.ledger.md");
    const res = await run(["u"]);
    expect(res.code).toBe(1);
    expect(res.out).toContain(`ledger is untimed: ${join(dir, "loop", "progress.md")}`);
  });

  it("exits 3 with the usage line when no feature is given", async () => {
    const res = await run([]);
    expect(res.code).toBe(3);
    expect(res.out).toContain("Usage: kf loop-stats <feature>");
  });

  it("exits 3 with the usage line for --all with a feature, --all with --record, or an unknown feature", async () => {
    for (const [positionals, options] of [[["f"], { all: true }], [[], { all: true, record: true }], [["ghost"], {}]] as const) {
      const res = await run([...positionals], options);
      expect(res.code, JSON.stringify({ positionals, options })).toBe(3);
      expect(res.out).toContain("Usage: kf loop-stats <feature>");
    }
  });

  it("is registered in the built CLI", () => {
    const report = spawnSync(process.execPath, [CLI, "loop-stats", "f", "--json"], { cwd: root, encoding: "utf8" });
    expect(report.status).toBe(0);
    expect(JSON.parse(report.stdout)).toEqual({ feature: "f", ...expected("two-tasks") });
    const usage = spawnSync(process.execPath, [CLI, "loop-stats"], { cwd: root, encoding: "utf8" });
    expect(usage.status).toBe(3);
    expect(`${usage.stdout}${usage.stderr}`).toContain("Usage: kf loop-stats <feature>");
  });
});

describe("kf loop-stats <feature> --record", () => {
  it("creates the history file with the header and one integer-minute row, and keeps one row after a second run", async () => {
    const first = await run(["f"], { record: true });
    expect(first.code).toBe(0);
    expect(first.out).toContain(`recorded f in ${historyPath()}`);
    expect(first.stdout.split("\n")[0]).toBe("Loop stats — f");
    expect(nonBlank(await readFile(historyPath(), "utf8"))).toEqual([HEADER, F_ROW]);

    const second = await run(["f"], { record: true });
    expect(second.code).toBe(0);
    expect(nonBlank(await readFile(historyPath(), "utf8"))).toEqual([HEADER, F_ROW]);
  });

  it("replaces the feature's earlier row in place and leaves other rows untouched", async () => {
    const other = "2026-10-20 · alpha · 2 · 100 · 60 · 40 · 10 · 8 · 20 · 30 · 0 · 16 · 6 · 1 · 0 · 3";
    const stale = "2026-10-30 · f · 2 · 1 · 1 · 0 · 0 · 0 · 1 · 0 · 0 · 0 · 0 · 0 · 0 · 0";
    const later = "2026-10-31 · beta · 4 · 200 · 140 · 60 · 30 · 20 · 40 · 104 · 8 · 24 · 12 · 2 · 1 · 0";
    await writeFile(historyPath(), `${HEADER}\n${other}\n${stale}\n${later}\n`);
    const res = await run(["f"], { record: true });
    expect(res.code).toBe(0);
    expect(nonBlank(await readFile(historyPath(), "utf8"))).toEqual([HEADER, other, F_ROW, later]);
  });

  it("refuses with exit 1 naming every task without a complete line, writing nothing", async () => {
    const res = await run(["g"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("cannot record g: no complete line for TASK-001, TASK-002, TASK-003");
    expect(existsSync(historyPath())).toBe(false);
  });

  it("refuses with exit 1 naming the file when its header differs, rewriting no row", async () => {
    const old = "date · feature · tasks · wall · busy\n2026-10-01 · other · 1 · 10 · 8\n2026-10-02 · f · 2 · 20 · 15\n";
    await writeFile(historyPath(), old);
    const res = await run(["f"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain(historyPath());
    expect(await readFile(historyPath(), "utf8")).toBe(old);
  });
});

describe("kf loop-stats --all", () => {
  const ALPHA = "2026-10-20 · alpha · 2 · 100 · 60 · 40 · 10 · 8 · 20 · 30 · 0 · 16 · 6 · 1 · 0 · 3";
  const BETA = "2026-10-27 · beta · 4 · 200 · 140 · 60 · 30 · 20 · 40 · 104 · 8 · 24 · 12 · 2 · 1 · 0";

  beforeEach(async () => {
    await writeFile(historyPath(), fixture("history-two-rows.md"));
  });

  it("prints the rows, column medians, per-task medians and the largest bucket as JSON", async () => {
    const res = await run([], { all: true, json: true });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(out.rows).toEqual([
      { date: "2026-10-20", feature: "alpha", tasks: 2, wall: 100, busy: 60, controller: 40, saved: 10, waits: 8,
        "test-writer": 20, developer: 30, "automation-writer": 0, "code-reviewer": 16, verify: 6, rounds: 1, cascades: 0, untimed: 3 },
      { date: "2026-10-27", feature: "beta", tasks: 4, wall: 200, busy: 140, controller: 60, saved: 30, waits: 20,
        "test-writer": 40, developer: 104, "automation-writer": 8, "code-reviewer": 24, verify: 12, rounds: 2, cascades: 1, untimed: 0 },
    ]);
    expect(out.medians).toEqual({
      tasks: 3, wall: 150, busy: 100, controller: 50, saved: 20, waits: 14, "test-writer": 30, developer: 67,
      "automation-writer": 4, "code-reviewer": 20, verify: 9, rounds: 1.5, cascades: 0.5, untimed: 1.5,
    });
    expect(out.perTask).toEqual({ controller: 17.5, "test-writer": 10, developer: 20.5, "code-reviewer": 7, verify: 3, waits: 4.5 });
    expect(out.largest).toEqual({ bucket: "developer", minutesPerTask: 20.5 });
  });

  it("prints the header, the rows, a median line, a per-task line and the largest line as text", async () => {
    const res = await run([], { all: true });
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toContain(HEADER);
    expect(lines).toContain(ALPHA);
    expect(lines).toContain(BETA);
    expect(lines.some((l) => l.startsWith("median · "))).toBe(true);
    expect(res.stdout).toMatch(/^per task: controller 17\.5 · test-writer 10(\.0)? · developer 20\.5 · code-reviewer 7(\.0)? · verify 3(\.0)? · waits 4\.5$/m);
    expect(lines).toContain("largest: developer 20.5 min/task");
  });

  it("exits 1 with no loop measured yet when there is no history file", async () => {
    await rm(historyPath());
    for (const options of [{ all: true }, { all: true, json: true }]) {
      const res = await run([], options);
      expect(res.code).toBe(1);
      expect(res.out).toContain("no loop measured yet");
    }
  });
});
