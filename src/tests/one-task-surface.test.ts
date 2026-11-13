import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const IMPLEMENT = () => read("assets", "skills", "implement", "SKILL.md");
const PLAN = () => read("assets", "skills", "plan", "SKILL.md");

/** The paragraph that starts with `marker`, up to the next blank line. */
const paragraph = (text: string, marker: string): string => {
  const start = text.indexOf(marker);
  expect(start, `paragraph starting ${marker} exists`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n\n", start);
  return text.slice(start, end === -1 ? undefined : end);
};

describe("the implement skill's one-task rule", () => {
  it("has a One-task item paragraph placed directly before Inline waves", () => {
    const text = IMPLEMENT();
    const one = text.indexOf("**One-task item.**");
    const inline = text.indexOf("**Inline waves.**");
    expect(one).toBeGreaterThanOrEqual(0);
    expect(inline).toBeGreaterThan(one);
    expect(text.slice(one, inline).split("\n\n").filter(Boolean)).toHaveLength(1);
  });

  it("says the controller writes tests and fix itself and closes the task with the no-seat record line", () => {
    const p = paragraph(IMPLEMENT(), "**One-task item.**");
    expect(p).toContain("One-task item");
    expect(p).toContain("TASK-NNN: implemented, test-writer seat: none, review seat: none");
    expect(p).toContain("kf verify --task");
    expect(p).toContain("kf record");
  });

  it("keeps the independent gate at the kf:review stage", () => {
    const p = paragraph(IMPLEMENT(), "**One-task item.**");
    expect(p).toContain("kf:review");
  });

  it("lets a one-task loop that already dispatched a seat keep its seats", () => {
    const p = paragraph(IMPLEMENT(), "**One-task item.**");
    expect(p).toMatch(/already dispatched/i);
    expect(p).toMatch(/keeps? its seats/i);
  });

  it("takes a bug's tasks from its approved plan's Task Breakdown", () => {
    const text = IMPLEMENT();
    const at = text.indexOf("Create tasks.md if missing");
    expect(at).toBeGreaterThanOrEqual(0);
    const p = paragraph(text, "Create tasks.md if missing");
    expect(p).toContain("phase-2-implementation-plan.md");
    expect(p).toContain("Task Breakdown");
  });
});

describe("the plan skill's bug Task Breakdown", () => {
  const bugParagraph = () => paragraph(PLAN(), "Read work item kind from");

  it("gives a bug with two or more tasks a plan holding only a Task Breakdown", () => {
    const p = bugParagraph();
    expect(p).toContain("phase-2-implementation-plan.md");
    expect(p).toContain("Task Breakdown");
    expect(p).toContain("two or more tasks");
    expect(p).toContain("Execution:");
  });

  it("includes the task graph and Execution lines in the approval summary for a multi-task bug", () => {
    const p = bugParagraph();
    expect(p).toMatch(/approval summary[^.]*includes[^.]*kf tasks --graph[^.]*Execution:/);
  });

  it("scopes the leave-out list of feature-only content to a one-task bug", () => {
    // Otherwise the paragraph says both "leave out the graph" and "include the graph".
    const p = bugParagraph();
    const leaveOut = p.match(/[^.]*\b(?:leaving out|leaves out|leave out)\b[^.]*\./);
    expect(leaveOut, "a sentence names what a bug's approval leaves out").not.toBeNull();
    expect(leaveOut![0]).toMatch(/one-task/i);
    expect(p).toMatch(/report-only/i);
  });
});

describe("the regression task of a bug with a plan", () => {
  it("must carry the word regression in its Description cell, per the plan skill", () => {
    const p = paragraph(PLAN(), "Read work item kind from");
    expect(p).toMatch(/Description cell[^.]*\bregression\b|\bregression\b[^.]*Description cell/);
  });

  it("must carry the word regression in its Description cell, per the implement skill", () => {
    const p = paragraph(IMPLEMENT(), "Create tasks.md if missing");
    expect(p).toMatch(/Description cell[^.]*\bregression\b|\bregression\b[^.]*Description cell/);
  });
});

describe("the implement skill's One-task item decision", () => {
  const section = () => {
    const text = IMPLEMENT();
    const start = text.indexOf("### One-task item");
    expect(start, "a '### One-task item' heading exists").toBeGreaterThanOrEqual(0);
    const decisions = text.indexOf("\n## Decisions");
    expect(decisions).toBeGreaterThanOrEqual(0);
    expect(start).toBeGreaterThan(decisions);
    const next = text.slice(start + 1).search(/\n#{2,3} /);
    return text.slice(start, next === -1 ? undefined : start + 1 + next);
  };

  it("sits under Decisions and names the record line that closes the decide", () => {
    expect(section()).toContain("TASK-NNN: implemented, test-writer seat: none, review seat: none");
  });
});
