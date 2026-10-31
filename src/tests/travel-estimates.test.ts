import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const SCRIPT = join(PKG_ROOT, "skills", "travel", "scripts", "estimates");
const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap";

function run(...args: string[]): { code: number; out: string[]; err: string } {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: r.stdout.trimEnd().split("\n"), err: r.stderr };
}

function row(date: string, id: string, est: string, actual: string, work: number, files: number, kind = "feature"): string {
  return [date, id, "demo", kind, est, actual, String(work), "0", String(files), "1", "implementation→review", "T1", "0"].join(" · ");
}

const M_WORK = [8, 10, 12, 15, 20, 28, 34, 40];

/** `sRows` small rows first, then the eight M rows whose work 75th percentile is 34. */
function learnedFixture(sRows: number): string {
  const lines = ["# Travel estimates", "", HEADER];
  for (let i = 0; i < sRows; i++) lines.push(row("2026-10-01", `s${i}`, "S", "S", 2, 1));
  M_WORK.forEach((w, i) => lines.push(row("2026-10-02", `m${i}`, "M", "M", w, 6)));
  return `${lines.join("\n")}\n`;
}

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

  it("keeps the defaults below 20 measured rows", async () => {
    const file = await fixture("e.md", learnedFixture(11));
    expect(run("size", "34", "5", file).out).toEqual(["L", "points: 4", "defaults (19 rows measured)"]);
  });

  it("switches to learned thresholds at 20 measured rows", async () => {
    const file = await fixture("e.md", learnedFixture(12));
    expect(run("size", "34", "5", file).out).toEqual(["M", "points: 2", "learned (20 rows)"]);
  });

  it("uses the 75th percentile of each size and keeps the default where a size has too few rows", async () => {
    const file = await fixture("e.md", learnedFixture(17));
    expect(run("size", "34", "5", file).out).toEqual(["M", "points: 2", "learned (25 rows)"]);
    expect(run("size", "35", "5", file).out[0]).toBe("L");
    expect(run("size", "61", "5", file).out[0]).toBe("XL");
  });

  it("learns only from the last 30 measured rows and ignores cancelled ones", async () => {
    const old = Array.from({ length: 10 }, (_, i) => row("2026-09-01", `old${i}`, "M", "M", 59, 6));
    const cancelled = row("2026-10-02", "c1", "M", "-", 500, 99);
    const file = await fixture("e.md", `${HEADER}\n${old.join("\n")}\n${learnedFixture(22)}${cancelled}\n`);
    expect(run("size", "35", "5", file).out).toEqual(["L", "points: 4", "learned (30 rows)"]);
  });

  it("treats a missing estimates file as no history", () => {
    expect(run("size", "12", "4", join(dir, "absent.md")).out).toEqual(["M", "points: 2", "defaults (0 rows measured)"]);
  });

  it.each([
    [["size", "x", "4"], "minutes must be a non-negative number"],
    [["size", "4", "2.5"], "files must be a whole number"],
    [["size", "4"], "usage: estimates size"],
    [["nope"], "usage: estimates size|measure|stats|overlap"],
  ])("rejects bad input %j with exit 1 and a message", (args, message) => {
    const r = run(...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
  });

  it("refuses a malformed ledger row instead of skipping it", async () => {
    const file = await fixture("e.md", `${HEADER}\n2026-10-01 · t1 · demo\n`);
    const r = run("size", "4", "3", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:2: expected 13 fields");
  });

  it("skips only blank lines, # lines and the header, and refuses any other line", async () => {
    const ok = await fixture("ok.md", `# Travel estimates\n\n${HEADER}\n  \n# note\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n`);
    expect(run("size", "4", "3", ok).out[2]).toBe("defaults (1 rows measured)");
    const file = await fixture("e.md", `${HEADER}\n${row("2026/10/01", "a", "M", "M", 10, 4)}\n`);
    const r = run("size", "4", "3", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:2: date must be a real YYYY-MM-DD day: 2026/10/01");
  });

  it("refuses a row whose date is not a real day", async () => {
    const file = await fixture("e.md", `${HEADER}\n${row("2026-10-01", "a", "M", "M", 10, 4)}\n${row("2026-13-40", "b", "M", "M", 10, 4)}\n`);
    const r = run("stats", file);
    expect(r.code).toBe(1);
    expect(r.err).toContain("e.md:3: date must be a real YYYY-MM-DD day: 2026-13-40");
  });

  it("does not drift the learned thresholds down when a stable item is measured again and again", async () => {
    const lines = [HEADER];
    for (let i = 0; i < 12; i++) lines.push(row("2026-10-01", `s${i}`, "S", "S", 2, 1));
    [6, 8, 10, 12, 14, 16, 18, 20].forEach((w, i) => lines.push(row("2026-10-02", `m${i}`, "M", "M", w, 6)));
    const file = await fixture("e.md", `${lines.join("\n")}\n`);
    const threshold = () => Number(/M ≤ (\d+(?:\.\d+)?) min/.exec(run("stats", file).out.find((l) => l.startsWith("sizes:")) ?? "")?.[1]);
    let previous = threshold();
    expect(previous).toBe(18);
    const flags = ["--id", "t", "--feature", "demo", "--kind", "feature", "--est", "M", "--work", "20", "--review", "0",
      "--files", "6", "--rounds", "0", "--path", "implementation→review", "--tier", "T1", "--date", "2026-10-03"];
    for (let k = 0; k < 10; k++) {
      expect(run("measure", "--file", file, ...flags).out[0]).toContain(" · M · M · 20 · ");
      const now = threshold();
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    expect(run("size", "20", "6", file).out[0]).toBe("M");
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
    const flags = [...FLAGS, ...override];
    const r = run("measure", "--file", join(dir, "e.md"), ...flags);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
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

  it("names a kind whose estimates run one size low", async () => {
    const file = await fixture("e.md", [
      HEADER,
      row("2026-10-01", "a", "S", "M", 10, 4, "review"), row("2026-10-01", "b", "S", "M", 10, 4, "review"),
      row("2026-10-02", "c", "M", "L", 30, 4, "review"),
    ].join("\n"));
    expect(run("stats", file).out).toContain("kind review: estimate one size up (mean gap +1.0 over 3 rows)");
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
