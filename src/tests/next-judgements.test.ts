import { describe, it, expect } from "vitest";

import { buildLine, type RecordEvent } from "../workflow/next/record.js";
import { JUDGEMENTS, closesText, isSuperseded as supersededText } from "../workflow/next/judgements.js";
import { foldWorld, initialTask, step } from "../workflow/next/fold.js";
import { liveCap } from "../workflow/next/cap.js";
import { emptyClosesGuard } from "../workflow/next/liveness.js";
import type { Action, CycleKind, Judgement, LedgerEvent, LoopInputs, MachineEvent, Seat, TaskPhase, TaskState, WaitBlocker, World } from "../workflow/next/types.js";

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
    const text = closesText(JUDGEMENTS.breaker, { kind: "breaker", task: TASK, openedAt: 10 });
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

  it("renders the Breaker's closes as the park and decided pair, then the minimal-fix note", () => {
    const text = closesText(JUDGEMENTS.breaker, { kind: "breaker", task: TASK, openedAt: 10 });
    expect(text).toBe(
      `${TASK}: parked — <finding> — Ruling: <why> and Note ${TASK}: decided — <what> or Note ${TASK}: decided — minimal fix past the cap: <change>`,
    );
  });

  it("renders the invalid ceiling's error in its closes", () => {
    const error = "ceiling 9 is above the limit";
    const text = closesText(JUDGEMENTS.invalidCeiling, { kind: "invalidCeiling", openedAt: 10, error });
    expect(text).toContain(`Ruling: … ${error}`);
    expect(text).not.toContain("<error>");
  });

  it("renders a single-line alternative with the task filled", () => {
    const text = closesText(JUDGEMENTS.commitMissing, { kind: "commitMissing", task: TASK, openedAt: 10, dispatchLine: 6 });
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

describe("rendered closes agree with the close predicate", () => {
  const dispatchedEvent = (seat: Seat): MachineEvent => ({ type: "dispatched", task: TASK, seat, model: "opus", line: 20, ts: 0 });
  const commitsEvent: MachineEvent = { type: "commits", task: TASK, shas: [SHA7], line: 20, ts: 0 } as unknown as MachineEvent;

  for (const seat of ["test-writer", "developer", "automation-writer", "code-reviewer"] as const) {
    it(`offers the commits note on a gated ${seat} exactly when the predicate accepts it`, () => {
      const phase = seat === "test-writer" ? ({ kind: "tests", writer: { kind: "gated", status: "BLOCKED", doneLine: 15 }, hashOwed: false } as TaskPhase) : cyclePhase("first");
      const { j, t } = gatedSeatTask(seat, phase);
      const text = closesText(JUDGEMENTS.seatStatus, j);
      const accepts = JUDGEMENTS.seatStatus.close(j, commitsEvent, t);
      expect(accepts).toBe(seat === "developer");
      expect(text.includes(`Note ${TASK}: commits `)).toBe(accepts);
    });

    it(`names the gated ${seat} in the re-dispatch alternative it offers`, () => {
      const { j, t } = gatedSeatTask(seat, cyclePhase("first"));
      const text = closesText(JUDGEMENTS.seatStatus, j);
      expect(JUDGEMENTS.seatStatus.close(j, dispatchedEvent(seat), t)).toBe(true);
      expect(text).toContain(`${TASK}: ${seat} dispatched`);
      expect(text).not.toMatch(/<task>|<seat>/);
    });
  }

  it("offers no developer re-dispatch for a gated developer of a minimal fix", () => {
    const { j, t } = gatedSeatTask("developer", cyclePhase("minimalFix"));
    // The task state is passed as the third argument, as close and successor take it.
    const text = (closesText as (entry: unknown, j: unknown, t: TaskState | null) => string)(JUDGEMENTS.seatStatus, j, t);
    expect(text).not.toContain("developer dispatched");
    expect(text).toContain("decided");
  });

  it("abandons the minimal fix when its gated developer is dispatched again", () => {
    const { j, t } = gatedSeatTask("developer", cyclePhase("minimalFix"));
    const e = dispatchedEvent("developer");
    expect(JUDGEMENTS.seatStatus.close(j, e, t)).toBe(true);
    expect(JUDGEMENTS.seatStatus.successor(j, e, t)).toBe("minimalFixAbandoned");
  });

  it("offers no developer re-dispatch for a missing commit of a minimal fix", () => {
    const j: Judgement<"commitMissing"> = { kind: "commitMissing", task: TASK, openedAt: 10, dispatchLine: 6 };
    const t = taskIn(cyclePhase("minimalFix"));
    const text = (closesText as (entry: unknown, j: unknown, t: TaskState | null) => string)(JUDGEMENTS.commitMissing, j, t);
    expect(text).toContain(`Note ${TASK}: commits `);
    expect(text).not.toContain("developer dispatched");
  });

  it("abandons the minimal fix when a developer is dispatched after a missing commit", () => {
    const j: Judgement<"commitMissing"> = { kind: "commitMissing", task: TASK, openedAt: 10, dispatchLine: 6 };
    const t = taskIn(cyclePhase("minimalFix"));
    const e = dispatchedEvent("developer");
    expect(JUDGEMENTS.commitMissing.close(j, e, t)).toBe(true);
    expect(JUDGEMENTS.commitMissing.successor(j, e, t)).toBe("minimalFixAbandoned");
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

describe("the superseded predicate", () => {
  it.each(["superseded by TASK-004", "superseded — the plan moved it to TASK-009", "Superseded by TASK-004", "commits abc1234, superseded by TASK-004"])(
    "reads %s as superseded",
    (text) => {
      expect(supersededText(text)).toBe(true);
    },
  );

  it.each(["not superseded", "not yet superseded", "Not superseded — commits abc1234", "unsuperseded", "commits abc1234, review clean"])(
    "does not read %s as superseded",
    (text) => {
      expect(supersededText(text)).toBe(false);
    },
  );

  it("closes the cap stop on a superseded completion and not on a negated one", () => {
    const j: Judgement<"capStop"> = { kind: "capStop", task: TASK, openedAt: 10 };
    const complete = (text: string): MachineEvent => ({ type: "complete", task: TASK, text, line: 20, ts: 0 });
    expect(JUDGEMENTS.capStop.close(j, complete("superseded — moved to TASK-009"), null)).toBe(true);
    expect(JUDGEMENTS.capStop.close(j, complete("not superseded, commits abc1234"), null)).toBe(false);
  });
});

describe("the decision tag and the writer owed again", () => {
  type Fields = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;
  const inputs: LoopInputs = {
    feature: "demo",
    kind: "feature",
    level: "standard",
    tasks: [{ ...LOOP_TASK, files: ["src/a.ts"], testTypes: ["Unit"] }],
    ceiling: { max: 4, source: "config" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
  };
  const worldOf = (events: Fields[]): World => {
    const state = { events: events.map((e, i) => ({ ...e, line: i + 2, ts: i }) as LedgerEvent) };
    return foldWorld(state, inputs, liveCap(state, inputs));
  };
  /** Developer committed; the verify and the review run side by side. */
  const underCheck: Fields[] = [
    { type: "dispatched", task: TASK, seat: "test-writer", model: "opus" },
    { type: "done", task: TASK, seat: "test-writer", status: "DONE" },
    { type: "testHashes", task: TASK, files: { "src/a.test.ts": "a".repeat(40) } },
    { type: "dispatched", task: TASK, seat: "developer", model: "opus" },
    { type: "done", task: TASK, seat: "developer", status: "DONE" },
    { type: "commits", task: TASK, shas: [SHA7] },
    { type: "reviewPackage", task: TASK, shas: [SHA7] },
    { type: "verifyStarted", task: TASK },
    { type: "dispatched", task: TASK, seat: "code-reviewer", model: "opus" },
  ];
  const verifyExit3: Fields = { type: "verifyDone", task: TASK, exit: 3 };
  const reviewerBlocked: Fields = { type: "done", task: TASK, seat: "code-reviewer", status: "BLOCKED" };
  const decision: MachineEvent = { type: "decided", task: TASK, what: "go on", line: 99, ts: 99 };

  it("closes only the verify judgement, the earliest open, when a decided note follows two judgements", () => {
    const world = worldOf([...underCheck, verifyExit3, reviewerBlocked]);
    const t = world.tasks.get(TASK)!;
    expect(t.judgements.map((j) => j.kind)).toEqual(["verifyExit3", "seatStatus"]);

    const after = step(world, t, decision);

    // Tagged for the verify region: the verify moves on, the review region's gate stays open.
    expect(after.judgements.map((j) => j.kind)).toEqual(["seatStatus"]);
    expect(after.verify).toEqual({ kind: "owed", atHead: false, why: "decided" });
    expect(after.seats["code-reviewer"]).toEqual(t.seats["code-reviewer"]);
  });

  it("closes only the reviewer's gate, the earliest open, when it opened before the verify judgement", () => {
    const world = worldOf([...underCheck, reviewerBlocked, verifyExit3]);
    const t = world.tasks.get(TASK)!;
    expect(t.judgements.map((j) => j.kind)).toEqual(["seatStatus", "verifyExit3"]);

    const after = step(world, t, decision);

    // Tagged for the review region: the review is owed again, the verify region's judgement stays open.
    expect(after.judgements.map((j) => j.kind)).toEqual(["verifyExit3"]);
    expect(after.seats["code-reviewer"]).toEqual({ kind: "redispatchOwed", mode: "new" });
    expect(after.verify).toEqual(t.verify);
  });

  it("owes a round test-writer closed by a decision without its work again, until it is re-dispatched", () => {
    const gated = worldOf([
      ...underCheck,
      { type: "verifyDone", task: TASK, exit: 0 },
      { type: "done", task: TASK, seat: "code-reviewer", status: "findings" },
      { type: "dispatched", task: TASK, seat: "test-writer", model: "opus", round: 1 },
      { type: "done", task: TASK, seat: "test-writer", status: "NEEDS_CONTEXT" },
    ]);
    const t = gated.tasks.get(TASK)!;
    expect(t.writerOwed).toBeUndefined();

    const owed = step(gated, t, decision);
    expect(owed.writerOwed).toEqual({ seat: "test-writer", round: 1 });
    expect(owed.seats["test-writer"]).toEqual({ kind: "idle" });

    const again = step(gated, owed, { type: "dispatched", task: TASK, seat: "test-writer", model: "opus", round: 1, line: 100, ts: 100 });
    expect(again.writerOwed).toBeUndefined();
    expect(again.seats["test-writer"]).toMatchObject({ kind: "running", round: 1 });
  });
});

describe("the liveness guard for a decide with no closing line", () => {
  const decide = (task?: string, closes = ""): Action => ({ kind: "decide", ...(task !== undefined ? { task } : {}), rule: "Seat status", reason: "r", closes });

  it("stops the item as a whole for a task-less decide", () => {
    expect(emptyClosesGuard([decide()])).toEqual({ tasks: [], item: true });
  });

  it("stops each task once for its own decides and leaves the item running", () => {
    expect(emptyClosesGuard([decide(TASK), decide(TASK), decide("TASK-002")])).toEqual({ tasks: [TASK, "TASK-002"], item: false });
  });

  it("stops both a task and the item when both kinds are present", () => {
    expect(emptyClosesGuard([decide(TASK), decide()])).toEqual({ tasks: [TASK], item: true });
  });

  it("stops nothing for an empty list or for a stop", () => {
    expect(emptyClosesGuard([])).toEqual({ tasks: [], item: false });
    expect(emptyClosesGuard([{ kind: "stop", reason: "r" }])).toEqual({ tasks: [], item: false });
  });
});
