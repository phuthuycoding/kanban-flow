import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX } from "./schema.js";
import { splitFrontmatter, isFilledFile } from "../shared/frontmatter.js";
import { finding, type Finding } from "./findings.js";
import type { Feature } from "./features.js";

/**
 * Traceability for features from planning on: every use case has its own file
 * matching the index, and every test case references FR/UC ids that exist.
 */
export function checkTraceability(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  if (STAGE_INDEX[feature.stage] < STAGE_INDEX.planning || feature.meta?.kind === "bug") return issues;
  const error = (file: string, code: string, message: string): void => {
    issues.push(finding(feature, "ERROR", file, code, message));
  };
  const tcFile = ARTIFACTS["test-cases"].file;
  const ucIndexFile = ARTIFACTS["use-case-specification"].file;
  const tcPath = join(feature.dir, tcFile);
  const frPath = join(feature.dir, ARTIFACTS["spec-requirement"].file);
  const ucPath = join(feature.dir, ucIndexFile);
  const ucDir = join(feature.dir, "use-cases");
  const ucFiles = existsSync(ucDir)
    ? readdirSync(ucDir).filter((file) => /^UC-\d+\.md$/i.test(file))
    : [];
  if (ucFiles.length === 0) {
    error("use-cases/", "use_cases_missing", "Each use case must be written in its own use-cases/UC-###.md file.");
  }
  const fileIds = new Set(ucFiles.map((file) => file.slice(0, -3).toUpperCase()));
  if (existsSync(ucPath)) {
    const index = readFileSync(ucPath, "utf8");
    const indexedIds = new Set([...index.matchAll(/\bUC-\d+\b/gi)].map((match) => match[0].toUpperCase()));
    for (const id of indexedIds) {
      if (!fileIds.has(id)) error(`use-cases/${id}.md`, "use_case_file_missing", `${id} is listed in the index but has no individual file.`);
    }
    for (const id of fileIds) {
      if (!indexedIds.has(id)) error(ucIndexFile, "use_case_not_indexed", `${id} must be listed in the use-case index.`);
    }
  }
  for (const file of ucFiles) {
    const content = readFileSync(join(ucDir, file), "utf8");
    const id = file.slice(0, -3).toUpperCase();
    if (!isFilledFile(content, splitFrontmatter(content).body)) {
      error(`use-cases/${file}`, "use_case_unfilled", `${file} is empty or still contains template placeholders.`);
    }
    if (!new RegExp(`\\b${id}\\b`, "i").test(content)) {
      error(`use-cases/${file}`, "use_case_id_missing", `${file} must declare its matching ${id} identifier.`);
    }
  }
  if (!existsSync(tcPath)) return issues;

  const tcs = readFileSync(tcPath, "utf8");
  const cases = [...tcs.matchAll(/^##\s+(TC-\d+)\b[^\n]*(?:\n|$)([\s\S]*?)(?=^##\s+TC-\d+\b|(?![\s\S]))/gm)];
  if (cases.length === 0) {
    error(tcFile, "no_test_cases", "Test cases must be defined in separate ## TC-XXX sections.");
  }
  const caseIds = new Set<string>();
  for (const [, id, body] of cases) {
    if (caseIds.has(id.toUpperCase())) error(tcFile, "duplicate_tc", `Duplicate test case ${id}.`);
    caseIds.add(id.toUpperCase());
    if (!/\bFR-\d+\b/i.test(body) || !/\bUC-\d+\b/i.test(body)) {
      error(tcFile, "tc_refs_missing", `${id} must reference both a requirement (FR-XXX) and a use case (UC-XXX).`);
    }
  }
  if (!/FR-\d+/i.test(tcs)) {
    error(tcFile, "no_fr_refs", "test-cases has no requirement references (FR-XXX); traceability chain broken");
  }
  if (!/UC-\d+/i.test(tcs)) {
    error(tcFile, "no_uc_refs", "test-cases has no use case references (UC-XXX); traceability chain broken");
  }
  if (existsSync(frPath)) {
    const frDoc = readFileSync(frPath, "utf8");
    const refs = [...tcs.matchAll(/\b(FR-\d+)\b/gi)].map((m) => m[1].toUpperCase());
    const declared = new Set([...frDoc.matchAll(/\bFR-\d+\b/gi)].map((m) => m[0].toUpperCase()));
    const missing = [...new Set(refs)].filter((r) => !declared.has(r));
    if (missing.length > 0) {
      error(tcFile, "fr_ref_missing", `test-cases reference requirements not in spec-requirement: ${missing.join(", ")}`);
    }
  }
  if (existsSync(ucPath) || ucFiles.length > 0) {
    const refs = [...tcs.matchAll(/\b(UC-\d+)\b/gi)].map((m) => m[1].toUpperCase());
    const missing = [...new Set(refs)].filter((r) => !fileIds.has(r));
    if (missing.length > 0) {
      error(tcFile, "uc_ref_missing", `test-cases reference use cases without individual files: ${missing.join(", ")}`);
    }
  }
  return issues;
}
