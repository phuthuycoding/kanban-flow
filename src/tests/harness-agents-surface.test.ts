import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = () => read("skills", "kanban-implement", "SKILL.md");
const reference = (name: string) => read("skills", "kanban-implement", "references", name);
const agentBody = (name: string) => read("skills", "kanban-flow", "agents", `${name}.md`);

/** The text between a heading that starts with `from` and the next heading that starts with `to`. */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
}

const taskLoop = () => slice(implement(), "\n## 3.", "\n## 4.");

const STAGE_WORKER_PARAGRAPH =
  "**Invoked through `kf run` as the stage worker?** If your prompt starts with `kf-run:<id>` **without** a `TASK-###` token, you are the controller for this stage only: skip the \"move to stage\" step below, never run `kf stage` / `kf approve` / `kf archive` / `kf run`, never edit approved contract artifacts, never push, and end your final message with two lines exactly: `STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` and `Summary: <one or two sentences>`. The main agent reads them and decides the transition. You run section 3's task loop when your runtime offers subagents; **the only commits in a stage worker's session are the ones that loop prescribes** — one per task on the item branch, made by the implementer it dispatches. You commit nothing yourself outside that loop.";
const TASK_WORKER_PARAGRAPH =
  "**Task worker:** if your prompt starts with `kf-run:<id> TASK-###`, you implement exactly that one task and nothing else — you are the implementer, not the controller. Only touch files in its allowlist; if you need another file, stop with `STATUS: BLOCKED` and say which file and why. Do not edit tasks.md, do not commit (kf commits, merges and verifies), never dispatch a subagent, and end with the STATUS lines above. Follow the TDD and self-review rules of `references/implementer-brief.md`.";

describe("the task loop seats", () => {
  it("dispatches the test-writer, then the developer, then the code-reviewer, each from its own brief", () => {
    const loop = taskLoop();
    const testWriter = loop.indexOf("`Agent(test-writer)`");
    const developer = loop.indexOf("`Agent(developer)`");
    const reviewer = loop.indexOf("`Agent(code-reviewer)`");
    expect(testWriter).toBeGreaterThanOrEqual(0);
    expect(developer).toBeGreaterThan(testWriter);
    expect(reviewer).toBeGreaterThan(developer);
    expect(loop).toContain("`references/test-writer-brief.md`");
    expect(loop).toContain("`references/developer-brief.md`");
  });

  it("skips the test-writer for a task with no unit or integration test case and ledgers why", () => {
    const loop = taskLoop();
    expect(loop).toContain("`TASK-NNN: no test-writer — <why>`");
    expect(loop).toContain("`No TDD: <why>`");
  });

  it("routes a developer's test dispute to the test-writer and stops on a contradicting test case or a repeat dispute", () => {
    const dispute = taskLoop().split("\n").find((line) => line.includes("`TEST_DISPUTE: <file:line> <why>`"));
    expect(dispute, "dispute paragraph").toBeDefined();
    expect(dispute).toContain("`Agent(test-writer)`");
    expect(dispute).toContain("`Ruling:`");
    expect(dispute).toContain("resume the developer");
    expect(dispute).toContain("contradicts an FR or another TC");
    expect(dispute).toContain("a second dispute on the same test after a Ruling");
    expect(dispute).toContain("stop");
  });

  it("splits the fix loop between the developer and the test-writer under one five-round cap", () => {
    const fixLoop = slice(taskLoop(), "\n### 3.4", "\n### 3.5");
    expect(fixLoop).toContain("Rounds 1–3 resume the original developer");
    expect(fixLoop).toContain("Rounds 4–5 dispatch a fresh developer one tier up");
    expect(fixLoop).toContain("Findings about a test go to the test-writer");
    expect(fixLoop).toContain("Five rounds maximum per task");
    expect(fixLoop).not.toContain("implementer");
  });

  it("dispatches the automation-writer for UI tasks under the full level and commits its specs before the review", () => {
    const loop = taskLoop();
    expect(loop).toContain("`Agent(automation-writer)`");
    expect(loop).toContain("`references/automation-writer-brief.md`");
    expect(loop).toContain("`Level: full`");
    expect(loop).toContain("after the developer's commit");
    expect(loop).toContain("`data-testid` contract");
    expect(loop).toMatch(/the Playwright MCP is for selector discovery only, one agent at a time/i);
    expect(loop).toContain("commit the automation-writer's spec files unchanged as a second commit of the task, before the code-reviewer");
    const brief = reference("automation-writer-brief.md");
    expect(brief).toContain("selector discovery only, one agent at a time");
    expect(brief).toContain("npx playwright test");
  });

  it("names a required model on every seat template, pointing at the model selection section", () => {
    for (const seat of ["test-writer", "developer", "automation-writer"]) {
      const template = reference(`${seat}-brief.md`);
      expect(template, seat).toMatch(new RegExp(`^\\s*subagent_type: ${seat}\\b`, "m"));
      const model = /^\s*model: \[MODEL\]\s+# REQUIRED — (.+)$/m.exec(template)?.[1];
      expect(model, seat).toBeDefined();
      expect(model, seat).toContain("sonnet by default");
      expect(model, seat).toContain("opus for multi-file or design judgement or a test failing twice");
      expect(model, seat).toContain("task-loop.md § Model selection");
    }
    expect(reference("task-loop.md")).toContain("\n## Model selection\n");
  });

  it("leaves the kf run worker paragraphs and the single-implementer brief as they were", () => {
    const skill = implement();
    expect(skill).toContain(`\n${STAGE_WORKER_PARAGRAPH}\n`);
    expect(skill).toContain(`\n${TASK_WORKER_PARAGRAPH}\n`);
    const implementer = reference("implementer-brief.md");
    expect(implementer).toContain("subagent_type: general-purpose");
    expect(implementer).toContain("TDD is mandatory");
  });

  it("hands the test-writer only unit and integration cases and wants each test failing for the right reason", () => {
    const brief = reference("test-writer-brief.md");
    expect(brief).toContain("Test type is Unit or Integration");
    expect(brief).toContain("write the regression test from the bug report's reproduction");
    expect(brief).toContain("fails for the right reason before the developer is dispatched");
    expect(brief).toContain("<item>/loop/task-NNN-tests-report.md");
    expect(agentBody("test-writer")).toContain("<item>/loop/task-NNN-tests-report.md");
    expect(taskLoop()).toContain("writes the regression test from the bug report's reproduction");
  });

  it("never lets a session without subagents fill the test-writer and developer seats itself", () => {
    const loop = taskLoop();
    expect(loop).toContain("never fills the test-writer and the developer seats in one session");
    expect(loop).toContain("`TASK-NNN: implemented, test-writer seat: none, review seat: none`");
  });

  it("hands the developer the failing tests, forbids editing them and has it commit the task", () => {
    const brief = reference("developer-brief.md");
    expect(brief).toContain("the test-writer's test files and their failing output");
    expect(brief).toContain("Never edit those test files");
    expect(brief).toContain("The loop commits this task");
    expect(brief).toContain("<item>/loop/task-NNN-report.md");
    expect(agentBody("developer")).toContain("<item>/loop/task-NNN-report.md");
  });

  it("rules on a test that already passes, a case without an expected value and a mixed unit and UI task", () => {
    const loop = taskLoop();
    expect(loop).toContain("A test that passes before implementation");
    expect(loop).toContain("record a `Ruling:` before the developer is dispatched");
    expect(loop).toContain("A test-writer `NEEDS_CONTEXT` for a TC with no concrete expected value");
    expect(loop).toContain("never goes to the developer");
    expect(loop).toContain("the Unit TCs go to the test-writer and the UI TCs to the automation-writer; neither edits the other's files");
  });
});
