import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, type Stage } from "./schema.js";
import { splitFrontmatter } from "../shared/frontmatter.js";
import { countTasks } from "./status.js";
import { finding, type Finding } from "./findings.js";
import { checkReviewDelivery } from "./validate-reports.js";
import type { Feature } from "./features.js";

/**
 * Checks whether the CURRENT stage allows leaving toward `to`.
 * This is the semantic half of the gate: it reads the report STATUS, not just
 * artifact existence. The artifact gate (validateFeature) and the transition
 * graph (TRANSITIONS) both still apply on top.
 * Returns a list of blocking findings (empty = allowed). `legacyPrMerged`: the caller already
 * verified the recorded PR is merged (see checkReviewDelivery).
 */
export function checkDirectionGate(feature: Feature, to: Stage, legacyPrMerged = false): Finding[] {
  const issues: Finding[] = [];
  const read = (file: string): string | null => {
    const p = join(feature.dir, file);
    if (!existsSync(p)) return null;
    const { fm } = splitFrontmatter(readFileSync(p, "utf8"));
    return fm.status ?? null;
  };

  // implementation → testing requires all tracked tasks done (DoD).
  if (feature.stage === "implementation" && to === "testing") {
    const tasksPath = join(feature.dir, "tasks.md");
    if (existsSync(tasksPath)) {
      const { done, total } = countTasks(readFileSync(tasksPath, "utf8"));
      if (done < total) {
        issues.push(finding(feature, "ERROR", "tasks.md", "tasks_incomplete",
          `Feature has unfinished tasks (${done}/${total} done) — complete them before testing`));
      }
    }
  }

  // testing → review requires PASS; testing → implementation required on FAIL.
  if (feature.stage === "testing") {
    const file = ARTIFACTS["testing-result"].file;
    const status = read(file);
    if (to === "review" && status !== "PASS") {
      issues.push(finding(feature, "ERROR", file, "testing_not_pass",
        `testing-result status is ${status ?? "missing"}; only PASS may enter review (FAIL/REJECT must loop back to implementation)`));
    }
    if (to === "implementation" && status === "PASS") {
      issues.push(finding(feature, "ERROR", file, "testing_already_pass",
        "testing-result is PASS — looping back to implementation hides passing tests; re-run kf stage <feature> review instead"));
    }
  }

  // review → done requires PASS with CI green or none and a landing: a recorded PR when landing is pr,
  // nothing to land otherwise;
  // REQUIREMENT_BUG stops the feature entirely.
  if (feature.stage === "review") {
    const file = ARTIFACTS["review-report"].file;
    const status = read(file);
    if (to === "done" && status !== "PASS") {
      issues.push(finding(feature, "ERROR", file, "review_not_pass",
        `review-report status is ${status ?? "missing"}; only PASS may enter ${to} (FAIL/REJECT loop to implementation)`));
    }
    if (to === "done" && status === "PASS") {
      issues.push(...checkReviewDelivery(feature, splitFrontmatter(readFileSync(join(feature.dir, file), "utf8")).fm, legacyPrMerged));
    }
    if (status === "REQUIREMENT_BUG") {
      issues.push(finding(feature, "ERROR", file, "requirement_bug_stop",
        "REQUIREMENT_BUG: STOP FEATURE. Do not silently rewrite the requirement — report back to the human."));
    }
  }

  return issues;
}
