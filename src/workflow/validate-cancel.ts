import { finding, type Finding } from "./findings.js";
import type { Feature } from "./features.js";

/**
 * A cancelled item is asked for nothing else (its stage index is negative), so
 * the one thing it must carry is why it was stopped. Without that it is just a
 * folder nobody can explain.
 */
export function checkCancellation(feature: Feature): Finding[] {
  if (feature.stage !== "cancelled") return [];
  const reason = feature.meta?.cancellation?.reason?.trim();
  if (reason) return [];
  return [finding(feature, "ERROR", ".kfw.json", "cancellation_missing",
    "Cancelled work item has no recorded reason. Re-run: kf cancel <feature> --reason \"<why>\" (or move it back to its stage).")];
}
