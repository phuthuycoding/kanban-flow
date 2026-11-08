import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import { parseLedger } from "../workflow/loop-stats.js";
import { buildLine, recordEvent, stamp, type RecordEvent } from "../workflow/next/record.js";
import type { Feature } from "../workflow/features.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";
const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const HEADER = "# Task loop ledger — demo — plan: /x/phase-2-implementation-plan.md";
const TS = "2026-11-08T10:00:00+07:00";

let root: string;
let itemDir: string;
let ledger: string;

function featureOf(): Feature {
  return {
    name: "demo", context: "app", stage: "implementation", dir: itemDir, folder: "demo_20261108_1000",
    meta: { schema: "kanban-flow", feature: "demo", context: "app", created: "20261108_1000" },
  };
}

function ev(event: string, args: string[] = [], over: Partial<RecordEvent> = {}): RecordEvent {
  return { event, args, ...over };
}

const dispatch = (task: string, seat: string): string => `${task}: ${seat} dispatched model=opus @ ${TS}`;
const doneLine = (task: string, seat: string): string => `${task}: ${seat} done status=DONE @ ${TS}`;
const text = (...lines: string[]): string => `${HEADER}\n${lines.join("\n")}\n`;

function built(res: ReturnType<typeof buildLine>): string {
  if (!res.ok) throw new Error(`expected a line, got refusal ${res.code}: ${res.reason}`);
  return res.line;
}

function refused(res: ReturnType<typeof buildLine>): { code: number; reason: string } {
  if (res.ok) throw new Error(`expected a refusal, got line: ${res.line}`);
  return { code: res.code, reason: res.reason };
}

function kf(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function kfAsync(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 0;
      resolve({ code, stdout });
    });
  });
}

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-next-record-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261108_1000", defaultContext: "app" }));
  itemDir = join(root, ".works", "implementation", "demo_20261108_1000");
  await mkdir(itemDir, { recursive: true });
  await writeFile(join(itemDir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "app", created: "20261108_1000" }));
  await writeFile(
    join(itemDir, ARTIFACTS["implementation-plan"].file),
    `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do it | Core | - | Done | FR-001 / UC-001 | coder | src/a.ts |\n`,
  );
  ledger = join(itemDir, "loop", "progress.md");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("stamp", () => {
  it("renders local time with a colon in the offset and the same instant as the date", () => {
    const now = new Date("2026-11-08T01:28:59Z");
    const s = stamp(now);
    expect(s).toMatch(STAMP_SHAPE);
    expect(new Date(s).getTime()).toBe(now.getTime());
  });
});

describe("buildLine", () => {
  it("builds each dedicated event into its ledger body", () => {
    expect(built(buildLine(null, ev("dispatched", ["TASK-001", "developer"], { model: "opus" }))))
      .toBe("TASK-001: developer dispatched model=opus");
    expect(built(buildLine(null, ev("dispatched", ["TASK-001", "developer"], { model: "sonnet", round: "2", cascade: "abcdef1" }))))
      .toBe("TASK-001: developer dispatched model=sonnet round=2 cascade=abcdef1");
    expect(built(buildLine(text(dispatch("TASK-001", "developer")), ev("done", ["TASK-001", "developer"], { status: "DONE" }))))
      .toBe("TASK-001: developer done status=DONE");
    expect(built(buildLine(null, ev("verify-started", ["TASK-001"])))).toBe("TASK-001: verify started");
    expect(built(buildLine(text(`TASK-001: verify started @ ${TS}`), ev("verify-done", ["TASK-001"], { exit: "0" }))))
      .toBe("TASK-001: verify done exit=0");
    expect(built(buildLine(null, ev("commits", ["TASK-001", "a1b2c3d,e4f5a6b"])))).toBe("Note TASK-001: commits a1b2c3d,e4f5a6b");
    expect(built(buildLine(null, ev("waits", ["TASK-002", "4", "developers", "in", "flight"]))))
      .toBe("TASK-002: developer waits — 4 developers in flight");
    expect(built(buildLine(null, ev("fix-round", ["TASK-001", "2", "tighten", "the", "check"]))))
      .toBe("TASK-001: fix round 2/5 (tighten the check)");
    expect(built(buildLine(null, ev("cascade-owed", ["TASK-001", "abcdef1", "TASK-002"]))))
      .toBe("TASK-001: cascade re-review owed — after abcdef1 of TASK-002");
    expect(built(buildLine(null, ev("complete", ["TASK-001", "all", "green"])))).toBe("TASK-001: complete (all green)");
    expect(built(buildLine(null, ev("line", ["Scan:", "clean"])))).toBe("Scan: clean");
  });

  it("refuses a done with no open dispatch of that task and seat, naming both", () => {
    const r = refused(buildLine(text(dispatch("TASK-001", "test-writer")), ev("done", ["TASK-001", "developer"], { status: "DONE" })));
    expect(r.code).toBe(1);
    expect(r.reason).toContain("TASK-001");
    expect(r.reason).toContain("developer");
  });

  it("refuses a done whose dispatch was already answered", () => {
    const l = text(dispatch("TASK-001", "developer"), doneLine("TASK-001", "developer"));
    expect(refused(buildLine(l, ev("done", ["TASK-001", "developer"], { status: "DONE" }))).code).toBe(1);
  });

  it("refuses a done on a missing ledger", () => {
    expect(refused(buildLine(null, ev("done", ["TASK-001", "developer"], { status: "DONE" }))).code).toBe(1);
  });

  it("refuses a verify-done with no open verify started", () => {
    const r = refused(buildLine(text(dispatch("TASK-001", "developer")), ev("verify-done", ["TASK-001"], { exit: "0" })));
    expect(r.code).toBe(1);
    expect(r.reason).toContain("TASK-001");
  });

  it("refuses a repeat of the wait already recorded, until a developer dispatch follows it", () => {
    const wait = `TASK-002: developer waits — 4 developers in flight @ ${TS}`;
    expect(refused(buildLine(text(wait), ev("waits", ["TASK-002", "4 developers in flight"]))).code).toBe(1);
    const after = text(wait, dispatch("TASK-002", "developer"));
    expect(built(buildLine(after, ev("waits", ["TASK-002", "4 developers in flight"])))).toBe("TASK-002: developer waits — 4 developers in flight");
  });

  it("allows a different wait reason after a recorded wait", () => {
    const l = text(`TASK-002: developer waits — 4 developers in flight @ ${TS}`);
    expect(built(buildLine(l, ev("waits", ["TASK-002", "dependency TASK-001 open"])))).toBe("TASK-002: developer waits — dependency TASK-001 open");
  });

  it("allows a second dispatch of an open seat", () => {
    const l = text(dispatch("TASK-001", "developer"));
    expect(built(buildLine(l, ev("dispatched", ["TASK-001", "developer"], { model: "opus" })))).toBe("TASK-001: developer dispatched model=opus");
  });

  it("lets a done after a re-dispatch answer the latest dispatch", () => {
    const l = text(dispatch("TASK-001", "developer"), dispatch("TASK-001", "developer"));
    expect(built(buildLine(l, ev("done", ["TASK-001", "developer"], { status: "DONE" })))).toBe("TASK-001: developer done status=DONE");
  });

  it("refuses a second complete of an already complete task", () => {
    const l = text(`TASK-001: complete (ok) @ ${TS}`);
    expect(refused(buildLine(l, ev("complete", ["TASK-001", "again"]))).code).toBe(1);
  });

  it("refuses an unknown event, naming it and listing the known ones", () => {
    const r = refused(buildLine(null, ev("explode", ["TASK-001"])));
    expect(r.code).toBe(1);
    expect(r.reason).toContain("explode");
    expect(r.reason).toContain("dispatched");
    expect(r.reason).toContain("complete");
  });

  it("writes a free line that starts with a dash", () => {
    expect(built(buildLine(null, ev("line", ["Note", "TASK-001:", "decided", "—", "-x", "wins"])))).toBe("Note TASK-001: decided — -x wins");
  });

  it("accepts the listed free-line prefixes", () => {
    for (const l of [
      "Ruling: keep the cap at 2",
      "Note TASK-001: decided — use the lock",
      "Note TASK-001: verify routed — TASK-002",
      "Scan: clean",
      "wave 1: TASK-001, TASK-002",
      `TASK-001: test hashes a.ts=${"a".repeat(40)}`,
      "TASK-001: test dispute a.ts:3 wrong",
      "TASK-001: no test-writer — config only",
      "TASK-001: unverified — docs only",
      "TASK-001: brief written",
      "TASK-001: review package a1b2c3d,e4f5a6b",
      "TASK-001: implemented, test-writer seat: none, review seat: none",
    ]) {
      expect(built(buildLine(null, ev("line", l.split(" "))))).toBe(l);
    }
  });

  it("refuses a free line that is one of the nine shapes, pointing at the dedicated event", () => {
    const r = refused(buildLine(null, ev("line", "TASK-001: verify started".split(" "))));
    expect(r.code).toBe(1);
    expect(r.reason).toMatch(/dedicated event/);
  });

  it("refuses a free line outside the allowed list", () => {
    expect(refused(buildLine(null, ev("line", ["random", "chatter"]))).code).toBe(1);
  });

  it("refuses a line that the ledger reader would refuse, with its reason", () => {
    const r = refused(buildLine(null, ev("line", "Ruling: developer cap 2 → 3 — nonsense".split(" "))));
    expect(r.code).toBe(1);
    expect(r.reason.length).toBeGreaterThan(0);
  });

  it("refuses to append to a broken ledger, naming the line to repair", () => {
    const broken = `${HEADER}\nTASK-001: developer dispatched model=opus\n`;
    const r = refused(buildLine(broken, ev("verify-started", ["TASK-001"])));
    expect(r.code).toBe(1);
    expect(r.reason).toContain("2");
  });

  it("exits 3 on bad usage: missing args, bad ids, seats, numbers, shas and free text", () => {
    const bad: [RecordEvent][] = [
      [ev("dispatched", ["TASK-001"], { model: "opus" })],
      [ev("dispatched", ["TASK-001", "developer"])],
      [ev("dispatched", ["task-1", "developer"], { model: "opus" })],
      [ev("dispatched", ["TASK-001", "janitor"], { model: "opus" })],
      [ev("dispatched", ["TASK-001", "developer"], { model: "opus", round: "0" })],
      [ev("dispatched", ["TASK-001", "developer"], { model: "opus", round: "x" })],
      [ev("dispatched", ["TASK-001", "developer"], { model: "opus", cascade: "ABCDEF1" })],
      [ev("dispatched", ["TASK-001", "developer"], { model: "opus", cascade: "abc12" })],
      [ev("done", ["TASK-001", "developer"])],
      [ev("verify-done", ["TASK-001"])],
      [ev("verify-done", ["TASK-001"], { exit: "-1" })],
      [ev("commits", ["TASK-001", "xyz"])],
      [ev("commits", ["TASK-001"])],
      [ev("waits", ["TASK-001"])],
      [ev("fix-round", ["TASK-001", "6", "text"])],
      [ev("fix-round", ["TASK-001", "0", "text"])],
      [ev("complete", ["TASK-001"])],
      [ev("complete", ["TASK-001", "two\nlines"])],
      [ev("complete", ["TASK-001", "a", "@", "2026-11-08T10:00:00+07:00"])],
      [ev("line", [])],
    ];
    for (const [e] of bad) {
      const res = buildLine(null, e);
      expect(res.ok, JSON.stringify(e)).toBe(false);
      if (!res.ok) expect(res.code, JSON.stringify(e)).toBe(3);
    }
  });
});

describe("recordEvent", () => {
  const fixedNow = (): Date => new Date("2026-11-08T01:28:59Z");

  it("writes the header first when the ledger is missing, then the stamped line", async () => {
    const res = await recordEvent(root, featureOf(), ev("dispatched", ["TASK-001", "test-writer"], { model: "opus" }), fixedNow);
    expect(res.code).toBe(0);
    const lines = (await readFile(ledger, "utf8")).split("\n");
    expect(lines[0]).toBe(`# Task loop ledger — demo — plan: ${join(itemDir, "phase-2-implementation-plan.md")}`);
    expect(lines[1]).toBe(`TASK-001: test-writer dispatched model=opus @ ${stamp(fixedNow())}`);
    expect(lines[2]).toBe("");
    expect(res.stdout).toContain(lines[1]);
  });

  it("appends exactly one line to an existing ledger and leaves the rest alone", async () => {
    await mkdir(dirname(ledger), { recursive: true });
    const before = text(dispatch("TASK-001", "developer"));
    await writeFile(ledger, before);
    const res = await recordEvent(root, featureOf(), ev("done", ["TASK-001", "developer"], { status: "DONE" }), fixedNow);
    expect(res.code).toBe(0);
    expect(await readFile(ledger, "utf8")).toBe(`${before}TASK-001: developer done status=DONE @ ${stamp(fixedNow())}\n`);
  });

  it("leaves the file byte-identical on a refusal", async () => {
    await mkdir(dirname(ledger), { recursive: true });
    const before = text(dispatch("TASK-001", "test-writer"));
    await writeFile(ledger, before);
    const res = await recordEvent(root, featureOf(), ev("done", ["TASK-001", "developer"], { status: "DONE" }), fixedNow);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("developer");
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("creates no file when the first event is refused", async () => {
    const res = await recordEvent(root, featureOf(), ev("done", ["TASK-001", "developer"], { status: "DONE" }), fixedNow);
    expect(res.code).toBe(1);
    expect(existsSync(ledger)).toBe(false);
  });
});

describe("kf record", () => {
  it("writes the header first, stamps each line, and lets kf loop-stats --record accept the ledger", () => {
    const steps: string[][] = [
      ["dispatched", "TASK-001", "test-writer", "--model", "opus"],
      ["done", "TASK-001", "test-writer", "--status", "DONE"],
      ["dispatched", "TASK-001", "developer", "--model", "opus"],
      ["done", "TASK-001", "developer", "--status", "DONE"],
      ["dispatched", "TASK-001", "code-reviewer", "--model", "sonnet"],
      ["done", "TASK-001", "code-reviewer", "--status", "PASS"],
      ["complete", "TASK-001", "--", "all", "green"],
    ];
    for (const s of steps) {
      const res = kf(["record", "demo", ...s]);
      expect(res.status, `${s.join(" ")}: ${res.stdout}${res.stderr}`).toBe(0);
    }
    const lines = readFileSync(ledger, "utf8").trimEnd().split("\n");
    expect(lines[0]).toBe(`# Task loop ledger — demo — plan: ${join(itemDir, "phase-2-implementation-plan.md")}`);
    expect(lines).toHaveLength(steps.length + 1);
    for (const l of lines.slice(1)) expect(l).toMatch(/ @ \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(parseLedger(readFileSync(ledger, "utf8")).lines.filter((l) => l.kind === "unparsed")).toEqual([]);
    const stats = kf(["loop-stats", "demo", "--record"]);
    expect(stats.status, `${stats.stdout}${stats.stderr}`).toBe(0);
  });

  it("refuses a done with no open dispatch, exit 1, naming the problem and leaving the file unchanged", async () => {
    await mkdir(dirname(ledger), { recursive: true });
    const before = text(dispatch("TASK-001", "test-writer"));
    await writeFile(ledger, before);
    const res = kf(["record", "demo", "done", "TASK-001", "developer", "--status", "DONE"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("developer");
    expect(res.stderr).toContain("refused");
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("writes two whole lines when two records run at the same time", async () => {
    await mkdir(dirname(ledger), { recursive: true });
    await writeFile(ledger, text(dispatch("TASK-001", "test-writer"), dispatch("TASK-002", "test-writer")));
    const [a, b] = await Promise.all([
      kfAsync(["record", "demo", "done", "TASK-001", "test-writer", "--status", "DONE"]),
      kfAsync(["record", "demo", "done", "TASK-002", "test-writer", "--status", "DONE"]),
    ]);
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    const content = await readFile(ledger, "utf8");
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(5);
    expect(lines.filter((l) => l.includes(" done status=DONE @ "))).toHaveLength(2);
    expect(content.endsWith("\n")).toBe(true);
    expect(parseLedger(content).lines.filter((l) => l.kind === "unparsed")).toEqual([]);
  });

  it("refuses an unknown event with exit 1 and leaves the file unchanged", async () => {
    await mkdir(dirname(ledger), { recursive: true });
    const before = text(dispatch("TASK-001", "developer"));
    await writeFile(ledger, before);
    const res = kf(["record", "demo", "explode", "TASK-001"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("explode");
    expect(await readFile(ledger, "utf8")).toBe(before);
  });

  it("writes free text that starts with a dash after --", async () => {
    const res = kf(["record", "demo", "line", "--", "Note TASK-001: decided — -x wins"]);
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
    const lines = (await readFile(ledger, "utf8")).trimEnd().split("\n");
    expect(lines[1]).toMatch(/^Note TASK-001: decided — -x wins @ \d{4}-/);
  });

  it("exits 3 with the usage line for a negative --exit", () => {
    const res = kf(["record", "demo", "verify-done", "TASK-001", "--exit=-1"]);
    expect(res.status).toBe(3);
    expect(res.stdout).toContain("Usage: kf record");
    expect(res.stderr).toContain("bad input");
  });

  it("exits 1 for an unknown feature", () => {
    const res = kf(["record", "nope", "verify-started", "TASK-001"]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("nope");
  });
});
