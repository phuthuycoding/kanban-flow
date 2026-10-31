import { describe, it, expect } from "vitest";
import { join } from "node:path";

import { buildWorkerPrompt, type Assignment } from "../harness/prompt.js";
import { createRunPlan } from "../harness/run.js";
import type { Feature } from "../workflow/features.js";

const root = "/tmp/kf-prompt-root";
const feature = {
  name: "demo",
  context: "cli",
  stage: "implementation",
  dir: join(root, ".works", "implementation", "demo_20261031_1000"),
  meta: { schema: "kanban-flow", feature: "demo", created: "20261031_1000", kind: "feature" },
} as unknown as Feature;
const assignment: Assignment = {
  role: "coder",
  runnerName: "claude",
  runner: { start: ["claude", "-p", "{prompt}"] },
  stage: "implementation",
  skill: "kanban-implement",
  skillPath: join(root, ".claude", "skills", "kanban-implement", "SKILL.md"),
};

describe("the stage worker contract", () => {
  it("forbids pushing and scopes commits to the implementation task loop", () => {
    const prompt = buildWorkerPrompt({ runId: "run-1", feature, root, assignment });
    expect(prompt).toContain("- Do not push.");
    expect(prompt).toContain("one commit per task on the item branch");
    expect(prompt).toContain("outside that loop, commit nothing");
    expect(prompt).not.toContain("Do not commit or push.");
    expect(prompt).toContain("Never run `kf stage`, `kf approve`, `kf archive`, or `kf run`");
    expect(prompt).toContain("STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT");
  });

  it("lets the review worker push and make the one docs commit, before the code-reviewer dispatch", () => {
    const review = buildWorkerPrompt({
      runId: "run-r",
      feature: { ...feature, stage: "review" } as Feature,
      root,
      assignment: { ...assignment, role: "reviewer", stage: "review", skill: "kanban-review" },
    });
    expect(review).toContain("- Push only as the review skill prescribes — the item branch, after the code-reviewer PASS, to open or update its PR; never merge.");
    expect(review).toContain("Commit only the docs reconcile the review skill prescribes before the code-reviewer dispatch (one docs commit on the item branch); nothing else.");
    expect(review).not.toContain("- Do not push.");
  });

  it("states the run's time budget in minutes, 0 meaning no limit, and omits it when unknown", () => {
    expect(buildWorkerPrompt({ runId: "run-2", feature, root, assignment, timeoutMs: 30 * 60_000 })).toContain("Time budget: 30 min (0 = no limit)");
    expect(buildWorkerPrompt({ runId: "run-3", feature, root, assignment, timeoutMs: 0 })).toContain("Time budget: 0 min (0 = no limit)");
    expect(buildWorkerPrompt({ runId: "run-4", feature, root, assignment, timeoutMs: 90_000 })).toContain("Time budget: 1.5 min (0 = no limit)");
    expect(buildWorkerPrompt({ runId: "run-5", feature, root, assignment })).not.toContain("Time budget:");
  });

  it("a run plan hands the worker the same timeout the harness enforces", () => {
    const plan = createRunPlan(root, feature, assignment, { fresh: true, timeoutMs: 45 * 60_000, failReport: null });
    expect(plan.timeoutMs).toBe(45 * 60_000);
    expect(plan.prompt).toContain("Time budget: 45 min (0 = no limit)");
  });
});
