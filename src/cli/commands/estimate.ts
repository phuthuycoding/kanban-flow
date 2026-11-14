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
import { readContractEstimate, sizeContractEstimate } from "../../workflow/estimate-contract.js";
import { findFeature, type Feature } from "../../workflow/features.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** Bad input; reported with the travel script's message text and exit 1. */
class EstimateInputError extends Error {}

function fail(message: string): never {
  throw new EstimateInputError(message);
}

const inputError = (message: string): EstimateInputError => new EstimateInputError(message);

async function worksRoot(cwd: string): Promise<string> {
  const root = await findRoot(cwd);
  if (!root.ok) fail(root.err ?? "No .works found. Run: kf init");
  return root.root;
}

async function history(cwd: string): Promise<HistoryRow[]> {
  return readEstimateHistory(await worksRoot(cwd));
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

const filesText = (files: number | null, mark: string): string => (files === null ? "unknown files" : `${files} files (${mark})`);

/** Before approval the contract states the estimate; from approval on the recorded one is the item's. */
function contractShown(f: Feature): boolean {
  return f.stage === "brainstorm" || f.stage === "planning";
}

async function show(args: string[], kind: string | undefined, json: boolean, cwd: string): Promise<string[]> {
  if (args.length !== 1 || kind !== undefined) fail("usage: estimates show <feature> [--json]");
  const root = await worksRoot(cwd);
  const f = findFeature(root, args[0]);
  if (!f) fail(`Unknown feature '${args[0]}'. Run: kf list`);
  if (contractShown(f)) {
    const contract = readContractEstimate(f);
    if ("problem" in contract) return json ? [JSON.stringify({ none: true, reason: contract.problem }, null, 2)] : [`no estimate: ${contract.problem}`];
    const { historyProblem, ...sized } = sizeContractEstimate(root, f, contract);
    if (json) return [JSON.stringify({ ...sized, approved: false, ...(historyProblem === null ? {} : { historyProblem }) }, null, 2)];
    return [
      `estimate: ${sized.minutes} min, ${filesText(sized.files, sized.filesMark)}, size ${sized.size}, factor ${sized.factor} — not yet approved`,
      ...(historyProblem === null ? [] : [historyProblem]),
    ];
  }
  const recorded = f.meta?.estimate;
  if (recorded === undefined) {
    const reason = `no estimate was recorded when '${f.name}' was approved`;
    return json ? [JSON.stringify({ none: true, reason }, null, 2)] : [`no estimate: ${reason}`];
  }
  if (json) return [JSON.stringify(recorded, null, 2)];
  if ("none" in recorded) return [`no estimate: ${recorded.reason}`];
  return [`estimate: ${recorded.minutes} min, ${filesText(recorded.files, recorded.filesMark)}, size ${recorded.size}, factor ${recorded.factor} — recorded at approval`];
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
    case "show":
      return show(rest, kind, args.options.json === true, cwd);
    default:
      return fail(`usage: estimates size|stats|overlap|show … (got ${sub ?? "nothing"})`);
  }
}

/** `kf estimate size|stats|overlap|show`: the travel script's lines and exit codes (0 printed, 1 any error). */
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
