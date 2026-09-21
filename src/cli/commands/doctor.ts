import { runDoctor, type DoctorFinding } from "../../project/doctor.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

function renderFinding(f: DoctorFinding): string[] {
  const lines = [`  [${f.level}] ${f.area}: ${f.message}`];
  if (f.action) lines.push(`      → ${f.action}`);
  return lines;
}

export async function cmdDoctor(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const report = runDoctor(root.root);

  if (args.options.json) {
    return { code: report.ok ? 0 : 1, stdout: JSON.stringify(report, null, 2) };
  }

  const lines = [`Project: ${report.root}`, ""];
  if (report.findings.length === 0) {
    lines.push("No problems found.");
  } else {
    for (const f of report.findings) lines.push(...renderFinding(f));
  }
  lines.push("");
  // Deliberately below the findings and outside them: an invalid work item is an ordinary state
  // for a pipeline in motion, not a broken project, so it never changes the verdict.
  lines.push(report.totalItems === 0
    ? "Work items: none yet."
    : `Work items: ${report.totalItems}, ${report.invalidItems} not currently valid` +
      (report.invalidItems > 0 ? " — run: kf validate --all" : ""));
  lines.push("");
  lines.push(report.ok ? "✓ Healthy." : "✗ Problems found — see the ERROR lines above.");

  return { code: report.ok ? 0 : 1, stdout: lines.join("\n"), stderr: report.ok ? undefined : "doctor found problems" };
}
