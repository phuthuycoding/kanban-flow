import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX, REVIEW_CI_VALUES, REVIEW_LANDING_VALUES, type ArtifactId } from "./schema.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { runGit } from "../shared/git.js";
import { countTasks } from "./status.js";
import { finding, type Finding } from "./findings.js";
import type { Feature } from "./features.js";
import { checkReviewDocsGit, checkReviewDocsKeys } from "./validate-docs.js";

const TEST_RESULTS = /^(PASS|FAIL|REJECT|BLOCKED)$/;
const REVIEW_RESULTS = /^(PASS|FAIL|REJECT|REQUIREMENT_BUG)$/;

/** tasks.md checkbox presence: without checkboxes progress cannot be tracked; unfinished tasks block done. */
export function checkTasks(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const tasksPath = join(feature.dir, "tasks.md");
  if (!existsSync(tasksPath)) return issues;
  const { done, total } = countTasks(readFileSync(tasksPath, "utf8"));
  if (total === 0) {
    issues.push(finding(feature, "WARNING", "tasks.md", "no_tasks",
      'tasks.md has no task checkboxes ("- [ ] 1. Task description"); progress cannot be tracked'));
  }
  if (feature.stage === "done" && done < total) {
    issues.push(finding(feature, "ERROR", "tasks.md", "tasks_incomplete_archived", `Feature has unfinished tasks (${done}/${total} done)`));
  }
  return issues;
}

/** testing-result semantics: PASS allows review; FAIL must loop back; BLOCKED is a red flag. */
export function checkTestingResult(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const file = ARTIFACTS["testing-result"].file;
  const trPath = join(feature.dir, file);
  if (!existsSync(trPath) || stageIndex < STAGE_INDEX.testing) return issues;
  const { fm } = splitFrontmatter(readFileSync(trPath, "utf8"));
  const status = fm.status ?? "";
  if (!TEST_RESULTS.test(status)) {
    issues.push(finding(feature, "ERROR", file, "testing_status", `testing-result status is "${status}"; expected PASS/FAIL/BLOCKED`));
  }
  if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
    issues.push(finding(feature, "ERROR", file, "testing_stale", "Testing report must reference the current execution id from kf status/instruct."));
  }
  if (stageIndex >= STAGE_INDEX.review && status !== "PASS") {
    issues.push(finding(feature, "ERROR", file, "testing_not_pass", "Only a current PASS testing report may enter review or done."));
  }
  if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "testing") {
    issues.push(finding(feature, "WARNING", file, "testing_loops_back",
      `Testing ${status.toUpperCase().replace(/^REJECT/, "FAIL")}: must loop back to implementation (kf stage ${feature.name} implementation)`));
  }
  return issues;
}

/**
 * A review report written before `ci:`/`landing:` existed carries neither key. Such a report closes
 * as `landing: pr` only when its recorded PR is verifiably merged — the merge is the delivery proof
 * the missing keys would have stated. `prMerged` is the merge check the caller already made on
 * `meta.pr` (archive's delivery gate), so this never asks gh again.
 */
function legacyReportLandedByPr(feature: Feature, fm: Record<string, string>, prMerged: boolean): boolean {
  return prMerged && fm.ci === undefined && fm.landing === undefined && Boolean(feature.meta?.pr);
}

/** A full sha against a report's `commit:`, which may be abbreviated. Too short a value matches nothing rather than everything. */
export function sameCommit(full: string, reported: string): boolean {
  const short = reported.toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(short) && full.toLowerCase().startsWith(short);
}

/** A PASS names the commit it reviewed; a later commit on the item branch is outside it. Reports before `commit:` carry none, and an item with no worktree has no branch to compare. */
export function checkReviewedCommit(feature: Feature, fm: Record<string, string>): Finding[] {
  const path = feature.meta?.worktree?.path;
  if (fm.status !== "PASS" || !fm.commit || !path || !existsSync(path)) return [];
  const head = runGit(path, ["rev-parse", "HEAD"]);
  if (head.code !== 0 || sameCommit(head.stdout.trim(), fm.commit)) return [];
  return [finding(feature, "WARNING", ARTIFACTS["review-report"].file, "review_stale",
    `The review passed ${fm.commit.slice(0, 7)} but the item branch is at ${head.stdout.trim().slice(0, 7)}: review the new commits before merging.`)];
}

/**
 * Delivery half of a PASS review report: CI is green or absent (`ci: none`), and the code either lands through a
 * recorded PR (`landing: pr` + `meta.pr`) or there is nothing to land (`landing: none`).
 * Empty for any status other than PASS. Shared by `kf validate` and the review → done gate.
 * `legacyPrMerged` — true when the caller verified that the recorded PR is merged — lets a report with
 * neither key through; `kf validate` passes false, so it stays offline and still names the missing keys.
 */
export function checkReviewDelivery(feature: Feature, fm: Record<string, string>, legacyPrMerged = false): Finding[] {
  if (fm.status !== "PASS") return [];
  if (legacyReportLandedByPr(feature, fm, legacyPrMerged)) return [];
  const issues: Finding[] = [];
  const file = ARTIFACTS["review-report"].file;
  const ci = fm.ci ?? "";
  if (!(REVIEW_CI_VALUES as readonly string[]).includes(ci)) {
    issues.push(finding(feature, "ERROR", file, "review_ci_missing",
      `PASS needs ci: green or ci: none in the frontmatter (ci: red cannot pass; found "${ci}").`));
  } else if (ci === "red") {
    issues.push(finding(feature, "ERROR", file, "review_ci_red",
      "PASS with ci: red — a red CI run cannot pass review; write FAIL and return to implementation."));
  }
  const landing = fm.landing ?? "";
  if (!(REVIEW_LANDING_VALUES as readonly string[]).includes(landing)) {
    issues.push(finding(feature, "ERROR", file, "review_landing_missing",
      `PASS needs landing: pr or landing: none in the frontmatter (found "${landing}").`));
  } else if (landing === "pr" && !feature.meta?.pr) {
    issues.push(finding(feature, "ERROR", file, "review_pr_missing",
      `PASS with landing: pr but no PR is recorded — record it with kf issues link ${feature.name} <url> --pr.`));
  }
  return issues;
}

/** review-report semantics: PASS allows archive; FAIL loops back; REQUIREMENT_BUG stops the feature. */
export function checkReviewReport(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const file = ARTIFACTS["review-report"].file;
  const rvPath = join(feature.dir, file);
  if (!existsSync(rvPath) || stageIndex < STAGE_INDEX.review) return issues;
  const { fm } = splitFrontmatter(readFileSync(rvPath, "utf8"));
  const status = fm.status ?? "";
  if (!REVIEW_RESULTS.test(status)) {
    issues.push(finding(feature, "ERROR", file, "review_status", `review-report status is "${status}"; expected PASS/FAIL/REQUIREMENT_BUG`));
  }
  if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
    issues.push(finding(feature, "ERROR", file, "review_stale", "Review report must reference the current execution id from kf status/instruct."));
  }
  if (feature.stage === "done" && status !== "PASS") {
    issues.push(finding(feature, "ERROR", file, "review_not_pass", "Only a current PASS review report may enter done."));
  }
  // Only while in review: items archived before `ci:`/`landing:` existed carry reports without
  // them, and the review → done gate (checkDirectionGate) enforces the same rule at close.
  if (feature.stage === "review") {
    issues.push(...checkReviewDelivery(feature, fm, false), ...checkReviewedCommit(feature, fm),
      ...checkReviewDocsKeys(feature, fm), ...checkReviewDocsGit(feature, fm));
  }
  if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "review") {
    issues.push(finding(feature, "WARNING", file, "review_loops_back",
      `Review ${status.toUpperCase().replace(/^REJECT/, "FAIL")}: must loop back to implementation, then testing again (kf stage ${feature.name} implementation)`));
  }
  if (/^REQUIREMENT_BUG/i.test(status)) {
    issues.push(finding(feature, "ERROR", file, "requirement_bug_stop",
      "REQUIREMENT_BUG: STOP FEATURE. Do not silently rewrite the requirement — report back to the human."));
  }
  return issues;
}

/** A feature in done without its reports (and feature report) is incomplete. */
export function checkDonesArtifacts(feature: Feature): Finding[] {
  if (feature.stage !== "done") return [];
  const isBug = feature.meta?.kind === "bug";
  const required: ArtifactId[] = isBug
    ? ["testing-result", "review-report"]
    : ["testing-result", "review-report", "feature-report"];
  return required
    .filter((id) => !existsSync(join(feature.dir, ARTIFACTS[id].file)))
    .map((id) => finding(feature, "ERROR", ARTIFACTS[id].file, "artifact_missing",
      `Archived feature is incomplete: ${ARTIFACTS[id].file} is missing`));
}
