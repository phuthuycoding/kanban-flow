import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX, type ArtifactId } from "./schema.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { countTasks } from "./status.js";
import { finding, type Finding } from "./findings.js";
import type { Feature } from "./features.js";

const TEST_RESULTS = /^(PASS|FAIL|REJECT|BLOCKED)$/;
const REVIEW_RESULTS = /^(PASS|FAIL|REJECT|REQUIREMENT_BUG)$/;
const COMMANDS_HEADING = /^##\s+Commands and Evidence\b/i;

/**
 * Exit-code column of every data row in the table under "## Commands and Evidence".
 * Returns null when the section is absent. Cells are split on "|" so an escaped
 * pipe inside a cell is not supported — the template never needs one.
 */
export function commandExitCodes(body: string): string[] | null {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => COMMANDS_HEADING.test(line));
  if (start === -1) return null;
  const codes: string[] = [];
  let rows = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith("|")) continue;
    rows += 1;
    if (rows <= 2) continue;
    codes.push(line.split("|").map((cell) => cell.trim())[2] ?? "");
  }
  return codes;
}

/** tasks.md checkbox presence: without checkboxes progress cannot be tracked; unfinished tasks block dones. */
export function checkTasks(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const tasksPath = join(feature.dir, "tasks.md");
  if (!existsSync(tasksPath)) return issues;
  const { done, total } = countTasks(readFileSync(tasksPath, "utf8"));
  if (total === 0) {
    issues.push(finding(feature, "WARNING", "tasks.md", "no_tasks",
      'tasks.md has no task checkboxes ("- [ ] 1. Task description"); progress cannot be tracked'));
  }
  if (feature.stage === "dones" && done < total) {
    issues.push(finding(feature, "ERROR", "tasks.md", "tasks_incomplete_archived", `Feature has unfinished tasks (${done}/${total} done)`));
  }
  return issues;
}

/** testing-result semantics: PASS allows review; FAIL/REJECT must loop back; BLOCKED is a red flag. */
export function checkTestingResult(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const file = ARTIFACTS["testing-result"].file;
  const trPath = join(feature.dir, file);
  if (!existsSync(trPath) || stageIndex < STAGE_INDEX.testing) return issues;
  const { fm, body } = splitFrontmatter(readFileSync(trPath, "utf8"));
  const status = fm.status ?? "";
  if (!TEST_RESULTS.test(status)) {
    issues.push(finding(feature, "ERROR", file, "testing_status", `testing-result status is "${status}"; expected PASS/FAIL/REJECT/BLOCKED`));
  }
  if (status === "PASS") {
    const codes = commandExitCodes(body) ?? [];
    const failing = codes.filter((code) => code !== "0").length;
    if (codes.length === 0) {
      issues.push(finding(feature, "ERROR", file, "testing_exit_code",
        "PASS requires at least one command row under \"## Commands and Evidence\" with exit code 0."));
    } else if (failing > 0) {
      issues.push(finding(feature, "ERROR", file, "testing_exit_code",
        `PASS requires every command in "## Commands and Evidence" to exit 0 (${failing} row${failing > 1 ? "s" : ""} with a different exit code).`));
    }
  }
  if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
    issues.push(finding(feature, "ERROR", file, "testing_stale", "Testing report must reference the current execution id from kf status/instruct."));
  }
  if (stageIndex >= STAGE_INDEX.review && status !== "PASS") {
    issues.push(finding(feature, "ERROR", file, "testing_not_pass", "Only a current PASS testing report may enter review or dones."));
  }
  if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "testing") {
    issues.push(finding(feature, "WARNING", file, "testing_loops_back",
      `Testing ${status.toUpperCase()}: must loop back to implementation (kf stage ${feature.name} implementation)`));
  }
  return issues;
}

/** review-report semantics: PASS allows archive; FAIL/REJECT loops back; REQUIREMENT_BUG stops the feature. */
export function checkReviewReport(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const file = ARTIFACTS["review-report"].file;
  const rvPath = join(feature.dir, file);
  if (!existsSync(rvPath) || stageIndex < STAGE_INDEX.review) return issues;
  const { fm } = splitFrontmatter(readFileSync(rvPath, "utf8"));
  const status = fm.status ?? "";
  if (!REVIEW_RESULTS.test(status)) {
    issues.push(finding(feature, "ERROR", file, "review_status", `review-report status is "${status}"; expected PASS/FAIL/REJECT/REQUIREMENT_BUG`));
  }
  if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
    issues.push(finding(feature, "ERROR", file, "review_stale", "Review report must reference the current execution id from kf status/instruct."));
  }
  if (feature.stage === "dones" && status !== "PASS") {
    issues.push(finding(feature, "ERROR", file, "review_not_pass", "Only a current PASS review report may enter dones."));
  }
  if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "review") {
    issues.push(finding(feature, "WARNING", file, "review_loops_back",
      `Review ${status.toUpperCase()}: must loop back to implementation, then testing again (kf stage ${feature.name} implementation)`));
  }
  if (/^REQUIREMENT_BUG/i.test(status)) {
    issues.push(finding(feature, "ERROR", file, "requirement_bug_stop",
      "REQUIREMENT_BUG: STOP FEATURE. Do not silently rewrite the requirement — report back to the human."));
  }
  return issues;
}

/** A feature in dones without its reports (and feature report) is incomplete. */
export function checkDonesArtifacts(feature: Feature): Finding[] {
  if (feature.stage !== "dones") return [];
  const isBug = feature.meta?.kind === "bug";
  const required: ArtifactId[] = isBug
    ? ["testing-result", "review-report"]
    : ["testing-result", "review-report", "feature-report"];
  return required
    .filter((id) => !existsSync(join(feature.dir, ARTIFACTS[id].file)))
    .map((id) => finding(feature, "ERROR", ARTIFACTS[id].file, "artifact_missing",
      `Archived feature is incomplete: ${ARTIFACTS[id].file} is missing`));
}
