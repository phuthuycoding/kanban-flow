import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { syncBase } from "../project/base-sync.js";
import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const commit = (dir: string, name: string, content: string) => {
  writeFileSync(join(dir, name), content);
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", dir, "commit", "-qm", name], { stdio: "pipe" });
};

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let scratch: string;
let remote: string; // the "origin" working repo — commits land here first
let root: string;   // the clone the pipeline runs in

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-sync-"));
  remote = join(scratch, "remote");
  root = join(scratch, "repo");
  await mkdir(remote, { recursive: true });
  execFileSync("git", ["init", "-q", remote], { stdio: "pipe" });
  execFileSync("git", ["-C", remote, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", remote, "config", "user.name", "t"], { stdio: "pipe" });
  commit(remote, "a.txt", "one");
  commit(remote, ".gitignore", ".works/\n"); // kf projects gitignore .works/ — keep the clone porcelain-clean
  execFileSync("git", ["clone", "-q", remote, root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "pipe" });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const head = () => git(root, "rev-parse", "HEAD");

describe("syncBase", () => {
  it("fast-forwards a clean behind checkout to upstream", () => {
    commit(remote, "b.txt", "two");
    const res = syncBase(root);
    expect(res).toMatchObject({ status: "synced", behind: 1 });
    expect(res.note).toContain("fast-forwarded 1 commit");
    expect(head()).toBe(git(remote, "rev-parse", "HEAD"));
  });

  it("reports clean when already at the tip", () => {
    expect(syncBase(root)).toMatchObject({ status: "clean", behind: 0 });
  });

  it("warns and does not touch a dirty working tree", () => {
    commit(remote, "b.txt", "two");
    writeFileSync(join(root, "wip.txt"), "uncommitted");
    const before = head();
    const res = syncBase(root);
    expect(res.status).toBe("dirty");
    expect(res.warning).toContain("1 commit(s) behind");
    expect(head()).toBe(before);
  });

  it("warns on a diverged branch and does not merge", () => {
    commit(root, "local.txt", "mine"); // ahead, unpushed
    commit(remote, "b.txt", "theirs"); // upstream moved too
    const before = head();
    const res = syncBase(root);
    expect(res.status).toBe("diverged");
    expect(res.warning).toMatch(/behind.*unpushed/);
    expect(head()).toBe(before);
  });

  it("skips a repo with no remote at all", async () => {
    const lone = join(scratch, "lone");
    await mkdir(lone, { recursive: true });
    execFileSync("git", ["init", "-q", lone], { stdio: "pipe" });
    execFileSync("git", ["-C", lone, "config", "user.email", "t@t"], { stdio: "pipe" });
    execFileSync("git", ["-C", lone, "config", "user.name", "t"], { stdio: "pipe" });
    commit(lone, "a.txt", "x");
    expect(syncBase(lone)).toMatchObject({ status: "noRemote" });
  });

  it("warns instead of hanging when the remote is unreachable", () => {
    git(root, "remote", "set-url", "origin", join(scratch, "gone.git"));
    commit(remote, "b.txt", "two");
    const res = syncBase(root);
    expect(res.status).toBe("fetchFailed");
    expect(res.warning).toContain("could not reach");
  });

  it("skips a detached HEAD", () => {
    git(root, "checkout", "--detach");
    expect(syncBase(root).status).toBe("detached");
  });

  it("falls back to origin/HEAD when the branch has no upstream", () => {
    const branch = git(root, "symbolic-ref", "--short", "HEAD");
    git(root, "config", "--unset", `branch.${branch}.remote`);
    git(root, "config", "--unset", `branch.${branch}.merge`);
    commit(remote, "b.txt", "two");
    const res = syncBase(root);
    expect(res.status).toBe("synced");
    expect(head()).toBe(git(remote, "rev-parse", "HEAD"));
  });
});

describe("stage transition syncs the base first", () => {
  it("stage → planning fast-forwards the checkout before the move", async () => {
    ensureWorksStructure(root);
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const f = findFeature(root, "demo")!;
    await writeFile(join(f.dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\n---\n# Req\n## FR-001\nx\n## Affected surfaces\nN/A");

    commit(remote, "new-code.ts", "export const n = 1");
    const res = await cmdStage(args("stage", ["demo", "planning"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("synced base");
    expect(head()).toBe(git(remote, "rev-parse", "HEAD"));
    // the survey now sees the freshly synced code
    expect(() => git(root, "cat-file", "-e", "HEAD:new-code.ts")).not.toThrow();
  });

  it("stage → planning warns but proceeds when the tree is dirty", async () => {
    ensureWorksStructure(root);
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const f = findFeature(root, "demo")!;
    await writeFile(join(f.dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\n---\n# Req\n## FR-001\nx\n## Affected surfaces\nN/A");

    commit(remote, "b.txt", "two");
    writeFileSync(join(root, "dirty.txt"), "wip");
    const before = head();
    const res = await cmdStage(args("stage", ["demo", "planning"]), root);
    expect(res.code, res.stdout).toBe(0); // warn-and-proceed
    expect(res.stdout).toContain("⚠");
    expect(res.stdout).toContain("1 commit(s) behind");
    expect(head()).toBe(before);
  });
});
