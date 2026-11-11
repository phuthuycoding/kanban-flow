import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const normalise = (text: string) => text.replace(/\s+/g, " ");
const read = (...parts: string[]) => normalise(readFileSync(join(PKG_ROOT, ...parts), "utf8"));
const testSkill = () => read("skills", "test", "SKILL.md");
const template = () => read("kanban-flow", "templates", "phase-4-testing-result.md");
const agent = () => read("agents", "automation-writer.md");
const brief = () => read("skills", "implement", "references", "automation-writer-brief.md");
const harness = () => read("docs", "workflow", "harness.md");

/** The text between a heading that starts with `from` and the next heading that starts with `to`. */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  return end > start ? text.slice(start, end) : text.slice(start);
}

describe("kf:test reads the stage record instead of re-running the suite", () => {
  it("reads kf status and requires the Stage verify line to be PASS at HEAD", () => {
    const text = testSkill();
    expect(text).toContain("kf status --change {feature_name}");
    expect(text).toMatch(/`Stage verify:`[^.]*PASS[^.]*HEAD/);
  });

  it("gives BLOCKED naming kf verify --stage when the stage record is not PASS at HEAD", () => {
    const text = testSkill();
    expect(text).toMatch(/BLOCKED[^.]*`kf verify <f> --stage`/);
    expect(text).toContain("`harness.verify.stage`");
  });

  it("no longer has kf:test run the stage verify itself", () => {
    expect(testSkill()).not.toContain("only when `kf status` does not show PASS at HEAD");
  });

  it("dispatches no automation-writer and names no testing-stage brief", () => {
    const text = testSkill();
    expect(text).not.toContain("Agent(kf:automation-writer)");
    expect(text).not.toContain("testing-e2e-brief");
    expect(text).not.toContain("testing-e2e-report");
  });

  it("states that testing commits nothing because a commit would move HEAD past the stage record", () => {
    const text = testSkill();
    expect(text).toMatch(/commits? nothing/i);
    expect(text).toMatch(/move HEAD past the stage record/);
    expect(text).not.toContain("controller commits the automation-writer");
  });

  it("keeps the stage record as the gate into review and the kf verify --stage command", () => {
    const text = testSkill();
    expect(text).toContain("the stage record is the gate into review");
    expect(text).toContain("`kf verify <f> --stage`");
  });

  it("keeps the worktree switch rule", () => {
    const text = testSkill();
    expect(text).toContain("`Worktree:` with `Domain:` or `Direct:`");
    expect(text).toContain("When `worktree.domains` is `false` in `.kf/config.json`");
  });
});

describe("kf:test with no stage commands configured", () => {
  const exception = () => {
    const paragraph = testSkill().split(/(?<=\.) (?=[A-Z*])/).filter((s) => s.includes("not configured"));
    expect(paragraph.length).toBeGreaterThan(0);
    return paragraph.join(" ");
  };

  it("names the not configured and waived lines for an unpinned harness.verify.stage", () => {
    const text = exception();
    expect(text).toContain("`not configured — …`");
    expect(text).toContain("`waived — …`");
    expect(text).toContain("harness.verify.stage");
  });

  it("runs the project's test command once with coverage and uses that run for the TC mapping and coverage", () => {
    const text = testSkill();
    expect(text).toMatch(/runs? the project's test command once[^.]*coverage/i);
    expect(text).toMatch(/that run serves the TC mapping and (the )?coverage/i);
  });

  it("does not report BLOCKED for the not configured line", () => {
    expect(exception()).not.toMatch(/(gives|is|reports?|→|then)\s*`?BLOCKED/i);
  });
});

describe("kf:test maps every test case to a named test", () => {
  it("asks each TC row for the test file and test name and cites the stage record", () => {
    const text = testSkill();
    expect(text).toMatch(/names? the test file and (the )?test name/);
    expect(text).toMatch(/cites? the stage record/);
  });

  it("fails a TC with no test or only a skipped test, naming the TC and its owning task", () => {
    const text = testSkill();
    for (const marker of [".skip", ".todo", "xit"]) expect(text).toContain(marker);
    expect(text).toMatch(/no test or only a skipped test[^.]*`?FAIL`?[^.]*naming the TC and (the )?owning task/);
  });

  it("fails an approved UI or E2E TC that has no spec and routes it to its owning task", () => {
    expect(testSkill()).toMatch(/approved UI\/E2E TC with no spec[^.]*`?FAIL`?[^.]*owning task/);
  });

  it("asks the template for the test file and test name in the evidence", () => {
    const text = template();
    expect(text).toMatch(/test file/i);
    expect(text).toMatch(/test name/i);
    expect(slice(text, "## Test Results", "## Commands")).toMatch(/test file and (the )?test name/i);
  });
});

describe("kf:test behaviour run", () => {
  it("keeps the unverified ledger line and the Behaviour run heading", () => {
    const text = testSkill();
    expect(text).toContain("`TASK-NNN: unverified — <claim>`");
    expect(text).toContain("## Behaviour run");
  });

  it("allows none with a reason and still passes", () => {
    const text = testSkill();
    expect(text).toMatch(/`none — <why>`/);
    expect(text).toMatch(/`none — <why>`[^.]*PASS|PASS[^.]*`none — <why>`/);
  });

  it("gives the template a Behaviour run section", () => {
    expect(template()).toContain("## Behaviour run");
  });
});

describe("kf:test coverage", () => {
  it("runs coverage once, scoped to the changed source files from git diff, as line percent per file", () => {
    const text = testSkill();
    expect(text).toContain("git diff --name-only <BASE>..HEAD");
    expect(text).toContain("npx vitest related <files> --run --coverage --coverage.include=<file>...");
    expect(text).toMatch(/line (coverage|%|percent)[^.]*per file|per file[^.]*line/i);
  });

  it("fails below target naming files, blocks an unmeasurable required target, and skips the run with a reason otherwise", () => {
    const text = testSkill();
    expect(text).toMatch(/below (the )?target[^.]*`?FAIL`?/i);
    expect(text).toMatch(/unmeasurable[^.]*`?BLOCKED`?|`?BLOCKED`?[^.]*unmeasurable/i);
    expect(text).toMatch(/no target[^.]*no run|no run[^.]*no target/i);
    expect(text).toMatch(/no changed source files[^.]*no run|no run[^.]*no changed source files/i);
  });

  it("gives the template per-file coverage rows with target, line percent and the command", () => {
    const text = template();
    expect(slice(text, "## Coverage", "## Regression")).toContain("| File | Target | Line % | Command |");
  });
});

describe("kf:test statuses and the fix rule", () => {
  it("offers PASS, FAIL and BLOCKED and no REJECT", () => {
    const text = testSkill();
    expect(text).toContain("`PASS`");
    expect(text).toContain("`FAIL`");
    expect(text).toContain("`BLOCKED`");
    expect(text).not.toMatch(/`REJECT`|FAIL\/REJECT|PASS\/FAIL\/REJECT/);
  });

  it("drops REJECT from the template status options and the Rejected summary row", () => {
    const text = template();
    expect(text).not.toContain("| Rejected |");
    expect(text).not.toMatch(/REJECT/);
  });

  it("states the one fix rule through Repairing after the loop and drops the one-fix-cycle stop", () => {
    const text = testSkill();
    expect(text).toContain("Repairing after the loop");
    expect(text).not.toContain("one fix cycle");
    expect(text).toMatch(/testing FAIL|review FAIL|red CI/);
  });

  it("lists the seven stop reasons word for word", () => {
    const text = testSkill();
    for (const reason of [
      "an irreversible or destructive operation",
      "a security-sensitive action",
      "a side effect outside this worktree (merge, push to a shared branch, publish, a database write)",
      "a reopened task at its round cap, apart from the one minimal fix past the cap (3.4)",
      "a plan too broken to act on",
      "a review `REQUIREMENT_BUG`",
      "a testing `BLOCKED`",
    ]) {
      expect(text, reason).toContain(reason);
    }
  });
});

describe("kf:test keeps a behaviour run from standing in for a missing test", () => {
  it("no longer lets a behaviour run satisfy the PASS rule for any approved test case", () => {
    const text = testSkill();
    expect(text).not.toContain("a passing test or a behaviour run");
  });

  it("maps an automated test case to a passing test and a manual one to a behaviour run, never replacing a missing test", () => {
    const text = testSkill();
    expect(text).toMatch(/every automated TC[^.;]*passing test/i);
    expect(text).toMatch(/every manual TC[^.;]*behaviour run/i);
    expect(text).toMatch(/behaviour run never replaces a missing test/i);
  });
});

describe("kf:test asks the human for the waiver when no stage commands are pinned", () => {
  it("records the waiver only on the human's word and asks for it before kf stage review", () => {
    const text = testSkill();
    expect(text).toContain("kf verify <f> --stage --waive");
    expect(text).toMatch(/only on the human's word/);
    expect(text).toMatch(/ask(s|ed)? (the human )?for (it|the waiver)[^.]*before `kf stage <f> review`|before `kf stage <f> review`[^.]*ask/i);
  });

  it("repeats the waiver ask in the Done hand-off", () => {
    const done = slice(testSkill(), "## Done", "\u0000end");
    expect(done).toMatch(/waive/i);
  });

  it("keeps the What stops you list unchanged at seven reasons", () => {
    const stops = slice(testSkill(), "**What stops you.**", "## Done");
    expect(stops).toContain("a plan too broken to act on");
    expect(stops).toContain("a review `REQUIREMENT_BUG`");
    expect(stops).toContain("a testing `BLOCKED`");
    expect(stops).not.toMatch(/waiver|waive/i);
  });
});

describe("the docs and the feature report follow the slimmer testing stage", () => {
  const featureReport = () => read("kanban-flow", "templates", "phase-6-feature-report.md");

  it("no longer says /kf:test runs the stage verify after the last commit of testing", () => {
    const text = harness();
    expect(text).not.toMatch(/`\/kf:test` runs `--stage`/);
    expect(text).not.toContain("again after the last commit of testing");
  });

  it("asks the feature report for per-file line coverage or none with a reason, not one overall figure", () => {
    const text = featureReport();
    expect(text).not.toContain("{overall_coverage}");
    const row = text.split("|").map((s) => s.trim());
    const coverage = text.match(/\| Coverage \|[^|]*\|/)?.[0] ?? "";
    expect(row).toContain("Coverage");
    expect(coverage).toMatch(/line (coverage|%)[^|]*(per|changed)|per (changed )?file|none — /i);
  });
});

describe("only kf:implement dispatches the automation-writer", () => {
  it("has the agent and its brief name no testing-stage dispatch, brief, report or commit", () => {
    for (const text of [agent(), brief()]) {
      expect(text).not.toContain("testing-e2e-brief");
      expect(text).not.toContain("testing-e2e-report");
      expect(text).not.toContain("at the testing stage");
      expect(text).not.toContain("kf:test section 2");
      expect(text).not.toContain("the in-session testing controller commits");
    }
    expect(agent()).not.toMatch(/\*\*`kf:test`\*\*/);
    expect(agent()).not.toMatch(/by kf:test/);
  });

  it("names kf:implement as the dispatcher", () => {
    expect(agent()).toMatch(/\*\*`kf:implement`\*\*/);
    expect(brief()).toContain("from the task loop");
  });

  it("states in harness.md that specs are committed in the task loop only and testing commits nothing", () => {
    const text = harness();
    const row = text.split("| ").find((cell) => cell.startsWith("`automation-writer`")) ?? "";
    expect(text).toMatch(/\| `automation-writer` \| `\/kf:implement`[^|]*\|/);
    expect(text).not.toMatch(/\| `automation-writer` \|[^|]*`\/kf:test`/);
    expect(text).not.toContain("by the in-session controller at the testing stage");
    expect(row).toContain("`automation-writer`");
    expect(text).toMatch(/testing commits nothing/i);
  });
});
