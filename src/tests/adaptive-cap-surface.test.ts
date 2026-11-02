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
      expect(text, name).toContain("live cap");
      const rules = paragraphWith(text, "three dispatch conditions");
      expect(rules, name).toContain("fix-round");
      expect(rules, name).toContain("resume-commit");
    }
  });

  it("starts the loop at min(2, harness.developers.max) with a start ruling", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("Ruling: developer cap <N> — start");
      expect(text, name).toContain("min(2, `harness.developers.max`)");
    }
  });

  it("reads the ceiling from developers.max of kf tasks --json", () => {
    for (const [name, text] of both()) {
      expect(text, name).toMatch(/kf tasks <f> --json`? (field |\()?`?developers\.max/);
    }
  });
});

describe("stepping the cap up", () => {
  it("adds one per clean parallel wave, decided in wave order once that wave and every earlier wave are complete", () => {
    for (const [name, text] of both()) {
      expect(text, name).toMatch(/\+1 per clean parallel wave/);
      expect(text, name).toContain("wave order");
      expect(text, name).toMatch(/every earlier wave/);
    }
  });

  it("never changes the cap on an inline wave and bounds it by the ceiling and the widest incomplete wave", () => {
    for (const [name, text] of both()) {
      expect(text, name).toMatch(/inline waves? never change/);
      expect(text, name).toContain("widest incomplete wave");
      expect(text, name).toMatch(/ceiling/);
    }
  });

  it("ledgers a step-up as a cap ruling naming the old and new cap and the clean wave", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("Ruling: developer cap <old> → <new> — wave <w> clean");
    }
  });
});

describe("stepping the cap down on contention", () => {
  it("lists all nine contention signatures", () => {
    for (const [name, text] of both()) {
      for (const signature of SIGNATURES) expect(text, `${name}: ${signature}`).toContain(signature);
    }
  });

  it("counts only the controller's ledgered verify runs, not kf verify --stage nor developers' own runs", () => {
    for (const [name, text] of both()) {
      expect(text, name).toMatch(/ledgered/);
      expect(text, name).toContain("kf verify --stage");
      expect(text, name).toMatch(/developers?'s? own runs/);
    }
  });

  it("halves the cap to max(1, ⌊N/2⌋) at most once per contention event", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("max(1, ⌊N/2⌋)");
      expect(text, name).toMatch(/once per contention event/);
    }
  });

  it("ledgers the verify rerun note with the signature", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("Note TASK-NNN: verify rerun — contention <signature>");
    }
  });

  it("holds new developers until fewer than N are in flight, then re-runs once and routes a second failure", () => {
    for (const [name, text] of both()) {
      const rerun = paragraphWith(text, "verify rerun — contention <signature>");
      expect(rerun, name).toContain("fewer than N");
      expect(rerun, name).toMatch(/one re-run/);
      expect(rerun, name).toContain("fix loop");
    }
  });
});

describe("the wait line and resuming the cap", () => {
  it("writes the cap wait line with the live N in the grammar paragraph of both files", () => {
    for (const [name, text] of both()) {
      expect(text, name).toContain("TASK-NNN: developer waits — <N> developers in flight");
    }
    expect(paragraphWith(skill(), "**Waiting developers.**")).toContain("developer waits — <N> developers in flight");
  });

  it("restores N from the latest cap ruling, or min(2, max) without one, capped at the current max", () => {
    const text = skill();
    const start = text.indexOf("**Resume from the ledger");
    expect(start, "resume section").toBeGreaterThanOrEqual(0);
    const resume = text.slice(start, text.indexOf("**Pre-Task-1", start));
    expect(resume).toMatch(/latest `?Ruling: developer cap/);
    expect(resume).toContain("min(2,");
    expect(resume).toMatch(/current (max|ceiling)/);
  });

  it("resumes a pending verify rerun, an owed step-down and the step-ups owed in wave order", () => {
    const text = skill();
    const start = text.indexOf("**Resume from the ledger");
    expect(start, "resume section").toBeGreaterThanOrEqual(0);
    const resume = text.slice(start, text.indexOf("**Pre-Task-1", start));
    expect(resume).toContain("verify rerun");
    expect(resume).toMatch(/owed/);
    expect(resume).toMatch(/step-down/);
    expect(resume).toContain("wave order");
  });

  it("never cancels a seat above a lowered N", () => {
    const text = skill();
    expect(text).toMatch(/never cancel/i);
    expect(text).toMatch(/lowered/);
  });
});
