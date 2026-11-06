import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const SCRIPT = join(PKG_ROOT, "skills", "travel", "scripts", "estimates");
const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin";
const OLD_HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap";

function run(...args: string[]): { code: number; out: string[]; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: r.stdout.trimEnd().split("\n"), err: r.stderr };
}

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

function factorOf(file: string, kind = "feature"): string {
  const line = run("stats", file).out.find((l) => l.startsWith(`kind ${kind}:`)) ?? "";
  return /factor (\S+)/.exec(line)?.[1] ?? "";
}

const POINTS_OF: Record<string, string> = { S: "points: 1", M: "points: 2", L: "points: 4", XL: "points: 8 (should split)" };

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "kf-estimates-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

async function fixture(name: string, text: string): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, text);
  return file;
}

describe("estimates size", () => {
  it.each([
    ["4", "3", "S", "points: 1"],
    ["12", "4", "M", "points: 2"],
    ["12", "12", "L", "points: 4"],
    ["70", "2", "XL", "points: 8 (should split)"],
    ["30", "31", "XL", "points: 8 (should split)"],
  ])("sizes %s minutes and %s files by the higher of the two defaults", (minutes, files, size, points) => {
    const r = run("size", minutes, files);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([size, points, "defaults (0 rows measured)"]);
  });

  it("keeps the defaults below 20 rows of the kind with estmin", async () => {
    const file = await fixture("e.md", ledger([...ratioRows(19, 10, 20), ...ratioRows(5, 10, 20, "bug", "b")]));
    expect(run("size", "15", "4", file, "feature").out).toEqual(["M", "points: 2", "defaults (19 feature rows with estmin)"]);
  });

  it("corrects estimates up when work runs slower than estimated", async () => {
    const file = await fixture("e.md", ledger(ratioRows(20, 10, 20)));
    expect(run("size", "15", "4", file, "feature").out).toEqual(["L", "points: 4", "learned: 15 min × 2 = 30 min (feature, last 20 rows)"]);
  });

  it("corrects estimates down when work runs faster than estimated", async () => {
    const file = await fixture("e.md", ledger(ratioRows(20, 40, 20)));
    expect(run("size", "30", "4", file, "feature").out).toEqual(["M", "points: 2", "learned: 30 min × 0.5 = 15 min (feature, last 20 rows)"]);
  });

  it("does not correct the files size", async () => {
    const file = await fixture("e.md", ledger(ratioRows(20, 40, 20)));
    expect(run("size", "30", "12", file, "feature").out[0]).toBe("L");
  });

  it("learns per kind: another kind's rows neither count toward the floor nor move the factor", async () => {
    const file = await fixture("e.md", ledger([...ratioRows(20, 10, 30, "bug", "b"), ...ratioRows(20, 10, 10)]));
    expect(run("size", "15", "4", file, "feature").out[2]).toBe("learned: 15 min × 1 = 15 min (feature, last 20 rows)");
    expect(run("size", "15", "4", file, "bug").out).toEqual(["L", "points: 4", "learned: 15 min × 3 = 45 min (bug, last 20 rows)"]);
  });

  it.each([
    ["10", "50", "10", "L", "learned: 10 min × 3 (clamped from 5) = 30 min (feature, last 20 rows)"],
    ["50", "10", "50", "L", "learned: 50 min × 0.5 (clamped from 0.2) = 25 min (feature, last 20 rows)"],
  ])("clamps the factor to 0.5–3 (estmin %s, work %s)", async (estmin, work, minutes, size, line) => {
    const file = await fixture("e.md", ledger(ratioRows(20, Number(estmin), Number(work))));
    expect(run("size", minutes, "2", file, "feature").out).toEqual([size, POINTS_OF[size], line]);
  });

  it("takes the median of the last 30 rows of the kind and ignores cancelled ones", async () => {
    // All 45 rows would give a median of 3; the last 30 hold 20 rows at 1 and 10 at 3.
    const cancelled = row("2026-10-02", "c1", "M", "-", 500, 99, "feature", 1);
    const file = await fixture("e.md", ledger([...ratioRows(25, 10, 30, "feature", "old"), ...ratioRows(20, 10, 10), cancelled]));
    expect(run("size", "15", "4", file, "feature").out[2]).toBe("learned: 15 min × 1 = 15 min (feature, last 30 rows)");
  });

  it("skips rows without estmin for learning, old header and old rows included, without failing", async () => {
    const old = Array.from({ length: 25 }, (_, i) => row("2026-09-01", `old${i}`, "M", "M", 59, 6));
    const file = await fixture("e.md", `# Travel estimates\n\n${OLD_HEADER}\n${old.join("\n")}\n${ratioRows(19, 10, 20).join("\n")}\n`);
    const size = run("size", "15", "4", file, "feature");
    expect(size.code).toBe(0);
    expect(size.out).toEqual(["M", "points: 2", "defaults (19 feature rows with estmin)"]);
    expect(run("stats", file).out).toContain("hit rate: 44/44");
  });

  it("treats a missing estimates file as no history", () => {
    expect(run("size", "12", "4", join(dir, "absent.md"), "feature").out).toEqual(["M", "points: 2", "defaults (0 feature rows with estmin)"]);
  });

  it.each([
    [["size", "x", "4"], "minutes must be a non-negative number"],
    [["size", "4", "2.5"], "files must be a whole number"],
    [["size", "4"], "usage: estimates size"],
    [["size", "4", "3", "e.md"], "usage: estimates size"],
    [["nope"], "usage: estimates size|measure|stats|overlap"],
  ])("rejects bad input %j with exit 1 and a message", (args, message) => {
    const r = run(...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
  });

  it("refuses a malformed ledger row instead of skipping it", async () => {
    const file = await fixture("e.md", `${HEADER}\n2026-10-01 · t1 · demo\n`);
    const r = run("size", "4", "3", file, "feature");
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:2: expected 14 fields");
  });

  it("skips only blank lines, # lines and the header, and refuses any other line", async () => {
    const ok = await fixture("ok.md", `# Travel estimates\n\n${HEADER}\n  \n# note\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n`);
    expect(run("size", "4", "3", ok, "feature").out[2]).toBe("defaults (0 feature rows with estmin)");
    const file = await fixture("e.md", `${HEADER}\n${row("2026/10/01", "a", "M", "M", 10, 4)}\n`);
    const r = run("size", "4", "3", file, "feature");
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:2: date must be a real YYYY-MM-DD day: 2026/10/01");
  });

  it("refuses a row whose date is not a real day", async () => {
    const file = await fixture("e.md", `${HEADER}\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n${row("2026-13-40", "b", "M", "M", 10, 4)}\n`);
    const r = run("stats", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:3: date must be a real YYYY-MM-DD day: 2026-13-40");
  });

  it("refuses an estmin of 0, which has no ratio", async () => {
    const file = await fixture("e.md", ledger([row("2026-10-01", "a", "M", "M", 10, 4, "feature", 0)]));
    const r = run("size", "4", "3", file, "feature");
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:4: estmin must be above 0: 0");
  });

  it("keeps the factor fixed while a stable item is sized and measured again and again", async () => {
    // Work is always 15 for an estimate of 10. Were the corrected 15 recorded as the estimate, the ratio would read 1
    // and the factor would fall back toward 1 as those rows filled the window.
    const file = await fixture("e.md", ledger(ratioRows(20, 10, 15)));
    expect(factorOf(file)).toBe("1.5");
    for (let k = 0; k < 30; k++) {
      const sized = run("size", "10", "4", file, "feature").out;
      expect(sized[2]).toMatch(/^learned: 10 min × 1\.5 = 15 min /);
      const flags = ["--id", `t${k}`, "--feature", "demo", "--kind", "feature", "--est", sized[0], "--estmin", "10", "--work", "15",
        "--review", "0", "--files", "4", "--rounds", "0", "--path", "implementation→review", "--tier", "T1", "--date", "2026-10-03"];
      expect(run("measure", "--file", file, ...flags).out[0]).toMatch(/ · M · M · 15 · .* · 0 · 10$/);
      expect(factorOf(file)).toBe("1.5");
    }
  });
});

describe("estimates measure", () => {
  const FLAGS = ["--id", "t1", "--feature", "demo", "--kind", "feature", "--est", "M", "--work", "14", "--review", "1",
    "--files", "6", "--rounds", "1", "--path", "implementation→review", "--tier", "T1"];

  it("appends one row in field order with actual from work and files, and records a cancelled row as actual -", async () => {
    const file = join(dir, "travel", "estimates.md");
    const first = run("measure", "--file", file, ...FLAGS, "--date", "2026-10-31");
    expect(first.code).toBe(0);
    expect(first.out).toEqual(["2026-10-31 · t1 · demo · feature · M · M · 14 · 1 · 6 · 1 · implementation→review · T1 · 0"]);
    const second = run("measure", "--file", file, ...FLAGS, "--cancelled");
    expect(second.code).toBe(0);
    expect(second.out[0]).toMatch(/^\d{4}-\d{2}-\d{2} · t1 · demo · feature · M · - · 14 · 1 · 6 · 1 · implementation→review · T1 · -$/);
    const text = await readFile(file, "utf8");
    expect(text.split("\n")).toContain(HEADER);
    expect(text.trimEnd().split("\n").slice(-2)).toEqual([first.out[0], second.out[0]]);
    expect(run("stats", file).out).toContain("hit rate: 1/1");
  });

  it("appends estmin as the last field when given and refuses a non-positive one", async () => {
    const file = join(dir, "e.md");
    expect(run("measure", "--file", file, ...FLAGS, "--estmin", "12", "--date", "2026-10-31").out)
      .toEqual(["2026-10-31 · t1 · demo · feature · M · M · 14 · 1 · 6 · 1 · implementation→review · T1 · 0 · 12"]);
    const r = run("measure", "--file", file, ...FLAGS, "--estmin", "0");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--estmin must be above 0");
  });

  it("counts a row measured without estmin in stats but not in the factor", async () => {
    const file = await fixture("e.md", ledger(ratioRows(20, 10, 10)));
    for (let k = 0; k < 20; k++) {
      const flags = FLAGS.map((f) => (f === "t1" ? `n${k}` : f === "14" ? "45" : f));
      expect(run("measure", "--file", file, ...flags, "--date", "2026-10-03").out[0]).toMatch(/ · M · L · 45 · .* · \+1$/);
    }
    const out = run("stats", file).out;
    expect(out).toContain("hit rate: 20/40");
    expect(out).toContain("kind feature: hit rate 20/40, bias +0.5 sizes, factor 1 (median of last 20 rows)");
  });

  it("signs the gap in sizes", async () => {
    const file = join(dir, "e.md");
    const flags = FLAGS.map((f) => (f === "14" ? "45" : f));
    expect(run("measure", "--file", file, ...flags).out[0]).toMatch(/ · M · L · 45 · .* · \+1$/);
  });

  it.each([
    [["--est", "Q"], "--est must be S|M|L|XL"],
    [["--work", "-3"], "--work must be a non-negative number"],
    [["--path", "a · b"], "--path must not contain"],
    [["--date", "31/10/2026"], "--date must be YYYY-MM-DD"],
    [["--date", "2026-02-30"], "--date must be YYYY-MM-DD"],
    [["--bogus", "1"], "unknown flag --bogus"],
  ])("rejects %j", (override, message) => {
    // An override replaces the flag's value; a repeated flag is refused on its own.
    const at = FLAGS.indexOf(override[0]);
    const flags = at === -1 ? [...FLAGS, ...override] : [...FLAGS.slice(0, at), ...override, ...FLAGS.slice(at + 2)];
    const r = run("measure", "--file", join(dir, "e.md"), ...flags);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
  });

  it("refuses a repeated flag and a review share larger than the work", () => {
    const repeated = run("measure", "--file", join(dir, "e.md"), ...FLAGS, "--work", "99");
    expect(repeated.code).toBe(1);
    expect(repeated.err).toContain("--work given more than once");
    const at = FLAGS.indexOf("--review");
    const flags = [...FLAGS.slice(0, at), "--review", "99", ...FLAGS.slice(at + 2)];
    expect(run("measure", "--file", join(dir, "e.md"), ...flags).code).toBe(1);
  });

  it("requires every field", () => {
    const r = run("measure", "--file", join(dir, "e.md"), ...FLAGS.slice(2));
    expect(r.code).toBe(1);
    expect(r.err).toContain("--id is required");
  });
});

describe("estimates stats", () => {
  it("budgets the median daily actual points once three days are measured", async () => {
    const file = await fixture("e.md", [
      HEADER,
      row("2026-10-01", "a", "L", "L", 30, 12), row("2026-10-01", "b", "M", "M", 10, 4),
      row("2026-10-02", "c", "L", "XL", 70, 4), row("2026-10-02", "d", "M", "M", 10, 4),
      row("2026-10-03", "e", "XL", "L", 30, 12), row("2026-10-03", "f", "L", "L", 30, 12),
    ].join("\n"));
    const r = run("stats", file);
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
    const file = await fixture("e.md", [HEADER, row("2026-10-01", "a", "M", "M", 10, 4), row("2026-10-02", "b", "S", "S", 2, 1)].join("\n"));
    const r = run("stats", file);
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
    const r = run("stats", await fixture("e.md", lines.join("\n")));
    expect(r.out).toContain("warning: hit rate fell — this week 2/8, last week 6/8");
  });

  it("reports hit rate, signed bias and the current factor per kind", async () => {
    const file = await fixture("e.md", ledger([
      ...ratioRows(20, 10, 15),
      row("2026-10-01", "a", "S", "M", 10, 4, "bug"), row("2026-10-01", "b", "S", "M", 10, 4, "bug"),
      row("2026-10-02", "c", "M", "M", 10, 4, "bug", 5), row("2026-10-02", "d", "L", "M", 10, 4, "pr", 20),
    ]));
    expect(run("stats", file).out).toEqual(expect.arrayContaining([
      "kind bug: hit rate 1/3, bias +0.7 sizes, factor 1 (defaults — 1 rows with estmin, needs 20)",
      "kind feature: hit rate 20/20, bias 0.0 sizes, factor 1.5 (median of last 20 rows)",
      "kind pr: hit rate 0/1, bias -1.0 sizes, factor 1 (defaults — 1 rows with estmin, needs 20)",
    ]));
  });

  it("names a clamped factor in stats", async () => {
    const file = await fixture("e.md", ledger(ratioRows(20, 10, 50)));
    expect(run("stats", file).out).toContain("kind feature: hit rate 20/20, bias 0.0 sizes, factor 3 (clamped from 5) (median of last 20 rows)");
  });

  it("reports an empty history", () => {
    const r = run("stats", join(dir, "absent.md"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("hit rate: 0/0");
  });
});

describe("estimates overlap", () => {
  it.each([
    ["src/workflow/schema.ts, src/cli/args.ts", "src/cli/args.ts", "sequential"],
    ["src/*", "src/x/y.ts", "sequential"],
    ["src/", "src/x/y.ts", "sequential"],
    ["src/a.ts", "docs/b.md", "parallel"],
    ["src/a*.ts", "src/b.ts", "sequential"],
    ["", "src/a.ts", "sequential"],
  ])("%j vs %j is %s", (a, b, expected) => {
    expect(run("overlap", a, b).out).toEqual([expected]);
  });

  it("needs exactly two cells", () => {
    expect(run("overlap", "src/a.ts").code).toBe(1);
  });
});

describe("estimates measure input checks", () => {
  const flags = (file: string, kind: string) => ["--file", file, "--id", "t1", "--feature", "demo", "--kind", kind, "--est", "M", "--work", "10", "--review", "0", "--files", "2", "--rounds", "1", "--path", "a→b", "--tier", "T1"];

  it("rejects a kind outside feature|bug|pr", async () => {
    const dir = await mkdtemp(join(tmpdir(), "travel-kind-"));
    try {
      const file = join(dir, "estimates.md");
      const r = run("measure", ...flags(file, "featur"));
      expect(r.code).toBe(1);
      expect(r.err).toContain("--kind must be feature|bug|pr");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes the header when the file exists but is empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "travel-empty-"));
    try {
      const file = join(dir, "estimates.md");
      await writeFile(file, "");
      expect(run("measure", ...flags(file, "bug")).code).toBe(0);
      expect(await readFile(file, "utf8")).toContain(`${HEADER}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
