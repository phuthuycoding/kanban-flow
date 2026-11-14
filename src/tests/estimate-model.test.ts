import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure } from "../workflow/features.js";

/*
 * The estimation history merges two sources: the legacy travel ledger (.kf/travel/estimates.md) and the
 * metrics.json of each done item. Expected values follow the estimation rules: sizes S < 5 min / ≤ 3 files,
 * M ≤ 20 / ≤ 10, L ≤ 60 / ≤ 30, else XL, the higher of the two wins; points S 1, M 2, L 4, XL 8; the factor is
 * the median of work ÷ estmin over the last 30 measured rows of a kind, used from 20 rows on, clamped 0.5–3.
 */

const estimateModule = () => import("../workflow/estimate.js");

const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin";

function row(date: string, id: string, est: string, actual: string, work: number, files: number, kind = "feature", estmin?: number): string {
  const cells = [date, id, "demo", kind, est, actual, String(work), "0", String(files), "1", "implementation→review", "T1", "0"];
  return [...cells, ...(estmin === undefined ? [] : [String(estmin)])].join(" · ");
}

let root: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-estimate-model-")));
  ensureWorksStructure(root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function legacy(lines: string[]): Promise<void> {
  await mkdir(join(root, ".kf", "travel"), { recursive: true });
  await writeFile(join(root, ".kf", "travel", "estimates.md"), `# Travel estimates\n\n${HEADER}\n${lines.join("\n")}\n`);
}

interface Done {
  folder: string;
  id: string;
  /** YYYY-MM-DD; the item closes at noon UTC that day. */
  day: string;
  kind?: string;
  estimate: { minutes: number; size: string } | { none: true };
  actual: { size: string; workMinutes: number } | { missing: string };
  files?: number;
}

async function doneItem(d: Done): Promise<void> {
  const dir = join(root, ".works", "done", d.folder);
  await mkdir(dir, { recursive: true });
  const metrics = {
    closedAt: `${d.day}T12:00:00.000Z`,
    id: d.id,
    feature: d.id,
    kind: d.kind ?? "feature",
    estimate: d.estimate,
    actual: d.actual,
    filesChanged: { count: d.files ?? 4 },
  };
  await writeFile(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
}

describe("sizeOf and POINTS", () => {
  it.each([
    [4, 3, "S"],
    [12, 4, "M"],
    [12, 12, "L"],
    [70, 2, "XL"],
    [30, 31, "XL"],
    [5, 1, "M"],
    [60, 30, "L"],
  ])("sizes %s minutes and %s files by the higher of the two", async (minutes, files, size) => {
    const { sizeOf } = await estimateModule();
    expect(sizeOf(minutes, files)).toBe(size);
  });

  it("sizes from the minutes alone when the file count is unknown", async () => {
    const { sizeOf } = await estimateModule();
    expect(sizeOf(4, null)).toBe("S");
    expect(sizeOf(12, null)).toBe("M");
    expect(sizeOf(70, null)).toBe("XL");
  });

  it("gives S 1, M 2, L 4 and XL 8 points", async () => {
    const { POINTS } = await estimateModule();
    expect(POINTS).toEqual({ S: 1, M: 2, L: 4, XL: 8 });
  });
});

describe("readEstimateHistory", () => {
  it("merges legacy and done-item rows by date, legacy rows first on the same day", async () => {
    await legacy([row("2026-10-01", "L1", "M", "M", 10, 4, "feature", 10), row("2026-10-03", "L3", "M", "M", 10, 4, "feature", 10)]);
    // Folder names sort opposite to the close dates, so only a date sort gives the expected order.
    await doneItem({ folder: "a-item", id: "M4", day: "2026-10-04", estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 } });
    await doneItem({ folder: "b-item", id: "M2", day: "2026-10-02", estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 } });
    await doneItem({ folder: "c-item", id: "M1", day: "2026-10-01", estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 } });
    const { readEstimateHistory } = await estimateModule();
    const rows = readEstimateHistory(root);
    expect(rows.map((r) => r.id)).toEqual(["L1", "M1", "M2", "L3", "M4"]);
    expect(rows.map((r) => r.date)).toEqual(["2026-10-01", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  });

  it("does not crash when .works/done is a file: it yields the legacy rows only", async () => {
    await legacy([row("2026-10-01", "L1", "M", "M", 10, 4, "feature", 10)]);
    await rm(join(root, ".works", "done"), { recursive: true, force: true });
    await writeFile(join(root, ".works", "done"), "stray file, not a directory\n");
    const { readEstimateHistory } = await estimateModule();
    expect(readEstimateHistory(root).map((r) => r.id)).toEqual(["L1"]);
  });

  it("dates a done item by the local calendar day of its close, not the UTC day", async () => {
    // Under UTC+7 this instant is already the next calendar day; Node re-reads TZ at Date call time on Linux.
    vi.stubEnv("TZ", "Asia/Ho_Chi_Minh");
    const closedAt = "2026-10-01T20:00:00.000Z";
    const d = new Date(closedAt);
    const p = (n: number): string => String(n).padStart(2, "0");
    const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    expect(local).toBe("2026-10-02");
    expect(local).not.toBe(closedAt.slice(0, 10));
    const dir = join(root, ".works", "done", "late-item");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "metrics.json"), JSON.stringify({
      closedAt, id: "LATE", feature: "late", kind: "feature",
      estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 }, filesChanged: { count: 4 },
    }));
    const { readEstimateHistory } = await estimateModule();
    expect(readEstimateHistory(root).map((r) => r.date)).toEqual([local]);
  });

  it("keeps the learned factor stable as items approved with raw minutes close", async () => {
    // metrics.json carries the raw estimate minutes (what approval recorded), never the factor-corrected ones.
    const { readEstimateHistory, factorFor } = await estimateModule();
    const close = async (from: number, to: number): Promise<void> => {
      for (let i = from; i < to; i++) {
        await doneItem({ folder: `it-${i}`, id: `D${i}`, day: "2026-10-05", estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 15 } });
      }
    };
    await close(0, 20);
    let rows = readEstimateHistory(root);
    expect(rows.every((r) => r.estMinutes === 10)).toBe(true);
    expect(factorFor(rows, "feature")).toMatchObject({ usable: 20, factor: 1.5, raw: 1.5 });
    await close(20, 40);
    rows = readEstimateHistory(root);
    expect(rows.every((r) => r.estMinutes === 10)).toBe(true);
    expect(factorFor(rows, "feature")).toMatchObject({ usable: 40, factor: 1.5, raw: 1.5, window: 30 });
  });

  it("returns no rows when neither source exists", async () => {
    const { readEstimateHistory } = await estimateModule();
    expect(readEstimateHistory(root)).toEqual([]);
  });

  it("throws EstimateHistoryError naming file and line for a malformed legacy row", async () => {
    await mkdir(join(root, ".kf", "travel"), { recursive: true });
    await writeFile(join(root, ".kf", "travel", "estimates.md"), `${HEADER}\n2026-10-01 · t1 · demo\n`);
    const { readEstimateHistory, EstimateHistoryError } = await estimateModule();
    let thrown: unknown;
    try {
      readEstimateHistory(root);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EstimateHistoryError);
    expect((thrown as Error).message).toContain("estimates.md:2: expected 14 fields");
  });
});

describe("factorFor over the merged history", () => {
  it("takes the median of the last 30 rows of the kind across both sources", async () => {
    // 25 legacy rows at ratio 3 come first by date, then 20 done items at ratio 1: 45 rows in all.
    // The whole history would give a median of 3; the last 30 hold 10 at 3 and 20 at 1, so the median is 1.
    await legacy(Array.from({ length: 25 }, (_, i) => row("2026-10-01", `old${i}`, "M", "L", 30, 4, "feature", 10)));
    for (let i = 0; i < 20; i++) {
      await doneItem({
        folder: `item-${String(i).padStart(2, "0")}`, id: `new${i}`, day: `2026-10-${String(5 + i).padStart(2, "0")}`,
        estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 },
      });
    }
    const { readEstimateHistory, factorFor } = await estimateModule();
    expect(factorFor(readEstimateHistory(root), "feature")).toMatchObject({ usable: 45, factor: 1, raw: 1, window: 30 });
  });

  it("keeps the factor at 1 below 20 rows of the kind", async () => {
    for (let i = 0; i < 19; i++) {
      await doneItem({
        folder: `item-${i}`, id: `n${i}`, day: "2026-10-02",
        estimate: { minutes: 10, size: "M" }, actual: { size: "L", workMinutes: 30 },
      });
    }
    const { readEstimateHistory, factorFor } = await estimateModule();
    expect(factorFor(readEstimateHistory(root), "feature")).toMatchObject({ usable: 19, factor: 1, raw: null });
  });

  it("clamps the factor to 3 and keeps the raw median", async () => {
    for (let i = 0; i < 20; i++) {
      await doneItem({
        folder: `item-${i}`, id: `n${i}`, day: "2026-10-02",
        estimate: { minutes: 10, size: "M" }, actual: { size: "L", workMinutes: 50 },
      });
    }
    const { readEstimateHistory, factorFor } = await estimateModule();
    expect(factorFor(readEstimateHistory(root), "feature")).toMatchObject({ usable: 20, factor: 3, raw: 5, window: 20 });
  });

  it("clamps the factor to 0.5 and keeps the raw median", async () => {
    for (let i = 0; i < 20; i++) {
      await doneItem({
        folder: `item-${i}`, id: `n${i}`, day: "2026-10-02",
        estimate: { minutes: 50, size: "L" }, actual: { size: "M", workMinutes: 10 },
      });
    }
    const { readEstimateHistory, factorFor } = await estimateModule();
    expect(factorFor(readEstimateHistory(root), "feature")).toMatchObject({ usable: 20, factor: 0.5, raw: 0.2, window: 20 });
  });

  it("does not learn from another kind's rows", async () => {
    for (let i = 0; i < 20; i++) {
      await doneItem({
        folder: `bug-${i}`, id: `b${i}`, day: "2026-10-02", kind: "bug",
        estimate: { minutes: 10, size: "M" }, actual: { size: "L", workMinutes: 30 },
      });
    }
    const { readEstimateHistory, factorFor } = await estimateModule();
    const rows = readEstimateHistory(root);
    expect(factorFor(rows, "feature")).toMatchObject({ usable: 0, factor: 1, raw: null });
    expect(factorFor(rows, "bug")).toMatchObject({ usable: 20, factor: 3, raw: 3, window: 20 });
  });
});

describe("statsLines and sizeLines over the merged history", () => {
  it("counts a measurement without an estimate toward budget and throughput only, and leaves out one without an actual size", async () => {
    await doneItem({ folder: "a", id: "A", day: "2026-10-01", estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 10 } });
    await doneItem({ folder: "b", id: "B", day: "2026-10-02", estimate: { none: true }, actual: { size: "L", workMinutes: 30 } });
    await doneItem({ folder: "c", id: "C", day: "2026-10-03", estimate: { minutes: 3, size: "S" }, actual: { size: "S", workMinutes: 3 }, files: 1 });
    // Had this one counted, it would add a fourth day and change the budget.
    await doneItem({ folder: "d", id: "D", day: "2026-10-04", estimate: { minutes: 10, size: "M" }, actual: { missing: "no work time recorded" } });
    const { readEstimateHistory, statsLines } = await estimateModule();
    expect(statsLines(readEstimateHistory(root))).toEqual([
      "budget: 2 points (median of 3 days)",
      "hit rate: 2/2",
      "bias: 0 over, 0 under",
      "throughput: 7 points / 3 days",
      "calibration: budget = median daily actual points of 2026-10-01 (2), 2026-10-02 (4), 2026-10-03 (1)",
      "kind feature: hit rate 2/2, bias 0.0 sizes, factor 1 (defaults — 2 rows with estmin, needs 20)",
    ]);
  });

  it("sizes against the learned factor of the merged history", async () => {
    for (let i = 0; i < 20; i++) {
      await doneItem({
        folder: `item-${i}`, id: `n${i}`, day: "2026-10-02",
        estimate: { minutes: 10, size: "M" }, actual: { size: "M", workMinutes: 20 },
      });
    }
    const { readEstimateHistory, sizeLines } = await estimateModule();
    expect(sizeLines(15, 4, readEstimateHistory(root), "feature")).toEqual(["L", "points: 4", "learned: 15 min × 2 = 30 min (feature, last 20 rows)"]);
  });
});
