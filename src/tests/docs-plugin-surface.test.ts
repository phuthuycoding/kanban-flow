import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { commandHelp } from "../cli/args.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { seedAgentsFile } from "../project/bootstrap.js";
import type { ParsedArgs } from "../cli/args.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Counts and old wording are spelled out here so the docs are checked against the intended values, not against the modules.
const STALE_COUNTS = /\b(9|nine) (kanban )?skills\b|\b(6|six) (kanban )?agents?\b|\b(8|eight) kanban phase skills\b/i;

const workflowPages = () =>
  readdirSync(join(ROOT, "docs", "workflow"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/workflow/${f}`);

describe("no leftover pre-plugin names anywhere in the living tree", () => {
  // History paths and the one fixture of a released skill stay unchanged.
  const HISTORY = [
    ":(exclude).works",
    ":(exclude)docs/requirement",
    ":(exclude)docs/use-cases",
    ":(exclude)docs/testplan",
    ":(exclude)CHANGELOG.md",
    // A dated done-log: history, not a living page.
    ":(exclude)BACKLOG.md",
    ":(exclude)src/tests/fixtures/kanban-ship-0.13.0",
  ];
  // Only the lines that legitimately spell a legacy name: the legacy list, tests that remove or expect a legacy dir on disk,
  // and the patterns that prove this very rename. Everything else in these files is still checked.
  const LEGACY_LINES = [
    /^src\/integrations\/managed\.ts:\d+:\s+"kanban-[a-z]+",$/,
    /^src\/tests\/doctor\.test\.ts:\d+:.*("skills", "kanban-(plan|review)"|join\(skills, "kanban-plan"\)|toContain\("kanban-review"\)|incomplete \(scope: global\): kanban-plan|A kanban-flow skill missing)/,
    /^src\/tests\/(plugin-package|spike-surface)\.test\.ts:\d+:\s*const LEGACY = \[/,
    // TASK-004's migration tests seed and assert legacy kanban-* entries on disk by name throughout.
    /^src\/tests\/(migration|doctor-plugin)\.test\.ts:\d+:/,
    /^src\/tests\/plugin-package\.test\.ts:\d+:.*(has no kanban-flow skill path|grep\("|^\s*\/.*\/,$)/,
    /^src\/tests\/plugin-package\.test\.ts:\d+:\s+\/.*kanban-flow.*\/,$/,
    // Self: the pattern strings and product-name regexes below.
    /^src\/tests\/docs-plugin-surface\.test\.ts:\d+:(\s+\/.*\/,$|.*grep\("|.*kanban-flow\/\(SKILL|.*has no kanban-flow skill name)/,
    // process.ts:16 is a regex literal matched against `ps` output to recognise a running kanban-flow process by the product name; not a skill name.
    /^src\/shared\/process\.ts:16:/,
  ];

  function grep(pattern: string): string[] {
    const res = spawnSync("git", ["grep", "-nE", pattern, "--", ".", ...HISTORY], { cwd: ROOT, encoding: "utf8" });
    if (res.status === 1) return [];
    expect(res.status, res.stderr).toBe(0);
    return res.stdout.split("\n").filter(Boolean).filter((l) => !LEGACY_LINES.some((re) => re.test(l)));
  }

  it("has no kanban-<skill> name outside the legacy list and its migration tests", () => {
    // git grep -E has no \b, so the word boundary is spelled out.
    expect(grep("kanban-(brainstorm|plan|implement|test|review|archive|bug)([^A-Za-z0-9_]|$)")).toEqual([]);
  });

  it("has no kanban-flow skill name or path outside the legacy list, the product name and GitHub URLs", () => {
    const lines = grep("(^|[^A-Za-z0-9_@./~-])/kanban-flow([^A-Za-z0-9_-]|$)|Skill\\(kanban-flow|skills/kanban-flow|kanban-flow skill|kanban-flow/(SKILL|agents|references)");
    const product = [
      /github\.com\/phuthuycoding\/kanban-flow/,
      /@phuthuycoding\/kanban-flow/,
      /\.config\/kanban-flow/,
      /baseurl: \/kanban-flow/,
      /PLUGIN_VAR\}\/kanban-flow\//,
      /kanban-flow\/(templates|review|github-hooks|hooks)/,
    ];
    expect(lines.filter((l) => !product.some((re) => re.test(l)))).toEqual([]);
  });
});

const SKILLS = ["flow", "brainstorm", "plan", "implement", "test", "review", "archive", "bug", "spike", "travel", "docs"];
const AGENTS = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer", "researcher"];
const INSTALL_CMD = "/plugin install kf@kanban-flow";

// Table rows whose first cell is exactly the command, e.g. | `/kf:plan` | ... |
const tableRows = (text: string, name: string) => text.split("\n").filter((l) => new RegExp(`^\\|\\s*\x60?/kf:${name}\x60?\\s*\\|`).test(l)).length;
// `/kf:plan` must not be satisfied by `/kf:plan-b`; the name ends at a non-name character.
const mentions = (text: string, name: string) => new RegExp(`/kf:${name}(?![A-Za-z0-9_-])`).test(text);

describe("README and the Pages site", () => {
  it("README lists every skill as /kf:<name>", () => {
    const text = read("README.md");
    expect(SKILLS.filter((n) => !mentions(text, n))).toEqual([]);
    expect(SKILLS.filter((n) => tableRows(text, n) > 1)).toEqual([]);
  });

  it("README gives the plugin install command, the kf- copies and the counts", () => {
    const text = read("README.md");
    expect(text).toContain(INSTALL_CMD);
    expect(text).toContain("kf-");
    expect(text).toContain("11 skills");
    expect(text).toContain("7 agents");
    expect(text).not.toMatch(STALE_COUNTS);
  });

  it("README carries a breaking-change note that points at kf install", () => {
    const text = read("README.md");
    expect(text).toMatch(/breaking/i);
    expect(text).toContain("kf install");
  });

  it("the Pages site gives the plugin install command, /kf:flow and the counts", () => {
    const text = read(".github/pages/index.html");
    expect(text).toContain(INSTALL_CMD);
    expect(text).toContain("/kf:flow");
    expect(text).toContain("11 skills");
    expect(text).toContain("7 agents");
    expect(text).not.toMatch(STALE_COUNTS);
  });
});

describe("the workflow docs", () => {
  it("skills.md lists every skill as /kf:<name> and no skill twice in its table", () => {
    const text = read("docs/workflow/skills.md");
    expect(SKILLS.filter((n) => !mentions(text, n))).toEqual([]);
    expect(SKILLS.filter((n) => tableRows(text, n) > 1)).toEqual([]);
  });

  it.each(["docs/workflow/harness.md", "docs/workflow/cli-reference.md"])("%s names every agent", (file) => {
    const text = read(file);
    expect(AGENTS.filter((a) => !text.includes(a))).toEqual([]);
  });

  it("cli-reference states the 11 skills, the 7 agents, the kf- copy names and the plugin", () => {
    const text = read("docs/workflow/cli-reference.md");
    expect(text).toContain("11 skills");
    expect(text).toContain("7 agents");
    expect(text).toContain("kf-");
    expect(text).toMatch(/plugin/i);
  });

  it("autoconfig.md gives the plugin install command", () => {
    expect(read("docs/workflow/autoconfig.md")).toContain(INSTALL_CMD);
  });

  it.each(["docs/README.md", "docs/workflow/README.md"])("%s names /kf:flow and the plugin", (file) => {
    const text = read(file);
    expect(mentions(text, "flow")).toBe(true);
    expect(text).toMatch(/plugin/i);
  });

  it.each(["README.md", "docs/README.md", ...workflowPages()])("%s keeps no stale skill or agent count", (file) => {
    expect(read(file)).not.toMatch(STALE_COUNTS);
  });
});

describe("the CLI help", () => {
  it.each(["install", "uninstall"])("kf %s help names 11 skills, 7 agents, every agent and the plugin", (cmd) => {
    const help = commandHelp(cmd);
    expect(help).toContain("11 skills");
    expect(help).toContain("7 agents");
    expect(AGENTS.filter((a) => !help.includes(a))).toEqual([]);
    expect(help).toMatch(/plugin/i);
  });

  it("kf init help describes the plugin install", () => {
    expect(commandHelp("init")).toMatch(/plugin/i);
  });

  it.each(["init", "install", "uninstall", "doctor"])("kf %s help keeps no stale skill or agent count", (cmd) => {
    expect(commandHelp(cmd)).not.toMatch(STALE_COUNTS);
  });
});

describe("the seeded AGENTS.md and the autoconfig briefing", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = "";
  });

  it("the AGENTS.md seed names /kf:flow", async () => {
    dir = await mkdtemp(join(tmpdir(), "kfw-docs-seed-"));
    expect(seedAgentsFile(dir, ["node"])).toBe("created");
    const text = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(text).toContain("/kf:flow");
  });

  it("the autoconfig briefing names /kf:flow and the plugin, with no stale counts", async () => {
    dir = await mkdtemp(join(tmpdir(), "kfw-docs-auto-"));
    const parsed = { command: "autoconfig", options: {}, positionals: [] } as unknown as ParsedArgs;
    const res = await cmdAutoconfig(parsed, dir, async () => ({ code: 0, stdout: "[]", stderr: "" }));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("/kf:flow");
    expect(res.stdout).toMatch(/plugin/i);
    expect(res.stdout).not.toMatch(STALE_COUNTS);
  });
});
