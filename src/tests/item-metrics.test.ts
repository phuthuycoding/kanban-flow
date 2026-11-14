import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { linkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { measureItem, writeItemMetrics } from "../workflow/item-metrics.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";

/*
 * Every expected figure is computed by hand from the fixture times below (all UTC, 2026-11-01):
 *   brainstorm 09:00 → planning 09:10 → implementation 09:30 → testing 09:40 → review 09:45 → delivered 10:05
 *   review PASS report created 09:50 (written as local time)
 *   brainstorm 10 min, planning 20, implementation 10, testing 5, review 20 (until delivered)
 *   work = implementation entry 09:30 → created 09:50 = 20 min; 4 files → M by minutes and by files
 *   estimate S → gap = index(M) − index(S) = 1
 *   merge gate = created 09:50 → delivered 10:05 = 15 min, approximate
 *   ledger: seats 3 + 6 + 4 = 13 min, one fix round, models opus and sonnet
 */

const FEATURE = "f";
const FOLDER = "f_20261101_0900";
const at = (hhmm: string): string => `2026-11-01T${hhmm}:00.000Z`;

/** The review report's `created` stamp is local time, so it is built from the local fields of the instant. */
function localStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

interface Rec { at: string; event: string; stage: string }

const ESTIMATE_S = { minutes: 10, files: null, filesMark: "unknown", size: "S", factor: 1, at: at("09:25") };

const STANDARD_TIMELINE: Rec[] = [
  { at: at("09:00"), event: "created", stage: "brainstorm" },
  { at: at("09:10"), event: "stage", stage: "planning" },
  { at: at("09:30"), event: "stage", stage: "implementation" },
  { at: at("09:40"), event: "stage", stage: "testing" },
  { at: at("09:45"), event: "stage", stage: "review" },
  { at: at("10:05"), event: "delivered", stage: "done" },
];

const LEDGER_LINES = [
  "# Task loop ledger — f",
  `TASK-001: test-writer dispatched model=opus @ ${at("09:31")}`,
  `TASK-001: test-writer done status=DONE @ ${at("09:34")}`,
  `TASK-001: developer dispatched model=sonnet @ ${at("09:34")}`,
  `TASK-001: developer done status=DONE @ ${at("09:40")}`,
  `TASK-001: code-reviewer dispatched model=opus @ ${at("09:40")}`,
  `TASK-001: code-reviewer done status=DONE @ ${at("09:44")}`,
  `TASK-001: fix round 1/5 (review finding) @ ${at("09:44")}`,
  `TASK-001: complete (all green) @ ${at("09:45")}`,
];
const ledgerText = (lines: string[]): string => `${lines.join("\n")}\n`.replace(/\.000Z/g, "Z");

const reportText = (created: string, tierRow: boolean): string =>
  `---\nfeature: "${FEATURE}"\ncontext: "app"\ncreated: "${localStamp(created)}"\nstatus: PASS\nci: none\nlanding: none\n---\n# Review Report\n\n## Reviewer\n\n| Field | Result |\n|---|---|\n${tierRow ? "| Tier and reason | standard — one module touched |\n" : ""}| Review pack | none |\n`;

interface Fixture {
  timeline?: Rec[] | null;
  ledger?: string | null;
  reviewCreated?: string | null;
  tierRow?: boolean;
  estimate?: object | null;
  filesChanged?: object | null;
}

let root: string;

async function seed(f: Fixture): Promise<void> {
  const dir = join(root, ".works", "done", FOLDER);
  await mkdir(dir, { recursive: true });
  const meta: Record<string, unknown> = {
    schema: "kanban-flow", feature: FEATURE, context: "app", created: "20261101_0900", kind: "feature",
    id: "0b6f6b1e-5a3c-4d7e-9a55-1c2d3e4f5a6b", delivered: true,
  };
  if (f.estimate !== null) meta.estimate = f.estimate ?? ESTIMATE_S;
  if (f.filesChanged !== null) meta.filesChanged = f.filesChanged ?? { count: 4, at: at("09:45") };
  await writeFile(join(dir, METADATA_FILE), JSON.stringify(meta));
  const timeline = f.timeline === undefined ? STANDARD_TIMELINE : f.timeline;
  if (timeline !== null) {
    const lines = timeline.map((r, i) => JSON.stringify({
      v: 1, at: r.at, actor: "tester", origin: { machine: "m1", via: "cli" }, event: r.event, stage: r.stage,
      ...(i === 0 ? { set: { schema: "kanban-flow", feature: FEATURE, context: "app", created: "20261101_0900" } } : {}),
    }));
    await writeFile(join(dir, "lifecycle.jsonl"), `${lines.join("\n")}\n`);
  }
  if (f.ledger !== null && f.ledger !== undefined) {
    await mkdir(join(dir, "loop"), { recursive: true });
    await writeFile(join(dir, "loop", "progress.md"), f.ledger);
  }
  const created = f.reviewCreated === undefined ? at("09:50") : f.reviewCreated;
  if (created !== null) await writeFile(join(dir, ARTIFACTS["review-report"].file), reportText(created, f.tierRow ?? true));
}

/** Every number anywhere in the measurement. */
function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(numbers);
  return [];
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-item-metrics-"));
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("measureItem — a complete item", () => {
  it("measures the estimate, actual size, gap, stage times, gates, ledger, files, tier and path", async () => {
    await seed({ ledger: ledgerText(LEDGER_LINES) });
    const m = await measureItem(root, FEATURE);

    expect(m).toMatchObject({ v: 1, id: "0b6f6b1e-5a3c-4d7e-9a55-1c2d3e4f5a6b", feature: FEATURE, kind: "feature" });
    expect(typeof m.closedAt).toBe("string");
    expect(m.estimate).toMatchObject({ minutes: 10, size: "S" });
    expect(m.actual).toEqual({ size: "M", workMinutes: 20 });
    expect(m.gap).toBe(1);
    expect(m.stages).toContainEqual({ stage: "brainstorm", minutes: 10 });
    expect(m.stages).toContainEqual({ stage: "planning", minutes: 20 });
    expect(m.stages).toContainEqual({ stage: "implementation", minutes: 10 });
    expect(m.stages).toContainEqual({ stage: "testing", minutes: 5 });
    expect(m.stages).toContainEqual({ stage: "review", minutes: 20 });
    expect(m.path).toEqual(["brainstorm", "planning", "implementation", "testing", "review", "done"]);
    expect(m.gates.requirement).toEqual({ minutes: 10 });
    expect(m.gates.plan).toEqual({ minutes: 20 });
    expect(m.gates.merge).toEqual({ minutes: 15, approximate: true });
    expect(m.ledger).toMatchObject({ rounds: 1, seatMinutes: 13 });
    expect(JSON.stringify(m.ledger.models)).toContain("opus");
    expect(JSON.stringify(m.ledger.models)).toContain("sonnet");
    expect(m.filesChanged).toEqual({ count: 4 });
    expect(m.tier).toContain("standard");
  });

  it("keeps nothing machine-local in the measurement", async () => {
    await seed({ ledger: ledgerText(LEDGER_LINES) });
    const text = JSON.stringify(await measureItem(root, FEATURE));
    expect(text).not.toContain(root);
    expect(text).not.toContain("m1");
    expect(text).not.toContain("worktree");
  });

  it("leaves backlog time out of the work minutes and reports it as its own stage", async () => {
    await seed({
      ledger: ledgerText(LEDGER_LINES),
      filesChanged: { count: 2, at: at("09:58") },
      reviewCreated: at("10:00"),
      timeline: [
        { at: at("09:00"), event: "created", stage: "brainstorm" },
        { at: at("09:10"), event: "stage", stage: "planning" },
        { at: at("09:30"), event: "stage", stage: "implementation" },
        { at: at("09:36"), event: "stage", stage: "backlog" },
        { at: at("09:46"), event: "stage", stage: "implementation" },
        { at: at("09:58"), event: "stage", stage: "review" },
        { at: at("10:20"), event: "delivered", stage: "done" },
      ],
    });
    const m = await measureItem(root, FEATURE);
    // 09:30 → 10:00 is 30 min, 10 of them in backlog: 20 min is M, 30 min would be L.
    expect(m.actual).toEqual({ size: "M", workMinutes: 20 });
    expect(m.stages).toContainEqual({ stage: "backlog", minutes: 10 });
  });
});

describe("measureItem — figures it cannot take", () => {
  it("names a missing ledger and keeps the figures that do not need it", async () => {
    await seed({ ledger: null });
    const m = await measureItem(root, FEATURE);
    expect(m.ledger).toHaveProperty("missing");
    expect(String((m.ledger as { missing: unknown }).missing)).toContain("no ledger");
    expect(m.ledger).not.toHaveProperty("rounds");
    expect(m.actual).toEqual({ size: "M", workMinutes: 20 });
  });

  it("takes rounds from the good ledger lines and names the broken one", async () => {
    const lines = [...LEDGER_LINES];
    // Line 9 of the file (the complete line moves to 10) is a typo that fails the ledger grammar.
    lines.splice(8, 0, `TASK-001: developer dispatchd model=opus @ ${at("09:45")}`);
    await seed({ ledger: ledgerText(lines) });
    const m = await measureItem(root, FEATURE);
    expect(m.ledger).not.toHaveProperty("missing");
    expect(m.ledger).toMatchObject({ rounds: 1, seatMinutes: 13 });
    expect(m.ledger.unparsedLines).toEqual([9]);
  });

  it("reports no seat time instead of 0 when the ledger has no seat lines", async () => {
    await seed({ ledger: ledgerText(["# Task loop ledger — f", `TASK-001: fix round 1/5 (review finding) @ ${at("09:44")}`, `TASK-001: complete (done) @ ${at("09:45")}`]) });
    const m = await measureItem(root, FEATURE);
    expect(m.ledger).toMatchObject({ rounds: 1, seatMinutes: { missing: "no seat time recorded" } });
  });

  it("reports the models as missing, not as an empty list, when the ledger recorded no seat time", async () => {
    await seed({ ledger: ledgerText(["# Task loop ledger — f", `TASK-001: fix round 1/5 (review finding) @ ${at("09:44")}`, `TASK-001: complete (done) @ ${at("09:45")}`]) });
    const m = await measureItem(root, FEATURE);
    expect(m.ledger.models).toEqual({ missing: "no seat time recorded" });
  });

  it("reports the path as missing with the reason, not as an empty list, when there is no lifecycle log", async () => {
    await seed({ timeline: null, ledger: ledgerText(LEDGER_LINES) });
    const m = await measureItem(root, FEATURE);
    expect(m.path).toEqual({ missing: "no lifecycle log" });
  });

  it("marks stage times, gates, actual size and gap missing when there is no lifecycle log, and the estimate none", async () => {
    await seed({ timeline: null, ledger: ledgerText(LEDGER_LINES), estimate: null });
    const m = await measureItem(root, FEATURE);
    expect(JSON.stringify(m.stages)).toContain("missing");
    expect(JSON.stringify(m.stages)).not.toContain("minutes");
    for (const gate of [m.gates.requirement, m.gates.plan, m.gates.merge]) expect(gate).toHaveProperty("missing");
    expect(m.actual).toHaveProperty("missing");
    expect(m.gap).toHaveProperty("missing");
    expect(m.estimate).toMatchObject({ none: true });
    expect(m.ledger).toMatchObject({ rounds: 1, seatMinutes: 13 });
  });

  it("marks the file count missing with a reason when it was not counted, and sizes from the minutes alone", async () => {
    await seed({ filesChanged: { count: null, reason: "no default branch to count against", at: at("09:45") } });
    const m = await measureItem(root, FEATURE);
    const files = m.filesChanged as { missing?: unknown };
    expect(typeof files.missing).toBe("string");
    expect((files.missing as string).length).toBeGreaterThan(0);
    expect(m.actual).toEqual({ size: "M", workMinutes: 20 });
  });

  it("marks the tier missing when the review report has no tier row", async () => {
    await seed({ tierRow: false });
    const m = await measureItem(root, FEATURE);
    expect(m.tier).toHaveProperty("missing");
  });

  it("marks the merge gate unreliable and writes no negative number when the clock went backwards", async () => {
    await seed({
      timeline: STANDARD_TIMELINE.map((r) => (r.event === "delivered" ? { ...r, at: at("09:20") } : r)),
    });
    const m = await measureItem(root, FEATURE);
    expect(m.gates.merge).toEqual({ unreliable: "clock went backwards" });
    expect(numbers(m).filter((n) => n < 0)).toEqual([]);
  });

  it("gives no actual size and no negative number when the review passed before implementation began", async () => {
    await seed({ reviewCreated: at("09:15") });
    const m = await measureItem(root, FEATURE);
    expect(m.actual).not.toHaveProperty("size");
    expect(m.gap).not.toEqual(expect.any(Number));
    expect(numbers(m).filter((n) => n < 0)).toEqual([]);
  });
});

describe("writeItemMetrics — the file is replaced atomically", () => {
  it("replaces an existing metrics.json by a rename, so a reader of the old file never sees a partial one", async () => {
    await seed({ ledger: null });
    const dir = join(root, ".works", "done", FOLDER);
    const target = join(dir, "metrics.json");
    const oldText = `${JSON.stringify({ v: 1, feature: FEATURE, old: true }, null, 2)}\n`;
    await writeFile(target, oldText);
    // A second name for the old file: a write in place would change it, a rename leaves it as it was.
    const keep = join(root, "metrics-before.json");
    linkSync(target, keep);
    const inodeBefore = statSync(target).ino;

    const written = writeItemMetrics(root, FEATURE);

    expect(written).toBe(target);
    expect(statSync(target).ino).not.toBe(inodeBefore);
    expect(await readFile(keep, "utf8")).toBe(oldText);
    const parsed = JSON.parse(await readFile(target, "utf8"));
    expect(parsed).toMatchObject({ v: 1, feature: FEATURE });
    expect(parsed.old).toBeUndefined();
  });

  it("leaves no temporary file next to metrics.json", async () => {
    await seed({ ledger: null });
    writeItemMetrics(root, FEATURE);
    const names = await readdir(join(root, ".works", "done", FOLDER));
    expect(names).toContain("metrics.json");
    expect(names.filter((n) => n.startsWith("metrics.json."))).toEqual([]);
  });
});
