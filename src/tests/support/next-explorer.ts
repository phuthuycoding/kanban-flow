import { liveCap } from "../../workflow/next/cap.js";
import { foldWorld } from "../../workflow/next/fold.js";
import { readLedgerState } from "../../workflow/next/ledger-state.js";
import { buildLine, type RecordEvent } from "../../workflow/next/record.js";
import { schedule } from "../../workflow/next/schedule.js";
import type { Action, LedgerEvent, LedgerState, LoopInputs, LoopTask, NextResult, Seat, VerifyRun } from "../../workflow/next/types.js";
import { completionOracle, isComplete } from "./next-oracle.js";

// A bounded explorer of `kf next` (design § 5.4 ii). An obedient session calls `kf next`, carries out everything it
// prints — choosing, for each decide or stop, among the lines that close it — and, when nothing is printed to do,
// answers one seat or verify in flight, branching over the outcomes a real loop can see. Each ledger line goes through
// `kf record`'s own line builder, so every explored ledger is one `kf record` can produce. At every reached state the
// printed result (plain and `--resume`) is checked against the liveness invariant LIVE (a)–(g) of design § 5.1, the
// independent completion oracle, the one-file-writer-per-overlap ruling, and the absence of the fail-safe stop; from
// every state a happy session must still reach `finished`.
//
// The explorer is deterministic: line stamps, commit shas and verify-log times derive from the line index and the task's
// history, and the search is breadth-first in a fixed move order, fault level by fault level. Rare outcomes (a non-DONE
// status, a failed verify, a lost session, an injected legacy line, a reopen) spend a per-path fault budget, and reviews
// with findings a findings budget; seeds that start a task at its Breaker or reopened after round 5 put the cap within
// reach of the depth bound. States are deduplicated by the folded World with its ledger positions dropped.

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const FEATURE = "explorer";
const HEADER = `# Task loop ledger — ${FEATURE} — plan: /repo/.works/implementation/${FEATURE}_20261107_1200/phase-2-implementation-plan.md`;

function planTask(id: string, over: Partial<LoopTask> = {}): LoopTask {
  return { id, dependencies: [], files: [`src/${id.toLowerCase()}.ts`], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"], ...over };
}

function inputsOf(tasks: LoopTask[], ceiling: number, over: Partial<LoopInputs> = {}): LoopInputs {
  return {
    feature: FEATURE,
    kind: "feature",
    level: "standard",
    tasks,
    ceiling: { max: ceiling, source: "config" },
    reportCommits: {},
    verifyRuns: {},
    gitLog: [],
    ...over,
  };
}

const T1 = "TASK-001";
const T2 = "TASK-002";

/** The six small plans of design § 5.4 (ii), each built for a ceiling. */
export const PLANS: Record<string, (ceiling: number) => LoopInputs> = {
  "P1 single task": (c) => inputsOf([planTask(T1)], c),
  "P2 dependent pair": (c) => inputsOf([planTask(T1), planTask(T2, { dependencies: [T1], wave: 2 })], c),
  "P3 overlapping waves": (c) =>
    inputsOf(
      [
        planTask(T1, { files: ["src/shared.ts", "src/task-001.ts"], overlaps: [T2] }),
        planTask(T2, { files: ["src/shared.ts", "src/task-002.ts"], overlaps: [T1], wave: 2 }),
      ],
      c,
    ),
  "P4 inline chain": (c) => inputsOf([planTask(T1, { inline: true }), planTask(T2, { dependencies: [T1], wave: 2, inline: true })], c),
  "P5 UI task at Level full": (c) => inputsOf([planTask(T1, { testTypes: ["Unit", "UI"] })], c, { level: "full" }),
  "P6 bug": (c) => inputsOf([planTask(T1)], c, { kind: "bug", level: "unit" }),
};

// ---------------------------------------------------------------------------
// Explored states: ledger lines with the inputs each line brought with it
// ---------------------------------------------------------------------------

/** What a line brings outside the ledger: a commit on the branch and in the task's report, or a verify-log block. */
export type Mutation = { kind: "commit"; task: string; sha: string } | { kind: "verifyRun"; task: string; exit: number; text: string };

export interface Step {
  /** The `kf record` call the line came from. */
  event: RecordEvent;
  /** The line body `buildLine` returned. */
  body: string;
  mutation?: Mutation;
  /** What the session did, for a readable trace. */
  label: string;
}

const T0 = Date.UTC(2026, 10, 7, 3, 0, 0);
const SEVEN_HOURS = 7 * 3_600_000;
const lineTs = (i: number): number => T0 + (i + 1) * 60_000;
const stampOf = (i: number): string => `${new Date(lineTs(i) + SEVEN_HOURS).toISOString().slice(0, 19)}+07:00`;

export function ledgerText(steps: Step[]): string {
  return [HEADER, ...steps.map((s, i) => `${s.body} @ ${stampOf(i)}`), ""].join("\n");
}

/** The plan inputs with each line's commit and verify block, timed just before the line that reports it. */
export function inputsFor(base: LoopInputs, steps: Step[]): LoopInputs {
  const gitLog: { sha: string; ts: number }[] = [];
  const reportCommits: Record<string, string[]> = {};
  const verifyRuns: Record<string, VerifyRun[]> = {};
  steps.forEach((s, i) => {
    const m = s.mutation;
    if (m === undefined) return;
    const ts = lineTs(i) - 30_000;
    if (m.kind === "commit") {
      gitLog.push({ sha: m.sha, ts });
      (reportCommits[m.task] ??= []).push(m.sha.slice(0, 7));
    } else {
      (verifyRuns[m.task] ??= []).push({ ts, exit: m.exit, text: m.text });
    }
  });
  return { ...base, gitLog, reportCommits, verifyRuns };
}

function parse(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`explorer: the ledger reader refused a buildLine ledger: ${JSON.stringify(read.repair)}`);
  return read.state;
}

/** Appends one `kf record` call through `buildLine`; a refusal is returned, never swallowed. */
function append(steps: Step[], event: RecordEvent, label: string, mutation?: Mutation): { ok: true; steps: Step[] } | { ok: false; reason: string } {
  const built = buildLine(steps.length === 0 ? null : ledgerText(steps), event);
  if (!built.ok) return { ok: false, reason: built.reason };
  return { ok: true, steps: [...steps, { event, body: built.line, label, ...(mutation ? { mutation } : {}) }] };
}

/** Replays every step through `buildLine` from an empty ledger: true when `kf record` would have accepted each. */
export function replayable(steps: Step[]): boolean {
  let acc: Step[] = [];
  for (const s of steps) {
    const r = append(acc, s.event, s.label, s.mutation);
    if (!r.ok) return false;
    acc = r.steps;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Evaluating a state
// ---------------------------------------------------------------------------

export interface Evaluated {
  state: LedgerState;
  inputs: LoopInputs;
  plain: NextResult;
  resumed: NextResult;
  /** The folded World, serialized with its line numbers and stamps: two equal values are the same state. */
  worldExact: string;
  /** The folded World with every ledger position dropped: the dedupe key. */
  worldKey: string;
}

/** Keys of the World that hold a ledger line, a position or a stamp, not a scheduling fact. */
const POSITION_KEYS = new Set(["line", "ts", "openedAt", "dispatchLine", "doneLine", "devDoneAt", "packagedAt", "sinceCommit", "decidedAt", "parked", "at"]);

function serialize(value: unknown, dropPositions: boolean): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (dropPositions && POSITION_KEYS.has(key)) {
      if (Array.isArray(v)) return v.length;
      return v === undefined ? undefined : typeof v === "number" ? "#" : v;
    }
    if (key === "inputs") return undefined;
    if (v instanceof Map) return [...v.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    if (v instanceof Set) return [...v].sort();
    return v;
  });
}

/** Folds the state and keys it; the two `kf next` results are computed on first read, so a seen state costs no schedule. */
export function evaluate(base: LoopInputs, steps: Step[]): Evaluated {
  const state = parse(ledgerText(steps));
  const inputs = inputsFor(base, steps);
  const world = foldWorld(state, inputs, liveCap(state, inputs));
  // The canonical key also carries what the World reads from the inputs outside the ledger.
  const outside = JSON.stringify({ commits: inputs.gitLog.map((g) => g.sha), runs: Object.entries(inputs.verifyRuns).map(([t, r]) => [t, r.map((x) => [x.exit, x.text])]) });
  let plain: NextResult | undefined;
  let resumed: NextResult | undefined;
  let exact: string | undefined;
  return {
    state,
    inputs,
    get plain() {
      return (plain ??= schedule(state, inputs, { resume: false }));
    },
    get resumed() {
      return (resumed ??= schedule(state, inputs, { resume: true }));
    },
    get worldExact() {
      return (exact ??= serialize(world, false) + outside);
    },
    worldKey: serialize(world, true) + outside,
  };
}

/** The state with a stand-in `kf next` result, so a check can be shown to catch a defect the machine does not have. */
export function withResult(ev: Evaluated, result: NextResult): Evaluated {
  return Object.create(ev, { plain: { value: result }, resumed: { value: result } }) as Evaluated;
}

/** The steps of a ledger written through `buildLine`, for hand-made states; a refused line throws. */
export function stepsOf(calls: RecordEvent[]): Step[] {
  let acc: Step[] = [];
  for (const event of calls) {
    const r = append(acc, event, "hand-made");
    if (!r.ok) throw new Error(`explorer: kf record refused a hand-made line: ${r.reason}`);
    acc = r.steps;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// The obedient session
// ---------------------------------------------------------------------------

export interface Move {
  /** One or two `kf record` calls appended in order (a verify exit and the session's routing note go together). */
  calls: { event: RecordEvent; mutation?: Mutation; speculative?: boolean }[];
  label: string;
  /** A rare outcome that spends the path's fault budget. */
  fault: boolean;
  /** A review that returns findings, which spends the path's findings budget. */
  findings?: boolean;
  /** The move carries out what `kf next` printed (not an in-flight answer or an injected line). */
  printed?: boolean;
  /** The move tries a line a printed stop may be closed by: a stop prints no closes, so a try may change nothing. */
  speculative?: boolean;
}

const words = (text: string): string[] => text.split(" ");
const line = (text: string): RecordEvent => ({ event: "line", args: words(text) });

const shellUnquote = (word: string): string => {
  if (!word.startsWith("'")) return word;
  return word.slice(1, -1).replace(/'\\''/g, "'");
};

/** Fills the free-text slots of a printed template the way a session would. */
function fill(text: string, task: string | undefined): string {
  const id = (task ?? "task").toLowerCase();
  return text
    .replace(/<file>=<sha> …/g, `src/tests/${id}.test.ts=${"e".repeat(40)}`)
    .replace(/<[^<>]+>/g, "explorer")
    .replace(/…/g, "etc");
}

/** The `kf record` call behind a printed write, read from its `record` field. */
function recordOfWrite(a: Extract<Action, { kind: "write" }>): RecordEvent {
  const [head, quoted] = a.record.split(" -- ");
  const tokens = head.split(" ");
  if (tokens[0] !== "kf" || tokens[1] !== "record" || tokens[2] !== FEATURE) throw new Error(`explorer: a write's record is not a kf record call: ${a.record}`);
  const event = tokens[3];
  const args = tokens.slice(4);
  if (quoted !== undefined) args.push(...words(fill(shellUnquote(quoted), a.task)));
  return { event, args: args.map((x) => fill(x, a.task)) };
}

/** The task's next commit sha: numbered by the task's commits so far, so equal histories get equal shas. */
function newSha(steps: Step[], task: string): string {
  const n = steps.filter((s) => s.mutation?.kind === "commit" && s.mutation.task === task).length + 1;
  const t = Number(task.slice(5));
  return `${t.toString(16).padStart(3, "0")}${n.toString(16).padStart(4, "0")}${"c".repeat(33)}`;
}

const lastDispatch = (state: LedgerState, task: string, seat: string): Extract<LedgerEvent, { type: "dispatched" }> | undefined =>
  state.events.filter((e): e is Extract<LedgerEvent, { type: "dispatched" }> => e.type === "dispatched" && e.task === task && e.seat === seat).at(-1);

function dispatchEvent(task: string, seat: string, model: string, round?: number, cascade?: string): RecordEvent {
  return {
    event: "dispatched",
    args: [task, seat],
    model,
    ...(round !== undefined ? { round: String(round) } : {}),
    ...(cascade !== undefined ? { cascade } : {}),
  };
}

/** One closes template line turned into the call that writes it. */
function closeCall(template: string, task: string | undefined, ev: Evaluated, steps: Step[]): { event: RecordEvent; mutation?: Mutation } | null {
  let m: RegExpExecArray | null;
  if ((m = /^(TASK-\d+): (test-writer|developer|automation-writer|code-reviewer) dispatched …$/.exec(template))) {
    const prev = lastDispatch(ev.state, m[1], m[2]);
    return { event: dispatchEvent(m[1], m[2], prev?.model ?? "sonnet", prev?.round, prev?.cascade) };
  }
  if ((m = /^Note (TASK-\d+): commits <sha7>$/.exec(template))) {
    const sha = newSha(steps, m[1]);
    return { event: { event: "commits", args: [m[1], sha.slice(0, 7)] }, mutation: { kind: "commit", task: m[1], sha } };
  }
  if ((m = /^(TASK-\d+): verify started$/.exec(template))) return { event: { event: "verify-started", args: [m[1]] } };
  if ((m = /^(TASK-\d+): complete \((.+)\)$/.exec(template))) return { event: { event: "complete", args: [m[1], ...words(fill(m[2], m[1]))] } };
  if ((m = /^(TASK-\d+): developer done status=(\S+)$/.exec(template))) return { event: { event: "done", args: [m[1], "developer"], status: m[2] } };
  if (/^Scan: …$/.test(template)) return { event: line("Scan: clean") };
  if (template.startsWith("Ruling: … ")) return { event: line(`Ruling: explorer — ${template.slice("Ruling: … ".length)}`) };
  if (/^(?:Ruling: |Note |TASK-\d+: parked — )/.test(template)) return { event: line(fill(template, task)) };
  return null;
}

/** The alternatives of a decide's closes: each a conjunction of template lines, plus the ruled fix round 5/5 rider. */
export function parseCloses(closes: string): { alternatives: string[][]; rider: string | null } {
  const rider = /, each with (TASK-\d+: fix round 5\/5 \(.*\))$/.exec(closes);
  const body = rider ? closes.slice(0, rider.index) : closes;
  return { alternatives: body.split(" or ").map((alt) => alt.split(" and ")), rider: rider ? rider[1] : null };
}

/** The lines a stop's reason can be closed by: the stop prints no closes, so the session tries each plausible one. */
function stopCandidates(task: string): string[] {
  return [
    `Note ${task}: decided — explorer ruling`,
    `${task}: verify started`,
    `Note ${task}: decided — minimal fix past the cap: bound the loop`,
    `${task}: complete (superseded — explorer)`,
  ];
}

const DEV_OUTCOMES: { status: string; commit: boolean; fault: boolean }[] = [
  { status: "DONE", commit: true, fault: false },
  { status: "DONE", commit: false, fault: true },
  { status: "DONE_WITH_CONCERNS", commit: true, fault: true },
  { status: "NEEDS_CONTEXT", commit: false, fault: true },
  { status: "BLOCKED", commit: false, fault: true },
  { status: "WEIRD", commit: false, fault: true },
];
// Every rare developer, writer and reviewer outcome is a task's own matter: the single-task plans explore them all.
const WRITER_OUTCOMES = [
  { status: "DONE", fault: false },
  { status: "DONE_WITH_CONCERNS", fault: true },
  { status: "NEEDS_CONTEXT", fault: true },
  { status: "BLOCKED", fault: true },
  { status: "WEIRD", fault: true },
];
const REVIEW_OUTCOMES = [
  { status: "clean", fault: false },
  { status: "findings", fault: false },
  { status: "NEEDS_CONTEXT", fault: true, local: true },
  { status: "WEIRD", fault: true, local: true },
];

const FAIL_LOG = "FAIL src/tests/explorer.test.ts > keeps the rule: expected 1 to be 2";
const CONTENTION_LOG = "Error: listen EADDRINUSE: address already in use :::3000";

function verifyOutcomes(task: string, plan: LoopTask[]): { label: string; exit: number; log: string | null; note?: RecordEvent; fault: boolean; local?: boolean }[] {
  const others = plan.filter((p) => p.id !== task).map((p) => p.id);
  return [
    { label: "exit 0", exit: 0, log: "Test Files 1 passed", fault: false },
    { label: "exit 1 with no log block", exit: 1, log: null, fault: true, local: true },
    { label: "exit 1 failing", exit: 1, log: FAIL_LOG, fault: true },
    { label: "exit 1 contention", exit: 1, log: CONTENTION_LOG, fault: true },
    ...others.map((x) => ({ label: `exit 1 routed to ${x}`, exit: 1, log: FAIL_LOG, note: line(`Note ${task}: verify routed — ${x}`), fault: true })),
    ...others.map((x) => ({
      label: `exit 1 waits for ${x}`,
      exit: 1,
      log: FAIL_LOG,
      note: line(`Note ${task}: verify waits — src/${x.toLowerCase()}.ts (${x})`),
      fault: true,
    })),
    { label: "exit 2", exit: 2, log: "a changed file is outside the task's Files", fault: true, local: true },
    { label: "exit 3", exit: 3, log: "bad input", fault: true, local: true },
    { label: "exit 137", exit: 137, log: "Killed", fault: true, local: true },
  ];
}

type Call = Move["calls"][number];

/**
 * The same close line is already in the ledger since the task's latest developer dispatch or reopen: a session does
 * not write one ruling twice for one judgement, and offering it again would only lengthen paths.
 */
function writtenSince(steps: Step[], task: string | undefined, event: RecordEvent): boolean {
  if (event.event !== "line" || task === undefined) return false;
  let from = 0;
  steps.forEach((s, i) => {
    if (s.body.startsWith(`${task}: developer dispatched`) || s.body.startsWith(`Note ${task}: reopened`)) from = i + 1;
  });
  const text = event.args.join(" ");
  return steps.slice(from).some((s) => s.event.event === "line" && s.event.args.join(" ") === text);
}

/** The ways the session can carry out one printed action: one call sequence each (a decide or stop offers several). */
function optionsOf(a: Action, ev: Evaluated, steps: Step[]): Call[][] {
  switch (a.kind) {
    case "dispatch":
      return [[{ event: dispatchEvent(a.task, a.seat, a.inline === true ? "inline" : "sonnet", a.round, a.cascade) }]];
    case "verify":
      return [[{ event: { event: "verify-started", args: [a.task] } }]];
    case "write":
      return [[{ event: recordOfWrite(a) }]];
    case "complete":
      return [[{ event: { event: "complete", args: [a.task, "all", "checks", "passed"] } }]];
    case "decide": {
      const { alternatives, rider } = parseCloses(a.closes);
      const options: Call[][] = [];
      const riderDue = rider !== null && !steps.some((s) => s.event.event === "fix-round" && s.event.args[0] === a.task && s.event.args[1] === "5");
      for (const alt of alternatives) {
        for (const template of alt) {
          const call = closeCall(template, a.task, ev, steps);
          if (call === null || writtenSince(steps, a.task, call.event)) continue;
          // Ruled: at the cap the session writes the round's fix round 5/5 line with the line that closes the decide.
          if (riderDue) {
            const m = /^(TASK-\d+): fix round 5\/5 \((.*)\)$/.exec(rider)!;
            options.push([{ event: { event: "fix-round", args: [m[1], "5", ...words(fill(m[2], m[1]))] } }, call]);
          } else options.push([call]);
        }
      }
      return options;
    }
    case "stop":
      if (a.task === undefined) return [];
      return stopCandidates(a.task).flatMap((c) => {
        const call = closeCall(c, a.task, ev, steps);
        return call === null ? [] : [[{ ...call, speculative: true }]];
      });
    case "wait":
    case "finished":
      return [];
  }
}

const actionable = (a: Action): boolean => a.kind !== "wait" && a.kind !== "finished";

/**
 * The session's batches from this `kf next` call: it carries out every printed action, in print order, choosing one
 * close for each decide or stop (one batch per choice). Each in-flight answer is its own move, taken only when nothing
 * is printed to do — a session acts on what `kf next` prints before it waits.
 */
function batchesOf(result: NextResult, ev: Evaluated, steps: Step[], fault: boolean, tag: string): Move[] {
  const acts = result.actions.filter(actionable);
  let batches: { calls: Call[]; label: string[] }[] = [{ calls: [], label: [] }];
  const speculative = acts.some((a) => a.kind === "stop");
  for (const a of acts) {
    const options = optionsOf(a, ev, steps);
    if (options.length === 0) continue;
    const next: typeof batches = [];
    for (const b of batches) for (const o of options) next.push({ calls: [...b.calls, ...o], label: [...b.label, render({ ...result, inFlight: [], actions: [a] })[0]] });
    batches = next;
  }
  return batches.filter((b) => b.calls.length > 0).map((b) => ({ calls: b.calls, label: `${tag}${b.label.join("; ")}`, fault, printed: true, speculative }));
}

/**
 * Which rare outcomes a search branches on: `all`, or `cross-task` — only those that act between tasks (a failing,
 * contended, routed or waiting verify, a lost session, a reopen). The single-task plans take `all`; the multi-task
 * plans take `cross-task`, which keeps their interleavings inside the state bound.
 */
export type FaultProfile = "all" | "cross-task";

/** Every move the session may make from this state, in a fixed order. */
export function movesOf(ev: Evaluated, steps: Step[], plan: LoopTask[], faults: FaultProfile = "all"): Move[] {
  const allowed = (o: { fault: boolean; local?: boolean }): boolean => faults === "all" || !o.fault || o.local !== true;
  const moves: Move[] = [];
  const seen = new Set<string>();
  const add = (m: Move): void => {
    const k = JSON.stringify(m.calls.map((c) => c.event));
    if (seen.has(k)) return;
    seen.add(k);
    moves.push(m);
  };

  const printed = batchesOf(ev.plain, ev, steps, false, "");
  for (const m of printed) add(m);

  // Answer one seat or verify in flight, when nothing is printed to do.
  if (printed.length === 0) {
    for (const f of ev.plain.inFlight) {
      if (f.seat === "verify") {
        for (const o of verifyOutcomes(f.task, plan).filter(allowed)) {
          const calls: Move["calls"] = [
            { event: { event: "verify-done", args: [f.task], exit: String(o.exit) }, ...(o.log !== null ? { mutation: { kind: "verifyRun", task: f.task, exit: o.exit, text: o.log } } : {}) },
          ];
          if (o.note) calls.push({ event: o.note });
          add({ calls, label: `verify ${f.task} ${o.label}`, fault: o.fault });
        }
      } else if (f.seat === "developer") {
        for (const o of DEV_OUTCOMES.filter((x) => allowed({ ...x, local: true }))) {
          const sha = newSha(steps, f.task);
          add({
            calls: [{ event: { event: "done", args: [f.task, "developer"], status: o.status }, ...(o.commit ? { mutation: { kind: "commit", task: f.task, sha } } : {}) }],
            label: `developer ${f.task} ${o.status}${o.commit ? " with a commit" : " with no commit"}`,
            fault: o.fault,
          });
        }
      } else {
        const outcomes = (f.seat === "code-reviewer" ? REVIEW_OUTCOMES : WRITER_OUTCOMES.map((x) => ({ ...x, local: true }))).filter(allowed);
        for (const o of outcomes) {
          add({ calls: [{ event: { event: "done", args: [f.task, f.seat], status: o.status } }], label: `${f.seat} ${f.task} ${o.status}`, fault: o.fault, findings: o.status === "findings" });
        }
        if (f.seat === "code-reviewer" && faults === "all") {
          // A legacy stacked reviewer: a second reviewer dispatch of the task while one is open.
          const prev = lastDispatch(ev.state, f.task, "code-reviewer");
          add({ calls: [{ event: dispatchEvent(f.task, "code-reviewer", "sonnet", prev?.round) }], label: `stacked code-reviewer ${f.task}`, fault: true });
        }
      }
    }
  }

  // A lost session: what `kf next --resume` prints, carried out instead.
  if (ev.plain.inFlight.length > 0) for (const m of batchesOf(ev.resumed, ev, steps, true, "resume: ")) add(m);

  // A reopen of a complete task, once per task.
  for (const p of plan) {
    if (!isComplete(ev.state.events, p.id)) continue;
    if (ev.state.events.some((e) => e.type === "reopened" && e.task === p.id)) continue;
    add({ calls: [{ event: line(`Note ${p.id}: reopened — review 1a2b3c4d`) }], label: `reopen ${p.id}`, fault: true });
  }
  return moves;
}

export function applyMove(steps: Step[], move: Move): { ok: true; steps: Step[] } | { ok: false; reason: string; failed: string; speculative: boolean } {
  let acc = steps;
  for (const c of move.calls) {
    const r = append(acc, c.event, move.label, c.mutation);
    if (!r.ok) return { ...r, failed: `${c.event.event} ${c.event.args.join(" ")}`, speculative: c.speculative === true };
    acc = r.steps;
  }
  return { ok: true, steps: acc };
}

// ---------------------------------------------------------------------------
// The checks: LIVE (a)–(g), the oracle, the fail-safe stop
// ---------------------------------------------------------------------------

export interface Violation {
  /** The LIVE clause, or `oracle`, `fail-safe`, `trap`, `repeating`, `overlap`. */
  clause: string;
  task?: string;
  detail: string;
  resume: boolean;
}

const NO_RULE = /kf next has no rule for/;
const TASK_ID = /\bTASK-\d+\b/g;
const CAP_WAIT = /\bdevelopers in flight$/;
const FILE_WRITERS: Seat[] = ["developer", "test-writer", "automation-writer"];

const actionTask = (a: Action): string | undefined => ("task" in a ? a.task : undefined);

/** The open seats the ledger shows: dispatches no `done` of the same task and seat followed. */
function openSeatsOf(state: LedgerState): Map<string, Extract<LedgerEvent, { type: "dispatched" }>> {
  const open = new Map<string, Extract<LedgerEvent, { type: "dispatched" }>>();
  for (const e of state.events) {
    if (e.type === "dispatched") open.set(`${e.task} ${e.seat}`, e);
    else if (e.type === "done") open.delete(`${e.task} ${e.seat}`);
  }
  return open;
}

function inlineSeat(state: LedgerState, plan: LoopTask[], task: string): boolean {
  if (plan.find((p) => p.id === task)?.inline === true) return true;
  const d = lastDispatch(state, task, "developer");
  if (d === undefined) return false;
  return d.model === "inline" || state.events.some((e) => e.type === "inline" && e.task === task && e.line > d.line);
}

const overlapping = (a: LoopTask, b: LoopTask): boolean => a.id !== b.id && (a.overlaps.includes(b.id) || b.overlaps.includes(a.id));

/**
 * A wait held by a printed stop (`stop TASK-NNN holds every dispatch`) is blocked by that stop, an action of the same
 * result, not by the stopped task's other waits: it is a witness, never a wait-graph edge.
 */
function holdsOn(reason: string, result: NextResult): boolean {
  const m = /^stop (TASK-\d+) holds every dispatch$/.exec(reason);
  return m !== null && result.actions.some((a) => a.kind === "stop" && a.task === m[1]);
}

/** LIVE (a)–(g) and the oracle on one printed result, read from the ledger, the plan and the result alone. */
export function checkResult(ev: Evaluated, resume: boolean): Violation[] {
  const result = resume ? ev.resumed : ev.plain;
  const { state, inputs } = ev;
  const plan = inputs.tasks;
  const out: Violation[] = [];
  const v = (clause: string, detail: string, task?: string): void => void out.push({ clause, detail, resume, ...(task ? { task } : {}) });
  const complete = new Set(plan.filter((p) => isComplete(state.events, p.id)).map((p) => p.id));
  const open = plan.filter((p) => !complete.has(p.id));

  // The fail-safe stop never appears.
  for (const a of result.actions) if (a.kind === "stop" && NO_RULE.test(a.reason)) v("fail-safe", a.reason, a.task);

  // (a) Never empty; `finished` exactly when every plan task is complete and nothing else is due.
  if (result.actions.length === 0 && result.inFlight.length === 0) v("(a)", "the result is empty");
  const finished = result.actions.some((a) => a.kind === "finished");
  if (finished && (open.length > 0 || result.actions.length > 1 || result.inFlight.length > 0)) v("(a)", `finished printed with open tasks [${open.map((t) => t.id)}] or beside other output`);
  if (!finished && open.length === 0 && result.actions.length === 0 && result.inFlight.length === 0) v("(a)", "every task is complete but finished is not printed");

  // (b) Every open plan task has a witness; a wait's chain ends in an action, an In-flight entry or an item halt.
  const itemHalt = result.actions.some((a) => (a.kind === "stop" || a.kind === "decide") && a.task === undefined);
  if (!itemHalt) {
    const witnessed = new Set<string>();
    for (const a of result.actions) if (a.kind !== "wait" && a.kind !== "finished" && actionTask(a) !== undefined) witnessed.add(actionTask(a)!);
    for (const f of result.inFlight) witnessed.add(f.task);
    const developersBusy =
      result.inFlight.some((f) => f.seat === "developer" && !inlineSeat(state, plan, f.task)) ||
      result.actions.some((a) => a.kind === "dispatch" && a.seat === "developer" && a.inline !== true);
    const edges = new Map<string, string[]>();
    for (const t of open) {
      const targets: string[] = t.dependencies.filter((d) => !complete.has(d));
      const rank = plan.indexOf(t);
      for (const o of open) if (overlapping(t, o) && (o.wave < t.wave || (o.wave === t.wave && plan.indexOf(o) < rank))) targets.push(o.id);
      for (const a of result.actions) {
        if (a.kind !== "wait" || a.task !== t.id) continue;
        if (holdsOn(a.reason, result)) {
          witnessed.add(t.id);
          continue;
        }
        for (const m of a.reason.matchAll(TASK_ID)) if (m[0] !== t.id) targets.push(m[0]);
        if (CAP_WAIT.test(a.reason) && developersBusy) witnessed.add(t.id);
      }
      edges.set(t.id, targets);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of open) {
        if (witnessed.has(t.id)) continue;
        if (edges.get(t.id)!.some((x) => witnessed.has(x))) {
          witnessed.add(t.id);
          grew = true;
        }
      }
    }
    for (const t of open) if (!witnessed.has(t.id)) v("(b)", `${t.id} is open with no witness`, t.id);
  }

  // (c) The printed wait graph is acyclic.
  const waitEdges = new Map<string, Set<string>>();
  for (const a of result.actions) {
    if (a.kind !== "wait" || holdsOn(a.reason, result)) continue;
    const set = waitEdges.get(a.task) ?? new Set<string>();
    for (const m of a.reason.matchAll(TASK_ID)) if (m[0] !== a.task) set.add(m[0]);
    waitEdges.set(a.task, set);
  }
  const colour = new Map<string, number>();
  const visit = (n: string, path: string[]): void => {
    colour.set(n, 1);
    for (const m of waitEdges.get(n) ?? []) {
      if (colour.get(m) === 1) v("(c)", `wait cycle ${[...path, n, m].join(" → ")}`, n);
      else if (!colour.has(m)) visit(m, [...path, n]);
    }
    colour.set(n, 2);
  };
  for (const n of waitEdges.keys()) if (!colour.has(n)) visit(n, []);

  // (d) Every decide lists closes, and every alternative is a line kf record accepts.
  for (const a of result.actions) {
    if (a.kind !== "decide") continue;
    if (a.closes.trim() === "") {
      v("(d)", `decide ${a.rule} prints no closes`, a.task);
      continue;
    }
    for (const alt of parseCloses(a.closes).alternatives) {
      for (const template of alt) if (closeCall(template, a.task, ev, []) === null) v("(d)", `decide ${a.rule} names a close the session cannot write: ${template}`, a.task);
    }
  }

  // (e) Every printed dispatch can be answered: one open slot per (task, seat), one reviewer per task in flight.
  const openSeats = openSeatsOf(state);
  const printed = new Set<string>();
  for (const a of result.actions) {
    if (a.kind !== "dispatch") continue;
    const k = `${a.task} ${a.seat}`;
    if (printed.has(k)) v("(e)", `two dispatches of ${k} in one result`, a.task);
    printed.add(k);
    if (!resume && openSeats.has(k)) v("(e)", `dispatch of ${k} while its seat is open since line ${openSeats.get(k)!.line}`, a.task);
  }

  // (f) In flight, the cap count and resume read one pool: open developer seats of plan tasks that are not complete.
  if (!resume) {
    const poolOpen = [...openSeats.values()].filter((d) => d.seat === "developer" && plan.some((p) => p.id === d.task) && !complete.has(d.task));
    for (const d of poolOpen) {
      if (!result.inFlight.some((f) => f.task === d.task && f.seat === "developer")) {
        const drift = result.actions.some((a) => a.kind === "decide" && a.task === d.task && a.rule === "Drift");
        if (!drift) v("(f)", `${d.task}'s open developer (line ${d.line}) is not in the In-flight list`, d.task);
      }
    }
    for (const f of result.inFlight) {
      if (f.seat === "verify") continue;
      if (!openSeats.has(`${f.task} ${f.seat}`)) v("(f)", `In flight lists ${f.task} ${f.seat}, which the ledger has not open`, f.task);
    }
    const spawned = result.inFlight.filter((f) => f.seat === "developer" && !inlineSeat(state, plan, f.task)).length;
    const fresh = result.actions.filter((a) => a.kind === "dispatch" && a.seat === "developer" && a.inline !== true).length;
    if (spawned + fresh > result.n) v("(f)", `${spawned} spawned developers in flight plus ${fresh} dispatched exceed the cap ${result.n}`);
    // Resume re-issues exactly what plain lists in flight.
    for (const f of result.inFlight) {
      const reissued = ev.resumed.actions.some((a) => actionTask(a) === f.task && (a.kind === "dispatch" ? a.seat === f.seat : f.seat === "verify" ? a.kind === "verify" || a.kind === "write" : a.kind === "decide"));
      if (!reissued) v("(f)", `--resume does not re-issue ${f.task} ${f.seat}, which plain lists in flight`, f.task);
    }
    if (ev.resumed.inFlight.length > 0) v("(f)", `--resume still lists in flight: ${ev.resumed.inFlight.map((f) => `${f.task} ${f.seat}`).join(", ")}`);
  }

  // (g) and the oracle: complete only when completable, never beside another action of the task.
  for (const a of result.actions) {
    if (a.kind !== "complete") continue;
    // One violation per blocker, so each disagreement with the oracle is one finding however they combine.
    for (const blocker of completionOracle(state, inputs, a.task).blockers) v("oracle", `complete ${a.task} printed but the oracle says: ${blocker}`, a.task);
    // FR-023: the verify passed on the task's latest commits, so each commit its report names that is on the branch
    // must be in the task's commit list (a commits note or a review package), or no verify ever covered it.
    const named = state.events.flatMap((e) => ((e.type === "commits" || e.type === "reviewPackage") && e.task === a.task ? e.shas : []));
    for (const sha of inputs.reportCommits[a.task] ?? []) {
      const onBranch = inputs.gitLog.some((g) => g.sha.startsWith(sha));
      if (onBranch && !named.some((n) => n.startsWith(sha) || sha.startsWith(n))) {
        v("(g)", `complete ${a.task} printed but its commit ${sha}, in its report and on the branch, is in no commits note or review package`, a.task);
      }
    }
    // Ruled (ledger, fix round placement): the round's fix round R/5 write is printed beside the action that ends it.
    const beside = result.actions.filter((b) => b !== a && actionTask(b) === a.task && !(b.kind === "write" && /: fix round \d\/5 \(/.test(b.line)));
    if (beside.length > 0) v("(g)", `complete ${a.task} printed beside ${beside.map((b) => b.kind).join(", ")}`, a.task);
  }

  // One file-writing seat per overlapping Files (ruled; TASK-018's deferred same-pass dispatch).
  if (!resume) {
    const writing = [
      ...result.actions.flatMap((a) => (a.kind === "dispatch" && FILE_WRITERS.includes(a.seat) ? [{ task: a.task, seat: a.seat, how: "dispatched" }] : [])),
      ...[...openSeats.values()].filter((d) => FILE_WRITERS.includes(d.seat) && !complete.has(d.task)).map((d) => ({ task: d.task, seat: d.seat, how: "in flight" })),
    ];
    for (let i = 0; i < writing.length; i++) {
      for (let j = i + 1; j < writing.length; j++) {
        const x = writing[i];
        const y = writing[j];
        const px = plan.find((p) => p.id === x.task);
        const py = plan.find((p) => p.id === y.task);
        if (px === undefined || py === undefined || !overlapping(px, py)) continue;
        if (x.how === "in flight" && y.how === "in flight") continue;
        v("overlap", `${x.task} ${x.seat} ${x.how} and ${y.task} ${y.seat} ${y.how} write overlapping Files at once`, x.how === "dispatched" ? x.task : y.task);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Happy continuation: no trap state
// ---------------------------------------------------------------------------

const HAPPY_STOP_ORDER = (task: string): string[] => [
  `${task}: complete (superseded — explorer)`,
  `Note ${task}: decided — explorer ruling`,
  `${task}: verify started`,
];

/**
 * The move a happy session takes: every printed action, in print order, with the first unwritten line of each
 * decide's first alternative and the first line that moves a stop; else the first in-flight answer, happy.
 */
function happyMove(ev: Evaluated, steps: Step[], verdict: (task: string) => string = () => "clean"): Move | null {
  const calls: Move["calls"] = [];
  for (const a of ev.plain.actions) {
    if (a.kind === "decide") {
      const { alternatives, rider } = parseCloses(a.closes);
      const first = alternatives[0];
      const done = (template: string): boolean => steps.some((s) => s.body === fill(template, a.task));
      const template = first.find((x) => !done(x)) ?? first[0];
      const call = closeCall(template, a.task, ev, steps);
      if (call === null) continue;
      if (rider !== null && !steps.some((s) => / fix round 5\/5 /.test(s.body) && s.body.startsWith(`${a.task}:`))) {
        const m = /^(TASK-\d+): fix round 5\/5 \((.*)\)$/.exec(rider)!;
        calls.push({ event: { event: "fix-round", args: [m[1], "5", ...words(fill(m[2], m[1]))] } });
      }
      calls.push(call);
    } else if (a.kind === "stop") {
      if (a.task === undefined) continue;
      for (const candidate of HAPPY_STOP_ORDER(a.task)) {
        const call = closeCall(candidate, a.task, ev, steps)!;
        const r = applyMove(steps, { calls: [call], label: "", fault: false });
        if (r.ok && evaluate(ev.inputs, r.steps).worldExact !== ev.worldExact) {
          calls.push(call);
          break;
        }
      }
    } else {
      const options = optionsOf(a, ev, steps);
      if (options.length > 0) calls.push(...options[0]);
    }
  }
  if (calls.length > 0) return { calls, label: "happy batch", fault: false };
  for (const f of ev.plain.inFlight) {
    if (f.seat === "verify") {
      return { calls: [{ event: { event: "verify-done", args: [f.task], exit: "0" }, mutation: { kind: "verifyRun", task: f.task, exit: 0, text: "Test Files 1 passed" } }], label: `happy verify ${f.task}`, fault: false };
    }
    const status = f.seat === "code-reviewer" ? verdict(f.task) : "DONE";
    const mutation: Mutation | undefined = f.seat === "developer" ? { kind: "commit", task: f.task, sha: newSha(steps, f.task) } : undefined;
    return { calls: [{ event: { event: "done", args: [f.task, f.seat], status }, ...(mutation ? { mutation } : {}) }], label: `happy ${f.seat} ${f.task}`, fault: false };
  }
  return null;
}

/** Runs a happy session from `steps`; returns the keys it passed and whether it reached `finished`. */
export function happyRun(base: LoopInputs, steps: Step[], budget: number, known: Set<string>): { finished: boolean; keys: string[]; why?: string; steps: Step[] } {
  let acc = steps;
  const keys: string[] = [];
  while (acc.length - steps.length <= budget) {
    const ev = evaluate(base, acc);
    if (known.has(ev.worldKey)) return { finished: true, keys, steps: acc };
    keys.push(ev.worldKey);
    if (ev.plain.actions.some((a) => a.kind === "finished")) return { finished: true, keys, steps: acc };
    const move = happyMove(ev, acc);
    if (move === null) return { finished: false, keys, why: "no action to take and nothing in flight", steps: acc };
    const r = applyMove(acc, move);
    if (!r.ok) return { finished: false, keys, why: `kf record refused the happy move ${move.label}: ${r.reason}`, steps: acc };
    acc = r.steps;
  }
  return { finished: false, keys, why: `no finished within ${budget} more lines`, steps: acc };
}

/**
 * A scripted session: happy, except that the own reviews of `task` return `verdicts` in order (then clean), until
 * `until` holds. It builds the seeds that start the search deep in a task's life, at the cap or after a reopen.
 */
export function scriptedRun(base: LoopInputs, task: string, verdicts: string[], until: (ev: Evaluated) => boolean, budget = 120): Step[] {
  let acc: Step[] = [];
  while (acc.length <= budget) {
    const ev = evaluate(base, acc);
    if (until(ev)) return acc;
    const reviews = acc.filter((s) => s.event.event === "done" && s.event.args[0] === task && s.event.args[1] === "code-reviewer").length;
    const move = happyMove(ev, acc, (t) => (t === task ? (verdicts[reviews] ?? "clean") : "clean"));
    if (move === null) throw new Error(`explorer: the scripted session for ${task} is stuck: ${render(ev.plain).join(" | ")}`);
    const r = applyMove(acc, move);
    if (!r.ok) throw new Error(`explorer: kf record refused the scripted move ${move.label}: ${r.reason}`);
    acc = r.steps;
  }
  throw new Error(`explorer: the scripted session for ${task} did not reach its seed within ${budget} lines`);
}

/** The seed states: the empty ledger, a task at its Breaker after five rounds, and a task reopened after round 5. */
export function seedsOf(base: LoopInputs): { name: string; steps: Step[] }[] {
  const task = base.tasks[0].id;
  const breaker = scriptedRun(base, task, Array(6).fill("findings"), (ev) => ev.plain.actions.some((a) => a.kind === "decide" && a.task === task && a.rule === "Breaker"));
  const completed = scriptedRun(base, task, Array(5).fill("findings"), (ev) => isComplete(ev.state.events, task));
  const reopened = applyMove(completed, { calls: [{ event: line(`Note ${task}: reopened — review 1a2b3c4d`) }], label: `reopen ${task}`, fault: true });
  if (!reopened.ok) throw new Error(`explorer: kf record refused the reopen seed: ${reopened.reason}`);
  return [
    { name: "empty ledger", steps: [] },
    { name: `${task} at its Breaker after round 5`, steps: breaker },
    { name: `${task} reopened after a round-5 complete`, steps: reopened.steps },
  ];
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

export interface ExploreOptions {
  maxDepth: number;
  maxStates: number;
  faultBudget: number;
  /** Reviews with findings a path may take from its seed; the seeds reach the cap without spending it. */
  findingsBudget: number;
  faults: FaultProfile;
  /** Lines a happy continuation may append beyond the state. */
  happyBudget: number;
}

export interface Found extends Violation {
  steps: Step[];
}

export interface ExploreReport {
  /** The seed states the search started from. */
  seeds: string[];
  states: number;
  deepest: number;
  /** The state bound was hit before the search ended. */
  truncated: boolean;
  /** Moves not taken because they would pass the depth bound. */
  cutByDepth: number;
  /** `complete` actions printed over all reached states, each checked against the oracle. */
  completes: number;
  /** Reached states per named situation (see COVERAGE): what the search actually exercised. */
  coverage: Record<string, number>;
  violations: Found[];
}

const printedRule = (ev: Evaluated, test: (a: Action) => boolean): boolean => ev.plain.actions.some(test);

/** Situations the search must reach for its verdict to mean something; counted per reached state. */
export const COVERAGE: Record<string, (ev: Evaluated) => boolean> = {
  "Breaker printed": (ev) => printedRule(ev, (a) => a.kind === "decide" && a.rule === "Breaker"),
  "cap stop printed": (ev) => printedRule(ev, (a) => a.kind === "stop" && /five-round cap/.test(a.reason)),
  "minimal fix decided": (ev) => ev.state.events.some((e) => e.type === "decided" && e.what.startsWith("minimal fix past the cap:")),
  "Seat status printed": (ev) => printedRule(ev, (a) => a.kind === "decide" && a.rule === "Seat status"),
  "cascade re-review due": (ev) => printedRule(ev, (a) => (a.kind === "write" && /cascade re-review owed/.test(a.line)) || (a.kind === "dispatch" && a.cascade !== undefined)),
  "verify routed": (ev) => ev.state.events.some((e) => e.type === "verifyRouted"),
  "verify waits": (ev) => ev.state.events.some((e) => e.type === "verifyWaits"),
  "contention re-run": (ev) => printedRule(ev, (a) => a.kind === "verify" && a.rerun === true) || ev.state.events.some((e) => e.type === "verifyRerun"),
  "cap wait printed": (ev) => printedRule(ev, (a) => a.kind === "wait" && a.reason.endsWith("developers in flight")),
  "overlap wait printed": (ev) => printedRule(ev, (a) => a.kind === "wait" && a.reason.startsWith("Files overlap")) || printedRule(ev, (a) => a.kind === "write" && /developer waits — Files overlap/.test(a.line)),
  "resume re-issues a seat": (ev) => ev.plain.inFlight.length > 0 && ev.resumed.actions.some((a) => a.kind === "dispatch"),
  "reopened": (ev) => ev.state.events.some((e) => e.type === "reopened"),
};

/** A violation's identity: its clause, task and detail with shas and numbers masked; plain and resumed copies are one. */
export const signature = (v: Violation): string => `${v.clause}|${v.task ?? ""}|${v.detail.replace(/\b[0-9a-f]{7,40}\b/g, "<sha>").replace(/\d+/g, "#")}`;

/**
 * Breadth-first over the session's moves, fault level by fault level, so each distinct World is expanded once, at
 * its fewest faults. Every reached state is checked; afterwards every state that cannot reach `finished` inside the
 * explored graph gets a happy continuation, which must reach it.
 */
export function explore(base: LoopInputs, opts: ExploreOptions): ExploreReport {
  interface Node {
    steps: Step[];
    faults: number;
    findings: number;
    parent: string | null;
    ev?: Evaluated;
  }
  const expanded = new Map<string, Step[]>();
  const best = new Map<string, { faults: number; findings: number }>();
  const succ = new Map<string, Set<string>>();
  const finished = new Set<string>();
  const found = new Map<string, Found>();
  const record = (v: Violation, steps: Step[]): void => {
    const sig = signature(v);
    if (!found.has(sig)) found.set(sig, { ...v, steps });
  };
  const seeds = seedsOf(base);
  // Each seed gets an equal share of the state bound, so the search reaches deep into the cap even when the shallow
  // states alone would fill it; a World one seed expanded is not expanded again from another.
  const share = Math.floor(opts.maxStates / seeds.length);
  let states = 0;
  let deepest = 0;
  let completes = 0;
  let truncated = false;
  let cutByDepth = 0;
  const coverage: Record<string, number> = {};

  for (const seed of seeds) {
    const buckets: Node[][] = Array.from({ length: opts.faultBudget + 1 }, () => []);
    buckets[0].push({ steps: seed.steps, faults: 0, findings: 0, parent: null });
    let seedStates = 0;
    let cut = false;
    for (let level = 0; level <= opts.faultBudget && !cut; level++) {
      let queue = buckets[level];
      while (queue.length > 0 && !cut) {
        const next: Node[] = [];
        for (const node of queue) {
          const ev = node.ev ?? evaluate(base, node.steps);
          const key = ev.worldKey;
          if (node.parent !== null) {
            const edges = succ.get(node.parent) ?? new Set<string>();
            edges.add(key);
            succ.set(node.parent, edges);
          }
          const prior = best.get(key);
          if (prior !== undefined && prior.faults <= node.faults && prior.findings <= node.findings) continue;
          best.set(key, { faults: Math.min(node.faults, prior?.faults ?? Infinity), findings: Math.min(node.findings, prior?.findings ?? Infinity) });
          if (!expanded.has(key)) {
            if (seedStates >= share) {
              cut = true;
              break;
            }
            expanded.set(key, node.steps);
            states++;
            seedStates++;
            deepest = Math.max(deepest, node.steps.length);
            for (const viol of [...checkResult(ev, false), ...checkResult(ev, true)]) record(viol, node.steps);
            completes += ev.plain.actions.filter((a) => a.kind === "complete").length;
            if (ev.plain.actions.some((a) => a.kind === "finished")) finished.add(key);
            for (const [name, seen] of Object.entries(COVERAGE)) if (seen(ev)) coverage[name] = (coverage[name] ?? 0) + 1;
          }

          for (const move of movesOf(ev, node.steps, base.tasks, opts.faults)) {
            const faults = node.faults + (move.fault ? 1 : 0);
            const findings = node.findings + (move.findings === true ? 1 : 0);
            if (faults > opts.faultBudget || findings > opts.findingsBudget) continue;
            if (node.steps.length + move.calls.length > opts.maxDepth) {
              cutByDepth++;
              continue;
            }
            const r = applyMove(node.steps, move);
            if (!r.ok) {
              // A printed action kf record refuses is a dead end the session cannot take; a stop's tried line is not printed.
              if (move.printed === true && !r.speculative) record({ clause: r.failed.startsWith("dispatched") ? "(e)" : "(d)", detail: `kf record refuses ${r.failed}: ${r.reason}`, resume: move.label.startsWith("resume: ") }, node.steps);
              continue;
            }
            const child: Node = { steps: r.steps, faults, findings, parent: key };
            if (move.printed === true && move.speculative !== true && !move.label.startsWith("resume: ")) {
              // Repeating: carrying out what was printed changes neither the World nor the output, so the session loops.
              child.ev = evaluate(base, r.steps);
              if (child.ev.worldExact === ev.worldExact && JSON.stringify(child.ev.plain) === JSON.stringify(ev.plain)) {
                record({ clause: "repeating", detail: `carrying out ${move.label} changes nothing and it is printed again`, resume: false }, node.steps);
              }
            }
            (faults === level ? next : buckets[faults]).push(child);
          }
        }
        queue = next;
      }
    }
    if (cut) truncated = true;
  }

  // No trap state: co-reachability of `finished` in the explored graph; then a happy continuation from each explored
  // leaf (a state whose moves the bounds cut) that is not co-reachable, and again from any state still not.
  const good = new Set(finished);
  const pred = new Map<string, string[]>();
  for (const [from, tos] of succ) {
    for (const to of tos) {
      const list = pred.get(to);
      if (list === undefined) pred.set(to, [from]);
      else list.push(from);
    }
  }
  const spread = (from: Iterable<string>): void => {
    const stack = [...from];
    while (stack.length > 0) {
      for (const p of pred.get(stack.pop()!) ?? []) {
        if (good.has(p)) continue;
        good.add(p);
        stack.push(p);
      }
    }
  };
  spread(finished);
  const continueFrom = (keys: string[]): void => {
    for (const key of keys) {
      if (good.has(key)) continue;
      const steps = expanded.get(key)!;
      const happy = happyRun(base, steps, opts.happyBudget, good);
      if (!happy.finished) {
        record({ clause: "trap", detail: `a happy session cannot reach finished: ${happy.why}`, resume: false }, steps);
        continue;
      }
      for (const k of happy.keys) good.add(k);
      spread(happy.keys);
    }
  };
  continueFrom([...expanded.keys()].filter((k) => !succ.has(k)).reverse());
  continueFrom([...expanded.keys()]);
  return { seeds: seeds.map((x) => `${x.name} (${x.steps.length} lines)`), states, deepest, truncated, cutByDepth, completes, coverage, violations: [...found.values()] };
}

// ---------------------------------------------------------------------------
// Shrinking a violation to its minimal ledger
// ---------------------------------------------------------------------------

/** Whether `steps` still shows a violation with the same clause, task and resume flag. */
function stillFails(base: LoopInputs, steps: Step[], v: Violation, opts: ExploreOptions): boolean {
  if (!replayable(steps)) return false;
  const ev = evaluate(base, steps);
  if (v.clause === "trap") return !happyRun(base, steps, opts.happyBudget, new Set()).finished;
  return checkResult(ev, v.resume).some((x) => signature(x) === signature(v));
}

/**
 * Drops lines (each with the inputs it brought) while the violation holds and kf record still accepts every line:
 * chunks of half the ledger first, then smaller ones down to single lines, until no line can go.
 */
export function shrink(base: LoopInputs, v: Found, opts: ExploreOptions): Step[] {
  let steps = v.steps;
  for (let size = Math.max(1, Math.floor(steps.length / 2)); size >= 1; size = Math.floor(size / 2)) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = steps.length - size; i >= 0; i -= size) {
        const candidate = [...steps.slice(0, i), ...steps.slice(i + size)];
        if (stillFails(base, candidate, v, opts)) {
          steps = candidate;
          changed = true;
        }
      }
    }
  }
  return steps;
}

/** The plain result of a ledger, for a readable report. */
export function render(result: NextResult): string[] {
  return [
    ...result.inFlight.map((f) => `inFlight ${f.task} ${f.seat}`),
    ...result.actions.map((a) => {
      switch (a.kind) {
        case "dispatch":
          return `dispatch ${a.task} ${a.seat}${a.round ? ` round=${a.round}` : ""}${a.cascade ? ` cascade=${a.cascade}` : ""} ${a.mode}${a.inline ? " inline" : ""}`;
        case "verify":
          return `verify ${a.task}${a.rerun ? " rerun" : ""}`;
        case "write":
          return `write ${a.line}`;
        case "complete":
          return `complete ${a.task}`;
        case "wait":
          return `wait ${a.task}: ${a.reason}`;
        case "decide":
          return `decide ${a.task ?? ""} ${a.rule}: ${a.reason} | closes: ${a.closes}`;
        case "stop":
          return `stop ${a.task ?? ""}: ${a.reason}`;
        case "finished":
          return "finished";
      }
    }),
  ];
}
