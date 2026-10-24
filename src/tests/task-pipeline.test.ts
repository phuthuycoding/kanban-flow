import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cmdRun } from "../cli/commands/run.js";
import { readProjectConfig } from "../project/config.js";
import { executeTaskRun, prepareTaskRun, setTaskState } from "../harness/task-run.js";
import { pathAllowed, recoverItemMerge, mergeLockWait } from "../harness/task-pipeline.js";
import { LOCK_TIMEOUT_MS } from "../shared/lock.js";
import { gitDriveProject, type DriveTask, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

// Every test cuts real git worktrees and spawns fake-CLI workers.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let p: GitDriveProject;
afterEach(async () => {
  await p?.cleanup();
});

const taskWorktree = (id = "task-001"): string => join(p.scratch, "wt", "demo.tasks", id);
const itemHead = (): string => p.git(p.worktreePath()!, "rev-parse", "HEAD");
const state = (id = "TASK-001") => p.readMeta()!.tasks![id];
const branches = (): string => p.git(p.root, "branch", "--list");

async function setup(task: Partial<DriveTask> = {}, verify?: Record<string, unknown>): Promise<void> {
  p = await gitDriveProject({ tasks: [{ id: "TASK-001", files: ["src/a.ts"], ...task }], ...(verify ? { verify } : {}) });
}

/** Commit a file in the item worktree so later task worktrees are cut with it. */
async function commitInItem(file: string, content: string): Promise<void> {
  const wt = p.worktreePath()!;
  await mkdir(join(wt, file, ".."), { recursive: true });
  await writeFile(join(wt, file), content);
  p.git(wt, "add", "-A");
  p.git(wt, "commit", "-qm", `add ${file}`);
}

async function exec(id = "TASK-001") {
  const prepared = prepareTaskRun(p.root, p.feature(), id);
  if (!prepared.ok) throw new Error(prepared.reason);
  const res = await executeTaskRun(p.root, "demo", prepared.ctx, { fresh: false, timeoutMs: 60_000 });
  if (!res.started) throw new Error(res.reason);
  return res;
}

describe("pathAllowed", () => {
  it("matches exact paths, directory prefixes and globs", () => {
    expect(pathAllowed("src/a.ts", ["src/a.ts"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["src"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["./src/"])).toBe(true);
    expect(pathAllowed("srcs/a.ts", ["src"])).toBe(false);
    expect(pathAllowed("src/x/a.ts", ["src/**/*.ts"])).toBe(true);
    expect(pathAllowed("src/a.ts", ["src/**/*.ts"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["src/*.ts"])).toBe(false);
    expect(pathAllowed("src/a.ts", ["src/?.ts"])).toBe(true);
    expect(pathAllowed("src/ab.ts", ["src/?.ts"])).toBe(false);
    expect(pathAllowed("docs/a.md", ["src/**", "`docs/*.md`"])).toBe(true);
  });
});

describe("completion merges the task (TC-009)", () => {
  it("commits task(TASK-###) with a subject of at most 72 chars, merges, removes the worktree and keeps the branch", async () => {
    await setup({ description: "Implement the extremely long description of this task so that the commit subject must be truncated" });
    p.cli.scenario("claude", { write: { "src/a.ts": "export const a = 1;" } }, "TASK-001");
    const before = itemHead();
    const res = await exec();

    expect(res).toMatchObject({ state: "done", retryable: false });
    const branch = state().branch!;
    const subject = p.git(p.root, "log", "-1", "--format=%s", branch);
    expect(subject.startsWith("task(TASK-001): Implement")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(p.git(p.root, "merge-base", "--is-ancestor", branch, itemHead())).toBe("");
    expect(itemHead()).not.toBe(before);
    expect(state().mergeSha).toBe(itemHead());
    expect(await readFile(join(p.worktreePath()!, "src/a.ts"), "utf8")).toBe("export const a = 1;");
    expect(existsSync(taskWorktree())).toBe(false);
    expect(branches()).toContain(branch);
    expect(await readFile(join(p.itemDir(), "tasks.md"), "utf8")).toContain("TASK-001");
  });

  it("treats a worker that changed nothing as done without a merge", async () => {
    await setup();
    const before = itemHead();
    const res = await exec();
    expect(res).toMatchObject({ state: "done", reason: "no changes" });
    expect(itemHead()).toBe(before);
    expect(state().mergeSha).toBeUndefined();
  });
});

describe("allowlist (TC-017)", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["a write outside", { write: { "src/a.ts": "ok", "other/x.ts": "no" } }, "other/x.ts"],
    ["a rename out of the allowlist", { rename: { "src/a.ts": "other/moved.ts" } }, "other/moved.ts"],
    ["a delete outside", { delete: ["keep.txt"] }, "keep.txt"],
  ];
  for (const [name, scenario, path] of cases) {
    it(`blocks ${name} without retry and merges nothing`, async () => {
      await setup();
      await commitInItem("src/a.ts", "orig");
      await commitInItem("keep.txt", "keep");
      p.cli.scenario("claude", scenario, "TASK-001");
      const before = itemHead();
      const res = await exec();

      expect(res).toMatchObject({ state: "blocked", stop: "plan_change_needed", retryable: false });
      expect(res.reason).toContain("files outside allowlist");
      expect(res.reason).toContain(path);
      expect(itemHead()).toBe(before);
      expect(state().state).toBe("blocked");
      expect(p.git(p.root, "log", "-1", "--format=%s", state().branch!)).not.toContain("task(");
      expect(existsSync(taskWorktree())).toBe(true);
    });
  }

  it("names a rename's old path when it is the one outside", async () => {
    await setup({ files: ["dest"] });
    await commitInItem("src/a.ts", "orig");
    p.cli.scenario("claude", { rename: { "src/a.ts": "dest/a.ts" } }, "TASK-001");
    const res = await exec();
    expect(res).toMatchObject({ state: "blocked", stop: "plan_change_needed" });
    expect(res.reason).toContain("src/a.ts");
    expect(res.reason).not.toContain("dest/a.ts");
  });

  it("skips the check when files are unknown", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001", files: [] }] });
    p.cli.scenario("claude", { write: { "anywhere/x.ts": "ok" } }, "TASK-001");
    const res = await exec();
    expect(res.state).toBe("done");
    expect(existsSync(join(p.worktreePath()!, "anywhere/x.ts"))).toBe(true);
  });
});

describe("verify.task (TC-018)", () => {
  it("resets to the pre-merge sha, fails with the output tail and passes it to the next manual run", async () => {
    await setup({}, { task: [["sh", "-c", "test -f src/a.ts && echo merged-present; echo boom-output; exit 1"]], stage: [["true"]] });
    p.cli.scenario("claude", { write: { "src/a.ts": "x" } }, "TASK-001");
    const before = itemHead();
    const res = await exec();

    expect(res).toMatchObject({ state: "failed", retryable: true });
    expect(res.reason).toContain("merged-present");
    expect(res.reason).toContain("boom-output");
    expect(res.failureForRetry).toBe(res.reason);
    expect(itemHead()).toBe(before);
    expect(state().preMergeSha).toBe(before);
    expect(existsSync(join(p.worktreePath()!, "src/a.ts"))).toBe(false);
    expect(existsSync(taskWorktree())).toBe(true);

    const second = await cmdRun(args("run", ["demo"], { task: "TASK-001" }), p.root);
    expect(second.code).toBe(1);
    const prompt = p.cli.prompt("claude");
    expect(prompt).toContain("The previous attempt failed:");
    expect(prompt).toContain("boom-output");
    expect(itemHead()).toBe(before);
  });

  it("fails a missing verify command with a not-found message", async () => {
    await setup({}, { task: [["no-such-cmd"]], stage: [["true"]] });
    p.cli.scenario("claude", { write: { "src/a.ts": "x" } }, "TASK-001");
    const before = itemHead();
    const res = await exec();
    expect(res).toMatchObject({ state: "failed", reason: "verify command not found: no-such-cmd", retryable: true });
    expect(itemHead()).toBe(before);
  });
});

describe("merge conflict (TC-019)", () => {
  it("aborts, blocks with the conflicting path and keeps the branch", async () => {
    await setup({ files: ["shared.txt"] });
    await commitInItem("shared.txt", "base");
    const wt = p.worktreePath()!;
    p.cli.scenario("claude", {
      write: { "shared.txt": "task" },
      script: `cd '${wt}' && printf item > shared.txt && git add shared.txt && git commit -qm item-change`,
    }, "TASK-001");
    const res = await exec();

    expect(res).toMatchObject({ state: "blocked", retryable: false });
    expect(res.stop).toBeUndefined();
    expect(res.reason).toBe("conflicts: shared.txt");
    expect(branches()).toContain(state().branch!);
    expect(existsSync(join(p.git(wt, "rev-parse", "--git-dir"), "MERGE_HEAD"))).toBe(false);
    expect(p.git(wt, "status", "--porcelain")).toBe("");
    expect(await readFile(join(wt, "shared.txt"), "utf8")).toBe("item");
  });
});

describe("dirty item worktree (TC-020)", () => {
  it("blocks when a tracked file is modified", async () => {
    await setup();
    await commitInItem("notes.md", "one");
    await writeFile(join(p.worktreePath()!, "notes.md"), "two");
    p.cli.scenario("claude", { write: { "src/a.ts": "x" } }, "TASK-001");
    const before = itemHead();
    const res = await exec();
    expect(res.state).toBe("blocked");
    expect(res.reason).toContain("item worktree has uncommitted changes");
    expect(res.reason).toContain("notes.md");
    expect(itemHead()).toBe(before);
  });

  it("merges past an untracked file and leaves it alone", async () => {
    await setup();
    await writeFile(join(p.worktreePath()!, "notes.tmp"), "scratch");
    p.cli.scenario("claude", { write: { "src/a.ts": "x" } }, "TASK-001");
    const res = await exec();
    expect(res.state).toBe("done");
    expect(await readFile(join(p.worktreePath()!, "notes.tmp"), "utf8")).toBe("scratch");
  });

  it("blocks with git's message when the merge would overwrite an untracked file", async () => {
    await setup({ files: ["src/new.ts"] });
    const wt = p.worktreePath()!;
    await mkdir(join(wt, "src"), { recursive: true });
    await writeFile(join(wt, "src/new.ts"), "mine");
    p.cli.scenario("claude", { write: { "src/new.ts": "theirs" } }, "TASK-001");
    const before = itemHead();
    const res = await exec();

    expect(res.state).toBe("blocked");
    expect(res.stop).toBeUndefined();
    expect(res.reason).toContain("src/new.ts");
    expect(res.reason).toContain("overwritten");
    expect(itemHead()).toBe(before);
    expect(existsSync(join(p.git(wt, "rev-parse", "--git-dir"), "MERGE_HEAD"))).toBe(false);
    expect(await readFile(join(wt, "src/new.ts"), "utf8")).toBe("mine");
  });
});

describe("recoverItemMerge (TC-025)", () => {
  async function inFlight(preMergeSha: string): Promise<void> {
    const harness = readProjectConfig(p.root).harness!;
    await setTaskState(p.root, "demo", harness, "TASK-001", { state: "merging", preMergeSha });
  }

  it("aborts a half-finished merge and sets the merging task back to verifying", async () => {
    await setup();
    await commitInItem("shared.txt", "base");
    const wt = p.worktreePath()!;
    const head = itemHead();
    const other = p.git(wt, "commit-tree", `${head}^{tree}`, "-p", head, "-m", "other");
    p.git(wt, "merge", "--no-ff", "--no-commit", other);
    const gitDir = p.git(wt, "rev-parse", "--git-dir");
    expect(existsSync(join(gitDir, "MERGE_HEAD"))).toBe(true);
    await inFlight(head);

    await recoverItemMerge(p.root, "demo");
    expect(existsSync(join(gitDir, "MERGE_HEAD"))).toBe(false);
    expect(itemHead()).toBe(head);
    expect(state().state).toBe("verifying");
    expect(state().reason).toContain("merge");
  });

  it("leaves HEAD alone and re-verifies when the merge had already landed", async () => {
    await setup();
    await commitInItem("shared.txt", "base");
    const head = itemHead();
    await inFlight(p.git(p.worktreePath()!, "rev-parse", "HEAD~1"));
    await recoverItemMerge(p.root, "demo");
    expect(itemHead()).toBe(head);
    expect(state().state).toBe("verifying");
  });
});

describe("merge lock wait (review FINDING-001)", () => {
  it("outlasts the holder's run timeout instead of the generic 30s lock wait", () => {
    expect(mergeLockWait(30 * 60_000)).toBe(30 * 60_000 + LOCK_TIMEOUT_MS);
    expect(mergeLockWait(60_000)).toBeGreaterThan(LOCK_TIMEOUT_MS);
    expect(mergeLockWait(0)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
