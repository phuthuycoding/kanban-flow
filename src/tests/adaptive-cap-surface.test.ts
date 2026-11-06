import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const skill = () => read("skills", "implement", "SKILL.md");
const loop = () => read("skills", "implement", "references", "task-loop.md");
const both = () => [["SKILL.md", skill()], ["task-loop.md", loop()]] as const;

const paragraphs = (text: string) => text.split(/\n\s*\n/);
const paragraphWith = (text: string, phrase: string) => {
  const found = paragraphs(text).find((p) => p.includes(phrase));
  expect(found, phrase).toBeDefined();
  return found as string;
};
const lineWith = (text: string, phrase: string) => {
  const found = text.split("\n").find((l) => l.includes(phrase));
  expect(found, phrase).toBeDefined();
  return found as string;
};

// Each rule is pinned inside the paragraph that states it, so a phrase that also occurs elsewhere
// in the file (an older rule, a legacy shape) cannot keep a removed rule green.
const liveCapRule = () => paragraphWith(skill(), "**The live cap.**");
const contention = () => paragraphWith(skill(), "**Contention: step down, re-run once.**");
const resumeCap = () => paragraphWith(skill(), "**Resume the live cap.**");
const loopStepUp = () => paragraphWith(loop(), "Step up additively");
const loopContention = () => paragraphWith(loop(), "Only the controller's ledgered verify runs count");
const loopResume = () => paragraphWith(loop(), "On resume N is rebuilt");

const SIGNATURES = [
  "EADDRINUSE",
  "index.lock",
  "database is locked",
  "SQLITE_BUSY",
  "Lock wait timeout exceeded",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "Test timed out",
  "Hook timed out",
];

describe("the live developer cap: start and ceiling", () => {
  it("no longer states a fixed cap of 4 developers", () => {
    for (const [name, text] of both()) {
      expect(text, name).not.toContain("cap of 4");
      expect(text, name).not.toContain("4 developers in flight");
      expect(text, name).not.toContain("Up to 4 developers");
    }
  });

  it("names the live cap and counts fix-round and resume-commit developers under the three dispatch conditions", () => {
    for (const [name, text] of both()) {
      const rules = paragraphWith(text, "three dispatch conditions");
      expect(rules, name).toContain("live cap");
      expect(rules, name).toContain("fix-round");
      expect(rules, name).toContain("resume-commit");
    }
  });

  it("starts the loop at min(2, harness.developers.max) with a start ruling", () => {
    const rule = liveCapRule();
    expect(rule).toContain("Ruling: developer cap <N> — start");
    expect(rule).toContain("min(2, `harness.developers.max`)");
    expect(loop()).toContain("Ruling: developer cap <N> — start");
    expect(loop()).toContain("min(2, `harness.developers.max`)");
  });

  it("reads the ceiling from developers.max of kf tasks --json", () => {
    expect(liveCapRule()).toMatch(/kf tasks <f> --json`? field `developers\.max`/);
    expect(paragraphWith(loop(), "**live cap**")).toMatch(/kf tasks <f> --json/);
    expect(loop()).toMatch(/kf tasks <f> --json`?[^\n]*developers\.max|developers\.max[^\n]*kf tasks <f> --json/);
  });
});

describe("stepping the cap up", () => {
  it("adds one per clean parallel wave, decided in wave order once that wave and every earlier wave are complete", () => {
    const rule = liveCapRule();
    expect(rule).toContain("+1 per clean parallel wave");
    expect(rule).toContain("wave order");
    expect(rule).toContain("every earlier wave");
  });

  it("never changes the cap on an inline wave and bounds it by the ceiling and the widest incomplete wave", () => {
    const rule = liveCapRule();
    expect(rule).toMatch(/inline wave never changes N/);
    expect(rule).toContain("widest incomplete wave");
    expect(rule).toMatch(/exceed the ceiling/);
  });

  it("ledgers a step-up as a cap ruling naming the old and new cap and the clean wave", () => {
    expect(liveCapRule()).toContain("Ruling: developer cap <old> → <new> — wave <w> clean");
    expect(loopStepUp()).toContain("Ruling: developer cap <old> → <new> — wave <w> clean");
  });

  it("states the step-up rule in the loop reference too", () => {
    const rule = loopStepUp();
    expect(rule).toContain("+1 per clean parallel wave");
    expect(rule).toContain("wave order");
    expect(rule).toContain("every earlier wave");
    expect(rule).toMatch(/inline wave never changes N/);
    expect(rule).toContain("widest incomplete wave");
    expect(rule).toMatch(/exceed the ceiling/);
    expect(rule).toContain("Note wave <w>: no step-up");
  });

  it("ledgers a decision that changes nothing as a no-step-up note with its reason, never a ruling", () => {
    for (const [name, text] of both()) {
      const holders = paragraphs(text).filter((p) => p.includes("Note wave <w>: no step-up"));
      expect(holders.length, name).toBeGreaterThan(0);
      for (const reason of ["not clean", "inline", "ceiling", "last wave", "widest incomplete wave"]) {
        expect(holders.some((p) => p.includes(reason)), `${name}: ${reason}`).toBe(true);
      }
    }
    expect(liveCapRule()).toMatch(/due once wave <?w>?[^.]*every earlier wave|decision is due/);
  });
});

describe("stepping the cap down on contention", () => {
  it("lists all nine contention signatures in the contention rule", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      for (const signature of SIGNATURES) expect(text, `${name}: ${signature}`).toContain(signature);
    }
  });

  it("counts only the controller's ledgered verify runs, not kf verify --stage nor developers' own runs", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      expect(text, name).toContain("Only the controller's ledgered verify runs count");
      expect(text, name).toContain("kf verify --stage");
      expect(text, name).toMatch(/developers' own runs/);
    }
  });

  it("halves the cap to max(1, ⌊N/2⌋) at most once per contention event", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      expect(text, name).toContain("max(1, ⌊N/2⌋)");
      expect(text, name).toMatch(/once per contention event/);
    }
  });

  it("recognises the same event only by a step-down ruling written after that task's verify started, never by a ceiling-lowered ruling", () => {
    const rule = contention();
    expect(rule).toContain("already dropped since that verify started");
    const event = paragraphWith(skill(), "already dropped since that verify started");
    expect(event).toContain("of any task, written after this task's `verify started` line");
    expect(event).toMatch(/ceiling lowered[^.]*(never|not)|(never|not)[^.]*ceiling lowered/i);
  });

  it("ledgers the verify rerun note with the signature", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      expect(text, name).toContain("Note TASK-NNN: verify rerun — contention <signature>");
    }
  });

  it("holds new developers until fewer than N are in flight, then re-runs once and routes a second failure", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      expect(text, name).toContain("fewer than N");
      expect(text, name).toMatch(/one re-run/);
      expect(text, name).toContain("fix loop");
      expect(text, name).toMatch(/other-task routing|another task's Files/);
    }
  });

  it("defines a re-run and keeps its failure from stepping down or being treated as new contention", () => {
    const rule = contention();
    expect(rule).toContain("A re-run is a verify whose `verify started` follows a `Note TASK-NNN: verify rerun` line");
    expect(rule).toMatch(/no `verify done` of that task between/);
    expect(rule).toMatch(/re-run's failure never triggers/);
    expect(rule).toMatch(/N is unchanged/);
    const mirror = loopContention();
    expect(mirror).toContain("A re-run is a verify whose `verify started` follows");
    expect(mirror).toContain("A re-run's failure never triggers steps 1–4 nor resume rule (c): N is unchanged");
    expect(mirror).toContain("goes straight to the fix loop");
  });

  it("steps a task down at most once per signature until one of its verifies passes", () => {
    for (const [name, text] of [["SKILL.md", contention()], ["task-loop.md", loopContention()]] as const) {
      const flat = text.replace(/\s+/g, " ");
      expect(flat, name).toContain("A task steps N down at most once per signature until one of its verifies passes");
      expect(flat, name).toContain("skips only step 1 and still gets its rerun note and one re-run");
      expect(flat, name).toContain("with the same signature and no `verify done exit=0` of this task after it");
    }
  });

  it("saves each verify output to the item's verify log and classifies contention from it", () => {
    expect(contention()).toContain("loop/task-NNN-verify.log");
    expect(contention()).toMatch(/appending/);
    expect(loop()).toContain("task-NNN-verify.log");
  });
});

describe("the wait line and resuming the cap", () => {
  it("writes the cap wait line with the live N in both files and the waiting-developers paragraph", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("TASK-NNN: developer waits — <N> developers in flight");
    }
    expect(paragraphWith(skill(), "**Waiting developers.**")).toContain("developer waits — <N> developers in flight");
  });

  it("restores N from the latest cap ruling, or min(2, max) with the start ruling, capped at the current max", () => {
    for (const [name, text] of [["SKILL.md", resumeCap()], ["task-loop.md", loopResume()]] as const) {
      expect(text, name).toMatch(/latest `Ruling: developer cap`/);
      expect(text, name).toContain("min(2, `harness.developers.max`)");
      expect(text, name).toContain("then ledger the start ruling");
      expect(text, name).toMatch(/capped at the current max/);
      expect(text, name).toContain("Ruling: developer cap <old> → <new> — ceiling lowered to <max>");
    }
  });

  it("resumes a pending re-run, an owed step-down and the undecided step-ups in wave order", () => {
    const resume = resumeCap();
    expect(resume).toMatch(/\(b\)[^(]*Note TASK-NNN: verify rerun[^(]*pending re-run/);
    expect(resume).toMatch(/\(c\)[^(]*owed step-down/);
    expect(resume).toMatch(/\(d\)[^(]*wave order/);
    expect(resume).toMatch(/\(d\)[\s\S]*no step-up/);
    expect(resume).toContain("neither");
  });

  it("applies rule (c) only to a verify that is not a re-run and re-runs a missing log once as a plain verify", () => {
    const resume = resumeCap();
    expect(resume).toMatch(/\(c\)[^]*not a re-run/);
    expect(resume).toContain("task-NNN-verify.log");
    expect(resume).toMatch(/plain verify/);
  });

  it("holds new developers above a lowered N and never cancels a seat in flight", () => {
    const resume = resumeCap();
    expect(resume).toMatch(/never cancelled/);
    expect(resume).toContain("fewer than N");
  });

  it("mirrors the resume rules in the loop reference", () => {
    const resume = loopResume();
    expect(resume).toContain("held until fewer than N developer seats are in flight");
    expect(resume).toMatch(/\(a\)/);
    expect(resume).toMatch(/\(b\)[^(]*(Note TASK-NNN: verify rerun|re-run)/);
    expect(resume).toMatch(/\(c\)[^(]*owed step-down/);
    expect(resume).toMatch(/\(d\)[\s\S]*no step-up/);
    expect(resume).toContain("task-NNN-verify.log");
  });

  it("never opens a fix round for a pending re-run or an owed step-down in the loop reference", () => {
    expect(loopResume()).toContain("is never opened as a fix round");
  });

  it("guards the fix-round resume step against a pending re-run or an owed step-down", () => {
    const step8 = lineWith(skill(), "A latest review `code-reviewer done status=findings`");
    expect(step8).toContain("Note TASK-NNN: verify rerun");
    expect(step8).toMatch(/rule \(c\)/);
    expect(step8).toMatch(/pending re-run is never a fix round|never a fix round/);
  });

  it("always resumes a developer already dispatched with no done, whatever N is", () => {
    const rule = paragraphWith(skill(), "whatever N is");
    expect(rule).toMatch(/`dispatched` line with no `done`/);
    expect(rule).toMatch(/gates only new developer dispatches/);
    expect(loop()).toMatch(/whatever N is/);
  });
});
