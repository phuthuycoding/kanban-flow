import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { readMarkdownSection, splitFrontmatter } from "../shared/frontmatter.js";
import { parseTaskGraph } from "../workflow/tasks.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");

describe("task harness surfaces", () => {
  it("the plan template's Task Breakdown carries Files and no Role column and parses", () => {
    const body = splitFrontmatter(read("assets", "templates", "phase-2-implementation-plan.md")).body;
    const section = readMarkdownSection(body, "Task Breakdown") ?? "";
    expect(section).toMatch(/\|\s*Files\s*\|/);
    expect(section).not.toMatch(/\|\s*Role\s*\|/);
    const { tasks } = parseTaskGraph(body);
    expect(tasks.map((t) => t.id)).toEqual(["TASK-001"]);
  });

  it("the plan skill asks for Files and no Role", () => {
    const plan = read("assets", "skills", "plan", "SKILL.md");
    expect(plan).not.toMatch(/\bRole\b/);
    expect(plan).toContain("Files");
    expect(plan).toContain("worktree.enabled");
  });

  it("the implement skill runs the in-session loop and has no task-worker mode or runtime agent choice", () => {
    const impl = read("assets", "skills", "implement", "SKILL.md");
    expect(impl).not.toMatch(/Task worker/);
    expect(impl).not.toContain("kf drive {feature_name}");
    expect(impl).toContain("TASK-###");
    expect(impl).not.toContain("Pick the agent that fits");
  });

  it("the implement skill's exit-2 line sends the plan back to planning before the human re-approves", () => {
    const impl = read("assets", "skills", "implement", "SKILL.md");
    const line = impl.split("\n").find((l) => /exit 2/.test(l) && /outside/.test(l)) ?? "";
    expect(line).not.toBe("");
    const stage = line.indexOf("kf stage <f> planning");
    const approve = line.indexOf("kf approve");
    expect(stage).toBeGreaterThanOrEqual(0);
    expect(approve).toBeGreaterThan(stage);
  });

  it("the flow skill checks worktrees at the start decision and hands off to no drive", () => {
    const flow = read("assets", "skills", "flow", "SKILL.md");
    expect(flow).not.toMatch(/`kf drive <f>`|kf drive when/);
    expect(flow).toContain("worktree.enabled");
  });
});
