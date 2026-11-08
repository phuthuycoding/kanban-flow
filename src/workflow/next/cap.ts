import { completedTaskIds } from "./ledger-state.js";
import { shellQuote } from "./record.js";
import type { Action, Cap, HeldRerun, LedgerEvent, LedgerState, LoopInputs, LoopTask } from "./types.js";

// FR-006 / FR-007: the live cap N and the contention view, rebuilt from the ledger as `kf:implement`
// § The live cap, § Contention and § Resume the live cap lay them out. Pure: no filesystem, git or clock.

const SIGNATURES = [
  "EADDRINUSE",
  "index.lock",
  "database is locked",
  "SQLITE_BUSY",
  "Lock wait timeout exceeded",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "Test timed out",
  "Hook timed out",
];

const COST = "cost if wrong: <…>";

/** The first signature of the list, in list order, that `text` contains. */
export function contentionSignature(text: string): string | null {
  return SIGNATURES.find((sig) => text.includes(sig)) ?? null;
}

type Write = Extract<Action, { kind: "write" }>;

const write = (feature: string, line: string, task?: string): Write => ({
  kind: "write",
  ...(task ? { task } : {}),
  line,
  record: `kf record ${feature} line -- ${shellQuote(line)}`,
});

const ofTask = (e: LedgerEvent, task: string): boolean => "task" in e && e.task === task;

/** A verify is a re-run when a `verify rerun` note of its task comes before its `verify started` with no `verify done` between. */
function isRerun(events: LedgerEvent[], startIndex: number): boolean {
  const task = (events[startIndex] as { task: string }).task;
  for (let i = startIndex - 1; i >= 0; i--) {
    const e = events[i];
    if (!ofTask(e, task)) continue;
    if (e.type === "verifyRerun") return true;
    if (e.type === "verifyDone") return false;
  }
  return false;
}

function atHead(events: LedgerEvent[], task: string): boolean {
  let lastDone = -1;
  events.forEach((e, i) => {
    if (e.type === "verifyDone" && e.task === task) lastDone = i;
  });
  return events.some((e, i) => i > lastDone && e.type === "verifyWaits" && e.task === task);
}

/**
 * The failed verify starting at `startIndex` was itself the one plain re-run: the task's previous verify also failed
 * with no log block, and no line of the task (a commit, a note, a seat) comes between that failure and this start.
 */
function usedPlainRerun(events: LedgerEvent[], inputs: LoopInputs, task: string, startIndex: number): boolean {
  if (startIndex === -1) return false;
  let prevDone = -1;
  for (let i = startIndex - 1; i >= 0; i--) {
    const e = events[i];
    if (!ofTask(e, task)) continue;
    if (e.type === "verifyDone") prevDone = i;
    break;
  }
  if (prevDone === -1) return false;
  const prev = events[prevDone] as Extract<LedgerEvent, { type: "verifyDone" }>;
  if (prev.exit !== 1) return false;
  let prevStart = -1;
  for (let i = prevDone - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "verifyStarted" && e.task === task) {
      prevStart = i;
      break;
    }
  }
  if (prevStart !== -1 && isRerun(events, prevStart)) return false;
  const prevStartTs = prevStart === -1 ? -Infinity : events[prevStart].ts;
  const thisStartTs = events[startIndex].ts;
  return !(inputs.verifyRuns[task] ?? []).some((run) => run.ts > prevStartTs && run.ts <= thisStartTs);
}

interface Wave {
  wave: number;
  tasks: LoopTask[];
}

function wavesOf(tasks: LoopTask[]): Wave[] {
  const byWave = new Map<number, LoopTask[]>();
  for (const t of tasks) byWave.set(t.wave, [...(byWave.get(t.wave) ?? []), t]);
  return [...byWave.entries()].sort((a, b) => a[0] - b[0]).map(([wave, ts]) => ({ wave, tasks: ts }));
}

/** The index of the event that last turned every task of `tasks` complete, or -1. */
function dueIndex(events: LedgerEvent[], tasks: LoopTask[]): number {
  const allDone = (i: number): boolean => {
    const done = completedTaskIds({ events: events.slice(0, i + 1) });
    return tasks.every((t) => done.has(t.id));
  };
  let due = -1;
  for (let i = 0; i < events.length; i++) if (allDone(i) && !allDone(i - 1)) due = i;
  return due;
}

export function liveCap(state: LedgerState, inputs: LoopInputs): Cap {
  const { events } = state;
  const { feature } = inputs;
  const invalid = inputs.ceiling.source === "invalid-config";
  const ceiling = invalid ? 1 : inputs.ceiling.max;
  const owed: Action[] = [];

  // Start value and a lowered ceiling.
  const rulings = events.filter((e): e is Extract<LedgerEvent, { type: "capRuling" }> => e.type === "capRuling");
  const latest = rulings[rulings.length - 1];
  let n: number;
  if (!latest) {
    n = Math.min(2, ceiling);
    owed.push(write(feature, `Ruling: developer cap ${n} — start — ${COST}`));
  } else if (latest.to > ceiling) {
    owed.push(write(feature, `Ruling: developer cap ${latest.to} → ${ceiling} — ceiling lowered to ${ceiling} — ${COST}`));
    n = ceiling;
  } else {
    n = latest.to;
  }

  // Contention events this call owes, classified from each task's latest verify; plain re-runs of a failure with no log block.
  const owedHeld: HeldRerun[] = [];
  const plainRunning: string[] = [];
  const contentions: { line: number; task: string; signature: string; startIndex: number }[] = [];
  const verified = new Set<string>();
  for (const e of events) if (e.type === "verifyDone") verified.add(e.task);
  for (const task of verified) {
    let doneIndex = -1;
    events.forEach((e, i) => {
      if (e.type === "verifyDone" && e.task === task) doneIndex = i;
    });
    const done = events[doneIndex] as Extract<LedgerEvent, { type: "verifyDone" }>;
    if (done.exit !== 1) continue;
    let startIndex = -1;
    for (let i = doneIndex - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "verifyStarted" && e.task === task) {
        startIndex = i;
        break;
      }
    }
    if (startIndex !== -1 && isRerun(events, startIndex)) continue;
    // A commit of the task during the run makes it stale: the fold owes the verify again, so it is no contention.
    if (startIndex !== -1 && events.slice(startIndex + 1, doneIndex).some((e) => e.type === "commits" && e.task === task)) continue;
    const later = events.slice(doneIndex + 1);
    if (later.some((e) => e.type === "verifyRerun" && e.task === task)) continue;
    const startTs = startIndex === -1 ? -Infinity : events[startIndex].ts;
    const block = (inputs.verifyRuns[task] ?? []).find((run) => run.ts > startTs);
    if (!block) {
      if (later.some((e) => e.type === "verifyStarted" && e.task === task)) plainRunning.push(task);
      else if (!usedPlainRerun(events, inputs, task, startIndex)) owedHeld.push({ task, atHead: atHead(events, task), kind: "plain" });
      continue;
    }
    const signature = contentionSignature(block.text);
    if (signature !== null) contentions.push({ line: done.line, task, signature, startIndex });
  }
  contentions.sort((a, b) => a.line - b.line);

  // Step-up decisions, in wave order, each against the ledger up to its due `complete` line.
  const completed = completedTaskIds(state);
  const waves = wavesOf(inputs.tasks);
  const contended = new Set<string>(contentions.map((c) => c.task));
  for (const e of events) if (e.type === "verifyRerun") contended.add(e.task);
  for (let w = 0; w < waves.length; w++) {
    const { wave, tasks } = waves[w];
    if (!tasks.every((t) => completed.has(t.id))) break;
    const decided = events.some(
      (e) => (e.type === "capRuling" && e.cause.kind === "wave" && e.cause.wave === wave) || (e.type === "noStepUp" && e.wave === wave),
    );
    if (decided) continue;
    const due = dueIndex(events, waves.slice(0, w + 1).flatMap((x) => x.tasks));
    const doneAtDue = completedTaskIds({ events: events.slice(0, due + 1) });
    const incomplete = waves.filter((x) => !x.tasks.every((t) => doneAtDue.has(t.id)));
    const widest = Math.max(0, ...incomplete.map((x) => x.tasks.length));
    let reason: string | null = null;
    if (tasks.some((t) => contended.has(t.id))) reason = "not clean";
    else if (tasks.length === 1) reason = "inline";
    else if (n + 1 > ceiling) reason = "ceiling";
    else if (incomplete.length === 0) reason = "last wave";
    else if (n + 1 > widest) reason = "widest incomplete wave";
    if (reason !== null) {
      owed.push(write(feature, `Note wave ${wave}: no step-up — ${reason}`));
    } else {
      owed.push(write(feature, `Ruling: developer cap ${n} → ${n + 1} — wave ${wave} clean — ${COST}`));
      n += 1;
    }
  }

  // Step-downs and rerun notes, in ledger order: N halves at most once per contention event and once per signature per task until a pass.
  let droppedNow = false;
  for (const { task, signature, startIndex } of contentions) {
    const dropped = droppedNow || events.slice(startIndex + 1).some((e) => e.type === "capRuling" && e.cause.kind === "contention");
    let sameSignature = false;
    events.forEach((e, i) => {
      if (e.type === "capRuling" && e.cause.kind === "contention" && e.cause.task === task && e.cause.signature === signature) {
        sameSignature = !events.slice(i + 1).some((d) => d.type === "verifyDone" && d.task === task && d.exit === 0);
      }
    });
    if (!dropped && !sameSignature && n > 1) {
      const next = Math.max(1, Math.floor(n / 2));
      owed.push(write(feature, `Ruling: developer cap ${n} → ${next} — ${signature} in ${task} verify — ${COST}`));
      n = next;
      droppedNow = true;
    }
    owed.push(write(feature, `Note ${task}: verify rerun — contention ${signature}`, task));
    owedHeld.push({ task, atHead: atHead(events, task), kind: "rerun" });
  }

  if (invalid && inputs.ceiling.error !== undefined) {
    const error = inputs.ceiling.error;
    const closed = events.some((e) => e.type === "other" && e.text.startsWith("Ruling:") && e.text.includes(error));
    if (!closed) owed.push({ kind: "decide", rule: "Invalid ceiling", reason: error, closes: `Ruling: … ${error}` });
  }

  // Held re-runs: each task's latest rerun note with no later verify of the task, plus the re-runs this call owes.
  // The latest note: a later note re-arms a re-run whose started verify was lost (the fold's orphan rule).
  const held: HeldRerun[] = [...owedHeld];
  let running: string | null = null;
  const latestNote = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.type === "verifyRerun") latestNote.set(e.task, i);
  });
  for (const [task, i] of latestNote) {
    const after = events.slice(i + 1).filter((x) => ofTask(x, task));
    if (after.some((x) => x.type === "verifyDone")) continue;
    if (after.some((x) => x.type === "verifyStarted")) {
      if (running === null) running = task;
    } else {
      held.push({ task, atHead: atHead(events, task), kind: "rerun" });
    }
  }
  if (running === null && plainRunning.length > 0) running = plainRunning[0];
  const rank = (task: string): [number, number] => {
    const i = inputs.tasks.findIndex((t) => t.id === task);
    return i === -1 ? [Infinity, Infinity] : [inputs.tasks[i].wave, i];
  };
  held.sort((a, b) => {
    const [wa, ia] = rank(a.task);
    const [wb, ib] = rank(b.task);
    return wa !== wb ? wa - wb : ia - ib;
  });

  return { n, ceiling, owed, contention: { held, running, blocksDevelopers: held.length > 0 || running !== null } };
}
