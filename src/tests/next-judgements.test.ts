import { describe, it, expect } from "vitest";

import { buildLine, type RecordEvent } from "../workflow/next/record.js";
import { JUDGEMENTS, closesText } from "../workflow/next/judgements.js";
import { initialTask } from "../workflow/next/fold.js";
import type { CycleKind, Judgement, MachineEvent, Seat, TaskPhase, TaskState, WaitBlocker } from "../workflow/next/types.js";

// `closes` lists alternatives; each alternative is a conjunction of ledger-line templates, all of which the session
// writes to close the judgement. A template: `<task>` is the judged task, other `<name>` tokens and `…` are
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
const alternativesOf = (kind: string): string[][] => (JUDGEMENTS as Record<string, Entry>)[kind].closes as string[][];
/** Every template of every alternative of `kind`, flattened. */
const closesOf = (kind: string): string[] => alternativesOf(kind).flat();

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
      for (const alt of closes) {
        expect(Array.isArray(alt) && alt.length > 0, `${kind}: closes alternative ${JSON.stringify(alt)} is a non-empty conjunction`).toBe(true);
        for (const t of alt as unknown[]) expect(typeof t === "string" && t.trim() !== "", `${kind}: template ${String(t)}`).toBe(true);
      }
      expect(typeof e.close, `${kind}: close predicate`).toBe("function");
      expect(typeof e.successor, `${kind}: successor`).toBe("function");
    }
  });

  it("offers only closes alternatives that kf record accepts", () => {
    const failures: string[] = [];
    for (const [kind, e] of entries()) {
      for (const template of (e.closes as string[][]).flat()) {
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

describe("closes alternatives as conjunctions", () => {
  it("closes the Breaker by the park and decided pair together, or by the minimal-fix note alone", () => {
    const alts = alternativesOf("breaker");
    const pair = alts.filter((alt) => alt.length === 2 && alt.some(isPark) && alt.some(isPlainDecided));
    expect(pair, "one alternative is the park plus decided pair").toHaveLength(1);
    expect(alts.some((alt) => alt.length === 1 && isMinimalFix(alt[0])), "the minimal-fix note alone").toBe(true);
    // Neither half of the pair closes the Breaker on its own.
    expect(alts.some((alt) => alt.length === 1 && (isPark(alt[0]) || isPlainDecided(alt[0])))).toBe(false);
  });

  it("closes the Breaker on a park alone once the minimal fix is spent", () => {
    const alts = alternativesOf("breakerFixSpent");
    expect(alts.some((alt) => alt.length === 1 && isPark(alt[0])), "a park alone").toBe(true);
    expect(alts.flat().filter(isMinimalFix)).toEqual([]);
  });

  it("lists a verify started among the lines that lift a Verify exit 2 stop", () => {
    const alts = alternativesOf("verifyExit2");
    expect(alts.some((alt) => alt.length === 1 && alt[0] === "<task>: verify started")).toBe(true);
  });

  it("renders the Breaker's closes with the task filled and the pair kept together", () => {
    const text = closesText(JUDGEMENTS.breaker, TASK);
    expect(typeof text).toBe("string");
    expect(text).not.toMatch(/<task>/i);
    expect(text).toContain(`${TASK}: parked — `);
    expect(text).toContain(`Note ${TASK}: decided — `);
    expect(text).toContain(`Note ${TASK}: decided — minimal fix past the cap:`);
    // The pair is one alternative: the park and the plain decided note come before the minimal-fix alternative.
    const park = text.indexOf(`${TASK}: parked — `);
    const minimal = text.indexOf("minimal fix past the cap:");
    const plain = text.indexOf(`Note ${TASK}: decided — `);
    expect(park).toBeLessThan(minimal);
    expect(plain).toBeLessThan(minimal);
  });

  it("renders a single-line alternative with the task filled", () => {
    const text = closesText(JUDGEMENTS.commitMissing, TASK);
    expect(text).toContain(`Note ${TASK}: commits `);
    expect(text).not.toMatch(/<task>/i);
  });
});

// Builders for the close predicates and successors: a plan task, a ledger event, and a breaker at the cap.
const LOOP_TASK = { id: TASK, dependencies: [], files: null, wave: 1, overlaps: [], inline: false, testTypes: [] };

function taskIn(phase: TaskPhase, seats: Partial<TaskState["seats"]> = {}): TaskState {
  const t = initialTask(LOOP_TASK);
  return { ...t, phase, seats: { ...t.seats, ...seats } };
}

const breakerState = (cap: { parked: number[]; decidedAt?: number; fixSpent: boolean }): TaskState =>
  taskIn({ kind: "atCap", cap: { kind: "breaker", ...cap } });

const decidedEvent = (what: string, line = 20): MachineEvent => ({ type: "decided", task: TASK, what, line, ts: 0 });
const parkedEvent = (line = 20): MachineEvent => ({ type: "parked", task: TASK, finding: "flaky retry", line, ts: 0 });
const rulingEvent = (line = 20): MachineEvent => ({ type: "ruling", task: TASK, text: `Ruling: ${TASK} — accept`, line, ts: 0 });

const breakerJ: Judgement<"breaker"> = { kind: "breaker", task: TASK, openedAt: 10 };
const fixSpentJ: Judgement<"breakerFixSpent"> = { kind: "breakerFixSpent", task: TASK, openedAt: 10 };

describe("Breaker close predicates", () => {
  it("closes on the decided note when the park came first", () => {
    const t = breakerState({ parked: [12], fixSpent: false });
    const e = decidedEvent("park the retry finding");
    expect(JUDGEMENTS.breaker.close(breakerJ, e, t)).toBe(true);
    expect(JUDGEMENTS.breaker.successor(breakerJ, e, t)).toBe("parkedClosed");
  });

  it("closes on the park when the decided note came first", () => {
    const t = breakerState({ parked: [], decidedAt: 12, fixSpent: false });
    const e = parkedEvent();
    expect(JUDGEMENTS.breaker.close(breakerJ, e, t)).toBe(true);
    expect(JUDGEMENTS.breaker.successor(breakerJ, e, t)).toBe("parkedClosed");
  });

  it("stays open on a decided note with nothing parked yet", () => {
    const t = breakerState({ parked: [], fixSpent: false });
    expect(JUDGEMENTS.breaker.close(breakerJ, decidedEvent("park the retry finding"), t)).toBe(false);
  });

  it("closes on a minimal-fix note and owes the minimal fix", () => {
    const t = breakerState({ parked: [], fixSpent: false });
    const e = decidedEvent("minimal fix past the cap: guard the retry");
    expect(JUDGEMENTS.breaker.close(breakerJ, e, t)).toBe(true);
    expect(JUDGEMENTS.breaker.successor(breakerJ, e, t)).toBe("minimalFixOwed");
  });

  it("refuses a minimal-fix note once the fix is spent", () => {
    const t = breakerState({ parked: [12], fixSpent: true });
    expect(JUDGEMENTS.breakerFixSpent.close(fixSpentJ, decidedEvent("minimal fix past the cap: guard the retry"), t)).toBe(false);
  });

  it("closes on a park alone once the fix is spent", () => {
    const t = breakerState({ parked: [], fixSpent: true });
    const e = parkedEvent();
    expect(JUDGEMENTS.breakerFixSpent.close(fixSpentJ, e, t)).toBe(true);
    expect(JUDGEMENTS.breakerFixSpent.successor(fixSpentJ, e, t)).toBe("parkedClosed");
  });
});

function cyclePhase(cycle: CycleKind): TaskPhase {
  return {
    kind: "cycle",
    cycle,
    round: cycle === "round" ? 2 : 0,
    openedAt: 5,
    implementer: { kind: "running", dispatchLine: 6, inline: false },
    sinceCommit: null,
    commits: [],
  };
}

function gatedSeatTask(seat: Seat, phase: TaskPhase): { j: Judgement<"seatStatus">; t: TaskState } {
  const j: Judgement<"seatStatus"> = { kind: "seatStatus", task: TASK, openedAt: 15, seat, status: "BLOCKED", doneLine: 15 };
  const t = taskIn(phase, { [seat]: { kind: "gated", status: "BLOCKED", doneLine: 15 } });
  return { j, t };
}

describe("Seat status successor", () => {
  const closers: [string, MachineEvent][] = [
    ["a decided note", decidedEvent("go on with the seat's work")],
    ["a Ruling", rulingEvent()],
  ];

  for (const [how, e] of closers) {
    it(`owes a gated code-reviewer's review again after ${how}`, () => {
      const { j, t } = gatedSeatTask("code-reviewer", cyclePhase("first"));
      expect(JUDGEMENTS.seatStatus.close(j, e, t)).toBe(true);
      expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("seatRedispatch");
    });

    it(`abandons the spent minimal fix of a gated developer after ${how}`, () => {
      const { j, t } = gatedSeatTask("developer", cyclePhase("minimalFix"));
      expect(JUDGEMENTS.seatStatus.close(j, e, t)).toBe(true);
      expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("minimalFixAbandoned");
    });

    for (const cycle of ["first", "round"] as const) {
      it(`takes a gated developer of a ${cycle} cycle on as done after ${how}`, () => {
        const { j, t } = gatedSeatTask("developer", cyclePhase(cycle));
        expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("seatAsDone");
      });
    }

    it(`takes a gated test-writer on as done after ${how}`, () => {
      const { j, t } = gatedSeatTask("test-writer", { kind: "tests", writer: { kind: "gated", status: "BLOCKED", doneLine: 15 }, hashOwed: false });
      expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("seatAsDone");
    });

    it(`takes a gated automation-writer on as done after ${how}`, () => {
      const { j, t } = gatedSeatTask("automation-writer", cyclePhase("first"));
      expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("seatAsDone");
    });
  }

  it("runs the seat again when the gate is closed by a re-dispatch", () => {
    const { j, t } = gatedSeatTask("code-reviewer", cyclePhase("first"));
    const e: MachineEvent = { type: "dispatched", task: TASK, seat: "code-reviewer", model: "opus", line: 20, ts: 0 };
    expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("seatRunning");
  });
});

describe("judgement and wait types", () => {
  it("lets a wait be held by an open task judgement or a stop", () => {
    const byJudgement: WaitBlocker = { kind: "hold", judgement: "breaker", task: TASK };
    const byItemStop: WaitBlocker = { kind: "hold", judgement: "stop" };
    expect([byJudgement.kind, byItemStop.kind]).toEqual(["hold", "hold"]);
  });

  it("requires a task on a task-scoped judgement and not on an item judgement", () => {
    // @ts-expect-error a Breaker is always about one task
    const noTask: Judgement<"breaker"> = { kind: "breaker", openedAt: 1 };
    const item: Judgement<"conflictScan"> = { kind: "conflictScan", openedAt: 1 };
    expect([noTask.kind, item.kind]).toEqual(["breaker", "conflictScan"]);
  });
});
