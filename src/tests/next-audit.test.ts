import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { schedule } from "../workflow/next/schedule.js";
import { checkLiveness } from "../workflow/next/liveness.js";
import type { Action, InFlight, LedgerState, LoopInputs, NextResult } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";
import { completionOracle } from "./support/next-oracle.js";

// The liveness audit's ledgers, one fixture each, run through `schedule()`. Each fixture's expected.json holds what
// `kf next` must print with the defect gone; `symptomToday` records what the scheduler before the state machine printed.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const AUDIT = join(FIXTURES, "audit");

const AUDIT_IDS = [
  "routed-target-completes-same-call",
  "seat-status-closed-by-note-no-redispatch",
  "breaker-minimal-fix-not-named",
  "record-accepts-unscheduled-status-exit",
  "verify-routed-to-completed",
  "breaker-park-plus-minimal-fix-completes",
  "breaker-minimal-fix-silent",
  "seat-status-closed-by-ruling-silent",
  "blocked-decided-commit-missing",
  "orphan-developer-seat-holds-cap",
  "bad-commit-sha-exit3-loop",
  "parallel-own-and-cascade-reviewer",
  "routed-first-verify-not-latest",
  "breaker-park-plus-minimal-fix-completes-early",
  "breaker-closed-without-park-silent",
  "reviewer-non-done-decided-silent",
  "breaker-mixed-fix-completes-early",
  "fix-without-new-commit",
  "breaker-decided-before-parked-silent",
  "fix-failure-false-positive-stop",
  "cascade-collides-own-review",
  "two-cascades-one-task-parallel",
  "routed-to-task-that-completes",
  "verify-waits-unreleasable",
  "complete-beside-owed-resume-dev-phantom-seat",
  "lost-running-rerun-dropped-on-resume",
  "resume-seats-filtered-by-holds-vanish",
  "cascade-and-own-review-share-one-seat-key",
  "resume-actions-dropped-by-holds-become-phantoms",
  "lost-contention-rerun-held-by-cap-is-forgotten",
  "unknown-or-complete-task-open-developer-eats-cap",
  "chain-subagent-seat-resumed-as-new-spawn",
  "stacked-reviewer-dispatch-one-done",
  "breaker-decided-dead-end",
  "seat-status-decided-no-redispatch",
  "implemented-dependency-never-finished",
  "commit-missing-redispatch-keeps-decide",
  "fix-done-without-new-commit",
];

// ---------------------------------------------------------------------------
// Loading a fixture through the real readers
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };

function writeConfig(root: string): void {
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
}

interface Loaded {
  ledger: string;
  state: LedgerState;
  inputs: LoopInputs;
}

/**
 * Copies a fixture into a temp item folder outside any git repository and reads it. An optional inputs.json
 * replaces input fields a plain folder cannot produce: the branch's git log, or an invalid developer ceiling.
 */
function loadFixture(dir: string): Loaded {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "kf-next-audit-"))), "repo");
  scratchDirs.push(dirname(root));
  const item = join(root, ".works", "implementation", ITEM_FOLDER);
  mkdirSync(item, { recursive: true });
  writeConfig(root);
  cpSync(dir, item, { recursive: true });
  const feature: Feature = { name: "demo", context: "app", stage: "implementation", dir: item, folder: ITEM_FOLDER, meta: META };
  const read = readLoopInputs(root, feature);
  if (!read.ok) throw new Error(`fixture inputs refused: ${read.reason}`);
  const overlay = join(dir, "inputs.json");
  const inputs: LoopInputs = existsSync(overlay) ? { ...read.inputs, ...(JSON.parse(readFileSync(overlay, "utf8")) as Partial<LoopInputs>) } : read.inputs;
  const ledger = readFileSync(join(item, "loop", "progress.md"), "utf8");
  return { ledger, state: ledgerState(ledger), inputs };
}

function ledgerState(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

// ---------------------------------------------------------------------------
// expected.json
// ---------------------------------------------------------------------------

/** A partial action or In-flight entry: every key given must match; a null value means the key is absent. */
type Pattern = Record<string, unknown>;
type Item = { action: Pattern } | { inFlight: Pattern } | { anyOf: Item[] };

interface Expected {
  behaviour: string;
  resume?: boolean;
  /** Each item must be in the output. */
  expect: Item[];
  /** No item may be in the output. */
  forbid?: Item[];
  /** At most `n` actions match. */
  maxCount?: { action: Pattern; n: number }[];
  /**
   * The violations today's scheduler shows on this ledger, in the order `auditViolations` finds them: `missing#i`
   * (expect item i absent), `forbidden#i` (forbid item i printed), `tooMany#i`, `silent` (no action at all),
   * `oracle` (a complete the oracle refuses), `beside` (a complete beside another action of its task), `repeated`
   * (a write printed again after recording it). Pinning them ties each expected failure to its audited defect.
   */
  symptomToday: string[];
}

function matches(actual: object, partial: Pattern): boolean {
  const rec = actual as Record<string, unknown>;
  return Object.entries(partial).every(([k, v]) => (v === null ? !(k in rec) || rec[k] === undefined : rec[k] === v));
}

function present(result: NextResult, item: Item): boolean {
  if ("anyOf" in item) return item.anyOf.some((i) => present(result, i));
  if ("action" in item) return result.actions.some((a) => matches(a, item.action));
  return result.inFlight.some((f: InFlight) => matches(f, item.inFlight));
}

const show = (result: NextResult): string => JSON.stringify({ inFlight: result.inFlight, actions: result.actions }, null, 1);

/** A write's line with its placeholders filled the way a session would before recording it. */
function filled(line: string): string {
  return line.replace(/<file>=<sha> …/, `src/tests/filled.test.ts=${"c".repeat(40)}`).replace(/<[^>]*>/g, "x");
}

const WRITE_STAMP = "2026-11-08T23:59:00+07:00";

interface Violation {
  kind: string;
  detail: string;
}

/** Every way the output breaks what the audit expects, in a fixed order; empty once the defect is gone. */
function auditViolations(loaded: Loaded, expected: Expected): Violation[] {
  const resume = expected.resume ?? false;
  const result = schedule(loaded.state, loaded.inputs, { resume });
  const found: Violation[] = [];
  const add = (kind: string, detail: string): void => void found.push({ kind, detail: `${detail} in ${show(result)}` });

  // What the audit says kf next must print once the defect is gone.
  expected.expect.forEach((item, i) => {
    if (!present(result, item)) add(`missing#${i}`, `missing ${JSON.stringify(item)}`);
  });
  (expected.forbid ?? []).forEach((item, i) => {
    if (present(result, item)) add(`forbidden#${i}`, `forbidden ${JSON.stringify(item)}`);
  });
  (expected.maxCount ?? []).forEach(({ action, n }, i) => {
    if (result.actions.filter((a) => matches(a, action)).length > n) add(`tooMany#${i}`, `more than ${n} of ${JSON.stringify(action)}`);
  });

  // Never silent: `finished` or at least one action.
  // An in-flight entry is a witness (FR-022): a result with no action but a seat in flight is not silent.
  if (result.actions.length === 0 && result.inFlight.length === 0) add("silent", "no action");

  // Every printed complete agrees with the independent oracle, and is never beside another action of its task.
  for (const a of result.actions) {
    if (a.kind !== "complete") continue;
    const verdict = completionOracle(loaded.state, loaded.inputs, a.task);
    if (verdict.blockers.length > 0) add("oracle", `complete ${a.task} printed while the oracle says ${verdict.blockers.join("; ")}`);
    if (result.actions.some((b: Action) => b !== a && "task" in b && b.task === a.task)) add("beside", `complete ${a.task} printed beside another action of the task`);
  }

  // Recording each printed write and re-running prints that write no more.
  for (const a of result.actions) {
    if (a.kind !== "write") continue;
    const after = ledgerState(`${loaded.ledger.trimEnd()}\n${filled(a.line)} @ ${WRITE_STAMP}\n`);
    const again = schedule(after, loaded.inputs, { resume: false });
    if (again.actions.some((b) => b.kind === "write" && b.line === a.line)) add("repeated", `write repeated after recording it: ${a.line}`);
  }
  return found;
}

const RERUN_NOTE: Item = { action: { kind: "write", task: "TASK-001", line: "Note TASK-001: verify rerun — contention EADDRINUSE" } };

// Ruling: TASK-019 disputes upheld. The fixtures are not this task's Files, so the two expectations the ledger cannot
// satisfy as written are widened here: the re-written `verify rerun` note is what a full cap owes, and a re-run whose
// `verify started` has no done is in flight.
const EXPECTED_OVERRIDES: Record<string, (e: Expected) => Expected> = {
  "lost-running-rerun-dropped-on-resume": (e) => ({ ...e, expect: [{ anyOf: [...e.expect, RERUN_NOTE] }] }),
  "lost-contention-rerun-held-by-cap-is-forgotten": (e) => ({
    ...e,
    expect: [{ anyOf: [...e.expect, { inFlight: { task: "TASK-001", seat: "verify" } }, RERUN_NOTE] }],
  }),
};

const expectedOf = (id: string): Expected => {
  const read = JSON.parse(readFileSync(join(AUDIT, id, "expected.json"), "utf8")) as Expected;
  return EXPECTED_OVERRIDES[id]?.(read) ?? read;
};

describe("the liveness audit set", () => {
  it("holds one fixture per audited finding", () => {
    const dirs = readdirSync(AUDIT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect([...dirs].sort()).toEqual([...AUDIT_IDS].sort());
  });

  // A fixture the readers refuse would make its expected failure below pass for the wrong reason.
  it.each(AUDIT_IDS)("reads the %s fixture and names at least one expectation", (id) => {
    const loaded = loadFixture(join(AUDIT, id));
    expect(loaded.state.events.length).toBeGreaterThan(0);
    const expected = expectedOf(id);
    expect(expected.behaviour).toMatch(/\S/);
    expect(expected.expect.length + (expected.forbid?.length ?? 0) + (expected.maxCount?.length ?? 0)).toBeGreaterThan(0);
    expect(expected.symptomToday.length).toBeGreaterThan(0);
  });
});

describe("schedule on the liveness audit ledgers", () => {
  it.each(AUDIT_IDS.map((id) => [id, expectedOf(id).behaviour]))("%s: %s", (id) => {
    expect(auditViolations(loadFixture(join(AUDIT, id)), expectedOf(id))).toEqual([]);
  });

  // Every task that is not complete has a witness in what kf next prints, and the liveness guard's own stop, which
  // only a state with no rule produces, is never among them.
  it.each(AUDIT_IDS)("leaves no task of the %s ledger without a witness and never needs the liveness guard", (id) => {
    const loaded = loadFixture(join(AUDIT, id));
    const { resume = false } = expectedOf(id);
    const result = schedule(loaded.state, loaded.inputs, { resume });
    expect(checkLiveness(result, loaded.state, loaded.inputs), show(result)).toEqual({ silent: [], emptyCloses: [] });
    expect(result.actions.filter((a) => a.kind === "stop" && /kf next has no rule for/.test(a.reason))).toEqual([]);
  });
});

describe("the completion oracle", () => {
  const FIXTURE_CASES = ["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"];

  // The oracle is test support: it must accept every complete today's scheduler prints on ledgers with no audited
  // defect, or its verdicts on the audit set mean nothing.
  it.each(FIXTURE_CASES)("agrees with every complete printed for the %s ledger", (name) => {
    const loaded = loadFixture(join(FIXTURES, name));
    const { resume = false } = JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8")) as { resume?: boolean };
    const result = schedule(loaded.state, loaded.inputs, { resume });
    for (const a of result.actions) {
      if (a.kind === "complete") expect(completionOracle(loaded.state, loaded.inputs, a.task).blockers).toEqual([]);
    }
  });

  it("agrees with every complete printed at every prefix of the adaptive-cap replay", () => {
    const loaded = loadFixture(join(FIXTURES, "replay-adaptive-cap"));
    const lines = loaded.ledger.split("\n");
    const disagreements: string[] = [];
    for (let i = 2; i <= lines.length; i++) {
      const prefix = ledgerState(lines.slice(0, i).join("\n"));
      for (const a of schedule(prefix, loaded.inputs, { resume: false }).actions) {
        if (a.kind !== "complete") continue;
        const verdict = completionOracle(prefix, loaded.inputs, a.task);
        if (!verdict.ready) disagreements.push(`prefix ${i}: complete ${a.task} — ${verdict.blockers.join("; ")}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("refuses a task whose own review came back with findings", () => {
    const loaded = loadFixture(join(AUDIT, "breaker-decided-dead-end"));
    const verdict = completionOracle(loaded.state, loaded.inputs, "TASK-001");
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers).toContain("the latest own review is findings");
  });

  it("accepts a task whose findings are parked with a decided note at the cap", () => {
    const loaded = loadFixture(join(AUDIT, "breaker-closed-without-park-silent"));
    expect(completionOracle(loaded.state, loaded.inputs, "TASK-001")).toEqual({ ready: true, blockers: [] });
  });

  it("refuses a task whose minimal fix past the cap has no developer yet", () => {
    const loaded = loadFixture(join(AUDIT, "breaker-park-plus-minimal-fix-completes"));
    const verdict = completionOracle(loaded.state, loaded.inputs, "TASK-001");
    expect(verdict.blockers).toContain("the minimal fix past the cap has no developer");
  });

  // A one-task ledger the oracle accepts; each case below adds or drops one line to show what blocks completion.
  const READY = [
    "# Task loop ledger — demo — plan: /repo/.works/implementation/demo_20261107_1200/phase-2-implementation-plan.md",
    "Scan: clean @ 2026-11-07T10:00:00+07:00",
    "Ruling: developer cap 2 — start — cost if wrong: x @ 2026-11-07T10:01:00+07:00",
    "TASK-001: test-writer dispatched model=sonnet @ 2026-11-07T10:02:00+07:00",
    "TASK-001: test-writer done status=DONE @ 2026-11-07T10:03:00+07:00",
    `TASK-001: test hashes src/tests/task-001.test.ts=${"e".repeat(40)} @ 2026-11-07T10:04:00+07:00`,
    "TASK-001: developer dispatched model=sonnet @ 2026-11-07T10:05:00+07:00",
    "TASK-001: developer done status=DONE @ 2026-11-07T10:06:00+07:00",
    "Note TASK-001: commits aaaaaaa @ 2026-11-07T10:07:00+07:00",
    "TASK-001: review package aaaaaaa @ 2026-11-07T10:08:00+07:00",
    "TASK-001: verify started @ 2026-11-07T10:09:00+07:00",
    "TASK-001: code-reviewer dispatched model=sonnet @ 2026-11-07T10:10:00+07:00",
    "TASK-001: verify done exit=0 @ 2026-11-07T10:11:00+07:00",
    "TASK-001: code-reviewer done status=clean @ 2026-11-07T10:12:00+07:00",
  ];
  const oracleOn = (lines: string[]) => {
    const { inputs } = loadFixture(join(AUDIT, "seat-status-decided-no-redispatch"));
    return completionOracle(ledgerState(`${lines.join("\n")}\n`), inputs, "TASK-001");
  };
  const without = (prefix: string): string[] => READY.filter((l) => !l.startsWith(prefix));

  it("accepts a task whose seats, verify and own review all finished clean", () => {
    expect(oracleOn(READY)).toEqual({ ready: true, blockers: [] });
  });

  it("refuses a task whose DONE test-writer has no test hashes after it", () => {
    expect(oracleOn(without("TASK-001: test hashes")).blockers).toContain("the test-writer done at line 5 has no test hashes after it");
  });

  it("refuses a task whose DONE fix-round automation-writer has no test hashes after it", () => {
    const lines = [
      ...READY.slice(0, 6),
      "TASK-001: automation-writer dispatched model=sonnet round=1 @ 2026-11-07T10:04:10+07:00",
      "TASK-001: automation-writer done status=DONE @ 2026-11-07T10:04:20+07:00",
      ...READY.slice(6),
    ];
    expect(oracleOn(lines).blockers).toContain("the automation-writer done at line 8 has no test hashes after it");
  });

  it("owes no test hashes after a first-pass automation-writer, whose specs the developer commits unchanged", () => {
    const lines = [
      ...READY.slice(0, 6),
      "TASK-001: automation-writer dispatched model=sonnet @ 2026-11-07T10:04:10+07:00",
      "TASK-001: automation-writer done status=DONE @ 2026-11-07T10:04:20+07:00",
      ...READY.slice(6),
    ];
    expect(oracleOn(lines)).toEqual({ ready: true, blockers: [] });
  });

  it("does not count a review package that repeats noted shas as a later commit", () => {
    const lines = [...READY, "TASK-001: review package aaaaaaa @ 2026-11-07T10:13:00+07:00"];
    expect(oracleOn(lines)).toEqual({ ready: true, blockers: [] });
  });

  it("counts a review package that names a new sha as a later commit", () => {
    const lines = [...READY, "TASK-001: review package aaaaaaa,bbbbbbb @ 2026-11-07T10:13:00+07:00"];
    const { blockers } = oracleOn(lines);
    expect(blockers).toContain("no verify after the latest commit");
    expect(blockers).toContain("the latest own review predates the latest commit");
  });

  it.each(["DONE_WITH_CONCERNS", "BLOCKED"])("accepts a developer %s closed by a commits note", (status) => {
    const lines = [...READY.slice(0, 7), `TASK-001: developer done status=${status} @ 2026-11-07T10:06:00+07:00`, ...READY.slice(8)];
    expect(oracleOn(lines)).toEqual({ ready: true, blockers: [] });
  });

  it.each(["NEEDS_CONTEXT", "WEIRD"])("refuses a developer %s closed only by a commits note", (status) => {
    const lines = [...READY.slice(0, 7), `TASK-001: developer done status=${status} @ 2026-11-07T10:06:00+07:00`, ...READY.slice(8)];
    expect(oracleOn(lines).blockers).toContain(`developer ended ${status} with no closing decision`);
  });

  // A failed minimal fix past the cap leaves the Breaker, which a park and a decided note close (FR-026).
  const FAILED_MINIMAL_FIX = [
    READY[0],
    "TASK-001: developer dispatched model=sonnet round=5 @ 2026-11-07T10:00:00+07:00",
    "TASK-001: developer done status=DONE @ 2026-11-07T10:01:00+07:00",
    "Note TASK-001: commits 0010005 @ 2026-11-07T10:02:00+07:00",
    "TASK-001: code-reviewer dispatched model=sonnet round=5 @ 2026-11-07T10:03:00+07:00",
    "TASK-001: code-reviewer done status=findings @ 2026-11-07T10:04:00+07:00",
    "Note TASK-001: decided — minimal fix past the cap: bound the loop @ 2026-11-07T10:05:00+07:00",
    "TASK-001: developer dispatched model=sonnet @ 2026-11-07T10:06:00+07:00",
    "TASK-001: developer done status=DONE @ 2026-11-07T10:07:00+07:00",
    "Note TASK-001: commits 0010006 @ 2026-11-07T10:07:30+07:00",
    "TASK-001: code-reviewer dispatched model=sonnet @ 2026-11-07T10:08:00+07:00",
    "TASK-001: code-reviewer done status=findings @ 2026-11-07T10:08:30+07:00",
  ];
  const PARKED = [
    "TASK-001: parked — the loop — Ruling: the loop waits for the next item @ 2026-11-07T10:09:00+07:00",
    "Note TASK-001: decided — park the loop @ 2026-11-07T10:10:00+07:00",
  ];
  const VERIFIED = ["TASK-001: verify started @ 2026-11-07T10:11:00+07:00", "TASK-001: verify done exit=0 @ 2026-11-07T10:12:00+07:00"];

  it("accepts a failed minimal fix past the cap once a park and a decided note close the Breaker it left", () => {
    expect(oracleOn([...FAILED_MINIMAL_FIX, ...PARKED, ...VERIFIED])).toEqual({ ready: true, blockers: [] });
  });

  it("accepts an abandoned minimal fix past the cap once a park and a decided note close the Breaker it left", () => {
    const abandoned = [
      ...FAILED_MINIMAL_FIX.slice(0, 8),
      "TASK-001: developer done status=NEEDS_CONTEXT @ 2026-11-07T10:07:00+07:00",
      "Note TASK-001: decided — the fix needs a schema change; abandon it @ 2026-11-07T10:08:00+07:00",
    ];
    const verifiedOnRoundFive = ["TASK-001: verify started @ 2026-11-07T10:11:00+07:00", "TASK-001: verify done exit=0 @ 2026-11-07T10:12:00+07:00"];
    expect(oracleOn([...abandoned, ...PARKED, ...verifiedOnRoundFive])).toEqual({ ready: true, blockers: [] });
  });

  it("accepts a failed minimal fix past the cap closed by a park alone", () => {
    expect(oracleOn([...FAILED_MINIMAL_FIX, PARKED[0], ...VERIFIED])).toEqual({ ready: true, blockers: [] });
  });

  it("judges the fix by the first minimal-fix note, so a second note does not refuse a fix that passed", () => {
    const passedFix = [
      ...FAILED_MINIMAL_FIX.slice(0, -1),
      "TASK-001: code-reviewer done status=clean @ 2026-11-07T10:08:30+07:00",
      "Note TASK-001: decided — minimal fix past the cap: bound the loop again @ 2026-11-07T10:09:00+07:00",
    ];
    expect(oracleOn([...passedFix, ...VERIFIED])).toEqual({ ready: true, blockers: [] });
  });

  it("refuses a park written before the minimal fix's developer is done", () => {
    const [head, ...rest] = FAILED_MINIMAL_FIX;
    // The park sits between the fix developer's dispatch and its done.
    const parkedEarly = [head, ...rest.slice(0, 7), PARKED[0].replace("10:09:00", "10:06:30"), ...rest.slice(7)];
    expect(oracleOn([...parkedEarly, ...VERIFIED]).blockers).toContain("the latest own review is findings");
  });

  it("refuses a parked minimal fix whose developer reported DONE with no commit", () => {
    const doneNoCommit = [...FAILED_MINIMAL_FIX.slice(0, 9), PARKED[0], ...VERIFIED];
    expect(oracleOn(doneNoCommit).blockers).toContain("the latest developer has no commit after its dispatch");
  });

  it("refuses a failed minimal fix past the cap that no park closed after it", () => {
    const [head, ...rest] = FAILED_MINIMAL_FIX;
    const parkedBeforeFix = [head, ...rest.slice(0, 5), ...PARKED.map((l) => l.replace("10:09:00", "10:04:20").replace("10:10:00", "10:04:40")), ...rest.slice(5)];
    expect(oracleOn([...parkedBeforeFix, ...VERIFIED]).blockers).toContain("the latest own review is findings");
  });

  it("refuses a task whose verify still waits on another task's commit", () => {
    const lines = [...READY, "Note TASK-001: verify waits — src/task-002.ts (TASK-002) @ 2026-11-07T10:13:00+07:00"];
    expect(oracleOn(lines).blockers).toContain("the verify wait on TASK-002 is unanswered");
  });

  it("refuses a task whose queued fix has no developer yet", () => {
    const lines = [...READY, "TASK-001: fix queued — developer TASK-002 in flight @ 2026-11-07T10:13:00+07:00"];
    expect(oracleOn(lines).blockers).toContain("the queued fix has no developer");
  });

  it("accepts a developer NEEDS_CONTEXT closed by a decided note once its commit is recorded", () => {
    const lines = [
      ...READY.slice(0, 7),
      "TASK-001: developer done status=NEEDS_CONTEXT @ 2026-11-07T10:06:00+07:00",
      "Note TASK-001: decided — the schema was supplied; go on @ 2026-11-07T10:06:30+07:00",
      ...READY.slice(8),
    ];
    expect(oracleOn(lines)).toEqual({ ready: true, blockers: [] });
  });

  it("refuses a task that a failure is routed into until it passes again", () => {
    const loaded = loadFixture(join(AUDIT, "routed-target-completes-same-call"));
    const verdict = completionOracle(loaded.state, loaded.inputs, "TASK-001");
    expect(verdict.blockers).toContain("the failure TASK-002 routed into the task is unanswered");
  });
});
