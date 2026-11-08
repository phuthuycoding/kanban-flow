import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const skill = read("skills", "implement", "SKILL.md");
const taskLoop = read("skills", "implement", "references", "task-loop.md");
const travel = read("skills", "travel", "SKILL.md");

// Opening phrases of the paragraphs whose rules now live in `kf next`.
const MOVED_PHRASES = [
  "**Resume from the ledger.**",
  "**Resume the live cap.**",
  "**Order and parallelism.**",
  "**The live cap.**",
  "**Contention: step down, re-run once.**",
  "**Waiting developers.**",
  "**Test-writers ahead.**",
  "**Same-wave test-writers.**",
  "**Controller work while a seat runs.**",
  "Then, at the same time, start",
  "exit 1 (a `harness.verify.task` command failed)",
  "**Rounds 1–3 resume the original developer**",
  "**The cascade re-review.**",
  "A task is complete when its developer is done",
];

const DECIDE_RULES = [
  "Conflict scan", "Seat status", "Commit missing", "Verify exit 3",
  "Breaker", "Invalid ceiling", "Drift", "Unknown task",
];

const LEDGER_SHAPES = [
  "TASK-NNN: <seat> dispatched model=<model>[ round=<R>][ cascade=<sha7>] @ <ts>",
  "TASK-NNN: <seat> done status=<STATUS> @ <ts>",
  "TASK-NNN: verify started @ <ts>",
  "TASK-NNN: verify done exit=<n> @ <ts>",
  "TASK-NNN: developer waits — <reason> @ <ts>",
  "TASK-NNN: fix queued — developer TASK-MMM in flight @ <ts>",
  "TASK-NNN: fix round <R>/5 (…) @ <ts>",
  "TASK-NNN: cascade re-review owed — after <sha7> of TASK-MMM @ <ts>",
  "TASK-NNN: complete (…) @ <ts>",
];

describe("the implement skill after the move to kf next", () => {
  it.each(MOVED_PHRASES)("no longer states the moved rule opening %s", (phrase) => {
    expect(skill).not.toContain(phrase);
  });

  it("names kf next, kf record and kf next --resume", () => {
    expect(skill).toContain("kf next");
    expect(skill).toContain("kf record");
    expect(skill).toContain("kf next --resume");
  });

  it("has a Decisions section with one heading per decide rule", () => {
    const start = skill.indexOf("## Decisions");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = skill.slice(start + "## Decisions".length);
    const next = rest.search(/\n## /);
    const section = next === -1 ? rest : rest.slice(0, next);
    for (const rule of DECIDE_RULES) {
      expect(section, rule).toMatch(new RegExp(`^### ${rule}\\s*$`, "m"));
    }
  });

  it("writes the task id into tasks.md lines", () => {
    expect(skill).toContain("- [ ] 1. TASK-001:");
  });

  it("keeps the headings other surface tests pin", () => {
    for (const h of ["## 3.", "## 4.", "### 3.2", "### 3.3", "### 3.4", "### 3.5"]) {
      expect(skill, h).toMatch(new RegExp(`^${h.replace(/[.]/g, "\\.")}`, "m"));
    }
  });

  it("defines Scan: clean in the skill and in the task-loop reference", () => {
    expect(skill).toContain("Scan: clean");
    expect(taskLoop).toContain("Scan: clean");
  });
});

describe("the task-loop reference", () => {
  it("keeps the nine ledger shapes of the grammar block verbatim", () => {
    const start = taskLoop.indexOf("The lines `kf loop-stats` reads");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = taskLoop.slice(start).match(/```\n([\s\S]*?)```/)?.[1] ?? "";
    expect(block.split("\n").filter(Boolean)).toEqual(LEDGER_SHAPES);
  });
});

describe("the minimal-fix-past-the-cap rule", () => {
  it("keeps the paragraph with its decided-note form and its one-fix limit", () => {
    expect(skill).toContain("**A minimal fix past the cap.**");
    expect(skill).toContain("Note TASK-NNN: decided — minimal fix past the cap:");
    expect(skill).toContain("one fresh developer for that change alone");
    expect(skill).toContain("One minimal fix per task");
  });

  it("limits the fix to the smallest change inside the task's Files", () => {
    expect(skill).toContain("no new behaviour, no file outside the task's Files");
  });

  it("keeps the fix from counting as a sixth round", () => {
    expect(skill).toContain("carry no `round=`");
  });

  it("keeps the stop printing until the task completes", () => {
    expect(skill).toContain("keeps printing the stop");
  });

  it("reconciles the human-only stop with the one minimal fix", () => {
    expect(skill).toContain("Apart from the one minimal fix below");
  });

  it("lets a cap-reached task complete only through superseded or its minimal fix", () => {
    expect(skill).toContain(
      "gets it only after a `superseded` line or its one minimal fix past the cap",
    );
  });

  it("shows the decided note in the task-loop ledger shapes", () => {
    expect(taskLoop).toContain(
      "Note TASK-NNN: decided — minimal fix past the cap: <the change> @ <ts>",
    );
  });
});

describe("the travel skill", () => {
  it("points its resume at kf next --resume", () => {
    expect(travel).toContain("kf next --resume");
  });
});
