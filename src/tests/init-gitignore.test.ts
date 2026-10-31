import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
let root: string;
const gitignore = () => readFileSync(join(root, ".gitignore"), "utf8");
const count = (text: string, line: string) => text.split("\n").filter((l) => l.trim() === line).length;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-init-gitignore-"));
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf init seeds .gitignore", () => {
  it("writes .works/, .worktrees/ and .kf/travel/ on a fresh repo; re-running duplicates none", async () => {
    const first = await cmdInit(args("init", [], { defaults: true }), root);
    expect(first.code, first.stdout).toBe(0);
    expect(first.stdout).toContain(".gitignore: added .works/, .worktrees/, .kf/travel/");
    for (const line of [".works/", ".worktrees/", ".kf/travel/"]) expect(count(gitignore(), line)).toBe(1);
    expect(execFileSync("git", ["-C", root, "check-ignore", ".kf/travel/progress.md"], { encoding: "utf8" }).trim()).toBe(".kf/travel/progress.md");

    const before = gitignore();
    const again = await cmdInit(args("init", [], { defaults: true }), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).not.toContain(".gitignore: added");
    expect(gitignore()).toBe(before);
  });

  it("adds only the missing entries to a .gitignore that already ignores .works/", async () => {
    await writeFile(join(root, ".gitignore"), "node_modules/\n/.works\n");
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(".gitignore: added .worktrees/, .kf/travel/");
    expect(count(gitignore(), ".works/")).toBe(0);
    expect(count(gitignore(), "/.works")).toBe(1);
    expect(count(gitignore(), ".kf/travel/")).toBe(1);
  });
});
