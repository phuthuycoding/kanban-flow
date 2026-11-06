import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLedger } from "../workflow/loop-stats.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const implement = (): string => read("skills/implement/SKILL.md");
const loop = (): string => read("skills/implement/references/task-loop.md");
const plan = (): string => read("skills/plan/SKILL.md");

describe("the loop's verify rules", () => {
  it("re-runs a commit that cannot build alone with --at-head, after a ruling and no fix round", () => {
    const rule = implement();
    expect(rule).toContain("**A task's commit that cannot build alone.**");
    expect(rule).toContain("--at-head");
    expect(rule).toMatch(/That exit 1 is no fix round/);
  });

  it("ledgers only the exit code kf verify returned", () => {
    expect(implement()).toContain("the exit code `kf verify` itself returned and logged, never one read from another command");
    expect(loop()).toContain("`verify done exit=<n>` is the exit code `kf verify` returned");
  });

  it("never lets the controller widen Files to get past exit 2", () => {
    expect(implement()).toContain("never widen Files or commit the change yourself");
  });
});

describe("the ledger's clock and open questions", () => {
  it("reads every timestamp from the clock and shows the ±hh:mm command", () => {
    expect(loop()).toContain("never estimated");
    expect(loop()).toContain("date +%Y-%m-%dT%H:%M:%S%z");
  });

  it("carries a ⚠️ only a run can answer into testing, on a line loop-stats reads as a note", () => {
    expect(implement()).toContain("`TASK-NNN: unverified — <claim>`");
    expect(read("skills/test/SKILL.md")).toContain("`TASK-NNN: unverified — <claim>`");
    const [line] = parseLedger("# h\nTASK-008: unverified — the token reaches storage in a browser @ 2026-11-01T20:15:12+07:00").lines;
    expect(line.kind).toBe("other-timed");
  });
});

describe("one owner for the loop's rules", () => {
  it("keeps cap, contention and resume in the skill, and only reasons in task-loop.md", () => {
    const section = loop().slice(loop().indexOf("## Parallel developers"), loop().indexOf("## The fix loop"));
    expect(section).toContain("`kf:implement` owns the rules");
    expect(section).not.toContain("Ruling: developer cap");
    expect(implement()).toContain("**The live cap.**");
  });
});

describe("the plan's task shape", () => {
  it("gives shared wiring files one scaffold task in the first wave", () => {
    expect(plan()).toMatch(/\*\*Wiring\*\*: [^\n]*one scaffold task in the first wave/);
  });

  it("keeps a UI task's cases on that task, with a final E2E task adding journeys only", () => {
    expect(plan()).toContain("carries its own UI cases");
    expect(plan()).toContain("never replace them");
    expect(read("agents/spec-reviewer.md")).toContain("with no UI test case of its own");
  });
});
