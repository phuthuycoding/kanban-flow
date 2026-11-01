import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Which remote git subcommand the mocked spawnSync makes hang, and with what spawn error code. */
const hang = vi.hoisted(() => ({ subcommand: "", code: "ETIMEDOUT", lsRemoteSha: "" }));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((cmd: string, args: string[], opts: object) => {
      const sub = args[2];
      if (sub === "ls-remote" && hang.lsRemoteSha && hang.subcommand !== "ls-remote") {
        return { status: 0, stdout: `${hang.lsRemoteSha}\trefs/heads/t/demo\n`, stderr: "", error: undefined };
      }
      if (sub === hang.subcommand) {
        return { status: null, signal: "SIGTERM", stdout: "", stderr: "", error: Object.assign(new Error(`spawnSync git ${hang.code}`), { code: hang.code }) };
      }
      return actual.spawnSync(cmd, args, opts);
    }) as typeof actual.spawnSync,
  };
});

const { deleteRemoteBranch } = await import("../shared/git.js");
const { deleteItemBranch } = await import("../worktree/lifecycle.js");

let root: string;
const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-remote-timeout-")));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  git(root, "commit", "-q", "--allow-empty", "-m", "init");
  git(root, "branch", "t/demo");
  // Only configured, never contacted: every call that would reach it is mocked.
  git(root, "remote", "add", "origin", "https://unreachable.invalid/r.git");
  Object.assign(hang, { subcommand: "", code: "ETIMEDOUT", lsRemoteSha: "" });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a remote that does not answer within the timeout", () => {
  it("deleting the origin branch reports a hung probe as refused instead of throwing", () => {
    hang.subcommand = "ls-remote";
    const sha = git(root, "rev-parse", "t/demo");
    expect(deleteRemoteBranch(root, "origin", "t/demo", sha)).toEqual({ kind: "refused", detail: "git ls-remote timed out after 30s" });
  });

  it("deleting the origin branch reports a hung push as refused instead of throwing", () => {
    const sha = git(root, "rev-parse", "t/demo");
    Object.assign(hang, { subcommand: "push", lsRemoteSha: sha });
    expect(deleteRemoteBranch(root, "origin", "t/demo", sha)).toEqual({ kind: "refused", detail: "git push timed out after 30s" });
  });

  it("a branch kept without proof says origin could not be probed", () => {
    hang.subcommand = "ls-remote";
    const deletion = deleteItemBranch(root, "t/demo", { kind: "none", detail: "no proof" });
    expect(deletion.remote).toEqual({ kind: "kept", detail: "no proof (origin could not be probed: git ls-remote timed out after 30s)" });
    expect(deletion.local).toEqual({ kind: "kept", detail: "no proof" });
  });

  it("a git that cannot spawn at all still throws", () => {
    Object.assign(hang, { subcommand: "ls-remote", code: "ENOENT" });
    expect(() => deleteRemoteBranch(root, "origin", "t/demo", git(root, "rev-parse", "t/demo"))).toThrow(/could not run/);
  });
});
