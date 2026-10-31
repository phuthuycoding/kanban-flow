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

  it("puts a multi-line refusal on one line, so the check that failed is named", async () => {
    await legacyPassReviewItem("legacy");
    const status = { ...computeStatus(findFeature(root, "legacy")!), close: { kind: "refused" as const, detail: "Cannot archive 'legacy':\n  review_landing_missing: the review report has no landing\n" } };

    const rendered = renderBuckets(computeBuckets([status], [], 0));

    expect(rendered).toContain("  legacy — review PASS but not closed: Cannot archive 'legacy': review_landing_missing: the review report has no landing\n");
  });

  it("kf status --all keeps a legacy review PASS item that cannot close under Needs you", async () => {
    execFileSync("git", ["init", "-q", root]);
    await legacyPassReviewItem("legacy");

    const res = await cmdStatus({ command: "status", positionals: [], options: { all: true, json: true } }, root);

    expect(res.code, res.stdout).toBe(0);
    const json = JSON.parse(res.stdout) as { needsYou: Array<{ feature: string; decision: string }> };
    expect(json.needsYou.map((n) => n.feature)).toEqual(["legacy"]);
    expect(json.needsYou[0].decision).toMatch(/^review PASS but not closed: \S/);
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
});
