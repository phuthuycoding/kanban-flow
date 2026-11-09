import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import type { Feature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdVerify } from "../cli/commands/verify.js";
import { cmdLoopStats } from "../cli/commands/loop-stats.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { appendStageRecord, readLatestStageRecord, stageRecordPath } from "../workflow/stage-record.js";
import type { StageRecord } from "../workflow/stage-record.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const SHA = "a".repeat(40);
const record = (over: Partial<StageRecord> = {}): StageRecord => ({
  at: "2026-11-09T10:00:00.000Z",
  sha: SHA,
  clean: true,
  commands: [{ argv: ["true"], outcome: "exit", code: 0 }],
  outputSha256: "b".repeat(64),
  exit: 0,
  ...over,
});

let scratch: string;
let root: string;
let feature: Feature;

async function configure(stage?: string[][]): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...(stage ? { verify: { stage } } : {}),
    },
  }));
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-stagerec-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  await configure();
  const made = await cmdNew(args("new", ["f"], { context: "app" }), root);
  if (made.code !== 0) throw new Error(`fixture: kf new failed: ${made.stdout}${made.stderr ?? ""}`);
  feature = findFeature(root, "f")!;
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const fileOf = (): string => join(feature.dir, "loop", "stage-verify.jsonl");

describe("stageRecordPath", () => {
  it("is loop/stage-verify.jsonl inside the item directory", () => {
    expect(stageRecordPath(feature.dir)).toBe(fileOf());
  });
});

describe("appendStageRecord", () => {
  it("creates loop/ and writes the record as one JSON line", async () => {
    await appendStageRecord(root, feature, record());

    expect(readFileSync(fileOf(), "utf8")).toBe(`${JSON.stringify(record())}\n`);
  });

  it("appends a second record after the first without touching it", async () => {
    await appendStageRecord(root, feature, record());
    await appendStageRecord(root, feature, record({ exit: 1, sha: "c".repeat(40) }));

    const lines = readFileSync(fileOf(), "utf8").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(JSON.stringify(record()));
    expect(JSON.parse(lines[1]).exit).toBe(1);
  });

  it("rejects when loop is a file rather than a folder", async () => {
    await writeFile(join(feature.dir, "loop"), "not a directory");

    await expect(appendStageRecord(root, feature, record())).rejects.toThrow();
  });
});

describe("readLatestStageRecord", () => {
  const write = async (text: string): Promise<void> => {
    await mkdir(join(feature.dir, "loop"), { recursive: true });
    await writeFile(fileOf(), text);
  };

  it("returns none when there is no file", () => {
    expect(readLatestStageRecord(feature)).toEqual({ kind: "none" });
  });

  it("returns none for an empty or whitespace-only file", async () => {
    await write("\n  \n");
    expect(readLatestStageRecord(feature)).toEqual({ kind: "none" });
  });

  it("returns the last record when there are several", async () => {
    const second = record({ exit: 1, sha: "c".repeat(40) });
    await write(`${JSON.stringify(record())}\n${JSON.stringify(second)}\n\n`);

    expect(readLatestStageRecord(feature)).toEqual({ kind: "record", record: second });
  });

  it("returns invalid with a reason when the last line is unparsable, never an earlier passing line", async () => {
    await write(`${JSON.stringify(record())}\n{not json\n`);

    const latest = readLatestStageRecord(feature);

    expect(latest.kind).toBe("invalid");
    if (latest.kind === "invalid") expect(latest.reason).not.toBe("");
  });

  it("returns invalid when the last line is JSON of the wrong shape", async () => {
    await write(`${JSON.stringify(record())}\n{"sha":"abc"}\n`);

    expect(readLatestStageRecord(feature).kind).toBe("invalid");
  });

  it("returns the second record after kf verify --stage runs twice", async () => {
    await configure([["node", "-e", "console.log('x')"]]);

    await cmdVerify(args("verify", ["f"], { stage: true }), root);
    await cmdVerify(args("verify", ["f"], { stage: true }), root);

    const lines = readFileSync(fileOf(), "utf8").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(2);
    expect(readLatestStageRecord(feature)).toEqual({ kind: "record", record: JSON.parse(lines[1]) });
  });
});

describe("loop readers ignore the stage record file", () => {
  const VERIFY_LOG = "## kf verify 2026-11-09T10:00:00.000Z exit=0\n  All 1 task verify command(s) passed.\n";

  async function seedLoop(withStageFile: boolean): Promise<void> {
    await mkdir(join(feature.dir, "loop"), { recursive: true });
    await copyFile(join(PKG_ROOT, "src", "tests", "fixtures", "loop-stats", "mid-loop.ledger.md"), join(feature.dir, "loop", "progress.md"));
    await writeFile(join(feature.dir, "loop", "task-001-verify.log"), VERIFY_LOG);
    await writeFile(join(feature.dir, "tasks.md"), "- [ ] 1. TASK-001: first\n- [ ] 2. TASK-002: second\n");
    if (withStageFile) await writeFile(fileOf(), `${JSON.stringify(record())}\n`);
  }

  it("gives the same loop inputs and loop-stats report with and without loop/stage-verify.jsonl", async () => {
    const bug: Feature = { ...feature, meta: { ...feature.meta!, kind: "bug" } };
    await seedLoop(false);
    const inputsWithout = readLoopInputs(root, bug);
    const statsWithout = await cmdLoopStats(args("loop-stats", ["f"], { json: true }), root);

    await seedLoop(true);
    const inputsWith = readLoopInputs(root, bug);
    const statsWith = await cmdLoopStats(args("loop-stats", ["f"], { json: true }), root);

    expect(existsSync(fileOf())).toBe(true);
    expect(inputsWith).toEqual(inputsWithout);
    expect(inputsWith.ok).toBe(true);
    expect(statsWith).toEqual(statsWithout);
    expect(statsWith.code).toBe(0);
    expect(await readdir(join(feature.dir, "loop"))).toContain("stage-verify.jsonl");
  });
});
