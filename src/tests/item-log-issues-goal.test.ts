import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdIssues } from "../cli/commands/issues.js";
import type { ParsedArgs } from "../cli/args.js";

// `kf issues create --title` on an item with no goal saves the title as the goal (#191); the same
// write is the `linked` lifecycle record, so the record carries the goal with the issue.
const ISSUE = "https://github.com/o/r/issues/91";
const GH_STUB = `#!/usr/bin/env bash
if [ "$1" = issue ] && [ "$2" = create ]; then echo "$GH_ISSUE_URL"; fi
exit 0
`;

let scratch: string;
let root: string;
let prevPath: string | undefined;
const args = (command: string, positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const dirOf = (): string => {
  const f = findFeature(root, "demo");
  if (!f) throw new Error("item demo not found");
  return f.dir;
};
const logLines = (): Array<{ event: string; set?: Record<string, unknown> }> =>
  readFileSync(itemLogPath(dirOf()), "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { event: string; set?: Record<string, unknown> });
const snapshot = (): Record<string, unknown> => JSON.parse(readFileSync(join(dirOf(), ".kfw.json"), "utf8")) as Record<string, unknown>;

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-itemlog-goal-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Gia Goal"]);
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261113_1830", defaultContext: "cli", repository: "o/r", worktree: { enabled: false },
  }));
  const stubBin = join(scratch, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_ISSUE_URL = ISSUE;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_ISSUE_URL;
  await rm(scratch, { recursive: true, force: true });
});

describe("kf issues create --title on an item with no goal", () => {
  it("appends one linked record that sets the issue and the goal, and the log folds back to .kfw.json", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    expect(snapshot().goal).toBeUndefined();
    const before = logLines().length;

    const res = await cmdIssues(args("issues", ["create", "demo"], { title: "Readable title" }), root);

    expect(res.code, res.stdout).toBe(0);
    const appended = logLines().slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("linked");
    expect(appended[0].set).toEqual({ issue: ISSUE, goal: "Readable title" });
    expect(snapshot().goal).toBe("Readable title");
    const folded = readItemLog(dirOf());
    expect(folded.ok && folded.state).toEqual({ stage: "brainstorm", meta: sharedMeta(snapshot()) });
  });

  it("keeps an existing goal and records only the issue", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app", goal: "Human goal" }), root)).code).toBe(0);
    const before = logLines().length;

    expect((await cmdIssues(args("issues", ["create", "demo"], { title: "Other title" }), root)).code).toBe(0);

    const appended = logLines().slice(before);
    expect(appended.map((r) => r.set)).toEqual([{ issue: ISSUE }]);
    expect(snapshot().goal).toBe("Human goal");
  });
});
