import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { completedTaskIds, openSeats, openVerifies, readLedgerState, taskCommits } from "../workflow/next/ledger-state.js";
import type { LedgerEvent, LedgerState } from "../workflow/next/types.js";

const HEADER = "# Task loop ledger — test";
const T = "2026-11-01T10:00:00Z";
const ledger = (...lines: string[]): string => [HEADER, "", ...lines].join("\n") + "\n";
const stamp = (body: string, ts = T): string => `${body} @ ${ts}`;

function stateOf(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`expected a readable ledger, got repair lines ${JSON.stringify(read.repair)}`);
  return read.state;
}

function eventOf(body: string): LedgerEvent {
  const events = stateOf(ledger(stamp(body))).events;
  expect(events).toHaveLength(1);
  return events[0];
}

function repairOf(text: string) {
  const read = readLedgerState(text);
  if (read.ok) throw new Error("expected the ledger to be refused");
  return read.repair;
}

const SHA40 = "a".repeat(40);

describe("readLedgerState refusal", () => {
  it("refuses a malformed cap ruling and an unstamped developer done, naming each line", () => {
    const text = ledger(
      stamp("TASK-001: developer dispatched model=opus"),
      stamp("Ruling: developer cap two — start — fits the plan"),
      "TASK-001: developer done status=DONE",
    );
    const repair = repairOf(text);
    expect(repair.map((r) => r.line)).toEqual([4, 5]);
    expect(repair[0].text).toBe(stamp("Ruling: developer cap two — start — fits the plan"));
    expect(repair[1].text).toBe("TASK-001: developer done status=DONE");
    expect(repair.every((r) => r.reason.length > 0)).toBe(true);
  });

  it("refuses the resumed fixture, naming its misspelt, double-stamped and unstamped shape lines", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, "fixtures", "loop-stats", "resumed.ledger.md"), "utf8");
    const repair = repairOf(text);
    expect(repair.map((r) => r.line)).toEqual([14, 19, 22]);
    expect(repair[0].text).toContain("developer dispatchd");
    expect(repair[2].text).toBe("TASK-001: fix round 1/5 (nit)");
  });

  it("refuses an unstamped line of a shape and a bulleted shape claim", () => {
    const repair = repairOf(ledger("TASK-001: verify started", stamp("- TASK-002: developer done status=DONE")));
    expect(repair.map((r) => r.line)).toEqual([3, 4]);
  });

  it.each([
    ["a non-numeric cap", "Ruling: developer cap two — start — x"],
    ["a bulleted cap ruling", "- Ruling: developer cap 2 — start — x"],
    ["a cap ruling with an unknown cause", "Ruling: developer cap 2 → 3 — vibes — cost if wrong: none"],
    ["a test hashes line with a short hash", "TASK-001: test hashes a.ts=abc b.ts="],
    ["a verify rerun with an unknown signature", "Note TASK-002: verify rerun — contention flaky"],
    ["a no step-up with an unknown reason", "Note wave 1: no step-up — because"],
    ["a verify waits without the other task", "Note TASK-001: verify waits — a.ts"],
    ["a verify routed without a task", "Note TASK-001: verify routed — soon"],
    ["a no test-writer without a reason", "TASK-001: no test-writer"],
    ["a commits note with a non-hex sha", "Note TASK-001: commits zzzzzzz"],
    ["a decided note with nothing decided", "Note TASK-001: decided"],
    ["a parked line without a ruling", "TASK-001: parked — finding"],
    ["a reopened note with an unknown source", "Note TASK-001: reopened — manual abcd1234"],
    ["a cap reached note without a failure", "Note TASK-001: cap reached"],
    ["an inline note with trailing words", "Note TASK-001: developer seat inline now"],
  ])("refuses %s", (_name, body) => {
    const repair = repairOf(ledger(stamp(body)));
    expect(repair).toHaveLength(1);
    expect(repair[0].line).toBe(3);
    expect(repair[0].text).toBe(stamp(body));
  });

  it.each([
    "Ruling: developer cap 2 — start — fits",
    "Note TASK-001: decided — keep going",
    "Note TASK-001: developer seat inline",
  ])("refuses the same claim without a stamp: %s", (body) => {
    expect(repairOf(ledger(body)).map((r) => r.line)).toEqual([3]);
  });

  it("ignores unstamped prose that claims no shape", () => {
    const state = stateOf(ledger("Some notes from an old run", "| TASK-002 | a row |", stamp("TASK-001: verify started")));
    expect(state.events).toHaveLength(1);
    expect(state.events[0].line).toBe(5);
  });
});

describe("readLedgerState events", () => {
  it("keeps line numbers and epoch timestamps, normalising +hhmm", () => {
    const state = stateOf(
      ledger(stamp("TASK-001: verify started", "2026-11-01T17:00:00+0700"), stamp("TASK-001: verify done exit=0", "2026-11-01T10:05:00Z")),
    );
    expect(state.events.map((e) => [e.line, e.ts])).toEqual([
      [3, Date.parse("2026-11-01T10:00:00Z")],
      [4, Date.parse("2026-11-01T10:05:00Z")],
    ]);
  });

  it("parses a dispatch with a round and a cascade", () => {
    expect(eventOf("TASK-003: developer dispatched model=opus round=2 cascade=abcdef1")).toMatchObject({
      type: "dispatched", task: "TASK-003", seat: "developer", model: "opus", round: 2, cascade: "abcdef1",
    });
  });

  it("parses a done, a verify pair, a complete and the other grammar shapes", () => {
    expect(eventOf("TASK-001: code-reviewer done status=clean")).toMatchObject({ type: "done", task: "TASK-001", seat: "code-reviewer", status: "clean" });
    expect(eventOf("TASK-001: verify started")).toMatchObject({ type: "verifyStarted", task: "TASK-001" });
    expect(eventOf("TASK-001: verify done exit=2")).toMatchObject({ type: "verifyDone", task: "TASK-001", exit: 2 });
    expect(eventOf("TASK-001: developer waits — shared file")).toMatchObject({ type: "developerWaits", reason: "shared file" });
    expect(eventOf("TASK-002: fix queued — developer TASK-001 in flight")).toMatchObject({ type: "fixQueued", task: "TASK-002", otherTask: "TASK-001" });
    expect(eventOf("TASK-001: fix round 3/5 (nit)")).toMatchObject({ type: "fixRound", task: "TASK-001", round: 3 });
    expect(eventOf("TASK-002: cascade re-review owed — after abcdef1 of TASK-001")).toMatchObject({ type: "cascadeOwed", task: "TASK-002", sha: "abcdef1", otherTask: "TASK-001" });
    expect(eventOf("TASK-001: complete (commits abc1234)")).toMatchObject({ type: "complete", task: "TASK-001", text: "commits abc1234" });
  });

  it("parses the implemented, no test-writer, test hashes and review package lines", () => {
    expect(eventOf("TASK-001: implemented, test-writer seat: none, review seat: none")).toMatchObject({ type: "implemented", task: "TASK-001" });
    expect(eventOf("TASK-001: no test-writer — docs only")).toMatchObject({ type: "noTestWriter", task: "TASK-001", reason: "docs only" });
    expect(eventOf(`TASK-001: test hashes src/a=b.ts=${SHA40} t.test.ts=${"b".repeat(40)}`)).toMatchObject({
      type: "testHashes", task: "TASK-001", files: { "src/a=b.ts": SHA40, "t.test.ts": "b".repeat(40) },
    });
    expect(eventOf("TASK-001: review package abcdef1,1234567")).toMatchObject({ type: "reviewPackage", task: "TASK-001", shas: ["abcdef1", "1234567"] });
  });

  it("parses the parked line and the Note lines", () => {
    expect(eventOf("TASK-001: parked — flaky layout — Ruling: out of scope")).toMatchObject({ type: "parked", task: "TASK-001", finding: "flaky layout" });
    expect(eventOf("Note TASK-001: commits abcdef1,1234567")).toMatchObject({ type: "commits", shas: ["abcdef1", "1234567"] });
    expect(eventOf("Note TASK-001: decided — keep the fix")).toMatchObject({ type: "decided", what: "keep the fix" });
    expect(eventOf("Note TASK-001: verify routed — TASK-002")).toMatchObject({ type: "verifyRouted", task: "TASK-001", otherTask: "TASK-002" });
    expect(eventOf("Note TASK-001: verify waits — src/a.ts (TASK-002)")).toMatchObject({ type: "verifyWaits", file: "src/a.ts", otherTask: "TASK-002" });
    expect(eventOf("Note TASK-001: reopened — review 1a2b3c4d")).toMatchObject({ type: "reopened", source: "review", execution: "1a2b3c4d" });
    expect(eventOf("Note TASK-001: cap reached — verify failed")).toMatchObject({ type: "capReached", failure: "verify failed" });
    expect(eventOf("Note TASK-001: developer seat inline")).toMatchObject({ type: "inline", task: "TASK-001" });
  });

  it("takes the contention signature as the known prefix of a verify rerun", () => {
    expect(eventOf("Note TASK-002: verify rerun — contention EADDRINUSE")).toMatchObject({ type: "verifyRerun", signature: "EADDRINUSE" });
    expect(eventOf("Note TASK-002: verify rerun — contention Test timed out (auto-close.test.ts)")).toMatchObject({
      type: "verifyRerun", signature: "Test timed out",
    });
  });

  it("parses cap rulings, no step-up notes and scans", () => {
    expect(eventOf("Ruling: developer cap 2 — start — plan allows it")).toMatchObject({ type: "capRuling", from: null, to: 2, cause: { kind: "start" } });
    expect(eventOf("Ruling: developer cap 2 → 3 — wave 1 clean — cost if wrong: one rerun")).toMatchObject({
      type: "capRuling", from: 2, to: 3, cause: { kind: "wave", wave: 1 },
    });
    expect(eventOf("Ruling: developer cap 3 → 2 — SQLITE_BUSY in TASK-004 verify — cost if wrong: slower")).toMatchObject({
      type: "capRuling", from: 3, to: 2, cause: { kind: "contention", signature: "SQLITE_BUSY", task: "TASK-004" },
    });
    expect(eventOf("Ruling: developer cap 4 → 3 — ceiling lowered to 3 — cost if wrong: slower")).toMatchObject({
      type: "capRuling", from: 4, to: 3, cause: { kind: "ceiling", max: 3 },
    });
    expect(eventOf("Note wave 2: no step-up — last wave")).toMatchObject({ type: "noStepUp", wave: 2, reason: "last wave" });
    expect(eventOf("Scan: clean")).toMatchObject({ type: "scan", clean: true });
    expect(eventOf("Scan: 2 findings")).toMatchObject({ type: "scan", clean: false });
  });

  it("keeps any other stamped line as other, with its task when it names one", () => {
    expect(eventOf("Session resumed from the ledger")).toMatchObject({ type: "other" });
    expect(eventOf("Note TASK-005: brief written")).toMatchObject({ type: "other", task: "TASK-005" });
  });
});

describe("open seats and verifies", () => {
  it("reports a lone dispatch as open, with its line", () => {
    const state = stateOf(ledger(stamp("TASK-001: developer dispatched model=opus")));
    expect(openSeats(state)).toEqual([{ task: "TASK-001", seat: "developer", line: 3 }]);
  });

  it("does not report a dispatched seat that is done", () => {
    const state = stateOf(ledger(stamp("TASK-001: developer dispatched model=opus"), stamp("TASK-001: developer done status=DONE")));
    expect(openSeats(state)).toEqual([]);
  });

  it("leaves an honest orphan closed when the seat was dispatched again", () => {
    const state = stateOf(
      ledger(
        stamp("TASK-001: developer dispatched model=opus"),
        stamp("TASK-001: developer dispatched model=opus"),
      ),
    );
    expect(openSeats(state)).toEqual([{ task: "TASK-001", seat: "developer", line: 4 }]);
  });

  it("lets a done after a re-dispatch answer the latest dispatch only", () => {
    const state = stateOf(
      ledger(
        stamp("TASK-001: developer dispatched model=opus"),
        stamp("TASK-001: developer dispatched model=opus"),
        stamp("TASK-001: developer done status=DONE"),
      ),
    );
    expect(openSeats(state)).toEqual([]);
  });

  it("keeps seats of different tasks and seats apart, in file order", () => {
    const state = stateOf(
      ledger(
        stamp("TASK-002: test-writer dispatched model=sonnet"),
        stamp("TASK-001: developer dispatched model=opus"),
        stamp("TASK-002: developer dispatched model=opus"),
        stamp("TASK-001: developer done status=DONE"),
      ),
    );
    expect(openSeats(state)).toEqual([
      { task: "TASK-002", seat: "test-writer", line: 3 },
      { task: "TASK-002", seat: "developer", line: 5 },
    ]);
  });

  it("reports a verify with no verify done as open", () => {
    const state = stateOf(ledger(stamp("TASK-001: verify started")));
    expect(openVerifies(state)).toEqual([{ task: "TASK-001", line: 3 }]);
  });

  it("closes a verify with a later verify done and with a later verify started", () => {
    const state = stateOf(
      ledger(
        stamp("TASK-001: verify started"),
        stamp("TASK-001: verify done exit=1"),
        stamp("TASK-002: verify started"),
        stamp("TASK-002: verify started"),
      ),
    );
    expect(openVerifies(state)).toEqual([{ task: "TASK-002", line: 6 }]);
  });
});

const ev = (line: number, e: object): LedgerEvent => ({ line, ts: line, ...e }) as LedgerEvent;
const stateFrom = (...events: LedgerEvent[]): LedgerState => ({ events });

describe("completedTaskIds", () => {
  it("counts a complete line and an implemented line as completed", () => {
    const state = stateFrom(
      ev(3, { type: "complete", task: "TASK-001", text: "commits abc1234" }),
      ev(4, { type: "implemented", task: "TASK-002" }),
      ev(5, { type: "verifyStarted", task: "TASK-003" }),
    );
    expect([...completedTaskIds(state)].sort()).toEqual(["TASK-001", "TASK-002"]);
  });

  it("drops a task whose completion is followed by a reopened note", () => {
    const state = stateFrom(
      ev(3, { type: "complete", task: "TASK-001", text: "x" }),
      ev(4, { type: "implemented", task: "TASK-002" }),
      ev(5, { type: "reopened", task: "TASK-001", source: "ci", execution: "1a2b3c4d" }),
    );
    expect([...completedTaskIds(state)]).toEqual(["TASK-002"]);
  });

  it("keeps a task completed again after it was reopened", () => {
    const state = stateFrom(
      ev(3, { type: "complete", task: "TASK-001", text: "x" }),
      ev(4, { type: "reopened", task: "TASK-001", source: "review", execution: "1a2b3c4d" }),
      ev(5, { type: "complete", task: "TASK-001", text: "y" }),
    );
    expect([...completedTaskIds(state)]).toEqual(["TASK-001"]);
  });

  it("does not let a reopened note of another task cancel a completion", () => {
    const state = stateFrom(
      ev(3, { type: "complete", task: "TASK-001", text: "x" }),
      ev(4, { type: "reopened", task: "TASK-002", source: "ci", execution: "1a2b3c4d" }),
    );
    expect([...completedTaskIds(state)]).toEqual(["TASK-001"]);
  });
});

describe("taskCommits", () => {
  const log = [
    { sha: "a".repeat(40), ts: 1 },
    { sha: "b".repeat(40), ts: 2 },
    { sha: "c".repeat(40), ts: 3 },
  ];
  const commits = (line: number, task: string, shas: string[]) => ev(line, { type: "commits", task, shas });
  const pkg = (line: number, task: string, shas: string[]) => ev(line, { type: "reviewPackage", task, shas });

  it("unions commits notes and review package shas in ledger order, ignoring report commits", () => {
    const state = stateFrom(pkg(3, "TASK-001", ["bbbbbbb"]), commits(4, "TASK-001", ["aaaaaaa"]));
    expect(taskCommits(state, "TASK-001", ["ccccccc"], [])).toEqual(["bbbbbbb", "aaaaaaa"]);
  });

  it("dedupes a package sha and a note sha by prefix, keeping the first spelling", () => {
    const state = stateFrom(pkg(3, "TASK-001", ["bbbbbbb"]), commits(4, "TASK-001", ["bbbbbbbbb", "ddddddd"]));
    expect(taskCommits(state, "TASK-001", undefined, [])).toEqual(["bbbbbbb", "ddddddd"]);
  });

  it("concatenates every commits note of the task in file order and ignores other tasks", () => {
    const state = stateFrom(commits(3, "TASK-001", ["ccccccc"]), commits(4, "TASK-002", ["bbbbbbb"]), commits(5, "TASK-001", ["ddddddd"]));
    expect(taskCommits(state, "TASK-001", undefined, [])).toEqual(["ccccccc", "ddddddd"]);
  });

  it("falls back to review packages when there is no commits note", () => {
    const state = stateFrom(pkg(3, "TASK-001", ["bbbbbbb"]), pkg(4, "TASK-001", ["ddddddd"]));
    expect(taskCommits(state, "TASK-001", ["ccccccc"], [])).toEqual(["bbbbbbb", "ddddddd"]);
  });

  it("falls back to report commits, then to an empty list", () => {
    const state = stateFrom(commits(3, "TASK-002", ["bbbbbbb"]));
    expect(taskCommits(state, "TASK-001", ["ccccccc"], [])).toEqual(["ccccccc"]);
    expect(taskCommits(state, "TASK-001", undefined, [])).toEqual([]);
  });

  it("drops a sha equal to or prefixed either way with an earlier one, keeping the first spelling", () => {
    const full = "a".repeat(40);
    const state = stateFrom(commits(3, "TASK-001", ["aaaaaaa", full, "bbbbbbb", "bbbbbbb"]), commits(4, "TASK-001", ["bbbbbbbbb"]));
    expect(taskCommits(state, "TASK-001", undefined, [])).toEqual(["aaaaaaa", "bbbbbbb"]);
  });

  it("sorts into gitLog history order with unknown shas after, in their given order", () => {
    const state = stateFrom(commits(3, "TASK-001", ["ccccccc", "1234567", "aaaaaaa", "7654321", "bbbbbbb"]));
    expect(taskCommits(state, "TASK-001", undefined, log)).toEqual(["aaaaaaa", "bbbbbbb", "ccccccc", "1234567", "7654321"]);
  });
});

describe("readLedgerState refusal of implemented and review package lines", () => {
  it.each([
    ["a malformed implemented line", stamp("TASK-001: implemented, test-writer seat: none")],
    ["an unstamped implemented line", "TASK-001: implemented, test-writer seat: none, review seat: none"],
    ["a malformed review package line", stamp("TASK-001: review package xyz")],
    ["an unstamped review package line", "TASK-001: review package abcdef1,1234567"],
  ])("refuses %s, naming its line", (_name, text) => {
    const repair = repairOf(ledger(stamp("TASK-002: verify started"), text));
    expect(repair).toHaveLength(1);
    expect(repair[0].line).toBe(4);
    expect(repair[0].text).toBe(text);
  });
});
