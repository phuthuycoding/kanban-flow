import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACTS } from "../workflow/schema.js";
import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { computeBuckets, computeStatus, renderBuckets } from "../workflow/status.js";
import { cmdStatus } from "../cli/commands/inspect.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kfw-buckets-"));
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A review item whose current report is PASS but written by an earlier release: no `ci:` and no `landing:`, and no PR recorded. */
async function legacyPassReviewItem(name: string): Promise<void> {
  const dir = join(root, ".works", "review", `${name}_20260101_0000`);
  await mkdir(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260101_0000", executionId: "exec-1" });
  await writeFile(join(dir, ARTIFACTS["review-report"].file), "---\nexecution: exec-1\nstatus: PASS\n---\n# Review\n");
}

describe("Needs you bucket", () => {
  it("lists a review PASS item whose close was refused, with the refusal reason", async () => {
    await legacyPassReviewItem("legacy");
    const status = { ...computeStatus(findFeature(root, "legacy")!), close: { kind: "refused" as const, detail: "Cannot archive 'legacy': the review report has no landing" } };

    const buckets = computeBuckets([status], [], 0);

    expect(buckets.needsYou).toEqual([{ feature: "legacy", decision: "review PASS but not closed: Cannot archive 'legacy': the review report has no landing" }]);
    expect(buckets.waitingToMerge).toEqual([]);
    expect(renderBuckets(buckets)).toContain("  legacy — review PASS but not closed: Cannot archive 'legacy'");
  });

  it("kf status --all keeps a legacy review PASS item that cannot close under Needs you", async () => {
    execFileSync("git", ["init", "-q", root]);
    await legacyPassReviewItem("legacy");

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root);

    expect(res.code, res.stdout).toBe(0);
    const json = JSON.parse(res.stdout) as { needsYou: Array<{ feature: string; decision: string }> };
    expect(json.needsYou.map((n) => n.feature)).toEqual(["legacy"]);
    expect(json.needsYou[0].decision).toMatch(/^review PASS but not closed: \S/);
    expect(json.needsYou[0].decision).toBe("review PASS but not closed: Gate failed for 'legacy'. Fix validation before archiving: artifact_missing, approval_required, use_cases_missing");
  });
});

describe("Waiting to merge bucket", () => {
  it("shows why a docs branch is not proven merged, and keeps the plain line without a reason", () => {
    const buckets = computeBuckets([], [
      { feature: "a", branch: "docs/app-a", reason: "no merged PR has docs/app-a at 0123456789ab as its head" },
      { feature: "b", branch: "docs/app-b" },
    ], 0);

    expect(buckets.waitingToMerge).toEqual([
      { feature: "a", docsBranch: "docs/app-a", command: "git push -u origin docs/app-a", reason: "no merged PR has docs/app-a at 0123456789ab as its head" },
      { feature: "b", docsBranch: "docs/app-b", command: "git push -u origin docs/app-b" },
    ]);
    const text = renderBuckets(buckets);
    expect(text).toContain("  a — docs/app-a not proven merged (no merged PR has docs/app-a at 0123456789ab as its head): git push -u origin docs/app-a");
    expect(text).toContain("  b — docs/app-b awaiting push: git push -u origin docs/app-b");
  });

  it("puts a gone docs branch under Needs you as a re-land-or-leave decision with no command", () => {
    const buckets = computeBuckets([], [{ feature: "a", branch: "docs/app-a", reason: "no merged PR has docs/app-a as its head", gone: true }], 0);

    expect(buckets.waitingToMerge).toEqual([]);
    expect(buckets.needsYou).toEqual([{
      feature: "a",
      decision: "canonical docs for a never landed (no merged PR has docs/app-a as its head): re-land them on a fresh docs branch for a PR with kf archive a, or leave them",
    }]);
  });

  it("names the remedy first in the decision for a gone docs branch", () => {
    const buckets = computeBuckets([], [
      { feature: "a", branch: "docs/app-a", reason: "origin/HEAD is not set", remedy: "git remote set-head origin -a", gone: true },
    ], 0);

    expect(buckets.needsYou).toEqual([{
      feature: "a",
      decision: "canonical docs for a never landed (origin/HEAD is not set): run git remote set-head origin -a first, then re-land them on a fresh docs branch for a PR with kf archive a, or leave them",
    }]);
    expect(buckets.waitingToMerge).toEqual([]);
  });

  it("keeps kf status --all as the command of a gone docs branch whose lookup could not run, and offers the re-land beside it", () => {
    const buckets = computeBuckets([], [
      { feature: "a", branch: "docs/app-a", reason: "gh is not installed", command: "kf status --all" },
    ], 0);

    expect(buckets.waitingToMerge).toEqual([{ feature: "a", docsBranch: "docs/app-a", command: "kf status --all", reason: "gh is not installed" }]);
    expect(renderBuckets(buckets)).toContain("  a — docs/app-a not proven merged (gh is not installed): "
      + "re-run kf status --all once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive a");
  });
});
