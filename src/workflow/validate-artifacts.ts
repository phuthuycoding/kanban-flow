import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_GATES, STAGE_INDEX, FEATURE_ONLY_ARTIFACTS, type ArtifactId } from "./schema.js";
import { splitFrontmatter, isFilledFile } from "../shared/frontmatter.js";
import { findSecretLike } from "./secrets.js";
import { finding, type Finding } from "./findings.js";
import type { Feature } from "./features.js";

/** Each artifact that is DUE at the current stage must exist, be filled and contain no secrets. */
export function checkDueArtifacts(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const stageIndex = STAGE_INDEX[feature.stage];
  const isBug = feature.meta?.kind === "bug";
  for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
    const def = ARTIFACTS[id];
    if (isBug && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const path = join(feature.dir, def.file);
    if (stageIndex < def.dueFromStage) continue;

    if (!existsSync(path)) {
      issues.push(finding(feature, "ERROR", def.file, "artifact_missing", `Required artifact ${def.file} is missing`));
      continue;
    }
    const content = readFileSync(path, "utf8");
    if (!isFilledFile(content, splitFrontmatter(content).body)) {
      issues.push(finding(feature, "ERROR", def.file, "artifact_unfilled",
        `${def.file} is empty or still contains template placeholders (needs real content)`));
    }
  }
  return issues;
}

/**
 * Secrets in any artifact that is on disk, whatever stage the item is in.
 *
 * This deliberately does NOT share the `dueFromStage` guard above. A credential is a credential
 * whether or not the workflow has reached the phase that asks for the file, and `cancelled` sits
 * at `STAGE_INDEX = -1`, which made that guard skip every artifact — so cancelling an item was
 * the quietest way to take a committed token off the radar while leaving it in the repo.
 */
export function checkSecrets(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const isBug = feature.meta?.kind === "bug";
  for (const id of Object.keys(ARTIFACTS) as ArtifactId[]) {
    const def = ARTIFACTS[id];
    if (isBug && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const path = join(feature.dir, def.file);
    if (!existsSync(path)) continue;
    const secrets = findSecretLike(readFileSync(path, "utf8"));
    if (secrets.length > 0) {
      issues.push(finding(feature, "ERROR", def.file, "artifact_secret",
        `${def.file} contains secret-like content (${secrets.length} line${secrets.length > 1 ? "s" : ""}) — remove credentials from workflow artifacts`));
    }
  }
  return issues;
}

/** Stage gate: to leave the current stage, gate artifacts must be complete and the requirement confirmed. */
export function checkStageGate(feature: Feature): Finding[] {
  const issues: Finding[] = [];
  const isBug = feature.meta?.kind === "bug";
  for (const id of STAGE_GATES[feature.stage]) {
    if (isBug && FEATURE_ONLY_ARTIFACTS.includes(id)) continue;
    const def = ARTIFACTS[id];
    const path = join(feature.dir, def.file);
    if (!existsSync(path)) {
      issues.push(finding(feature, "ERROR", def.file, "gate_blocked", `Cannot leave stage "${feature.stage}" — ${def.file} is missing`));
      continue;
    }
    const raw = readFileSync(path, "utf8");
    if (!isFilledFile(raw, splitFrontmatter(raw).body)) {
      issues.push(finding(feature, "ERROR", def.file, "gate_blocked", `Cannot leave stage "${feature.stage}" — ${def.file} is not filled`));
    }
  }

  // Scoped to the stages that still owe a confirmed requirement. Unguarded it fired everywhere:
  // an archived item whose spec reads `status: archived`, or one in review reading `approved`,
  // were both told the requirement must be confirmed "before leaving brainstorm".
  //
  // It must keep firing at `planning`, not only at `brainstorm`: `kf approve` validates there,
  // and this is the only check that reads the spec's status. Narrowing it to brainstorm alone
  // let `kf approve` seal a contract whose requirement had been reopened to `pending`, and the
  // fingerprint cannot catch that — it hashes the spec as it stands at approval time, so the
  // pending state becomes the contract and it is the later *correction* that reads as drift.
  const specPath = join(feature.dir, ARTIFACTS["spec-requirement"].file);
  const owesConfirmation = STAGE_INDEX[feature.stage] <= STAGE_INDEX.planning;
  if (owesConfirmation && existsSync(specPath)
    && splitFrontmatter(readFileSync(specPath, "utf8")).fm.status !== "confirmed") {
    issues.push(finding(feature, "ERROR", ARTIFACTS["spec-requirement"].file, "requirement_unconfirmed",
      "Requirement must have status: confirmed before the contract is approved or leaves brainstorm."));
  }
  return issues;
}
