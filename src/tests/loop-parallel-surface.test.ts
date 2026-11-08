import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = () => read("skills", "implement", "SKILL.md");
const reference = (name: string) => read("skills", "implement", "references", name);
const developerAgent = () => read("agents", "developer.md");

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

  // Moved into `kf next` (src/workflow/next/); its behaviour is pinned in the next-*.test.ts unit tests.
  it("leaves the live cap and the dispatch conditions to kf next", () => {
    const loop = paragraphWith(taskLoop(), "**The loop runs on `kf next`.**");
    expect(loop).toContain("the live developer cap");
    expect(loop).toContain("task order and overlaps");
    expect(loop).toContain("the session never re-derives them");
  });


  it("writes both wait lines verbatim in the loop reference", () => {
    const text = reference("task-loop.md");
    expect(text).toContain("TASK-NNN: developer waits — Files overlap <mine> / <theirs> (TASK-MMM)");
    expect(text).toContain("TASK-NNN: developer waits — <N> developers in flight");
  });

  it("no longer states the one-developer, two-task window or head-first rules anywhere", () => {
    const OLD = [
      "one developer seat in flight per worktree",
      "at most two tasks in flight",
      "no seat of a later task is dispatched until H is complete",
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(md|html|json)$/.test(entry.name)) files.push(full);
      }
    };
    walk(join(PKG_ROOT, "skills"));
    walk(join(PKG_ROOT, "docs", "workflow"));
    files.push(join(PKG_ROOT, "README.md"), join(PKG_ROOT, ".github", "pages", "index.html"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const phrase of OLD) expect(text, `${file}: ${phrase}`).not.toContain(phrase);
    }
  });

  it("writes the cap wait line for a fix round held by the cap and no longer ledgers a queued fix", () => {
    const fixRound = paragraphWith(reference("task-loop.md"), "developer waits — <N> developers in flight` instead");
    expect(fixRound).toMatch(/fix round held by the cap/i);
    expect(implement()).not.toContain("TASK-H: fix queued — developer TASK-M in flight");
    expect(reference("task-loop.md")).not.toContain("TASK-H: fix queued — developer TASK-M in flight");
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

  it("tells the developer the build setup's exit-2 warning is expected and kf verify with the commit list is authoritative", () => {
    for (const [name, text] of [
      ["developer.md step 6", developerStep(6)],
      ["developer-brief.md", reference("developer-brief.md")],
    ] as const) {
      expect(text, name).toMatch(/exit 2[^.\n]*expected|expected[^.\n]*exit 2/);
      expect(text, name).toMatch(/kf verify --task[^\n]*--commits/);
    }
  });

  it("tells the test-writer its failing run is advisory while a developer is in flight", () => {
    expect(reference("test-writer-brief.md")).toContain("advisory while a developer is in flight");
  });

  it("keeps a test-writer's run advisory while a developer is in flight and out of another open task's Files", () => {
    expect(paragraphWith(taskLoop(), "A test-writer's runs are advisory")).toContain("advisory while any developer is in flight");
    const brief = reference("test-writer-brief.md");
    expect(brief).toContain("another open task's Files");
    expect(brief).toContain("advisory while a developer is in flight");
  });
});

describe("dispatching tasks in parallel, gated on overlaps", () => {


  it("takes the fails-for-the-right-reason judgement from the developer's step-3 run when the test-writer's run was advisory", () => {
    const line = lineWith(taskLoop(), "step-3 run");
    expect(line).toContain("fails for the right reason");
    expect(line).toContain("advisory");
  });

  it("ledgers same-wave test-writers as parallel, sequential or with unknown Files", () => {
    const loop = reference("task-loop.md");
    expect(loop).toContain("wave <w>: parallel test-writers TASK-A, TASK-B — disjoint Files");
    expect(loop).toContain("wave <w>: sequential TASK-A, TASK-B — Files overlap <entry> / <entry>");
    expect(loop).toContain("— Files unknown");
  });

  it("tells both reviewers that only the package is graded and other working-tree edits are context", () => {
    for (const name of ["task-reviewer-brief.md", "re-review-brief.md"]) {
      const brief = reference(name);
      expect(brief, name).toContain("the working tree may hold other tasks' uncommitted edits");
      expect(brief, name).not.toContain("another task's uncommitted edits");
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

describe("the cascade re-review of a dependent task", () => {
  it("puts the fixed dependency's diff in the brief of a cascade re-review kf next names", () => {
    const fixLoop = section("\n### 3.4", "\n### 3.5");
    const cascade = paragraphWith(fixLoop, "**A cascade re-review.**");
    expect(cascade).toContain("cascade=<sha7>");
    expect(cascade).toContain("`[CASCADE_FIX_DIFF]`");
    expect(fixLoop).not.toContain("No file check decides it: every such fix triggers it");
    expect(reference("task-loop.md")).toContain("TASK-NNN: cascade re-review owed — after <sha7> of TASK-MMM @ <ts>");
  });

  it("names the stage gate's full build and suite as the backstop for coupling the plan did not declare", () => {
    const backstop = paragraphWith(implement(), "backstop");
    expect(backstop).toMatch(/stage gate/i);
    expect(backstop).toMatch(/build/);
    expect(backstop).toMatch(/suite/);
  });

  it("gives the re-review brief a slot for the head's fix diff", () => {
    const brief = reference("re-review-brief.md");
    const prompt = slice(brief, "```", "\n```\n");
    expect(prompt).toContain("[CASCADE_FIX_DIFF]");
    const entry = brief.split("\n").find((l) => l.startsWith("- `[CASCADE_FIX_DIFF]`"));
    expect(entry, "placeholder entry").toBeDefined();
    expect(entry).toMatch(/none/i);
  });

  it("completes a task when kf next says so, in any order, with no plan-order barrier", () => {
    const complete = section("\n### 3.5", "\n**No subagent tool");
    const check = paragraphWith(complete, "once the ledger earns it");
    expect(check).toContain("`kf next` prints `complete TASK-NNN`");
    expect(check).toContain("no plan-order barrier");
    expect(check).toContain("any order");
    expect(check).toContain("review clean");
    expect(check).toContain("parked");
    expect(check).not.toContain("H is complete when");
  });
});

describe("controller work while a seat runs", () => {
  it("ledgers the concurrent steps and forbids waiting idle on a seat", () => {
    const loop = taskLoop();
    expect(loop).toContain("brief written");
    expect(loop).toContain("review package");
    expect(loop).toContain("Never wait idle on a seat while one of these steps is pending");
  });

  it("runs the five-item work list in order every turn", () => {
    const list = paragraphWith(taskLoop(), "dispatch every ready seat").toLowerCase();
    const order = [
      "dispatch every ready seat",
      "newly committed",
      "brief of the next task",
      "scouts a later task needs",
      "owed",
    ].map((phrase) => list.indexOf(phrase));
    order.forEach((at, i) => expect(at, `item ${i + 1}`).toBeGreaterThanOrEqual(0));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("runs verify, the full suite and the build in the background and ends the turn only when a seat or command still runs", () => {
    const list = paragraphWith(taskLoop(), "dispatch every ready seat");
    expect(list).toMatch(/background/);
    expect(list).toContain("`kf verify`");
    expect(list).toMatch(/full suite/);
    expect(list).toMatch(/build/);
    expect(taskLoop()).toContain("end the turn only when no item applies and a seat or background command is running");
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

describe("committing by path through the commit script", () => {
  const FORBIDDEN = [
    "checkout",
    "switch",
    "reset",
    "restore --staged",
    "stash",
    "rebase",
    "merge",
    "cherry-pick",
    "commit` without a pathspec",
    "commit -a",
    "add -A",
    "add .",
    "clean",
    "GIT_INDEX_FILE",
  ];

  it("has the developer commit through commit-task.mjs with one --allow per entry and report exit 4 or 5 as BLOCKED, fix rounds included", () => {
    for (const [name, text] of [
      ["developer.md step 7", developerStep(7)],
      ["developer-brief.md", reference("developer-brief.md")],
    ] as const) {
      expect(text, name).toContain("node [COMMIT_SCRIPT]");
      expect(text, name).toContain("--allow");
      expect(text, name).toContain("[FILES]");
      expect(text, name).toContain("[TEST_FILES]");
      expect(text, name).toContain("[SPEC_FILES]");
      expect(lineWith(text, "exit 4 or 5"), name).toContain("BLOCKED");
      expect(text, name).toContain("fix rounds");
      expect(text, name).not.toContain("git diff --cached --name-only");
    }
  });

  it("lists the allowed git commands and names each forbidden one", () => {
    for (const [name, text] of [
      ["developer.md", developerAgent()],
      ["developer-brief.md", reference("developer-brief.md")],
    ] as const) {
      expect(text, name).toContain("git add -- <paths>");
      expect(text, name).toContain("git commit -m <msg> -- <paths>");
      for (const command of FORBIDDEN) expect(text, `${name}: ${command}`).toContain(command);
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
    expect(paragraphWith(dispatch, "**Dispatch** `Agent(kf:developer)`")).toContain("[IN_FLIGHT]");
  });
});

describe("early-passing tests under an advisory test-writer run", () => {
  it("stops with NEEDS_CONTEXT on an advisory test-writer run that the developer's run contradicts", () => {
    const step5 = section("\n5. **Check that each test fails for the right reason**", "\n### 3.2");
    const line = lineWith(step5, "advisory");
    expect(line).toMatch(/stops with `?NEEDS_CONTEXT`?/);
    expect(developerStep(3)).toMatch(/stops with `?NEEDS_CONTEXT`?/);
  });
});

describe("binding phrases of the parallel loop", () => {
  it("treats any non-zero exit of a developer's commit as BLOCKED in the developer agent and brief", () => {
    expect(developerAgent()).toContain("any non-zero exit");
    expect(reference("developer-brief.md")).toContain("any non-zero exit");
  });


  it("keeps the reason freed seats go to fix rounds first", () => {
    expect(reference("task-loop.md")).toContain("Freed seats go to fix rounds first because finishing a task closes it sooner than starting another");
  });

  it("has the controller re-run the handed tests", () => {
    expect(implement()).toContain("re-runs the handed tests");
  });

  // A test-writer once left a backgrounded run alive for ~29 minutes after reporting.
  it("forbids a seat from starting a background command in both briefs and the developer agent", () => {
    for (const [name, text] of [
      ["developer-brief.md", reference("developer-brief.md")],
      ["test-writer-brief.md", reference("test-writer-brief.md")],
      ["developer.md", developerAgent()],
    ] as const) {
      expect(text, name).toContain("never start a background command");
    }
  });
});

describe("committing a task whose Files are unknown, and the commit script's exit codes", () => {
  const dotAllow = /--allow `?\.`?(?![\w./-])/;

  it("tells the controller a task with unknown Files is committed with --allow .", () => {
    expect(implement()).toMatch(dotAllow);
  });

  it("tells the developer a task with unknown Files is committed with --allow .", () => {
    expect(reference("developer-brief.md")).toMatch(dotAllow);
    expect(developerStep(7)).toMatch(dotAllow);
  });

  // The script has no dist-build exit, so listing one misleads a developer reading the exit codes.
  it("does not list a missing dist build among the commit script's exit codes", () => {
    expect(reference("developer-brief.md")).not.toContain("no dist build");
    expect(developerAgent()).not.toContain("no dist build");
  });

  it("tells the developer to run the commit script from the repository root", () => {
    expect(reference("developer-brief.md")).toContain("repository root");
    expect(developerAgent()).toContain("repository root");
  });
});

describe("a commit that was made but whose sha could not be read, and the full-suite rule", () => {
  const COMMIT_MADE =
    "When the output says `commit made`, the commit exists: report `BLOCKED` quoting it with the sha from `git log -1 -- <paths>`, and never commit those paths again.";
  const FULL_SUITE =
    "Run the full suite only when Seats in flight is `none` and `git status --porcelain` lists no path outside your own files; otherwise run focused tests only.";

  // The script no longer compares subjects, so exit 4 never means an unconfirmed sha.
  it("does not list an unconfirmed commit sha among the commit script's exit-4 causes", () => {
    expect(reference("developer-brief.md")).not.toContain("a commit sha it could not confirm");
    expect(developerAgent()).not.toContain("a commit sha it could not confirm");
  });

  it("lists a path that is . or a directory among the exit-4 causes", () => {
    for (const [name, text] of [
      ["developer-brief.md", reference("developer-brief.md")],
      ["developer.md", developerAgent()],
    ] as const) {
      expect(lineWith(text, "exit 4 or 5"), name).toContain("a path that is `.` or a directory");
    }
  });

  it("tells the developer that after `commit made` the commit exists and must not be repeated", () => {
    expect(reference("developer-brief.md")).toContain(COMMIT_MADE);
    expect(developerAgent()).toContain(COMMIT_MADE);
  });

  it("tells the developer and the controller to name each changed file, never . or a directory", () => {
    expect(reference("developer-brief.md")).toContain("name each file you changed, never `.` or a directory");
    expect(implement()).toContain("name each file you changed, never `.` or a directory");
  });

  it("limits the full suite to a developer with no seat in flight and no foreign path in the working tree", () => {
    expect(reference("developer-brief.md")).toContain(FULL_SUITE);
    expect(developerStep(6)).toContain(FULL_SUITE);
  });

  it("has the controller fill the seats-in-flight slot with every seat dispatched in the same turn", () => {
    expect(implement()).toContain("fill `[IN_FLIGHT]` with every seat dispatched in the same turn");
    const entry = reference("developer-brief.md")
      .split("\n")
      .find((l) => l.startsWith("- `[IN_FLIGHT]`"));
    expect(entry, "placeholder entry").toBeDefined();
    expect(entry).toContain("every other seat in flight at dispatch, including the seats dispatched in the same turn");
  });
});

describe("the commit script's path is filled at dispatch, and a commit that was made is routed", () => {
  const OLD_INVOCATION = "node <skills dir>/";
  const PLACEHOLDER_ENTRY =
    "- `[COMMIT_SCRIPT]` — the absolute path of `${CLAUDE_PLUGIN_ROOT}/skills/implement/scripts/commit-task.mjs`, filled at dispatch.";
  const BLOCKED_ROUTE =
    "A BLOCKED that quotes `commit made` names a commit that exists: add its sha to the task's commit list and continue as for DONE, never a re-commit.";
  const NO_COMMIT_EXCEPTION = "no commit unless the output says `commit made`";

  // The prompt is pasted verbatim, so a `<skills dir>` left in it reaches the developer unresolved.
  it("has the developer prompt and step 7 invoke the commit script by the filled placeholder", () => {
    const brief = reference("developer-brief.md");
    expect(slice(brief, "```", "\n```\n")).toContain("node [COMMIT_SCRIPT]");
    expect(developerStep(7)).toContain("node [COMMIT_SCRIPT]");
  });

  it("does not leave the unresolved skills-dir invocation in the developer brief or the developer agent", () => {
    expect(reference("developer-brief.md")).not.toContain(OLD_INVOCATION);
    expect(developerAgent()).not.toContain(OLD_INVOCATION);
  });

  it("lists the commit script placeholder among the developer brief's placeholders", () => {
    expect(reference("developer-brief.md").split("\n")).toContain(PLACEHOLDER_ENTRY);
  });

  it("has the controller fill the commit script placeholder at the developer dispatch", () => {
    const dispatch = section("\n### 3.2", "\n### 3.3");
    expect(dispatch).toContain(
      "and `[COMMIT_SCRIPT]` with the absolute path of `scripts/commit-task.mjs`",
    );
  });

  it("routes a BLOCKED that quotes `commit made` as a commit that exists", () => {
    const dispatch = section("\n### 3.2", "\n### 3.3");
    const start = dispatch.indexOf("- **BLOCKED**");
    expect(start, "BLOCKED bullet").toBeGreaterThanOrEqual(0);
    const next = dispatch.indexOf("\n- **", start + 1);
    const bullet = dispatch.slice(start, next === -1 ? undefined : next);
    expect(bullet).toContain(BLOCKED_ROUTE);
  });

  it("states that a non-zero exit means no commit unless the output says `commit made`", () => {
    expect(lineWith(reference("developer-brief.md"), "On any non-zero exit")).toContain(NO_COMMIT_EXCEPTION);
    expect(lineWith(developerAgent(), "On any non-zero exit")).toContain(NO_COMMIT_EXCEPTION);
  });
});
