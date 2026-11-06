import { appendVerifyLog, verifyStage, verifyTask, verifyTaskCommits } from "../../workflow/verify.js";
import { ProjectConfigError } from "../../project/config.js";
import { resolveItem } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf verify <feature> --task TASK-### --base <sha> | --commits <sha>[,<sha>…] [--at-head] | kf verify <feature> --stage";

const badInput = (reason: string): CmdResult => ({ code: 3, stdout: `${reason}\n${USAGE}`, stderr: "bad input" });

export async function cmdVerify(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  if (args.parseError !== undefined) return badInput(args.parseError);
  const name = args.positionals[0];
  if (!name) return badInput("Missing <feature>.");
  const task = typeof args.options.task === "string" ? args.options.task : undefined;
  const base = typeof args.options.base === "string" ? args.options.base : undefined;
  const commits = typeof args.options.commits === "string" ? args.options.commits : undefined;
  const stage = args.options.stage === true;
  const atHead = args.options["at-head"] === true;
  if (atHead && commits === undefined) return badInput("--at-head goes with --commits.");
  if (stage && commits !== undefined) return badInput("--commits goes with --task, not --stage.");
  if (task !== undefined && stage) return badInput("Give either --task or --stage, not both.");
  if (task === undefined && !stage) return badInput("Give --task TASK-### --base <sha>, or --stage.");
  if (task !== undefined && base !== undefined && commits !== undefined) return badInput("Give --base or --commits with --task, not both.");
  if (task !== undefined && base === undefined && commits === undefined) {
    return badInput("--task needs --base <sha> (the commit before the task) or --commits <sha>[,<sha>…] (the task's commits).");
  }
  if (stage && base !== undefined) return badInput("--base goes with --task, not --stage.");
  const shas = commits?.split(",").map((s) => s.trim());
  if (shas !== undefined && shas.some((s) => s === "")) return badInput("--commits is empty or has an empty element.");

  const item = await resolveItem(cwd, name);
  if (!item.ok) return { ...item.refusal, code: 3 };
  let res;
  try {
    if (task === undefined) res = verifyStage(item.root, item.item);
    else if (shas !== undefined) res = verifyTaskCommits(item.root, item.item, task, shas, atHead);
    else res = verifyTask(item.root, item.item, task, base!);
    if (task !== undefined) appendVerifyLog(item.item.dir, task, res);
  } catch (err) {
    if (err instanceof ProjectConfigError) return badInput(err.message);
    return { code: 3, stdout: `kf verify could not run: ${err instanceof Error ? err.message : String(err)}`, stderr: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  return { code: res.code, stdout: res.lines.join("\n") };
}
