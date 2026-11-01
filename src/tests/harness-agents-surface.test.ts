import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = () => read("skills", "kanban-implement", "SKILL.md");
const reference = (name: string) => read("skills", "kanban-implement", "references", name);
const testing = () => read("skills", "kanban-test", "SKILL.md");
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
    expect(dispute).toContain("Stop, too, on a second dispute on the same test after a Ruling — it is not another round");
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

  it("carries no stage-worker or task-worker paragraph and keeps the single-implementer brief", () => {
    const skill = implement();
    expect(skill).not.toContain("Invoked through `kf run`");
    expect(skill).not.toContain("**Task worker:**");
    expect(skill).not.toContain("kf-run:");
    const implementer = reference("implementer-brief.md");
    expect(implementer).toContain("subagent_type: general-purpose");
    expect(implementer).toContain("TDD is mandatory");
  });

  it("runs kf verify for the task after the developer's commit and before the code-reviewer", () => {
    const loop = slice(taskLoop(), "\n### 3.2", "\n### 3.4");
    const verify = loop.indexOf("kf verify <f> --task");
    expect(verify, "kf verify <f> --task").toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(loop.indexOf("`Agent(developer)`"));
    expect(verify).toBeLessThan(loop.indexOf("`Agent(code-reviewer)`"));
    expect(loop).toContain("--base <BASE>");
  });

  it("maps kf verify exit 2 to a plan change, exit 1 to a fix round and exit 3 to a corrected call", () => {
    const loop = taskLoop();
    expect(loop).toMatch(/exit 2[^\n]*stop[^\n]*(edit|fix)[^\n]*Files[^\n]*re-approve/i);
    expect(loop).toMatch(/exit 1[^\n]*developer[^\n]*fix round/i);
    expect(loop).toMatch(/exit 3[^\n]*(fix|correct)[^\n]*re-run[^\n]*never a fix round/i);
  });

  it("names kf verify --stage in place of the hand-run build gate when harness.verify.stage is configured", () => {
    const gate = slice(implement(), "\n## 4.", "\n## References");
    expect(gate).toContain("kf verify <f> --stage");
    expect(gate).toContain("harness.verify.stage");
    expect(gate).toContain("{build_command}");
  });

  it("has no hand-off section to a drive or to assigned roles", () => {
    const skill = implement();
    expect(skill).not.toContain("assignedRoles");
    expect(skill).not.toContain("## 2. Hand off to the harness");
    expect(skill).not.toMatch(/--accept-config|plan_change_needed|usage_limit/);
  });

  it("leaves the task loop reference without a Role line", () => {
    const loop = reference("task-loop.md");
    expect(loop).not.toMatch(/`Role` column/);
    expect(loop).not.toMatch(/Under `kf drive`/);
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

  it("tells the developer about specs written before it and keeps them out of its task commit", () => {
    const prompt = slice(reference("developer-brief.md"), "```", "\n```\n");
    expect(prompt).toContain("The automation-writer's spec files: [SPEC_FILES]");
    expect(prompt).toContain("Never edit them and keep them out of your task commit");
    expect(prompt).toContain("commit them unchanged as a second commit when you are resumed");
    expect(taskLoop()).toContain("pass their paths to the developer as `[SPEC_FILES]`");
    expect(agentBody("developer")).toContain("the commits the brief names");
  });

  it("rules on a test that already passes, a case without an expected value and a mixed unit and UI task", () => {
    const loop = taskLoop();
    expect(loop).toContain("A test that passes before implementation");
    expect(loop).toContain("record a `Ruling:` before the developer is dispatched");
    expect(loop).toContain("A test-writer `NEEDS_CONTEXT` for a TC with no concrete expected value");
    expect(loop).toContain("never goes to the developer");
    expect(loop).toContain("the Unit TCs go to the test-writer and the UI TCs to the automation-writer; neither edits the other's files");
  });

  it("hashes the test-writer's files before the developer runs and sends a changed hash back to the test-writer", () => {
    const loop = taskLoop();
    expect(loop).toContain("`git hash-object <test files>`");
    expect(loop).toContain("`TASK-NNN: test hashes <file>=<sha> …`");
    expect(loop).toContain("a mismatch is handled like a `TEST_DISPUTE` — back to the test-writer — never accepted silently");
    expect(reference("developer-brief.md")).toContain("The controller hashes these test files before you start and compares the hashes after you report");
    expect(agentBody("developer")).toContain("The controller hashes the test-writer's files before you start and compares the hashes after you report");
  });

  it("re-hashes the tests after every test-writer change and compares against the latest hashes", () => {
    const loop = taskLoop();
    const REHASH = "re-run `git hash-object` on the changed test files and ledger a new `TASK-NNN: test hashes` line before resuming the developer";
    const dispute = loop.split("\n").find((line) => line.includes("`TEST_DISPUTE: <file:line> <why>`"));
    expect(dispute).toContain(`Fixed → ${REHASH}`);
    const testFindings = slice(loop, "\n### 3.4", "\n### 3.5").split("\n").find((line) => line.includes("Findings about a test go to the test-writer"));
    expect(testFindings).toContain(REHASH);
    expect(loop).toContain("compare them with the latest `TASK-NNN: test hashes` line");
    expect(loop).toContain("read from the worktree files at the developer's committed HEAD");
    expect(reference("task-loop.md")).toContain("TASK-001: test hashes <file>=<sha> …");
  });
});

describe("the testing stage dispatch", () => {
  const section = () => slice(testing(), "\n## 2.", "\n## 3.");

  it("dispatches the automation-writer under the full level when the UI suite or a UI spec is missing", () => {
    const text = section();
    expect(text).toContain("`Agent(automation-writer)`");
    expect(text).toContain("`../kanban-implement/references/automation-writer-brief.md`");
    expect(text).toContain("`full`");
    expect(text).toContain("a UI test case has no spec");
    expect(text).toContain("still missing after the run, or the tests are skipped, that's a gap");
  });

  it("records the playwright rows with real exit codes and refuses a PASS on a non-zero row", () => {
    const text = section();
    expect(text).toContain("`## Commands and Evidence`");
    expect(text).toContain("`npx playwright test`");
    expect(text).toContain("real exit code");
    expect(text).toContain("non-zero row means the report is not PASS");
  });

  it("names the brief, the report and the allowlist the testing-stage dispatch fills", () => {
    const text = section();
    expect(text).toContain("`<item>/loop/testing-e2e-brief.md`");
    expect(text).toContain("`<item>/loop/testing-e2e-report.md`");
    expect(text).toContain("the Playwright `testDir` as the Files allowlist");
    const brief = reference("automation-writer-brief.md");
    expect(brief).toContain("`<item>/loop/testing-e2e-brief.md` at the testing stage");
    expect(brief).toContain("`<item>/loop/testing-e2e-report.md` at the testing stage");
    expect(brief).toContain("the Playwright `testDir` at the testing stage");
  });

  it("has the in-session controller commit the testing-stage specs before the testing report", () => {
    const text = section();
    expect(text).toContain("the in-session controller commits the automation-writer's spec files unchanged in one commit on the item branch before writing the testing report");
    expect(text).not.toContain("A `kf run` worker");
    expect(agentBody("automation-writer")).toContain("the in-session testing controller commits your spec files unchanged in one commit on the item branch before the testing report");
    expect(read("docs", "workflow", "harness.md")).toContain("committed unchanged by the developer in the task loop and by the in-session controller at the testing stage");
  });

  it("limits the Playwright MCP to selector discovery, one agent at a time", () => {
    expect(section()).toMatch(/the Playwright MCP is for selector discovery only, one agent at a time/i);
  });
});

describe("the documentation surfaces", () => {
  const normalise = (text: string) => text.replace(/\*\*/g, "").replace(/\s+/g, " ");
  const doc = (...parts: string[]) => normalise(read(...parts));
  const SIX = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer"];
  const SURFACES: string[][] = [
    ["README.md"],
    [".github", "pages", "index.html"],
    ["docs", "workflow", "cli-reference.md"],
    ["docs", "workflow", "autoconfig.md"],
    ["docs", "workflow", "skills.md"],
    ["docs", "workflow", "harness.md"],
    ["docs", "workflow", "lifecycle.md"],
    ["skills", "kanban-flow", "SKILL.md"],
    ["skills", "kanban-flow", "references", "harness-tools.md"],
  ];
  const STALE_COUNT = /\b(3|three) (kanban )?(agents|agent definitions|agent bodies|subagents)\b/i;

  it("states no count of three agents on any surface", () => {
    for (const surface of SURFACES) {
      expect(doc(...surface), surface.join("/")).not.toMatch(STALE_COUNT);
    }
  });

  it("names all six agents in the README, the Pages site and the CLI reference", () => {
    for (const surface of [["README.md"], [".github", "pages", "index.html"], ["docs", "workflow", "cli-reference.md"]]) {
      const text = doc(...surface);
      for (const name of SIX) expect(text, `${surface.join("/")} ${name}`).toContain(name);
    }
  });

  it("describes no single implementer in the in-session task loop", () => {
    for (const surface of [
      ["README.md"],
      ["docs", "workflow", "skills.md"],
      ["docs", "workflow", "lifecycle.md"],
      ["skills", "kanban-flow", "SKILL.md"],
    ]) {
      const text = doc(...surface);
      expect(text, surface.join("/")).not.toMatch(/fresh implementer per task/i);
      expect(text, surface.join("/")).toContain("test-writer");
      expect(text, surface.join("/")).toContain("developer");
    }
  });
});

describe("the skills tree after the runner and drive removal", () => {
  const skillsRoot = join(PKG_ROOT, "skills");
  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "travel" ? [] : files(full);
      return /\.(md|sh)$/.test(entry.name) || !entry.name.includes(".") ? [full] : [];
    });
  }
  const lines = () => files(skillsRoot).flatMap((file) => readFileSync(file, "utf8").split("\n").map((text, i) => ({ where: `${file.slice(skillsRoot.length + 1)}:${i + 1}`, text })));

  it("carries no kf-run worker marker and no assignedRoles check outside travel", () => {
    const hits = lines().filter((l) => /kf-run:|assignedRoles/.test(l.text)).map((l) => l.where);
    expect(hits).toEqual([]);
  });

  it("names kf drive, kf run, kf runs and kf harness only to say they were removed", () => {
    const hits = lines()
      .filter((l) => /\bkf (drive|run|runs|harness)\b/.test(l.text) && !/removed/i.test(l.text))
      .map((l) => l.where);
    expect(hits).toEqual([]);
  });

  it("describes only in-session agents in the multi-agent harness section", () => {
    const section = slice(read("skills", "kanban-flow", "SKILL.md"), "\n## Multi-agent harness", "\n## ");
    expect(section).not.toMatch(/runner|headless|harness\.(stages|roles|runners)/i);
    expect(section).toContain("Agent(");
    expect(read("skills", "kanban-flow", "references", "harness-tools.md")).not.toMatch(/runner/i);
  });

  it("says a review without a subagent tool cannot complete and the human is told, without kf run", () => {
    const review = read("skills", "kanban-review", "SKILL.md");
    const fallback = review.split("\n").find((line) => line.includes("no subagent tool at all"));
    expect(fallback, "fallback paragraph").toBeDefined();
    expect(fallback).toMatch(/cannot complete/);
    expect(fallback).toMatch(/tell the human/i);
    expect(fallback).not.toMatch(/kf run|--role reviewer|harness\.stages/);
  });
});
