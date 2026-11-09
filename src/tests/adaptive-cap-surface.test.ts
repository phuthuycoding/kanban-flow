import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const skill = () => read("skills", "implement", "SKILL.md");
const both = () => [["SKILL.md", skill()]] as const;

const paragraphs = (text: string) => text.split(/\n\s*\n/);
const paragraphWith = (text: string, phrase: string) => {
  const found = paragraphs(text).find((p) => p.includes(phrase));
  expect(found, phrase).toBeDefined();
  return found as string;
};

const loopReference = () => read("skills", "implement", "references", "task-loop.md");

/** The text between the first `from` and the next `to` after it (to the end when `to` is absent). */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

describe("the live developer cap: start and ceiling", () => {
  it("no longer states a fixed cap of 4 developers", () => {
    for (const [name, text] of both()) {
      expect(text, name).not.toContain("cap of 4");
      expect(text, name).not.toContain("4 developers in flight");
      expect(text, name).not.toContain("Up to 4 developers");
    }
  });

  it("leaves the start, the ceiling and the step rules to kf next, and keeps the invalid-config judgement", () => {
    const loop = paragraphWith(skill(), "**The loop runs on `kf next`.**");
    expect(loop).toContain("the live developer cap and its step-ups and step-downs");
    const invalid = slice(skill(), "### Invalid ceiling", "\n### ");
    expect(invalid).toContain("kf tasks <f> --json");
    expect(invalid).toContain("`developers.error`");
    expect(invalid).toContain("reads 1");
    expect(invalid).toMatch(/report it to the human/);
  });
});

// The live cap, contention and resume-the-cap rules moved into `kf next` (cap.ts, schedule.ts); their behaviour
// is pinned in next-cap.test.ts and next-schedule.test.ts. task-loop.md keeps the reasons, pinned here.
describe("the reasons the cap is shaped this way", () => {
  const reasons = () => paragraphWith(loopReference(), "The cap is live because");

  it("starts low, rises additively and halves on contention, for stated reasons", () => {
    expect(reasons()).toContain("It starts low because 2 is the smallest value that still runs anything in parallel");
    expect(reasons()).toContain("rises additively because one clean wave proves little");
    expect(reasons()).toContain("halves on contention because the load that failed will fail again");
  });

  it("tells contention from a real failure by one re-run and decides step-ups in wave order from the ledger", () => {
    expect(reasons()).toContain("A contention failure is told from a real one by one re-run");
    expect(reasons()).toContain("Step-ups are decided in wave order, from the ledger alone");
  });

  it("keeps the cap rulings and the contention notes among the ledger lines", () => {
    expect(loopReference()).toContain("Note TASK-NNN: verify rerun — contention <signature> @ <ts>");
    expect(loopReference()).toContain("Note wave <w>: no step-up — <reason> @ <ts>");
    expect(loopReference()).toContain("TASK-NNN: developer waits — <N> developers in flight");
  });

  it("keeps the verify log the contention is read from", () => {
    expect(skill()).toContain("task-NNN-verify.log");
  });
});
