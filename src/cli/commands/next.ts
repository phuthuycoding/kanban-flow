import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf next <feature> [--resume] [--json]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

export function cmdNext(args: ParsedArgs, _cwd: string): CmdResult {
  if (args.parseError !== undefined) return badInput(args.parseError);
  if (args.positionals.length === 0) return badInput("Missing <feature>.");
  if (args.positionals.length > 1) return badInput(`Expected one feature, got: ${args.positionals.join(" ")}`);
  return { code: 1, stdout: "", stderr: "kf next: scheduler not implemented yet" };
}
