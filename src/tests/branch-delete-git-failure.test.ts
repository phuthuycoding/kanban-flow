import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteItemBranch } from "../worktree/lifecycle.js";

let root: string;
let sha: string;
const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-branch-git-failure-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  git(root, "branch", "t/demo");
  sha = git(root, "rev-parse", "t/demo");
  // A remote url with no value: `git remote` (and every remote command) fails, while local ref commands still work.
  await appendFile(join(root, ".git", "config"), '[remote "origin"]\n\turl\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("deleteItemBranch when `git remote` fails", () => {
  it("deletes the local branch and reports the remote failure instead of throwing", () => {
    const res = deleteItemBranch(root, "t/demo", { kind: "merged-head", sha });
    expect(res.local).toEqual({ kind: "deleted" });
    expect(res.remote.kind).toBe("refused");
    expect(res.remote).toMatchObject({ detail: expect.stringContaining("git remote failed") });
  });

  it("keeps an unproven branch and reports why origin could not be checked instead of throwing", () => {
    const res = deleteItemBranch(root, "t/demo", { kind: "none", detail: "forced close" });
    expect(res.local).toEqual({ kind: "kept", detail: "forced close" });
    expect(res.remote.kind).toBe("kept");
    expect(res.remote).toMatchObject({ detail: expect.stringMatching(/^forced close \(origin could not be probed: git remote failed/) });
  });
});
