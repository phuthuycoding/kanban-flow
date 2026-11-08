import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { routingActions } from "../workflow/next/routing.js";
import type { Action, Cap, LedgerEvent, LedgerState, LoopInputs, LoopTask, Seat } from "../workflow/next/types.js";

const FEATURE = "kf-next";
const BASE = Date.parse("2026-11-01T10:00:00Z");
const at = (minute: number): number => BASE + minute * 60_000;

type EventBody = LedgerEvent extends infer E ? (E extends LedgerEvent ? Omit<E, "line" | "ts"> : never) : never;
type Stamped = [number, EventBody];

/** Events are listed in file order; each carries the minute it is stamped at. */
function ledger(...events: Stamped[]): LedgerState {
  return { events: events.map(([minute, body], i) => ({ ...body, line: i + 3, ts: at(minute) }) as LedgerEvent) };
}

function task(id: string, dependencies: string[] = [], inline = false): LoopTask {
  return { id, dependencies, files: [`src/${id}.ts`], wave: 1, overlaps: [], inline, testTypes: ["Unit"] };
}

function inputs(tasks: LoopTask[], extra: Partial<LoopInputs> = {}): LoopInputs {
  return {
    feature: FEATURE,
    kind: "feature",
    level: null,
    tasks,
    ceiling: { max: 6, source: "default" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
    ...extra,
  };
}

function cap(extra: Partial<Cap> = {}): Cap {
  return { n: 2, ceiling: 6, owed: [], contention: { held: [], running: null, blocksDevelopers: false }, ...extra };
}

const dispatched = (m: number, id: string, seat: Seat, extra: { round?: number; cascade?: string } = {}): Stamped =>
  [m, { type: "dispatched", task: id, seat, model: "opus", ...extra }];
const done = (m: number, id: string, seat: Seat, status: string): Stamped => [m, { type: "done", task: id, seat, status }];
const commits = (m: number, id: string, ...shas: string[]): Stamped => [m, { type: "commits", task: id, shas }];
const verifyStarted = (m: number, id: string): Stamped => [m, { type: "verifyStarted", task: id }];
const verifyDone = (m: number, id: string, exit: number): Stamped => [m, { type: "verifyDone", task: id, exit }];
const decided = (m: number, id: string, what: string): Stamped => [m, { type: "decided", task: id, what }];
const fixRound = (m: number, id: string, round: number): Stamped => [m, { type: "fixRound", task: id, round }];
const complete = (m: number, id: string): Stamped => [m, { type: "complete", task: id, text: "commits a1b2c3d, review clean" }];
const reopened = (m: number, id: string): Stamped => [m, { type: "reopened", task: id, source: "review", execution: "0a1b2c3d" }];

const SHA = "a1b2c3d";
const T1 = "TASK-001";
const T2 = "TASK-002";

/** A first pass of T1: developer committed `SHA`, review dispatched from minute 4. */
const built = (id = T1, sha = SHA, m = 0): Stamped[] => [
  dispatched(m + 1, id, "developer"),
  commits(m + 2, id, sha),
  done(m + 3, id, "developer", "DONE"),
  dispatched(m + 4, id, "code-reviewer"),
];

const of = (actions: Action[], id: string): Action[] => actions.filter((a) => "task" in a && a.task === id);
const developerDispatches = (actions: Action[], id: string) =>
  actions.filter((a): a is Extract<Action, { kind: "dispatch" }> => a.kind === "dispatch" && a.task === id && a.seat === "developer");
const decides = (actions: Action[], id: string) =>
  actions.filter((a): a is Extract<Action, { kind: "decide" }> => a.kind === "decide" && a.task === id);
const stops = (actions: Action[], id: string) =>
  actions.filter((a): a is Extract<Action, { kind: "stop" }> => a.kind === "stop" && a.task === id);
const verifies = (actions: Action[], id: string) =>
  actions.filter((a): a is Extract<Action, { kind: "verify" }> => a.kind === "verify" && a.task === id);
const writes = (actions: Action[]) => actions.filter((a): a is Extract<Action, { kind: "write" }> => a.kind === "write");

const FAILING_RUN = "AssertionError: expected 'a' to be 'b'\n 1 failed";
/** A plain failure block, so the failure is kept rather than read as contention. */
const failLog = (id: string, m: number): Partial<LoopInputs> => ({ verifyRuns: { [id]: [{ ts: at(m), exit: 1, text: FAILING_RUN }] } });

const EXIT_2_STOP = `${T1} verify exit 2: a changed file is outside the task's Files — replan, have the human re-approve, then record Note ${T1}: decided — <what>`;
const CAP_STOP = `${T1} reached the five-round cap after a reopen — the human decides`;

/** One shell word: single quotes, each ' written as '\'' — the form a printed record's free text takes. */
const quoted = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

describe("routing a verify result by exit code", () => {
  it("asks for nothing after a pass with a clean review", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(6, T1, 0), done(7, T1, "code-reviewer", "clean"));
    expect(of(routingActions(state, inputs([task(T1)]), cap()), T1)).toEqual([]);
  });

  it("names no fix round for a failure while the review is still open", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(7, T1, 1));
    const actions = routingActions(state, inputs([task(T1)], failLog(T1, 6)), cap());
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  it("enters fix round 1 with the original developer once the review reports", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(7, T1, 1), done(8, T1, "code-reviewer", "clean"));
    const actions = routingActions(state, inputs([task(T1)], failLog(T1, 6)), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });

  it("names no fix round for a failure the live cap holds as contention", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(7, T1, 1), done(8, T1, "code-reviewer", "clean"));
    const held = cap({ contention: { held: [{ task: T1, atHead: false, kind: "rerun" }], running: null, blocksDevelopers: true } });
    const actions = routingActions(state, inputs([task(T1)], failLog(T1, 6)), held);
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  it("names no fix round for a failure whose contention re-run is running", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(7, T1, 1), done(8, T1, "code-reviewer", "clean"));
    const running = cap({ contention: { held: [], running: T1, blocksDevelopers: true } });
    const actions = routingActions(state, inputs([task(T1)], failLog(T1, 6)), running);
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  it("names no fix round for a failure that owes a contention re-run note", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(7, T1, 1), done(8, T1, "code-reviewer", "clean"));
    const note = `Note ${T1}: verify rerun — contention EADDRINUSE`;
    const owing = cap({ owed: [{ kind: "write", task: T1, line: note, record: `kf record ${FEATURE} line -- ${quoted(note)}` }] });
    const actions = routingActions(state, inputs([task(T1)], failLog(T1, 6)), owing);
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  it("stops the item on exit 2 until a decided note, then names the verify again", () => {
    const before = ledger(...built(), verifyStarted(5, T1), verifyDone(6, T1, 2), done(7, T1, "code-reviewer", "clean"));
    const stopped = routingActions(before, inputs([task(T1)]), cap());
    expect(stops(stopped, T1)).toEqual([{ kind: "stop", task: T1, reason: EXIT_2_STOP }]);
    expect(developerDispatches(stopped, T1)).toEqual([]);
    // The stop repeats on every call until the human's decision is recorded.
    expect(stops(routingActions(before, inputs([task(T1)]), cap()), T1)).toHaveLength(1);

    const after = ledger(...before.events.map((e): Stamped => [(e.ts - BASE) / 60_000, e as EventBody]), decided(8, T1, "plan re-approved"));
    const resumed = routingActions(after, inputs([task(T1)]), cap());
    expect(stops(resumed, T1)).toEqual([]);
    expect(verifies(resumed, T1)).toEqual([
      expect.objectContaining({ kind: "verify", task: T1, command: `kf verify ${FEATURE} --task ${T1} --commits ${SHA}` }),
    ]);
  });

  it("asks for a decision on exit 3 without counting a round, then names the verify again", () => {
    const events = [...built(), verifyStarted(5, T1), verifyDone(6, T1, 3), done(7, T1, "code-reviewer", "clean")];
    const open = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(decides(open, T1)).toEqual([expect.objectContaining({ kind: "decide", task: T1, rule: "Verify exit 3" })]);
    expect(developerDispatches(open, T1)).toEqual([]);

    const closed = routingActions(ledger(...events, decided(8, T1, "flaky runner, re-run")), inputs([task(T1)]), cap());
    expect(decides(closed, T1)).toEqual([]);
    expect(developerDispatches(closed, T1)).toEqual([]);
    expect(verifies(closed, T1)).toEqual([
      expect.objectContaining({ kind: "verify", task: T1, command: `kf verify ${FEATURE} --task ${T1} --commits ${SHA}` }),
    ]);
  });
});

describe("routing a failure another task explains", () => {
  const failed = (): Stamped[] => [
    ...built(),
    dispatched(5, T2, "developer"),
    verifyStarted(6, T1),
    verifyDone(8, T1, 1),
    done(9, T1, "code-reviewer", "clean"),
  ];
  const waits: Stamped = [10, { type: "verifyWaits", task: T1, file: "src/TASK-002.ts", otherTask: T2 }];

  it("waits for the named task's commit and names no fix round", () => {
    const actions = routingActions(ledger(...failed(), waits), inputs([task(T1), task(T2)], failLog(T1, 7)), cap());
    expect(of(actions, T1)).toContainEqual({ kind: "wait", task: T1, reason: `verify waits for ${T2}` });
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(verifies(actions, T1)).toEqual([]);
  });

  it("names an at-head verify once the named task commits", () => {
    const state = ledger(...failed(), waits, commits(11, T2, "e4f5a6b"));
    const actions = routingActions(state, inputs([task(T1), task(T2)], failLog(T1, 7)), cap());
    expect(verifies(actions, T1)).toEqual([
      expect.objectContaining({ kind: "verify", task: T1, command: `kf verify ${FEATURE} --task ${T1} --commits ${SHA} --at-head` }),
    ]);
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(of(actions, T1).filter((a) => a.kind === "wait")).toEqual([]);
  });

  // The named task usually commits through its developer's report, with no commits note in the ledger.
  it("names an at-head verify once the named task's developer reports a commit dated after the note", () => {
    const state = ledger(...failed(), waits, done(11, T2, "developer", "DONE"));
    const plan = inputs([task(T1), task(T2)], {
      ...failLog(T1, 7),
      reportCommits: { [T2]: ["e4f5a6b"] },
      gitLog: [{ sha: SHA, ts: at(2) }, { sha: "e4f5a6b", ts: at(10.5) }],
    });
    const actions = routingActions(state, plan, cap());
    expect(verifies(actions, T1)).toEqual([
      expect.objectContaining({ kind: "verify", task: T1, command: `kf verify ${FEATURE} --task ${T1} --commits ${SHA} --at-head` }),
    ]);
    expect(of(actions, T1).filter((a) => a.kind === "wait")).toEqual([]);
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  it("keeps waiting when the named task's reported commit is dated before the note", () => {
    const state = ledger(...failed(), waits, done(11, T2, "developer", "DONE"));
    const plan = inputs([task(T1), task(T2)], {
      ...failLog(T1, 7),
      reportCommits: { [T2]: ["e4f5a6b"] },
      gitLog: [{ sha: SHA, ts: at(2) }, { sha: "e4f5a6b", ts: at(9) }],
    });
    const actions = routingActions(state, plan, cap());
    expect(of(actions, T1)).toContainEqual({ kind: "wait", task: T1, reason: `verify waits for ${T2}` });
    expect(verifies(actions, T1)).toEqual([]);
  });

  it("moves a routed failure's fix round to the named task", () => {
    const state = ledger(
      ...built(T2, "e4f5a6b", 0),
      done(5, T2, "code-reviewer", "clean"),
      dispatched(6, T1, "developer"),
      commits(7, T1, SHA),
      done(8, T1, "developer", "DONE"),
      dispatched(9, T1, "code-reviewer"),
      verifyStarted(10, T1),
      verifyDone(12, T1, 1),
      done(13, T1, "code-reviewer", "clean"),
      [14, { type: "verifyRouted", task: T1, otherTask: T2 }],
    );
    const actions = routingActions(state, inputs([task(T1), task(T2)], failLog(T1, 11)), cap());
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(developerDispatches(actions, T2)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T2, seat: "developer", mode: "resume", round: 1 }),
    ]);

    // Once the named task's round seat is dispatched, the routed failure names no second round.
    const answered = ledger(...state.events.map((e): Stamped => [(e.ts - BASE) / 60_000, e as EventBody]), dispatched(15, T2, "developer", { round: 1 }));
    const later = routingActions(answered, inputs([task(T1), task(T2)], failLog(T1, 11)), cap());
    expect(developerDispatches(later, T2)).toEqual([]);
    expect(developerDispatches(later, T1)).toEqual([]);
  });

  it("lets a waits note win over a routed note on the same failure", () => {
    const state = ledger(
      ...built(T2, "e4f5a6b", 0),
      done(5, T2, "code-reviewer", "clean"),
      dispatched(6, T1, "developer"),
      commits(7, T1, SHA),
      done(8, T1, "developer", "DONE"),
      dispatched(9, T1, "code-reviewer"),
      verifyStarted(10, T1),
      verifyDone(12, T1, 1),
      done(13, T1, "code-reviewer", "clean"),
      [14, { type: "verifyWaits", task: T1, file: "src/TASK-002.ts", otherTask: T2 }],
      [15, { type: "verifyRouted", task: T1, otherTask: T2 }],
    );
    const actions = routingActions(state, inputs([task(T1), task(T2)], failLog(T1, 11)), cap());
    expect(of(actions, T1)).toContainEqual({ kind: "wait", task: T1, reason: `verify waits for ${T2}` });
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(developerDispatches(actions, T2)).toEqual([]);
  });
});

/** T1 reviewed with findings, then `rounds` full fix rounds each ending in a re-review that still has findings. */
function roundsDone(rounds: number, id = T1): Stamped[] {
  const events: Stamped[] = [...built(id), done(5, id, "code-reviewer", "findings")];
  for (let r = 1; r <= rounds; r++) {
    const m = 10 * r;
    events.push(
      dispatched(m, id, "developer", { round: r }),
      commits(m + 1, id, `${r}${SHA.slice(1)}`),
      done(m + 2, id, "developer", "DONE"),
      dispatched(m + 3, id, "code-reviewer", { round: r }),
      done(m + 4, id, "code-reviewer", "findings"),
      fixRound(m + 5, id, r),
    );
  }
  return events;
}

describe("naming fix rounds", () => {
  it.each([
    [0, 1, "resume"],
    [1, 2, "resume"],
    [2, 3, "resume"],
    [3, 4, "fresh"],
    [4, 5, "fresh"],
  ] as const)("after %i rounds names round %i with a %s developer", (prior, round, mode) => {
    const actions = routingActions(ledger(...roundsDone(prior)), inputs([task(T1)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode, round }),
    ]);
  });

  it("never names a sixth round", () => {
    const actions = routingActions(ledger(...roundsDone(5)), inputs([task(T1)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(actions.filter((a: Action) => a.kind === "dispatch" && a.round === 6)).toEqual([]);
  });

  it("marks an inline task's round developer as inline", () => {
    const actions = routingActions(ledger(...roundsDone(0)), inputs([task(T1, [], true)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1, inline: true }),
    ]);
  });

  it("owes the fix round line once a round's re-review reports", () => {
    const events = roundsDone(1).filter(([, b]) => b.type !== "fixRound");
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    const line = writes(actions).find((w) => w.line.startsWith(`${T1}: fix round 1/5 (`));
    expect(line).toBeDefined();
    // The record carries the text inside the line's parentheses, quoted as one shell word.
    const body = line!.line.slice(`${T1}: fix round 1/5 (`.length, -1);
    expect(line!.record).toBe(`kf record ${FEATURE} fix-round ${T1} 1 -- ${quoted(body)}`);

    const recorded = routingActions(ledger(...roundsDone(1)), inputs([task(T1)]), cap());
    expect(writes(recorded).filter((w) => w.line.startsWith(`${T1}: fix round 1/5`))).toEqual([]);
  });
});

describe("rounds after a reopen", () => {
  it("names a round for a reopened task after a clean review", () => {
    const state = ledger(...built(), verifyStarted(5, T1), verifyDone(6, T1, 0), done(7, T1, "code-reviewer", "clean"), complete(8, T1), reopened(9, T1));
    expect(developerDispatches(routingActions(state, inputs([task(T1)]), cap()), T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });

  it("continues the round count across the reopen", () => {
    const state = ledger(...roundsDone(2), done(60, T1, "code-reviewer", "clean"), complete(61, T1), reopened(62, T1));
    expect(developerDispatches(routingActions(state, inputs([task(T1)]), cap()), T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 3 }),
    ]);
  });

  it("stops a reopened task at the cap and owes its cap reached note, not a breaker", () => {
    const events = [...roundsDone(5), decided(60, T1, "parked the rest"), complete(61, T1), reopened(62, T1)];
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(stops(actions, T1)).toEqual([{ kind: "stop", task: T1, reason: CAP_STOP }]);
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({
        kind: "write",
        line: `Note ${T1}: cap reached — <failure>`,
        record: `kf record ${FEATURE} line -- ${quoted(`Note ${T1}: cap reached — <failure>`)}`,
      }),
    );
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(decides(actions, T1).filter((d) => d.rule === "Breaker")).toEqual([]);
  });

  it("keeps the stop and owes no second note once cap reached is recorded", () => {
    const events: Stamped[] = [
      ...roundsDone(5),
      decided(60, T1, "parked the rest"),
      complete(61, T1),
      reopened(62, T1),
      [63, { type: "capReached", task: T1, failure: "login test still red" }],
    ];
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(stops(actions, T1)).toEqual([{ kind: "stop", task: T1, reason: CAP_STOP }]);
    expect(writes(actions).filter((w) => w.line.includes("cap reached"))).toEqual([]);
    expect(developerDispatches(actions, T1)).toEqual([]);
  });
});

describe("the breaker and round seats", () => {
  it("asks for the breaker after round 5 with findings open, until a decided note", () => {
    const open = routingActions(ledger(...roundsDone(5)), inputs([task(T1)]), cap());
    expect(decides(open, T1)).toEqual([
      expect.objectContaining({ kind: "decide", task: T1, rule: "Breaker", closes: `Note ${T1}: decided — <what>` }),
    ]);
    expect(stops(open, T1)).toEqual([]);

    const events: Stamped[] = [
      ...roundsDone(5),
      [60, { type: "parked", task: T1, finding: "naming nit" }],
      decided(61, T1, "parked one, ruled the other"),
    ];
    const closed = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(decides(closed, T1)).toEqual([]);
    expect(developerDispatches(closed, T1)).toEqual([]);
  });

  it("asks for the breaker for a kept failure after a clean round 5 re-review", () => {
    const events: Stamped[] = [
      ...roundsDone(4),
      dispatched(50, T1, "developer", { round: 5 }),
      commits(51, T1, `5${SHA.slice(1)}`),
      done(52, T1, "developer", "DONE"),
      dispatched(53, T1, "code-reviewer", { round: 5 }),
      done(54, T1, "code-reviewer", "clean"),
      fixRound(55, T1, 5),
      verifyStarted(56, T1),
      verifyDone(58, T1, 1),
    ];
    const actions = routingActions(ledger(...events), inputs([task(T1)], failLog(T1, 57)), cap());
    expect(decides(actions, T1)).toEqual([
      expect.objectContaining({ kind: "decide", task: T1, rule: "Breaker", closes: `Note ${T1}: decided — <what>` }),
    ]);
    expect(developerDispatches(actions, T1)).toEqual([]);
    expect(stops(actions, T1)).toEqual([]);
  });

  it("owes test hashes after a round test-writer, then resumes the developer to commit", () => {
    const events: Stamped[] = [
      ...built(),
      done(5, T1, "code-reviewer", "findings"),
      dispatched(6, T1, "test-writer", { round: 1 }),
      done(7, T1, "test-writer", "DONE"),
    ];
    const owed = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(writes(owed)).toContainEqual(
      expect.objectContaining({
        kind: "write",
        line: `${T1}: test hashes <file>=<sha> …`,
        record: `kf record ${FEATURE} line -- ${quoted(`${T1}: test hashes <file>=<sha> …`)}`,
      }),
    );
    expect(developerDispatches(owed, T1)).toEqual([]);

    const hashed: Stamped = [8, { type: "testHashes", task: T1, files: { "src/tests/x.test.ts": "0123456789abcdef0123456789abcdef01234567" } }];
    const resumed = routingActions(ledger(...events, hashed), inputs([task(T1)]), cap());
    expect(writes(resumed).filter((w) => w.line.includes("test hashes"))).toEqual([]);
    expect(developerDispatches(resumed, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });
});

describe("cascade re-reviews", () => {
  const H = T1;
  const X = "TASK-002";
  const Y = "TASK-003";
  const Z = "TASK-004";
  const FIX = "b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6";
  const FIX7 = FIX.slice(0, 7);
  const plan = (): LoopTask[] => [task(H), task(X, [H]), task(Y), task(Z, [H])];

  /** H reviewed clean and complete; X, Y and Z dispatched; Z complete; H reopened and fixed in round 1. */
  const history = (): Stamped[] => [
    ...built(H),
    done(5, H, "code-reviewer", "clean"),
    complete(6, H),
    dispatched(7, X, "developer"),
    dispatched(8, Y, "developer"),
    ...built(Z, "c0ffee1", 8),
    done(13, Z, "code-reviewer", "clean"),
    complete(14, Z),
    reopened(15, H),
    dispatched(16, H, "developer", { round: 1 }),
    commits(17, H, FIX),
    done(18, H, "developer", "DONE"),
  ];
  const cascadeActions = (actions: Action[], id: string): Action[] =>
    of(actions, id).filter((a) => (a.kind === "write" && a.line.includes("cascade")) || (a.kind === "dispatch" && a.cascade !== undefined));

  it("owes the re-review only to the dependent task that is not complete", () => {
    const actions = routingActions(ledger(...history()), inputs(plan()), cap());
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({
        kind: "write",
        task: X,
        line: `${X}: cascade re-review owed — after ${FIX7} of ${H}`,
        record: `kf record ${FEATURE} cascade-owed ${X} ${FIX7} ${H}`,
      }),
    );
    expect(cascadeActions(actions, Y)).toEqual([]);
    expect(cascadeActions(actions, Z)).toEqual([]);
  });

  it("dispatches the owed re-review with the fix round and sha of the fixed task", () => {
    const owed: Stamped = [19, { type: "cascadeOwed", task: X, sha: FIX7, otherTask: H }];
    const actions = routingActions(ledger(...history(), owed), inputs(plan()), cap());
    expect(writes(actions).filter((w) => w.line.includes("cascade re-review owed"))).toEqual([]);
    expect(cascadeActions(actions, X)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: X, seat: "code-reviewer", mode: "new", round: 1, cascade: FIX7 }),
    ]);
    expect(cascadeActions(actions, Y)).toEqual([]);
    expect(cascadeActions(actions, Z)).toEqual([]);

    const answered = routingActions(ledger(...history(), owed, dispatched(20, X, "code-reviewer", { round: 1, cascade: FIX7 })), inputs(plan()), cap());
    expect(cascadeActions(answered, X)).toEqual([]);
  });

  it("owes the re-review to a task that depends on the fixed one transitively", () => {
    const W = "TASK-005";
    const events = [...history().slice(0, 7), dispatched(7, W, "developer"), ...history().slice(7)];
    const actions = routingActions(ledger(...events), inputs([...plan(), task(W, [X])]), cap());
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({ kind: "write", task: W, line: `${W}: cascade re-review owed — after ${FIX7} of ${H}` }),
    );
  });

  it("owes nothing for a fix commit that landed before the dependent's developer was dispatched", () => {
    const events: Stamped[] = [
      ...built(H),
      done(5, H, "code-reviewer", "findings"),
      dispatched(6, H, "developer", { round: 1 }),
      commits(7, H, FIX),
      done(8, H, "developer", "DONE"),
      dispatched(9, X, "developer"),
    ];
    const actions = routingActions(ledger(...events), inputs(plan()), cap());
    expect(cascadeActions(actions, X)).toEqual([]);
  });

  /** H reviewed with findings; X's developer dispatched; H's round 1 developer reports done with no commits note. */
  const roundWithoutNote = (): Stamped[] => [
    ...built(H),
    done(5, H, "code-reviewer", "findings"),
    dispatched(6, X, "developer"),
    dispatched(7, H, "developer", { round: 1 }),
    done(8, H, "developer", "DONE"),
  ];
  // SHA is H's first-pass commit (before the round), FIX the round developer's.
  const datedLog = [{ sha: SHA, ts: at(2) }, { sha: FIX, ts: at(7.5) }];
  const owedLine = (sha7: string) => `${X}: cascade re-review owed — after ${sha7} of ${H}`;

  it("owes the re-review for a fix whose only sha source is the round's review package", () => {
    const events: Stamped[] = [
      ...roundWithoutNote(),
      [9, { type: "reviewPackage", task: H, shas: [SHA, FIX7] }],
      dispatched(10, H, "code-reviewer", { round: 1 }),
    ];
    const actions = routingActions(ledger(...events), inputs(plan(), { gitLog: datedLog }), cap());
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({ kind: "write", task: X, line: owedLine(FIX7), record: `kf record ${FEATURE} cascade-owed ${X} ${FIX7} ${H}` }),
    );
    // The first-pass commit in the same package is not a fix commit.
    expect(writes(actions).filter((w) => w.line === owedLine(SHA))).toEqual([]);

    const owed: Stamped = [11, { type: "cascadeOwed", task: X, sha: FIX7, otherTask: H }];
    const dispatchedNext = routingActions(ledger(...events, owed), inputs(plan(), { gitLog: datedLog }), cap());
    expect(cascadeActions(dispatchedNext, X)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: X, seat: "code-reviewer", mode: "new", round: 1, cascade: FIX7 }),
    ]);
  });

  it("owes the re-review for a fix whose only sha source is the round developer's report", () => {
    const actions = routingActions(ledger(...roundWithoutNote()), inputs(plan(), { reportCommits: { [H]: [SHA, FIX] }, gitLog: datedLog }), cap());
    expect(writes(actions)).toContainEqual(
      expect.objectContaining({ kind: "write", task: X, line: owedLine(FIX7), record: `kf record ${FEATURE} cascade-owed ${X} ${FIX7} ${H}` }),
    );
    expect(writes(actions).filter((w) => w.line === owedLine(SHA))).toEqual([]);
  });

  it("owes nothing when the round developer's report names only commits dated before the round", () => {
    const actions = routingActions(ledger(...roundWithoutNote()), inputs(plan(), { reportCommits: { [H]: [SHA] }, gitLog: datedLog }), cap());
    expect(cascadeActions(actions, X)).toEqual([]);
  });

  // Ledger stamps have one-second resolution: file order, not the stamp, says which came first.
  it("orders a dispatch and a landing with the same stamp by their place in the ledger", () => {
    const head: Stamped[] = [...built(H), done(5, H, "code-reviewer", "findings"), dispatched(6, H, "developer", { round: 1 })];
    const dispatchFirst = [...head, dispatched(7, X, "developer"), commits(7, H, FIX), done(8, H, "developer", "DONE")];
    expect(writes(routingActions(ledger(...dispatchFirst), inputs(plan()), cap()))).toContainEqual(
      expect.objectContaining({ kind: "write", task: X, line: owedLine(FIX7) }),
    );

    const landingFirst = [...head, commits(7, H, FIX), dispatched(7, X, "developer"), done(8, H, "developer", "DONE")];
    expect(cascadeActions(routingActions(ledger(...landingFirst), inputs(plan()), cap()), X)).toEqual([]);
  });

  /** H and X complete; H reopened and its round 1 fix starts at `m`. */
  const bothComplete = (): Stamped[] => [
    ...built(H),
    done(5, H, "code-reviewer", "clean"),
    complete(6, H),
    ...built(X, "c0ffee1", 6),
    done(11, X, "code-reviewer", "clean"),
    complete(12, X),
    reopened(13, H),
  ];
  const hFix = (m: number): Stamped[] => [dispatched(m, H, "developer", { round: 1 }), commits(m + 1, H, FIX), done(m + 2, H, "developer", "DONE")];

  it("owes nothing for a fix that landed while the dependent was complete, even after the dependent reopens", () => {
    const events = [...bothComplete(), ...hFix(14), reopened(17, X)];
    expect(cascadeActions(routingActions(ledger(...events), inputs(plan()), cap()), X)).toEqual([]);
  });

  it("owes the re-review for a fix that lands after the dependent reopened", () => {
    const events = [...bothComplete(), reopened(14, X), ...hFix(15)];
    expect(writes(routingActions(ledger(...events), inputs(plan()), cap()))).toContainEqual(
      expect.objectContaining({ kind: "write", task: X, line: owedLine(FIX7) }),
    );
  });
});

describe("seats that end without DONE", () => {
  const seats: Seat[] = ["test-writer", "developer", "code-reviewer", "automation-writer"];
  const statuses = ["NEEDS_CONTEXT", "BLOCKED", "DONE_WITH_CONCERNS"];
  const cases = seats.flatMap((seat) => statuses.map((status) => [seat, status] as const));

  /** T1's seat ended with `status`; T2 has review findings and so owes its own round. */
  const scene = (seat: Seat, status: string): Stamped[] => [
    ...built(T2, "e4f5a6b", 0),
    done(5, T2, "code-reviewer", "findings"),
    dispatched(6, T1, seat),
    done(7, T1, seat, status),
  ];

  it.each(cases)("asks for a decision when the %s ends %s, for that task only, until it closes", (seat, status) => {
    const state = ledger(...scene(seat, status));
    const plan = inputs([task(T1), task(T2)]);
    const first = routingActions(state, plan, cap());
    const decide = decides(first, T1);
    expect(decide).toEqual([expect.objectContaining({ kind: "decide", task: T1, rule: "Seat status", reason: `${seat} ended ${status}` })]);
    expect(decide[0].closes).toContain(`${T1}: ${seat} dispatched`);
    expect(decide[0].closes).toContain(`Note ${T1}: decided — <what>`);
    // The other task's work is not held by this decision.
    expect(decides(first, T2).filter((d) => d.rule === "Seat status")).toEqual([]);
    expect(developerDispatches(first, T2)).toEqual([expect.objectContaining({ mode: "resume", round: 1 })]);

    // Repeats until its closing line.
    expect(decides(routingActions(state, plan, cap()), T1)).toEqual(decide);

    const byDecision = routingActions(ledger(...scene(seat, status), decided(8, T1, "go on as for DONE")), plan, cap());
    expect(decides(byDecision, T1).filter((d) => d.rule === "Seat status")).toEqual([]);

    const byRedispatch = routingActions(ledger(...scene(seat, status), dispatched(8, T1, seat)), plan, cap());
    expect(decides(byRedispatch, T1).filter((d) => d.rule === "Seat status")).toEqual([]);
  });

  it("closes a blocked developer quoting a made commit with its commits note", () => {
    const events: Stamped[] = [dispatched(1, T1, "developer"), done(2, T1, "developer", "BLOCKED")];
    const open = routingActions(ledger(...events), inputs([task(T1)]), cap());
    const decide = decides(open, T1).filter((d) => d.rule === "Seat status");
    expect(decide).toEqual([expect.objectContaining({ kind: "decide", task: T1, rule: "Seat status", reason: "developer ended BLOCKED" })]);
    expect(decide[0].closes).toContain(`Note ${T1}: commits <sha7>`);

    const closed = routingActions(ledger(...events, commits(3, T1, SHA)), inputs([task(T1)]), cap());
    expect(decides(closed, T1).filter((d) => d.rule === "Seat status")).toEqual([]);
  });
});

describe("one decided note closes one gate", () => {
  const seatDecides = (actions: Action[]) => decides(actions, T1).filter((d) => d.rule === "Seat status");

  it("closes an earlier exit 2 stop first and a later seat status decision with the next note", () => {
    const events: Stamped[] = [...built(), verifyStarted(5, T1), verifyDone(6, T1, 2), done(7, T1, "code-reviewer", "BLOCKED")];
    const open = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(stops(open, T1)).toEqual([{ kind: "stop", task: T1, reason: EXIT_2_STOP }]);
    expect(seatDecides(open)).toHaveLength(1);

    const one = routingActions(ledger(...events, decided(8, T1, "plan re-approved")), inputs([task(T1)]), cap());
    expect(stops(one, T1)).toEqual([]);
    expect(seatDecides(one)).toEqual([expect.objectContaining({ reason: "code-reviewer ended BLOCKED" })]);

    const two = routingActions(ledger(...events, decided(8, T1, "plan re-approved"), decided(9, T1, "review goes on")), inputs([task(T1)]), cap());
    expect(stops(two, T1)).toEqual([]);
    expect(seatDecides(two)).toEqual([]);
  });

  it("closes an earlier seat status decision first and a later exit 2 stop with the next note", () => {
    const events: Stamped[] = [...built(), done(5, T1, "code-reviewer", "BLOCKED"), verifyStarted(6, T1), verifyDone(7, T1, 2)];
    const open = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(seatDecides(open)).toHaveLength(1);
    expect(stops(open, T1)).toEqual([{ kind: "stop", task: T1, reason: EXIT_2_STOP }]);

    const one = routingActions(ledger(...events, decided(8, T1, "review goes on")), inputs([task(T1)]), cap());
    expect(seatDecides(one)).toEqual([]);
    expect(stops(one, T1)).toEqual([{ kind: "stop", task: T1, reason: EXIT_2_STOP }]);

    const two = routingActions(ledger(...events, decided(8, T1, "review goes on"), decided(9, T1, "plan re-approved")), inputs([task(T1)]), cap());
    expect(seatDecides(two)).toEqual([]);
    expect(stops(two, T1)).toEqual([]);
  });
});

describe("lines written while a round or a seat status is pending", () => {
  const findings = (): Stamped[] => [...built(), done(5, T1, "code-reviewer", "findings")];
  const ruling = (m: number, text: string): Stamped => [m, { type: "other", text }];
  const seatDecides = (actions: Action[]) => decides(actions, T1).filter((d) => d.rule === "Seat status");

  it("still names the round developer after a cap wait line", () => {
    const events: Stamped[] = [...findings(), [6, { type: "developerWaits", task: T1, reason: "2 developers in flight" }]];
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });

  it("still names the round developer after a legacy fix queued line", () => {
    const events: Stamped[] = [...findings(), [6, { type: "fixQueued", task: T1, otherTask: T2 }]];
    const actions = routingActions(ledger(...events), inputs([task(T1), task(T2)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });

  it("closes a seat status decision with a ruling that names the task", () => {
    const events: Stamped[] = [
      dispatched(1, T1, "developer"),
      commits(2, T1, SHA),
      done(3, T1, "developer", "DONE_WITH_CONCERNS"),
      ruling(4, `Ruling: ${T1} concerns accepted, the fallback stays — cost if wrong: a slower path`),
    ];
    expect(seatDecides(routingActions(ledger(...events), inputs([task(T1)]), cap()))).toEqual([]);
  });

  it("keeps a seat status decision open after a ruling that names another task", () => {
    const events: Stamped[] = [
      dispatched(1, T1, "developer"),
      commits(2, T1, SHA),
      done(3, T1, "developer", "DONE_WITH_CONCERNS"),
      ruling(4, `Ruling: ${T2} concerns accepted, the fallback stays — cost if wrong: a slower path`),
    ];
    expect(seatDecides(routingActions(ledger(...events), inputs([task(T1), task(T2)]), cap()))).toEqual([
      expect.objectContaining({ kind: "decide", task: T1, rule: "Seat status", reason: "developer ended DONE_WITH_CONCERNS" }),
    ]);
  });

  it("keeps an exit 2 stop after a ruling that names the task", () => {
    const events: Stamped[] = [
      ...built(),
      verifyStarted(5, T1),
      verifyDone(6, T1, 2),
      done(7, T1, "code-reviewer", "clean"),
      ruling(8, `Ruling: ${T1} keeps its Files — cost if wrong: a replan later`),
    ];
    expect(stops(routingActions(ledger(...events), inputs([task(T1)]), cap()), T1)).toEqual([{ kind: "stop", task: T1, reason: EXIT_2_STOP }]);
  });
});

describe("a round developer dispatched beside its round test-writer", () => {
  const hashes = (m: number): Stamped => [m, { type: "testHashes", task: T1, files: { "src/tests/x.test.ts": "0123456789abcdef0123456789abcdef01234567" } }];

  // The developer of a round can be dispatched with its test-writer and commit the tests unchanged itself;
  // the test-writer's done then lands after that dispatch, and no second developer is owed.
  it("names no round developer once the developer dispatched before the test-writer's done reported", () => {
    const events: Stamped[] = [
      ...built(),
      verifyStarted(5, T1),
      verifyDone(6, T1, 0),
      done(7, T1, "code-reviewer", "findings"),
      dispatched(8, T1, "developer", { round: 1 }),
      dispatched(8, T1, "test-writer", { round: 1 }),
      done(9, T1, "test-writer", "DONE"),
      hashes(9),
      commits(10, T1, "b2c3d4e"),
      done(10, T1, "developer", "DONE_WITH_CONCERNS"),
      [10, { type: "other", text: `Ruling: ${T1}'s wording choices stand — cost if wrong: a prose edit` }],
      verifyStarted(10, T1),
      dispatched(11, T1, "code-reviewer", { round: 1 }),
      verifyDone(12, T1, 1),
      [12, { type: "verifyRerun", task: T1, signature: "Test timed out" }],
      done(12, T1, "code-reviewer", "findings"),
      dispatched(13, T1, "test-writer", { round: 2 }),
      dispatched(13, T1, "developer", { round: 2 }),
      verifyStarted(13, T1),
      done(14, T1, "test-writer", "DONE"),
      hashes(14),
      verifyDone(15, T1, 0),
      commits(15, T1, "c3d4e5f"),
      done(15, T1, "developer", "DONE"),
      verifyStarted(15, T1),
      dispatched(15, T1, "code-reviewer", { round: 2 }),
    ];
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([]);
  });

  // A developer that fixed code before a test finding went to the round's test-writer never saw those tests,
  // so it does not commit them: the resume-commit developer is still owed.
  it("resumes the round developer to commit tests from a round test-writer dispatched after it", () => {
    const events: Stamped[] = [
      ...built(),
      done(5, T1, "code-reviewer", "findings"),
      dispatched(6, T1, "developer", { round: 1 }),
      commits(7, T1, "b2c3d4e"),
      done(8, T1, "developer", "DONE"),
      dispatched(9, T1, "test-writer", { round: 1 }),
      done(10, T1, "test-writer", "DONE"),
      hashes(11),
    ];
    const actions = routingActions(ledger(...events), inputs([task(T1)]), cap());
    expect(developerDispatches(actions, T1)).toEqual([
      expect.objectContaining({ kind: "dispatch", task: T1, seat: "developer", mode: "resume", round: 1 }),
    ]);
  });
});

describe("printed record commands survive a shell", () => {
  /**
   * The arguments bash hands to `kf` when it runs the printed command, `kf` stubbed to echo them.
   * Runs in a scratch directory: an unquoted `<` or `>` in the text would otherwise redirect in the worktree.
   */
  const shellArgs = (record: string): string[] =>
    execFileSync("bash", ["-c", `kf() { printf '%s\\0' "$@"; }; ${record}`], { encoding: "utf8", cwd: mkdtempSync(join(tmpdir(), "kf-record-")) })
      .split("\0")
      .slice(0, -1);
  const writeOf = (actions: Action[], prefix: string) => {
    const found = writes(actions).find((w) => w.line.startsWith(prefix));
    expect(found).toBeDefined();
    return found!;
  };

  it("hands the cap reached line to kf record as one argument", () => {
    const events = [...roundsDone(5), decided(60, T1, "parked the rest"), complete(61, T1), reopened(62, T1)];
    const write = writeOf(routingActions(ledger(...events), inputs([task(T1)]), cap()), `Note ${T1}: cap reached`);
    expect(shellArgs(write.record)).toEqual(["record", FEATURE, "line", "--", write.line]);
  });

  it("hands the test hashes line to kf record as one argument", () => {
    const events: Stamped[] = [...built(), done(5, T1, "code-reviewer", "findings"), dispatched(6, T1, "test-writer", { round: 1 }), done(7, T1, "test-writer", "DONE")];
    const write = writeOf(routingActions(ledger(...events), inputs([task(T1)]), cap()), `${T1}: test hashes`);
    expect(shellArgs(write.record)).toEqual(["record", FEATURE, "line", "--", write.line]);
  });

  it("hands the fix round body to kf record as one argument", () => {
    const events = roundsDone(1).filter(([, b]) => b.type !== "fixRound");
    const prefix = `${T1}: fix round 1/5 (`;
    const write = writeOf(routingActions(ledger(...events), inputs([task(T1)]), cap()), prefix);
    expect(shellArgs(write.record)).toEqual(["record", FEATURE, "fix-round", T1, "1", "--", write.line.slice(prefix.length, -1)]);
  });
});
