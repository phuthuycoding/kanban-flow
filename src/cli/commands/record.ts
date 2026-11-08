import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";
import { recordEvent } from "../../workflow/next/record.js";
import { resolveItem } from "./helpers.js";

const USAGE =
  "Usage: kf record <feature> <event> [args…] [--model <m>] [--round <R>] [--cascade <sha>] [--status <S>] [--exit <n>] [-- <text>]";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

const opt = (args: ParsedArgs, name: string): string | undefined => {
  const v = args.options[name];
  return typeof v === "string" ? v : undefined;
};

export async function cmdRecord(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  if (args.positionals.length === 0) return badInput("Missing <feature>.");
  if (args.positionals.length === 1) return badInput("Missing <event>.");
  const [name, event, ...rest] = args.positionals;
  const found = await resolveItem(cwd, name);
  if (!found.ok) return found.refusal;
  const res = await recordEvent(found.root, found.item, {
    event,
    args: rest,
    model: opt(args, "model"),
    round: opt(args, "round"),
    cascade: opt(args, "cascade"),
    status: opt(args, "status"),
    exit: opt(args, "exit"),
  });
  if (res.code === 0) return { code: 0, stdout: res.stdout };
  if (res.code === 3) return badInput(res.stdout);
  return { code: 1, stdout: res.stdout, stderr: "refused" };
}
