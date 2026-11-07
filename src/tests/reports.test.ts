import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta, executionContractHash } from "../workflow/features.js";
import { validateFeature } from "../workflow/validate.js";
import { sameCommit, commandExitCodes } from "../workflow/validate-reports.js";

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

describe("testing_exit_code", () => {
  it("accepts PASS with one command that exited 0", async () => {
    await testingBug("PASS", table(["| npm test | 0 | 136 passed |"]));
    expect(codes()).toEqual([]);
  });

  it("rejects PASS with a non-zero exit code", async () => {
    await testingBug("PASS", table(["| npm test | 1 | 2 failed |"]));
    expect(codes()).toHaveLength(1);
    expect(codes()[0].message).toContain("1 row");
  });

  it("rejects PASS without any command row", async () => {
    await testingBug("PASS", table([]));
    expect(codes()).toHaveLength(1);
    expect(codes()[0].message).toContain("at least one command");
  });

  it("rejects PASS when the section is missing entirely", async () => {
    await testingBug("PASS", "## Regression\nnone\n");
    expect(codes()).toHaveLength(1);
  });

  it("rejects PASS with an N/A exit code", async () => {
    await testingBug("PASS", table(["| npm test | N/A | not run |"]));
    expect(codes()).toHaveLength(1);
  });

  it("does not constrain a FAIL report", async () => {
    await testingBug("FAIL", table(["| npm test | 1 | 2 failed |"]));
    expect(codes()).toEqual([]);
  });

  it("reads only the table under the Commands and Evidence heading", async () => {
    const other = "## Failures and Blockers\n\n| Case | Error | Impact | Next |\n|---|---|---|---|\n| TC-9 | boom | high | fix |\n";
    await testingBug("PASS", `${table(["| npm test | 0 | ok |", "| npm run lint | 0 | clean |"])}\n${other}`);
    expect(codes()).toEqual([]);
    expect(commandExitCodes(`${table(["| a | 0 | x |"])}\n${other}`)).toEqual(["0"]);
    expect(commandExitCodes("# nothing")).toBeNull();
  });

  it("accepts a backticked 0 and an escaped pipe inside the command cell", async () => {
    await testingBug("PASS", table([
      "| `npm test` | `0` | ok |",
      "| `npm test \\| tee out.log` | 0 | ok |",
      "| npm test \\| grep -c pass | 0 | 3 |",
    ]));
    expect(codes()).toEqual([]);
    expect(commandExitCodes(table(["| a \\| b | `1` | x |", "| npm test \\| grep -c pass | 0 | 3 |"]))).toEqual(["1", "0"]);
  });

  it("rejects PASS when a raw pipe in the command cell moves the exit cell onto text", async () => {
    await testingBug("PASS", table(["| npm test | grep -c pass | 0 | 3 |"]));
    expect(codes()).toHaveLength(1);
    expect(commandExitCodes(table(["| npm test | grep -c pass | 0 | 3 |"]))).toEqual(["grep -c pass"]);
  });

  it("reads a row whose exit cell is not a number as failed, whatever follows it", async () => {
    const rows = [
      ["| npm test | killed | 0 failed \\| x |", "killed"],
      ["| npm test | timeout | 0 | x |", "timeout"],
      ["| npm test | - | 0 tests | x |", "-"],
      ["| npm test |  | 0 tests | x |", ""],
      ["| npm test | N/A | 0 tests | x |", "N/A"],
      ["| cmd | x | y | z |", "x"],
      ["| a | b | c | 0 | x |", "b"],
    ];
    for (const [row, value] of rows) {
      expect(commandExitCodes(table([row]))).toEqual([value]);
    }
    await testingBug("PASS", table([rows[0][0]]));
    expect(codes()).toHaveLength(1);
  });

  it("reads a passing row whose Evidence cell holds a pipe or several cells", () => {
    const rows = [
      "| npm test | 0 | 12 passed \\| 0 failed |",
      "| npm test | 0 | 12 passed | 0 failed |",
      "| a \\| 2>&1 tee | 0 | ev |",
      "| `git diff 7efa5eb b1f2775 --stat` (worktree) | 0 | `src/tests/drive.test.ts \\| 3 ++-`, 1 file changed, 2 insertions(+), 1 deletion(-) |",
      "| cmd | 0 (ok) | x |",
    ];
    for (const row of rows) {
      expect(commandExitCodes(table([row]))).toEqual(["0"]);
    }
  });

  it("never reads a failed row as 0 when a later cell holds 0", () => {
    const rows = [
      ["| cmd | 1 | 0 | x |", "1"],
      ["| cmd | 0 | 1 | x |", "1"],
      ["| cmd | 127 (not found) | 0 | x |", "127"],
      ["| cmd | 0 | 127 (not found) | x |", "127"],
      ["| cmd | `2` | 0 | x |", "2"],
      ["| cmd | 1 (failed) | 0 | x |", "1"],
    ];
    for (const [row, value] of rows) {
      expect(commandExitCodes(table([row]))).toEqual([value]);
    }
  });

  it("finds the Exit code column by its header, wherever it sits", () => {
    const head = "## Commands and Evidence\n\n| Evidence | Command | Exit code |\n|---|---|---:|\n";
    expect(commandExitCodes(`${head}| ok | npm test | 0 |\n`)).toEqual(["0"]);
    expect(commandExitCodes(`${head}| a \\| b | npm test | 2 |\n`)).toEqual(["2"]);
    expect(commandExitCodes(`${head}| a | b | npm test | 0 |\n`)).toEqual(["npm test"]);
  });

  it("reads a row with fewer cells than the exit column as empty, and a two-column table by its second cell", () => {
    const wide = "## Commands and Evidence\n\n| Evidence | Command | Exit code |\n|---|---|---:|\n| ok | npm test |\n";
    expect(commandExitCodes(wide)).toEqual([""]);
    const narrow = "## Commands and Evidence\n\n| Command | Exit code |\n|---|---:|\n| cmd | 0 |\n";
    expect(commandExitCodes(narrow)).toEqual(["0"]);
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
