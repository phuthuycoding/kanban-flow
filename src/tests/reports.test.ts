import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta, executionContractHash } from "../workflow/features.js";
import { validateFeature } from "../workflow/validate.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import type { ParsedArgs } from "../cli/args.js";
import { sameCommit } from "../workflow/validate-reports.js";

let root: string;
let dir: string;

const table = (rows: string[]) =>
  `## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n${rows.map((r) => `${r}\n`).join("")}`;

async function testingBug(status: string, body: string): Promise<void> {
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Bug\nReproduced.");
  await writeFeatureMeta(dir, {
    schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200", kind: "bug",
    approval: { status: "approved", contractHash: executionContractHash(dir, "bug")! }, executionId: "run-1",
  });
  await writeFile(join(dir, "phase-4-testing-result.md"), `---\nstatus: ${status}\nexecution: run-1\n---\n# Testing Result\n\n## Summary\nDone.\n\n${body}`);
}

const codes = () => validateFeature(findFeature(root, "demo")!).issues.filter((i) => i.code === "testing_exit_code");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-reports-"));
  ensureWorksStructure(root);
  dir = join(root, ".works", "testing", "demo_20260919_1200");
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the exit codes in a PASS testing report", () => {
  it("does not refuse a PASS report whose command row exited non-zero", async () => {
    await testingBug("PASS", table(["| npm test | 1 | 2 failed |"]));
    expect(codes()).toEqual([]);
  });

  it("does not refuse a PASS report that has no Commands table", async () => {
    await testingBug("PASS", "## Regression\nnone\n");
    expect(codes()).toEqual([]);
  });

  it("does not refuse a PASS report with an empty table or a non-numeric exit code", async () => {
    await testingBug("PASS", table([]));
    expect(codes()).toEqual([]);
    await testingBug("PASS", table(["| npm test | N/A | not run |"]));
    expect(codes()).toEqual([]);
  });

  it("no longer exports the exit-code table reader", async () => {
    const reports = await import("../workflow/validate-reports.js");
    expect(Object.keys(reports)).not.toContain("commandExitCodes");
  });

  it("lets an item with a non-zero exit row move from testing to review", async () => {
    const repo = realpathSync(await mkdtemp(join(tmpdir(), "kf-reports-stage-")));
    try {
      const git = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      const args = (command: string, positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
      const must = (res: { code: number; stdout: string }, what: string): void => {
        if (res.code !== 0) throw new Error(`${what} failed: ${res.stdout}`);
      };
      git("init", "-q");
      git("config", "user.email", "t@t");
      git("config", "user.name", "t");
      await writeFile(join(repo, ".gitignore"), ".works/\n");
      await writeFile(join(repo, "tracked.txt"), "one");
      git("add", "-A");
      git("commit", "-qm", "init");
      ensureWorksStructure(repo);
      must(await cmdNew(args("new", ["f"], { context: "app", type: "bug" }), repo), "kf new");
      const item = () => findFeature(repo, "f")!;
      await writeFile(join(item().dir, "phase-1-spec-requirement.md"),
        "---\nstatus: confirmed\nkind: bug\n---\n# Bug Report\nReproduce: submit twice. Actual: duplicate task. Expected: one task. Severity: medium. Regression: repeat-submit unit test. Docs: unchanged behavior.");
      must(await cmdStage(args("stage", ["f", "planning"]), repo), "stage planning");
      must(await cmdApprove(args("approve", ["f"], { backlog: true }), repo), "approve");
      must(await cmdStage(args("stage", ["f", "implementation"]), repo), "stage implementation");
      must(await cmdStage(args("stage", ["f", "testing"]), repo), "stage testing");
      await writeFile(join(item().dir, "phase-4-testing-result.md"),
        `---\nstatus: PASS\nexecution: ${item().meta?.executionId}\n---\n# Testing Result\n\n${table(["| npm test | 1 | 2 failed |"])}`);
      must(await cmdVerify(args("verify", ["f"], { stage: true, waive: "no stage suite in this fixture" }), repo), "kf verify --waive");

      const res = await cmdStage(args("stage", ["f", "review"]), repo);

      expect(res.stdout).not.toContain("testing_exit_code");
      expect(res.code).toBe(0);
      expect(item().stage).toBe("review");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

const PR = "https://github.com/acme/app/pull/7";

/** A bug item in `stage` with a current PASS testing report and a review report carrying `fm` lines. */
async function reviewBug(fm: string, opts: { pr?: string; stage?: "review" | "done" } = {}): Promise<void> {
  const stage = opts.stage ?? "review";
  const itemDir = join(root, ".works", stage, "demo_20260919_1200");
  await rm(dir, { recursive: true, force: true });
  await mkdir(itemDir, { recursive: true });
  dir = itemDir;
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Bug\nReproduced.");
  await writeFeatureMeta(dir, {
    schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200", kind: "bug",
    approval: { status: "approved", contractHash: executionContractHash(dir, "bug")! }, executionId: "run-1",
    ...(opts.pr ? { pr: opts.pr } : {}),
  });
  await writeFile(join(dir, "phase-4-testing-result.md"), `---\nstatus: PASS\nexecution: run-1\n---\n# Testing Result\n\n${table(["| npm test | 0 | ok |"])}`);
  await writeFile(join(dir, "phase-5-review-report.md"), `---\nexecution: run-1\n${fm}\n---\n# Review Report\nReviewed.\n`);
}

describe("the commit a review passed", () => {
  const stale = () => validateFeature(findFeature(root, "demo")!).issues.filter((i) => i.code === "review_stale");
  const worktree = async (commit: string | null): Promise<string> => {
    const wt = join(root, "wt");
    await mkdir(wt, { recursive: true });
    const run = (...a: string[]) => execFileSync("git", ["-C", wt, ...a], { encoding: "utf8" }).trim();
    run("init", "-q");
    run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
    const head = run("rev-parse", "HEAD");
    await reviewBug(`status: PASS\nci: green\nlanding: pr${commit === null ? "" : `\ncommit: ${commit || head}`}`, { pr: PR });
    const meta = readFeatureMeta(dir)!;
    await writeFeatureMeta(dir, { ...meta, worktree: { path: wt, branch: "b", domain: "d", port: 5100, createdAt: "20260919_1200" } });
    return head;
  };

  it("warns when the item branch moved past the reviewed commit", async () => {
    await worktree("1234567890abcdef");
    expect(stale().map((i) => i.severity)).toEqual(["WARNING"]);
    expect(stale()[0].message).toContain("review the new commits before merging");
  });

  it("stays quiet at the reviewed commit, and for a report that names none", async () => {
    await worktree("");
    expect(stale()).toEqual([]);
    await worktree(null);
    expect(stale()).toEqual([]);
  });

  it("matches an abbreviated or uppercase commit, and no value shorter than seven characters", () => {
    expect(sameCommit("abcdef1234", "abcdef1")).toBe(true);
    expect(sameCommit("abcdef1234", "ABCDEF1")).toBe(true);
    expect(sameCommit("abcdef1234", "a")).toBe(false);
  });
});

const DELIVERY = ["review_ci_red", "review_ci_missing", "review_pr_missing", "review_landing_missing"];
const delivery = () => validateFeature(findFeature(root, "demo")!).issues
  .filter((i) => DELIVERY.includes(i.code)).map((i) => `${i.severity} ${i.code}`);

describe("review report delivery: ci and landing", () => {
  it("PASS with ci: red is review_ci_red; ci: green clears it", async () => {
    await reviewBug("status: PASS\nci: red\nlanding: pr", { pr: PR });
    expect(delivery()).toEqual(["ERROR review_ci_red"]);
    await reviewBug("status: PASS\nci: green\nlanding: pr", { pr: PR });
    expect(delivery()).toEqual([]);
    expect(validateFeature(findFeature(root, "demo")!).valid).toBe(true);
  });

  it("landing: pr without meta.pr is review_pr_missing; landing: none is clean; no landing is review_landing_missing", async () => {
    await reviewBug("status: PASS\nci: green\nlanding: pr");
    expect(delivery()).toEqual(["ERROR review_pr_missing"]);
    await reviewBug("status: PASS\nci: green\nlanding: none");
    expect(delivery()).toEqual([]);
    await reviewBug("status: PASS\nci: green");
    expect(delivery()).toEqual(["ERROR review_landing_missing"]);
  });

  it("PASS with ci: pending or no ci at all is review_ci_missing; ci: green and ci: none are clean", async () => {
    await reviewBug("status: PASS\nci: pending\nlanding: none");
    expect(delivery()).toEqual(["ERROR review_ci_missing"]);
    await reviewBug("status: PASS\nlanding: none");
    expect(delivery()).toEqual(["ERROR review_ci_missing"]);
    await reviewBug("status: PASS\nci: green\nlanding: none");
    expect(delivery()).toEqual([]);
    await reviewBug("status: PASS\nci: none\nlanding: none");
    expect(delivery()).toEqual([]);
  });

  it("kf validate still names both keys on a PASS report with neither ci nor landing, PR recorded or not", async () => {
    await reviewBug("status: PASS", { pr: PR });
    expect(delivery()).toEqual(["ERROR review_ci_missing", "ERROR review_landing_missing"]);
    await reviewBug("status: PASS");
    expect(delivery()).toEqual(["ERROR review_ci_missing", "ERROR review_landing_missing"]);
  });

  it("treats a ci value that is not exactly green, red or none as missing", async () => {
    await reviewBug("status: PASS\nci: RED\nlanding: none");
    expect(delivery()).toEqual(["ERROR review_ci_missing"]);
    await reviewBug('status: PASS\nci: "{ci}"\nlanding: none');
    expect(delivery()).toEqual(["ERROR review_ci_missing"]);
  });

  it("treats a landing value other than pr or none as missing", async () => {
    await reviewBug("status: PASS\nci: none\nlanding: merge", { pr: PR });
    expect(delivery()).toEqual(["ERROR review_landing_missing"]);
  });

  it("reports ci: red and a missing PR together", async () => {
    await reviewBug("status: PASS\nci: red\nlanding: pr");
    expect(delivery()).toEqual(["ERROR review_ci_red", "ERROR review_pr_missing"]);
  });

  it("does not constrain a FAIL report that records ci: red", async () => {
    await reviewBug("status: FAIL\nci: red\nlanding: pr");
    expect(delivery()).toEqual([]);
  });

  it("does not flag an item archived before ci/landing existed", async () => {
    await reviewBug("status: PASS", { stage: "done" });
    await writeFile(join(dir, "phase-6-feature-report.md"), "# Feature report\nDone.");
    expect(findFeature(root, "demo")!.stage).toBe("done");
    expect(delivery()).toEqual([]);
  });
});
