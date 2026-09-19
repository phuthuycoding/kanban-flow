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
  issues.push(
    ...checkDueArtifacts(feature),
    ...checkStageGate(feature),
    ...checkApproval(feature, requireApproval),
    ...checkBypasses(feature),
    ...checkTasks(feature),
    ...checkTestingResult(feature),
    ...checkReviewReport(feature),
    ...checkTraceability(feature),
    ...checkCancellation(feature),
    ...checkDonesArtifacts(feature),
  );

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
