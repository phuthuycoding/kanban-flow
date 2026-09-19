import { STAGE_INDEX } from "./schema.js";
import { executionContractHash, type Feature } from "./features.js";
import { finding, type Finding } from "./findings.js";

/** Approval binds the requirement and planning artifacts throughout execution. */
export function checkApproval(feature: Feature, requireApproval: boolean): Finding[] {
  if (STAGE_INDEX[feature.stage] < STAGE_INDEX.planning || !requireApproval) return [];
  const isBug = feature.meta?.kind === "bug";
  const status = feature.meta?.approval?.status ?? "pending";
  if (status !== "approved") {
    return [finding(feature, "ERROR", "plan", "approval_required",
      "Execution contract not approved by a human (Phase 2 gate). Return to planning and run: kf approve <feature>")];
  }
  if (!feature.meta?.approval?.contractHash || feature.meta.approval.contractHash !== executionContractHash(feature.dir, isBug ? "bug" : "feature")) {
    return [finding(feature, "ERROR", "plan", "approval_changed",
      "Execution contract changed or has no approval fingerprint. Return to planning for human approval.")];
  }
  return [];
}

/** Deliberate bypasses are recorded, never hidden: surface them on every validation. */
export function checkBypasses(feature: Feature): Finding[] {
  const bypasses = feature.meta?.bypasses ?? [];
  if (bypasses.length === 0) return [];
  const last = bypasses[bypasses.length - 1];
  return [finding(feature, "WARNING", ".kfw.json", "gate_bypassed",
    `${bypasses.length} gate/hook bypass${bypasses.length > 1 ? "es" : ""} recorded (last: --${last.flag} ${last.from ?? "?"} → ${last.to} at ${last.at}); review them before trusting this item`)];
}
