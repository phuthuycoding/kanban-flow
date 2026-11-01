import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, rename, writeFile, appendFile } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta, type Feature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { docsLandedProof, docsOnDefault, prepareCanonicalCopies, resolveDocsTarget, writeCanonicalCopies } from "../workflow/canonical-docs.js";

const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
[ "$1" = pr ] && [ "$2" = list ] && { echo '[]'; exit 0; }
exit 0
`;
const calls = (file: string): string[] => {
  try {
    return readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
};

const git = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let root: string;
let gitLog: string;
let prevPath: string | undefined;

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-docs-proof-")));
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
  // Logs every git spawn kf makes, then runs the real git.
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  gitLog = join(scratch, "git-calls.log");
  await writeFile(join(stubBin, "git"), `#!/usr/bin/env bash\necho "git $*" >> "${gitLog}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_CALLS = join(scratch, "gh-calls.log");
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_CALLS;
  await rm(scratch, { recursive: true, force: true });
});

const resetGitLog = (): Promise<void> => writeFile(gitLog, "");

/** A done item with every snapshot artifact, whose docs branch is gone here and on origin. */
async function goneItem(name: string, opts: { commit?: string } = {}): Promise<Feature> {
  expect((await cmdNew({ command: "new", positionals: [name], options: { context: "app" } }, root)).code).toBe(0);
  const dir = findFeature(root, name)!.dir;
  for (const id of ["spec-requirement", "use-case-specification", "use-case-diagram", "test-cases", "testing-result"] as const) {
    await writeFile(join(dir, ARTIFACTS[id].file), `---\nstatus: planning\n---\n# ${id} of ${name}\n`);
  }
  const done = join(root, ".works", "done", basename(dir));
  await rename(dir, done);
  await writeFeatureMeta(done, { ...readFeatureMeta(done)!, docsBranch: `docs/app-${name}`, ...(opts.commit ? { docsCommit: opts.commit } : {}) });
  return findFeature(root, name)!;
}

/** Commit `feature`'s canonical docs onto the default branch and push it; returns the commit. */
async function landDocs(feature: Feature, edit?: (paths: string[]) => Promise<void>): Promise<string> {
  const copies = prepareCanonicalCopies(root, feature);
  await writeCanonicalCopies(copies);
  if (edit) await edit(copies.map((c) => relative(root, c.destination)));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "docs");
  git(root, "push", "-q", "origin", "HEAD");
  return git(root, "rev-parse", "HEAD");
}

describe("docsOnDefault", () => {
  it("proves byte-identical docs on origin/<default> with one git spawn", async () => {
    const feature = await goneItem("demo");
    await landDocs(feature);
    const base = `origin/${git(root, "symbolic-ref", "--short", "HEAD")}`;
    await resetGitLog();
    expect(docsOnDefault(root, feature, base)).toBe(true);
    const spawns = calls(gitLog);
    expect(spawns).toHaveLength(1);
    expect(spawns[0]).toMatch(/ ls-tree -r -z origin\//);
  });

  it("is false when one doc on origin/<default> differs by one byte", async () => {
    const feature = await goneItem("demo");
    await landDocs(feature, async ([first]) => appendFile(join(root, first), "x"));
    expect(docsOnDefault(root, feature)).toBe(false);
  });

  it("is false when a doc is missing on origin/<default>", async () => {
    const feature = await goneItem("demo");
    await landDocs(feature, async (paths) => rm(join(root, paths[paths.length - 1])));
    expect(docsOnDefault(root, feature)).toBe(false);
  });
});

describe("docsLandedProof on a gone docs branch", () => {
  it("proves a recorded docs commit by ancestry before comparing content or asking gh", async () => {
    const draft = await goneItem("demo");
    const commit = await landDocs(draft, async ([first]) => appendFile(join(root, first), "edited on main\n"));
    const feature = await goneItem("other", { commit });
    await resetGitLog();

    expect(docsLandedProof(root, feature)).toEqual({ landed: true, by: "ancestor" });
    expect(calls(gitLog).map((c) => c.split(" ")[3]), "content is not compared").toEqual(["rev-parse", "symbolic-ref", "merge-base"]);
    expect(calls(process.env.GH_CALLS!)).toEqual([]);
  });

  it("names git remote set-head as the remedy when no docs commit was recorded and origin/HEAD is unset", async () => {
    const feature = await goneItem("demo");
    git(root, "remote", "set-head", "origin", "-d");

    expect(docsLandedProof(root, feature)).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      remedy: "git remote set-head origin -a",
      reason: "local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; "
        + "no docs commit was recorded and origin/HEAD is not set, so the docs on the default branch cannot be compared (set it: git remote set-head origin -a)",
    });
    expect(calls(process.env.GH_CALLS!)).toEqual([]);
  });

  it("names git remote set-head without asking gh when a docs commit was recorded and origin/HEAD is unset", async () => {
    const feature = await goneItem("demo", { commit: "a".repeat(40) });
    git(root, "remote", "set-head", "origin", "-d");

    expect(docsLandedProof(root, feature)).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      remedy: "git remote set-head origin -a",
      reason: "local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; "
        + "origin/HEAD is not set, so the docs on the default branch cannot be compared (set it: git remote set-head origin -a)",
    });
    expect(calls(process.env.GH_CALLS!)).toEqual([]);
  });

  it("names git remote add origin when there is no origin remote at all", async () => {
    const feature = await goneItem("demo", { commit: "a".repeat(40) });
    git(root, "remote", "remove", "origin");

    const proof = docsLandedProof(root, feature);
    expect(proof).toMatchObject({ landed: false, pushed: true, gone: true, remedy: "git remote add origin <url>" });
    expect(proof.landed === false && proof.reason).toContain("there is no origin remote");
    expect(calls(process.env.GH_CALLS!)).toEqual([]);
  });
});

describe("resolveDocsTarget without an origin remote", () => {
  it("refuses a branch-only target and names git remote add origin", async () => {
    const feature = await goneItem("demo");
    git(root, "remote", "remove", "origin");

    expect(resolveDocsTarget(root, feature, { branchOnly: "the rewrite must show in a PR diff" })).toEqual({
      kind: "refused",
      message: "there is no origin to cut a docs branch from (add it: git remote add origin <url>), and the rewrite must show in a PR diff.",
    });
  });
});
