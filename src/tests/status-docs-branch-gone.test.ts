import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { runDoctor } from "../project/doctor.js";

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
if [ -n "$GH_SLEEP" ]; then sleep "$GH_SLEEP"; fi
[ "$1" = pr ] && [ "$2" = list ] && { echo '[]'; exit 0; }
exit 0
`;
const ghCalls = (): string[] => {
  try {
    return readFileSync(process.env.GH_CALLS!, "utf8").trim().split("\n").filter(Boolean);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

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
  process.env.GH_CALLS = join(scratch, "gh-calls.log");
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_CALLS;
  delete process.env.GH_SLEEP;
  await rm(scratch, { recursive: true, force: true });
});

/**
 * A done item whose meta names a docs branch that exists neither here nor on origin. With
 * `commit`, the close recorded a docs commit (one that never reached origin); without, it is an
 * item closed before docsCommit existed.
 */
async function goneItem(name: string, opts: { commit?: boolean } = {}): Promise<void> {
  expect((await cmdNew({ command: "new", positionals: [name], options: { context: "app" } }, root)).code).toBe(0);
  const dir = findFeature(root, name)!.dir;
  const done = join(root, ".works", "done", basename(dir));
  await rename(dir, done);
  const docsCommit = opts.commit ? git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", `docs ${name}`) : undefined;
  await writeFeatureMeta(done, { ...readFeatureMeta(done)!, docsBranch: `docs/app-${name}`, ...(docsCommit ? { docsCommit } : {}) });
}

const base = () => `origin/${git(root, "symbolic-ref", "--short", "HEAD")}`;
const neverLanded = (name: string) => `canonical docs for ${name} never landed (local branch docs/app-${name} is gone and there is no remote-tracking ref for it here, so there is nothing to push; `
  + `no docs commit was recorded and ${base()} does not hold these docs): re-land them on a fresh docs branch for a PR with kf archive ${name}, or leave them`;

describe("kf status --all on a docs branch gone locally and on origin", () => {
  it("puts it under Needs you as a re-land decision, not under Waiting to merge, without asking gh when no docs commit was recorded", async () => {
    await goneItem("demo");

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root);
    const tail = res.stdout.slice(res.stdout.lastIndexOf("Needs you"));
    expect(tail).toBe([
      "Needs you",
      `  demo — ${neverLanded("demo")}`,
      "Waiting to merge",
      "  (none)",
      "Running: 0",
    ].join("\n"));

    const json = JSON.parse((await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root)).stdout) as {
      needsYou: Array<{ feature: string; decision: string }>; waitingToMerge: unknown[];
    };
    expect(json.waitingToMerge).toEqual([]);
    expect(json.needsYou).toEqual([{ feature: "demo", decision: neverLanded("demo") }]);
    expect(ghCalls()).toEqual([]);
  });

  it("names the merged-PR lookup when a docs commit was recorded", async () => {
    await goneItem("demo", { commit: true });

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root);
    expect(res.stdout).toContain("  demo — canonical docs for demo never landed (local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; "
      + "no merged PR has docs/app-demo as its head): re-land them on a fresh docs branch for a PR with kf archive demo, or leave them");
    expect(ghCalls()).toEqual(["gh pr list -R o/r --head docs/app-demo --state merged --json number,headRefOid"]);
  });

  it("names the set-head command first when origin/HEAD is unset and no docs commit was recorded", async () => {
    await goneItem("demo");
    git(root, "remote", "set-head", "origin", "-d");

    const json = JSON.parse((await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root)).stdout) as {
      needsYou: Array<{ feature: string; decision: string }>; waitingToMerge: unknown[];
    };
    expect(json.waitingToMerge).toEqual([]);
    expect(json.needsYou).toHaveLength(1);
    expect(json.needsYou[0].decision).toMatch(/^canonical docs for demo never landed \(.*origin\/HEAD is not set.*\): run git remote set-head origin -a first, then re-land them on a fresh docs branch for a PR with kf archive demo, or leave them$/);
    expect(ghCalls()).toEqual([]);
  });

  it("skips the remaining docs-branch lookups after the first gh timeout", async () => {
    await goneItem("one", { commit: true });
    await goneItem("two", { commit: true });
    process.env.GH_SLEEP = "20";

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root);
    const lookups = ghCalls().filter((c) => c.startsWith("gh pr list"));
    expect(lookups, "the second branch makes no gh call").toHaveLength(1);
    const [first, second] = lookups[0].includes("docs/app-one") ? ["one", "two"] : ["two", "one"];
    expect(res.stdout).toContain(`${first} — docs/app-${first} not proven merged (local branch docs/app-${first} is gone and there is no remote-tracking ref for it here, so there is nothing to push; gh pr list failed: gh pr list timed out after 15000 ms): kf status --all`);
    expect(res.stdout).toContain(`${second} — docs/app-${second} not proven merged (local branch docs/app-${second} is gone and there is no remote-tracking ref for it here, so there is nothing to push; the merged-PR lookup was skipped after a gh timeout in this run): kf status --all`);
    expect(res.stdout, "a branch that does not exist is never offered for a push").not.toContain("git push");
  }, 40_000);
});

describe("kf doctor on a docs branch gone locally and on origin", () => {
  it("says nothing proves the docs landed and gives the same re-land-or-leave decision as kf status", async () => {
    await goneItem("demo", { commit: true });
    const found = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(found.map((f) => f.message)).toEqual([
      "docs_branch_unpushed: canonical docs for demo were committed to docs/app-demo, which is gone here, and nothing proves they landed "
        + "(local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; no merged PR has docs/app-demo as its head).",
    ]);
    expect(found[0].action).toBe("canonical docs for demo never landed: re-land them on a fresh docs branch for a PR with kf archive demo, or leave them");
    expect(readFeatureMeta(findFeature(root, "demo")!.dir)!.docsBranch, "doctor writes nothing").toBe("docs/app-demo");
  });

  it("gives the set-head command as the action when origin/HEAD is unset and no docs commit was recorded", async () => {
    await goneItem("demo");
    git(root, "remote", "set-head", "origin", "-d");
    const found = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(found.map((f) => f.action)).toEqual(["git remote set-head origin -a, then re-run kf doctor"]);
    expect(found[0].message).toContain("origin/HEAD is not set");
  });
});
