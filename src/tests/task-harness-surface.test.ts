import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { readMarkdownSection, splitFrontmatter } from "../shared/frontmatter.js";
import { parseTaskGraph } from "../workflow/tasks.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");

describe("task harness surfaces (TC-005)", () => {
  it("the plan template's Task Breakdown carries Role and Files and parses", () => {
    const body = splitFrontmatter(read("kanban-flow", "templates", "phase-2-implementation-plan.md")).body;
    const section = readMarkdownSection(body, "Task Breakdown") ?? "";
    expect(section).toMatch(/\|\s*Role\s*\|\s*Files\s*\|/);
    const { tasks } = parseTaskGraph(body);
    expect(tasks.map((t) => t.id)).toEqual(["TASK-001"]);
  });

  it("kanban-plan asks for Role and Files", () => {
    const plan = read("skills", "kanban-plan", "SKILL.md");
    expect(plan).toContain("Role");
    expect(plan).toContain("Files");
    expect(plan).toContain("worktree.enabled");
  });

  it("kanban-implement has a task-worker mode and no runtime agent choice", () => {
    const impl = read("skills", "kanban-implement", "SKILL.md");
    expect(impl).toMatch(/Task worker/);
    expect(impl).toContain("TASK-###");
    expect(impl).toContain("kf drive");
    expect(impl).not.toContain("Pick the agent that fits");
  });

  it("kanban-flow checks worktrees at the start decision and hands off to kf drive", () => {
    const flow = read("skills", "kanban-flow", "SKILL.md");
    expect(flow).toContain("kf drive");
    expect(flow).toContain("worktree.enabled");
  });
});
