import {
  EstimateHistoryError,
  KINDS,
  defaultSizeLines,
  overlapVerdict,
  parseNumber,
  readEstimateHistory,
  sizeLines,
  statsLines,
  type HistoryRow,
} from "../../workflow/estimate.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** Bad input; reported with the travel script's message text and exit 1. */
class EstimateInputError extends Error {}

function fail(message: string): never {
  throw new EstimateInputError(message);
}

const inputError = (message: string): EstimateInputError => new EstimateInputError(message);

async function history(cwd: string): Promise<HistoryRow[]> {
  const root = await findRoot(cwd);
  if (!root.ok) fail(root.err ?? "No .works found. Run: kf init");
  return readEstimateHistory(root.root);
}

async function size(args: string[], kind: string | undefined, cwd: string): Promise<string[]> {
  if (args.length !== 2) fail("usage: estimates size <minutes> <files|unknown> [--kind feature|bug|pr]");
  const minutes = parseNumber("minutes", args[0], false, inputError);
  const files = args[1] === "unknown" ? null : parseNumber("files", args[1], true, inputError);
  if (kind === undefined) return defaultSizeLines(minutes, files);
  if (!KINDS.includes(kind)) fail(`kind must be feature|bug|pr: ${kind}`);
  return sizeLines(minutes, files, await history(cwd), kind);
}

async function stats(args: string[], kind: string | undefined, cwd: string): Promise<string[]> {
  if (args.length !== 0 || kind !== undefined) fail("usage: estimates stats");
  return statsLines(await history(cwd));
}

function overlap(args: string[], kind: string | undefined): string[] {
  if (args.length !== 2 || kind !== undefined) fail("usage: estimates overlap <filesA> <filesB>");
  return [overlapVerdict(args[0], args[1])];
}

async function run(args: ParsedArgs, cwd: string): Promise<string[]> {
  const [sub, ...rest] = args.positionals;
  const kind = typeof args.options.kind === "string" ? args.options.kind : undefined;
  switch (sub) {
    case "size":
      return size(rest, kind, cwd);
    case "stats":
      return stats(rest, kind, cwd);
    case "overlap":
      return overlap(rest, kind);
    default:
      return fail(`usage: estimates size|stats|overlap … (got ${sub ?? "nothing"})`);
  }
}

/** `kf estimate size|stats|overlap`: the travel script's lines and exit codes (0 printed, 1 any error). */
export async function cmdEstimate(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  try {
    return { code: 0, stdout: (await run(args, cwd)).join("\n") };
  } catch (err) {
    if (err instanceof EstimateInputError || err instanceof EstimateHistoryError) {
      return { code: 1, stdout: "", stderr: `estimates: ${err.message}` };
    }
    throw err;
  }
}
