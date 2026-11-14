import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { changedFileCount } from "../shared/git.js";
import type { FilesChanged } from "../workflow/features.js";
import { itemLogPath, readItemLog } from "../workflow/item-log.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import { grantStageWaiver } from "./support/stage-waiver.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import type { ParsedArgs } from "../cli/args.js";

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// The item was just created by cmdNew, so a missing one is a test setup failure the next line would surface.
const feature = (name = "demo") => findFeature(root, name)!;
const snapshot = (): Record<string, unknown> => JSON.parse(readFileSync(join(feature().dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
const confirmed = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-q", dir], { stdio: "pipe" });
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, ".gitignore"), ".works/\n.kf/\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
}

async function configure(worktree: boolean): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261114_0256", defaultContext: "cli",
    worktree: { enabled: worktree, baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") },
    harness: { main: "lead", roles: { lead: { runner: "claude" } }, runners: { claude: { start: ["claude", "{prompt}"] } } },
  }));
}

async function implementationItem(): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature().dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  const res = await cmdApprove(args("approve", ["demo"]), root);
  expect(res.code, res.stdout).toBe(0);
  expect(feature().stage).toBe("implementation");
}

/** Move implementation -> testing -> review with a passing testing result. */
async function enterReview(): Promise<void> {
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["testing-result"].file),
    `---\nstatus: PASS\nexecution: ${readFeatureMeta(feature().dir)!.executionId}\n---\n# Evidence\nVerified.\n${evidence}`);
  await grantStageWaiver(root, "demo");
  const res = await cmdStage(args("stage", ["demo", "review"]), root);
  expect(res.code, res.stdout).toBe(0);
  expect(feature().stage).toBe("review");
}

/** Commit `n` distinct new files on the item's worktree branch. */
function commitFiles(wtPath: string, names: string[]): void {
  for (const n of names) writeFileSync(join(wtPath, n), `${n}\n`);
  git(wtPath, "add", "-A");
  git(wtPath, "commit", "-qm", `add ${names.join(",")}`);
}

const filesChangedOf = (meta: Record<string, unknown>) => meta.filesChanged as FilesChanged; // the record is JSON read back from disk
const stageRecords = (): Array<{ event: string; stage?: string; set?: Record<string, unknown> }> =>
  readFileSync(itemLogPath(feature().dir), "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as { event: string; stage?: string; set?: Record<string, unknown> });

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-files-changed-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  initRepo(root);
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("changedFileCount", () => {
  it("counts the files a branch changed against the root HEAD when there is no origin", () => {
    git(root, "checkout", "-q", "-b", "work");
    commitFiles(root, ["a.txt", "b.txt", "c.txt"]);
    git(root, "checkout", "-q", "-");
    expect(changedFileCount(root, "work")).toEqual({ count: 3 });
  });

  it("counts a file changed twice once", () => {
    git(root, "checkout", "-q", "-b", "work");
    commitFiles(root, ["a.txt"]);
    writeFileSync(join(root, "a.txt"), "again\n");
    git(root, "commit", "-qam", "touch again");
    git(root, "checkout", "-q", "-");
    expect(changedFileCount(root, "work")).toEqual({ count: 1 });
  });

  it("returns null with a reason instead of throwing for a branch that does not exist", () => {
    const res = changedFileCount(root, "no-such-branch");
    if (res.count !== null) throw new Error(`expected no count, got ${res.count}`);
    expect(res.reason).toEqual(expect.any(String));
    expect(res.reason).not.toBe("");
  });

  it("returns null with a reason instead of throwing outside a git repository", async () => {
    const plain = join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    const res = changedFileCount(plain, "work");
    if (res.count !== null) throw new Error(`expected no count, got ${res.count}`);
    expect(res.reason).toBeTruthy();
  });
});

describe("entering review", () => {
  it("records the count of files the worktree branch changed in the metadata and the stage record", async () => {
    await configure(true);
    await implementationItem();
    const wt = feature().meta!.worktree!; // configure(true) registers a worktree on approve
    commitFiles(wt.path, ["a.txt", "b.txt", "c.txt"]);

    await enterReview();

    const fc = filesChangedOf(snapshot());
    expect(fc.count).toBe(3);
    expect(fc.reason).toBeUndefined();
    expect(Number.isNaN(Date.parse(fc.at))).toBe(false);
    const review = stageRecords().filter((r) => r.event === "stage" && r.stage === "review");
    expect(review).toHaveLength(1);
    expect(filesChangedOf(review[0].set ?? {}).count).toBe(3);
  });

  it("appends a new count on a second entry and the folded log gives the latest", async () => {
    await configure(true);
    await implementationItem();
    const wt = feature().meta!.worktree!; // configure(true) registers a worktree on approve
    commitFiles(wt.path, ["a.txt", "b.txt", "c.txt"]);
    await enterReview();

    // leaving review needs a review report; a FAIL verdict sends the item back to implementation
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: FAIL\nexecution: ${readFeatureMeta(feature().dir)!.executionId}\nci: none\nlanding: none\n${REVIEW_DOCS_NONE}---\n# Evidence\nNeeds one more file.\n`);
    const back = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(back.code, back.stdout).toBe(0);
    commitFiles(wt.path, ["d.txt"]);
    await enterReview();

    expect(filesChangedOf(snapshot()).count).toBe(4);
    const review = stageRecords().filter((r) => r.event === "stage" && r.stage === "review");
    expect(review.map((r) => filesChangedOf(r.set ?? {}).count)).toEqual([3, 4]);
    const folded = readItemLog(feature().dir);
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      expect(folded.state).not.toBeNull();
      expect(filesChangedOf((folded.state?.meta ?? {}) as Record<string, unknown>).count).toBe(4);
    }
  });

  it("records null with a reason and still moves to review when the count cannot be made", async () => {
    await configure(false); // no worktree, and the repository has no origin
    await implementationItem();

    await enterReview();

    const fc = filesChangedOf(snapshot());
    expect(fc.count).toBeNull();
    expect(fc.reason).toEqual(expect.any(String));
    expect(fc.reason).not.toBe("");
    expect(feature().stage).toBe("review");
    const review = stageRecords().filter((r) => r.event === "stage" && r.stage === "review");
    expect(filesChangedOf(review[0].set ?? {}).count).toBeNull();
  });
});

/** A bare origin with origin/HEAD set to its default branch, as a clone has it. */
function addOrigin(): void {
  const bare = join(scratch, "origin.git");
  execFileSync("git", ["init", "-q", "--bare", bare], { stdio: "pipe" });
  git(root, "branch", "-M", "main");
  git(root, "remote", "add", "origin", bare);
  git(root, "push", "-q", "origin", "main");
  git(root, "fetch", "-q", "origin");
  git(root, "remote", "set-head", "origin", "main");
}

describe("entering review without a worktree", () => {
  it("counts the checkout branch against origin's default branch", async () => {
    addOrigin();
    await configure(false);
    await implementationItem();
    git(root, "checkout", "-q", "-b", "work");
    commitFiles(root, ["a.txt", "b.txt", "c.txt", "d.txt"]);

    await enterReview();

    const fc = filesChangedOf(snapshot());
    expect(fc.count).toBe(4);
    expect(fc.reason).toBeUndefined();
  });

  it("records null with a reason and still moves on a detached HEAD", async () => {
    addOrigin();
    await configure(false);
    await implementationItem();
    git(root, "checkout", "-q", "--detach");

    await enterReview();

    const fc = filesChangedOf(snapshot());
    expect(fc.count).toBeNull();
    expect(fc.reason).toEqual(expect.any(String));
    expect(fc.reason).not.toBe("");
    expect(feature().stage).toBe("review");
  });
});

describe("a git failure while counting", () => {
  it("records a fixed reason with no path and still moves to review", async () => {
    addOrigin();
    await configure(true);
    await implementationItem();
    const wt = feature().meta!.worktree!; // configure(true) registers a worktree on approve
    commitFiles(wt.path, ["a.txt"]);
    // A symbolic ref aimed outside refs/ makes git fail on the origin/HEAD lookup rather than report it unset.
    writeFileSync(join(root, ".git", "refs", "remotes", "origin", "HEAD"), "ref: /etc/passwd\n");

    await enterReview();

    const fc = filesChangedOf(snapshot());
    expect(fc.count).toBeNull();
    expect(fc.reason).toBe("git could not count the changed files");
    expect(fc.reason).not.toContain(scratch);
    expect(fc.reason).not.toContain(tmpdir());
    expect(fc.reason).not.toMatch(/\/(home|tmp|var|root)\//);
  });
});

describe("renames", () => {
  function renameOnly(): void {
    writeFileSync(join(root, "old.txt"), "some content that stays the same across the rename\n".repeat(5));
    git(root, "add", "-A");
    git(root, "commit", "-qm", "add old");
    git(root, "checkout", "-q", "-b", "work");
    git(root, "mv", "old.txt", "new.txt");
    git(root, "commit", "-qm", "rename");
    git(root, "checkout", "-q", "-");
  }

  it("counts a rename as its old and new path", () => {
    renameOnly();
    expect(changedFileCount(root, "work")).toEqual({ count: 2 });
  });

  it("counts the same when the machine's git config follows renames", () => {
    renameOnly();
    git(root, "config", "diff.renames", "true");
    expect(changedFileCount(root, "work")).toEqual({ count: 2 });
  });
});
