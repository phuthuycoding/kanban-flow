import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLoopInputs } from "../workflow/next/inputs.js";
import type { InputsRead, LoopInputs } from "../workflow/next/types.js";
import type { Feature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

interface PlanTask {
  id: string;
  deps?: string[];
  files?: string[];
  refs?: string;
}

function plan(tasks: PlanTask[], extra = ""): string {
  const list = (v: string[] | undefined) => (v && v.length ? v.join(", ") : "-");
  const rows = tasks.map((t) => `| ${t.id} | Do ${t.id} | Core | ${list(t.deps)} | Change merged | ${t.refs ?? "FR-001"} | coder | ${list(t.files)} |`);
  return `# Implementation Plan\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n\n${extra}\n`;
}

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let root: string;
let itemDir: string;

async function putItemFile(rel: string, body: string): Promise<void> {
  const path = join(itemDir, rel);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body);
}

function featureOf(over: { kind?: "bug"; worktree?: { path: string; branch: string } } = {}): Feature {
  return {
    name: "demo",
    context: "app",
    stage: "implementation",
    dir: itemDir,
    folder: "demo_20261107_1200",
    meta: {
      schema: "kanban-flow", feature: "demo", context: "app", created: "20261107_1200",
      ...(over.kind ? { kind: over.kind } : {}),
      ...(over.worktree ? { worktree: { ...over.worktree, domain: "demo.localhost", port: 3000, createdAt: "20261107_1200" } } : {}),
    },
  };
}

function ok(res: InputsRead): LoopInputs {
  if (!res.ok) throw new Error(`expected inputs, got refusal: ${res.reason}`);
  return res.inputs;
}

function refusal(res: InputsRead): string {
  if (res.ok) throw new Error("expected a refusal, got inputs");
  return res.reason;
}

async function writeConfig(harnessExtra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261107_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" }, coder: { runner: "claude" } },
      stages: { implementation: ["coder"] },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...harnessExtra,
    },
  }));
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-next-inputs-")));
  root = join(scratch, "repo");
  itemDir = join(root, ".works", "implementation", "demo_20261107_1200");
  await mkdir(itemDir, { recursive: true });
  await writeConfig();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("readLoopInputs: feature tasks", () => {
  it("returns the plan's tasks in plan order with dependencies, files, wave and overlaps", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([
      { id: "TASK-001", files: ["src/a.ts"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/a.ts", "src/b.ts"] },
      { id: "TASK-003", files: ["src/c.ts"] },
    ]));
    const inputs = ok(readLoopInputs(root, featureOf()));
    expect(inputs.feature).toBe("demo");
    expect(inputs.kind).toBe("feature");
    expect(inputs.tasks.map((t) => [t.id, t.dependencies, t.files, t.wave, t.overlaps])).toEqual([
      ["TASK-001", [], ["src/a.ts"], 1, ["TASK-002"]],
      ["TASK-002", ["TASK-001"], ["src/a.ts", "src/b.ts"], 2, ["TASK-001"]],
      ["TASK-003", [], ["src/c.ts"], 1, []],
    ]);
  });

  it("refuses a plan with a dependency cycle with the text kf tasks prints", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([
      { id: "TASK-001", deps: ["TASK-002"] },
      { id: "TASK-002", deps: ["TASK-001"] },
    ]));
    const reason = refusal(readLoopInputs(root, featureOf()));
    expect(reason.startsWith("Task graph of 'demo' is invalid; fix the plan:")).toBe(true);
    expect(reason).toContain("ERROR task_dep_cycle:");
  });

  it("refuses a plan with a missing dependency", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001", deps: ["TASK-009"] }]));
    const reason = refusal(readLoopInputs(root, featureOf()));
    expect(reason.startsWith("Task graph of 'demo' is invalid; fix the plan:")).toBe(true);
    expect(reason).toContain("ERROR task_dep_missing:");
  });

  it("refuses a plan with no tasks", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([]));
    expect(refusal(readLoopInputs(root, featureOf()))).toContain("has no planned tasks");
  });
});

describe("readLoopInputs: inline waves", () => {
  const tasks: PlanTask[] = [
    { id: "TASK-001", files: ["src/a.ts"] },
    { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.ts"] },
  ];

  it("marks the tasks of a wave recorded as inline and no other", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(tasks, "Execution: wave 1 inline\nExecution: wave 2 parallel, 2 developers"));
    const inputs = ok(readLoopInputs(root, featureOf()));
    expect(inputs.tasks.map((t) => [t.id, t.inline])).toEqual([["TASK-001", true], ["TASK-002", false]]);
  });

  it("leaves every task parallel when the plan has no Execution line", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan(tasks));
    expect(ok(readLoopInputs(root, featureOf())).tasks.map((t) => t.inline)).toEqual([false, false]);
  });
});

describe("readLoopInputs: test types", () => {
  const tc = (id: string, fr: string, uc: string, type: string): string =>
    `## ${id}: Case\n\n| Field | Detail |\n|---|---|\n| Requirement reference | ${fr} |\n| Use case reference | ${uc} |\n| Test type | ${type} |\n\n`;

  it("collects the distinct test types of the cases a task's FR and UC references name, in fixed order", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([
      { id: "TASK-001", refs: "FR-001 / UC-001" },
      { id: "TASK-002", refs: "FR-002" },
      { id: "TASK-003", refs: "UC-003" },
      { id: "TASK-004", refs: "FR-005" },
    ]));
    await putItemFile(ARTIFACTS["test-cases"].file, [
      "# Test Cases\n\n",
      tc("TC-001", "FR-001", "UC-009", "Integration"),
      tc("TC-002", "FR-007", "UC-001", "Unit"),
      tc("TC-003", "FR-002", "UC-002", "Integration"),
      tc("TC-004", "FR-009", "UC-003", "UI / E2E"),
      tc("TC-005", "FR-001", "UC-001", "Unit"),
    ].join(""));
    const inputs = ok(readLoopInputs(root, featureOf()));
    expect(inputs.tasks.map((t) => [t.id, t.testTypes])).toEqual([
      ["TASK-001", ["Unit", "Integration"]],
      ["TASK-002", ["Integration"]],
      ["TASK-003", ["UI", "E2E"]],
      ["TASK-004", []],
    ]);
  });

  it("gives every task no test types when the plan has no test case file", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
    expect(ok(readLoopInputs(root, featureOf())).tasks[0].testTypes).toEqual([]);
  });
});

describe("readLoopInputs: test level", () => {
  it("reads the Level of a feature's Test Strategy, trimmed and lower-cased", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
    await putItemFile(ARTIFACTS["spec-requirement"].file, "# Requirement\n\n## Test Strategy\n\n- Level:  Unit+Integration \n- Tools: vitest\n");
    expect(ok(readLoopInputs(root, featureOf())).level).toBe("unit+integration");
  });

  it("reads the Test Level of a bug report", async () => {
    await putItemFile(ARTIFACTS["spec-requirement"].file, "# Bug\n\n## Test Strategy\n\n- Test Level: Unit\n- Tools: vitest\n");
    await putItemFile("tasks.md", "# Tasks\n\n- [ ] 1. TASK-001: fix it\n");
    expect(ok(readLoopInputs(root, featureOf({ kind: "bug" }))).level).toBe("unit");
  });

  it("gives null when the spec states no level", async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
    await putItemFile(ARTIFACTS["spec-requirement"].file, "# Requirement\n\nNothing about tests.\n");
    expect(ok(readLoopInputs(root, featureOf())).level).toBeNull();
  });
});

describe("readLoopInputs: bug tasks", () => {
  const BUG_TASKS = [
    "# Tasks",
    "",
    "- [ ] 1. TASK-001: Reproduce the crash",
    "- [x] 2. TASK-002: Add a regression test for the crash",
    "- [ ] 3. TASK-003: Fix the null check",
    "A prose line that is not a checkbox.",
    "",
  ].join("\n");

  it("schedules the tasks.md lines in file order with Files unknown and the regression line marked", async () => {
    await putItemFile("tasks.md", BUG_TASKS);
    const inputs = ok(readLoopInputs(root, featureOf({ kind: "bug" })));
    expect(inputs.kind).toBe("bug");
    expect(inputs.tasks).toEqual([
      { id: "TASK-001", dependencies: [], files: null, wave: 1, overlaps: ["TASK-002", "TASK-003"], inline: false, testTypes: [] },
      { id: "TASK-002", dependencies: [], files: null, wave: 1, overlaps: ["TASK-001", "TASK-003"], inline: false, testTypes: ["Unit"] },
      { id: "TASK-003", dependencies: [], files: null, wave: 1, overlaps: ["TASK-001", "TASK-002"], inline: false, testTypes: [] },
    ]);
  });

  it("refuses a tasks.md with no TASK ids and names the line to write", async () => {
    await putItemFile("tasks.md", "# Tasks\n\n- [ ] Reproduce the crash\n- [ ] Fix it\n");
    const reason = refusal(readLoopInputs(root, featureOf({ kind: "bug" })));
    expect(reason).toContain("TASK-###");
    expect(reason).toContain("- [ ] 1. TASK-001: ");
  });

  it("refuses a bug with no tasks.md", () => {
    expect(refusal(readLoopInputs(root, featureOf({ kind: "bug" })))).toContain("TASK-###");
  });
});

describe("readLoopInputs: developer ceiling", () => {
  beforeEach(async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
  });

  it("reports the default ceiling when the config sets none", () => {
    expect(ok(readLoopInputs(root, featureOf())).ceiling).toEqual({ max: 6, source: "default" });
  });

  it("reports the configured ceiling", async () => {
    await writeConfig({ developers: { max: 3 } });
    expect(ok(readLoopInputs(root, featureOf())).ceiling).toEqual({ max: 3, source: "config" });
  });

  it("refuses with the config message when harness.developers is invalid", async () => {
    await writeConfig({ developers: { max: 99 } });
    expect(refusal(readLoopInputs(root, featureOf()))).toContain("harness.developers");
  });

  it("passes an unrelated config error through as an invalid-config ceiling of 1", async () => {
    await writeFile(join(root, ".kf", "config.json"), "{ not json");
    const ceiling = ok(readLoopInputs(root, featureOf())).ceiling;
    expect(ceiling.max).toBe(1);
    expect(ceiling.source).toBe("invalid-config");
    expect(typeof ceiling.error).toBe("string");
  });
});

describe("readLoopInputs: report commits", () => {
  beforeEach(async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
  });

  it("collects the shas listed under a Commits created heading and stops at the next heading", async () => {
    await putItemFile("loop/task-001-report.md", [
      "# Report", "", "## Commits created", "", "- a1b2c3d feat: first", "* 0123456789abcdef0123456789abcdef01234567 second", "", "## Concerns", "", "- deadbee not a commit of this task", "",
    ].join("\n"));
    expect(ok(readLoopInputs(root, featureOf())).reportCommits["TASK-001"]).toEqual(["a1b2c3d", "0123456789abcdef0123456789abcdef01234567"]);
  });

  it("counts a sha on a bold label line and the bullets after it", async () => {
    await putItemFile("loop/task-002-report.md", "Status: DONE\n\n**Commits created:** a1b2c3d\n- b2c3d4e follow-up\n");
    expect(ok(readLoopInputs(root, featureOf())).reportCommits["TASK-002"]).toEqual(["a1b2c3d", "b2c3d4e"]);
  });

  it("gives an empty list for a report that says none", async () => {
    await putItemFile("loop/task-003-report.md", "## Commits created\n\nnone (docs only)\n");
    expect(ok(readLoopInputs(root, featureOf())).reportCommits["TASK-003"]).toEqual([]);
  });

  it("gives no key for a report without a Commits created label", async () => {
    await putItemFile("loop/task-004-report.md", "# Report\n\n- a1b2c3d mentioned in passing\n");
    expect(Object.keys(ok(readLoopInputs(root, featureOf())).reportCommits)).not.toContain("TASK-004");
  });

  it("collects the shas of every Commits created section in file order without duplicates", async () => {
    await putItemFile("loop/task-001-report.md", [
      "# Report", "", "## Commits created", "", "- a1b2c3d feat: first", "- b2c3d4e second", "",
      "## Concerns", "", "- deadbee not a commit", "",
      "## Fix round 1", "", "## Commits created", "", "- b2c3d4e second again", "- c3d4e5f round fix", "",
    ].join("\n"));
    expect(ok(readLoopInputs(root, featureOf())).reportCommits["TASK-001"]).toEqual(["a1b2c3d", "b2c3d4e", "c3d4e5f"]);
  });

  it("appends commits from fix-round report files after the main report, rounds ascending", async () => {
    await putItemFile("loop/task-001-report.md", "## Commits created\n\n- a1b2c3d first\n");
    await putItemFile("loop/task-001-fix-10-report.md", "## Commits created\n\n- d4e5f60 round ten\n");
    await putItemFile("loop/task-001-fix-2-report.md", "## Commits created\n\n- b2c3d4e round two\n- a1b2c3d repeated\n");
    expect(ok(readLoopInputs(root, featureOf())).reportCommits["TASK-001"]).toEqual(["a1b2c3d", "b2c3d4e", "d4e5f60"]);
  });
});

describe("readLoopInputs: verify runs", () => {
  beforeEach(async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
  });

  it("parses each verify block, oldest first, with its time, exit code and text", async () => {
    await putItemFile("loop/task-001-verify.log", [
      "## kf verify 2026-11-07T10:00:00.000Z exit=1", "  FAIL src/a.test.ts", "  EADDRINUSE 3000",
      "## kf verify 2026-11-07T10:05:00.000Z exit=0", "  all green", "",
    ].join("\n"));
    const runs = ok(readLoopInputs(root, featureOf())).verifyRuns["TASK-001"];
    expect(runs.map((r) => [r.ts, r.exit])).toEqual([
      [Date.parse("2026-11-07T10:00:00.000Z"), 1],
      [Date.parse("2026-11-07T10:05:00.000Z"), 0],
    ]);
    expect(runs[0].text).toContain("FAIL src/a.test.ts");
    expect(runs[0].text).toContain("EADDRINUSE 3000");
    expect(runs[0].text).not.toContain("all green");
    expect(runs[0].text).not.toContain("## kf verify");
    expect(runs[1].text).toContain("all green");
  });

  it("gives no key for a task without a verify log", () => {
    expect(Object.keys(ok(readLoopInputs(root, featureOf())).verifyRuns)).toEqual([]);
  });
});

describe("readLoopInputs: git log", () => {
  const commit = (dir: string, file: string, epoch: number): string => {
    execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", file], {
      env: { ...process.env, GIT_AUTHOR_DATE: `${epoch} +0000`, GIT_COMMITTER_DATE: `${epoch} +0000` },
      stdio: "ignore",
    });
    return gitIn(dir, "rev-parse", "HEAD");
  };

  beforeEach(async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
    gitIn(root, "init", "-q", "-b", "main");
    gitIn(root, "config", "user.email", "t@t");
    gitIn(root, "config", "user.name", "t");
    await writeFile(join(root, ".gitignore"), ".works/\n.kf/\n");
    gitIn(root, "add", "-A");
  });

  it("lists the main checkout's commits oldest first with committer time in ms when the item has no worktree", () => {
    const a = commit(root, "one", 1_700_000_000);
    const b = commit(root, "two", 1_700_000_100);
    expect(ok(readLoopInputs(root, featureOf())).gitLog).toEqual([
      { sha: a, ts: 1_700_000_000_000 },
      { sha: b, ts: 1_700_000_100_000 },
    ]);
  });

  it("reads the item's branch from its worktree, not the main checkout's HEAD", () => {
    const base = commit(root, "base", 1_700_000_000);
    const wt = join(scratch, "wt");
    gitIn(root, "worktree", "add", "-q", "-b", "feat/demo", wt, "HEAD");
    const onBranch = commit(wt, "branch work", 1_700_000_200);
    const onMain = commit(root, "main-only", 1_700_000_300);
    const log = ok(readLoopInputs(root, featureOf({ worktree: { path: wt, branch: "feat/demo" } }))).gitLog;
    expect(log).toEqual([
      { sha: base, ts: 1_700_000_000_000 },
      { sha: onBranch, ts: 1_700_000_200_000 },
    ]);
    expect(log.map((e) => e.sha)).not.toContain(onMain);
  });

  it("refuses with the git error when the log cannot be read", () => {
    const reason = refusal(readLoopInputs(root, featureOf()));
    expect(reason).toContain("git log");
    // Locale-independent: git's own stderr follows "in <dir>: ", so the text after that separator is not empty.
    const marker = `in ${root}: `;
    expect(reason).toContain(marker);
    expect(reason.slice(reason.indexOf(marker) + marker.length).trim().length).toBeGreaterThan(0);
  });
});

describe("readLoopInputs: git log outside a repository", () => {
  beforeEach(async () => {
    await putItemFile(ARTIFACTS["implementation-plan"].file, plan([{ id: "TASK-001" }]));
  });

  it("gives an empty git log outside a repository", () => {
    expect(ok(readLoopInputs(root, featureOf())).gitLog).toEqual([]);
  });

  it("gives an empty git log outside a repository when git speaks another language", () => {
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
    process.env.LANG = "de_DE.UTF-8";
    process.env.LC_ALL = "de_DE.UTF-8";
    try {
      expect(ok(readLoopInputs(root, featureOf())).gitLog).toEqual([]);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
