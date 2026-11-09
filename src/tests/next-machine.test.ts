import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { liveCap } from "../workflow/next/cap.js";
import { foldWorld } from "../workflow/next/fold.js";
import { JUDGEMENTS } from "../workflow/next/judgements.js";
import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { buildLine, type RecordEvent } from "../workflow/next/record.js";
import { schedule } from "../workflow/next/schedule.js";
import type { Action, JudgementKind, LedgerState, LoopInputs, LoopTask, NextResult, World } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";

// Table totality and closure: every judgement `kf next` can print is closed by each of its closes alternatives. Each
// alternative is written through `kf record`'s line builder onto a ledger that prints the judgement, then folded again:
// the state must move and the judgement must no longer print. A judgement no alternative can close is a dead end.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const FIXTURE_CASES = ["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"];
const NO_RULE = /kf next has no rule for/;

// ---------------------------------------------------------------------------
// Ledger text with real stamps, and a plan
// ---------------------------------------------------------------------------

const HEADER = "# Task loop ledger — demo — plan: /repo/.works/implementation/demo_20261107_1200/phase-2-implementation-plan.md";
const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);
const SEVEN_HOURS = 7 * 3_600_000;

/** The ledger stamp of the `i`-th line: one minute apart, written in +07:00. */
function stampAt(i: number): string {
  return `${new Date(T0 + i * 60_000 + SEVEN_HOURS).toISOString().slice(0, 19)}+07:00`;
}

function ledgerOf(bodies: string[]): string {
  return [HEADER, ...bodies.map((b, i) => `${b} @ ${stampAt(i)}`), ""].join("\n");
}

function parse(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

function planTask(id: string, over: Partial<LoopTask> = {}): LoopTask {
  return { id, dependencies: [], files: [`src/${id.toLowerCase()}.ts`], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"], ...over };
}

function inputsOf(tasks: LoopTask[], over: Partial<LoopInputs> = {}): LoopInputs {
  return {
    feature: "demo",
    kind: "feature",
    level: "standard",
    tasks,
    ceiling: { max: 4, source: "config" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
    ...over,
  };
}

const T1 = "TASK-001";
const T2 = "TASK-002";
const START = ["Scan: clean", "Ruling: developer cap 2 — start — cost if wrong: x"];

const testsReady = (t: string): string[] => [
  `${t}: test-writer dispatched model=sonnet`,
  `${t}: test-writer done status=DONE`,
  `${t}: test hashes src/tests/${t.toLowerCase()}.test.ts=${"e".repeat(40)}`,
];

/** Developer done with one commit, its review package, a verify started and a review dispatched. */
const underReview = (t: string, sha: string, round?: number): string[] => [
  `${t}: developer dispatched model=sonnet${round !== undefined ? ` round=${round}` : ""}`,
  `${t}: developer done status=DONE`,
  `Note ${t}: commits ${sha}`,
  `${t}: review package ${sha}`,
  `${t}: verify started`,
  `${t}: code-reviewer dispatched model=sonnet${round !== undefined ? ` round=${round}` : ""}`,
];

/** A full pass: commit, passing verify, and the review's verdict. */
const pass = (t: string, sha: string, verdict: "clean" | "findings", round?: number): string[] => [
  ...underReview(t, sha, round),
  `${t}: verify done exit=0`,
  `${t}: code-reviewer done status=${verdict}`,
];

/** The first pass with findings, then rounds 1..`last` each with findings and its fix round line (none for `bare`). */
function roundsWithFindings(t: string, prefix: string, last: number, opts: { lastVerdict?: "clean" | "findings"; bareLast?: boolean } = {}): string[] {
  const lines = [...pass(t, `${prefix}0`, "findings")];
  for (let r = 1; r <= last; r++) {
    const verdict = r === last ? (opts.lastVerdict ?? "findings") : "findings";
    lines.push(...pass(t, `${prefix}${r}`, verdict, r));
    if (!(r === last && opts.bareLast)) lines.push(`${t}: fix round ${r}/5 (0 addressed, 1 open — the retry loop)`);
  }
  return lines;
}

const MINIMAL_FIX = (t: string): string => `Note ${t}: decided — minimal fix past the cap: bound the retry loop`;

// ---------------------------------------------------------------------------
// One ledger per judgement kind that prints that judgement
// ---------------------------------------------------------------------------

interface Seed {
  /** The task the judgement is about; absent for an item judgement. */
  task?: string;
  /** The gated seat, for `<seat>`. */
  seat?: string;
  /** The ceiling error, for `<error>`. */
  error?: string;
  bodies: string[];
  inputs: LoopInputs;
  resume?: boolean;
}

const twoTasks = (): LoopInputs => inputsOf([planTask(T1), planTask(T2)]);

/** TASK-001 completed, then reopened from review. */
const completedThenReopened = (t: string, sha: string): string[] => [
  ...testsReady(t),
  ...pass(t, sha, "clean"),
  `${t}: complete (commits ${sha}, review clean)`,
  `Note ${t}: reopened — review 1a2b3c4d`,
];

/** Five fix rounds after a reopen, each with findings, then the `cap reached` note. */
const reopenedAtCap = (): string[] => {
  const lines = [...START, ...completedThenReopened(T1, "aaa0000")];
  for (let r = 1; r <= 5; r++) {
    lines.push(...pass(T1, `bbb000${r}`, "findings", r), `${T1}: fix round ${r}/5 (0 addressed, 1 open — the retry loop)`);
  }
  lines.push(`Note ${T1}: cap reached — the retry loop is still unbounded`);
  return lines;
};

/** The minimal fix past the cap: dispatched with no round, committed, verified, and its review returned findings. */
const failedMinimalFix = (t: string, sha: string): string[] => [MINIMAL_FIX(t), ...pass(t, sha, "findings")];

/**
 * TASK-002 depends on TASK-001 and spent its five rounds, the fifth reviewed clean; TASK-001's round-1 fix commit then
 * owes TASK-002 a cascade re-review, which returns findings with no round left.
 */
function cascadeAtCap(reopened: boolean): string[] {
  const lines = [...START, ...testsReady(T1), ...pass(T1, "a000000", "findings")];
  if (reopened) {
    // Both complete, then TASK-002 reopened and spent its rounds; TASK-001 reopened for the fix that cascades.
    lines.length = 0;
    lines.push(...START, ...testsReady(T1), ...pass(T1, "a000000", "clean"), `${T1}: complete (commits a000000, review clean)`);
    lines.push(...completedThenReopened(T2, "c000000"));
    for (let r = 1; r <= 5; r++) {
      lines.push(...pass(T2, `c00000${r}`, r === 5 ? "clean" : "findings", r));
      lines.push(`${T2}: fix round ${r}/5 (${r === 5 ? "1 addressed, 0 open" : "0 addressed, 1 open"} — the parser)`);
    }
    lines.push(`Note ${T1}: reopened — review 2b3c4d5e`);
  } else {
    lines.push(...testsReady(T2), ...pass(T2, "c000000", "findings"));
    for (let r = 1; r <= 5; r++) {
      lines.push(...pass(T2, `c00000${r}`, r === 5 ? "clean" : "findings", r));
      lines.push(`${T2}: fix round ${r}/5 (${r === 5 ? "1 addressed, 0 open" : "0 addressed, 1 open"} — the parser)`);
    }
  }
  lines.push(
    `${T1}: developer dispatched model=sonnet round=1`,
    `${T1}: developer done status=DONE`,
    `Note ${T1}: commits a000001`,
    `${T2}: cascade re-review owed — after a000001 of ${T1}`,
    `${T2}: code-reviewer dispatched model=sonnet cascade=a000001`,
    `${T2}: code-reviewer done status=findings`,
  );
  return lines;
}

const dependentPlan = (): LoopInputs => inputsOf([planTask(T1), planTask(T2, { dependencies: [T1], wave: 2 })]);

const CEILING_ERROR = "harness.developers.max must be an integer from 1 to 8";
const DRIFT_SHA = "d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";

const SEEDS: Record<JudgementKind, Seed> = {
  conflictScan: { bodies: [], inputs: twoTasks() },
  seatStatus: {
    task: T1,
    seat: "developer",
    bodies: [...START, ...testsReady(T1), `${T1}: developer dispatched model=sonnet`, `${T1}: developer done status=BLOCKED`],
    inputs: twoTasks(),
  },
  commitMissing: {
    task: T1,
    bodies: [...START, ...testsReady(T1), `${T1}: developer dispatched model=sonnet`, `${T1}: developer done status=DONE`],
    inputs: twoTasks(),
  },
  verifyExit2: {
    task: T1,
    bodies: [...START, ...testsReady(T1), ...underReview(T1, "aaa0001"), `${T1}: verify done exit=2`],
    inputs: twoTasks(),
  },
  verifyExit3: {
    task: T1,
    bodies: [...START, ...testsReady(T1), ...underReview(T1, "aaa0001"), `${T1}: verify done exit=3`],
    inputs: twoTasks(),
  },
  verifyExit: {
    task: T1,
    bodies: [...START, ...testsReady(T1), ...underReview(T1, "aaa0001"), `${T1}: verify done exit=137`],
    inputs: twoTasks(),
  },
  // TASK-002's failure is routed to TASK-001, which is already complete.
  verifyRouted: {
    task: T2,
    bodies: [
      ...START,
      ...testsReady(T1),
      ...pass(T1, "aaaaaaa", "clean"),
      `${T1}: complete (commits aaaaaaa, review clean)`,
      ...testsReady(T2),
      `${T2}: developer dispatched model=sonnet`,
      `${T2}: developer done status=DONE`,
      `Note ${T2}: commits bbbbbbb`,
      `${T2}: review package bbbbbbb`,
      `${T2}: verify started`,
      `${T2}: verify done exit=1`,
      `${T2}: code-reviewer dispatched model=sonnet`,
      `${T2}: code-reviewer done status=clean`,
      `Note ${T2}: verify routed — ${T1}`,
    ],
    inputs: dependentPlan(),
  },
  // TASK-001's verify waits for TASK-002, which overlaps it, ranks later and is not open: nothing can release it.
  verifyWaitsUnreleasable: {
    task: T1,
    bodies: [...START, ...testsReady(T1), ...underReview(T1, "aaa0001"), `${T1}: verify done exit=1`, `Note ${T1}: verify waits — src/shared.ts (${T2})`],
    inputs: inputsOf([
      planTask(T1, { files: ["src/shared.ts", "src/task-001.ts"], overlaps: [T2] }),
      planTask(T2, { files: ["src/shared.ts"], overlaps: [T1], wave: 2, dependencies: [T1] }),
    ]),
  },
  breaker: { task: T1, bodies: [...START, ...testsReady(T1), ...roundsWithFindings(T1, "aaa000", 5)], inputs: twoTasks() },
  breakerFixSpent: {
    task: T1,
    bodies: [...START, ...testsReady(T1), ...roundsWithFindings(T1, "aaa000", 5), ...failedMinimalFix(T1, "fff0001")],
    inputs: twoTasks(),
  },
  capStop: { task: T1, bodies: reopenedAtCap(), inputs: twoTasks() },
  capStopFixSpent: { task: T1, bodies: [...reopenedAtCap(), ...failedMinimalFix(T1, "fff0001")], inputs: twoTasks() },
  cascadeAtCapBreaker: { task: T2, bodies: cascadeAtCap(false), inputs: dependentPlan() },
  cascadeAtCapStop: { task: T2, bodies: cascadeAtCap(true), inputs: dependentPlan() },
  invalidCeiling: {
    error: CEILING_ERROR,
    bodies: ["Scan: clean"],
    inputs: inputsOf([planTask(T1)], { ceiling: { max: 1, source: "config", error: CEILING_ERROR } }),
  },
  // Under --resume, the report names a commit dated after the open developer dispatch.
  drift: {
    task: T1,
    resume: true,
    bodies: [...START, ...testsReady(T1), `${T1}: developer dispatched model=sonnet`],
    inputs: inputsOf([planTask(T1)], {
      reportCommits: { [T1]: [DRIFT_SHA.slice(0, 7)] },
      gitLog: [{ sha: DRIFT_SHA, ts: T0 + 60 * 60_000 }],
    }),
  },
  unknownTask: {
    task: "TASK-009",
    bodies: [...START, "TASK-009: test-writer dispatched model=sonnet"],
    inputs: twoTasks(),
  },
};

// ---------------------------------------------------------------------------
// Rendering a closes template into a line kf record writes
// ---------------------------------------------------------------------------

const FREE = "placeholder text";

function render(template: string, seed: Seed): string {
  let line = template;
  if (seed.task !== undefined) line = line.replace(/<task>/g, seed.task);
  if (seed.seat !== undefined) line = line.replace(/<seat>/g, seed.seat);
  if (seed.error !== undefined) line = line.replace(/<error>/g, seed.error);
  return line
    .replace(/<sha7>/g, "abc1234")
    .replace(/ dispatched …$/, " dispatched model=opus")
    .replace(/<[^<>]+>/g, FREE)
    .replace(/…/g, FREE);
}

/** The `kf record` event that writes `line`. */
function eventFor(line: string): RecordEvent {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(TASK-\d+): (\S+) dispatched model=(\S+)$/))) return { event: "dispatched", args: [m[1], m[2]], model: m[3] };
  if ((m = line.match(/^(TASK-\d+): (\S+) done status=(\S+)$/))) return { event: "done", args: [m[1], m[2]], status: m[3] };
  if ((m = line.match(/^(TASK-\d+): verify started$/))) return { event: "verify-started", args: [m[1]] };
  if ((m = line.match(/^Note (TASK-\d+): commits (\S+)$/))) return { event: "commits", args: [m[1], m[2]] };
  if ((m = line.match(/^(TASK-\d+): complete \((.*)\)$/))) return { event: "complete", args: [m[1], m[2]] };
  return { event: "line", args: [line] };
}

/** Appends `lines` through kf record's line builder; a refused line is a closes alternative kf record cannot write. */
function record(ledger: string, lines: string[], at: number): string {
  let text = ledger;
  lines.forEach((line, i) => {
    const built = buildLine(text, eventFor(line));
    if (!built.ok) throw new Error(`kf record refuses '${line}': ${built.reason}`);
    text = `${text.trimEnd()}\n${built.line} @ ${stampAt(at + i)}\n`;
  });
  return text;
}

// ---------------------------------------------------------------------------
// The judgement as printed, and the folded state
// ---------------------------------------------------------------------------

function printed(result: NextResult, kind: JudgementKind, seed: Seed): Action[] {
  const entry = JUDGEMENTS[kind];
  return result.actions.filter((a) => {
    if (a.kind !== entry.form) return false;
    if (a.task !== seed.task) return false;
    return a.kind !== "decide" || a.rule === entry.rule;
  });
}

function folded(state: LedgerState, inputs: LoopInputs): string {
  const world: World = foldWorld(state, inputs, liveCap(state, inputs));
  return JSON.stringify({
    scan: world.scan,
    ceiling: world.ceiling,
    unknown: [...world.unknown.entries()],
    pool: world.pool,
    tasks: [...world.tasks.entries()],
  });
}

const KINDS = Object.keys(JUDGEMENTS) as JudgementKind[];

describe("the judgement table is total", () => {
  it("has a ledger that prints each judgement kind", () => {
    expect(Object.keys(SEEDS).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)("prints the %s judgement on its ledger, with a closes line for a decide", (kind) => {
    const seed = SEEDS[kind];
    const result = schedule(parse(ledgerOf(seed.bodies)), seed.inputs, { resume: seed.resume ?? false });

    const found = printed(result, kind, seed);
    expect(found, JSON.stringify(result.actions, null, 1)).not.toEqual([]);
    for (const a of found) if (a.kind === "decide") expect(a.closes.trim()).not.toBe("");
  });
});

describe("every closes alternative closes its judgement", () => {
  const cases = KINDS.flatMap((kind) => JUDGEMENTS[kind].closes.map((alt, i) => [kind, i, alt.join(" and ")] as const));

  it.each(cases)("%s alternative %i (%s) is recordable, moves the state and stops printing the judgement", (kind, i) => {
    const seed = SEEDS[kind];
    const opts = { resume: seed.resume ?? false };
    const before = ledgerOf(seed.bodies);
    const lines = JUDGEMENTS[kind].closes[i].map((t) => render(t, seed));

    const after = record(before, lines, seed.bodies.length + 1);

    const stateBefore = parse(before);
    const stateAfter = parse(after);
    expect(printed(schedule(stateBefore, seed.inputs, opts), kind, seed), "the ledger prints the judgement before").not.toEqual([]);
    expect(folded(stateAfter, seed.inputs), "the folded state moves").not.toBe(folded(stateBefore, seed.inputs));
    const again = schedule(stateAfter, seed.inputs, opts);
    expect(printed(again, kind, seed), JSON.stringify(again.actions, null, 1)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The runtime fail-safe never fires on a known ledger
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };

/** Copies a fixture into a temp item folder outside any git repository and reads it; inputs.json overlays inputs. */
function loadFixture(dir: string): { ledger: string; inputs: LoopInputs } {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "kf-next-machine-"))), "repo");
  scratchDirs.push(dirname(root));
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(item, { recursive: true });
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
      },
    }),
  );
  cpSync(dir, item, { recursive: true });
  const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir: item, folder: ITEM_FOLDER, meta: META };
  const read = readLoopInputs(root, feature);
  if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);
  const overlay = join(dir, "inputs.json");
  const inputs: LoopInputs = existsSync(overlay) ? { ...read.inputs, ...(JSON.parse(readFileSync(overlay, "utf8")) as Partial<LoopInputs>) } : read.inputs;
  return { ledger: readFileSync(join(item, "loop", "progress.md"), "utf8"), inputs };
}

/** Every `kf next has no rule` stop printed at any prefix of `ledger`, with and without --resume. */
function failSafes(name: string, ledger: string, inputs: LoopInputs): string[] {
  const lines = ledger.split("\n");
  const found: string[] = [];
  for (let i = 2; i <= lines.length; i++) {
    const state = parse(lines.slice(0, i).join("\n"));
    for (const resume of [false, true]) {
      for (const a of schedule(state, inputs, { resume }).actions) {
        if (a.kind === "stop" && NO_RULE.test(a.reason)) found.push(`${name} prefix ${i} resume=${resume}: ${a.reason}`);
      }
    }
  }
  return found;
}

describe("the liveness guard's stop", () => {
  it.each([...FIXTURE_CASES, "replay-adaptive-cap"])("never appears at any prefix of the %s ledger", (name) => {
    const { ledger, inputs } = loadFixture(join(FIXTURES, name));
    expect(failSafes(name, ledger, inputs)).toEqual([]);
  });

  it("never appears at any prefix of an audit ledger", () => {
    const audit = join(FIXTURES, "audit");
    const found = readdirSync(audit, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => {
        const { ledger, inputs } = loadFixture(join(audit, d.name));
        return failSafes(d.name, ledger, inputs);
      });
    expect(found).toEqual([]);
  });

  it("never appears on a judgement ledger", () => {
    const found = KINDS.flatMap((kind) => {
      const seed = SEEDS[kind];
      return failSafes(kind, ledgerOf(seed.bodies), seed.inputs);
    });
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Explorer findings: minimal ledgers on which kf next stopped with no rule, overlapped two writers, held a lost run
// under --resume, left a commit out of the task's list or completed a task a gate still held
// ---------------------------------------------------------------------------

/** A full commit sha whose first seven characters are `sha7`. */
const fullSha = (sha7: string): string => `${sha7}${"c".repeat(33)}`;

/** Epoch ms just before the `i`-th body line of `ledgerOf`: when a commit or verify block that line reports was made. */
const before = (i: number): number => T0 + i * 60_000 - 30_000;

const FAIL_LOG = "FAIL src/tests/shared.test.ts > keeps the rule: expected 1 to be 2";

/** Two tasks of the same wave rank whose Files overlap on src/shared.ts. */
const overlappingPlan = (over: Partial<LoopInputs> = {}): LoopInputs =>
  inputsOf(
    [
      planTask(T1, { files: ["src/shared.ts", "src/task-001.ts"], overlaps: [T2] }),
      planTask(T2, { files: ["src/shared.ts", "src/task-002.ts"], overlaps: [T1], wave: 2 }),
    ],
    over,
  );

/** The inputs of `bodies`: each `Note T: commits` sha on the branch and in T's report, and a block for each failing verify. */
function inputsFor(bodies: string[], base: LoopInputs, failLog = FAIL_LOG): LoopInputs {
  const gitLog: { sha: string; ts: number }[] = [];
  const reportCommits: Record<string, string[]> = {};
  const verifyRuns: LoopInputs["verifyRuns"] = {};
  bodies.forEach((b, i) => {
    let m: RegExpMatchArray | null;
    if ((m = b.match(/^Note (TASK-\d+): commits (\w+)$/))) {
      gitLog.push({ sha: fullSha(m[2]), ts: before(i) });
      (reportCommits[m[1]] ??= []).push(m[2]);
    } else if ((m = b.match(/^(TASK-\d+): verify done exit=(\d+)$/))) {
      (verifyRuns[m[1]] ??= []).push({ ts: before(i), exit: Number(m[2]), text: m[2] === "0" ? "Test Files 1 passed" : failLog });
    }
  });
  return { ...base, gitLog, reportCommits, verifyRuns };
}

const run = (bodies: string[], inputs: LoopInputs, resume = false): NextResult => schedule(parse(ledgerOf(bodies)), inputs, { resume });

const guardStops = (result: NextResult): Action[] => result.actions.filter((a) => a.kind === "stop" && NO_RULE.test(a.reason));

const show = (result: NextResult): string => JSON.stringify({ inFlight: result.inFlight, actions: result.actions }, null, 1);

/** TASK-001 failed its verify and routed it to TASK-002 after `lines`. */
const routedToT2 = (lines: string[]): string[] => [...lines, `${T1}: verify done exit=1`, `Note ${T1}: verify routed — ${T2}`];

describe("explorer findings (TASK-025)", () => {
  describe("a verify failure routed to a task that has not started", () => {
    const firstPass = routedToT2([
      "Scan: clean",
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: developer done status=DONE`,
      `Note ${T1}: commits 0010001`,
      `${T1}: verify started`,
      `${T1}: code-reviewer dispatched model=sonnet`,
      `${T1}: code-reviewer done status=clean`,
    ]);
    const roundFive = routedToT2([
      ...START,
      ...roundsWithFindings(T1, "aaa000", 4),
      `${T1}: developer dispatched model=sonnet round=5`,
      `${T1}: developer done status=DONE`,
      `Note ${T1}: commits aaa0005`,
      `${T1}: review package aaa0005`,
      `${T1}: verify started`,
      `${T1}: code-reviewer dispatched model=sonnet round=5`,
      `${T1}: code-reviewer done status=clean`,
    ]);
    const parkedAtBreaker = routedToT2([
      ...START,
      ...roundsWithFindings(T1, "aaa000", 5),
      `${T1}: parked — the retry loop — Ruling: the retry loop waits for the next item`,
      `Note ${T1}: decided — park the retry loop`,
      `${T1}: verify started`,
    ]);

    it.each([
      ["in its first pass", firstPass],
      ["in fix round 5", roundFive],
      ["closed at the Breaker by parking", parkedAtBreaker],
    ])("gives the Verify routed decide for the routing task %s, never the liveness guard's stop", (_name, bodies) => {
      const inputs = inputsFor(bodies, overlappingPlan());
      for (const resume of [false, true]) {
        const result = run(bodies, inputs, resume);
        expect(guardStops(result), show(result)).toEqual([]);
        const routed = result.actions.filter((a) => a.kind === "decide" && a.task === T1 && a.rule === JUDGEMENTS.verifyRouted.rule);
        expect(routed, show(result)).toHaveLength(1);
        const [decide] = routed;
        expect(decide.kind === "decide" && decide.closes.trim()).not.toBe("");
      }
    });
  });

  it("gives a decide with closes, never the liveness guard's stop, when a failure is routed into a task inside its minimal fix past the cap", () => {
    const bodies = [
      "Scan: clean",
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: fix round 5/5 (1 addressed, 1 open — the retry loop; commits aaa0005)`,
      `Note ${T1}: reopened — review 1a2b3c4d`,
      `Note ${T1}: cap reached — the retry loop is still unbounded`,
      `Note ${T1}: decided — minimal fix past the cap: bound the loop`,
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: developer done status=DONE`,
      `${T1}: review package 0010001,0010002,0010003,0010004,0010005,0010006,0010007`,
      `${T1}: verify started`,
      `${T1}: code-reviewer dispatched model=sonnet`,
      `${T1}: verify done exit=0`,
      `Note ${T2}: verify routed — ${T1}`,
      `${T1}: code-reviewer done status=clean`,
    ];
    const inputs = inputsFor(bodies, dependentPlan());
    for (const resume of [false, true]) {
      const result = run(bodies, inputs, resume);
      expect(guardStops(result), show(result)).toEqual([]);
      const decides = result.actions.filter((a) => a.kind === "decide" && (a.task === T1 || a.task === T2) && a.closes.trim() !== "");
      expect(decides, show(result)).not.toEqual([]);
    }
  });

  describe("one file-writing seat per overlapping Files", () => {
    // An earlier task's seat waits only while a later overlapping task has a seat in flight.
    const completedT1 = [
      ...START,
      ...testsReady(T1),
      ...pass(T1, "aaa0001", "clean"),
      `${T1}: complete (commits aaa0001, review clean)`,
    ];

    it.each([
      ["with the reopen as the only line before it", ["Scan: clean", `${T2}: test-writer dispatched model=sonnet`, `Note ${T1}: reopened — review 1a2b3c4d`]],
      [
        "after the earlier task completed and was reopened",
        [...completedT1, `${T2}: test-writer dispatched model=sonnet`, `Note ${T1}: reopened — review 1a2b3c4d`],
      ],
    ])("holds a reopened earlier task's fix developer while a later overlapping test-writer is in flight, %s", (_name, bodies) => {
      const result = run(bodies, inputsFor(bodies, overlappingPlan()));
      expect(result.inFlight, show(result)).toContainEqual({ task: T2, seat: "test-writer" });
      expect(
        result.actions.filter((a) => a.kind === "dispatch" && a.task === T1),
        show(result),
      ).toEqual([]);
      expect(
        result.actions.filter((a) => a.kind === "wait" && a.task === T1),
        show(result),
      ).not.toEqual([]);
    });
  });

  it("re-issues a lost plain verify re-run under --resume even when the developer cap is full", () => {
    // A resumed item is exempt from every hold and from the cap: the lost run is re-issued, not held behind the cap.
    const bodies = [`${T1}: verify started`, `${T1}: developer dispatched model=sonnet round=1`, `${T1}: verify done exit=1`, `${T1}: verify started`];
    const inputs = inputsOf([planTask(T1)], { ceiling: { max: 1, source: "config" } });

    const plain = run(bodies, inputs);
    expect(plain.inFlight, show(plain)).toContainEqual({ task: T1, seat: "verify" });

    const resumed = run(bodies, inputs, true);
    expect(
      resumed.actions.filter((a) => a.kind === "verify" && a.task === T1),
      show(resumed),
    ).toHaveLength(1);
  });

  it("puts a UI task's specs commit in the task's commit list, so its verify and review package cover it", () => {
    // The developer commits the automation-writer's specs as a second commit of the task.
    const bodies = [
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: developer done status=DONE`,
      `Note ${T1}: commits 0010001`,
      `${T1}: automation-writer dispatched model=sonnet`,
      `${T1}: automation-writer done status=DONE`,
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: developer done status=DONE`,
    ];
    const base = inputsOf([planTask(T1, { testTypes: ["Unit", "UI"] })], { level: "full", ceiling: { max: 2, source: "config" } });
    const inputs: LoopInputs = {
      ...base,
      reportCommits: { [T1]: ["0010001", "0010002"] },
      gitLog: [
        { sha: fullSha("0010001"), ts: before(1) },
        { sha: fullSha("0010002"), ts: before(6) },
      ],
    };

    const result = run(bodies, inputs);
    const verifies = result.actions.filter((a) => a.kind === "verify" && a.task === T1);
    const packages = result.actions.filter((a) => a.kind === "write" && a.task === T1 && /: review package /.test(a.line));
    const commitNotes = result.actions.filter((a) => a.kind === "write" && a.task === T1 && /^Note TASK-001: commits 0010002$/.test(a.line));
    expect([...verifies, ...packages, ...commitNotes], show(result)).not.toEqual([]);
    for (const v of verifies) expect(v.kind === "verify" && v.command, show(result)).toMatch(/0010002/);
    for (const p of packages) expect(p.kind === "write" && p.line, show(result)).toMatch(/0010002/);
  });

  describe("a developer gate closed only by a commits note", () => {
    const closedByCommits = (status: string): string[] => [
      "Scan: clean",
      `${T1}: developer dispatched model=sonnet`,
      `${T1}: developer done status=${status}`,
      `Note ${T1}: commits 0010001`,
      `${T1}: verify started`,
      `${T1}: code-reviewer dispatched model=sonnet`,
      `${T1}: code-reviewer done status=clean`,
      `${T1}: verify done exit=0`,
    ];
    const completes = (result: NextResult): Action[] => result.actions.filter((a) => a.kind === "complete" && a.task === T1);

    it.each(["NEEDS_CONTEXT", "WEIRD"])("does not complete the task when the developer ended %s", (status) => {
      const bodies = closedByCommits(status);
      const inputs = inputsFor(bodies, inputsOf([planTask(T1)]));
      for (const resume of [false, true]) {
        const result = run(bodies, inputs, resume);
        expect(completes(result), show(result)).toEqual([]);
        expect(guardStops(result), show(result)).toEqual([]);
      }
    });

    // The commits note counts as DONE for these two statuses, so the same ledger still completes.
    it.each(["DONE_WITH_CONCERNS", "BLOCKED"])("still completes the task when the developer ended %s", (status) => {
      const bodies = closedByCommits(status);
      const result = run(bodies, inputsFor(bodies, inputsOf([planTask(T1)])));
      expect(completes(result), show(result)).toHaveLength(1);
    });
  });
});

describe("a parked task with a commit left on the branch", () => {
  // The verify must pass on the task's latest commits (FR-023): a park waives findings, not the commit list.
  const parkedAtBreaker = [
    ...START,
    ...testsReady(T1),
    ...roundsWithFindings(T1, "aaa000", 5),
    `${T1}: parked — the retry loop — Ruling: the retry loop waits for the next item`,
    `Note ${T1}: decided — park the retry loop`,
  ];
  const abandonedFixParked = [
    ...START,
    ...testsReady(T1),
    ...roundsWithFindings(T1, "aaa000", 5),
    MINIMAL_FIX(T1),
    `${T1}: developer dispatched model=sonnet`,
    `${T1}: developer done status=NEEDS_CONTEXT`,
    `Note ${T1}: decided — the fix needs a schema change; abandon it`,
    `${T1}: parked — the retry loop — Ruling: the retry loop waits for the next item`,
  ];

  /** The parked ledger's inputs, plus `bbb0009` in the task's report and on the branch, made before `at`. */
  const withLeftCommit = (bodies: string[], at: number): LoopInputs => {
    const base = inputsFor(bodies, inputsOf([planTask(T1)]));
    return {
      ...base,
      reportCommits: { ...base.reportCommits, [T1]: [...(base.reportCommits[T1] ?? []), "bbb0009"] },
      gitLog: [...base.gitLog, { sha: fullSha("bbb0009"), ts: before(at) }],
    };
  };

  it.each([
    ["parked at the Breaker", parkedAtBreaker],
    ["parked after an abandoned minimal fix", abandonedFixParked],
  ])("records the commit before it completes when %s, then completes after a passing verify", (_name, parked) => {
    const inputs = withLeftCommit(parked, parked.length - 1);

    const first = run(parked, inputs);
    expect(first.actions.filter((a) => a.kind === "complete"), show(first)).toEqual([]);
    expect(
      first.actions.filter((a) => a.kind === "write" && a.task === T1 && a.line === `Note ${T1}: commits bbb0009`),
      show(first),
    ).toHaveLength(1);

    const verified = [...parked, `Note ${T1}: commits bbb0009`, `${T1}: verify started`, `${T1}: verify done exit=0`];
    const runs = { ...inputs.verifyRuns, [T1]: [...(inputs.verifyRuns[T1] ?? []), { ts: before(verified.length - 1), exit: 0, text: "Test Files 1 passed" }] };
    const after = run(verified, { ...inputs, verifyRuns: runs });
    expect(after.actions.filter((a) => a.kind === "complete" && a.task === T1), show(after)).toHaveLength(1);
  });
});

describe("report commits dated at a developer done", () => {
  // The report is read as it is now: a commit dated after the done belongs to a later seat, so it is no commit of this one.
  const bodies = ["Scan: clean", `${T1}: developer dispatched model=sonnet`, `${T1}: developer done status=DONE`];
  const DONE_AT = 2;
  const reportOnly = (ts: number | null): LoopInputs =>
    inputsOf([planTask(T1)], {
      reportCommits: { [T1]: ["0010001"] },
      gitLog: ts === null ? [] : [{ sha: fullSha("0010001"), ts }],
    });
  const commitsNote = (r: NextResult): Action[] => r.actions.filter((a) => a.kind === "write" && a.line === `Note ${T1}: commits 0010001`);
  const commitMissing = (r: NextResult): Action[] =>
    r.actions.filter((a) => a.kind === "decide" && a.task === T1 && a.rule === JUDGEMENTS.commitMissing.rule);

  it("counts a commit dated in the same second as the done line at that done", () => {
    const result = run(bodies, reportOnly(T0 + DONE_AT * 60_000));
    expect(commitsNote(result), show(result)).toHaveLength(1);
    expect(commitMissing(result), show(result)).toEqual([]);
  });

  it("gives Commit missing when the only report commit is dated after the done line", () => {
    const result = run(bodies, reportOnly(T0 + DONE_AT * 60_000 + 1_000));
    expect(commitMissing(result), show(result)).toHaveLength(1);
    expect(commitsNote(result), show(result)).toEqual([]);
  });

  it("counts every report commit at the done when the git log is empty", () => {
    const result = run(bodies, reportOnly(null));
    expect(commitsNote(result), show(result)).toHaveLength(1);
    expect(commitMissing(result), show(result)).toEqual([]);
  });
});

describe("a resume-commit developer's gate closed by a decision", () => {
  // A gate a decided note closes goes on as DONE (FR-014), and a developer that goes on as DONE takes the commit check.
  const bodies = [
    "Scan: clean",
    `${T1}: developer dispatched model=sonnet`,
    `${T1}: developer done status=DONE`,
    `Note ${T1}: commits 0010001`,
    `${T1}: automation-writer dispatched model=sonnet`,
    `${T1}: automation-writer done status=DONE`,
    `${T1}: developer dispatched model=sonnet`,
    `${T1}: developer done status=DONE_WITH_CONCERNS`,
    `Note ${T1}: decided — the specs are fine as written; go on`,
  ];
  const uiPlan = (): LoopInputs => inputsOf([planTask(T1, { testTypes: ["Unit", "UI"] })], { level: "full" });

  it("gives the Commit missing decide, which a commits note closes", () => {
    const inputs = inputsFor(bodies, uiPlan());
    const result = run(bodies, inputs);
    const missing = result.actions.filter((a) => a.kind === "decide" && a.task === T1 && a.rule === JUDGEMENTS.commitMissing.rule);
    expect(missing, show(result)).toHaveLength(1);
    expect(missing[0].kind === "decide" && missing[0].closes).toContain(`Note ${T1}: commits <sha7>`);

    const noted = [...bodies, `Note ${T1}: commits 0010002`];
    const after = run(noted, inputsFor(noted, uiPlan()));
    expect(
      after.actions.filter((a) => a.kind === "decide" && a.task === T1 && a.rule === JUDGEMENTS.commitMissing.rule),
      show(after),
    ).toEqual([]);
  });
});

describe("a route note on a task with no unresolved routed verify", () => {
  const routedDecides = (r: NextResult): Action[] =>
    r.actions.filter((a) => a.kind === "decide" && a.task === T1 && a.rule === JUDGEMENTS.verifyRouted.rule);
  const committed = [
    "Scan: clean",
    `${T1}: developer dispatched model=sonnet`,
    `${T1}: developer done status=DONE`,
    `Note ${T1}: commits 0010001`,
    `${T1}: verify started`,
    `${T1}: code-reviewer dispatched model=sonnet`,
    `${T1}: code-reviewer done status=clean`,
  ];

  it("prints no Verify routed decide when the router's verify already passed", () => {
    const bodies = [...committed, `${T1}: verify done exit=0`, `Note ${T1}: verify routed — ${T2}`];
    const result = run(bodies, inputsFor(bodies, overlappingPlan()));
    expect(routedDecides(result), show(result)).toEqual([]);
    expect(guardStops(result), show(result)).toEqual([]);
  });

  it("prints one Verify routed decide for two identical route notes on one failed verify", () => {
    const bodies = [...committed, `${T1}: verify done exit=1`, `Note ${T1}: verify routed — ${T2}`, `Note ${T1}: verify routed — ${T2}`];
    const result = run(bodies, inputsFor(bodies, overlappingPlan()));
    expect(routedDecides(result), show(result)).toHaveLength(1);
  });
});
