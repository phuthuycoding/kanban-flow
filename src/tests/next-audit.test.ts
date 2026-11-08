import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { schedule } from "../workflow/next/schedule.js";
import type { Action, InFlight, LedgerState, LoopInputs, NextResult } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";
import { completionOracle } from "./support/next-oracle.js";

// The liveness audit's ledgers, one fixture each, run through `schedule()`. Each fixture's expected.json holds what
// `kf next` must print once the defect is gone; today's scheduler still has every defect, so each case is an
// expected failure until the state machine replaces it.

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

function assertAudit(loaded: Loaded, expected: Expected): void {
  const resume = expected.resume ?? false;
  const result = schedule(loaded.state, loaded.inputs, { resume });

  // What the audit says kf next must print once the defect is gone.
  for (const item of expected.expect) expect(present(result, item), `missing ${JSON.stringify(item)} in ${show(result)}`).toBe(true);
  for (const item of expected.forbid ?? []) expect(present(result, item), `forbidden ${JSON.stringify(item)} in ${show(result)}`).toBe(false);
  for (const { action, n } of expected.maxCount ?? []) {
    const count = result.actions.filter((a) => matches(a, action)).length;
    expect(count, `more than ${n} of ${JSON.stringify(action)} in ${show(result)}`).toBeLessThanOrEqual(n);
  }

  // Never silent: `finished` or at least one action.
  expect(result.actions.length, `silent output: ${show(result)}`).toBeGreaterThan(0);

  // Every printed complete agrees with the independent oracle, and is never beside another action of its task.
  for (const a of result.actions) {
    if (a.kind !== "complete") continue;
    const verdict = completionOracle(loaded.state, loaded.inputs, a.task);
    expect(verdict.blockers, `complete ${a.task} printed while the oracle says not ready`).toEqual([]);
    const beside = result.actions.filter((b: Action) => b !== a && "task" in b && b.task === a.task);
    expect(beside, `complete ${a.task} printed beside another action of the task`).toEqual([]);
  }

  // Recording each printed write and re-running prints that write no more.
  for (const a of result.actions) {
    if (a.kind !== "write") continue;
    const after = ledgerState(`${loaded.ledger.trimEnd()}\n${filled(a.line)} @ ${WRITE_STAMP}\n`);
    const again = schedule(after, loaded.inputs, { resume: false });
    expect(again.actions.filter((b) => b.kind === "write" && b.line === a.line), `write repeated after recording it: ${a.line}`).toEqual([]);
  }
}

const expectedOf = (id: string): Expected => JSON.parse(readFileSync(join(AUDIT, id, "expected.json"), "utf8")) as Expected;

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
  });
});

describe("schedule on the liveness audit ledgers", () => {
  // Expected failures: today's schedule() reproduces each audited defect. The state-machine switch turns them into
  // passing tests.
  it.fails.each(AUDIT_IDS.map((id) => [id, expectedOf(id).behaviour]))("%s: %s", (id) => {
    assertAudit(loadFixture(join(AUDIT, id)), expectedOf(id));
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

  it("refuses a task that a failure is routed into until it passes again", () => {
    const loaded = loadFixture(join(AUDIT, "routed-target-completes-same-call"));
    const verdict = completionOracle(loaded.state, loaded.inputs, "TASK-001");
    expect(verdict.blockers).toContain("the failure TASK-002 routed into the task is unanswered");
  });
});
