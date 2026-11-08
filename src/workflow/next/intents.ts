import type { Intent, NextOptions, TaskState, World } from "./types.js";

// Intents: what each phase owes, before the arbiter. Total over the phases: every phase other than complete
// yields at least one intent.

/** The intents of one task. */
export function intentsFor(t: TaskState, world: World): Intent[] {
  void t;
  void world;
  return [];
}

/** The item intents: Conflict scan, the cap's owed writes and decides, Invalid ceiling, Unknown task, Drift (resume only). */
export function itemIntents(world: World, opts: NextOptions): Intent[] {
  void world;
  void opts;
  return [];
}

/** ReadyToComplete: the one predicate `complete <task>` is printed on. */
export function completable(t: TaskState, world: World): boolean {
  void t;
  void world;
  return false;
}
