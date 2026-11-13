import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ITEM_LOG_FILE,
  diffShared,
  foldItemLog,
  itemLogPath,
  recordChange,
  sharedMeta,
  withItemId,
} from "../workflow/item-log.js";
import type { ItemState } from "../workflow/item-log.js";
import { findFeature, updateFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import type { FeatureMeta } from "../workflow/features.js";

vi.setConfig({ testTimeout: 60_000 });

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PR = (n: number): string => `https://github.com/acme/app/pull/${n}`;
const BASE: FeatureMeta = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };

let scratch: string;
let root: string;
let dir: string;
let stderrWrites: string[];

const line = (rec: Record<string, unknown>): string => JSON.stringify({
  v: 1, at: "2026-11-13T05:00:00.000Z", actor: "t", origin: { machine: "m", via: "cli" }, ...rec,
});
const lines = (path: string): Array<Record<string, unknown>> =>
  readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
const logFile = (): string => itemLogPath(dir);
const state = (stage: ItemState["stage"], meta: object): ItemState => ({ stage, meta: meta as ItemState["meta"] });

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-itemlog-")));
  root = join(scratch, "repo");
  dir = join(root, ".works", "implementation", "demo_20261113_0409");
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test Author"]);
  stderrWrites = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("item log file", () => {
  it("lives at the item folder root under a fixed name", () => {
    expect(ITEM_LOG_FILE).toBe("lifecycle.jsonl");
    expect(itemLogPath(dir)).toBe(join(dir, "lifecycle.jsonl"));
  });
});

describe("appending a record", () => {
  it("writes one whole line with every field, keys in the documented order", () => {
    recordChange(root, dir, "demo", "created", null, state("implementation", BASE));

    const text = readFileSync(logFile(), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")).toHaveLength(2);
    const rec = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(rec)).toEqual(["v", "at", "actor", "origin", "event", "stage", "set"]);
    expect(rec.v).toBe(1);
    expect(rec.at).toMatch(ISO_MS);
    expect(rec.actor).toBe("Test Author");
    expect(Object.keys(rec.origin as object)).toEqual(["machine", "via"]);
    expect((rec.origin as { via: string }).via).toBe("cli");
    expect(typeof (rec.origin as { machine: string }).machine).toBe("string");
    expect(rec.event).toBe("created");
    expect(rec.stage).toBe("implementation");
    expect(rec.set).toEqual(BASE);
    expect(rec).not.toHaveProperty("from");
    expect(rec).not.toHaveProperty("unset");
    expect(rec).not.toHaveProperty("derived");
  });

  it("records a stage move with where it came from and where it went", () => {
    const before = state("implementation", BASE);
    recordChange(root, dir, "demo", "created", null, before);
    recordChange(root, dir, "demo", "stage", before, state("testing", BASE));

    const all = lines(logFile());
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ v: 1, event: "stage", from: "implementation", stage: "testing" });
    expect(all[1].at).toMatch(ISO_MS);
    expect(all[1]).not.toHaveProperty("set");
    expect(all[1]).not.toHaveProperty("unset");
    expect(all[1]).not.toHaveProperty("derived");
  });
});

describe("folding a log", () => {
  it("rebuilds the last stage and the metadata with every set applied in order and every unset removed", () => {
    const approval = { status: "approved", by: "q", at: "2026-11-13T05:01:00.000Z" };
    const text = [
      line({ event: "created", stage: "planning", set: { ...BASE } }),
      line({ event: "approved", from: "planning", stage: "planning", set: { approval, executionId: "exec-1" } }),
      line({ event: "stage", from: "planning", stage: "implementation", unset: ["executionId"] }),
      line({ event: "linked", set: { pr: PR(7) } }),
    ].join("\n") + "\n";

    const result = foldItemLog(text);
    expect(result).toEqual({
      ok: true,
      records: 4,
      state: { stage: "implementation", meta: { ...BASE, approval, pr: PR(7) } },
    });
    if (result.ok) expect(result.state?.meta).not.toHaveProperty("executionId");
  });

  it("reports a bad middle line by its number and gives no state", () => {
    const text = [line({ event: "created", stage: "planning", set: { ...BASE } }), "this is not json", line({ event: "linked", set: { pr: PR(1) } })].join("\n") + "\n";
    const result = foldItemLog(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.line).toBe(2);
      expect(result.reason.length).toBeGreaterThan(0);
    }
    expect(result).not.toHaveProperty("state");
  });

  it("reports a last line cut mid-object by its number", () => {
    const whole = line({ event: "created", stage: "planning", set: { ...BASE } });
    const cut = line({ event: "linked", set: { pr: PR(1) } }).slice(0, 40);
    const result = foldItemLog(`${whole}\n${cut}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(2);
  });

  it("counts blank lines when it numbers an unreadable one", () => {
    const whole = line({ event: "created", stage: "planning", set: { ...BASE } });
    const result = foldItemLog(`${whole}\n\n\nbroken\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(4);
  });

  it("refuses a record that is not version 1, has no time, or names an unknown event", () => {
    const created = line({ event: "created", stage: "planning", set: { ...BASE } });
    const bad = [
      JSON.stringify({ v: 2, at: "2026-11-13T05:00:00.000Z", event: "linked" }),
      JSON.stringify({ v: 1, event: "linked" }),
      JSON.stringify({ v: 1, at: "2026-11-13T05:00:00.000Z", event: "exploded" }),
    ];
    for (const record of bad) {
      const result = foldItemLog(`${created}\n${record}\n`);
      expect(result.ok, record).toBe(false);
      if (!result.ok) expect(result.line, record).toBe(2);
    }
  });

  it("refuses a log whose first record carries no stage", () => {
    const result = foldItemLog(`${line({ event: "linked", set: { pr: PR(1) } })}\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.line).toBe(1);
  });

  it("folds empty text to no state", () => {
    expect(foldItemLog("")).toEqual({ ok: true, state: null, records: 0 });
  });
});

describe("shared metadata", () => {
  it("drops machine-local and legacy keys and keeps every shared one", () => {
    const shared = {
      ...BASE,
      kind: "bug", goal: "g", issue: "https://github.com/acme/app/issues/3", pr: PR(3),
      delivered: true, deliveredAt: "2026-11-13T06:00:00.000Z",
      docsBranch: "docs/app-demo", docsCommit: "a".repeat(40),
      docsLanded: { branch: "docs/app-demo", by: "ancestor", at: "2026-11-13T06:00:00.000Z" },
      approval: { status: "approved" }, executionId: "e1", status: "cancelled",
      cancellation: { at: "t", by: "q", reason: "r", fromStage: "planning" },
      bypasses: [{ at: "t", from: "review", to: "done", flag: "force", codes: ["x"] }],
      verifyWaiver: { reason: "r", at: "t", by: "q" }, ship: { merged: "t" },
      id: "0b6f2a54-3c1d-4c63-9a0e-5d1f6f1f7a11",
    };
    const local = {
      worktree: { path: "/somewhere" },
      drive: { status: "x" }, runs: [], sessions: {}, tasks: {}, somethingUnknown: 1,
    };
    const projected = sharedMeta({ ...shared, ...local });
    expect(projected).toEqual(shared);
    for (const key of Object.keys(local)) expect(projected).not.toHaveProperty(key);
  });

  it("leaves out a key whose value is undefined", () => {
    const projected = sharedMeta({ ...BASE, pr: undefined });
    expect(Object.keys(projected)).not.toContain("pr");
  });

  it("finds no difference between two objects that differ only in worktree", () => {
    const a = sharedMeta({ ...BASE, worktree: { path: "/a" } });
    const b = sharedMeta({ ...BASE, worktree: { path: "/b" }, drive: { status: "x" } });
    expect(diffShared(a, b)).toEqual({ set: {}, unset: [] });
  });

  it("diffs by deep value with key order ignored, and lists removed keys sorted", () => {
    const before = sharedMeta({ ...BASE, pr: PR(1), executionId: "e", goal: "g", approval: { status: "pending", by: "q" } });
    const after = sharedMeta({ ...BASE, pr: PR(2), approval: { by: "q", status: "pending" } });
    expect(diffShared(before, after)).toEqual({ set: { pr: PR(2) }, unset: ["executionId", "goal"] });
  });

  it("puts every key in set when there is nothing before", () => {
    expect(diffShared(null, sharedMeta(BASE))).toEqual({ set: { ...BASE }, unset: [] });
  });

  it("gives an item an id once and keeps the one it has", () => {
    const stamped = withItemId(BASE);
    expect(typeof stamped.id).toBe("string");
    expect(stamped.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(BASE).not.toHaveProperty("id");
    const keep = { ...BASE, id: "already-here" };
    expect(withItemId(keep)).toBe(keep);
  });
});

describe("recording against a missing or stale log", () => {
  it("opens a missing log from the earlier state, then adds the command's record", () => {
    writeFileSync(join(dir, ".kfw.json"), JSON.stringify(BASE));
    const before = state("implementation", { ...BASE, goal: "ship it" });
    const after = state("implementation", { ...BASE, goal: "ship it", pr: PR(5) });
    recordChange(root, dir, "demo", "linked", before, after);

    const all = lines(logFile());
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ v: 1, event: "opened", derived: true, stage: "implementation", set: { ...BASE, goal: "ship it" } });
    expect(all[1]).toMatchObject({ event: "linked", set: { pr: PR(5) } });
    expect(all[1]).not.toHaveProperty("derived");
    expect(all[1]).not.toHaveProperty("stage");
    expect(stderrWrites).toEqual([]);
  });

  it("derives the opened record from the earlier state with the new id when only the change brings an id", () => {
    const before = state("implementation", BASE);
    const after = state("testing", { ...BASE, id: "fresh-id" });
    recordChange(root, dir, "demo", "stage", before, after);

    const all = lines(logFile());
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ event: "opened", derived: true, stage: "implementation", set: { ...BASE, id: "fresh-id" } });
    expect(all[1]).toMatchObject({ event: "stage", from: "implementation", stage: "testing" });
    expect(all[1]).not.toHaveProperty("set");
  });

  it("reconciles a log that is behind with only the fields that differ", () => {
    const behind = { ...BASE, approval: { status: "pending" } };
    writeFileSync(logFile(), `${line({ event: "created", stage: "planning", set: behind })}\n`);
    const approved = { status: "approved", by: "q", at: "2026-11-13T05:01:00.000Z" };
    const before = state("planning", { ...BASE, approval: approved });
    const waiver = { reason: "no runner", at: "2026-11-13T05:02:00.000Z", by: "q" };
    const after = state("planning", { ...BASE, approval: approved, verifyWaiver: waiver });
    recordChange(root, dir, "demo", "waiver", before, after);

    const all = lines(logFile());
    expect(all).toHaveLength(3);
    expect(all[1]).toMatchObject({ event: "reconciled", derived: true, set: { approval: approved } });
    expect(Object.keys(all[1].set as object)).toEqual(["approval"]);
    expect(all[1]).not.toHaveProperty("stage");
    expect(all[1]).not.toHaveProperty("unset");
    expect(all[2]).toMatchObject({ event: "waiver", set: { verifyWaiver: waiver } });
  });
});

describe("a write that changes nothing shared", () => {
  it("appends nothing when only worktree differs, or when nothing differs", () => {
    const meta = { ...BASE, goal: "g" };
    recordChange(root, dir, "demo", "created", null, state("implementation", meta));
    const bytes = readFileSync(logFile());

    recordChange(root, dir, "demo", "linked",
      state("implementation", { ...meta, worktree: { path: "/a" } }),
      state("implementation", { ...meta, worktree: { path: "/b" } }));
    expect(readFileSync(logFile()).equals(bytes)).toBe(true);

    recordChange(root, dir, "demo", "linked", state("implementation", meta), state("implementation", meta));
    expect(readFileSync(logFile()).equals(bytes)).toBe(true);
    expect(stderrWrites).toEqual([]);
  });
});

describe("a log that cannot be written", () => {
  it("does not throw and warns once, naming the item and the file, when the log path is a directory", () => {
    mkdirSync(logFile());
    const before = state("implementation", BASE);
    const after = state("implementation", { ...BASE, pr: PR(9) });

    expect(() => recordChange(root, dir, "demo", "linked", before, after)).not.toThrow();

    const out = stderrWrites.join("");
    const printed = out.split("\n").filter((l) => l !== "");
    expect(printed).toHaveLength(1);
    expect(printed[0].startsWith("⚠ lifecycle log not written for")).toBe(true);
    expect(printed[0]).toContain("'demo'");
    expect(printed[0]).toContain(logFile());
    expect(out.endsWith("\n")).toBe(true);
  });

  it("leaves an unreadable log as it is and warns once with the line number", () => {
    const text = `${line({ event: "created", stage: "planning", set: { ...BASE } })}\n{"v":1,"at":"2026-11-13T05:00:00.000Z","event":"lin`;
    writeFileSync(logFile(), text);

    recordChange(root, dir, "demo", "linked", state("planning", BASE), state("planning", { ...BASE, pr: PR(2) }));

    expect(readFileSync(logFile(), "utf8")).toBe(text);
    const printed = stderrWrites.join("").split("\n").filter((l) => l !== "");
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("⚠ lifecycle log not written for 'demo': " + logFile() + ": line 2 is unreadable (");
  });
});

describe("concurrent writers", () => {
  it("append whole lines in lock order and leave a log that folds to the metadata file", async () => {
    const itemRoot = join(scratch, "locked");
    const itemDir = join(itemRoot, ".works", "implementation", "demo_20261113_0409");
    mkdirSync(itemDir, { recursive: true });
    execFileSync("git", ["-C", itemRoot, "init", "-q"]);
    execFileSync("git", ["-C", itemRoot, "config", "user.name", "Test Author"]);
    const seeded: FeatureMeta = { ...BASE, id: "0b6f2a54-3c1d-4c63-9a0e-5d1f6f1f7a11" };
    await writeFeatureMeta(itemDir, seeded);
    recordChange(itemRoot, itemDir, "demo", "created", null, state("implementation", sharedMeta(seeded)));
    expect(lines(itemLogPath(itemDir))).toHaveLength(1);

    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      updateFeatureMeta(itemRoot, "demo", (meta) => ({ ...meta, pr: PR(i + 1) }), {}, "linked")));

    const all = lines(itemLogPath(itemDir));
    expect(all).toHaveLength(21);
    const linked = all.slice(1);
    for (const rec of linked) expect(rec.event).toBe("linked");
    expect(new Set(linked.map((r) => (r.set as { pr: string }).pr)).size).toBe(20);

    const feature = findFeature(itemRoot, "demo")!;
    const folded = foldItemLog(readFileSync(itemLogPath(itemDir), "utf8"));
    expect(folded).toEqual({ ok: true, records: 21, state: { stage: feature.stage, meta: sharedMeta(feature.meta!) } });
    // The last record in the file is the last writer: the file's pr is the one the log ends on.
    expect((linked[19].set as { pr: string }).pr).toBe(feature.meta!.pr);
  });
});
