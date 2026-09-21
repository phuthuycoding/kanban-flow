import { STAGES } from "./schema.js";
import { finding, type Finding, type ValidationResult } from "./findings.js";
import type { Feature } from "./features.js";
import { checkDueArtifacts, checkStageGate } from "./validate-artifacts.js";
import { checkApproval, checkBypasses } from "./validate-approval.js";
import { checkTasks, checkTestingResult, checkReviewReport, checkDonesArtifacts } from "./validate-reports.js";
import { checkTraceability } from "./validate-traceability.js";
import { checkCancellation } from "./validate-cancel.js";

export type { Severity, Finding, ValidationResult } from "./findings.js";
export { findSecretLike } from "./secrets.js";
export { checkDirectionGate } from "./direction.js";
export { STAGES };

/** Checks for the CURRENT stage. If the feature can leave the current stage, all its gate artifacts must exist & be filled. */
export function validateFeature(feature: Feature, strict = false, requireApproval = true): ValidationResult {
  const issues: Finding[] = [];
  if (!feature.meta) {
    issues.push(finding(feature, "ERROR", ".kfw.json", feature.metaError ? "metadata_invalid" : "metadata_missing",
      feature.metaError ?? "Feature metadata is required for approval and execution tracking."));
  }
  // A cancelled item is asked for no artifact, no approval and no report. `STAGE_INDEX = -1`
  // already makes most of those checks inert, but one that compares no index is not covered by
  // that trick, and it made an item cancelled out of brainstorm permanently invalid — including
  // the reopen command `kf cancel` itself prints. Deciding it here rather than inside each check
  // means a check added later cannot reintroduce the trap by forgetting a guard.
  //
  // The bypass trail is deliberately NOT skipped: a recorded --force is an audit record about
  // what someone did, not a demand on the item, and three places promise it shows up on every
  // validation. Everything else is, including the `no_tasks` warning.
  //
  // Not covered, and not a decision made here: a secret sitting in a cancelled item's artifact
  // still goes unreported, because the index guard inside checkDueArtifacts swallows it even if
  // that check is put back. It predates this rule; both it and the reopen-into-planning
  // inconsistency are recorded in BACKLOG.
  issues.push(...(feature.stage === "cancelled"
    ? [...checkCancellation(feature), ...checkBypasses(feature)]
    : [
      ...checkDueArtifacts(feature),
      ...checkStageGate(feature),
      ...checkApproval(feature, requireApproval),
      ...checkBypasses(feature),
      ...checkTasks(feature),
      ...checkTestingResult(feature),
      ...checkReviewReport(feature),
      ...checkTraceability(feature),
      ...checkDonesArtifacts(feature),
    ]));

  const hasErrors = issues.some((i) => i.severity === "ERROR");
  const hasWarnings = issues.some((i) => i.severity === "WARNING");
  return {
    feature: feature.name,
    stage: feature.stage,
    valid: !hasErrors && !(strict && hasWarnings),
    issues,
  };
}

export function renderValidateText(r: ValidationResult): string {
  const lines: string[] = [];
  if (r.issues.length === 0) {
    lines.push(`✓ ${r.feature} (stage ${r.stage}) — valid`);
    return lines.join("\n");
  }
  lines.push(`✗ ${r.feature} (stage ${r.stage}) — ${r.valid ? "warnings" : "invalid"}`);
  for (const i of r.issues) {
    lines.push(`  [${i.severity}] ${i.file}: ${i.message} (${i.code})`);
  }
  return lines.join("\n");
}

export function validateToJson(r: ValidationResult) {
  return {
    feature: r.feature,
    stage: r.stage,
    valid: r.valid,
    issues: r.issues,
  };
}
