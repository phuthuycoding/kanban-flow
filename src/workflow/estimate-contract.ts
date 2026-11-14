import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS } from "./schema.js";
import { readMarkdownSection, splitFrontmatter } from "../shared/frontmatter.js";
import { parseTaskGraph } from "./tasks.js";
import { EstimateHistoryError, factorFor, readEstimateHistory, sizeOf, type Size } from "./estimate.js";
import type { Feature } from "./features.js";

export type FilesMark = "exact" | "partial" | "unknown";

/** The estimate a contract states: the agent minutes and the files its plan names, or why there is none. */
export type ContractEstimate = { minutes: number; files: number | null; filesMark: FilesMark } | { problem: string };

/** The contract estimate sized with the learned factor; `historyProblem` is set when the history could not be read. */
export interface SizedContractEstimate {
  minutes: number;
  files: number | null;
  filesMark: FilesMark;
  size: Size;
  factor: number;
  historyProblem: string | null;
}

/** The artifact an item states its estimate in: the plan of a feature, the bug report of a bug. */
export function estimateFile(feature: Feature): string {
  return feature.meta?.kind === "bug" ? ARTIFACTS["spec-requirement"].file : ARTIFACTS["implementation-plan"].file;
}

/** A glob, or a path that names a directory (a trailing slash, or no dot in its last segment), counts more than one file. */
function namesManyFiles(entry: string): boolean {
  if (/[*?]/.test(entry) || entry.endsWith("/")) return true;
  const last = entry.slice(entry.lastIndexOf("/") + 1);
  return !last.includes(".");
}

function planFiles(body: string): { files: number | null; filesMark: FilesMark } {
  const { tasks } = parseTaskGraph(body);
  const cells = tasks.map((t) => t.files);
  const named = cells.filter((c): c is string[] => c !== null);
  if (named.length === 0) return { files: null, filesMark: "unknown" };
  const entries = new Set(named.flat());
  const partial = named.length < cells.length || [...entries].some(namesManyFiles);
  return { files: entries.size, filesMark: partial ? "partial" : "exact" };
}

/** The `## Estimate` section's agent minutes, and for a plan the distinct entries of its Task Breakdown `Files` cells. */
export function readContractEstimate(feature: Feature): ContractEstimate {
  const bug = feature.meta?.kind === "bug";
  const file = estimateFile(feature);
  const what = bug ? "the bug report" : "the plan";
  const path = join(feature.dir, file);
  if (!existsSync(path)) return { problem: `${what} ${file} does not exist yet` };
  const { body } = splitFrontmatter(readFileSync(path, "utf8"));
  const section = readMarkdownSection(body, "Estimate");
  if (section === null) return { problem: `${what} has no ## Estimate section with "- Agent minutes: <n>"` };
  const match = /Agent minutes:[ \t]*(-?\d+(?:\.\d+)?)(?![\w.])/i.exec(section);
  if (!match) return { problem: `the ## Estimate section of ${what} has no number after "Agent minutes:"` };
  const minutes = Number(match[1]);
  if (minutes <= 0) return { problem: `the agent minutes of ${what} must be above 0: ${match[1]}` };
  if (bug) return { minutes, files: null, filesMark: "unknown" };
  return { minutes, ...planFiles(body) };
}

/**
 * The size of a contract estimate: its minutes times the factor learned for the item's kind, against its files.
 * A history that cannot be read leaves the factor at 1 and says why; the estimate is never refused for it.
 */
export function sizeContractEstimate(
  root: string | null,
  feature: Feature,
  estimate: { minutes: number; files: number | null; filesMark: FilesMark },
): SizedContractEstimate {
  let factor = 1;
  let historyProblem: string | null = null;
  if (root !== null) {
    try {
      factor = factorFor(readEstimateHistory(root), feature.meta?.kind ?? "feature").factor;
    } catch (err) {
      if (!(err instanceof EstimateHistoryError)) throw err;
      historyProblem = `estimates history: ${err.message} — factor 1 used`;
    }
  }
  return { ...estimate, size: sizeOf(estimate.minutes * factor, estimate.files), factor, historyProblem };
}
