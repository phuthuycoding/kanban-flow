import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLedger } from "../workflow/loop-stats.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const implement = (): string => read("assets/skills/implement/SKILL.md");
const loop = (): string => read("assets/skills/implement/references/task-loop.md");
const plan = (): string => read("assets/skills/plan/SKILL.md");

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
    expect(read("assets/skills/test/SKILL.md")).toContain("`TASK-NNN: unverified — <claim>`");
    const [line] = parseLedger("# h\nTASK-008: unverified — the token reaches storage in a browser @ 2026-11-01T20:15:12+07:00").lines;
    expect(line.kind).toBe("other-timed");
  });
});

describe("the round cap", () => {
  it("keeps five rounds for the whole task, repairs included", () => {
    expect(implement()).toContain("Five rounds is the whole life of a task");
    // The round count of the resume steps moved into `kf next` (src/workflow/next; next-machine-routing.test.ts).
    expect(implement()).toContain("continuing the task's round count");
    expect(loop()).toContain("continues that count");
  });

  it("stops a reopened task at the cap for the human instead of parking it or running more rounds", () => {
    expect(implement()).toContain("Note TASK-NNN: cap reached — <failure>");
    expect(implement()).toContain("never parked to completion");
    expect(implement()).toContain("Five things stop you");
    expect(implement()).toContain("A task never reopened takes the breaker");
    // The resume steps and the completion check that restated the stop moved into `kf next`
    // (src/workflow/next; next-machine-routing.test.ts, next-schedule.test.ts).
    expect(implement()).toContain("takes the `cap reached` stop instead");
    expect(implement()).not.toContain("accepted by ruling");
    expect(implement()).toContain("gives the work a new task with its own five rounds");
    expect(implement()).toContain("dispatch nothing new for the item");
    expect(implement()).toContain("superseded by TASK-MMM");
    expect(loop()).toContain("superseded by TASK-MMM");
    expect(implement()).toContain("superseded by contract");
    expect(loop()).toContain("superseded by contract");
    expect(implement()).toContain("waits for TASK-MMM's `complete` line");
    expect(implement()).toContain("or at once under `superseded by contract`");
    expect(implement()).toContain("no longer requires what failed");
    expect(implement()).toContain("the re-approved plan listing TASK-MMM among its dependencies");
    expect(loop()).toContain("stops for the human at the cap");
    expect(loop()).toContain("Note TASK-NNN: cap reached — <failure> @ <ts>");
    expect(loop()).toContain("At the cap of a task never reopened");
    expect(read("assets/skills/travel/SKILL.md")).toContain("`cap reached` stop");
  });

  it("lists a reopened task at its round cap among the stops for the human", () => {
    expect(read("assets/skills/flow/SKILL.md")).toContain("a reopened task at its round cap");
    expect(implement()).toContain("a reopened task at its round cap");
  });
});

describe("the test report's table cells", () => {
  it("escapes a pipe inside a cell so the gate does not read the row as failed", () => {
    expect(read("assets/skills/test/SKILL.md")).toContain("is written `\\|`");
  });
});

describe("one owner for the loop's rules", () => {
  it("keeps cap, contention and resume in kf next, and only reasons in task-loop.md", () => {
    const section = loop().slice(loop().indexOf("## Parallel developers"), loop().indexOf("## The fix loop"));
    expect(section).toContain("`kf next` owns the rules");
    expect(section).not.toContain("Ruling: developer cap");
    expect(implement()).not.toContain("**The live cap.**");
    expect(implement()).toContain("**The loop runs on `kf next`.**");
    expect(section).toContain("costs one re-run before it reaches the fix loop");
  });
});

describe("travel's stops for the human", () => {
  const travel = (): string => read("assets/skills/travel/SKILL.md");

  it("keeps blocked and owner=human lines out of every carry-over and out of the morning plan", () => {
    expect(travel()).toContain("except a `blocked` line and one marked `owner=human`");
    expect(travel()).toContain("Skip any item with a `blocked` or `owner=human` line in the last section");
    expect(travel()).toContain("rewrite every line that is not `done`, `blocked` or `owner=human` as `carry-over`");
    expect(travel()).toContain("it resumes every `driving` `owner=travel` line and leaves `blocked` lines blocked");
  });

  it("makes a fresh session read the session line before it resumes a day", () => {
    expect(travel()).toContain("reads the `session:` line first");
    expect(travel()).toContain("session: <ISO time from the clock>");
    expect(travel()).toContain("re-stamp the day's `session:` line");
    expect(read("assets/skills/travel/references/ledger-format.md")).toContain("`session: <ISO time>`");
  });
});

describe("the plan's task shape", () => {
  it("gives shared wiring files one scaffold task in the first wave", () => {
    expect(plan()).toMatch(/\*\*Wiring\*\*: [^\n]*one scaffold task in the first wave/);
  });

  it("keeps a UI task's cases on that task, with a final E2E task adding journeys only", () => {
    expect(plan()).toContain("carries its own UI cases");
    expect(plan()).toContain("never replace them");
    expect(read("assets/agents/spec-reviewer.md")).toContain("with no UI test case of its own");
  });
});
