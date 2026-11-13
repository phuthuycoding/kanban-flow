import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

import { ensureWorksStructure, writeFeatureMeta } from "../workflow/features.js";
import { cmdIssues } from "../cli/commands/issues.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

const FOLDER = "demo-item_20261113_1811";
const ISSUE_URL = "https://github.com/o/r/issues/7";

interface GhCall {
  argv: string[];
  bodyFile: string | null;
}

let dir: string;
let binDir: string;
let callsFile: string;
let itemDir: string;
let originalPath: string | undefined;

// A fake gh on PATH records argv (and the content of any --body-file, which kf deletes after the call).
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
const i = argv.indexOf("--body-file");
const bodyFile = i >= 0 ? fs.readFileSync(argv[i + 1], "utf8") : null;
fs.appendFileSync(process.env.KF_FAKE_GH_CALLS, JSON.stringify({ argv, bodyFile }) + "\\n");
if (argv[0] === "issue" && argv[1] === "create") process.stdout.write("${ISSUE_URL}\\n");
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-issues-format-"));
  binDir = join(dir, "fakebin");
  callsFile = join(dir, "gh-calls.jsonl");
  await mkdir(binDir, { recursive: true });
  await writeFile(callsFile, "");
  await writeFile(join(binDir, "gh"), FAKE_GH, "utf8");
  await chmod(join(binDir, "gh"), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  process.env.KF_FAKE_GH_CALLS = callsFile;

  ensureWorksStructure(dir);
  await mkdir(join(dir, ".kf"), { recursive: true });
  await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261113_1800", repository: "o/r" }));
  itemDir = join(dir, ".works", "brainstorm", FOLDER);
  await mkdir(itemDir, { recursive: true });
});

afterEach(async () => {
  process.env.PATH = originalPath;
  delete process.env.KF_FAKE_GH_CALLS;
  await rm(dir, { recursive: true, force: true });
});

async function item(meta: Record<string, unknown> = {}): Promise<void> {
  await writeFeatureMeta(itemDir, { schema: "kanban-flow", feature: "demo-item", context: "app", created: "20261113_1811", ...meta });
}

async function writeSpec(sectionHeading: string, section: string | null): Promise<void> {
  const parts = ["# Requirement", "", "## Context", "Some context.", ""];
  if (section !== null) parts.push(`## ${sectionHeading}`, section, "");
  parts.push("## Scope", "Everything relevant.", "");
  await writeFile(join(itemDir, "phase-1-spec-requirement.md"), parts.join("\n"), "utf8");
}

async function calls(): Promise<GhCall[]> {
  const raw = await readFile(callsFile, "utf8");
  return raw.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as GhCall);
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

describe("kf issues create body", () => {
  it("names the item folder and no absolute path when the requirement is not filled yet", async () => {
    await item();
    const res = await cmdIssues(args("issues", ["create", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    const body = valueAfter(call!.argv, "--body")!;
    expect(body).toContain(FOLDER);
    expect(body).not.toContain(itemDir);
    expect(body).not.toContain(dir);
  });

  it("names the item folder and no absolute path when the requirement is filled", async () => {
    await item();
    await writeSpec("Objective", "Ship the thing.");
    const res = await cmdIssues(args("issues", ["create", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    const body = valueAfter(call!.argv, "--body")!;
    expect(body).toContain(FOLDER);
    expect(body).not.toContain(itemDir);
    expect(body).not.toContain(dir);
  });

  it("still creates the issue with the title passed by --title", async () => {
    await item({ goal: "Goal from meta" });
    await writeSpec("Objective", "Objective line.");
    const res = await cmdIssues(args("issues", ["create", "demo-item"], { title: "X" }), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(valueAfter(call!.argv, "--title")).toBe("X");
  });
});

describe("kf issues sync body", () => {
  it("ends with a footer naming the item folder and no absolute path", async () => {
    await item({ issue: ISSUE_URL });
    await writeSpec("Objective", "Ship the thing.");
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(call!.bodyFile).toContain(`**Work item kf:** \`${FOLDER}\``);
    expect(call!.bodyFile).not.toContain(itemDir);
    expect(call!.bodyFile).not.toContain(dir);
  });
});

describe("kf issues sync title", () => {
  it("sets the title from the first non-empty line of Objective, trimmed", async () => {
    await item({ issue: ISSUE_URL });
    await writeSpec("Objective", "\n\n   Make the issue list readable   \nSecond line is ignored.");
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(call!.argv.slice(0, 2)).toEqual(["issue", "edit"]);
    expect(valueAfter(call!.argv, "--title")).toBe("Make the issue list readable");
  });

  it("sets the title from the first non-empty line of Bug Summary for a bug", async () => {
    await item({ issue: ISSUE_URL, kind: "bug" });
    await writeSpec("Bug Summary", "\nSync leaves the slug as the title.\nMore detail.");
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(valueAfter(call!.argv, "--title")).toBe("Sync leaves the slug as the title.");
  });

  it("truncates a first line longer than 256 characters to 256", async () => {
    await item({ issue: ISSUE_URL });
    await writeSpec("Objective", "a".repeat(300));
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(valueAfter(call!.argv, "--title")).toBe("a".repeat(256));
  });

  it("leaves the title alone when the work item has a goal", async () => {
    await item({ issue: ISSUE_URL, goal: "Human written goal" });
    await writeSpec("Objective", "Objective line.");
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(call!.argv).not.toContain("--title");
  });

  it("leaves the title alone when the Objective section is missing", async () => {
    await item({ issue: ISSUE_URL });
    await writeSpec("Objective", null);
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(call!.argv).not.toContain("--title");
  });

  it("leaves the title alone when the Objective section is empty", async () => {
    await item({ issue: ISSUE_URL });
    await writeSpec("Objective", "   \n\n  ");
    const res = await cmdIssues(args("issues", ["sync", "demo-item"]), dir);
    expect(res.code).toBe(0);
    const [call] = await calls();
    expect(call!.argv).not.toContain("--title");
  });
});
