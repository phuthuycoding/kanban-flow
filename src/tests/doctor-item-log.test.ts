import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { appendFileSync, readFileSync } from "node:fs";

import { runDoctor, runDoctorFixes } from "../project/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdNew } from "../cli/commands/new.js";
import { commandHelp } from "../cli/args.js";
import { PKG_ROOT } from "../shared/paths.js";
import { findFeature } from "../workflow/features.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import type { ParsedArgs } from "../cli/args.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
let prevPath: string | undefined;

/** A `claude` first on PATH that reports the kf plugin current, so a healthy project has no findings. */
async function currentPluginStub(): Promise<void> {
  const bin = join(root, "..", `${basename(root)}-bin`);
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-itemlog-"));
  prevPath = process.env.PATH;
  await currentPluginStub();
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
});
afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(join(root, "..", `${basename(root)}-bin`), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

/** An item made by the real `kf new`, so it carries an id and a `created` record. */
async function newItem(name: string): Promise<string> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  return findFeature(root, name)!.dir;
}
const metaFile = (dir: string): string => join(dir, ".kfw.json");
const readMeta = (dir: string): Record<string, unknown> => JSON.parse(readFileSync(metaFile(dir), "utf8")) as Record<string, unknown>;
const rewriteMeta = async (dir: string, fn: (m: Record<string, unknown>) => Record<string, unknown>): Promise<void> =>
  writeFile(metaFile(dir), JSON.stringify(fn(readMeta(dir)), null, 2));
const logRecords = (dir: string): Array<Record<string, unknown>> =>
  readFileSync(itemLogPath(dir), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
const logFindings = (): ReturnType<typeof runDoctor>["findings"] =>
  runDoctor(root).findings.filter((f) => f.area.endsWith("lifecycle.jsonl"));

/** The four-item project: up to date, no log and no id, edited by hand, and a log with a non-JSON line. */
async function fourItems() {
  const upToDate = await newItem("uptodate");
  const noLog = await newItem("nolog");
  await rm(itemLogPath(noLog));
  await rewriteMeta(noLog, ({ id: _id, ...rest }) => rest);
  const edited = await newItem("edited");
  await rewriteMeta(edited, (m) => ({ ...m, context: "billing" }));
  const broken = await newItem("broken");
  appendFileSync(itemLogPath(broken), "this is not json\n");
  return { upToDate, noLog, edited, broken, brokenBytes: readFileSync(itemLogPath(broken), "utf8") };
}

describe("kf doctor and the lifecycle log", () => {
  it("reports a log behind its metadata and an unreadable log, and nothing else", async () => {
    await fourItems();
    const report = runDoctor(root);
    expect(report.findings).toHaveLength(2);
    expect(report.findings.every((f) => f.level === "WARNING")).toBe(true);
    const behind = report.findings.find((f) => f.area.includes("edited_"));
    expect(behind?.area.endsWith("/lifecycle.jsonl")).toBe(true);
    expect(behind?.message).toBe("Lifecycle log of 'edited' is behind its .kfw.json: context.");
    expect(behind?.action).toBe("kf doctor --fix");
    const unreadable = report.findings.find((f) => f.area.includes("broken_"));
    expect(unreadable?.message).toContain("Lifecycle log of 'broken' cannot be read: line 2");
    expect(unreadable?.action).toBe("Fix or remove the line by hand; kf doctor --fix does not rewrite a log.");
    expect(report.findings.some((f) => f.area.includes("uptodate_") || f.area.includes("nolog_"))).toBe(false);
  });

  it("does not let the log findings change the verdict", async () => {
    expect(runDoctor(root).ok).toBe(true);
    await fourItems();
    const report = runDoctor(root);
    expect(logFindings()).toHaveLength(2);
    expect(report.ok).toBe(true);
  });

  it("names every differing field, the stage first, sorted", async () => {
    const dir = await newItem("multi");
    await rewriteMeta(dir, (m) => ({ ...m, pr: "https://github.com/acme/app/pull/7", context: "billing" }));
    const [finding] = logFindings();
    expect(finding.message).toBe("Lifecycle log of 'multi' is behind its .kfw.json: context, pr.");
  });

  it("repairs a log behind its metadata with reconciled and an item with no log with opened and an id", async () => {
    const { upToDate, noLog, edited, broken, brokenBytes } = await fourItems();
    const upToDateBytes = readFileSync(itemLogPath(upToDate), "utf8");

    const res = await runDoctorFixes(root);

    expect(res.failures).toEqual([]);
    expect(res.fixed).toContain("lifecycle log of edited reconciled");
    expect(res.fixed).toContain("lifecycle log of nolog opened");
    expect(res.fixed.filter((l) => l.startsWith("lifecycle log of "))).toHaveLength(2);

    expect(logRecords(edited).at(-1)?.event).toBe("reconciled");
    expect(logRecords(noLog)[0]?.event).toBe("opened");
    expect(readMeta(noLog).id).toMatch(UUID);
    for (const dir of [edited, noLog]) {
      const folded = readItemLog(dir);
      expect(folded.ok).toBe(true);
      if (folded.ok) expect(folded.state).toEqual({ stage: findFeature(root, basename(dir).replace(/_\d{8}_\d{4}$/, ""))!.stage, meta: sharedMeta(readMeta(dir)) });
    }
    expect(readFileSync(itemLogPath(broken), "utf8")).toBe(brokenBytes);
    expect(readFileSync(itemLogPath(upToDate), "utf8")).toBe(upToDateBytes);
  });

  it("reports only the unreadable log after the repair", async () => {
    await fourItems();
    await runDoctorFixes(root);
    const report = runDoctor(root);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].area).toContain("broken_");
    expect(report.findings[0].message).toContain("line 2");
    expect(report.ok).toBe(true);
  });

  it("gives an item whose metadata cannot be read no log finding", async () => {
    const dir = await newItem("garbled");
    appendFileSync(itemLogPath(dir), "this is not json\n");
    await writeFile(metaFile(dir), "{ not json");
    expect(logFindings()).toEqual([]);
    const before = readFileSync(itemLogPath(dir), "utf8");
    const res = await runDoctorFixes(root);
    expect(res.fixed.some((l) => l.includes("garbled"))).toBe(false);
    expect(readFileSync(itemLogPath(dir), "utf8")).toBe(before);
    expect(readFileSync(metaFile(dir), "utf8")).toBe("{ not json");
  });

  it("stays silent for an item with an up-to-date log and for one with no log", async () => {
    await newItem("fine");
    const bare = await newItem("bare");
    await rm(itemLogPath(bare));
    expect(logFindings()).toEqual([]);
  });

  it("reports an item it cannot write a log for as an error, not as fixed, and still repairs the others", async () => {
    const blocked = await newItem("blocked");
    await rm(itemLogPath(blocked));
    // Root ignores file modes, so a directory in the log's place is what makes the write fail.
    await mkdir(itemLogPath(blocked));
    const other = await newItem("other");
    await rm(itemLogPath(other));

    const res = await runDoctorFixes(root);

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].level).toBe("ERROR");
    expect(res.failures[0].area).toContain("blocked_");
    expect(res.failures[0].area.endsWith("lifecycle.jsonl")).toBe(true);
    expect(res.failures[0].message).toBe("Lifecycle log of 'blocked' could not be written.");
    expect(res.fixed.some((l) => l.includes("blocked"))).toBe(false);
    expect(res.fixed).toContain("lifecycle log of other opened");
    expect(readItemLog(other).ok).toBe(true);
  });
});

describe("kf doctor help", () => {
  it("names the lifecycle log for the check and for the repair", () => {
    const help = commandHelp("doctor");
    expect(help).toContain("a lifecycle log (lifecycle.jsonl) that cannot be read or is behind its .kfw.json");
    expect(help).toContain("a missing or behind lifecycle log");
  });
});
