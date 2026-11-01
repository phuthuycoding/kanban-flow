import { verifyStage, verifyTask } from "../../workflow/verify.js";
import { ProjectConfigError } from "../../project/config.js";
import { resolveItem } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf verify <feature> --task TASK-### --base <sha> | kf verify <feature> --stage";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

export async function cmdVerify(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  const name = args.positionals[0];
  if (!name) return badInput("Missing <feature>.");
  const task = typeof args.options.task === "string" ? args.options.task : undefined;
  const base = typeof args.options.base === "string" ? args.options.base : undefined;
  const stage = args.options.stage === true;
  if (task !== undefined && stage) return badInput("Give either --task or --stage, not both.");
  if (task === undefined && !stage) return badInput("Give --task TASK-### --base <sha>, or --stage.");
  if (task !== undefined && base === undefined) return badInput("--task needs --base <sha> (the commit before the task).");
  if (stage && base !== undefined) return badInput("--base goes with --task, not --stage.");

  const item = await resolveItem(cwd, name);
  if (!item.ok) return { ...item.refusal, code: 3 };
  let res;
  try {
    res = task !== undefined ? verifyTask(item.root, item.item, task, base!) : verifyStage(item.root, item.item);
  } catch (err) {
    if (err instanceof ProjectConfigError) return badInput(err.message);
    throw err;
  }
  return { code: res.code, stdout: res.lines.join("\n") };
}
