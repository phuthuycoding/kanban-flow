import { arbitrate } from "./arbiter.js";
import { liveCap } from "./cap.js";
import { foldWorld } from "./fold.js";
import { intentsFor, itemIntents } from "./intents.js";
import { checkLiveness } from "./liveness.js";
import type { Action, LedgerState, LoopInputs, NextResult, TaskState, World } from "./types.js";

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

const noRule = (world: World, task: string): Action => {
  const t = world.tasks.get(task);
  const path = t === undefined ? "an unknown phase" : phasePath(t);
  return { kind: "stop", task, reason: `kf next has no rule for ${task} in ${path} — report this with the ledger` };
};

export function schedule(state: LedgerState, inputs: LoopInputs, opts: { resume: boolean }): NextResult {
  const cap = liveCap(state, inputs);
  const world = foldWorld(state, inputs, cap);
  if (opts.resume) markLost(world);
  const intents = [...itemIntents(world, opts), ...[...world.tasks.values()].flatMap((t) => intentsFor(t, world))];
  const arbitration = arbitrate(world, intents, opts);
  const { inFlight } = arbitration;
  const quiet = new Set(arbitration.waits.filter((w) => w.quiet).map((w) => w.wait));
  let actions = arbitration.actions.filter((a) => !(a.kind === "wait" && quiet.has(a)));

  const allComplete = [...world.tasks.values()].every((t) => t.phase.kind === "complete");
  if (allComplete && actions.length === 0 && inFlight.length === 0) {
    return { feature: inputs.feature, n: cap.n, inFlight, actions: [{ kind: "finished" }] };
  }

  const result: NextResult = { feature: inputs.feature, n: cap.n, inFlight, actions };
  const live = checkLiveness(result, state, inputs);
  const emptyCloses = live.emptyCloses.flatMap((a) => (a.kind === "decide" && a.task !== undefined ? [a.task] : []));
  const unplaced = [...new Set([...arbitration.unplaced, ...live.silent, ...emptyCloses])];
  if (unplaced.length === 0) return result;
  const stops = actions.filter((a) => a.kind === "stop");
  actions = [...stops, ...unplaced.map((task) => noRule(world, task)), ...actions.filter((a) => a.kind !== "stop")];
  return { ...result, actions };
}
