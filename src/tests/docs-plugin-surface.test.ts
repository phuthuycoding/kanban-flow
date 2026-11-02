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
  const SELF = "src/tests/docs-plugin-surface.test.ts";
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
  // The legacy list, and the tests that seed legacy names on disk or spell the patterns to prove the rename.
  const LEGACY_HOMES = new Set([
    "src/integrations/managed.ts",
    "src/tests/migration.test.ts",
    "src/tests/doctor-plugin.test.ts",
    "src/tests/doctor.test.ts",
    "src/tests/spike-surface.test.ts",
    "src/tests/plugin-package.test.ts",
    SELF,
  ]);

  function grep(pattern: string): string[] {
    const res = spawnSync("git", ["grep", "--untracked", "-nE", pattern, "--", ".", ...HISTORY], { cwd: ROOT, encoding: "utf8" });
    if (res.status === 1) return [];
    expect(res.status, res.stderr).toBe(0);
    return res.stdout.split("\n").filter(Boolean).filter((l) => !LEGACY_HOMES.has(l.split(":")[0]));
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
    expect(lines.filter((l) => !l.startsWith("src/shared/process.ts:") && !product.some((re) => re.test(l)))).toEqual([]);
  });
});

describe("README and the Pages site", () => {
  it("README names the /kf commands, the plugin install, the kf- copies and the 10 skills and 7 agents", () => {
    const text = read("README.md");
    expect(text).toContain("/kf:flow");
    expect(text).toMatch(/\/plugin (marketplace add|install)/);
    expect(text).toContain("kf-");
    expect(text).toContain("10 skills");
    expect(text).toContain("7 agents");
    expect(text).not.toMatch(STALE_COUNTS);
  });

  it("README carries a breaking-change note that points at kf install", () => {
    const text = read("README.md");
    expect(text).toMatch(/breaking/i);
    expect(text).toContain("kf install");
  });

  it("the Pages site names /kf:flow, the plugin and the 10 skills and 7 agents", () => {
    const text = read(".github/pages/index.html");
    expect(text).toContain("/kf:flow");
    expect(text).toMatch(/plugin/i);
    expect(text).toContain("10 skills");
    expect(text).toContain("7 agents");
    expect(text).not.toMatch(STALE_COUNTS);
  });
});

describe("the workflow docs", () => {
  it.each(["docs/README.md", "docs/workflow/README.md", "docs/workflow/skills.md", "docs/workflow/harness.md", "docs/workflow/cli-reference.md"])(
    "%s names a /kf command and the plugin",
    (file) => {
      const text = read(file);
      expect(text).toMatch(/\/kf:[a-z]+/);
      expect(text).toMatch(/plugin/i);
    },
  );

  it("cli-reference states the 10 skills, the 7 agents and the kf- copy names", () => {
    const text = read("docs/workflow/cli-reference.md");
    expect(text).toContain("10 skills");
    expect(text).toContain("7 agents");
    expect(text).toContain("kf-");
    expect(text).toContain("researcher");
  });

  it("autoconfig.md describes the plugin install", () => {
    expect(read("docs/workflow/autoconfig.md")).toMatch(/plugin/i);
  });

  it.each(["README.md", "docs/README.md", ...workflowPages()])("%s keeps no stale skill or agent count", (file) => {
    expect(read(file)).not.toMatch(STALE_COUNTS);
  });
});

describe("the CLI help", () => {
  it.each(["install", "uninstall"])("kf %s help names 10 skills, 7 agents, researcher and the plugin", (cmd) => {
    const help = commandHelp(cmd);
    expect(help).toContain("10 skills");
    expect(help).toContain("7 agents");
    expect(help).toContain("researcher");
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
    const res = await cmdAutoconfig(parsed, dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("/kf:flow");
    expect(res.stdout).toMatch(/plugin/i);
    expect(res.stdout).not.toMatch(STALE_COUNTS);
  });
});
