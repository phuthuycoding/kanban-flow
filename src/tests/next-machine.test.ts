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
