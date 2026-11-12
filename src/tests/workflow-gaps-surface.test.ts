import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");

describe("skill passages agree with the loop's round cap and superseded rules", () => {
  it("implement routes a failing stage verify through a counted fix round", () => {
    const text = read("assets", "skills", "implement", "SKILL.md");
    expect(text).not.toContain("- FAIL → the failing task's developer fixes, re-run.");
    // The one minimal fix past the cap (3.4) is a developer run, so the line must not forbid another developer run.
    expect(text).not.toContain("instead of another developer run");
    expect(text).toContain(
      "- FAIL → a fix round of the failing task (3.4), counted against its five rounds — a task at its cap takes the breaker or the `cap reached` stop (3.4) instead of a sixth round; then re-run.",
    );
  });

  it("plan sends a cap-reached task back to the contract with a superseded outcome", () => {
    const text = read("assets", "skills", "plan", "SKILL.md");
    expect(text).toContain(
      "A task stopped at `cap reached` (kf:implement, Repairing after the loop) returns here: the re-approved contract gives the work a new task with its own five rounds, or no longer requires what failed, and the session that resumes ledgers `superseded by TASK-MMM` or `superseded by contract`.",
    );
  });

  it("travel lists a reopened task's cap reached stop as a blocked cause in the skill and the ledger format", () => {
    const oldPhrase = "(REQUIREMENT_BUG, a plan change, a fix-loop breaker)";
    const newPhrase = "(REQUIREMENT_BUG, a plan change, a fix-loop breaker, a reopened task's `cap reached` stop)";
    for (const file of [["assets", "skills", "travel", "SKILL.md"], ["assets", "skills", "travel", "references", "ledger-format.md"]]) {
      const text = read(...file);
      expect(text, file.join("/")).not.toContain(oldPhrase);
      expect(text, file.join("/")).toContain(newPhrase);
    }
  });

  it("implement ledgers superseded by contract when the contract no longer requires what failed", () => {
    const text = read("assets", "skills", "implement", "SKILL.md");
    expect(text).not.toContain("when no task replaces it");
    expect(text).toContain("`… superseded by contract)` when the re-approved contract no longer requires what failed");
  });
});
