import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = () => read("skills", "kanban-implement", "SKILL.md");
const reference = (name: string) => read("skills", "kanban-implement", "references", name);
const developerAgent = () => read("skills", "kanban-flow", "agents", "developer.md");

/** The text between the first `from` and the next `to` after it. */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
}

const taskLoop = () => slice(implement(), "\n## 3.", "\n## 4.");
const section = (from: string, to: string) => slice(taskLoop(), from, to);
const developerStep = (n: number) => slice(developerAgent(), `\n${n}. `, n === 7 ? "\n## " : `\n${n + 1}. `);

/** Blank-line-delimited blocks, so a pinned pair of phrases must share one paragraph. */
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
const count = (text: string, phrase: string) => text.split(phrase).length - 1;

describe("the parallel task loop window", () => {
  it("drops the old rule that forbade two tasks in flight", () => {
    const OLD = "never two tasks in flight in the same git history";
    expect(implement()).not.toContain(OLD);
    expect(reference("task-loop.md")).not.toContain(OLD);
  });

  it("allows one developer seat per worktree and at most the head and the next task in flight", () => {
    const loop = taskLoop();
    expect(loop).toContain("one developer seat in flight per worktree");
    expect(loop).toContain("at most two tasks in flight — the head task H and the next task X");
    expect(loop).toContain("no seat of a later task is dispatched until H is complete");
  });

  it("queues a head fix round while the next task's developer runs and ledgers it", () => {
    expect(taskLoop()).toContain("TASK-H: fix queued — developer TASK-M in flight");
  });

  it("makes a developer's own runs advisory while another seat is in flight", () => {
    const loop = taskLoop();
    expect(loop).toContain("advisory");
    expect(loop).toContain("no full suite");
    expect(loop).toContain("not mine: <file>");
  });

  it("tells the developer to skip the full suite and name foreign failures while another seat is in flight", () => {
    for (const [name, text] of [
      ["developer.md step 6", developerStep(6)],
      ["developer-brief.md", reference("developer-brief.md")],
    ] as const) {
      expect(text, name).toContain("no full suite while another seat is in flight");
      expect(text, name).toContain("not mine: <file>");
    }
  });

  it("tells the test-writer its failing run is advisory while a developer is in flight", () => {
    expect(reference("test-writer-brief.md")).toContain("advisory while a developer is in flight");
  });
});

describe("pipelining the head and the next task", () => {
  it("gates pipelining on the overlaps list of kf tasks --json", () => {
    const gate = paragraphWith(taskLoop(), "kf tasks <f> --json");
    expect(gate).toContain("overlaps");
  });

  it("dispatches the next task's test-writer at the head developer's start", () => {
    expect(taskLoop()).toContain("test-writer X is dispatched when developer H starts");
  });

  it("dispatches the next task's developer at the head's last task commit, the spec commit included", () => {
    const paragraph = paragraphWith(taskLoop(), "developer X is dispatched when H's last task commit lands");
    expect(paragraph).toContain("spec commit");
  });

  it("makes the next developer wait and ledgers the overlapping entries when Files overlap", () => {
    expect(taskLoop()).toContain("TASK-X: developer waits — Files overlap <entry of X> / <entry of H>");
  });

  it("takes the fails-for-the-right-reason judgement from the developer's step-3 run when the test-writer's run was advisory", () => {
    const line = lineWith(taskLoop(), "step-3 run");
    expect(line).toContain("fails for the right reason");
    expect(line).toContain("advisory");
  });

  it("ledgers same-wave test-writers as parallel, sequential or with unknown Files", () => {
    const loop = taskLoop();
    expect(loop).toContain("wave <w>: parallel test-writers TASK-A, TASK-B — disjoint Files");
    expect(loop).toContain("wave <w>: sequential TASK-A, TASK-B — Files overlap <entry> / <entry>");
    expect(loop).toContain("— Files unknown");
  });

  it("tells both reviewers that only the package is graded and other working-tree edits are context", () => {
    for (const name of ["task-reviewer-brief.md", "re-review-brief.md"]) {
      const brief = reference(name);
      expect(brief, name).toContain("the working tree may hold another task's uncommitted edits");
      expect(brief, name).toContain("only the package is graded");
      expect(brief, name).toContain("context only");
    }
  });
});

describe("loop calls by commit list", () => {
  it("runs kf verify and review-package with the commit list form", () => {
    const skill = implement();
    expect(skill).toContain("kf verify <f> --task TASK-### --commits <sha>[,<sha>…]");
    expect(skill).toContain("review-package --commits <sha>[,<sha>…]");
    expect(skill).not.toContain('review-package "$BASE" HEAD');
  });

  it("names --base only once, as the single-task form", () => {
    const skill = implement();
    expect(count(skill, "--base <BASE>")).toBe(1);
    expect(lineWith(skill, "--base <BASE>")).toMatch(/single-task|one task in flight/i);
  });
});

describe("the cascade re-review of the next task", () => {
  it("owes the next task a cascade re-review for every head fix and answers it by sha", () => {
    const fixLoop = section("\n### 3.4", "\n### 3.5");
    expect(fixLoop).toContain("TASK-X: cascade re-review owed — after <sha7> of TASK-H");
    expect(fixLoop).toContain("TASK-X: code-reviewer dispatched model=<m> round=<R> cascade=<sha7>");
    expect(fixLoop).toContain("X is never marked complete before H is complete or while a cascade line of X is unanswered");
  });

  it("gives the re-review brief a slot for the head's fix diff", () => {
    const brief = reference("re-review-brief.md");
    const prompt = slice(brief, "```", "\n```\n");
    expect(prompt).toContain("[CASCADE_FIX_DIFF]");
    const entry = brief.split("\n").find((l) => l.startsWith("- `[CASCADE_FIX_DIFF]`"));
    expect(entry, "placeholder entry").toBeDefined();
    expect(entry).toMatch(/none/i);
  });

  it("writes out the head's completion check with its four conditions", () => {
    const loop = taskLoop();
    const at = loop.indexOf("\n### 3.5");
    expect(at, "### 3.5").toBeGreaterThanOrEqual(0);
    const complete = loop.slice(at);
    const start = complete.indexOf("H is complete when");
    expect(start, "H is complete when").toBeGreaterThanOrEqual(0);
    const check = paragraphs(complete.slice(start))[0];
    expect(check).toMatch(/developer[^\n]*(done|DONE)/);
    expect(check).toContain("exit=0");
    expect(check).toMatch(/routed to X/);
    expect(check).toMatch(/X's next verify passed/);
    expect(check).toContain("clean");
    expect(check).toContain("parked");
    expect(check).toContain("five-round cap");
    expect(check).toMatch(/cascade[^\n]*unanswered|unanswered[^\n]*cascade/);
  });
});

describe("controller work while a seat runs", () => {
  it("ledgers the concurrent steps and forbids waiting idle on a seat", () => {
    const loop = taskLoop();
    expect(loop).toContain("brief written");
    expect(loop).toContain("review package");
    expect(loop).toContain("Never wait idle on a seat while one of these steps is pending");
  });
});

describe("verify beside the review", () => {
  it("builds the package, then starts verify and the code-reviewer before verify is done", () => {
    const dispatch = section("\n### 3.2", "\n### 3.3");
    const pkg = dispatch.indexOf("review-package --commits");
    const started = dispatch.indexOf("verify started");
    const reviewer = dispatch.indexOf("code-reviewer dispatched");
    const done = dispatch.indexOf("verify done exit=<n>");
    expect(pkg, "review-package --commits").toBeGreaterThanOrEqual(0);
    expect(started, "verify started").toBeGreaterThan(pkg);
    expect(reviewer, "code-reviewer dispatched").toBeGreaterThanOrEqual(0);
    expect(done, "verify done exit=<n>").toBeGreaterThan(started);
    expect(done).toBeGreaterThan(reviewer);
  });

  it("decides a verify failure in the other task's Files by evidence", () => {
    const loop = taskLoop();
    expect(loop).toContain("wait for X's running verify");
    expect(loop).toContain("stays with H");
    expect(loop).toContain("Ruling:");
    expect(loop).toContain("H stays unverified until X's next verify passes");
    expect(lineWith(loop, "returns it to H as a fix round")).toContain("BLOCKED");
    expect(lineWith(loop, "with the parked failure named")).toContain("parked");
  });

  it("lets every in-flight seat report and keeps the review result before staging back to planning", () => {
    const loop = taskLoop();
    expect(loop).toContain("every in-flight seat reports and is ledgered before `kf stage <f> planning`");
    expect(loop).toContain("the review result is kept");
  });
});

describe("staging by path", () => {
  it("has the developer stage by path, check the staged list and stop on a stray path, fix rounds included", () => {
    for (const [name, text] of [
      ["developer.md step 7", developerStep(7)],
      ["developer-brief.md", reference("developer-brief.md")],
    ] as const) {
      expect(text, name).toContain("Stage by path");
      expect(text, name).toContain("git diff --cached --name-only");
      expect(lineWith(text, "git diff --cached --name-only"), name).toContain("BLOCKED");
      expect(text, name).toContain("the same rule applies to fix rounds");
    }
  });
});

describe("telling each seat what else is in flight", () => {
  it("gives the developer and test-writer prompts a seats-in-flight slot with a placeholder entry", () => {
    for (const name of ["developer-brief.md", "test-writer-brief.md"]) {
      const brief = reference(name);
      const prompt = slice(brief, "```", "\n```\n");
      expect(prompt, name).toContain("Seats in flight: [IN_FLIGHT]");
      const entry = brief.split("\n").find((l) => l.startsWith("- `[IN_FLIGHT]`"));
      expect(entry, `${name} placeholder entry`).toBeDefined();
    }
  });

  it("fills the seats-in-flight slot at the test-writer and the developer dispatch", () => {
    const brief = section("\n### 3.1", "\n### 3.2");
    expect(lineWith(brief, "4. **Dispatch**")).toContain("[IN_FLIGHT]");
    const dispatch = section("\n### 3.2", "\n### 3.3");
    expect(paragraphWith(dispatch, "**Dispatch** `Agent(developer)`")).toContain("[IN_FLIGHT]");
  });
});

describe("the next task's completion and early-passing tests", () => {
  it("holds the next task's completion on the head's completion in the completion check", () => {
    const loop = taskLoop();
    const at = loop.indexOf("\n### 3.5");
    expect(at, "### 3.5").toBeGreaterThanOrEqual(0);
    expect(paragraphWith(loop.slice(at), "H is complete when")).toContain("and, for X, H is complete");
  });

  it("stops with NEEDS_CONTEXT on an advisory test-writer run that the developer's run contradicts", () => {
    const step5 = section("\n5. **Check that each test fails for the right reason**", "\n### 3.2");
    const line = lineWith(step5, "advisory");
    expect(line).toMatch(/stops with `?NEEDS_CONTEXT`?/);
    expect(developerStep(3)).toMatch(/stops with `?NEEDS_CONTEXT`?/);
  });
});

describe("the one-developer rule covers every developer seat", () => {
  it("counts the developer resumed for specs or fixed tests as a developer seat", () => {
    expect(paragraphWith(taskLoop(), "one developer seat in flight per worktree")).toMatch(/spec[^\n]*fixed[ -]tests?/i);
  });

  it("keeps same-wave developers under the one-developer rule", () => {
    expect(paragraphWith(taskLoop(), "wave <w>: parallel test-writers")).toMatch(/one-developer rule/i);
  });
});
