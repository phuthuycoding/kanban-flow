import { arbitrate } from "./arbiter.js";
import { liveCap } from "./cap.js";
import { foldWorld } from "./fold.js";
import { intentsFor, itemIntents } from "./intents.js";
import { checkLiveness, emptyClosesGuard } from "./liveness.js";
import type { Action, LedgerState, LoopInputs, NextResult, TaskState, World } from "./types.js";

type Stop = Extract<Action, { kind: "stop" }>;

// FR-001, FR-021–FR-026: `schedule()` folds the ledger into the World, asks each task and the item what they owe, and
// arbitrates those intents into the actions due now (design § 4). A task the result leaves with no witness, or that
// the arbiter could not place, gets the liveness guard's stop (design § 5.3). Pure: no filesystem, git or clock.

/** Under `--resume` every open seat and verify of an open task is lost: it is re-issued, never listed in flight. */
function markLost(world: World): void {
  for (const [id, t] of world.tasks) {
    if (t.phase.kind === "complete") continue;
    const seats = { ...t.seats };
    for (const seat of Object.keys(seats) as (keyof typeof seats)[]) {
      const slot = seats[seat];
      if (slot.kind === "running") seats[seat] = { ...slot, origin: "resume" };
    }
    const verify = t.verify.kind === "running" ? { ...t.verify, origin: "resume" as const } : t.verify;
    const p = t.phase;
    const phase = p.kind === "tests" && p.writer.kind === "running" ? { ...p, writer: { ...p.writer, origin: "resume" as const } } : p;
    world.tasks.set(id, { ...t, seats, verify, phase });
  }
}

/** Where the task stands, for the guard's reason: its phase, then its verify and review states. */
function phasePath(t: TaskState): string {
  const p = t.phase;
  const parts: string[] = [p.kind];
  if (p.kind === "cycle") parts.push(`${p.cycle}${p.round > 0 ? ` ${p.round}` : ""}`, `implementer ${p.implementer.kind}`);
  if (p.kind === "atCap") parts.push(p.cap.kind);
  if (p.kind === "tests") parts.push(`writer ${p.writer.kind}`);
  parts.push(`verify ${t.verify.kind === "failed" ? `failed ${t.verify.disposition.kind}` : t.verify.kind}`);
  parts.push(`review ${t.review.lane.kind}`);
  return parts.join(" / ");
}

const noRule = (world: World, task: string): Stop => {
  const t = world.tasks.get(task);
  const path = t === undefined ? "an unknown phase" : phasePath(t);
  return { kind: "stop", task, reason: `kf next has no rule for ${task} in ${path} — report this with the ledger` };
};

const ITEM_NO_RULE: Stop = { kind: "stop", reason: "kf next has no rule for the item: a decide names no line that closes it — report this with the ledger" };

export function schedule(state: LedgerState, inputs: LoopInputs, opts: { resume: boolean }): NextResult {
  const cap = liveCap(state, inputs);
  const world = foldWorld(state, inputs, cap);
  if (opts.resume) markLost(world);
  const intents = [...itemIntents(world, opts), ...[...world.tasks.values()].flatMap((t) => intentsFor(t, world))];

  // The guard's stops hold like any stop, so arbitration runs again with them until no further task is unplaced.
  const unplaced = new Set<string>();
  let itemGuard = false;
  for (;;) {
    const guard = [...(itemGuard ? [ITEM_NO_RULE] : []), ...[...unplaced].map((task) => noRule(world, task))];
    const arbitration = arbitrate(world, intents, opts, guard);
    const { inFlight } = arbitration;
    const quiet = new Set(arbitration.waits.filter((w) => w.quiet).map((w) => w.wait));
    const actions = arbitration.actions.filter((a) => !(a.kind === "wait" && quiet.has(a)));

    const allComplete = [...world.tasks.values()].every((t) => t.phase.kind === "complete");
    if (guard.length === 0 && allComplete && actions.length === 0 && inFlight.length === 0) {
      return { feature: inputs.feature, n: cap.n, inFlight, actions: [{ kind: "finished" }] };
    }

    // A quiet wait is not printed but still witnesses its task: the check reads the full wait set.
    const live = checkLiveness({ feature: inputs.feature, n: cap.n, inFlight, actions: arbitration.actions }, state, inputs);
    const empty = emptyClosesGuard(live.emptyCloses);
    const before = unplaced.size;
    const itemBefore: boolean = itemGuard;
    for (const task of [...arbitration.unplaced, ...live.silent, ...empty.tasks]) unplaced.add(task);
    itemGuard = itemGuard || empty.item;
    if (unplaced.size === before && itemGuard === itemBefore) return { feature: inputs.feature, n: cap.n, inFlight, actions };
  }
}
