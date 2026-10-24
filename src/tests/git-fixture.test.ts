import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitDriveProject, type GitDriveProject } from "./helpers/git-fixture.js";

let p: GitDriveProject;

beforeEach(async () => {
  p = await gitDriveProject({ tasks: [{ id: "TASK-001" }, { id: "TASK-002", deps: ["TASK-001"] }] });
});
afterEach(async () => {
  await p.cleanup();
});

const run = (name: string, prompt: string, cwd = p.root) =>
  execFileSync(name, ["-p", `kf-run:abc\n${prompt}`], { cwd, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("git drive fixture", () => {
  it("builds a repo with a commit, a local identity and an item worktree", () => {
    expect(p.git(p.root, "rev-list", "--count", "HEAD")).toBe("1");
    expect(p.git(p.root, "config", "--local", "user.name")).toBe("t");
    expect(p.git(p.root, "config", "--local", "user.email")).toBe("t@t");
    expect(p.readMeta()?.approval?.status).toBe("approved");
    const wt = p.worktreePath();
    expect(wt && existsSync(wt)).toBe(true);
    expect(readFileSync(join(p.itemDir(), "phase-2-implementation-plan.md"), "utf8")).toContain("| TASK-002 | Do TASK-002 | Core | TASK-001 |");
    const cfg = JSON.parse(readFileSync(join(p.root, ".kf", "config.json"), "utf8"));
    expect(cfg.harness.verify).toEqual({ stage: [["true"]] });
    expect(cfg.worktree.enabled).toBe(true);
  });

  it("records every call with timestamps and the task id", () => {
    run("claude", "work on TASK-001 now");
    run("claude", "no task here");
    const calls = p.calls("claude");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ task: "TASK-001" });
    expect(calls[1].task).toBeNull();
    for (const c of calls) {
      expect(c.end).toBeGreaterThanOrEqual(c.start);
      expect(c.pid).toBeGreaterThan(0);
      expect(c.argv[1]).toContain("kf-run:abc");
    }
    expect(calls[1].start).toBeGreaterThanOrEqual(calls[0].end);
    expect(p.cli.argv("claude")[0]).toBe("-p"); // last-call file still written
  });

  it("prefers the _TASK_### variables over the unsuffixed ones", () => {
    p.cli.scenario("claude", { stdout: "STATUS: DONE\nSummary: default" });
    p.cli.scenario("claude", { stdout: "STATUS: BLOCKED\nSummary: one", exit: 3 }, "TASK-001");
    expect(run("claude", "TASK-002 please")).toContain("default");
    expect(() => run("claude", "TASK-001 please")).toThrow(/status 3|Command failed/);
    try { run("claude", "TASK-001 please"); } catch (e) { expect((e as { stdout: string }).stdout).toContain("Summary: one"); }
  });

  it("writes, renames, deletes and runs scripts in the call's cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kf-fake-cwd-"));
    try {
      await mkdir(join(dir, "old"), { recursive: true });
      await writeFile(join(dir, "old", "a.txt"), "A");
      await writeFile(join(dir, "gone.txt"), "x");
      p.cli.scenario("codex", {
        write: { "src/new/b.txt": "hello", "c.txt": "see" },
        rename: { "old/a.txt": "moved/a.txt" },
        delete: ["gone.txt"],
        script: "echo done > script.txt",
      }, "TASK-001");
      run("codex", "TASK-001 go", dir);
      const read = (f: string) => readFileSync(join(dir, f), "utf8");
      expect(read("src/new/b.txt")).toBe("hello");
      expect(read("moved/a.txt")).toBe("A");
      expect(existsSync(join(dir, "old", "a.txt"))).toBe(false);
      expect(existsSync(join(dir, "gone.txt"))).toBe(false);
      expect(read("script.txt")).toBe("done\n");
      expect(p.calls("codex")[0].cwd).toContain("kf-fake-cwd-");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports a bug item left in planning-approved state", async () => {
    const bug = await gitDriveProject({ kind: "bug", implementation: false, tasks: [{ id: "TASK-001" }] });
    try {
      expect(bug.readMeta()).toMatchObject({ kind: "bug", approval: { status: "approved" } });
      expect(bug.worktreePath()).toBeNull();
    } finally {
      await bug.cleanup();
    }
  });
});
