import { findWorksRoot, type Feature } from "./features.js";
import { finding, type Finding } from "./findings.js";
import { estimateFile, readContractEstimate, sizeContractEstimate, type SizedContractEstimate } from "./estimate-contract.js";

/** The codes of the estimate findings: notices, never blockers. */
export const ESTIMATE_CODES: ReadonlySet<string> = new Set(["estimate_missing", "estimate_should_split"]);

function filesText(e: SizedContractEstimate): string {
  if (e.files === null) return "unknown files";
  return `${e.files} files${e.filesMark === "partial" ? " (partial count)" : ""}`;
}

function minutesText(e: SizedContractEstimate): string {
  return e.factor === 1 ? `${e.minutes} min` : `${e.minutes} min × ${e.factor} learned`;
}

/**
 * WARNINGs about the contract estimate while the item is in planning: missing or unusable, or sizing XL (should split).
 * After planning the estimate is recorded and nothing is raised. A history that cannot be read is project state, not
 * the item's contract, so it is no finding here: see estimateHistoryNotice.
 */
export function checkEstimate(feature: Feature): Finding[] {
  if (feature.stage !== "planning" || !feature.meta) return [];
  const file = estimateFile(feature);
  const contract = readContractEstimate(feature);
  if ("problem" in contract) return [finding(feature, "WARNING", file, "estimate_missing", `no estimate: ${contract.problem}`)];
  const sized = sizeContractEstimate(findWorksRoot(feature.dir), feature, contract);
  if (sized.size !== "XL") return [];
  return [finding(feature, "WARNING", file, "estimate_should_split", `estimate ${minutesText(sized)}, ${filesText(sized)} sizes XL — should split`)];
}

/** Why a planning item's estimate is sized with factor 1 because the history cannot be read; null when it can, or nothing is sized. */
export function estimateHistoryNotice(feature: Feature): string | null {
  if (feature.stage !== "planning" || !feature.meta) return null;
  const contract = readContractEstimate(feature);
  if ("problem" in contract) return null;
  return sizeContractEstimate(findWorksRoot(feature.dir), feature, contract).historyProblem;
}
