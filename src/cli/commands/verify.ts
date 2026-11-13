import { appendVerifyLog, appendWaveVerifyLog, verifyStage, verifyTask, verifyTaskCommits, verifyWave } from "../../workflow/verify.js";
import type { VerifyResult } from "../../workflow/verify.js";
import { appendStageRecord } from "../../workflow/stage-record.js";
import type { StageRecord } from "../../workflow/stage-record.js";
import { ProjectConfigError, readProjectConfig } from "../../project/config.js";
import { detectReviewer } from "../../project/bootstrap.js";
import { updateFeatureMeta } from "../../workflow/features.js";
import { resolveItem } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf verify <feature> --task TASK-### --base <sha> | --commits <sha>[,<sha>…] [--at-head] | kf verify <feature> --stage [--waive \"<reason>\"] | kf verify <feature> --wave <w>";

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
  const waive = typeof args.options.waive === "string" ? args.options.waive : undefined;
  const waveArg = typeof args.options.wave === "string" ? args.options.wave : undefined;
  if (waveArg !== undefined) {
    if (task !== undefined || stage || base !== undefined || commits !== undefined || atHead || waive !== undefined) {
      return badInput("--wave runs alone: not with --task, --stage, --base, --commits, --at-head or --waive.");
    }
    if (!/^[1-9]\d*$/.test(waveArg)) return badInput(`--wave '${waveArg}' is not a wave number (1, 2, …).`);
    return runWave(cwd, name, Number(waveArg));
  }
  if (waive !== undefined && !stage) return badInput("--waive goes with --stage.");
  if (waive !== undefined && waive.trim() === "") return badInput("--waive needs a reason: kf verify <feature> --stage --waive \"<why this project has no stage verify>\".");
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
  if (waive !== undefined) return recordWaiver(item.root, item.item.name, waive.trim());
  let res: VerifyResult & { record?: StageRecord };
  try {
    if (task === undefined) res = verifyStage(item.root, item.item);
    else if (shas !== undefined) res = verifyTaskCommits(item.root, item.item, task, shas, atHead);
    else res = verifyTask(item.root, item.item, task, base!);
  } catch (err) {
    if (err instanceof ProjectConfigError) return badInput(err.message);
    return { code: 3, stdout: `kf verify could not run: ${err instanceof Error ? err.message : String(err)}`, stderr: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  // Exit 3 ran nothing. A failed append must not replace the verdict of commands that did run.
  if (task !== undefined && res.code !== 3) {
    try {
      appendVerifyLog(item.item.dir, task, res);
    } catch (err) {
      return { code: res.code, stdout: res.lines.join("\n"), stderr: `warning: could not write the verify log: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (res.record) {
    try {
      await appendStageRecord(item.root, item.item, res.record);
    } catch (err) {
      return { code: res.code, stdout: res.lines.join("\n"), stderr: `warning: could not write the stage verify record: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { code: res.code, stdout: res.lines.join("\n") };
}

/** A waiver stands in for a record only where nothing is pinned to run; once commands are pinned, the record is owed. */
async function recordWaiver(root: string, name: string, reason: string): Promise<CmdResult> {
  let pinned: string[][] | undefined;
  try {
    pinned = readProjectConfig(root).harness?.verify?.stage;
  } catch (err) {
    if (err instanceof ProjectConfigError) return badInput(err.message);
    throw err;
  }
  if (pinned && pinned.length > 0) {
    return badInput(`harness.verify.stage pins ${pinned.length} command(s), so '${name}' needs a stage record, not a waiver. Run: kf verify ${name} --stage`);
  }
  const waiver = { reason, at: new Date().toISOString(), by: detectReviewer(root) };
  await updateFeatureMeta(root, name, (meta) => ({ ...meta, verifyWaiver: waiver }), {}, "waiver");
  return { code: 0, stdout: `Recorded a stage verify waiver for '${name}' (by ${waiver.by}): ${reason}` };
}

/** `kf verify <f> --wave <w>`: the wave's full suite, recorded as a stage record and logged beside the ledger. */
async function runWave(cwd: string, name: string, wave: number): Promise<CmdResult> {
  const item = await resolveItem(cwd, name);
  if (!item.ok) return { ...item.refusal, code: 3 };
  let res: VerifyResult & { record?: StageRecord };
  try {
    res = verifyWave(item.root, item.item, wave);
  } catch (err) {
    if (err instanceof ProjectConfigError) return badInput(err.message);
    return { code: 3, stdout: `kf verify could not run: ${err instanceof Error ? err.message : String(err)}`, stderr: err instanceof Error ? (err.stack ?? err.message) : String(err) };
  }
  if (res.code === 3 || !res.record) return { code: res.code, stdout: res.lines.join("\n") };
  const warnings: string[] = [];
  try {
    appendWaveVerifyLog(item.item.dir, wave, res);
  } catch (err) {
    warnings.push(`warning: could not write the wave verify log: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await appendStageRecord(item.root, item.item, res.record);
  } catch (err) {
    // kf next reads only the record for a pass, so a pass it cannot see would leave the wave owed: say so with exit 3.
    // A failure keeps exit 1, as the ledger's verify done line carries it and the reopen route depends on it.
    warnings.push(`warning: could not write the stage verify record: ${err instanceof Error ? err.message : String(err)}`);
    if (res.code === 0) return { code: 3, stdout: res.lines.join("\n"), stderr: warnings.join("\n") };
  }
  return warnings.length > 0 ? { code: res.code, stdout: res.lines.join("\n"), stderr: warnings.join("\n") } : { code: res.code, stdout: res.lines.join("\n") };
}
