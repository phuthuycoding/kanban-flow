import { completedTaskIds } from "./ledger-state.js";
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
  record: `kf record ${feature} line -- ${line}`,
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
  const done = new Set<string>();
  let due = -1;
  events.forEach((e, i) => {
    const before = tasks.every((t) => done.has(t.id));
    if (e.type === "complete" || e.type === "implemented") done.add(e.task);
    else if (e.type === "reopened") done.delete(e.task);
    if (!before && tasks.every((t) => done.has(t.id))) due = i;
  });
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
    const later = events.slice(doneIndex + 1);
    if (later.some((e) => e.type === "verifyRerun" && e.task === task)) continue;
    const startTs = startIndex === -1 ? -Infinity : events[startIndex].ts;
    const block = (inputs.verifyRuns[task] ?? []).find((run) => run.ts > startTs);
    if (!block) {
      if (!later.some((e) => e.type === "verifyStarted" && e.task === task)) owedHeld.push({ task, atHead: atHead(events, task), kind: "plain" });
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

  // Held re-runs: ledgered notes with no later verify of the task, plus the re-runs this call owes.
  const held: HeldRerun[] = [...owedHeld];
  let running: string | null = null;
  const noted = new Set<string>();
  events.forEach((e, i) => {
    if (e.type !== "verifyRerun" || noted.has(e.task)) return;
    const after = events.slice(i + 1).filter((x) => ofTask(x, e.task));
    if (after.some((x) => x.type === "verifyDone")) return;
    noted.add(e.task);
    if (after.some((x) => x.type === "verifyStarted")) {
      if (running === null) running = e.task;
    } else {
      held.push({ task: e.task, atHead: atHead(events, e.task), kind: "rerun" });
    }
  });
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
