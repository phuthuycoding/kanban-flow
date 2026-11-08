import { execFileSync } from "node:child_process";

import { describe, it, expect } from "vitest";

import { contentionSignature, liveCap } from "../workflow/next/cap.js";
import type { Action, Cap, LedgerEvent, LedgerState, LoopInputs, LoopTask, VerifyRun } from "../workflow/next/types.js";

const FEATURE = "kf-next";
const BASE = Date.parse("2026-11-01T10:00:00Z");
/** One shell word: single quotes, each ' written as '\''. Computed here so the test does not lean on the production helper. */
const q = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;
const at = (minute: number): number => BASE + minute * 60_000;

type EventBody = LedgerEvent extends infer E ? (E extends LedgerEvent ? Omit<E, "line" | "ts"> : never) : never;

/** One ledger event stamped at `minute`; line numbers follow the order the events are listed in. */
const e = (minute: number, body: EventBody): [number, EventBody] => [minute, body];

function ledger(...events: [number, EventBody][]): LedgerState {
  return { events: events.map(([minute, body], i) => ({ ...body, line: i + 3, ts: at(minute) }) as LedgerEvent) };
}

function task(id: string, wave: number, inline = false): LoopTask {
  return { id, dependencies: [], files: [`src/${id}.ts`], wave, overlaps: [], inline, testTypes: ["Unit"] };
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

const block = (minute: number, exit: number, text: string): VerifyRun => ({ ts: at(minute), exit, text });

const writes = (cap: Cap): Extract<Action, { kind: "write" }>[] =>
  cap.owed.filter((a): a is Extract<Action, { kind: "write" }> => a.kind === "write");
const lines = (cap: Cap): string[] => writes(cap).map((w) => w.line);
const decides = (cap: Cap): Extract<Action, { kind: "decide" }>[] =>
  cap.owed.filter((a): a is Extract<Action, { kind: "decide" }> => a.kind === "decide");

const startRuling = (minute: number, n: number): [number, EventBody] =>
  e(minute, { type: "capRuling", from: null, to: n, cause: { kind: "start" } });
const complete = (minute: number, id: string): [number, EventBody] =>
  e(minute, { type: "complete", task: id, text: `${id}: complete` });

const EADDR = "Error: listen EADDRINUSE: address already in use :::3000";
const DBLOCK = "SqliteError: database is locked";
const TIMEDOUT = "connect ETIMEDOUT 10.0.0.1:443";

describe("contentionSignature", () => {
  it("names the first signature in list order, not in text order", () => {
    expect(contentionSignature(`${TIMEDOUT}\n${EADDR}`)).toBe("EADDRINUSE");
    expect(contentionSignature("fatal: Unable to create '.git/index.lock': File exists\nTest timed out in 5000ms")).toBe("index.lock");
  });

  it("recognises each listed signature, an assertion failure beside it included", () => {
    for (const sig of ["EADDRINUSE", "index.lock", "database is locked", "SQLITE_BUSY", "Lock wait timeout exceeded", "ETIMEDOUT", "ECONNREFUSED", "Test timed out", "Hook timed out"]) {
      expect(contentionSignature(`AssertionError: expected 1 to be 2\n  ${sig} here`)).toBe(sig);
    }
  });

  it("returns null for a plain assertion failure", () => {
    expect(contentionSignature("AssertionError: expected 'a' to be 'b'\n 1 failed")).toBeNull();
  });
});

describe("liveCap start value and ceiling", () => {
  it("owes the start ruling at 2 on an empty ledger with a ceiling of 6", () => {
    const cap = liveCap(ledger(), inputs([task("TASK-001", 1)]));
    expect(cap.n).toBe(2);
    expect(cap.ceiling).toBe(6);
    expect(writes(cap)).toEqual([
      expect.objectContaining({
        kind: "write",
        line: "Ruling: developer cap 2 — start — cost if wrong: <…>",
        record: `kf record ${FEATURE} line -- ${q(`Ruling: developer cap 2 — start — cost if wrong: <…>`)}`,
      }),
    ]);
  });

  it("owes the start ruling at 1 on an empty ledger with a ceiling of 1", () => {
    const cap = liveCap(ledger(), inputs([task("TASK-001", 1)], { ceiling: { max: 1, source: "config" } }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Ruling: developer cap 1 — start — cost if wrong: <…>"]);
  });

  it("reads N from the latest cap ruling and owes nothing more", () => {
    const state = ledger(startRuling(1, 2), e(2, { type: "capRuling", from: 2, to: 3, cause: { kind: "wave", wave: 1 } }));
    const cap = liveCap(state, inputs([task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 2)]));
    expect(cap.n).toBe(3);
    expect(cap.owed).toEqual([]);
  });

  it("owes a ceiling ruling when the max was lowered below N", () => {
    const state = ledger(startRuling(1, 2), e(2, { type: "capRuling", from: 2, to: 4, cause: { kind: "wave", wave: 1 } }));
    const cap = liveCap(state, inputs([task("TASK-001", 1)], { ceiling: { max: 3, source: "config" } }));
    expect(cap.n).toBe(3);
    expect(cap.ceiling).toBe(3);
    expect(lines(cap)).toEqual(["Ruling: developer cap 4 → 3 — ceiling lowered to 3 — cost if wrong: <…>"]);
    expect(writes(cap)[0].record).toBe(`kf record ${FEATURE} line -- ${q(`Ruling: developer cap 4 → 3 — ceiling lowered to 3 — cost if wrong: <…>`)}`);
  });

  it("reads an invalid-config ceiling as 1 and owes a decide quoting the error", () => {
    const error = "harness.reviewers: expected an object";
    const cap = liveCap(ledger(), inputs([task("TASK-001", 1)], { ceiling: { max: 6, source: "invalid-config", error } }));
    expect(cap.ceiling).toBe(1);
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Ruling: developer cap 1 — start — cost if wrong: <…>"]);
    const decide = decides(cap);
    expect(decide).toHaveLength(1);
    expect(decide[0].rule).toBe("Invalid ceiling");
    expect(decide[0].reason).toBe(error);
    expect(decide[0].closes).toBe(`Ruling: … ${error}`);
    // The decide comes after every owed write.
    expect(cap.owed[cap.owed.length - 1]).toBe(decide[0]);
  });

  it("closes the invalid-config decide once a Ruling quoting the error is ledgered", () => {
    const error = "harness.reviewers: expected an object";
    const state = ledger(startRuling(1, 1), e(2, { type: "other", text: `Ruling: developer ceiling unknown — ${error} — reads 1` }));
    const cap = liveCap(state, inputs([task("TASK-001", 1)], { ceiling: { max: 6, source: "invalid-config", error } }));
    expect(cap.n).toBe(1);
    expect(decides(cap)).toEqual([]);
  });
});

describe("liveCap step-up decisions", () => {
  const wideNext = [task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 2), task("TASK-004", 2), task("TASK-005", 2)];

  it("raises N by one with the ruling owed when a clean parallel wave completes", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-001"), complete(3, "TASK-002"));
    const cap = liveCap(state, inputs(wideNext));
    expect(cap.n).toBe(3);
    expect(writes(cap)).toEqual([
      expect.objectContaining({
        line: "Ruling: developer cap 2 → 3 — wave 1 clean — cost if wrong: <…>",
        record: `kf record ${FEATURE} line -- ${q(`Ruling: developer cap 2 → 3 — wave 1 clean — cost if wrong: <…>`)}`,
      }),
    ]);
  });

  it("owes a last-wave note, not a step-up, when the last wave completes", () => {
    const state = ledger(
      startRuling(1, 2),
      complete(2, "TASK-001"),
      complete(3, "TASK-002"),
      e(4, { type: "capRuling", from: 2, to: 3, cause: { kind: "wave", wave: 1 } }),
      complete(5, "TASK-003"),
      complete(6, "TASK-004"),
      complete(7, "TASK-005"),
    );
    const cap = liveCap(state, inputs(wideNext));
    expect(cap.n).toBe(3);
    expect(lines(cap)).toEqual(["Note wave 2: no step-up — last wave"]);
    expect(writes(cap)[0].record).toBe(`kf record ${FEATURE} line -- ${q(`Note wave 2: no step-up — last wave`)}`);
  });

  it("decides owed waves in wave order, each against the ledger up to its due complete line", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-001"), complete(3, "TASK-002"), complete(4, "TASK-003"), complete(5, "TASK-004"), complete(6, "TASK-005"));
    const cap = liveCap(state, inputs(wideNext));
    expect(cap.n).toBe(3);
    expect(lines(cap)).toEqual(["Ruling: developer cap 2 → 3 — wave 1 clean — cost if wrong: <…>", "Note wave 2: no step-up — last wave"]);
  });

  it("does not decide a wave that finished before an earlier wave", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-003"), complete(3, "TASK-004"), complete(4, "TASK-005"), complete(5, "TASK-001"));
    const cap = liveCap(state, inputs(wideNext));
    expect(cap.n).toBe(2);
    expect(cap.owed).toEqual([]);
  });

  it("decides both waves at the line that completes the earlier one, so neither has a wave left to run", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-003"), complete(3, "TASK-004"), complete(4, "TASK-005"), complete(5, "TASK-001"), complete(6, "TASK-002"));
    const cap = liveCap(state, inputs(wideNext));
    expect(cap.n).toBe(2);
    expect(lines(cap)).toEqual(["Note wave 1: no step-up — last wave", "Note wave 2: no step-up — last wave"]);
  });

  it("names a wave not clean when one of its tasks had a contention re-run", () => {
    const state = ledger(
      startRuling(1, 2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 0 }),
      complete(8, "TASK-001"),
      complete(9, "TASK-002"),
    );
    const cap = liveCap(state, inputs(wideNext, { verifyRuns: { "TASK-001": [block(3, 1, EADDR), block(7, 0, "all passed")] } }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Note wave 1: no step-up — not clean"]);
  });

  it("names a one-task wave inline, whether or not the plan marks it inline", () => {
    for (const inline of [true, false]) {
      const state = ledger(startRuling(1, 2), complete(2, "TASK-001"));
      const cap = liveCap(state, inputs([task("TASK-001", 1, inline), task("TASK-002", 2), task("TASK-003", 2), task("TASK-004", 2)]));
      expect(cap.n).toBe(2);
      expect(lines(cap)).toEqual(["Note wave 1: no step-up — inline"]);
    }
  });

  it("names the ceiling when N + 1 would exceed the max", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-001"), complete(3, "TASK-002"));
    const cap = liveCap(state, inputs(wideNext, { ceiling: { max: 2, source: "config" } }));
    expect(cap.n).toBe(2);
    expect(lines(cap)).toEqual(["Note wave 1: no step-up — ceiling"]);
  });

  it("names the widest incomplete wave when N + 1 would exceed its width", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-001"), complete(3, "TASK-002"));
    const cap = liveCap(state, inputs([task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 2), task("TASK-004", 2)]));
    expect(cap.n).toBe(2);
    expect(lines(cap)).toEqual(["Note wave 1: no step-up — widest incomplete wave"]);
  });

  it("owes nothing for a wave already decided by a no-step-up note", () => {
    const state = ledger(startRuling(1, 2), complete(2, "TASK-001"), complete(3, "TASK-002"), e(4, { type: "noStepUp", wave: 1, reason: "widest incomplete wave" }));
    const cap = liveCap(state, inputs([task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 2), task("TASK-004", 2)]));
    expect(cap.n).toBe(2);
    expect(cap.owed).toEqual([]);
  });
});

describe("liveCap contention step-down", () => {
  const tasks = [task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 1), task("TASK-004", 2)];
  const capAt = (n: number): [number, EventBody] => e(1, { type: "capRuling", from: 2, to: n, cause: { kind: "wave", wave: 0 } });

  it("halves N from 4 to 2 on a contention-shaped failure and owes the ruling and the rerun note", () => {
    const state = ledger(capAt(4), e(2, { type: "verifyStarted", task: "TASK-001" }), e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(3, 1, EADDR)] } }));
    expect(cap.n).toBe(2);
    expect(writes(cap).map((w) => [w.line, w.record])).toEqual([
      ["Ruling: developer cap 4 → 2 — EADDRINUSE in TASK-001 verify — cost if wrong: <…>", `kf record ${FEATURE} line -- ${q(`Ruling: developer cap 4 → 2 — EADDRINUSE in TASK-001 verify — cost if wrong: <…>`)}`],
      ["Note TASK-001: verify rerun — contention EADDRINUSE", `kf record ${FEATURE} line -- ${q(`Note TASK-001: verify rerun — contention EADDRINUSE`)}`],
    ]);
  });

  it("prints records whose free text survives a real shell as one argument", () => {
    const id = "TASK-001 (a); $HOME `x` it's";
    const odd = [task(id, 1), task("TASK-002", 1), task("TASK-003", 1), task("TASK-004", 2)];
    const state = ledger(capAt(4), e(2, { type: "verifyStarted", task: id }), e(3, { type: "verifyDone", task: id, exit: 1 }));
    const cap = liveCap(state, inputs(odd, { verifyRuns: { [id]: [block(3, 1, EADDR)] } }));
    const owed = writes(cap);
    expect(owed.length).toBeGreaterThan(0);
    for (const w of owed) {
      const prefix = `kf record ${FEATURE} line -- `;
      expect(w.record.startsWith(prefix)).toBe(true);
      const word = w.record.slice(prefix.length);
      const out = execFileSync("bash", ["-c", `printf '%s' ${word}`], { encoding: "utf8" });
      expect(out).toBe(w.line);
    }
    expect(owed.some((w) => w.line.includes("(a); $HOME `x` it's"))).toBe(true);
  });

  it("halves N once per event: from 2 to 1 on a later, separate event", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 0 }),
      e(8, { type: "verifyStarted", task: "TASK-002" }),
      e(9, { type: "verifyDone", task: "TASK-002", exit: 1 }),
    );
    const runs = { "TASK-001": [block(3, 1, EADDR), block(7, 0, "ok")], "TASK-002": [block(9, 1, DBLOCK)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual([
      "Ruling: developer cap 2 → 1 — database is locked in TASK-002 verify — cost if wrong: <…>",
      "Note TASK-002: verify rerun — contention database is locked",
    ]);
  });

  it("keeps N at 1 with no ruling, still owing the rerun note", () => {
    const state = ledger(capAt(1), e(2, { type: "verifyStarted", task: "TASK-001" }), e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(3, 1, EADDR)] } }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Note TASK-001: verify rerun — contention EADDRINUSE"]);
  });

  it("still halves after a ceiling ruling written while the verify ran", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "capRuling", from: 4, to: 3, cause: { kind: "ceiling", max: 3 } }),
      e(4, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const cap = liveCap(state, inputs(tasks, { ceiling: { max: 3, source: "config" }, verifyRuns: { "TASK-001": [block(4, 1, EADDR)] } }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual([
      "Ruling: developer cap 3 → 1 — EADDRINUSE in TASK-001 verify — cost if wrong: <…>",
      "Note TASK-001: verify rerun — contention EADDRINUSE",
    ]);
  });

  it("does not step down for a plain assertion failure", () => {
    const state = ledger(capAt(4), e(2, { type: "verifyStarted", task: "TASK-001" }), e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(3, 1, "AssertionError: expected 1 to be 2")] } }));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({ held: [], running: null, blocksDevelopers: false });
  });

  it("classifies from the first block after the verify started, not an earlier run's block", () => {
    const state = ledger(capAt(4), e(5, { type: "verifyStarted", task: "TASK-001" }), e(6, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const runs = { "TASK-001": [block(2, 1, EADDR), block(6, 1, "AssertionError: expected 1 to be 2"), block(9, 1, EADDR)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
  });

  it("steps down once per signature per task until a pass: a second failure with the same signature only owes the rerun note", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(8, { type: "verifyStarted", task: "TASK-001" }),
      e(9, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const runs = { "TASK-001": [block(3, 1, EADDR), block(7, 1, EADDR), block(9, 1, EADDR)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(2);
    expect(lines(cap)).toEqual(["Note TASK-001: verify rerun — contention EADDRINUSE"]);
  });

  it("steps down again for the same task when the signature differs", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(8, { type: "verifyStarted", task: "TASK-001" }),
      e(9, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const runs = { "TASK-001": [block(3, 1, EADDR), block(7, 1, EADDR), block(9, 1, TIMEDOUT)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Ruling: developer cap 2 → 1 — ETIMEDOUT in TASK-001 verify — cost if wrong: <…>", "Note TASK-001: verify rerun — contention ETIMEDOUT"]);
  });

  it("steps down again with the same signature once a verify of the task has passed", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 0 }),
      e(8, { type: "verifyStarted", task: "TASK-001" }),
      e(9, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const runs = { "TASK-001": [block(3, 1, EADDR), block(7, 0, "ok"), block(9, 1, EADDR)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(1);
    expect(lines(cap)).toEqual(["Ruling: developer cap 2 → 1 — EADDRINUSE in TASK-001 verify — cost if wrong: <…>", "Note TASK-001: verify rerun — contention EADDRINUSE"]);
  });

  it("never steps down or owes a rerun note for a re-run's failure", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const runs = { "TASK-001": [block(3, 1, EADDR), block(7, 1, TIMEDOUT)] };
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(2);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({ held: [], running: null, blocksDevelopers: false });
  });
});

describe("liveCap held re-runs", () => {
  const tasks = [task("TASK-001", 1), task("TASK-002", 1), task("TASK-003", 1), task("TASK-004", 2)];
  const capAt = (n: number): [number, EventBody] => e(1, { type: "capRuling", from: 2, to: n, cause: { kind: "wave", wave: 0 } });
  const runs = { "TASK-001": [block(4, 1, EADDR)], "TASK-002": [block(5, 1, DBLOCK)] };
  const oneEvent: [number, EventBody][] = [
    capAt(4),
    e(2, { type: "verifyStarted", task: "TASK-001" }),
    e(3, { type: "verifyStarted", task: "TASK-002" }),
    e(4, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    e(5, { type: "verifyDone", task: "TASK-002", exit: 1 }),
  ];

  it("halves N once for two failing verifies of one event, owing a rerun note for each and holding both at once", () => {
    const cap = liveCap(ledger(...oneEvent), inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(2);
    expect(lines(cap)).toEqual([
      "Ruling: developer cap 4 → 2 — EADDRINUSE in TASK-001 verify — cost if wrong: <…>",
      "Note TASK-001: verify rerun — contention EADDRINUSE",
      "Note TASK-002: verify rerun — contention database is locked",
    ]);
    // Re-runs owed in this call are held at once, so the failure blocks new developers before its notes are ledgered.
    expect(cap.contention).toEqual({
      held: [
        { task: "TASK-001", atHead: false, kind: "rerun" },
        { task: "TASK-002", atHead: false, kind: "rerun" },
      ],
      running: null,
      blocksDevelopers: true,
    });
  });

  const noted: [number, EventBody][] = [
    ...oneEvent,
    e(6, { type: "capRuling", from: 4, to: 2, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
    e(7, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
    e(8, { type: "verifyRerun", task: "TASK-002", signature: "database is locked" }),
  ];

  it("holds both re-runs of one event, earliest task first, and blocks developers", () => {
    const cap = liveCap(ledger(...noted), inputs(tasks, { verifyRuns: runs }));
    expect(cap.n).toBe(2);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({
      held: [
        { task: "TASK-001", atHead: false, kind: "rerun" },
        { task: "TASK-002", atHead: false, kind: "rerun" },
      ],
      running: null,
      blocksDevelopers: true,
    });
  });

  it("runs one re-run at a time: the started one is running, the other stays held", () => {
    const cap = liveCap(ledger(...noted, e(9, { type: "verifyStarted", task: "TASK-001" })), inputs(tasks, { verifyRuns: runs }));
    expect(cap.contention).toEqual({
      held: [{ task: "TASK-002", atHead: false, kind: "rerun" }],
      running: "TASK-001",
      blocksDevelopers: true,
    });
  });

  it("keeps developers blocked until the last held re-run has finished, a failed re-run not stepping N down", () => {
    const afterFirst = [...noted, e(9, { type: "verifyStarted", task: "TASK-001" }), e(10, { type: "verifyDone", task: "TASK-001", exit: 1 })] as [number, EventBody][];
    const moreRuns = { ...runs, "TASK-001": [...runs["TASK-001"], block(10, 1, EADDR)] };
    const mid = liveCap(ledger(...afterFirst), inputs(tasks, { verifyRuns: moreRuns }));
    expect(mid.n).toBe(2);
    expect(mid.owed).toEqual([]);
    expect(mid.contention).toEqual({ held: [{ task: "TASK-002", atHead: false, kind: "rerun" }], running: null, blocksDevelopers: true });

    const done = liveCap(
      ledger(...afterFirst, e(11, { type: "verifyStarted", task: "TASK-002" }), e(12, { type: "verifyDone", task: "TASK-002", exit: 0 })),
      inputs(tasks, { verifyRuns: { ...moreRuns, "TASK-002": [...runs["TASK-002"], block(12, 0, "ok")] } }),
    );
    expect(done.n).toBe(2);
    expect(done.contention).toEqual({ held: [], running: null, blocksDevelopers: false });
  });

  it("orders held re-runs by wave, then plan order, not by ledger order", () => {
    const planTasks = [task("TASK-001", 2), task("TASK-002", 1), task("TASK-003", 1)];
    const state = ledger(
      capAt(1),
      e(2, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(3, { type: "verifyRerun", task: "TASK-003", signature: "EADDRINUSE" }),
      e(4, { type: "verifyRerun", task: "TASK-002", signature: "EADDRINUSE" }),
    );
    const cap = liveCap(state, inputs(planTasks));
    expect(cap.contention.held.map((h) => h.task)).toEqual(["TASK-002", "TASK-003", "TASK-001"]);
  });

  it("holds one plain re-run, with no step-down, for a failed verify that has no log block", () => {
    const state = ledger(capAt(4), e(2, { type: "verifyStarted", task: "TASK-001" }), e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const cap = liveCap(state, inputs(tasks));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({ held: [{ task: "TASK-001", atHead: false, kind: "plain" }], running: null, blocksDevelopers: true });
  });

  it("treats a log whose only block predates the verify as no block, holding a plain re-run", () => {
    const state = ledger(capAt(4), e(5, { type: "verifyStarted", task: "TASK-001" }), e(6, { type: "verifyDone", task: "TASK-001", exit: 1 }));
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(2, 1, EADDR)] } }));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
    expect(cap.contention.held).toEqual([{ task: "TASK-001", atHead: false, kind: "plain" }]);
  });

  it("reads a started plain re-run as running, blocking developers", () => {
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "verifyStarted", task: "TASK-001" }),
    );
    const cap = liveCap(state, inputs(tasks));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({ held: [], running: "TASK-001", blocksDevelopers: true });
  });

  it("owes only one plain re-run: when it also fails with no log block, nothing more is held", () => {
    // The failure then goes to the fix loop; another plain re-run would repeat with no end.
    const state = ledger(
      capAt(4),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "verifyStarted", task: "TASK-001" }),
      e(5, { type: "verifyDone", task: "TASK-001", exit: 1 }),
    );
    const cap = liveCap(state, inputs(tasks));
    expect(cap.n).toBe(4);
    expect(cap.owed).toEqual([]);
    expect(cap.contention).toEqual({ held: [], running: null, blocksDevelopers: false });
  });

  it("reads an orphan re-run (started, never done) as running, blocking developers", () => {
    const state = ledger(
      capAt(2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
    );
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(3, 1, EADDR)] } }));
    expect(cap.n).toBe(1);
    expect(cap.owed).toEqual([]);
    // Without --resume an open verify reads as in flight; turning a lost one back into a held re-run is the scheduler's call.
    expect(cap.contention).toEqual({ held: [], running: "TASK-001", blocksDevelopers: true });
  });

  it("marks a held re-run at-head when a verify waits note follows the task's last verify done", () => {
    const state = ledger(
      capAt(2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      e(4, { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } }),
      e(5, { type: "verifyWaits", task: "TASK-001", file: "src/TASK-002.ts", otherTask: "TASK-002" }),
      e(6, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
    );
    const cap = liveCap(state, inputs(tasks, { verifyRuns: { "TASK-001": [block(3, 1, EADDR)] } }));
    expect(cap.contention.held).toEqual([{ task: "TASK-001", atHead: true, kind: "rerun" }]);
  });
});

describe("liveCap held re-runs keyed on the latest rerun note", () => {
  const tasks = [task("TASK-001", 1), task("TASK-002", 1)];
  const capAt = (n: number): [number, EventBody] => e(1, { type: "capRuling", from: 2, to: n, cause: { kind: "wave", wave: 0 } });
  const stepDown: [number, EventBody] = e(4, { type: "capRuling", from: 2, to: 1, cause: { kind: "contention", signature: "EADDRINUSE", task: "TASK-001" } });
  const runs = { "TASK-001": [block(3, 1, EADDR)] };

  it("holds a lost re-run again when a second rerun note follows its orphan verify started", () => {
    const state = ledger(
      capAt(2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      stepDown,
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
    );
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.contention).toEqual({
      held: [{ task: "TASK-001", atHead: false, kind: "rerun" }],
      running: null,
      blocksDevelopers: true,
    });
  });

  it("reads the re-run as running once a verify started follows the latest rerun note", () => {
    const state = ledger(
      capAt(2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      stepDown,
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyStarted", task: "TASK-001" }),
      e(7, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(8, { type: "verifyStarted", task: "TASK-001" }),
    );
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.contention).toEqual({ held: [], running: "TASK-001", blocksDevelopers: true });
  });

  it("lists the re-run once however many rerun notes the task has", () => {
    const state = ledger(
      capAt(2),
      e(2, { type: "verifyStarted", task: "TASK-001" }),
      e(3, { type: "verifyDone", task: "TASK-001", exit: 1 }),
      stepDown,
      e(5, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
      e(6, { type: "verifyRerun", task: "TASK-001", signature: "EADDRINUSE" }),
    );
    const cap = liveCap(state, inputs(tasks, { verifyRuns: runs }));
    expect(cap.contention.held).toEqual([{ task: "TASK-001", atHead: false, kind: "rerun" }]);
    expect(cap.contention.running).toBeNull();
  });
});
