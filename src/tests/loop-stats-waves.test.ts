import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandHelp, type ParsedArgs } from "../cli/args.js";
import { cmdLoopStats } from "../cli/commands/loop-stats.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";

/*
 * Hand-computed from the ledger below (all Z, minutes from 10:00):
 *   task verify  10:06→10:08 = 2, 10:21→10:22 = 1          count 2, sum 3, median 1.5
 *   wave verify  10:10→10:14 = 4 (wave 1), 10:24→10:30 = 6 (wave 2)   count 2, sum 10, median 5
 * Wave minutes stay out of the per-task verify column and verifyMinutes.
 */

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";
const at = (hhmm: string): string => `2026-11-01T${hhmm}:00Z`;
const iso = (hhmm: string): string => new Date(at(hhmm)).toISOString();

const LEDGER_LINES = [
  `TASK-001: developer dispatched model=sonnet @ ${at("10:00")}`,
  `TASK-001: developer done status=DONE @ ${at("10:05")}`,
  `TASK-001: verify started @ ${at("10:06")}`,
  `TASK-001: verify done exit=0 @ ${at("10:08")}`,
  `TASK-001: complete (commits a1b2c3d, review clean) @ ${at("10:09")}`,
  `wave 1: verify started @ ${at("10:10")}`,
  `wave 1: verify done exit=0 @ ${at("10:14")}`,
  `TASK-002: developer dispatched model=sonnet @ ${at("10:15")}`,
  `TASK-002: developer done status=DONE @ ${at("10:20")}`,
  `TASK-002: verify started @ ${at("10:21")}`,
  `TASK-002: verify done exit=0 @ ${at("10:22")}`,
  `TASK-002: complete (commits b2c3d4e, review clean) @ ${at("10:23")}`,
  `wave 2: verify started @ ${at("10:24")}`,
  `wave 2: verify done exit=0 @ ${at("10:30")}`,
];
const WAVE_2_DONE_LINE = LEDGER_LINES.length + 1; // the header is line 1

let root: string;
let dir: string;

async function setUp(feature: string, lines: string[], logs: Record<string, string>): Promise<void> {
  dir = join(root, ".works", "implementation", `${feature}_20261101_0900`);
  await mkdir(join(dir, "loop"), { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature, context: "app", created: "20261101_0900" }));
  const rows = ["TASK-001", "TASK-002"].map((id) => `| ${id} | Do ${id} | Core | - | Done | FR-001 / UC-001 | coder | src/${id}.ts |`);
  await writeFile(join(dir, ARTIFACTS["implementation-plan"].file), `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n`);
  await writeFile(join(dir, "loop", "progress.md"), ["# Task loop ledger — x — plan: /p", ...lines, ""].join("\n"));
  for (const [name, text] of Object.entries(logs)) await writeFile(join(dir, "loop", name), text);
}

const taskLogs = {
  "task-001-verify.log": `## kf verify ${iso("10:08")} exit=0\n`,
  "task-002-verify.log": `## kf verify ${iso("10:22")} exit=0\n`,
};
const wave1Log = { "wave-1-verify.log": `## kf verify ${iso("10:14")} exit=0\n  ok\n` };
const wave2Log = { "wave-2-verify.log": `## kf verify ${iso("10:30")} exit=0\n  ok\n` };

async function run(feature: string, options: Record<string, unknown> = {}): Promise<{ code: number; stdout: string; out: string }> {
  const args: ParsedArgs = { command: "loop-stats", positionals: [feature], options };
  const res = await cmdLoopStats(args, root);
  return { code: res.code, stdout: res.stdout, out: `${res.stdout}\n${res.stderr ?? ""}` };
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-loop-stats-waves-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261101_0900", defaultContext: "app" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("wave verify figures", () => {
  beforeEach(async () => {
    await setUp("w", LEDGER_LINES, { ...taskLogs, ...wave1Log, ...wave2Log });
  });

  it("reports the wave verify count, median and sum in --json", async () => {
    const res = await run("w", { json: true });
    expect(res.code, res.out).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(out.waveVerify).toEqual({ count: 2, medianMin: 5, sumMin: 10 });
  });

  it("keeps wave minutes out of the per-task verify column", async () => {
    const out = JSON.parse((await run("w", { json: true })).stdout) as Record<string, unknown>;
    expect(out.verify).toEqual({ count: 2, sum: 3, median: 1.5 });
    expect(out.verifyMinutes).toBe(3);
  });

  it("treats the wave verify lines as paired, not unparsed or orphaned", async () => {
    const out = JSON.parse((await run("w", { json: true })).stdout) as Record<string, unknown>;
    expect(out.unparsed).toEqual([]);
    expect(out.orphans).toEqual([]);
  });

  it("prints a wave verify line right after the verify line in the text report", async () => {
    const res = await run("w");
    expect(res.code, res.out).toBe(0);
    const lines = res.stdout.split("\n");
    const i = lines.indexOf("verify: 2 × median 1.5 min, sum 3.0 min");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lines[i + 1]).toBe("wave verify: 2 × median 5.0 min, sum 10.0 min");
  });

  it("records the loop when every wave done line has its logged run", async () => {
    const res = await run("w", { record: true });
    expect(res.code, res.out).toBe(0);
  });
});

describe("wave verify lines against their logs", () => {
  it("refuses --record for a wave done line whose wave log has no run", async () => {
    await setUp("u", LEDGER_LINES, { ...taskLogs, ...wave1Log });
    const res = await run("u", { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("cannot record u:");
    expect(res.out).toContain(String(WAVE_2_DONE_LINE));
  });

  it("refuses --record for a wave done line whose logged run is over 15 minutes away", async () => {
    await setUp("late", LEDGER_LINES, { ...taskLogs, ...wave1Log, "wave-2-verify.log": `## kf verify ${iso("10:50")} exit=0\n` });
    const res = await run("late", { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain(String(WAVE_2_DONE_LINE));
  });

  it("refuses --record for a wave done line whose logged run has another exit code", async () => {
    await setUp("code", LEDGER_LINES, { ...taskLogs, ...wave1Log, "wave-2-verify.log": `## kf verify ${iso("10:30")} exit=1\n` });
    const res = await run("code", { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain(String(WAVE_2_DONE_LINE));
  });

  it("does not look for a log run behind a wave done line with exit 3", async () => {
    const lines = LEDGER_LINES.map((l) => (l.startsWith("wave 2: verify done") ? `wave 2: verify done exit=3 @ ${at("10:30")}` : l));
    await setUp("three", lines, { ...taskLogs, ...wave1Log });
    const res = await run("three", { record: true });
    expect(res.code, res.out).toBe(0);
  });

  it("still reports figures with a warning when a wave done line is unbacked", async () => {
    await setUp("warn", LEDGER_LINES, { ...taskLogs, ...wave1Log });
    const res = await run("warn", { json: true });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ waveVerify: { count: 2, sumMin: 10 } });
    expect(res.out).toContain(String(WAVE_2_DONE_LINE));
  });
});

describe("loop-stats help", () => {
  it("names wave verify", () => {
    expect(commandHelp("loop-stats")).toContain("wave verify");
  });
});

/*
 * Wave verify minutes are neither busy nor controller time: controller = wall - union(busy intervals, wave intervals).
 *   apart:       seat 10:00-10:10 = 10, wave 10:12-10:18 = 6, complete 10:20 -> wall 20, busy 10, controller 20-10-6 = 4
 *   overlapping: seat 10:00-10:10 = 10, wave 10:08-10:14 = 6, complete 10:16 -> wall 16, busy 10, union 14, controller 2
 */
describe("controller minutes with a wave verify", () => {
  const ledger = (waveStart: string, waveEnd: string, complete: string): string[] => [
    `TASK-001: developer dispatched model=sonnet @ ${at("10:00")}`,
    `TASK-001: developer done status=DONE @ ${at("10:10")}`,
    `wave 1: verify started @ ${at(waveStart)}`,
    `wave 1: verify done exit=0 @ ${at(waveEnd)}`,
    `TASK-001: complete (commits a1b2c3d, review clean) @ ${at(complete)}`,
  ];

  it("does not count a wave verify apart from the task seats as controller time", async () => {
    await setUp("cw", ledger("10:12", "10:18", "10:20"), { "wave-1-verify.log": `## kf verify ${iso("10:18")} exit=0\n` });
    const out = JSON.parse((await run("cw", { json: true })).stdout) as Record<string, unknown>;
    expect(out.wallMinutes).toBe(20);
    expect(out.busyMinutes).toBe(10);
    expect(out.controllerMinutes).toBe(4);
  });

  it("counts the minutes a wave verify shares with a task seat once", async () => {
    await setUp("cwo", ledger("10:08", "10:14", "10:16"), { "wave-1-verify.log": `## kf verify ${iso("10:14")} exit=0\n` });
    const out = JSON.parse((await run("cwo", { json: true })).stdout) as Record<string, unknown>;
    expect(out.wallMinutes).toBe(16);
    expect(out.busyMinutes).toBe(10);
    expect(out.controllerMinutes).toBe(2);
  });
  // The wall ends at the last complete line, so a wave verify running past it is clipped to the wall window.
  //   after:      seat 10:00-10:10 = 10, complete 10:12 -> wall 12, busy 10, wave 10:14-10:20 outside -> controller 2
  //   straddling: seat 10:00-10:10 = 10, wave 10:11-10:17, complete 10:14 -> wall 14, wave inside 10:11-10:14 = 3, controller 14-10-3 = 1
  it("ignores a wave verify that lies wholly after the last complete line", async () => {
    await setUp("ca", ledger("10:14", "10:20", "10:12"), { "wave-1-verify.log": `## kf verify ${iso("10:20")} exit=0\n` });
    const out = JSON.parse((await run("ca", { json: true })).stdout) as Record<string, unknown>;
    expect(out.wallMinutes).toBe(12);
    expect(out.busyMinutes).toBe(10);
    expect(out.controllerMinutes).toBe(2);
  });

  it("subtracts only the part of a straddling wave verify inside the wall", async () => {
    await setUp("cs", ledger("10:11", "10:17", "10:14"), { "wave-1-verify.log": `## kf verify ${iso("10:17")} exit=0\n` });
    const out = JSON.parse((await run("cs", { json: true })).stdout) as Record<string, unknown>;
    expect(out.wallMinutes).toBe(14);
    expect(out.controllerMinutes).toBe(1);
  });
});
