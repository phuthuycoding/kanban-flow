import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { schedule } from "../workflow/next/schedule.js";
import type { Action, LedgerState, LoopInputs, NextResult } from "../workflow/next/types.js";
import { ensureWorksStructure } from "../workflow/features.js";
import type { Feature } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import { WAVE_PLANS, explore } from "./support/next-explorer.js";
import type { ExploreOptions } from "./support/next-explorer.js";

// The wave tier of `kf next`: once every task of a wave is complete and `harness.verify.stage` is pinned, the stage
// commands run once on the wave's merged head before any later-wave developer starts. Test-writers are never held,
// a developer already in flight is never cancelled, and with no stage commands the output is what it was before.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const WAVES = join(FIXTURES, "waves");
const BASE = join(WAVES, "wave-one-complete");
const KF = join(PKG_ROOT, "dist", "index.js");

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };
const STAGE = [["node", "-e", "process.exit(0)"]];

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function writeConfig(root: string, verify?: Record<string, unknown>): void {
  mkdirSync(join(root, ".kf"), { recursive: true });
  writeFileSync(
    join(root, ".kf", "config.json"),
    JSON.stringify({
      schema: "kanban-flow",
      created: "20261107_1200",
      defaultContext: "app",
      harness: {
        main: "lead",
        roles: { lead: { runner: "claude" }, coder: { runner: "claude" } },
        stages: { implementation: ["coder"] },
        runners: { claude: { start: ["claude", "{prompt}"] } },
        ...(verify !== undefined ? { verify } : {}),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Ledgers: the base fixture plus lines appended the way `kf record` stamps them
// ---------------------------------------------------------------------------

/** Base: waves 1 (TASK-001, TASK-002) complete; wave 2 has TASK-003 (tests hashed) and TASK-004 (not started). */
const baseLedger = (): string => readFileSync(join(BASE, "loop", "progress.md"), "utf8");

const LAST_BASE_STAMP = Date.parse("2026-11-07T10:30:00+07:00");
let stampAt = LAST_BASE_STAMP;
const stamp = (): string => {
  stampAt += 60_000;
  return `${new Date(stampAt + 7 * 3_600_000).toISOString().slice(0, 19)}+07:00`;
};

/** Appends ledger line bodies, each stamped one minute after the line before it. */
function appended(ledger: string, bodies: string[]): string {
  const body = ledger.endsWith("\n") ? ledger : `${ledger}\n`;
  return body + bodies.map((b) => `${b} @ ${stamp()}\n`).join("");
}

function ledgerState(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

/** Reads the base fixture's plan through the real input reader, with `harness.verify` set as given. */
function baseInputs(verify?: Record<string, unknown>): LoopInputs {
  stampAt = LAST_BASE_STAMP;
  const root = join(scratch("kf-next-waves-"), "repo");
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(item, { recursive: true });
  writeConfig(root, verify);
  cpSync(BASE, item, { recursive: true });
  const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir: item, folder: ITEM_FOLDER, meta: META };
  const read = readLoopInputs(root, feature);
  if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);
  return read.inputs;
}

type WaveRecord = { wave: number; sha: string; exit: number; at: string; contains: boolean };
const record = (over: Partial<WaveRecord> = {}): WaveRecord => ({ wave: 1, sha: "f".repeat(40), exit: 0, at: "2026-11-07T10:40:00+07:00", contains: true, ...over });

const run = (ledger: string, inputs: LoopInputs, resume = false): NextResult => schedule(ledgerState(ledger), inputs, { resume });

const VERIFY_WAVE_1 = { kind: "verify-wave", wave: 1, command: "kf verify demo --wave 1" };
const isWaveAction = (a: Action): boolean => (a.kind as string) === "verify-wave";
const isWaveWait = (a: Action): boolean => a.kind === "wait" && /^wave \d+ verify/.test(a.reason);
const developerDispatch = (r: NextResult, task: string): boolean => r.actions.some((a) => a.kind === "dispatch" && a.task === task && a.seat === "developer");
const decides = (r: NextResult, rule: string): Extract<Action, { kind: "decide" }>[] =>
  r.actions.filter((a): a is Extract<Action, { kind: "decide" }> => a.kind === "decide" && a.rule === rule);
const show = (r: NextResult): string => JSON.stringify({ inFlight: r.inFlight, actions: r.actions }, null, 1);

/** A wave-1 verify that ran and ended with `exit`. */
const waveRun = (exit: number): string[] => ["wave 1: verify started", `wave 1: verify done exit=${exit}`];

/** TASK-001 reopened by review, fixed in round 1 with commit 9ab0123 and complete again. */
const task001Refixed: string[] = [
  "Note TASK-001: reopened — review 1a2b3c4d",
  "TASK-001: developer dispatched model=sonnet round=1",
  "TASK-001: developer done status=DONE",
  "Note TASK-001: commits 9ab0123",
  "TASK-001: review package 9ab0123",
  "TASK-001: verify started",
  "TASK-001: code-reviewer dispatched model=sonnet round=1",
  "TASK-001: verify done exit=0",
  "TASK-001: code-reviewer done status=clean",
  "TASK-001: fix round 1/5 (review findings fixed)",
  "TASK-001: complete (commits abc1234,9ab0123, review clean)",
];

/** TASK-004's test-writer finished and its tests are hashed. */
const task004TestsReady: string[] = [
  "TASK-004: test-writer dispatched model=sonnet",
  "TASK-004: test-writer done status=DONE",
  "TASK-004: test hashes src/tests/d.test.ts=dddddddddddddddddddddddddddddddddddddddd",
];

// ---------------------------------------------------------------------------
// The wave verify and the barrier
// ---------------------------------------------------------------------------

describe("kf next with stage commands pinned: the wave verify", () => {
  it("reads the pinned stage commands from harness.verify.stage", () => {
    expect(baseInputs({ stage: STAGE }).stageCommands).toEqual(STAGE);
  });

  it("owes the wave verify once every task of the wave is complete", () => {
    const result = run(baseLedger(), baseInputs({ stage: STAGE }));

    expect(result.actions, show(result)).toContainEqual(VERIFY_WAVE_1);
  });

  it("holds a later wave's developer until the wave is verified", () => {
    const result = run(baseLedger(), baseInputs({ stage: STAGE }));

    expect(result.actions, show(result)).toContainEqual({ kind: "wait", task: "TASK-003", reason: "wave 1 verify" });
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(false);
  });

  it("still dispatches a later wave's test-writer while the wave verify is owed", () => {
    const result = run(baseLedger(), baseInputs({ stage: STAGE }));

    expect(result.actions.some(isWaveAction), show(result)).toBe(true);
    expect(result.actions.some((a) => a.kind === "dispatch" && a.task === "TASK-004" && a.seat === "test-writer"), show(result)).toBe(true);
  });

  it("releases the later wave's developer once a passing wave verify contains the wave's commits", () => {
    const ledger = appended(baseLedger(), waveRun(0));
    const inputs = { ...baseInputs({ stage: STAGE }), waveRecords: [record()] };

    const result = run(ledger, inputs);

    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(true);
    expect(result.actions.some(isWaveAction), show(result)).toBe(false);
    expect(result.actions.some(isWaveWait), show(result)).toBe(false);
  });

  it("names the incomplete task in the hold while a wave task is reopened", () => {
    const ledger = appended(baseLedger(), [...waveRun(0), "TASK-003: developer dispatched model=sonnet", ...task004TestsReady, "Note TASK-001: reopened — review 1a2b3c4d"]);
    const inputs = { ...baseInputs({ stage: STAGE }), waveRecords: [record()] };

    const result = run(ledger, inputs);

    expect(result.actions, show(result)).toContainEqual({ kind: "wait", task: "TASK-004", reason: "wave 1 verify — TASK-001 incomplete" });
    expect(developerDispatch(result, "TASK-004"), show(result)).toBe(false);
  });

  it("owes the wave verify again after a fix commit the passing run does not contain, holding new developers but not cancelling running ones", () => {
    const ledger = appended(baseLedger(), [...waveRun(0), "TASK-003: developer dispatched model=sonnet", ...task004TestsReady, ...task001Refixed]);
    // The pass ran before 9ab0123 landed: its sha does not contain every commit now named for wave 1.
    const inputs = { ...baseInputs({ stage: STAGE }), waveRecords: [record({ contains: false })] };

    const result = run(ledger, inputs);

    expect(result.actions, show(result)).toContainEqual(VERIFY_WAVE_1);
    expect(result.actions, show(result)).toContainEqual({ kind: "wait", task: "TASK-004", reason: "wave 1 verify" });
    expect(developerDispatch(result, "TASK-004"), show(result)).toBe(false);
    expect(result.inFlight, show(result)).toContainEqual({ task: "TASK-003", seat: "developer" });
  });

  it("lists an open wave verify for a re-run on --resume", () => {
    const ledger = appended(baseLedger(), ["wave 1: verify started"]);

    const result = run(ledger, baseInputs({ stage: STAGE }), true);

    expect(result.actions, show(result)).toContainEqual(VERIFY_WAVE_1);
    expect(result.actions.some((a) => a.kind === "verify"), show(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A failed wave verify
// ---------------------------------------------------------------------------

describe("kf next with stage commands pinned: a failed wave verify", () => {
  const failed = (): { ledger: string; inputs: LoopInputs } => ({
    ledger: appended(baseLedger(), waveRun(1)),
    inputs: { ...baseInputs({ stage: STAGE }), waveRecords: [record({ exit: 1 })] },
  });

  it("prints the Wave verify decide and keeps the later wave's developers held", () => {
    const { ledger, inputs } = failed();

    const result = run(ledger, inputs);

    const [decide] = decides(result, "Wave verify");
    expect(decide, show(result)).toBeDefined();
    expect(decide.task).toBeUndefined();
    expect(decide.reason).toBe("wave 1 failed");
    // The reopen alternative names the task to reopen: a placeholder or one concrete wave-1 task.
    expect(decide.closes).toMatch(/^Note TASK-(?:NNN|001|002): reopened — wave 1 or Note wave 1: decided — <what>$/);
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(false);
    expect(result.actions.some((a) => a.kind === "wait" && a.task === "TASK-003"), show(result)).toBe(true);
  });

  it("owes the reopened task a developer round after a reopened — wave note, closing the decide", () => {
    const { ledger, inputs } = failed();
    // The decide is open before the note, so its absence after it is the note's doing.
    const open = run(ledger, inputs);
    expect(decides(open, "Wave verify"), show(open)).toHaveLength(1);

    const result = run(appended(ledger, ["Note TASK-002: reopened — wave 1"]), inputs);

    expect(developerDispatch(result, "TASK-002"), show(result)).toBe(true);
    expect(decides(result, "Wave verify"), show(result)).toEqual([]);
  });

  it("owes the wave verify again once the reopened task completes again", () => {
    const { ledger, inputs } = failed();
    const refixed = appended(ledger, [
      "Note TASK-002: reopened — wave 1",
      "TASK-002: developer dispatched model=sonnet round=1",
      "TASK-002: developer done status=DONE",
      "Note TASK-002: commits 7cd4567",
      "TASK-002: review package 7cd4567",
      "TASK-002: verify started",
      "TASK-002: code-reviewer dispatched model=sonnet round=1",
      "TASK-002: verify done exit=0",
      "TASK-002: code-reviewer done status=clean",
      "TASK-002: fix round 1/5 (wave verify failure fixed)",
      "TASK-002: complete (commits def5678,7cd4567, review clean)",
    ]);

    const result = run(refixed, inputs);

    expect(result.actions, show(result)).toContainEqual(VERIFY_WAVE_1);
    expect(decides(result, "Wave verify"), show(result)).toEqual([]);
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(false);
  });

  it("closes the decide with a decided note and owes a new wave verify", () => {
    const { ledger, inputs } = failed();

    const result = run(appended(ledger, ["Note wave 1: decided — flaky"]), inputs);

    expect(decides(result, "Wave verify"), show(result)).toEqual([]);
    expect(result.actions, show(result)).toContainEqual(VERIFY_WAVE_1);
  });

  it("prints the exit-3 decide for a wave verify that exited 3", () => {
    const result = run(appended(baseLedger(), waveRun(3)), baseInputs({ stage: STAGE }));

    expect(result.actions, show(result)).toContainEqual({
      kind: "decide",
      rule: "Wave verify exit 3",
      reason: "wave 1 verify exited 3",
      closes: "wave 1: verify started or Note wave 1: decided — <what>",
    });
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(false);
  });

  it("closes the exit-3 decide with a new wave verify start", () => {
    const ledger = appended(baseLedger(), [...waveRun(3), "wave 1: verify started"]);

    const result = run(ledger, baseInputs({ stage: STAGE }));

    expect(decides(result, "Wave verify exit 3"), show(result)).toEqual([]);
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No stage commands: the output of today
// ---------------------------------------------------------------------------

describe("kf next with no stage commands", () => {
  it("prints no wave verify and no wave hold on a two-wave ledger with harness.verify absent", () => {
    const inputs = baseInputs();

    const result = run(baseLedger(), inputs);

    expect(inputs.stageCommands ?? []).toEqual([]);
    expect(result.actions.some(isWaveAction), show(result)).toBe(false);
    expect(result.actions.some(isWaveWait), show(result)).toBe(false);
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(true);
  });

  it("prints no wave verify and no wave hold with an empty harness.verify.stage, even after a failed wave run", () => {
    const inputs = { ...baseInputs(), stageCommands: [] as string[][], waveRecords: [record({ exit: 1 })] };
    const ledger = appended(baseLedger(), waveRun(1));

    const result = run(ledger, inputs);

    expect(result.actions.some(isWaveAction), show(result)).toBe(false);
    expect(result.actions.some(isWaveWait), show(result)).toBe(false);
    expect(decides(result, "Wave verify"), show(result)).toEqual([]);
    expect(developerDispatch(result, "TASK-003"), show(result)).toBe(true);
  });

  it.each(["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"])(
    "prints no wave verify and no wave hold for the existing %s fixture",
    (name) => {
      const root = join(scratch("kf-next-waves-off-"), "repo");
      const item = join(root, ".works", "implementation", ITEM_FOLDER);
      mkdirSync(item, { recursive: true });
      writeConfig(root);
      cpSync(join(FIXTURES, name), item, { recursive: true });
      const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir: item, folder: ITEM_FOLDER, meta: META };
      const read = readLoopInputs(root, feature);
      if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);

      for (const resume of [false, true]) {
        const result = run(readFileSync(join(item, "loop", "progress.md"), "utf8"), read.inputs, resume);
        expect(result.actions.some(isWaveAction), show(result)).toBe(false);
        expect(result.actions.some(isWaveWait), show(result)).toBe(false);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Bounded exploration of a two-wave plan with stage commands pinned
// ---------------------------------------------------------------------------

describe("kf next over every state an obedient session reaches on a two-wave plan with a wave verify", () => {
  const WAVE_OPTS: ExploreOptions = { maxDepth: 80, maxStates: 4_000, faultBudget: 1, findingsBudget: 0, faults: "cross-task", happyBudget: 120 };

  for (const plan of Object.keys(WAVE_PLANS)) {
    it(`${plan}: no task waiting on a wave lacks a witness and no no-rule stop`, () => {
      const report = explore(WAVE_PLANS[plan](2), WAVE_OPTS);

      // The search reached the barrier itself, so the verdict below is about the wave tier.
      expect(report.coverage["wave verify printed"] ?? 0).toBeGreaterThan(0);
      expect(report.coverage["wave wait printed"] ?? 0).toBeGreaterThan(0);
      expect(report.coverage["wave decide printed"] ?? 0).toBeGreaterThan(0);
      const listed = (clause: string): string[] =>
        report.violations.filter((v) => v.clause === clause).map((v) => `${v.task ?? ""}: ${v.detail} after ${v.steps.map((s) => s.body).join(" | ")}`);
      expect(listed("(b)")).toEqual([]);
      expect(listed("fail-safe")).toEqual([]);
    }, 300_000);
  }
});

// ---------------------------------------------------------------------------
// The built `kf next` on a git repository: containment from git and the printed lines
// ---------------------------------------------------------------------------

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function commitAt(dir: string, file: string, message: string, when: string): string {
  writeFileSync(join(dir, file), `export const v = ${JSON.stringify(message)};\n`);
  gitIn(dir, "add", file);
  execFileSync("git", ["-C", dir, "commit", "-qm", message], { env: { ...process.env, GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } });
  return gitIn(dir, "rev-parse", "HEAD");
}

interface GitRepo {
  root: string;
  item: string;
  a: string;
  b: string;
}

/** A git repository with the base fixture whose wave-1 commits are real: TASK-001's `a`, TASK-002's `b`. */
function gitRepo(): GitRepo {
  const root = join(scratch("kf-next-waves-cli-"), "repo");
  mkdirSync(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".works/\n.worktrees/\n");
  gitIn(root, "add", "-A");
  execFileSync("git", ["-C", root, "commit", "-qm", "init"], { env: { ...process.env, GIT_COMMITTER_DATE: "2026-11-07T09:00:00+07:00", GIT_AUTHOR_DATE: "2026-11-07T09:00:00+07:00" } });
  ensureWorksStructure(root);
  writeConfig(root, { stage: STAGE });
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(join(item, "loop"), { recursive: true });
  cpSync(BASE, item, { recursive: true });
  writeFileSync(join(item, ".kfw.json"), `${JSON.stringify(META, null, 2)}\n`);
  // Dated after each task's developer dispatch in the ledger (10:09 and 10:10 +07:00).
  const a = commitAt(root, "a.ts", "TASK-001: a", "2026-11-07T10:10:30+07:00");
  const b = commitAt(root, "b.ts", "TASK-002: b", "2026-11-07T10:15:30+07:00");
  const ledgerPath = join(item, "loop", "progress.md");
  writeFileSync(ledgerPath, readFileSync(ledgerPath, "utf8").replaceAll("abc1234", a.slice(0, 7)).replaceAll("def5678", b.slice(0, 7)));
  return { root, item, a, b };
}

function writeWaveRecord(item: string, sha: string, exit: 0 | 1): void {
  const rec = {
    at: "2026-11-07T10:31:30+07:00",
    sha,
    clean: true,
    commands: [{ argv: STAGE[0], outcome: "exit", code: exit }],
    outputSha256: "0".repeat(64),
    exit,
    wave: 1,
  };
  writeFileSync(join(item, "loop", "stage-verify.jsonl"), `${JSON.stringify(rec)}\n`);
}

function kf(root: string, ...argv: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [KF, ...argv], { cwd: root, encoding: "utf8", env: process.env });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

describe("kf next on a repository with stage commands pinned", () => {
  it("prints the wave verify line and the wave hold, and the same action in --json", () => {
    const repo = gitRepo();

    const text = kf(repo.root, "next", "demo");
    const json = kf(repo.root, "next", "demo", "--json");

    expect(text.code, text.stdout + text.stderr).toBe(0);
    const lines = text.stdout.split("\n");
    expect(lines, text.stdout).toContain("verify wave 1: kf verify demo --wave 1");
    expect(lines, text.stdout).toContain("wait TASK-003: wave 1 verify");
    expect(json.code, json.stdout + json.stderr).toBe(0);
    expect((JSON.parse(json.stdout) as NextResult).actions).toContainEqual(VERIFY_WAVE_1);
  });

  it("releases the later wave once a passing record's sha contains both wave commits, and owes the verify again after a fix commit it does not contain", () => {
    const repo = gitRepo();
    writeWaveRecord(repo.item, repo.b, 0);
    const ledgerPath = join(repo.item, "loop", "progress.md");
    stampAt = LAST_BASE_STAMP;
    writeFileSync(ledgerPath, appended(readFileSync(ledgerPath, "utf8"), waveRun(0)));

    const before = kf(repo.root, "next", "demo", "--json");

    expect(before.code, before.stdout + before.stderr).toBe(0);
    const beforeResult = JSON.parse(before.stdout) as NextResult;
    expect(developerDispatch(beforeResult, "TASK-003"), show(beforeResult)).toBe(true);
    expect(beforeResult.actions.some(isWaveAction), show(beforeResult)).toBe(false);

    // The session dispatches TASK-003's developer; TASK-004's tests land; review reopens TASK-001 and a fix commit
    // lands after the passing run's sha.
    const ahead = appended(readFileSync(ledgerPath, "utf8"), ["TASK-003: developer dispatched model=sonnet", ...task004TestsReady, "Note TASK-001: reopened — review 1a2b3c4d", "TASK-001: developer dispatched model=sonnet round=1"]);
    writeFileSync(ledgerPath, ahead);
    const fix = commitAt(repo.root, "a2.ts", "TASK-001: fix", new Date(stampAt + 30_000).toISOString());
    const fix7 = fix.slice(0, 7);
    writeFileSync(
      ledgerPath,
      appended(ahead, [
        "TASK-001: developer done status=DONE",
        `Note TASK-001: commits ${fix7}`,
        `TASK-001: review package ${fix7}`,
        "TASK-001: verify started",
        "TASK-001: code-reviewer dispatched model=sonnet round=1",
        "TASK-001: verify done exit=0",
        "TASK-001: code-reviewer done status=clean",
        "TASK-001: fix round 1/5 (review findings fixed)",
        `TASK-001: complete (commits ${repo.a.slice(0, 7)},${fix7}, review clean)`,
      ]),
    );

    const after = kf(repo.root, "next", "demo");

    expect(after.code, after.stdout + after.stderr).toBe(0);
    const lines = after.stdout.split("\n");
    expect(lines, after.stdout).toContain("verify wave 1: kf verify demo --wave 1");
    expect(lines, after.stdout).toContain("wait TASK-004: wave 1 verify");
    expect(lines.some((l) => l.startsWith("dispatch developer TASK-004")), after.stdout).toBe(false);
    const flight = lines.slice(lines.indexOf("In flight:") + 1);
    expect(lines.includes("In flight:") && flight.some((l) => l.includes("TASK-003") && l.includes("developer")), after.stdout).toBe(true);
  });
});
