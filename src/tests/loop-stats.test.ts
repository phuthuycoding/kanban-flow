import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, utimesSync } from "node:fs";
import { appendFile, mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
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
 * three-developers.ledger.md — all Z, minutes counted from 09:00; deps {TASK-003: [TASK-001]}.
 *   developer intervals (line order of dispatch): TASK-001 [7,27]=20 opus, TASK-002 [9,25]=16 sonnet,
 *     TASK-004 [11,21]=10 opus, TASK-006 [23,29]=6 sonnet, TASK-003 [30,44]=14 opus, TASK-005 [35,43]=8 sonnet,
 *     TASK-001 round 1 [41,46]=5 opus                                       count 7, sum 79, median 10
 *   open developers: 7-9 one; 9-11 two; 11-21 three (001,002,004); 21-23 two; 23-25 three (001,002,006);
 *     25-27 two; 27-30 at most one; 30-35 one; 35-41 two; 41-43 three (003,005,001r); 43-44 two; 44-46 one
 *     peak 3; two or more open during [9,27]=18 and [35,44]=9 → developerOverlapMinutes 27
 *   test-writer 0→{5,6,8,7,4,3} count 6, sum 33, median (5+6)/2=5.5; automation-writer TASK-004 [22,29]=7
 *   code-reviewer 002 [26,32]=6, 006 [30,36]=6, 004 [31,37]=6, 001 [34,40]=6, 005 [44,48]=4, 003 [45,49]=4,
 *     001 round 1 [47,50]=3                                                 count 7, sum 35, median 6
 *   models: dev opus 20+10+14+5=49, sonnet 16+6+8=30; cr opus 6+6+6+3=21, sonnet 6+4+4=14; tw opus 33; aw sonnet 7
 *   seat = 33+79+7+35 = 154; no verify; union is one block [0,50] → busy 50; saved 104
 *   wall 09:00 → 09:51 (TASK-001 complete) = 51; controller 1; rounds 1, cascades 0, tasks 6
 *   waits: TASK-005 09:10 → 09:35 = 25; TASK-006 09:12 → 09:23 = 11 → 36; other-timed: the wave line = 1
 *   developer lag, gate → dispatch (round=1 dispatch not counted):
 *     TASK-001 test-writer done 5 → 7 = 2; TASK-002 done 6 → 9 = 3; TASK-004 done 7 → 11 = 4
 *     TASK-006: first developer done after its "4 developers in flight" wait is TASK-004's at 21 → 23 = 2
 *     TASK-003: latest of its test-writer done 8 and TASK-001's developer done 27 (dependency) → 30 = 3
 *     TASK-005: latest of its test-writer done 4 and TASK-002 complete 33 ("Files overlap … (TASK-002)") → 35 = 2
 *     lags 2,3,4,2,3,2 → sorted 2,2,2,3,3,4: n 6, median (2+3)/2=2.5, max 4
 *     without the dependency map TASK-003 is gated by its test-writer done only: 8 → 30 = 22 → max 22, median 2.5
 *   code-reviewer lag (round=1 dispatch not counted): 002 developer done 25 → 26 = 1; 004 latest of developer done 21
 *     and automation-writer done 29 → 31 = 2; 001 developer done 27 → 34 = 7; 006 29 → 30 = 1; 005 43 → 44 = 1;
 *     003 44 → 45 = 1 → sorted 1,1,1,1,2,7: n 6, median 1, max 7
 *   the "4 developers in flight" text sits beside a peak of 3: the wait is only ledger text here.
 *
 * adaptive-cap.ledger.md — all Z, minutes counted from 09:00; no dependency map.
 *   test-writer wave 1 [0,4]=4, [0,5]=5, [0,6]=6; wave 2 [26,29]=3, [26,30]=4, [26,31]=5, [26,32]=6
 *     count 7, sum 33, sorted 3,4,4,5,5,6,6 → median 5
 *   developer 001 [5,15]=10 opus, 002 [6,18]=12 sonnet, 003 [16,24]=8 sonnet, 004 [30,38]=8 opus,
 *     005 [31,46]=15 sonnet, 006 [32,48]=16 sonnet, 007 [39,50]=11 opus     count 7, sum 80, sorted 8,8,10,11,12,15,16 → median 11
 *   verify TASK-004 failed run [40,42]=2, re-run [51,54]=3                  count 2, sum 5, median 2.5
 *   models: dev opus 10+8+11=29, sonnet 12+8+15+16=51; tw opus 33
 *   seat = 33+80 = 113; verify 5; union: [0,24] (tw 0-6, dev 5-15, 6-18, 16-24) = 24;
 *     [26,50] (tw 26-32, dev 30-38, 31-46, 32-48, 39-50, verify 40-42 nested) = 24; [51,54] verify = 3 → busy 51
 *   saved = 113+5-51 = 67; wall 09:00 → 09:58 (TASK-007 complete, last) = 58; controller = 58-51 = 7
 *   waits: TASK-003 "2 developers in flight" 09:07 → its dispatch 09:16 = 9; TASK-007 "3 developers in flight"
 *     09:33 → 09:39 = 6 → 15
 *   other-timed: two wave lines, three Ruling lines, one Note line = 6; untimed 0; rounds 0; cascades 0; tasks 7
 *   open developers: 5-6 one; 6-15 two; 15-16 one; 16-18 two; 18-24 one; 24-30 none; 30-31 one; 31-32 two;
 *     32-38 three; 38-39 two; 39-46 three; 46-48 two; 48-50 one → peak 3;
 *     two or more open [6,15]=9 + [16,18]=2 + [31,48]=17 → developerOverlapMinutes 28
 *   developer lag: 001 tw done 4 → 5, 002 5 → 6, 004 29 → 30, 005 30 → 31, 006 31 → 32 = 1 each;
 *     003: latest of tw done 6 and the first developer done after its wait (001 at 15) → 16 = 1;
 *     007: latest of tw done 32 and the first developer done after its wait (004 at 38) → 39 = 1 → n 7, median 1, max 1
 *   code-reviewer: no dispatch → null, null, 0; unparsed, orphans, open waits empty
 *
 * Existing fixtures, new figures: no developer intervals overlap in two-tasks, mid-loop and resumed → peak 1, overlap 0.
 *   two-tasks developer lag: TASK-001 test-writer done 10 → dispatch 11 = 1; TASK-002 done 14 → 33 = 19 (the
 *     "developer in flight" wait is no gate; round=1 skipped) → n 2, median 10, max 19.
 *     code-reviewer lag: TASK-001 developer done 31 → 36 = 5; TASK-002 developer done 53 → 59 = 6 (round=1 and
 *     cascade= dispatches skipped) → n 2, median 5.5, max 6
 *   mid-loop: TASK-001 test-writer done 09:12 → 09:13 = 1 → developer n 1; no code-reviewer dispatch → null, null, 0
 *   resumed: TASK-001 has no test-writer done, so its two dispatches have no gate; TASK-002 test-writer done 04:13 →
 *     04:16 = 3 → developer n 1; code-reviewer TASK-001 developer done 03:41 → 03:43 = 2 → n 1
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
  "orphans", "openWaits", "otherTimed", "untimed", "developersPeak", "developerOverlapMinutes", "dispatchLag",
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

async function statsWithDeps(text: string, deps?: Record<string, string[]>): Promise<Record<string, unknown>> {
  const { parseLedger, loopStats } = await loopStatsModule();
  return (loopStats as (p: unknown, d?: Record<string, string[]>) => unknown)(parseLedger(text), deps) as Record<string, unknown>;
}

const THREE_DEPS = { "TASK-003": ["TASK-001"] };

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

describe("developer concurrency and dispatch lag", () => {
  it("counts a peak of three open developers and the minutes two or more were open in the three-developer loop", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"), THREE_DEPS);
    const want = expected("three-developers");
    expect(stats.developersPeak).toBe(3);
    expect(stats.developerOverlapMinutes).toBe(27);
    expect(stats.developersPeak).toBe(want.developersPeak);
    expect(stats.developerOverlapMinutes).toBe(want.developerOverlapMinutes);
  });

  it("computes every figure of the three-developer loop", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"), THREE_DEPS);
    expect(stats).toMatchObject(withoutTasks(expected("three-developers")));
    expect(taskCount(stats.tasks)).toBe(6);
  });

  it("measures developer lag from the latest gate line: test-writer done, dependency done, file-overlap task complete, first developer done after a cap wait", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"), THREE_DEPS);
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 2.5, max: 4, n: 6 });
  });

  it("does not count a developer dispatch with round= in the developer lag", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"), THREE_DEPS);
    // Seven developer dispatches exist; the round=1 one is skipped.
    expect(((stats.dispatchLag as Record<string, { n: number }>).developer).n).toBe(6);
    expect((stats.seats as Record<string, { count: number }>).developer.count).toBe(7);
  });

  it("skips the dependency gate when no dependency map is given", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"));
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 2.5, max: 22, n: 6 });
  });

  it("measures code-reviewer lag from the later of developer done and automation-writer done and skips round= dispatches", async () => {
    const stats = await statsWithDeps(fixture("three-developers.ledger.md"), THREE_DEPS);
    expect((stats.dispatchLag as Record<string, unknown>).codeReviewer).toEqual({ median: 1, max: 7, n: 6 });
  });

  it("skips round= and cascade= code-reviewer dispatches in the two-task loop", async () => {
    const stats = await statsWithDeps(fixture("two-tasks.ledger.md"));
    expect(stats.dispatchLag).toEqual({ developer: { median: 10, max: 19, n: 2 }, codeReviewer: { median: 5.5, max: 6, n: 2 } });
  });

  it("reports null median and max with n 0 when the ledger has no code-reviewer dispatch", async () => {
    const stats = await statsWithDeps(fixture("mid-loop.ledger.md"));
    expect((stats.dispatchLag as Record<string, unknown>).codeReviewer).toEqual({ median: null, max: null, n: 0 });
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 1, max: 1, n: 1 });
  });

  it("does not count a dispatch that has no gate line in the ledger", async () => {
    const stats = await statsWithDeps(fixture("resumed.ledger.md"));
    // TASK-001 has no test-writer done, so its two developer dispatches are not counted; TASK-002's is.
    expect(stats.dispatchLag).toEqual({ developer: { median: 3, max: 3, n: 1 }, codeReviewer: { median: 2, max: 2, n: 1 } });
  });

  it("measures lag from the first plain dispatch of a task and seat only, not from a resume re-dispatch", async () => {
    // Developer: test-writer done 10:00 → first dispatch 10:04 = 4; the plain re-dispatch at 10:30 (a resume) would give 30.
    // Code-reviewer: developer done 10:50 → first dispatch 10:53 = 3; the plain re-dispatch at 11:10 would give 20.
    const ledger = [
      "# Task loop ledger — resume",
      "TASK-001: test-writer done status=DONE @ 2026-11-01T10:00:00Z",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:04:00Z",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:30:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:50:00Z",
      "TASK-001: code-reviewer dispatched model=opus @ 2026-11-01T10:53:00Z",
      "TASK-001: code-reviewer dispatched model=opus @ 2026-11-01T11:10:00Z",
      "TASK-001: code-reviewer done status=clean @ 2026-11-01T11:20:00Z",
      "",
    ].join("\n");
    const stats = await statsWithDeps(ledger);
    expect(stats.dispatchLag).toEqual({
      developer: { median: 4, max: 4, n: 1 },
      codeReviewer: { median: 3, max: 3, n: 1 },
    });
  });

  it("measures developer lag from the latest of every gate when a task waits on a file overlap and then on the cap", async () => {
    // Gates of TASK-005: the cap wait is followed by the first developer done (TASK-002, 10:20), but the overlapping
    // TASK-001 completes later (10:30). Lag from the latest gate is 10:34 - 10:30 = 4; reading only the last wait line gives 14.
    const ledger = [
      "# Task loop ledger — two gates",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:00:00Z",
      "TASK-002: developer dispatched model=opus @ 2026-11-01T10:01:00Z",
      "TASK-005: developer waits — Files overlap x / x (TASK-001) @ 2026-11-01T10:05:00Z",
      "TASK-005: developer waits — 4 developers in flight @ 2026-11-01T10:10:00Z",
      "TASK-002: developer done status=DONE @ 2026-11-01T10:20:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:22:00Z",
      "TASK-001: complete (commits a000001) @ 2026-11-01T10:30:00Z",
      "TASK-005: developer dispatched model=opus @ 2026-11-01T10:34:00Z",
      "",
    ].join("\n");
    const stats = await statsWithDeps(ledger);
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 4, max: 4, n: 1 });
  });

  it("gates developer lag on the first developer done after a cap wait whatever the cap number is", async () => {
    // A cap of 3 still gates: first developer done after the wait is 10:20, dispatch at 10:23 gives a lag of 3.
    const ledger = [
      "# Task loop ledger — other cap",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:00:00Z",
      "TASK-002: developer dispatched model=opus @ 2026-11-01T10:01:00Z",
      "TASK-003: developer waits — 3 developers in flight @ 2026-11-01T10:05:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:20:00Z",
      "TASK-003: developer dispatched model=opus @ 2026-11-01T10:23:00Z",
      "",
    ].join("\n");
    const stats = await statsWithDeps(ledger);
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 3, max: 3, n: 1 });
  });

  it("reports peak 1 and overlap 0 when one developer ends exactly when another starts", async () => {
    const ledger = [
      "# Task loop ledger — touching",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:00:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:20:00Z",
      "TASK-002: developer dispatched model=opus @ 2026-11-01T10:20:00Z",
      "TASK-002: developer done status=DONE @ 2026-11-01T10:40:00Z",
      "",
    ].join("\n");
    const stats = await statsWithDeps(ledger);
    expect(stats.developersPeak).toBe(1);
    expect(stats.developerOverlapMinutes).toBe(0);
  });

  it("reports peak 2 and the shared minutes when two developers genuinely overlap", async () => {
    const ledger = [
      "# Task loop ledger — overlapping",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T10:00:00Z",
      "TASK-002: developer dispatched model=opus @ 2026-11-01T10:15:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:20:00Z",
      "TASK-002: developer done status=DONE @ 2026-11-01T10:40:00Z",
      "",
    ].join("\n");
    const stats = await statsWithDeps(ledger);
    expect(stats.developersPeak).toBe(2);
    expect(stats.developerOverlapMinutes).toBe(5);
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

describe("waits and doubled suffixes", () => {
  /*
   * wait-backwards.ledger.md (Z): L4 TASK-001 waits at 09:20, and the next later developer dispatched of
   * TASK-001 is L5 at 09:15 (earlier). L8 TASK-002 fix queued at 09:40, then L9 dispatched at 09:35.
   * Each pair would be negative, so all four lines are unparsed and no wait is counted.
   */
  it("lists a wait whose next developer dispatch is timestamped earlier as unparsed and counts no wait", async () => {
    const stats = await statsOf("wait-backwards");
    expect(stats.unparsed).toEqual([4, 5, 8, 9]);
    expect(stats.waitMinutes).toBe(0);
  });

  it("classifies a line with a second suffix as unparsed for every shape, waits included", async () => {
    const { parseLedger } = await loopStatsModule();
    const parsed = parseLedger(fixture("double-suffix.ledger.md"));
    expect(parsed.lines.map((l) => [l.line, l.kind])).toEqual(
      [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [n, "unparsed"]),
    );
  });

  it("counts nothing from doubled-suffix lines and lists each of them as unparsed", async () => {
    const stats = await statsOf("double-suffix");
    expect(stats.unparsed).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stats.waitMinutes).toBe(0);
    expect(stats.openWaits).toEqual([]);
    expect(stats.rounds).toBe(0);
    expect(stats.cascades).toBe(0);
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
    // A fixture's verify lines stand for real runs, so each gets the log block kf verify would have written.
    for (const m of fixture(ledger).matchAll(/^(TASK-\d+): verify done exit=(\d+) @ (\S+)$/gm)) {
      await appendFile(join(dir, "loop", `${m[1].toLowerCase()}-verify.log`), `## kf verify ${new Date(m[3]).toISOString()} exit=${m[2]}\n`);
    }
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

  it("exits 3 with the usage line on an unknown option", () => {
    const res = spawnSync(process.execPath, [CLI, "loop-stats", "f", "--bogus"], { cwd: root, encoding: "utf8" });
    expect(res.status).toBe(3);
    expect(`${res.stdout}${res.stderr}`).toContain("Usage: kf loop-stats <feature>");
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

  it("refuses with exit 1 naming the lock while another record holds it, leaving the history byte-unchanged", async () => {
    const before = `${HEADER}\n2026-10-20 · alpha · 2 · 100 · 60 · 40 · 10 · 8 · 20 · 30 · 0 · 16 · 6 · 1 · 0 · 3\n`;
    await writeFile(historyPath(), before);
    const lock = `${historyPath()}.lock`;
    await writeFile(lock, "");
    const res = await run(["f"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain(lock);
    expect(await readFile(historyPath(), "utf8")).toBe(before);
  });

  it("leaves no lock file behind after a successful record", async () => {
    const res = await run(["f"], { record: true });
    expect(res.code).toBe(0);
    expect(existsSync(`${historyPath()}.lock`)).toBe(false);
  });

  it("falls back to the ledger's dispatched tasks when the plan lists none, refusing those without a complete line", async () => {
    await item("m", [], "mid-loop.ledger.md");
    const res = await run(["m"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("cannot record m: no complete line for TASK-001, TASK-002");
    expect(existsSync(historyPath())).toBe(false);
  });

  it("records the row when the plan lists no tasks and every dispatched task is complete", async () => {
    await item("n", [], "two-tasks.ledger.md");
    const res = await run(["n"], { record: true });
    expect(res.code).toBe(0);
    // Same ledger as f, so the same figures under the feature name n.
    expect(nonBlank(await readFile(historyPath(), "utf8"))).toEqual([HEADER, F_ROW.replace(" · f · ", " · n · ")]);
  });
});

describe("kf loop-stats developer concurrency and dispatch lag", () => {
  async function withDeps(feature: string, rows: { id: string; deps: string }[], ledgerText: string): Promise<void> {
    const dir = join(root, ".works", "implementation", `${feature}_20261101_0900`);
    await mkdir(join(dir, "loop"), { recursive: true });
    await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature, context: "app", created: "20261101_0900" }));
    const lines = rows.map((r) => `| ${r.id} | Do ${r.id} | Core | ${r.deps} | Done | FR-001 / UC-001 | coder | src/${r.id}.ts |`);
    await writeFile(join(dir, ARTIFACTS["implementation-plan"].file), `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${lines.join("\n")}\n`);
    await writeFile(join(dir, "loop", "progress.md"), ledgerText);
  }

  const threePlan = ["TASK-001", "TASK-002", "TASK-003", "TASK-004", "TASK-005", "TASK-006"].map((id) => ({ id, deps: id === "TASK-003" ? "TASK-001" : "-" }));

  it("prints the peak, the overlap and the dispatch lag lines in the text report", async () => {
    await withDeps("t", threePlan, fixture("three-developers.ledger.md"));
    const res = await run(["t"]);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toContain("developers peak: 3");
    expect(lines).toContain("developer overlap: 27.0 min");
    expect(lines).toContain("dispatch lag: developer median 2.5 max 4 (n=6), code-reviewer median 1 max 7 (n=6)");
  });

  it("prints a dash for a null median and max in the dispatch lag line", async () => {
    const res = await run(["g"]);
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")).toContain("dispatch lag: developer median 1 max 1 (n=1), code-reviewer median - max - (n=0)");
  });

  it("carries developersPeak, developerOverlapMinutes and dispatchLag in the JSON", async () => {
    await withDeps("t", threePlan, fixture("three-developers.ledger.md"));
    const res = await run(["t"], { json: true });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(JSON_KEYS);
    expect(out).toEqual({ feature: "t", ...expected("three-developers") });
  });

  it("keeps the history header byte-identical and the recorded row to the existing columns", async () => {
    await withDeps("t", threePlan, fixture("three-developers.ledger.md"));
    await writeFile(historyPath(), `${HEADER}\n2026-10-20 · alpha · 2 · 100 · 60 · 40 · 10 · 8 · 20 · 30 · 0 · 16 · 6 · 1 · 0 · 3\n`);
    const res = await run(["t"], { record: true });
    expect(res.code).toBe(0);
    const lines = nonBlank(await readFile(historyPath(), "utf8"));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(HEADER);
    expect(lines[2]).toBe("2026-11-01 · t · 6 · 51 · 50 · 1 · 104 · 36 · 33 · 79 · 7 · 35 · 0 · 1 · 0 · 0");
  });

  it("measures a dependent task's developer lag from its dependency's developer done using the plan's dependencies", async () => {
    const ledger = [
      "# Task loop ledger — gap",
      "TASK-001: test-writer dispatched model=opus @ 2026-11-01T09:00:00Z",
      "TASK-002: test-writer dispatched model=opus @ 2026-11-01T09:00:00Z",
      "TASK-001: test-writer done status=DONE @ 2026-11-01T09:05:00Z",
      "TASK-002: test-writer done status=DONE @ 2026-11-01T09:06:00Z",
      "TASK-001: developer dispatched model=opus @ 2026-11-01T09:06:00Z",
      "TASK-001: developer done status=DONE @ 2026-11-01T09:20:00Z",
      "TASK-002: developer dispatched model=opus @ 2026-11-01T09:24:00Z",
      "TASK-002: developer done status=DONE @ 2026-11-01T09:30:00Z",
      "",
    ].join("\n");
    await withDeps("d", [{ id: "TASK-001", deps: "-" }, { id: "TASK-002", deps: "TASK-001" }], ledger);
    const res = await run(["d"], { json: true });
    expect(res.code).toBe(0);
    // TASK-001: 09:05 → 09:06 = 1; TASK-002: dependency done 09:20 → 09:24 = 4 (its own test-writer done 09:06 would give 18).
    expect((JSON.parse(res.stdout) as { dispatchLag: unknown }).dispatchLag).toEqual({
      developer: { median: 2.5, max: 4, n: 2 },
      codeReviewer: { median: null, max: null, n: 0 },
    });
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

describe("a live-cap ledger", () => {
  it("computes every figure of a loop with cap rulings, contention notes and a verify re-run", async () => {
    const stats = await statsWithDeps(fixture("adaptive-cap.ledger.md"));
    expect(stats).toMatchObject(withoutTasks(expected("adaptive-cap")));
    expect(taskCount(stats.tasks)).toBe(7);
  });

  it("lists nothing as unparsed, orphaned or still waiting", async () => {
    const stats = await statsOf("adaptive-cap");
    expect(stats.unparsed).toEqual([]);
    expect(stats.orphans).toEqual([]);
    expect(stats.openWaits).toEqual([]);
  });

  it("counts the cap rulings, wave lines and contention note as other-timed lines, not as shapes", async () => {
    const stats = await statsOf("adaptive-cap");
    expect(stats.otherTimed).toBe(7);
    expect(stats.untimed).toBe(0);
  });

  it("pairs the failed verify and its re-run as two separate verify intervals", async () => {
    const stats = await statsOf("adaptive-cap");
    expect(stats.verify).toEqual({ count: 2, sum: 5, median: 2.5 });
    expect(stats.verifyMinutes).toBe(5);
  });

  it("gates the waits on 2 and 3 developers in flight on the next developer done", async () => {
    const stats = await statsOf("adaptive-cap");
    // TASK-003 waits 09:07 → 09:16 and TASK-007 waits 09:33 → 09:39; each lags 1 minute behind the developer done that freed a seat.
    expect(stats.waitMinutes).toBe(15);
    expect((stats.dispatchLag as Record<string, unknown>).developer).toEqual({ median: 1, max: 1, n: 7 });
  });
});

/*
 * Near-miss seat lines. Harmless variants are read as written: trailing whitespace, a `+hhmm` offset.
 * Any other line that claims a shape (TASK-NNN: + a seat or verify keyword, also behind a markdown
 * bullet) and fails it is unparsed with its line number — before, a bullet made it other-timed and a
 * space for `T` made it untimed, both silently.
 */
describe("near-miss ledger lines", () => {
  const H = "# Task loop ledger — x\n";
  const kindsOf = async (body: string): Promise<Record<number, string>> => {
    const { parseLedger } = await loopStatsModule();
    return Object.fromEntries(parseLedger(`${H}${body}`).lines.map((l) => [l.line, l.kind]));
  };

  it("reads a +hhmm offset as the same instant as +hh:mm and pairs it", async () => {
    const { parseLedger, loopStats } = await loopStatsModule();
    const parsed = parseLedger(`${H}TASK-001: developer dispatched model=opus @ 2026-11-01T18:00:00+0700\nTASK-001: developer done status=DONE @ 2026-11-01T18:10:00+07:00\n`);
    expect(parsed.lines[0]).toMatchObject({ kind: "shape", shape: "dispatched", ts: utc(11, 0), stamp: "2026-11-01T18:00:00+0700" });
    const stats = loopStats(parsed);
    expect(stats.seats.developer).toEqual({ count: 1, sum: 10, median: 10 });
    expect(stats.unparsed).toEqual([]);
  });

  it("ignores trailing whitespace after the timestamp", async () => {
    expect(await kindsOf("TASK-001: verify started @ 2026-11-01T09:00:00Z  \t\nTASK-001: verify done exit=0 @ 2026-11-01T09:02:00Z \n")).toEqual({ 2: "shape", 3: "shape" });
  });

  it("lists a done line carrying round= as unparsed and its dispatch as an orphan", async () => {
    const { parseLedger, loopStats } = await loopStatsModule();
    const stats = loopStats(parseLedger(`${H}TASK-007: test-writer dispatched model=opus round=1 @ 2026-11-01T09:00:00Z\nTASK-007: test-writer done status=DONE round=1 @ 2026-11-01T09:10:00Z\n`));
    expect(stats.unparsed).toEqual([3]);
    expect(stats.orphans).toEqual([2]);
    expect(stats.seatMinutes).toBe(0);
  });

  it("lists a seat line behind a markdown bullet as unparsed, not other-timed", async () => {
    expect(await kindsOf("- TASK-003: developer dispatched model=sonnet @ 2026-11-01T09:00:00Z\n* TASK-003: developer done status=DONE @ 2026-11-01T09:05:00Z\n")).toEqual({ 2: "unparsed", 3: "unparsed" });
  });

  it("lists a seat line whose timestamp has a space for T as unparsed, not untimed", async () => {
    expect(await kindsOf("TASK-001: developer dispatched model=opus @ 2026-11-01 09:00:00Z\n")).toEqual({ 2: "unparsed" });
  });

  it("keeps an old seat line with no timestamp at all untimed and a bulleted non-seat line other-timed", async () => {
    expect(await kindsOf("TASK-001: fix round 1/5 (nit)\n- Ruling: keep @ 2026-11-01T09:00:00Z\nNote TASK-001: reopened — review 1a2b3c4d @ 2026-11-01T09:01:00Z\n")).toEqual({ 2: "untimed", 3: "other-timed", 4: "other-timed" });
  });
});

/*
 * review-repair.ledger.md — all Z, minutes from 09:00; one task completed, reopened by review, completed again.
 *   test-writer [0,5]=5, round 1 [41,44]=3 → count 2, sum 8, median 4 (opus)
 *   developer   [6,16]=10, round 1 [45,53]=8 → count 2, sum 18, median 9 (opus)
 *   code-reviewer [17,21]=4, round 1 [54,57]=3 → count 2, sum 7, median 3.5 (sonnet)
 *   seat 33; no verify; intervals disjoint → busy 33, saved 0; wall 09:00 → 09:58 (second complete) = 58; controller 25
 *   the Note line is other-timed; no fix round line → rounds 0
 */
describe("a review-stage repair after complete", () => {
  it("counts the seat lines after the first complete and ends the wall at the second complete", async () => {
    const stats = await statsOf("review-repair");
    expect(stats).toMatchObject({
      inProgress: false,
      wallMinutes: 58,
      seats: {
        "test-writer": { count: 2, sum: 8, median: 4 },
        developer: { count: 2, sum: 18, median: 9 },
        "automation-writer": { count: 0, sum: 0, median: 0 },
        "code-reviewer": { count: 2, sum: 7, median: 3.5 },
      },
      seatMinutes: 33,
      busyMinutes: 33,
      savedMinutes: 0,
      controllerMinutes: 25,
      rounds: 0,
      tasks: 1,
      byModel: { "test-writer/opus": 8, "developer/opus": 18, "code-reviewer/sonnet": 7 },
      unparsed: [],
      orphans: [],
      openWaits: [],
      otherTimed: 1,
      untimed: 0,
    });
  });

  it("records the repaired item", async () => {
    await item("r", ["TASK-001"], "review-repair.ledger.md");
    const res = await run(["r"], { record: true });
    expect(res.code).toBe(0);
    expect(nonBlank(await readFile(historyPath(), "utf8"))).toEqual([HEADER, "2026-11-01 · r · 1 · 58 · 33 · 25 · 0 · 0 · 8 · 18 · 0 · 7 · 0 · 0 · 0 · 0"]);
  });
});

/*
 * broken-lines.ledger.md — L3 done carries round= (unparsed) so L2 is an orphan; L4 is bulleted (unparsed),
 * so L5 is a done with no dispatch (unparsed). Every task has a complete line.
 */
describe("kf loop-stats with unparsed or orphan lines", () => {
  it("refuses --record with exit 1 naming the line numbers, writing nothing", async () => {
    const dir = await item("b", ["TASK-001"], "broken-lines.ledger.md");
    const res = await run(["b"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("cannot record b: ledger unparsed lines 3, 4, 5 and orphan lines 2");
    expect(res.out).toContain(`fix those lines in ${join(dir, "loop", "progress.md")}`);
    expect(existsSync(historyPath())).toBe(false);
  });

  it("reports with exit 0 and names the lines in a stderr warning, text and JSON alike", async () => {
    await item("b", ["TASK-001"], "broken-lines.ledger.md");
    const { cmdLoopStats } = await loopStatsCommand();
    const text = await cmdLoopStats(cliArgs(["b"]), root);
    expect(text.code).toBe(0);
    expect(text.stdout.split("\n")[0]).toBe("Loop stats — b");
    expect(text.stderr).toMatch(/^warning: ledger unparsed lines 3, 4, 5 and orphan lines 2 are left out of every figure/);
    const json = await cmdLoopStats(cliArgs(["b"], { json: true }), root);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ unparsed: [3, 4, 5], orphans: [2] });
    expect(json.stderr).toContain("unparsed lines 3, 4, 5");
  });

  it("names lines stamped after the file was last written, and refuses to record them", async () => {
    const dir = await item("late", ["TASK-001", "TASK-002"], "two-tasks.ledger.md");
    // The fixture's last stamps sit after this moment, as a ledger with estimated times does.
    const ledger = join(dir, "loop", "progress.md");
    const stamps = [...readFileSync(ledger, "utf8").matchAll(/ @ (\S+)$/gm)].map((m) => Date.parse(m[1]));
    const written = new Date(stamps[0] + 1000);
    utimesSync(ledger, written, written);
    const { cmdLoopStats } = await loopStatsCommand();
    const report = await cmdLoopStats(cliArgs(["late"]), root);
    expect(report.code).toBe(0);
    expect(report.stderr).toContain("are stamped after the file was last written, so those times did not come from the clock");
    const res = await run(["late"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("cannot record late:");
    expect(res.out).toContain("are stamped after the file was last written");
  });

  describe("against the log kf verify writes", () => {
    const ledgerOf = (lines: string[]): string => ["# Task loop ledger — v — plan: /p", ...lines, ""].join("\n");
    const STAMP = "2026-11-01T10:10:00+07:00";
    const lines = (exit: number): string[] => [
      "TASK-001: developer dispatched model=sonnet @ 2026-11-01T10:00:00+07:00",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:05:00+07:00",
      "TASK-001: verify started @ 2026-11-01T10:06:00+07:00",
      `TASK-001: verify done exit=${exit} @ ${STAMP}`,
      "TASK-001: complete (commits a1b2c3d, review clean) @ 2026-11-01T10:12:00+07:00",
    ];
    const setUp = async (exit: number, log: string | null): Promise<string> => {
      const dir = await item("v", ["TASK-001"], "two-tasks.ledger.md");
      await rm(join(dir, "loop"), { recursive: true, force: true });
      await mkdir(join(dir, "loop"));
      await writeFile(join(dir, "loop", "progress.md"), ledgerOf(lines(exit)));
      if (log !== null) await writeFile(join(dir, "loop", "task-001-verify.log"), log);
      return dir;
    };

    it("records when every verify line has its logged run", async () => {
      await setUp(0, `## kf verify ${new Date(STAMP).toISOString()} exit=1\noutput\n## kf verify ${new Date(STAMP).toISOString()} exit=0\n`);
      const res = await run(["v"], { record: true });
      expect(res.code, res.out).toBe(0);
    });

    it("refuses a verify line no logged run backs, the way a hand-written exit reads", async () => {
      await setUp(0, null);
      const res = await run(["v"], { record: true });
      expect(res.code).toBe(1);
      expect(res.out).toContain("ledger lines 5 report a verify exit no kf verify run logged");
    });

    it("refuses an exit code the log contradicts", async () => {
      await setUp(0, `## kf verify ${new Date(STAMP).toISOString()} exit=1\n`);
      expect((await run(["v"], { record: true })).out).toContain("report a verify exit no kf verify run logged");
    });

    it("pairs a line with the nearest run, so an earlier run of a dead session does not read as far away", async () => {
      const earlier = new Date(Date.parse(STAMP) - 2 * 3_600_000).toISOString();
      await setUp(0, `## kf verify ${earlier} exit=0\n## kf verify ${new Date(STAMP).toISOString()} exit=0\n`);
      const res = await run(["v"], { record: true });
      expect(res.code, res.out).toBe(0);
    });

    it("does not check a log from before this format, or a line for exit 3, which ran nothing", async () => {
      await setUp(0, "## verify started 2026-11-01T10:06:00+07:00\nold output\n");
      expect((await run(["v"], { record: true })).code).toBe(0);
      await setUp(3, null);
      expect((await run(["v"], { record: true })).code).toBe(0);
    });

    it("refuses a stamp far from the run it reports, the way an estimated time reads", async () => {
      await setUp(0, `## kf verify ${new Date(Date.parse(STAMP) + 3 * 3_600_000).toISOString()} exit=0\n`);
      const res = await run(["v"], { record: true });
      expect(res.code).toBe(1);
      expect(res.out).toContain("stamped over 15 minutes from the kf verify run");
    });
  });

  it("does not take a reopened task's earlier complete line as complete", async () => {
    await item("again", ["TASK-001"], "two-tasks.ledger.md");
    const ledger = join(root, ".works", "implementation", "again_20261101_0900", "loop", "progress.md");
    await writeFile(ledger, [
      "# Task loop ledger — again — plan: /p",
      "TASK-001: developer dispatched model=sonnet @ 2026-11-01T10:00:00+07:00",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:05:00+07:00",
      "TASK-001: complete (commits a1b2c3d, review clean) @ 2026-11-01T10:06:00+07:00",
      "Note TASK-001: reopened — review 1234abcd @ 2026-11-01T11:00:00+07:00",
      "",
    ].join("\n"));
    const res = await run(["again"], { record: true });
    expect(res.code).toBe(1);
    expect(res.out).toContain("no complete line for TASK-001");
  });

  it("reports a reopened task as in progress", async () => {
    await item("open", ["TASK-001"], "two-tasks.ledger.md");
    const ledger = join(root, ".works", "implementation", "open_20261101_0900", "loop", "progress.md");
    await writeFile(ledger, [
      "# Task loop ledger — open — plan: /p",
      "TASK-001: developer dispatched model=sonnet @ 2026-11-01T10:00:00+07:00",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:05:00+07:00",
      "TASK-001: complete (commits a1b2c3d, review clean) @ 2026-11-01T10:06:00+07:00",
      "Note TASK-001: reopened — review 1234abcd @ 2026-11-01T11:00:00+07:00",
      "",
    ].join("\n"));
    expect((await run(["open"])).stdout.split("\n")[0]).toBe("Loop stats — open (in progress)");
  });

  it("records a ledger whose only orphan is a seat a resume dispatched again", async () => {
    const dir = await item("resumed", ["TASK-001"], "two-tasks.ledger.md");
    await writeFile(join(dir, "loop", "progress.md"), [
      "# Task loop ledger — resumed — plan: /p",
      "TASK-001: developer dispatched model=sonnet @ 2026-11-01T10:00:00+07:00",
      "TASK-001: developer dispatched model=sonnet @ 2026-11-01T10:20:00+07:00",
      "TASK-001: developer done status=DONE @ 2026-11-01T10:30:00+07:00",
      "TASK-001: complete (commits a1b2c3d, review clean) @ 2026-11-01T10:31:00+07:00",
      "",
    ].join("\n"));
    const res = await run(["resumed"], { record: true });
    expect(res.code, res.out).toBe(0);
  });

  it("emits no warning for a clean ledger", async () => {
    const { cmdLoopStats } = await loopStatsCommand();
    expect((await cmdLoopStats(cliArgs(["f"]), root)).stderr).toBeUndefined();
  });
});
