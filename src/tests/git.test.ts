import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree, changedPathsSince, commitAll, currentBranch, deleteBranch, git, mergeAbort, mergeInProgress,
  mergeNoFf, pruneWorktrees, removeWorktree, resetHard, revParse, runGit, trackedChanges, untrackedFiles,
} from "../shared/git.js";

let scratch: string;
let repo: string;

const sh = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "pipe" });
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
}

const write = (rel: string, body: string) => writeFileSync(join(repo, rel), body);

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-git-"));
  repo = join(scratch, "repo");
  initRepo(repo);
  write("a.txt", "alpha\nalpha2\nalpha3\nalpha4\n");
  write("b.txt", "bravo\n");
  write("c.txt", "charlie\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", "init");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("runGit / git", () => {
  it("returns non-zero exits without throwing", () => {
    const res = runGit(repo, ["rev-parse", "--verify", "nope"]);
    expect(res.code).not.toBe(0);
    expect(() => git(repo, ["rev-parse", "--verify", "nope"])).toThrow(/fatal|Needed a single revision/);
  });

  it("revParse returns a sha or null; currentBranch reads the branch", () => {
    expect(revParse(repo, "HEAD")).toBe(sh(repo, "rev-parse", "HEAD"));
    expect(revParse(repo, "no-such-ref")).toBeNull();
    expect(currentBranch(repo)).toBe("main");
  });
});

describe("changes", () => {
  it("trackedChanges ignores untracked files", () => {
    write("new.txt", "x");
    expect(trackedChanges(repo)).toEqual([]);
    expect(untrackedFiles(repo)).toEqual(["new.txt"]);
    write("b.txt", "changed\n");
    write("c.txt", "staged\n");
    sh(repo, "add", "c.txt");
    expect(trackedChanges(repo).sort()).toEqual(["b.txt", "c.txt"]);
  });

  it("changedPathsSince covers edit, rename, delete, committed and untracked", () => {
    const base = sh(repo, "rev-parse", "HEAD");
    write("b.txt", "bravo edited\n");
    sh(repo, "commit", "-qam", "edit b");
    sh(repo, "mv", "a.txt", "a-renamed.txt");
    rmSync(join(repo, "c.txt"));
    write("untracked file.txt", "u");
    const changes = changedPathsSince(repo, base);
    expect(changes).toContainEqual({ status: "M", path: "b.txt" });
    expect(changes).toContainEqual({ status: "R", path: "a-renamed.txt", oldPath: "a.txt" });
    expect(changes).toContainEqual({ status: "D", path: "c.txt" });
    expect(changes).toContainEqual({ status: "A", path: "untracked file.txt" });
    expect(changes).toHaveLength(4);
  });
});

describe("commitAll", () => {
  it("commits with quotes and newlines intact", () => {
    write("n.txt", "n");
    const message = `feat: "quoted" 'single' $(echo hi) \`tick\`\n\nbody line 1\nbody line 2`;
    const res = commitAll(repo, message);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sha).toBe(sh(repo, "rev-parse", "HEAD"));
    expect(sh(repo, "log", "-1", "--format=%B").trim()).toBe(message);
    expect(trackedChanges(repo)).toEqual([]);
  });

  it("reports an error when there is nothing to commit", () => {
    const res = commitAll(repo, "empty");
    expect(res.ok).toBe(false);
  });
});

describe("merge", () => {
  it("mergeNoFf merges with a merge commit", () => {
    sh(repo, "checkout", "-q", "-b", "feat");
    write("f.txt", "feat\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "feat");
    sh(repo, "checkout", "-q", "main");
    write("m.txt", "main\n");
    sh(repo, "add", "-A");
    sh(repo, "commit", "-qm", "main");
    const res = mergeNoFf(repo, "feat", "merge feat");
    expect(res).toEqual({ ok: true, sha: sh(repo, "rev-parse", "HEAD") });
    expect(sh(repo, "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3);
    expect(sh(repo, "log", "-1", "--format=%s")).toBe("merge feat");
  });

  it("conflict returns paths and keeps MERGE_HEAD until mergeAbort", () => {
    sh(repo, "checkout", "-q", "-b", "feat");
    write("b.txt", "feat side\n");
    sh(repo, "commit", "-qam", "feat");
    sh(repo, "checkout", "-q", "main");
    write("b.txt", "main side\n");
    sh(repo, "commit", "-qam", "main");
    const before = sh(repo, "rev-parse", "HEAD");
    const res = mergeNoFf(repo, "feat", "merge feat");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflicts).toEqual(["b.txt"]);
    expect(mergeInProgress(repo)).toBe(true);
    mergeAbort(repo);
    expect(mergeInProgress(repo)).toBe(false);
    expect(sh(repo, "rev-parse", "HEAD")).toBe(before);
  });

  it("resetHard restores a prior sha", () => {
    const base = sh(repo, "rev-parse", "HEAD");
    write("b.txt", "later\n");
    sh(repo, "commit", "-qam", "later");
    resetHard(repo, base);
    expect(sh(repo, "rev-parse", "HEAD")).toBe(base);
    expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("bravo\n");
  });
});

describe("worktrees", () => {
  it("addWorktree from a ref, then remove, delete branch and prune", () => {
    const wt = join(scratch, "wt");
    const base = sh(repo, "rev-parse", "HEAD");
    addWorktree(repo, wt, "task-branch", base);
    expect(existsSync(join(wt, "a.txt"))).toBe(true);
    expect(currentBranch(wt)).toBe("task-branch");
    removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
    deleteBranch(repo, "task-branch");
    expect(revParse(repo, "task-branch")).toBeNull();
    pruneWorktrees(repo);
  });

  it("removeWorktree force removes a dirty worktree", () => {
    const wt = join(scratch, "wt2");
    addWorktree(repo, wt, "dirty-branch", "HEAD");
    writeFileSync(join(wt, "a.txt"), "dirty\n");
    expect(() => removeWorktree(repo, wt)).toThrow();
    removeWorktree(repo, wt, { force: true });
    expect(existsSync(wt)).toBe(false);
  });

  it("refuses option-like branch and ref names", () => {
    expect(() => addWorktree(repo, join(scratch, "x"), "-x", "HEAD")).toThrow(/unsafe/);
    expect(() => addWorktree(repo, join(scratch, "x"), "ok", "--detach")).toThrow(/unsafe/);
    expect(() => deleteBranch(repo, "-x")).toThrow(/unsafe/);
    expect(() => mergeNoFf(repo, "-x", "m")).toThrow(/unsafe/);
    expect(() => changedPathsSince(repo, "-x")).toThrow(/unsafe/);
    expect(revParse.bind(null, repo, "-x")).toThrow(/unsafe/);
    expect(existsSync(join(scratch, "x"))).toBe(false);
  });
});
