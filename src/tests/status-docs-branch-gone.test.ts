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
if [ -n "$GH_FAIL" ]; then echo "gh: not logged in" >&2; exit 1; fi
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
  delete process.env.GH_FAIL;
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

const rerun = (name: string, cmd = "kf status --all") =>
  `re-run ${cmd} once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive ${name}`;

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
    expect(json.needsYou[0].decision).toMatch(/^run git remote set-head origin -a first, then re-run kf status --all: canonical docs for demo are not proven landed \(.*origin\/HEAD is not set.*\); if they still are not, re-land them on a fresh docs branch for a PR with kf archive demo, or leave them$/);
    expect(json.needsYou[0].decision).not.toContain("never landed");
    expect(ghCalls()).toEqual([]);
  });

  it("names the set-head command first in status and doctor, without asking gh, when a docs commit was recorded and origin/HEAD is unset", async () => {
    await goneItem("demo", { commit: true });
    git(root, "remote", "set-head", "origin", "-d");

    const json = JSON.parse((await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root)).stdout) as {
      needsYou: Array<{ feature: string; decision: string }>; waitingToMerge: unknown[];
    };
    expect(json.waitingToMerge).toEqual([]);
    expect(json.needsYou).toHaveLength(1);
    expect(json.needsYou[0].decision).toMatch(/^run git remote set-head origin -a first, then re-run kf status --all: canonical docs for demo are not proven landed \(.*origin\/HEAD is not set.*\); if they still are not, re-land them on a fresh docs branch for a PR with kf archive demo, or leave them$/);
    expect(json.needsYou[0].decision).not.toContain("never landed");

    const text = (await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root)).stdout;
    expect(text).toContain("  demo — run git remote set-head origin -a first, then re-run kf status --all: canonical docs for demo are not proven landed (");
    expect(text).not.toContain("never landed");

    const found = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(found.map((f) => f.action)).toEqual(["git remote set-head origin -a, then re-run kf doctor"]);
    expect(found[0].message).toMatch(/^docs_branch_unpushed: canonical docs for demo were committed to docs\/app-demo, which is gone here, and are not proven landed \(.*origin\/HEAD is not set.*\)\.$/);
    expect(`${found[0].message} ${found[0].action}`).not.toContain("never landed");
    expect(ghCalls()).toEqual([]);
  });

  it("names adding an origin first in status and doctor, without asking gh, when there is no origin remote", async () => {
    await goneItem("demo", { commit: true });
    git(root, "remote", "remove", "origin");

    const json = JSON.parse((await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root)).stdout) as {
      needsYou: Array<{ feature: string; decision: string }>; waitingToMerge: unknown[];
    };
    expect(json.waitingToMerge).toEqual([]);
    expect(json.needsYou).toHaveLength(1);
    expect(json.needsYou[0].decision).toMatch(/^run git remote add origin <url> first, then re-run kf status --all: canonical docs for demo are not proven landed \(.*there is no origin remote.*\); if they still are not, re-land them on a fresh docs branch for a PR with kf archive demo, or leave them$/);
    expect(json.needsYou[0].decision).not.toContain("never landed");

    const found = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(found.map((f) => f.action)).toEqual(["git remote add origin <url>, then re-run kf doctor"]);
    expect(ghCalls()).toEqual([]);
  });

  it("gives the same re-run-or-re-land step as kf doctor when the merged-PR lookup could not run", async () => {
    await goneItem("demo", { commit: true });
    process.env.GH_FAIL = "1";

    const json = JSON.parse((await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root)).stdout) as {
      needsYou: unknown[]; waitingToMerge: Array<{ feature: string; command: string; kind?: string; next?: string }>;
    };
    expect(json.needsYou).toEqual([]);
    expect(json.waitingToMerge.map((w) => w.command), "the command stays runnable").toEqual(["kf status --all"]);
    expect(json.waitingToMerge.map((w) => [w.kind, w.next])).toEqual([["lookup-rerun", rerun("demo")]]);
    const text = (await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root)).stdout;
    const line = text.split("\n").find((l) => l.startsWith("  demo — docs/app-demo not proven merged ("));
    expect(line).toContain("gh pr list failed");
    expect(line?.endsWith(`): ${json.waitingToMerge[0].next}`), line).toBe(true);

    const found = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(found.map((f) => f.action)).toEqual([`nothing to push; ${rerun("demo", "kf doctor")}`]);
  });

  it("skips the remaining docs-branch lookups after the first gh timeout", async () => {
    await goneItem("one", { commit: true });
    await goneItem("two", { commit: true });
    process.env.GH_SLEEP = "20";

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true } }, root);
    const lookups = ghCalls().filter((c) => c.startsWith("gh pr list"));
    expect(lookups, "the second branch makes no gh call").toHaveLength(1);
    const [first, second] = lookups[0].includes("docs/app-one") ? ["one", "two"] : ["two", "one"];
    expect(res.stdout).toContain(`${first} — docs/app-${first} not proven merged (local branch docs/app-${first} is gone and there is no remote-tracking ref for it here, so there is nothing to push; gh pr list failed: gh pr list timed out after 15000 ms): ${rerun(first)}`);
    expect(res.stdout).toContain(`${second} — docs/app-${second} not proven merged (local branch docs/app-${second} is gone and there is no remote-tracking ref for it here, so there is nothing to push; the merged-PR lookup was skipped after a gh timeout in this run): ${rerun(second)}`);
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
    expect(found[0].message).toContain("are not proven landed (");
    expect(found[0].message).not.toContain("never landed");
  });
});
