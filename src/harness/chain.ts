import { randomUUID } from "node:crypto";

import { findFeature, type Feature } from "../workflow/features.js";
import type { Assignment, PreviousStep } from "./prompt.js";
import { createRunPlan, executeRun, writeRunPlan, type RunOutcome, type RunPlan } from "./run.js";

export interface ChainOptions {
  fresh: boolean;
  timeoutMs: number;
  /** Reuse this id for the first run so a detached supervisor updates the record it announced. */
  firstRunId?: string;
  env?: NodeJS.ProcessEnv;
  /** Working directory of every worker (the driver passes the item worktree). */
  cwd?: string;
  /** Report a repair run must fix; see createRunPlan. */
  failReport?: string | null;
  /** Called before each role starts; a returned reason ends the chain without running that role. */
  beforeRun?: (assignment: Assignment, index: number) => Promise<string | null>;
}

export interface ChainResultSummary {
  outcomes: RunOutcome[];
  ok: boolean;
  /** Role that ended the chain, set when a step did not finish DONE. */
  stoppedAt?: string;
  /** Roles that never ran because the chain stopped. */
  skipped: string[];
  /** Set when `beforeRun` refused a role: the reason it gave. */
  refused?: string;
}

function loadFeature(root: string, name: string): Feature {
  const feature = findFeature(root, name);
  if (!feature) throw new Error(`Work item '${name}' not found.`);
  return feature;
}

/** Plan for one role, with the id fixed when a supervisor already announced it. */
export function planFor(
  root: string,
  feature: Feature,
  assignment: Assignment,
  opts: ChainOptions,
  previous: PreviousStep | null,
  position?: { id: string; index: number; total: number },
  id?: string,
): RunPlan {
  const plan = createRunPlan(root, feature, assignment, { fresh: opts.fresh, timeoutMs: opts.timeoutMs, previous, cwd: opts.cwd, failReport: opts.failReport });
  return { ...plan, ...(id ? { id } : {}), ...(position ? { chain: position } : {}) };
}

/**
 * Run a stage's roles in order. Each role is its own worker and its own run
 * record; the next role is told where the previous one wrote. A step that does
 * not finish DONE stops the chain, so no worker builds on half-finished work
 * and no tokens are spent on steps that cannot succeed.
 */
export async function executeChain(root: string, featureName: string, chain: Assignment[], opts: ChainOptions): Promise<ChainResultSummary> {
  const outcomes: RunOutcome[] = [];
  let previous: PreviousStep | null = null;
  const chainId = opts.firstRunId ?? newChainId();
  for (const [index, assignment] of chain.entries()) {
    const refused = opts.beforeRun ? await opts.beforeRun(assignment, index) : null;
    if (refused) return { outcomes, ok: false, stoppedAt: assignment.role, skipped: chain.slice(index + 1).map((a) => a.role), refused };
    const feature = loadFeature(root, featureName);
    const position = { id: chainId, index: index + 1, total: chain.length };
    const plan = planFor(root, feature, assignment, opts, previous, position, index === 0 ? opts.firstRunId : undefined);
    writeRunPlan(feature, plan);
    const outcome = await executeRun(plan, opts.env ?? process.env);
    outcomes.push(outcome);
    if (!outcome.ok) {
      return { outcomes, ok: false, stoppedAt: assignment.role, skipped: chain.slice(index + 1).map((a) => a.role) };
    }
    previous = { role: assignment.role, output: assignment.output, log: outcome.record.log };
  }
  return { outcomes, ok: true, skipped: [] };
}

export function newChainId(): string {
  return randomUUID().slice(0, 8);
}
