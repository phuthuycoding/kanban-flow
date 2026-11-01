import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasRemote } from "../shared/git.js";

const git = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-has-remote-")));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("hasRemote", () => {
  it("is true for a configured remote and false for a missing one", () => {
    const repo = join(scratch, "repo");
    git(scratch, "init", "-q", repo);
    expect(hasRemote(repo, "origin")).toBe(false);
    git(repo, "remote", "add", "origin", join(scratch, "origin.git"));
    expect(hasRemote(repo, "origin")).toBe(true);
  });

  it("throws with git's exit and stderr outside a repository", () => {
    expect(() => hasRemote(scratch, "origin")).toThrow(/git remote failed \(exit 128\) in .*: fatal: not a git repository/);
  });

  it("throws instead of reporting no remote when the git config is broken", async () => {
    const repo = join(scratch, "repo");
    git(scratch, "init", "-q", repo);
    await appendFile(join(repo, ".git", "config"), "[broken\n");
    expect(() => hasRemote(repo, "origin")).toThrow(/git remote failed \(exit 128\).*bad config line/);
  });
});
