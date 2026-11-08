import type { Arbitration, Intent, NextOptions, World } from "./types.js";

// Cross-task arbitration: resume, holds by origin, dependencies, overlaps and the test-writer window, the live cap
// over the developer pool, contention, the reviewer lane, then dedupe and rank. Each intent maps to exactly one
// action, In-flight entry or wait with its blocker.

export function arbitrate(world: World, intents: Intent[], opts: NextOptions): Arbitration {
  void world;
  void intents;
  void opts;
  return { actions: [], inFlight: [], waits: [] };
}
