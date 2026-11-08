import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";
import { readLoopInputs } from "../../workflow/next/inputs.js";
import { readLedgerState } from "../../workflow/next/ledger-state.js";
import { schedule } from "../../workflow/next/schedule.js";
import type { Action, NextResult } from "../../workflow/next/types.js";
import { resolveItem } from "./helpers.js";

const USAGE = "Usage: kf next <feature> [--resume] [--json]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

function actionLines(a: Action): string[] {
  switch (a.kind) {
    case "dispatch":
      return [
        `dispatch ${a.seat} ${a.task}${a.round !== undefined ? ` round=${a.round}` : ""}${a.cascade !== undefined ? ` cascade=${a.cascade}` : ""} ${a.mode}${a.inline ? " inline" : ""}`,
      ];
    case "verify":
      return [`verify ${a.task}: ${a.command}`];
    case "write":
      return [`write: ${a.line}`, `  ${a.record}`];
    case "complete":
      return [`complete ${a.task}`];
    case "wait":
      return [`wait ${a.task}: ${a.reason}`];
    case "decide":
      return [`decide${a.task ? ` ${a.task}` : ""} (${a.rule}): ${a.reason} — closes with ${a.closes}`];
    case "stop":
      return [`stop${a.task ? ` ${a.task}` : ""}: ${a.reason}`];
    case "finished":
      return ["finished"];
  }
}

function render(result: NextResult): string {
  const lines = result.actions.flatMap(actionLines);
  lines.push("In flight:");
  for (const f of result.inFlight) lines.push(`  ${f.task} ${f.seat}${f.hint ? ` — ${f.hint}` : ""}`);
  if (result.inFlight.length === 0) lines.push("  none");
  return lines.join("\n");
}

export async function cmdNext(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  if (args.positionals.length === 0) return badInput("Missing <feature>.");
  if (args.positionals.length > 1) return badInput(`Expected one feature, got: ${args.positionals.join(" ")}`);
  const found = await resolveItem(cwd, args.positionals[0]);
  if (!found.ok) return found.refusal;

  const inputs = readLoopInputs(found.root, found.item);
  if (!inputs.ok) return { code: 1, stdout: inputs.reason, stderr: "refused" };

  const ledgerPath = join(found.item.dir, "loop", "progress.md");
  const ledger = readLedgerState(existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "");
  if (!ledger.ok) {
    const lines = ledger.repair.map((r) => `line ${r.line}: ${r.text} — ${r.reason}`);
    lines.push(`Repair these lines of ${ledgerPath}, then run kf next again.`);
    return { code: 1, stdout: lines.join("\n"), stderr: "refused" };
  }

  const result = schedule(ledger.state, inputs.inputs, { resume: args.options.resume === true });
  return { code: 0, stdout: args.options.json === true ? JSON.stringify(result, null, 2) : render(result) };
}
