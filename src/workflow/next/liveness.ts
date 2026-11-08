import { completedTaskIds } from "./ledger-state.js";
import type { Action, LedgerState, LoopInputs, NextResult } from "./types.js";

// LIVE (design § 5.1 b, d) read from the ledger and the plan alone: every open plan task has a witness in the
// result, and every decide names the line that closes it. Pure; schedule() runs it as its fail-safe (design § 5.3).

export interface LivenessReport {
  /** Plan tasks, in plan order, that are not complete and have no witness. */
  silent: string[];
  /** The printed decides whose `closes` is empty. */
  emptyCloses: Action[];
}

const TASK_ID = /\bTASK-\d+\b/g;
const CAP_WAIT = /\bdevelopers in flight$/;

/**
 * A task is witnessed by an action or In-flight entry naming it, or through an edge to a witnessed task:
 * a wait naming another task, a cap wait while a developer is in flight or dispatched, an incomplete dependency,
 * an earlier incomplete overlapping task, and — for a task with no ledger line yet — any running test-writer.
 * A task-less stop or decide witnesses every task. Edges are resolved as a least fixed point, so a wait cycle
 * that reaches no action or In-flight entry stays silent.
 */
export function checkLiveness(result: NextResult, state: LedgerState, inputs: LoopInputs): LivenessReport {
  const emptyCloses = result.actions.filter((a) => a.kind === "decide" && a.closes.trim() === "");
  const complete = completedTaskIds(state);
  const open = inputs.tasks.filter((t) => !complete.has(t.id));

  const itemHalt = result.actions.some((a) => (a.kind === "stop" || a.kind === "decide") && a.task === undefined);
  if (itemHalt) return { silent: [], emptyCloses };

  const witnessed = new Set<string>();
  for (const a of result.actions) if (a.kind !== "wait" && a.kind !== "finished" && a.task !== undefined) witnessed.add(a.task);
  for (const f of result.inFlight) witnessed.add(f.task);

  // A cap wait waits on FR-024's pool: a spawned developer seat in flight or dispatched, never an inline one.
  const inlineSeat = (task: string): boolean => {
    if (inputs.tasks.find((t) => t.id === task)?.inline === true) return true;
    const dispatch = state.events.filter((e) => e.type === "dispatched" && e.task === task && e.seat === "developer").at(-1);
    if (dispatch === undefined) return false;
    return (dispatch.type === "dispatched" && dispatch.model === "inline") || state.events.some((e) => e.type === "inline" && e.task === task && e.line > dispatch.line);
  };
  const developerRunning =
    result.inFlight.some((f) => f.seat === "developer" && !inlineSeat(f.task)) ||
    result.actions.some((a) => a.kind === "dispatch" && a.seat === "developer" && a.inline !== true);
  const testWriterRunning =
    result.inFlight.some((f) => f.seat === "test-writer") || result.actions.some((a) => a.kind === "dispatch" && a.seat === "test-writer");
  const ledgered = new Set(state.events.flatMap((e) => ("task" in e && e.task !== undefined ? [e.task] : [])));
  const rank = new Map(inputs.tasks.map((t, i) => [t.id, i]));
  const byId = new Map(inputs.tasks.map((t) => [t.id, t]));

  const edges = new Map<string, string[]>();
  const implicit = new Set<string>();
  for (const t of open) {
    const targets = t.dependencies.filter((d) => !complete.has(d));
    for (const other of t.overlaps) {
      const o = byId.get(other);
      if (o === undefined || complete.has(o.id)) continue;
      if (o.wave < t.wave || (o.wave === t.wave && rank.get(o.id)! < rank.get(t.id)!)) targets.push(o.id);
    }
    for (const a of result.actions) {
      if (a.kind !== "wait" || a.task !== t.id) continue;
      for (const m of a.reason.matchAll(TASK_ID)) if (m[0] !== t.id) targets.push(m[0]);
      if (CAP_WAIT.test(a.reason) && developerRunning) implicit.add(t.id);
    }
    if (!ledgered.has(t.id) && testWriterRunning) implicit.add(t.id);
    edges.set(t.id, targets);
  }
  for (const id of implicit) witnessed.add(id);

  let grew = true;
  while (grew) {
    grew = false;
    for (const t of open) {
      if (witnessed.has(t.id)) continue;
      if (edges.get(t.id)!.some((target) => witnessed.has(target))) {
        witnessed.add(t.id);
        grew = true;
      }
    }
  }

  return { silent: open.filter((t) => !witnessed.has(t.id)).map((t) => t.id), emptyCloses };
}
