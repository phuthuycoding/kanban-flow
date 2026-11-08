import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import { readLoopInputs } from "../workflow/next/inputs.js";
import { schedule } from "../workflow/next/schedule.js";
import { scheduleLegacy } from "../workflow/next/schedule-legacy.js";
import type { Action, InFlight, LedgerState, LoopInputs, NextResult } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";

// The state machine beside the scheduler it replaces, on every ledger the old one was tested on. A difference is
// allowed only when an entry of DIFF_ALLOWED explains it: an audited defect the machine removes (keyed by its audit
// id), or a ruling that changed what kf next prints. Any other difference is a regression of the switch.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "kf-next");
const AUDIT = join(FIXTURES, "audit");
const FIXTURE_CASES = ["fresh", "mid-wave", "resume-orphan", "contention", "reopen", "legacy-fix-queued"];
const REPLAY = "replay-adaptive-cap";

// ---------------------------------------------------------------------------
// One difference between the two schedulers
// ---------------------------------------------------------------------------

interface Difference {
  /** The fixture case, `replay-adaptive-cap`, or the audit id. */
  source: string;
  audit: boolean;
  /** Ledger lines read, header included. */
  prefix: number;
  resume: boolean;
  legacy: NextResult;
  next: NextResult;
  /** Actions printed by one side only, compared as a multiset. */
  onlyLegacy: Action[];
  onlyNext: Action[];
  inFlightChanged: boolean;
  nChanged: boolean;
}

/** A canonical text of `x`: object keys sorted, so two actions built in another key order compare equal. */
const key = (x: unknown): string =>
  JSON.stringify(x, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** The items of `a` not matched one-for-one in `b`. */
function minus<T>(a: T[], b: T[]): T[] {
  const left = b.map(key);
  return a.filter((x) => {
    const i = left.indexOf(key(x));
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

const sortedInFlight = (f: InFlight[]): string[] => f.map(key).sort();

type Dispatch = Extract<Action, { kind: "dispatch" }>;
const isDispatch = (a: Action): a is Dispatch => a.kind === "dispatch";

/** Each entry explains a class of differences; `explains` reads the difference alone, never the ledger behind it. */
interface Allowed {
  why: string;
  explains: (d: Difference) => boolean;
}

/** The audited defects: on its own ledger the machine prints what the audit's expected.json asks, so any change there is that defect's. */
const AUDITED = (id: string, why: string): [string, Allowed] => [id, { why, explains: (d) => d.audit && d.source === id }];

const DIFF_ALLOWED: Record<string, Allowed> = Object.fromEntries([
  AUDITED("routed-target-completes-same-call", "a task a failure is routed into does not complete in the same call"),
  AUDITED("seat-status-closed-by-note-no-redispatch", "a seat status closed by a decided note goes on to the seat's successor"),
  AUDITED("breaker-minimal-fix-not-named", "the minimal fix past the Breaker names its fresh developer"),
  AUDITED("record-accepts-unscheduled-status-exit", "an unknown seat status or verify exit gets a decide"),
  AUDITED("verify-routed-to-completed", "a verify routed to a completed task gets the Verify routed decide"),
  AUDITED("breaker-park-plus-minimal-fix-completes", "a minimal-fix note never forms a parked closure"),
  AUDITED("breaker-minimal-fix-silent", "the minimal fix after the Breaker is never silent"),
  AUDITED("seat-status-closed-by-ruling-silent", "a Ruling naming the task closes its seat status gate"),
  AUDITED("blocked-decided-commit-missing", "a BLOCKED developer closed by a decision with no commit is owed again"),
  AUDITED("orphan-developer-seat-holds-cap", "an orphan developer seat holds no cap slot"),
  AUDITED("bad-commit-sha-exit3-loop", "shas missing from git log are dropped and named in the Verify exit 3 reason"),
  AUDITED("parallel-own-and-cascade-reviewer", "one reviewer per task at a time (FR-025)"),
  AUDITED("routed-first-verify-not-latest", "a routed failure is answered by any later pass, park or complete"),
  AUDITED("breaker-park-plus-minimal-fix-completes-early", "a stale or at-head verify never counts as the fix's verify"),
  AUDITED("breaker-closed-without-park-silent", "the Breaker stays printed until it closes"),
  AUDITED("reviewer-non-done-decided-silent", "a reviewer gate closed by a decision owes the review again"),
  AUDITED("breaker-mixed-fix-completes-early", "no completion while a re-run is held or running"),
  AUDITED("fix-without-new-commit", "a fix with no new commit gets Commit missing"),
  AUDITED("breaker-decided-before-parked-silent", "the Breaker close is order-free"),
  AUDITED("fix-failure-false-positive-stop", "a pre-fix verify is not the minimal fix's verify"),
  AUDITED("cascade-collides-own-review", "the reviewer lane attributes a done to the obligation it holds"),
  AUDITED("two-cascades-one-task-parallel", "two cascade re-reviews of one task run one at a time"),
  AUDITED("routed-to-task-that-completes", "a task a failure is routed into does not complete before it answers"),
  AUDITED("verify-waits-unreleasable", "a verify wait nothing can release is a stop"),
  AUDITED("complete-beside-owed-resume-dev-phantom-seat", "no complete beside an owed resume developer"),
  AUDITED("lost-running-rerun-dropped-on-resume", "a lost running re-run is re-issued under resume"),
  AUDITED("resume-seats-filtered-by-holds-vanish", "resumed seats are exempt from holds"),
  AUDITED("cascade-and-own-review-share-one-seat-key", "seats are keyed by dispatch line"),
  AUDITED("resume-actions-dropped-by-holds-become-phantoms", "holds apply by origin"),
  AUDITED("lost-contention-rerun-held-by-cap-is-forgotten", "a lost contention re-run is re-armed and released below the cap"),
  AUDITED("unknown-or-complete-task-open-developer-eats-cap", "the pool excludes unknown and complete tasks"),
  AUDITED("chain-subagent-seat-resumed-as-new-spawn", "a resumed inline seat stays inline"),
  AUDITED("stacked-reviewer-dispatch-one-done", "a stacked reviewer dispatch puts the old obligation back to owed"),
  AUDITED("breaker-decided-dead-end", "the Breaker closes text names both forms and is re-printed until it closes"),
  AUDITED("seat-status-decided-no-redispatch", "a decided seat status goes on to its successor"),
  AUDITED("implemented-dependency-never-finished", "an implemented dependency releases its dependents"),
  AUDITED("commit-missing-redispatch-keeps-decide", "a running re-dispatch closes Commit missing"),
  AUDITED("fix-done-without-new-commit", "a fix round DONE with no new commit gets Commit missing"),
  [
    "seat-order-developers-first",
    {
      // Carried item 6 (the arbiter's seat order): `kf:implement` lists the ready seats as developers under the cap,
      // then test-writers, then reviewers; the old scheduler ranked test-writers first. Same actions, other order.
      why: "developers are listed before test-writers, as kf:implement lists the ready seats",
      explains: (d) => {
        if (d.onlyLegacy.length > 0 || d.onlyNext.length > 0 || d.inFlightChanged || d.nChanged) return false;
        const strip = (r: NextResult): string[] => r.actions.filter((a) => !isDispatch(a)).map(key);
        if (key(strip(d.legacy)) !== key(strip(d.next))) return false;
        const seats = d.next.actions.filter(isDispatch).map((a) => a.seat);
        const firstTestWriter = seats.indexOf("test-writer");
        return firstTestWriter === -1 || !seats.slice(firstTestWriter).includes("developer");
      },
    },
  ],
]);

// ---------------------------------------------------------------------------
// Fixtures through the real readers
// ---------------------------------------------------------------------------

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ITEM_FOLDER = "demo_20261107_1200";
const META = { schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200" };

function loadFixture(dir: string): { ledger: string; inputs: LoopInputs } {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "kf-next-diff-"))), "repo");
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

function parse(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`ledger refused: ${JSON.stringify(read.repair)}`);
  return read.state;
}

function compare(source: string, audit: boolean, prefix: number, resume: boolean, state: LedgerState, inputs: LoopInputs): Difference | null {
  const legacy = scheduleLegacy(state, inputs, { resume });
  const next = schedule(state, inputs, { resume });
  if (key(legacy) === key(next)) return null;
  return {
    source,
    audit,
    prefix,
    resume,
    legacy,
    next,
    onlyLegacy: minus(legacy.actions, next.actions),
    onlyNext: minus(next.actions, legacy.actions),
    inFlightChanged: key(sortedInFlight(legacy.inFlight)) !== key(sortedInFlight(next.inFlight)),
    nChanged: legacy.n !== next.n,
  };
}

/** Every difference no DIFF_ALLOWED entry explains, as a readable line. */
function untagged(diffs: Difference[]): string[] {
  return diffs
    .filter((d) => !Object.values(DIFF_ALLOWED).some((a) => a.explains(d)))
    .map(
      (d) =>
        `${d.source} prefix ${d.prefix} resume=${d.resume}: only legacy ${key(d.onlyLegacy)}; only next ${key(d.onlyNext)}` +
        `${d.inFlightChanged ? `; in flight ${key(d.legacy.inFlight)} → ${key(d.next.inFlight)}` : ""}` +
        `${d.nChanged ? `; n ${d.legacy.n} → ${d.next.n}` : ""}` +
        `${d.onlyLegacy.length + d.onlyNext.length === 0 ? `; order ${key(d.legacy.actions)} → ${key(d.next.actions)}` : ""}`,
    );
}

/** Both schedulers at every prefix of `ledger` (header and first line onward), with and without --resume. */
function everyPrefix(source: string, ledger: string, inputs: LoopInputs): Difference[] {
  const lines = ledger.split("\n");
  const diffs: Difference[] = [];
  for (let i = 2; i <= lines.length; i++) {
    const state = parse(lines.slice(0, i).join("\n"));
    for (const resume of [false, true]) {
      const d = compare(source, false, i, resume, state, inputs);
      if (d !== null) diffs.push(d);
    }
  }
  return diffs;
}

describe("the machine beside the legacy scheduler", () => {
  it.each(FIXTURE_CASES)("differs at no prefix of the %s ledger without an allowed reason", (name) => {
    const { ledger, inputs } = loadFixture(join(FIXTURES, name));
    expect(untagged(everyPrefix(name, ledger, inputs))).toEqual([]);
  });

  it("differs at no prefix of the adaptive-cap replay without an allowed reason", () => {
    const { ledger, inputs } = loadFixture(join(FIXTURES, REPLAY));
    expect(untagged(everyPrefix(REPLAY, ledger, inputs))).toEqual([]);
  });

  const auditIds = readdirSync(AUDIT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it("keys every audit ledger in the allowed differences", () => {
    expect(auditIds.filter((id) => !(id in DIFF_ALLOWED))).toEqual([]);
  });

  it.each(auditIds)("differs on the %s audit ledger only as that audit explains", (id) => {
    const { ledger, inputs } = loadFixture(join(AUDIT, id));
    const state = parse(ledger);
    const diffs = [false, true].flatMap((resume) => {
      const d = compare(id, true, ledger.split("\n").length, resume, state, inputs);
      return d === null ? [] : [d];
    });
    expect(untagged(diffs)).toEqual([]);
  });

  it("gives every allowed difference a reason", () => {
    for (const [name, a] of Object.entries(DIFF_ALLOWED)) expect(a.why.trim(), name).not.toBe("");
  });
});
