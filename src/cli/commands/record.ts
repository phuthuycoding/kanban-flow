import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE =
  "Usage: kf record <feature> <event> [args…] [--model <m>] [--round <R>] [--cascade <sha>] [--status <S>] [--exit <n>] [-- <text>]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

export function cmdRecord(args: ParsedArgs, _cwd: string): CmdResult {
  if (args.parseError !== undefined) return badInput(args.parseError);
  if (args.positionals.length === 0) return badInput("Missing <feature>.");
  if (args.positionals.length === 1) return badInput("Missing <event>.");
  return { code: 1, stdout: "", stderr: "kf record: not implemented yet" };
}
