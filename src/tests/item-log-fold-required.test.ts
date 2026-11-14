import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../cli/commands/init.js";
import { cmdNew } from "../cli/commands/new.js";
import type { ParsedArgs } from "../cli/args.js";
import { checkItemLogs } from "../project/doctor-item-log.js";
import { findFeature } from "../workflow/features.js";
import { foldItemLog, itemLogPath, readItemLog, sharedMeta, syncItemLog, type ItemState } from "../workflow/item-log.js";

// A stable ItemState.meta is typed to hold schema, feature, context and created, so a log that does
// not set all four as strings (a hand-edited or foreign one) is refused instead of folded.
const FULL = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
const HEAD = '"v":1,"at":"2026-11-13T05:00:00.000Z","actor":"t","origin":{"machine":"m","via":"cli"}';
const createdWith = (set: Record<string, unknown>): string =>
  `{${HEAD},"event":"created","stage":"planning","set":${JSON.stringify(set)}}`;
const stageOnly = `{${HEAD},"event":"stage","from":"planning","stage":"implementation"}`;
const log = (...lines: string[]): string => lines.join("\n") + "\n";

describe("folding a log that does not set the required metadata keys", () => {
  it("refuses a log of one stage record at line 1, naming schema", () => {
    expect(foldItemLog(log(stageOnly))).toEqual({ ok: false, line: 1, reason: "the log never sets schema" });
  });

  it("refuses a log whose later record unsets feature, at that record's line, naming feature", () => {
    const unsetFeature = `{${HEAD},"event":"linked","unset":["feature"]}`;
    expect(foldItemLog(log(createdWith(FULL), unsetFeature))).toEqual({
      ok: false,
      line: 2,
      reason: "the log never sets feature",
    });
  });

  it("folds the empty log to no state and no records", () => {
    expect(foldItemLog("")).toEqual({ ok: true, state: null, records: 0 });
  });

  it("still folds a log whose created record sets the four keys", () => {
    const result = foldItemLog(log(createdWith(FULL)));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`fold refused: ${JSON.stringify(result)}`);
    expect(result.records).toBe(1);
    expect(result.state?.stage).toBe("planning");
    expect(result.state?.meta).toMatchObject(FULL);
  });

  it("names the first key that is missing or not a string, in the order schema, feature, context, created", () => {
    expect(foldItemLog(log(createdWith({ schema: FULL.schema })))).toEqual({
      ok: false,
      line: 1,
      reason: "the log never sets feature",
    });
    expect(foldItemLog(log(createdWith({ schema: FULL.schema, feature: FULL.feature, context: 1 })))).toEqual({
      ok: false,
      line: 1,
      reason: "the log never sets context",
    });
    const { created: _created, ...withoutCreated } = FULL;
    expect(foldItemLog(log(createdWith(withoutCreated)))).toEqual({
      ok: false,
      line: 1,
      reason: "the log never sets created",
    });
  });
});

describe("kf doctor and a log without the required metadata keys", () => {
  let root: string;
  const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
    ({ command, positionals, options });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kf-fold-required-"));
    expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("reports the refused log as one cannot-be-read WARNING with its line and reason", async () => {
    expect((await cmdNew(args("new", ["refused"], { context: "app" }), root)).code).toBe(0);
    // findFeature returns null for an unknown item; fail here rather than on a property of null.
    const f = findFeature(root, "refused");
    expect(f).not.toBeNull();
    if (f === null) throw new Error("the new item 'refused' was not found");
    const dir = f.dir;

    // The log kf writes itself must still fold: the refusal is only for a log missing the required keys.
    const own = readItemLog(dir);
    expect(own.ok).toBe(true);
    if (!own.ok) throw new Error(`kf's own log was refused: ${JSON.stringify(own)}`);
    for (const key of ["schema", "feature", "context", "created"] as const) {
      expect(typeof own.state?.meta[key]).toBe("string");
    }

    await writeFile(itemLogPath(dir), log(stageOnly));

    const findings = checkItemLogs(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("WARNING");
    expect(findings[0].message).toBe("Lifecycle log of 'refused' cannot be read: line 1 (the log never sets schema).");
  });

  // A lifecycle write must never append to a log it cannot fold, or it would bury the hand edit under kf's records.
  it("leaves a refused log byte-identical on a lifecycle write and warns once on stderr", async () => {
    expect((await cmdNew(args("new", ["refused"], { context: "app" }), root)).code).toBe(0);
    const f = findFeature(root, "refused");
    expect(f).not.toBeNull();
    if (f === null) throw new Error("the new item 'refused' was not found");
    // kf new writes the item's metadata, so a null here is a broken fixture, not the behaviour under test.
    expect(f.meta).not.toBeNull();
    if (f.meta === null) throw new Error("the new item 'refused' has no readable metadata");
    const meta = f.meta;
    const path = itemLogPath(f.dir);
    await writeFile(path, log(stageOnly));
    const before = await readFile(path);

    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      syncItemLog(root, f.dir, f.name, { stage: f.stage, meta: sharedMeta(meta) } as ItemState);
    } finally {
      spy.mockRestore();
    }

    expect((await readFile(path)).equals(before)).toBe(true);
    const warnings = writes.join("").split("\n").filter((line) => line.includes("lifecycle log not written"));
    expect(warnings).toHaveLength(1);
  });
});
