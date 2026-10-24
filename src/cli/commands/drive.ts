import { claimDrive, driveView, startDetachedDrive, stopDrive, superviseDrive, type DriveOutcome, type DriveView } from "../../harness/drive.js";
import { resolveItem } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = "Usage: kf drive <feature> [--status] [--stop] [--json]";

function renderView(v: DriveView): string {
  const lines = [
    `Drive ${v.id} of '${v.feature}': ${v.state} (step ${v.step})`,
    `  Loops: ${v.loops}/${v.maxLoops}   Runs: ${v.runs}/${v.maxRuns}`,
  ];
  if (v.runningTasks.length > 0) lines.push(`  Running tasks: ${v.runningTasks.join(", ")}`);
  if (v.reason) lines.push(`  ${v.stopCode ? `Stop: ${v.stopCode} — ` : v.state === "crashed" ? "Crashed: " : "Result: "}${v.reason}`);
  if (v.nextCommand && v.state !== "running") lines.push(`  Next: ${v.nextCommand}`);
  for (const w of v.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join("\n");
}

function renderOutcome(name: string, id: string, o: DriveOutcome): string {
  const head = o.status === "ready"
    ? `✓ Drive ${id} of '${name}': ${o.reason}`
    : `✗ Drive ${id} of '${name}' stopped: ${o.stopCode} — ${o.reason}`;
  return `${head}\n  Loops: ${o.loops}   Runs: ${o.runs}\n  Next: ${o.nextCommand}`;
}

export async function cmdDrive(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: USAGE, stderr: "missing feature" };
  const json = Boolean(args.options.json);
  const root = await resolveItem(cwd, name);
  if (!root.ok) return root.refusal;
  const feature = root.item;

  if (typeof args.options.supervise === "string") {
    const outcome = await superviseDrive(root.root, feature.name, args.options.supervise);
    return { code: outcome.status === "ready" ? 0 : 1, stdout: renderOutcome(feature.name, args.options.supervise, outcome) };
  }

  if (args.options.status) {
    const view = driveView(root.root, feature);
    if (!view) return { code: 1, stdout: `'${feature.name}' has no drive. Start one: kf drive ${feature.name}`, stderr: "no drive" };
    return { code: 0, stdout: json ? JSON.stringify(view, null, 2) : renderView(view) };
  }

  if (args.options.stop) {
    const stopped = await stopDrive(root.root, feature.name);
    return stopped.ok ? { code: 0, stdout: stopped.message } : { code: 1, stdout: stopped.message, stderr: "no running drive" };
  }

  const claim = await claimDrive(root.root, feature.name);
  if (!claim.ok) return { code: 1, stdout: claim.reason, stderr: "drive refused" };
  const pid = await startDetachedDrive(root.root, feature.name, claim.drive);
  if (json) return { code: 0, stdout: JSON.stringify({ feature: feature.name, id: claim.drive.id, resumed: claim.resumed, supervisorPid: pid }, null, 2) };
  return {
    code: 0,
    stdout: `${claim.resumed ? "Resumed" : "Started"} drive ${claim.drive.id} of '${feature.name}' (supervisor pid ${pid}, step ${claim.drive.step}).\n  Status: kf drive ${feature.name} --status\n  Stop:   kf drive ${feature.name} --stop`,
  };
}
