import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ARTIFACTS,
  STAGE_GATES,
  STAGES,
  STAGE_INDEX,
  FEATURE_ONLY_ARTIFACTS,
  type ArtifactId,
  type Stage,
} from "./schema.js";
import { splitFrontmatter, isFilledFile } from "./frontmatter.js";
import { countTasks } from "./status.js";
import { executionContractHash, type Feature } from "./features.js";

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface Finding {
  severity: Severity;
  feature: string;
  stage: Stage;
  file: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  feature: string;
  stage: Stage;
  valid: boolean;
  issues: Finding[];
}

const TEST_RESULTS = /^(PASS|FAIL|REJECT|BLOCKED)$/;
const REVIEW_RESULTS = /^(PASS|FAIL|REJECT|REQUIREMENT_BUG)$/;

/** Checks for the CURRENT stage. If the feature can leave the current stage, all its gate artifacts must exist & be filled. */
export function validateFeature(feature: Feature, strict = false, requireApproval = true): ValidationResult {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const isBug = feature.meta?.kind === "bug";
  const addError = (file: string, code: string, message: string): void => {
    issues.push({ severity: "ERROR", feature: feature.name, stage: feature.stage, file, code, message });
  };
  if (!feature.meta) addError(".kfw.json", "metadata_missing", "Feature metadata is required for approval and execution tracking.");

  // 1. Each artifact that is DUE at the current stage must exist & be filled.
  for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
    const def = ARTIFACTS[id];
    if (isBug && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const path = join(feature.dir, def.file);
    if (stageIndex < def.dueFromStage) continue;

    if (!existsSync(path)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: def.file,
        code: "artifact_missing",
        message: `Required artifact ${def.file} is missing`,
      });
      continue;
    }
    const content = readFileSync(path, "utf8");
    if (!isFilledFile(content, splitFrontmatter(content).body)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: def.file,
        code: "artifact_unfilled",
        message: `${def.file} is empty or still contains template placeholders (needs real content)`,
      });
    }
  }

  // 2. Stage gate: to leave the current stage, gate artifacts must be complete.
  const gate = STAGE_GATES[feature.stage];
  for (const id of gate) {
    if (isBug && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const def = ARTIFACTS[id];
    const path = join(feature.dir, def.file);
    if (!existsSync(path)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: def.file,
        code: "gate_blocked",
        message: `Cannot leave stage "${feature.stage}" — ${def.file} is missing`,
      });
      continue;
    }
    const raw = readFileSync(path, "utf8");
    const { body } = splitFrontmatter(raw);
    if (!isFilledFile(raw, body)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: def.file,
        code: "gate_blocked",
        message: `Cannot leave stage "${feature.stage}" — ${def.file} is not filled`,
      });
    }
  }

  const specPath = join(feature.dir, ARTIFACTS["spec-requirement"].file);
  if (existsSync(specPath) && splitFrontmatter(readFileSync(specPath, "utf8")).fm.status !== "confirmed") {
    addError(ARTIFACTS["spec-requirement"].file, "requirement_unconfirmed", "Requirement must have status: confirmed before leaving brainstorm.");
  }

  // 3. Approval binds the requirement and planning artifacts throughout execution.
  if (stageIndex >= STAGE_INDEX.planning && requireApproval) {
    const status = feature.meta?.approval?.status ?? "pending";
    if (status !== "approved") {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: "plan",
        code: "approval_required",
        message: "Execution contract not approved by a human (Phase 2 gate). Return to planning and run: kf approve <feature>",
      });
    } else if (!feature.meta?.approval?.contractHash || feature.meta.approval.contractHash !== executionContractHash(feature.dir, isBug ? "bug" : "feature")) {
      addError("plan", "approval_changed", "Execution contract changed or has no approval fingerprint. Return to planning for human approval.");
    }
  }

  // 4. tasks.md checkbox presence (mirror openspec's task finding): if tasks.md exists
  //    but has no checkboxes, progress cannot be tracked.
  const tasksPath = join(feature.dir, "tasks.md");
  if (existsSync(tasksPath)) {
    const { done, total } = countTasks(readFileSync(tasksPath, "utf8"));
    if (total === 0) {
      issues.push({
        severity: "WARNING",
        feature: feature.name,
        stage: feature.stage,
        file: "tasks.md",
        code: "no_tasks",
        message: 'tasks.md has no task checkboxes ("- [ ] 1. Task description"); progress cannot be tracked',
      });
    }
    if (stageIndex >= STAGE_INDEX.implementation && done < total) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: "tasks.md",
        code: "tasks_incomplete_archived",
        message: `Feature has unfinished tasks (${done}/${total} done)`,
      });
    }
  }

  // 5. testing-result semantics: PASS allows review; FAIL/REJECT must loop back to implementation;
  //    BLOCKED is a red flag.
  const trPath = join(feature.dir, ARTIFACTS["testing-result"].file);
  if (existsSync(trPath) && stageIndex >= STAGE_INDEX.testing) {
    const { fm } = splitFrontmatter(readFileSync(trPath, "utf8"));
    const status = fm.status ?? "";
    if (!TEST_RESULTS.test(status)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["testing-result"].file,
        code: "testing_status",
        message: `testing-result status is "${status}"; expected PASS/FAIL/REJECT/BLOCKED`,
      });
    }
    if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
      addError(ARTIFACTS["testing-result"].file, "testing_stale", "Testing report must reference the current execution id from kf status/instruct.");
    }
    if (stageIndex >= STAGE_INDEX.review && status !== "PASS") {
      addError(ARTIFACTS["testing-result"].file, "testing_not_pass", "Only a current PASS testing report may enter review or dones.");
    }
    if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "testing") {
      issues.push({
        severity: "WARNING",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["testing-result"].file,
        code: "testing_loops_back",
        message: `Testing ${status.toUpperCase()}: must loop back to implementation (kf stage ${feature.name} implementation)`,
      });
    }
  }

  // 6. review-report semantics: PASS allows archive; FAIL/REJECT loops back to implementation;
  //    REQUIREMENT_BUG stops the feature (must not silently rewrite the requirement).
  const rvPath = join(feature.dir, ARTIFACTS["review-report"].file);
  if (existsSync(rvPath) && stageIndex >= STAGE_INDEX.review) {
    const { fm } = splitFrontmatter(readFileSync(rvPath, "utf8"));
    const status = fm.status ?? "";
    if (!REVIEW_RESULTS.test(status)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["review-report"].file,
        code: "review_status",
        message: `review-report status is "${status}"; expected PASS/FAIL/REJECT/REQUIREMENT_BUG`,
      });
    }
    if (!feature.meta?.executionId || fm.execution !== feature.meta.executionId) {
      addError(ARTIFACTS["review-report"].file, "review_stale", "Review report must reference the current execution id from kf status/instruct.");
    }
    if (feature.stage === "dones" && status !== "PASS") {
      addError(ARTIFACTS["review-report"].file, "review_not_pass", "Only a current PASS review report may enter dones.");
    }
    if (/^(FAIL|REJECT)/i.test(status) && feature.stage === "review") {
      issues.push({
        severity: "WARNING",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["review-report"].file,
        code: "review_loops_back",
        message: `Review ${status.toUpperCase()}: must loop back to implementation, then testing again (kf stage ${feature.name} implementation)`,
      });
    }
    if (/^REQUIREMENT_BUG/i.test(status)) {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["review-report"].file,
        code: "requirement_bug_stop",
        message: "REQUIREMENT_BUG: STOP FEATURE. Do not silently rewrite the requirement — report back to the human.",
      });
    }
  }

  // 7. Traceability: test cases must reference requirements (FR-XXX) and use cases (UC-XXX)
  //    that exist in the planning artifacts.
  if (stageIndex >= STAGE_INDEX.planning && !isBug) {
    const tcPath = join(feature.dir, ARTIFACTS["test-cases"].file);
    const frPath = join(feature.dir, ARTIFACTS["spec-requirement"].file);
    const ucPath = join(feature.dir, ARTIFACTS["use-case-specification"].file);
    const ucDir = join(feature.dir, "use-cases");
    const ucFiles = existsSync(ucDir)
      ? readdirSync(ucDir).filter((file) => /^UC-\d+\.md$/i.test(file))
      : [];
    if (ucFiles.length === 0) {
      addError("use-cases/", "use_cases_missing", "Each use case must be written in its own use-cases/UC-###.md file.");
    }
    const fileIds = new Set(ucFiles.map((file) => file.slice(0, -3).toUpperCase()));
    if (existsSync(ucPath)) {
      const index = readFileSync(ucPath, "utf8");
      const indexedIds = new Set([...index.matchAll(/\bUC-\d+\b/gi)].map((match) => match[0].toUpperCase()));
      for (const id of indexedIds) {
        if (!fileIds.has(id)) addError(`use-cases/${id}.md`, "use_case_file_missing", `${id} is listed in the index but has no individual file.`);
      }
      for (const id of fileIds) {
        if (!indexedIds.has(id)) addError(ARTIFACTS["use-case-specification"].file, "use_case_not_indexed", `${id} must be listed in the use-case index.`);
      }
    }
    const useCaseDocs = ucFiles.map((file) => {
      const path = join(ucDir, file);
      const content = readFileSync(path, "utf8");
      const id = file.slice(0, -3).toUpperCase();
      if (!isFilledFile(content, splitFrontmatter(content).body)) {
        addError(`use-cases/${file}`, "use_case_unfilled", `${file} is empty or still contains template placeholders.`);
      }
      if (!new RegExp(`\\b${id}\\b`, "i").test(content)) {
        addError(`use-cases/${file}`, "use_case_id_missing", `${file} must declare its matching ${id} identifier.`);
      }
      return content;
    });
    if (existsSync(tcPath)) {
      const tcs = readFileSync(tcPath, "utf8");
      const cases = [...tcs.matchAll(/^##\s+(TC-\d+)\b[^\n]*\n([\s\S]*?)(?=^##\s+TC-\d+\b|(?![\s\S]))/gm)];
      if (cases.length === 0) {
        addError(ARTIFACTS["test-cases"].file, "no_test_cases", "Test cases must be defined in separate ## TC-XXX sections.");
      }
      const caseIds = new Set<string>();
      for (const [, id, body] of cases) {
        if (caseIds.has(id.toUpperCase())) addError(ARTIFACTS["test-cases"].file, "duplicate_tc", `Duplicate test case ${id}.`);
        caseIds.add(id.toUpperCase());
        if (!/\bFR-\d+\b/i.test(body) || !/\bUC-\d+\b/i.test(body)) {
          addError(ARTIFACTS["test-cases"].file, "tc_refs_missing", `${id} must reference both a requirement (FR-XXX) and a use case (UC-XXX).`);
        }
      }
      if (!/FR-\d+/i.test(tcs)) {
        issues.push({
          severity: "ERROR",
          feature: feature.name,
          stage: feature.stage,
          file: ARTIFACTS["test-cases"].file,
          code: "no_fr_refs",
          message: "test-cases has no requirement references (FR-XXX); traceability chain broken",
        });
      }
      if (!/UC-\d+/i.test(tcs)) {
        issues.push({
          severity: "ERROR",
          feature: feature.name,
          stage: feature.stage,
          file: ARTIFACTS["test-cases"].file,
          code: "no_uc_refs",
          message: "test-cases has no use case references (UC-XXX); traceability chain broken",
        });
      }
      // FR refs in test cases must exist in the spec-requirement.
      if (existsSync(frPath)) {
        const frDoc = readFileSync(frPath, "utf8");
        const refs = [...tcs.matchAll(/\b(FR-\d+)\b/gi)].map((m) => m[1].toUpperCase());
        const declared = new Set([...frDoc.matchAll(/\bFR-\d+\b/gi)].map((m) => m[0].toUpperCase()));
        const missing = [...new Set(refs)].filter((r) => !declared.has(r));
        if (missing.length > 0) {
          issues.push({
            severity: "ERROR",
            feature: feature.name,
            stage: feature.stage,
            file: ARTIFACTS["test-cases"].file,
            code: "fr_ref_missing",
            message: `test-cases reference requirements not in spec-requirement: ${missing.join(", ")}`,
          });
        }
      }
      // UC references must resolve to individual use-case files.
      if (existsSync(ucPath) || useCaseDocs.length > 0) {
        const refs = [...tcs.matchAll(/\b(UC-\d+)\b/gi)].map((m) => m[1].toUpperCase());
        const declared = fileIds;
        const missing = [...new Set(refs)].filter((r) => !declared.has(r));
        if (missing.length > 0) {
          issues.push({
            severity: "ERROR",
            feature: feature.name,
            stage: feature.stage,
            file: ARTIFACTS["test-cases"].file,
            code: "uc_ref_missing",
            message: `test-cases reference use cases without individual files: ${missing.join(", ")}`,
          });
        }
      }
    }
  }

  // 8. feature-report is required for dones (Phase 6 artifact). If a feature is in dones
  //    without its reports, it is incomplete.
  if (feature.stage === "dones") {
    const requiredDonesArtifacts = isBug
      ? (["testing-result", "review-report"] as ArtifactId[])
      : (["testing-result", "review-report", "feature-report"] as ArtifactId[]);
    for (const id of requiredDonesArtifacts) {
      const p = join(feature.dir, ARTIFACTS[id].file);
      if (!existsSync(p)) {
        issues.push({
          severity: "ERROR",
          feature: feature.name,
          stage: feature.stage,
          file: ARTIFACTS[id].file,
          code: "artifact_missing",
          message: `Archived feature is incomplete: ${ARTIFACTS[id].file} is missing`,
        });
      }
    }
  }

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

/**
 * Checks whether the CURRENT stage allows leaving toward `to`.
 * This is the semantic half of the gate: it reads the report STATUS, not just
 * artifact existence. The artifact gate (validateFeature) and the transition
 * graph (TRANSITIONS) both still apply on top.
 * Returns a list of blocking findings (empty = allowed).
 */
export function checkDirectionGate(feature: Feature, to: Stage): Finding[] {
  const issues: Finding[] = [];
  const read = (file: string): string | null => {
    const p = join(feature.dir, file);
    if (!existsSync(p)) return null;
    const { fm } = splitFrontmatter(readFileSync(p, "utf8"));
    return fm.status ?? null;
  };

  // testing → review requires PASS; testing → implementation required on FAIL.
  if (feature.stage === "testing") {
    const status = read(ARTIFACTS["testing-result"].file);
    if (to === "review" && status !== "PASS") {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["testing-result"].file,
        code: "testing_not_pass",
        message: `testing-result status is ${status ?? "missing"}; only PASS may enter review (FAIL/REJECT must loop back to implementation)`,
      });
    }
    if (to === "implementation" && status === "PASS") {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["testing-result"].file,
        code: "testing_already_pass",
        message: "testing-result is PASS — looping back to implementation hides passing tests; re-run kf stage <feature> review instead",
      });
    }
  }

  // review → dones requires PASS; REQUIREMENT_BUG stops the feature entirely.
  if (feature.stage === "review") {
    const status = read(ARTIFACTS["review-report"].file);
    if (to === "dones" && status !== "PASS") {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["review-report"].file,
        code: "review_not_pass",
        message: `review-report status is ${status ?? "missing"}; only PASS may enter dones (FAIL/REJECT loop to implementation)`,
      });
    }
    if (status === "REQUIREMENT_BUG") {
      issues.push({
        severity: "ERROR",
        feature: feature.name,
        stage: feature.stage,
        file: ARTIFACTS["review-report"].file,
        code: "requirement_bug_stop",
        message: "REQUIREMENT_BUG: STOP FEATURE. Do not silently rewrite the requirement — report back to the human.",
      });
    }
  }

  return issues;
}

export function validateToJson(r: ValidationResult) {
  return {
    feature: r.feature,
    stage: r.stage,
    valid: r.valid,
    issues: r.issues,
  };
}

export { STAGES };
