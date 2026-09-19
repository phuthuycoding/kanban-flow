import { existsSync } from "node:fs";
import { join, relative } from "node:path";

import { ARTIFACTS, type Stage } from "../workflow/schema.js";
import type { Feature } from "../workflow/features.js";
import { skillsDirFor } from "../integrations/agents.js";
import type { HarnessConfig, RoleConfig, RunnerConfig } from "./config.js";

/** Skill a worker loads for each stage; backlog has no work to hand off. */
export const STAGE_SKILL: Record<Stage, string | null> = {
  brainstorm: "kanban-brainstorm",
  planning: "kanban-plan",
  backlog: null,
  implementation: "kanban-implement",
  testing: "kanban-test",
  review: "kanban-review",
  dones: "kanban-archive",
  cancelled: null,
};

export interface Assignment {
  role: string;
  /** Name of the runner the role points at (also decides the skills dir). */
  runnerName: string;
  runner: RunnerConfig;
  stage: Stage;
  skill: string;
  skillPath: string;
  brief?: string;
  output?: string;
}

export type ChainResult = { ok: true; chain: Assignment[] } | { ok: false; reason: string };

function assign(role: string, config: RoleConfig, harness: HarnessConfig, stage: Stage, skillName: string, root: string): Assignment | string {
  const runner = harness.runners[config.runner];
  if (!runner) return `Role "${role}" points at runner "${config.runner}", which is not declared.`;
  const skillsDir = runner.skillsDir ? join(root, runner.skillsDir) : skillsDirFor(config.runner, root);
  const skillPath = join(skillsDir, skillName, "SKILL.md");
  if (!existsSync(skillPath)) {
    return `Skill ${relative(root, skillPath)} is missing for role "${role}" (runner ${config.runner}) — run: kf install --agent ${config.runner} (or set harness.runners.${config.runner}.skillsDir).`;
  }
  return { role, runnerName: config.runner, runner, stage, skill: skillName, skillPath, brief: config.brief, output: config.output };
}

/**
 * Resolve the chain of roles that runs a stage. A stage can name several roles
 * (research then write, say); they run in order and each is a separate worker.
 */
export function resolveChain(
  harness: HarnessConfig | undefined,
  feature: Feature,
  root: string,
  overrides: { stage?: Stage; role?: string } = {},
): ChainResult {
  if (!harness) return { ok: false, reason: "No harness configured in .kf/config.json — run: kf init (seeds roles and runner presets)." };
  const stage = overrides.stage ?? feature.stage;
  if (feature.stage === "dones" && !overrides.stage) return { ok: false, reason: `'${feature.name}' is archived (dones); nothing to run.` };
  const skillName = feature.meta?.kind === "bug" && stage === "brainstorm" ? "kanban-bug" : STAGE_SKILL[stage];
  if (!skillName) return { ok: false, reason: `Stage "${stage}" has no work to hand off.` };

  const stageChain = harness.stages[stage] ?? [];
  let roles = stageChain;
  if (overrides.role) {
    if (!(overrides.role in harness.roles)) {
      return { ok: false, reason: `Unknown role "${overrides.role}". Known roles: ${Object.keys(harness.roles).join(", ")}.` };
    }
    if (stageChain.length > 0 && !stageChain.includes(overrides.role)) {
      return { ok: false, reason: `Role "${overrides.role}" is not in the chain for stage "${stage}" (${stageChain.join(" → ")}). Pass --stage to run it elsewhere.` };
    }
    roles = [overrides.role];
  }
  if (roles.length === 0) {
    return { ok: false, reason: `Stage "${stage}" has no role assigned in harness.stages — the main role (${harness.main}) does it. Use --role <name> to hand it off anyway.` };
  }
  const chain: Assignment[] = [];
  for (const role of roles) {
    const config = harness.roles[role];
    if (!config) return { ok: false, reason: `Unknown role "${role}". Known roles: ${Object.keys(harness.roles).join(", ")}.` };
    const result = assign(role, config, harness, stage, skillName, root);
    if (typeof result === "string") return { ok: false, reason: result };
    chain.push(result);
  }
  return { ok: true, chain };
}

/** What the previous role in the chain left behind, so the next one can pick it up. */
export interface PreviousStep {
  role: string;
  output?: string;
  log: string;
}

export interface PromptInput {
  runId: string;
  feature: Feature;
  root: string;
  assignment: Assignment;
  /** Path of the current FAIL/REJECT report to point a repair run at. */
  failReport?: string | null;
  previous?: PreviousStep | null;
}

/** Marker placed first in every worker prompt so sessions can be traced back to a run. */
export function runMarker(runId: string): string {
  return `kf-run:${runId}`;
}

/** Find the current testing/review report when it is a loop-back result. */
export function currentFailReport(feature: Feature): string | null {
  for (const id of ["review-report", "testing-result"] as const) {
    const p = join(feature.dir, ARTIFACTS[id].file);
    if (existsSync(p)) return p;
  }
  return null;
}

export function buildWorkerPrompt(input: PromptInput): string {
  const { feature, root, assignment, runId } = input;
  const kind = feature.meta?.kind === "bug" ? "bug" : "feature";
  const dir = relative(root, feature.dir);
  const lines = [
    runMarker(runId),
    `You are the "${assignment.role}" worker for the kaban-flow ${kind} "${feature.name}" (context ${feature.context ?? "n/a"}) at stage "${assignment.stage}".`,
  ];
  if (assignment.brief) lines.push(`Your role: ${assignment.brief}`);
  lines.push(
    `Project root: ${root}`,
    `Work item folder: ${dir}`,
    `Load and follow the skill: ${relative(root, assignment.skillPath)} (${assignment.skill}). Skip its "move to stage" step — the stage is already set.`,
    "Read the artifacts in the work item folder before acting; run `kf status --change " + feature.name + "` for the checklist and `kf instruct <artifact> --change " + feature.name + "` for the exact template and output path of anything you must write.",
  );
  if (input.previous) {
    const parts = [`The "${input.previous.role}" role ran before you in this stage.`];
    if (input.previous.output) parts.push(`Read its output first: ${join(dir, input.previous.output)}.`);
    parts.push(`Its full log is at ${join(dir, input.previous.log)} if you need the details.`);
    lines.push(`Previous step: ${parts.join(" ")}`);
  }
  if (assignment.output) {
    lines.push(`Write your findings to ${join(dir, assignment.output)} so the next role can read them; this is in addition to the stage's own artifacts.`);
  }
  if (input.failReport) {
    lines.push(`This is a repair loop: read ${relative(root, input.failReport)} first and fix exactly what it reports.`);
  }
  lines.push(
    "Contract:",
    "- Do only this stage's work and write its artifacts into the work item folder.",
    "- Never run `kf stage`, `kf approve`, `kf archive`, or `kf run`; the main agent decides transitions.",
    "- Never edit approved contract artifacts (requirement, plan, use cases, test cases); track progress in tasks.md.",
    "- Do not commit or push.",
    "- Finish with two final lines exactly in this form:",
    "STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
    "Summary: <one or two sentences>",
  );
  return lines.join("\n");
}
