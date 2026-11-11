import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = read("skills", "implement", "SKILL.md");
const flow = read("skills", "flow", "SKILL.md");

const SURFACES: Record<string, string[]> = {
  "skills/implement/SKILL.md": ["skills", "implement", "SKILL.md"],
  "skills/flow/SKILL.md": ["skills", "flow", "SKILL.md"],
  "skills/review/SKILL.md": ["skills", "review", "SKILL.md"],
  "skills/review/references/ci-watch.md": ["skills", "review", "references", "ci-watch.md"],
  "skills/bug/SKILL.md": ["skills", "bug", "SKILL.md"],
  "skills/travel/SKILL.md": ["skills", "travel", "SKILL.md"],
  "kanban-flow/templates/phase-5-review-report.md": ["kanban-flow", "templates", "phase-5-review-report.md"],
  "kanban-flow/README.md": ["kanban-flow", "README.md"],
};

const STOP_REASONS = [
  "an irreversible or destructive operation",
  "a security-sensitive action",
  "a side effect outside this worktree (merge, push to a shared branch, publish, a database write)",
  "a reopened task at its round cap, apart from the one minimal fix past the cap",
  "a plan too broken to act on",
  "a review `REQUIREMENT_BUG`",
  "a testing `BLOCKED`",
];

describe("one fix rule and one stop list across implement and flow", () => {
  for (const [name, text] of [["implement", implement], ["flow", flow]] as const) {
    it(`${name} states all seven stop reasons`, () => {
      for (const reason of STOP_REASONS) {
        expect(text, reason).toContain(reason);
      }
    });
  }

  it("flow cites the minimal fix as the one kf:implement makes", () => {
    expect(flow).toContain("apart from the one minimal fix past the cap `kf:implement` makes");
  });

  it("flow names a scope change as a plan too broken to act on", () => {
    expect(flow).toMatch(/scope change[^.\n]*plan too broken to act on|plan too broken to act on[^.\n]*scope change/);
  });

  it("flow carries exactly one stop list", () => {
    const hits = flow.split("an irreversible or destructive operation").length - 1;
    expect(hits).toBe(1);
  });

  it("implement keeps its five-things sentence word for word", () => {
    expect(implement).toContain(
      "**Five things stop you, and only these:** an irreversible or destructive operation; a security-sensitive action; a side effect outside this worktree (merge, push to a shared branch, publish, a database write); a reopened task at its round cap, apart from the one minimal fix past the cap (3.4); a plan too broken to act on.",
    );
  });

  it("implement adds the two gate outcomes outside the loop", () => {
    expect(implement).toContain("a review `REQUIREMENT_BUG`; a testing `BLOCKED`");
  });

  it("implement no longer stops on a repeated failure", () => {
    expect(implement).not.toContain("Failed again → STOP");
  });

  it("flow no longer auto-fixes blockers once", () => {
    expect(flow).not.toContain("Auto-fix benign blockers once");
  });

  it("flow points testing FAIL, review FAIL and red CI at the repair section", () => {
    expect(flow).toContain("Repairing after the loop");
    expect(flow).toMatch(/testing FAIL/);
    expect(flow).toMatch(/review FAIL/);
    expect(flow).toMatch(/red CI/);
  });

  it("keeps the kept phrases", () => {
    expect(implement).toContain("Five things stop you");
    expect(flow).toContain("a reopened task at its round cap");
  });

  it("flow's testing row names no automation-writer dispatch", () => {
    const row = flow.split("\n").find((l) => l.startsWith("| 4 Test"));
    expect(row).toBeDefined();
    expect(row).not.toContain("Agent(kf:automation-writer)");
  });
});

describe("REJECT is gone from the skill surfaces", () => {
  for (const [name, parts] of Object.entries(SURFACES)) {
    it(`${name} never names REJECT`, () => {
      expect(read(...parts)).not.toContain("REJECT");
    });
  }
});
