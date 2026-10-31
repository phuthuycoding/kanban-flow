import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, rename, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

const GH_STUB = `#!/usr/bin/env bash
[ "$1" = pr ] && [ "$2" = list ] && { echo '[]'; exit 0; }
exit 0
`;

const git = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let root: string;
let prevPath: string | undefined;

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-docs-gone-")));
  root = join(scratch, "repo");
  const origin = join(scratch, "origin.git");
  await mkdir(root, { recursive: true });
  git(scratch, "init", "-q", root);
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n.kf/\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const branch = git(root, "symbolic-ref", "--short", "HEAD");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "-u", "origin", branch);
  git(origin, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "remote", "set-head", "origin", branch);
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
  const stubBin = join(scratch, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(scratch, { recursive: true, force: true });
});

describe("kf status --all on a docs branch gone locally and on origin", () => {
  it("lists it with why it is unproven instead of dropping it", async () => {
    expect((await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root)).code).toBe(0);
    const dir = findFeature(root, "demo")!.dir;
    const done = join(root, ".works", "done", basename(dir));
    await rename(dir, done);
    await writeFeatureMeta(done, { ...readFeatureMeta(done)!, docsBranch: "docs/app-demo" });

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root);
    expect(res.stdout).toContain("demo — docs/app-demo not proven merged (local branch docs/app-demo is gone and it is not on origin, so there is nothing to push; no merged PR has docs/app-demo as its head): remove docsBranch from ");
    expect(res.stdout).not.toContain("git push -u origin docs/app-demo");
  });
});
