import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureWorksStructure } from "../workflow/features.js";
import { filesOverlap } from "../workflow/allowlist.js";

/*
 * `kf estimate size|stats|overlap` must print the lines and exit code the travel `estimates` script printed
 * for the same inputs. The cases and expected strings below are the script's own pinned cases, carried over
 * verbatim; the only difference is that the history is no longer a path argument: `kf estimate` reads the
 * legacy ledger from <root>/.kf/travel/estimates.md (plus done items' metrics.json) by itself.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");
const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin";
const OLD_HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap";

/** A ledger row; without `estmin` it is the 13-field shape written before estmin existed. */
function row(date: string, id: string, est: string, actual: string, work: number, files: number, kind = "feature", estmin?: number): string {
  const cells = [date, id, "demo", kind, est, actual, String(work), "0", String(files), "1", "implementation→review", "T1", "0"];
  return [...cells, ...(estmin === undefined ? [] : [String(estmin)])].join(" · ");
}

/** `n` measured rows of `kind` whose work ÷ estmin is `work / estmin`. */
function ratioRows(n: number, estmin: number, work: number, kind = "feature", prefix = "r"): string[] {
  return Array.from({ length: n }, (_, i) => row("2026-10-02", `${prefix}${i}`, "M", "M", work, 4, kind, estmin));
}

function ledger(lines: string[]): string {
  return `# Travel estimates\n\n${HEADER}\n${lines.join("\n")}\n`;
}

const POINTS_OF: Record<string, string> = { S: "points: 1", M: "points: 2", L: "points: 4", XL: "points: 8 (should split)" };

let root: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-estimate-cli-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261101_0900", defaultContext: "app" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Writes the legacy ledger where `kf estimate` reads it. */
async function legacy(text: string): Promise<void> {
  await mkdir(join(root, ".kf", "travel"), { recursive: true });
  await writeFile(join(root, ".kf", "travel", "estimates.md"), text);
}

function kf(...args: string[]): { code: number; out: string[]; all: string } {
  const r = spawnSync(process.execPath, [CLI, "estimate", ...args], { cwd: root, encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: r.stdout.trimEnd().split("\n"), all: `${r.stdout}${r.stderr}` };
}

function factorOf(kind = "feature"): string {
  const line = kf("stats").out.find((l) => l.startsWith(`kind ${kind}:`)) ?? "";
  return /factor (\S+)/.exec(line)?.[1] ?? "";
}

describe("kf estimate size", () => {
  it.each([
    ["4", "3", "S", "points: 1"],
    ["12", "4", "M", "points: 2"],
    ["12", "12", "L", "points: 4"],
    ["70", "2", "XL", "points: 8 (should split)"],
    ["30", "31", "XL", "points: 8 (should split)"],
  ])("sizes %s minutes and %s files by the higher of the two defaults", (minutes, files, size, points) => {
    const r = kf("size", minutes, files);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([size, points, "defaults (0 rows measured)"]);
  });

  it("prints the defaults line without --kind even when history would teach a factor", async () => {
    await legacy(ledger(ratioRows(20, 10, 20)));
    const r = kf("size", "15", "4");
    expect(r.code).toBe(0);
    expect(r.out).toEqual(["M", "points: 2", "defaults (0 rows measured)"]);
  });

  it.each([
    ["4", "S", "points: 1"],
    ["12", "M", "points: 2"],
    ["70", "XL", "points: 8 (should split)"],
  ])("sizes %s minutes with unknown files from the minutes alone", (minutes, size, points) => {
    const r = kf("size", minutes, "unknown");
    expect(r.code).toBe(0);
    expect(r.out).toEqual([size, points, "defaults (0 rows measured)"]);
  });

  it("keeps the defaults below 20 rows of the kind with estmin", async () => {
    await legacy(ledger([...ratioRows(19, 10, 20), ...ratioRows(5, 10, 20, "bug", "b")]));
    expect(kf("size", "15", "4", "--kind", "feature").out).toEqual(["M", "points: 2", "defaults (19 feature rows with estmin)"]);
  });

  it("corrects estimates up when work runs slower than estimated", async () => {
    await legacy(ledger(ratioRows(20, 10, 20)));
    expect(kf("size", "15", "4", "--kind", "feature").out).toEqual(["L", "points: 4", "learned: 15 min × 2 = 30 min (feature, last 20 rows)"]);
  });

  it("corrects estimates down when work runs faster than estimated", async () => {
    await legacy(ledger(ratioRows(20, 40, 20)));
    expect(kf("size", "30", "4", "--kind", "feature").out).toEqual(["M", "points: 2", "learned: 30 min × 0.5 = 15 min (feature, last 20 rows)"]);
  });

  it("does not correct the files size", async () => {
    await legacy(ledger(ratioRows(20, 40, 20)));
    expect(kf("size", "30", "12", "--kind", "feature").out[0]).toBe("L");
  });

  it("learns per kind: another kind's rows neither count toward the floor nor move the factor", async () => {
    await legacy(ledger([...ratioRows(20, 10, 30, "bug", "b"), ...ratioRows(20, 10, 10)]));
    expect(kf("size", "15", "4", "--kind", "feature").out[2]).toBe("learned: 15 min × 1 = 15 min (feature, last 20 rows)");
    expect(kf("size", "15", "4", "--kind", "bug").out).toEqual(["L", "points: 4", "learned: 15 min × 3 = 45 min (bug, last 20 rows)"]);
  });

  it.each([
    ["10", "50", "10", "L", "learned: 10 min × 3 (clamped from 5) = 30 min (feature, last 20 rows)"],
    ["50", "10", "50", "L", "learned: 50 min × 0.5 (clamped from 0.2) = 25 min (feature, last 20 rows)"],
  ])("clamps the factor to 0.5–3 (estmin %s, work %s)", async (estmin, work, minutes, size, line) => {
    await legacy(ledger(ratioRows(20, Number(estmin), Number(work))));
    expect(kf("size", minutes, "2", "--kind", "feature").out).toEqual([size, POINTS_OF[size], line]);
  });

  it("takes the median of the last 30 rows of the kind and ignores cancelled ones", async () => {
    // All 45 rows would give a median of 3; the last 30 hold 20 rows at 1 and 10 at 3.
    const cancelled = row("2026-10-02", "c1", "M", "-", 500, 99, "feature", 1);
    await legacy(ledger([...ratioRows(25, 10, 30, "feature", "old"), ...ratioRows(20, 10, 10), cancelled]));
    expect(kf("size", "15", "4", "--kind", "feature").out[2]).toBe("learned: 15 min × 1 = 15 min (feature, last 30 rows)");
  });

  it("skips rows without estmin for learning, old header and old rows included, without failing", async () => {
    const old = Array.from({ length: 25 }, (_, i) => row("2026-09-01", `old${i}`, "M", "M", 59, 6));
    await legacy(`# Travel estimates\n\n${OLD_HEADER}\n${old.join("\n")}\n${ratioRows(19, 10, 20).join("\n")}\n`);
    const size = kf("size", "15", "4", "--kind", "feature");
    expect(size.code).toBe(0);
    expect(size.out).toEqual(["M", "points: 2", "defaults (19 feature rows with estmin)"]);
    expect(kf("stats").out).toContain("hit rate: 44/44");
  });

  it("treats a missing estimates file as no history", () => {
    expect(kf("size", "12", "4", "--kind", "feature").out).toEqual(["M", "points: 2", "defaults (0 feature rows with estmin)"]);
  });

  it("reads the factor from the history in a stable way across repeated sizing", async () => {
    // Work is always 15 for an estimate of 10, so the factor reads 1.5 however often the item is sized.
    await legacy(ledger(ratioRows(20, 10, 15)));
    expect(factorOf()).toBe("1.5");
    for (let k = 0; k < 3; k++) {
      expect(kf("size", "10", "4", "--kind", "feature").out[2]).toMatch(/^learned: 10 min × 1\.5 = 15 min /);
    }
    expect(factorOf()).toBe("1.5");
  });

  it.each([
    [["size", "x", "4"], "minutes must be a non-negative number"],
    [["size", "4", "2.5"], "files must be a whole number"],
    [["size", "4"], "usage: estimates size"],
    [["size", "4", "3", "extra"], "usage: estimates size"],
    [["size", "4", "3", "--kind", "featur"], "kind must be feature|bug|pr"],
    [["nope"], "usage: estimates size"],
  ])("rejects bad input %j with exit 1 and a message", (args, message) => {
    const r = kf(...args);
    expect(r.code).toBe(1);
    expect(r.all).toContain(message);
  });

  it("refuses a malformed ledger row instead of skipping it", async () => {
    await legacy(`${HEADER}\n2026-10-01 · t1 · demo\n`);
    const r = kf("size", "4", "3", "--kind", "feature");
    expect(r.code).toBe(1);
    expect(r.all).toContain("estimates.md:2: expected 14 fields");
  });

  it("skips only blank lines, # lines and the header, and refuses any other line", async () => {
    await legacy(`# Travel estimates\n\n${HEADER}\n  \n# note\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n`);
    expect(kf("size", "4", "3", "--kind", "feature").out[2]).toBe("defaults (0 feature rows with estmin)");
    await legacy(`${HEADER}\n${row("2026/10/01", "a", "M", "M", 10, 4)}\n`);
    const r = kf("size", "4", "3", "--kind", "feature");
    expect(r.code).toBe(1);
    expect(r.all).toContain("estimates.md:2: date must be a real YYYY-MM-DD day: 2026/10/01");
  });

  it("refuses a row whose date is not a real day", async () => {
    await legacy(`${HEADER}\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n${row("2026-13-40", "b", "M", "M", 10, 4)}\n`);
    const r = kf("stats");
    expect(r.code).toBe(1);
    expect(r.all).toContain("estimates.md:3: date must be a real YYYY-MM-DD day: 2026-13-40");
  });

  it("refuses an estmin of 0, which has no ratio", async () => {
    await legacy(ledger([row("2026-10-01", "a", "M", "M", 10, 4, "feature", 0)]));
    const r = kf("size", "4", "3", "--kind", "feature");
    expect(r.code).toBe(1);
    expect(r.all).toContain("estimates.md:4: estmin must be above 0: 0");
  });
});

describe("kf estimate stats", () => {
  it("budgets the median daily actual points once three days are measured", async () => {
    await legacy([
      HEADER,
      row("2026-10-01", "a", "L", "L", 30, 12), row("2026-10-01", "b", "M", "M", 10, 4),
      row("2026-10-02", "c", "L", "XL", 70, 4), row("2026-10-02", "d", "M", "M", 10, 4),
      row("2026-10-03", "e", "XL", "L", 30, 12), row("2026-10-03", "f", "L", "L", 30, 12),
    ].join("\n"));
    const r = kf("stats");
    expect(r.code).toBe(0);
    expect(r.out).toEqual(expect.arrayContaining([
      "budget: 8 points (median of 3 days)",
      "hit rate: 4/6",
      "bias: 1 over, 1 under",
      "throughput: 24 points / 3 days",
    ]));
    const calibration = r.out.find((l) => l.startsWith("calibration:")) ?? "";
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) expect(calibration).toContain(d);
  });

  it("falls back to 10 tasks and no calibration below three days", async () => {
    await legacy([HEADER, row("2026-10-01", "a", "M", "M", 10, 4), row("2026-10-02", "b", "S", "S", 2, 1)].join("\n"));
    const r = kf("stats");
    expect(r.out[0]).toBe("budget: 10 tasks (default — fewer than 3 days measured)");
    expect(r.out).toContain("calibration: none yet");
    expect(r.out.some((l) => l.startsWith("warning:"))).toBe(false);
  });

  it("warns when this week's hit rate is below last week's", async () => {
    const lines = [HEADER];
    const week = (firstDay: number, hits: number) => {
      for (let k = 0; k < 8; k++) {
        const date = `2026-10-${String(firstDay + (k % 7)).padStart(2, "0")}`;
        lines.push(row(date, `t${firstDay}-${k}`, "M", k < hits ? "M" : "L", 10, 4));
      }
    };
    week(1, 6);
    week(8, 2);
    await legacy(lines.join("\n"));
    expect(kf("stats").out).toContain("warning: hit rate fell — this week 2/8, last week 6/8");
  });

  it("reports hit rate, signed bias and the current factor per kind", async () => {
    await legacy(ledger([
      ...ratioRows(20, 10, 15),
      row("2026-10-01", "a", "S", "M", 10, 4, "bug"), row("2026-10-01", "b", "S", "M", 10, 4, "bug"),
      row("2026-10-02", "c", "M", "M", 10, 4, "bug", 5), row("2026-10-02", "d", "L", "M", 10, 4, "pr", 20),
    ]));
    expect(kf("stats").out).toEqual(expect.arrayContaining([
      "kind bug: hit rate 1/3, bias +0.7 sizes, factor 1 (defaults — 1 rows with estmin, needs 20)",
      "kind feature: hit rate 20/20, bias 0.0 sizes, factor 1.5 (median of last 20 rows)",
      "kind pr: hit rate 0/1, bias -1.0 sizes, factor 1 (defaults — 1 rows with estmin, needs 20)",
    ]));
  });

  it("names a clamped factor in stats", async () => {
    await legacy(ledger(ratioRows(20, 10, 50)));
    expect(kf("stats").out).toContain("kind feature: hit rate 20/20, bias 0.0 sizes, factor 3 (clamped from 5) (median of last 20 rows)");
  });

  it("reports an empty history", () => {
    const r = kf("stats");
    expect(r.code).toBe(0);
    expect(r.out).toContain("hit rate: 0/0");
  });

  it("refuses a malformed legacy ledger with exit 1 naming file and line", async () => {
    await legacy(`${HEADER}\n2026-10-01 · t1 · demo\n`);
    const r = kf("stats");
    expect(r.code).toBe(1);
    expect(r.all).toContain("estimates.md:2: expected 14 fields");
  });
});

describe("kf estimate overlap", () => {
  it.each([
    ["src/workflow/schema.ts, src/cli/args.ts", "src/cli/args.ts", "sequential"],
    ["src/*", "src/x/y.ts", "sequential"],
    ["src/", "src/x/y.ts", "sequential"],
    ["src/a.ts", "docs/b.md", "parallel"],
    ["src/a*.ts", "src/b.ts", "sequential"],
    ["", "src/a.ts", "sequential"],
  ])("%j vs %j is %s", (a, b, expected) => {
    const r = kf("overlap", a, b);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([expected]);
  });

  it("needs exactly two cells", () => {
    const r = kf("overlap", "src/a.ts");
    expect(r.code).toBe(1);
    expect(r.all).toContain("usage: estimates overlap");
  });

  const CASES: Array<[string[], string[]]> = [
    [["src/a.ts"], ["src/a.ts"]],
    [["src/a.ts"], ["src/b.ts"]],
    [["src/**"], ["src/cli/x.ts"]],
    [["src/cli/*.ts"], ["src/workflow/*.ts"]],
    [["src/cli/*.ts"], ["src/cli/commands/x.ts"]],
    [["./src/a.ts"], ["src/a.ts"]],
    [["src/"], ["src/a.ts"]],
    [["`src/a.ts`"], ["docs/a.md"]],
    [["**"], ["docs/a.md"]],
    [["*"], ["docs/a.md"]],
    [["."], ["docs/a.md"]],
    [["src/ab.ts"], ["src/a"]],
    [["docs/a.md", "src/a.ts"], ["tests/b.ts", "src/*.ts"]],
    [["docs/a.md", "src/a.ts"], ["tests/b.ts", "lib/c.ts"]],
    [["src/[ab].ts"], ["src/a.ts"]],
    [["src/a?.ts"], ["docs/x.md"]],
  ];

  it.each(CASES)("agrees with the scheduler for %j vs %j", (a, b) => {
    const r = kf("overlap", a.join(","), b.join(","));
    expect(r.code).toBe(0);
    const strip = (list: string[]) => list.map((p) => p.replace(/`/g, ""));
    expect(r.out).toEqual([filesOverlap(strip(a), strip(b)) ? "sequential" : "parallel"]);
  });
});
