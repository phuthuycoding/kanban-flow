import type { Intent, LedgerState, LoopInputs, NextOptions, TaskState, WaitBlocker, WaveState, WaveVerify, World } from "./types.js";

// FR-004, FR-005: the wave tier. With `harness.verify.stage` pinned, a complete wave owes one full suite on its head
// (`kf verify <f> --wave <w>`), and no developer of a later wave is dispatched until every earlier wave is verified.
// Test-writers are never held and a developer in flight is never cancelled. Pure: no filesystem, git or clock.

type WaveRun = { kind: "none" } | { kind: "running" } | { kind: "done"; exit: number; closed: boolean };

/** The wave's verify read from the ledger, then from its latest record when no run is open and no decide owed. */
function waveVerify(state: LedgerState, inputs: LoopInputs, wave: number): WaveVerify {
  let run: WaveRun = { kind: "none" };
  for (const e of state.events) {
    if (e.type === "waveVerifyStarted" && e.wave === wave) run = { kind: "running" };
    else if (e.type === "waveVerifyDone" && e.wave === wave) run = { kind: "done", exit: e.exit, closed: false };
    else if ((e.type === "waveDecided" && e.wave === wave) || (e.type === "reopened" && e.source === "wave" && e.wave === wave)) {
      if (run.kind === "done" && run.exit !== 0) run = { kind: "done", exit: run.exit, closed: true };
    }
  }
  if (run.kind === "running") return { kind: "running" };
  if (run.kind === "done" && run.exit !== 0 && !run.closed) return { kind: "failed", exit: run.exit };
  const latest = (inputs.waveRecords ?? []).filter((r) => r.wave === wave).at(-1);
  return latest !== undefined && latest.exit === 0 && latest.contains ? { kind: "passed" } : { kind: "owed" };
}

/** Every plan wave in ascending order, or undefined when no stage commands are pinned (no wave tier). */
export function foldWaves(state: LedgerState, inputs: LoopInputs, tasks: Map<string, TaskState>): WaveState[] | undefined {
  if ((inputs.stageCommands?.length ?? 0) === 0) return undefined;
  const waves = [...new Set(inputs.tasks.map((t) => t.wave))].sort((a, b) => a - b);
  return waves.map((wave) => {
    const incomplete = inputs.tasks.find((t) => t.wave === wave && tasks.get(t.id)?.phase.kind !== "complete")?.id;
    return { wave, ...(incomplete !== undefined ? { incomplete } : {}), verify: waveVerify(state, inputs, wave) };
  });
}

/** A task of `wave` whose failed verify was routed to `task` or waits for it: that wave cannot complete without it. */
function awaitedBy(world: World, wave: number, task: string): boolean {
  return world.inputs.tasks.some((t) => {
    const v = t.wave === wave ? world.tasks.get(t.id)?.verify : undefined;
    return v?.kind === "failed" && (v.disposition.kind === "routedOut" || v.disposition.kind === "waits") && v.disposition.otherTask === task;
  });
}

/**
 * The hold on a developer of `task`: the first earlier wave that is incomplete or not verified. An incomplete wave a
 * failure routed to `task`, or a verify waiting for it, does not hold it: holding it would deadlock the two.
 */
export function waveHold(world: World, task: string): { reason: string; blockedBy: WaitBlocker } | null {
  const wave = world.inputs.tasks.find((t) => t.id === task)?.wave;
  if (world.waves === undefined || wave === undefined) return null;
  for (const w of world.waves) {
    if (w.wave >= wave) break;
    if (w.incomplete !== undefined && awaitedBy(world, w.wave, task)) continue;
    // Naming the incomplete task gives the hold the TASK edge that witnesses it.
    if (w.incomplete !== undefined) return { reason: `wave ${w.wave} verify — ${w.incomplete} incomplete`, blockedBy: { kind: "task", task: w.incomplete } };
    if (w.verify.kind !== "passed") return { reason: `wave ${w.wave} verify`, blockedBy: { kind: "wave", wave: w.wave } };
  }
  return null;
}

/** The wave verifies owed (or lost, under `--resume`) and the decides of failed wave runs. */
export function waveIntents(world: World, opts: NextOptions): Intent[] {
  const f = world.inputs.feature;
  const intents: Intent[] = [];
  for (const w of world.waves ?? []) {
    const verify = { kind: "verify-wave" as const, wave: w.wave, command: `kf verify ${f} --wave ${w.wave}` };
    const v = w.verify;
    if (v.kind === "owed" && w.incomplete === undefined) {
      intents.push({ kind: "wave", wave: w.wave, origin: "progress", closes: ["waveVerifyStarted"], action: verify });
    } else if (v.kind === "running" && opts.resume) {
      intents.push({ kind: "wave", wave: w.wave, origin: "resume", closes: ["waveVerifyStarted", "waveVerifyDone"], action: verify });
    } else if (v.kind === "failed" && v.exit === 3) {
      const closes = `wave ${w.wave}: verify started or Note wave ${w.wave}: decided — <what>`;
      const action = { kind: "decide" as const, rule: "Wave verify exit 3", reason: `wave ${w.wave} verify exited 3`, closes };
      intents.push({ kind: "wave", wave: w.wave, origin: "progress", closes: ["waveVerifyStarted", "waveDecided"], action });
    } else if (v.kind === "failed") {
      const closes = `Note TASK-NNN: reopened — wave ${w.wave} or Note wave ${w.wave}: decided — <what>`;
      const action = { kind: "decide" as const, rule: "Wave verify", reason: `wave ${w.wave} failed`, closes };
      intents.push({ kind: "wave", wave: w.wave, origin: "progress", closes: ["reopened", "waveDecided"], action });
    }
  }
  return intents;
}

/** The waves whose verify is running, listed in flight; under `--resume` each is re-issued instead. */
export function waveRunsInFlight(world: World, opts: NextOptions): number[] {
  if (opts.resume) return [];
  return (world.waves ?? []).filter((w) => w.verify.kind === "running").map((w) => w.wave);
}
