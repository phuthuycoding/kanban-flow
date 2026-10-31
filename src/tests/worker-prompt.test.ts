import { describe, it, expect } from "vitest";
import { join } from "node:path";

import { buildWorkerPrompt, type Assignment } from "../harness/prompt.js";
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
});
