import { runDoctor, applyDoctorFixes, type DoctorFinding } from "../../project/doctor.js";
import { readProjectConfig } from "../../project/config.js";
import { readMachineConfig, worktreeConfig } from "../../worktree/config.js";
import { probeDomainInfra } from "../../worktree/health.js";
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

  // --fix first, then the report reflects the after-state rather than the damage it repaired.
  const fixed = args.options.fix ? await applyDoctorFixes(root.root) : [];
  const report = runDoctor(root.root);

  // Domain infra probes are async (DNS + TCP), so they live here rather than inside the
  // synchronous runDoctor. They are WARNING-only: the machine, not the work item, is what
  // is missing when they fail. An unreadable project config is already an ERROR finding
  // from runDoctor — probing needs that config, so it is skipped rather than re-thrown.
  try {
    const project = readProjectConfig(root.root);
    const wtCfg = worktreeConfig(root.root, project.worktree);
    if (wtCfg.enabled) {
      const machine = readMachineConfig();
      const infra = await probeDomainInfra(machine, wtCfg.routesFile);
      for (const probe of infra.probes) {
        if (!probe.ok) {
          report.findings.push({
            level: "WARNING",
            area: `worktree infra (${probe.name})`,
            message: probe.detail,
            action: "sudo kf worktree setup (one-time machine onboarding)",
          });
        }
      }
    }
  } catch {
    /* config parse already surfaced as an ERROR finding above */
  }

  if (args.options.json) {
    return { code: report.ok ? 0 : 1, stdout: JSON.stringify({ ...report, fixed }, null, 2) };
  }

  const lines = [`Project: ${report.root}`, ""];
  if (fixed.length > 0) {
    lines.push(`Fixed (${fixed.length}):`, ...fixed.map((f) => `  ✓ ${f}`), "");
  }
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
