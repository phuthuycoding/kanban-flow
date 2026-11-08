import { describe, it, expect } from "vitest";

import { buildLine, type RecordEvent } from "../workflow/next/record.js";
import { JUDGEMENTS } from "../workflow/next/judgements.js";

// A closes alternative is a ledger-line template: `<task>` is the judged task, other `<name>` tokens and `…` are
// filled by the session. Rendered with placeholder values, each must be a line `kf record` writes; otherwise the
// decide could never be closed and the loop would stick (the liveness rule).

const TASK = "TASK-001";
const SHA7 = "abc1234";
const SEATS = ["test-writer", "developer", "automation-writer", "code-reviewer"];
const TS = "2026-11-08T10:00:00+07:00";

// Every seat of the task is open and a verify is running, so a `done` or `verify done` alternative has
// something to answer; nothing in it is complete, so a `complete` alternative is not refused as a repeat.
const LEDGER = [
  "# Task loop ledger — demo — plan: /x/phase-2-implementation-plan.md",
  ...SEATS.map((seat) => `${TASK}: ${seat} dispatched model=opus @ ${TS}`),
  `${TASK}: verify started @ ${TS}`,
  "",
].join("\n");

function render(template: string): string {
  return template
    .replace(/<task>/gi, TASK)
    .replace(/<seat>/gi, "developer")
    .replace(/<[^<>]*sha[^<>]*>/gi, SHA7)
    .replace(/<model>/gi, "opus")
    .replace(/<[^<>]+>/g, "placeholder text")
    .replace(/…/g, "placeholder text");
}

/** The `kf record` event that writes `line`; `exact` is false where the template leaves the dispatch fields to the session. */
function eventFor(line: string): { event: RecordEvent; exact: boolean } {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(TASK-\d+): (\S+) dispatched\b(.*)$/))) {
    const rest = m[3];
    const model = rest.match(/model=(\S+)/)?.[1] ?? "opus";
    const round = rest.match(/round=(\d+)/)?.[1];
    const cascade = rest.match(/cascade=([0-9a-f]{7,40})/)?.[1];
    return { event: { event: "dispatched", args: [m[1], m[2]], model, round, cascade }, exact: false };
  }
  if ((m = line.match(/^(TASK-\d+): (\S+) done status=(\S+)$/))) return { event: { event: "done", args: [m[1], m[2]], status: m[3] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): verify started$/))) return { event: { event: "verify-started", args: [m[1]] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): verify done exit=(\S+)$/))) return { event: { event: "verify-done", args: [m[1]], exit: m[2] }, exact: true };
  if ((m = line.match(/^Note (TASK-\d+): commits (\S+)$/))) return { event: { event: "commits", args: [m[1], m[2]] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): developer waits — (.+)$/))) return { event: { event: "waits", args: [m[1], m[2]] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): fix round (\S+)\/5 \((.*)\)$/))) return { event: { event: "fix-round", args: [m[1], m[2], m[3]] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): cascade re-review owed — after (\S+) of (TASK-\d+)$/))) return { event: { event: "cascade-owed", args: [m[1], m[2], m[3]] }, exact: true };
  if ((m = line.match(/^(TASK-\d+): complete \((.*)\)$/))) return { event: { event: "complete", args: [m[1], m[2]] }, exact: true };
  return { event: { event: "line", args: [line] }, exact: true };
}

type Entry = { rule: unknown; closes: unknown; close: unknown; successor: unknown };
const entries = (): [string, Entry][] => Object.entries(JUDGEMENTS as Record<string, Entry>);
const closesOf = (kind: string): string[] => (JUDGEMENTS as Record<string, Entry>)[kind].closes as string[];

const isPark = (t: string): boolean => /^<task>: parked — .+ — Ruling: .+$/.test(t);
const isMinimalFix = (t: string): boolean => /^Note <task>: decided — minimal fix past the cap: .+$/.test(t);
const isPlainDecided = (t: string): boolean => /^Note <task>: decided — /.test(t) && !isMinimalFix(t);
const isSuperseded = (t: string): boolean => /^<task>: complete \(.*superseded.*\)$/.test(t);

describe("judgement table", () => {
  it("has an entry for every decide rule and every at-cap outcome", () => {
    const kinds = Object.keys(JUDGEMENTS);
    for (const kind of [
      "conflictScan",
      "seatStatus",
      "commitMissing",
      "verifyExit3",
      "breaker",
      "breakerFixSpent",
      "capStop",
      "capStopFixSpent",
      "cascadeAtCapBreaker",
      "cascadeAtCapStop",
      "invalidCeiling",
      "drift",
      "unknownTask",
    ]) {
      expect(kinds, `missing judgement '${kind}'`).toContain(kind);
    }
  });

  it("names the decide rules the scheduler prints", () => {
    const rules = Object.fromEntries(entries().map(([kind, e]) => [kind, e.rule]));
    expect(rules).toMatchObject({
      conflictScan: "Conflict scan",
      seatStatus: "Seat status",
      commitMissing: "Commit missing",
      verifyExit3: "Verify exit 3",
      breaker: "Breaker",
      breakerFixSpent: "Breaker",
      cascadeAtCapBreaker: "Breaker",
      invalidCeiling: "Invalid ceiling",
      drift: "Drift",
      unknownTask: "Unknown task",
    });
  });

  it("gives every entry a rule, at least one closes alternative, a close predicate and a successor", () => {
    expect(entries().length).toBeGreaterThan(0);
    for (const [kind, e] of entries()) {
      expect(typeof e.rule === "string" && e.rule.trim() !== "", `${kind}: rule`).toBe(true);
      expect(Array.isArray(e.closes), `${kind}: closes is a list`).toBe(true);
      const closes = e.closes as unknown[];
      expect(closes.length, `${kind}: closes`).toBeGreaterThan(0);
      for (const alt of closes) expect(typeof alt === "string" && alt.trim() !== "", `${kind}: closes alternative ${String(alt)}`).toBe(true);
      expect(typeof e.close, `${kind}: close predicate`).toBe("function");
      expect(typeof e.successor, `${kind}: successor`).toBe("function");
    }
  });

  it("offers only closes alternatives that kf record accepts", () => {
    const failures: string[] = [];
    for (const [kind, e] of entries()) {
      for (const template of e.closes as string[]) {
        const line = render(template);
        const { event, exact } = eventFor(line);
        const res = buildLine(LEDGER, event);
        if (!res.ok) failures.push(`${kind}: '${template}' → '${line}' refused (${res.code}): ${res.reason}`);
        else if (exact && res.line !== line) failures.push(`${kind}: '${template}' → '${line}' records as '${res.line}'`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("closes the Breaker by a park plus a decided note, or by a minimal-fix note", () => {
    const closes = closesOf("breaker");
    expect(closes.some(isPark), "a parked line").toBe(true);
    expect(closes.some(isPlainDecided), "a decided note").toBe(true);
    expect(closes.some(isMinimalFix), "a minimal-fix note").toBe(true);
  });

  it("closes the Breaker only by parking once the minimal fix is spent", () => {
    const closes = closesOf("breakerFixSpent");
    expect(closes.some(isPark), "a parked line").toBe(true);
    expect(closes.filter(isMinimalFix)).toEqual([]);
  });

  it("ends the cap stop of a reopened task by a minimal-fix note or a superseded completion", () => {
    const closes = closesOf("capStop");
    expect(closes.some(isMinimalFix), "a minimal-fix note").toBe(true);
    expect(closes.some(isSuperseded), "a superseded completion").toBe(true);
  });

  it("ends the cap stop only by a superseded completion once the minimal fix is spent", () => {
    const closes = closesOf("capStopFixSpent");
    expect(closes.some(isSuperseded), "a superseded completion").toBe(true);
    expect(closes.filter(isMinimalFix)).toEqual([]);
  });

  it("closes cascade findings at the cap only by parking on a task never reopened", () => {
    const closes = closesOf("cascadeAtCapBreaker");
    expect(closes.some(isPark), "a parked line").toBe(true);
    expect(closes.filter(isMinimalFix)).toEqual([]);
  });

  it("ends cascade findings at the cap of a reopened task only by a superseded completion", () => {
    const closes = closesOf("cascadeAtCapStop");
    expect(closes.length).toBeGreaterThan(0);
    expect(closes.every(isSuperseded)).toBe(true);
  });

  it("closes Commit missing by the commits note or a developer re-dispatch", () => {
    const closes = closesOf("commitMissing");
    expect(closes).toContain("Note <task>: commits <sha7>");
    expect(closes.some((t) => /^<task>: developer dispatched\b/.test(t)), "a developer re-dispatch").toBe(true);
  });
});
