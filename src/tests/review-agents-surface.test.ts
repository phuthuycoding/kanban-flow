import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT, PKG_TEMPLATES_DIR } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(...parts), "utf8");

/** The YAML frontmatter block between the leading `---` fences. */
function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(m, "frontmatter").not.toBeNull();
  return m![1];
}

describe("review findings come from an independent code-reviewer agent", () => {
  it("the review skill dispatches Agent(code-reviewer) and keeps the orchestrator to mechanical findings", () => {
    const skill = read(PKG_ROOT, "skills", "kanban-review", "SKILL.md");
    expect(skill).toContain("`Agent(code-reviewer)` in the transcript is auditable");
    expect(skill).toContain("The orchestrator never writes a finding of its own except the mechanical ones in step 2");
  });

  it("the review report template has a Reviewer section with the dispatch fields", () => {
    const template = read(PKG_TEMPLATES_DIR, "phase-5-review-report.md");
    const section = template.slice(template.indexOf("\n## Reviewer\n"));
    expect(template).toContain("\n## Reviewer\n");
    for (const field of ["Tier and reason", "Reviewers dispatched (agent, dimension, model)", "Review pack", "Evidence verification (kept / refuted)"]) {
      expect(section.slice(0, section.indexOf("\n## ", 1)), field).toContain(`| ${field} |`);
    }
  });

  it("the code-reviewer agent is named and limited to read-only tools", () => {
    const head = frontmatter(read(PKG_ROOT, "skills", "kanban-flow", "agents", "code-reviewer.md"));
    expect(head).toMatch(/^name: code-reviewer$/m);
    const tools = /^tools:\s*(.+)$/m.exec(head)?.[1].split(",").map((t) => t.trim());
    expect(tools).toEqual(["Read", "Grep", "Glob"]);
  });
});
