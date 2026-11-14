import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact } from "./helpers/contract.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdEstimate } from "../cli/commands/estimate.js";
import { commandHelp } from "../cli/args.js";
import type { ParsedArgs } from "../cli/args.js";

/*
 * `kf estimate show` is where travel reads an item's estimate: the figures recorded at approval once the item is
 * approved, the contract estimate while it is still in planning, and a plain "no estimate" otherwise.
 */

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name: string) => findFeature(root, name)!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const PLAN_FILE = ARTIFACTS["implementation-plan"].file;
const snapshot = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(feature(name).dir, ".kfw.json"), "utf8")) as Record<string, unknown>;

function planText(estimate: string | null, filesCells: string[]): string {
  const rows = filesCells.map((cell, i) => `| TASK-00${i + 1} | Step ${i + 1} | - | Done | FR-001 / UC-001 | ${cell} |`);
  return withDocsImpact([
    "# Contract",
    "UC-001: Create a task",
    "",
    ...(estimate === null ? [] : ["## Estimate", "", estimate, ""]),
    "## Task Breakdown",
    "",
    "| Task | Description | Dependencies | Expected output | FR / UC references | Files |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n"));
}

/** `name` in planning with a complete contract whose plan is `plan`. */
async function plannedItem(name: string, plan: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, PLAN_FILE), plan);
  for (const id of ["use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

const show = (name: string, json = false) => cmdEstimate(args("estimate", ["show", name], json ? { json: true } : {}), root);

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-estimate-show-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("kf estimate show on an approved item", () => {
  beforeEach(async () => {
    await plannedItem("shipped", planText("- Agent minutes: 30", ["`src/a.ts`, `src/b.ts`", "`src/c.ts`, `src/d.ts`"]));
    expect((await cmdApprove(args("approve", ["shipped"]), root)).code).toBe(0);
    // A plan edited after approval must not change what was recorded.
    await writeFile(join(feature("shipped").dir, PLAN_FILE), planText("- Agent minutes: 45", ["`src/a.ts`"]));
  });

  it("prints the recorded minutes, files, mark, size and factor", async () => {
    expect(snapshot("shipped").estimate).toMatchObject({ minutes: 30, files: 4, filesMark: "exact", size: "L", factor: 1 });

    const res = await show("shipped");

    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toMatch(/\b30\b/);
    expect(res.stdout).toMatch(/\b4\b/);
    expect(res.stdout).toContain("exact");
    expect(res.stdout).toMatch(/\bL\b/);
    expect(res.stdout).toMatch(/factor/i);
    expect(res.stdout).not.toMatch(/\b45\b/);
    expect(res.stdout).not.toContain("not yet approved");
  });

  it("--json carries the recorded figures", async () => {
    const recorded = snapshot("shipped").estimate as Record<string, unknown>;
    expect(recorded).toMatchObject({ minutes: 30 });

    const res = await show("shipped", true);

    expect(res.code, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({
      minutes: recorded.minutes, files: recorded.files, filesMark: recorded.filesMark, size: recorded.size, factor: recorded.factor,
    });
  });
});

describe("kf estimate show on a planning item", () => {
  beforeEach(async () => {
    await plannedItem("draft", planText("- Agent minutes: 30", ["`src/a.ts`, `src/b.ts`", "`src/c.ts`, `src/d.ts`, `src/e.ts`"]));
  });

  it("prints the contract estimate marked not yet approved", async () => {
    const res = await show("draft");

    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain("not yet approved");
    expect(res.stdout).toMatch(/\b30\b/);
    expect(res.stdout).toMatch(/\b5\b/);
    expect(res.stdout).toContain("exact");
    expect(res.stdout).toMatch(/\bL\b/);
  });

  it("--json carries the contract figures and its size", async () => {
    const res = await show("draft", true);

    expect(res.code, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ minutes: 30, files: 5, filesMark: "exact", size: "L" });
  });
});

describe("kf estimate show on an item with no estimate", () => {
  it("says the planning item has no estimate, and --json gives none with the reason", async () => {
    await plannedItem("bare", planText(null, ["`src/a.ts`"]));

    const text = await show("bare");
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("no estimate:");

    const json = await show("bare", true);
    expect(json.code, json.stderr).toBe(0);
    const parsed = JSON.parse(json.stdout) as Record<string, unknown>;
    expect(parsed).toMatchObject({ none: true, reason: expect.any(String) });
    expect(String(parsed.reason).trim()).not.toBe("");
  });

  it("says an item approved without an estimate has none", async () => {
    await plannedItem("bare", planText(null, ["`src/a.ts`"]));
    expect((await cmdApprove(args("approve", ["bare"]), root)).code).toBe(0);
    expect(snapshot("bare").estimate).toMatchObject({ none: true });

    const text = await show("bare");
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("no estimate:");

    const json = await show("bare", true);
    expect(json.code, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ none: true, reason: expect.any(String) });
  });
});

describe("kf estimate show on an unknown item", () => {
  it("exits 1", async () => {
    const res = await show("nowhere");
    expect(res.code).toBe(1);
    expect(`${res.stdout}\n${res.stderr ?? ""}`).toContain("nowhere");
  });
});

describe("kf estimate help", () => {
  it("lists the show subcommand with its --json option", () => {
    const help = commandHelp("estimate");
    expect(help).toContain("kf estimate show <feature>");
    expect(help).toContain("--json");
  });
});
