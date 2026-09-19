import { relative, join } from "node:path";

import { findFeature, listFeatures, type Feature, type RunRecord } from "../../workflow/features.js";
import { STAGES, type Stage } from "../../workflow/schema.js";
import { readProjectConfig } from "../../project/config.js";
import { resolveChain, type Assignment } from "../../harness/prompt.js";
import { provisionSession } from "../../harness/session.js";
import { executeChain, planFor, type ChainResultSummary } from "../../harness/chain.js";
import { isPidAlive, runningRun, DEFAULT_TIMEOUT_MS, type RunOutcome } from "../../harness/run.js";
import { startDetached, superviseRun } from "../../harness/supervise.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

function parseTimeout(raw: unknown): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) throw new Error(`Invalid --timeout '${String(raw)}': expected minutes (0 = no limit).`);
  return Math.round(minutes * 60_000);
}

function renderOutcome(root: string, feature: Feature, outcome: RunOutcome): string {
  const r = outcome.record;
  const lines = [
    `${outcome.ok ? "✓" : "✗"} ${r.chain ? `[${r.chain.index}/${r.chain.total}] ` : ""}${r.role} (${r.runner}) run ${r.id} @ ${r.stage} (${r.mode}) — ${r.status}${r.exitCode === undefined ? "" : `, exit ${r.exitCode}`}`,
    `  Log: ${relative(root, join(feature.dir, r.log))}`,
    `  STATUS: ${r.statusLine ?? "(missing)"}`,
  ];
  if (r.summary) lines.push(`  Summary: ${r.summary}`);
  if (r.usage) lines.push(`  Usage: ${r.usage.input} in / ${r.usage.output} out${r.usage.costUsd === undefined ? "" : ` / $${r.usage.costUsd.toFixed(4)}`}`);
  if (r.warning) lines.push(`  ⚠ ${r.warning}`);
  if (r.error) lines.push(`  ✗ ${r.error}`);
  if (outcome.note) lines.push(`  ${outcome.note}`);
  if (!outcome.ok && r.statusLine === null && r.exitCode === 0) lines.push("  Worker exited 0 without a STATUS line — not treated as done.");
  return lines.join("\n");
}

function renderChain(root: string, feature: Feature, summary: ChainResultSummary): string {
  const lines = summary.outcomes.map((o) => renderOutcome(root, feature, o));
  if (summary.stoppedAt) {
    lines.push(`✗ Chain stopped at role "${summary.stoppedAt}"${summary.skipped.length > 0 ? `; not run: ${summary.skipped.join(", ")}` : ""}`);
  }
  return lines.join("\n\n");
}

export async function cmdRun(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf run <feature> [--stage <s>] [--role <r>] [--fresh] [--detach] [--timeout <min>] [--dry-run]", stderr: "missing feature" };
  if (args.options.agent !== undefined) {
    return { code: 1, stdout: "--agent was replaced by --role: stages are assigned to roles (harness.roles), and a role points at a runner. See: kf harness", stderr: "agent flag removed" };
  }
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const feature = findFeature(root.root, name);
  if (!feature) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };

  if (typeof args.options.supervise === "string") {
    const summary = await superviseRun(root.root, name, args.options.supervise);
    return { code: summary.ok ? 0 : 1, stdout: renderChain(root.root, findFeature(root.root, name) ?? feature, summary) };
  }

  const stageRaw = args.options.stage;
  if (stageRaw !== undefined && !STAGES.includes(String(stageRaw) as Stage)) {
    return { code: 1, stdout: `Unknown stage '${String(stageRaw)}'. Stages: ${STAGES.join(", ")}`, stderr: "unknown stage" };
  }
  const cfg = readProjectConfig(root.root);
  const resolved = resolveChain(cfg.harness, feature, root.root, {
    stage: stageRaw === undefined ? undefined : (String(stageRaw) as Stage),
    role: typeof args.options.role === "string" ? args.options.role : undefined,
  });
  if (!resolved.ok) return { code: 1, stdout: resolved.reason, stderr: "not assigned" };
  const chain: Assignment[] = resolved.chain;
  const timeoutMs = parseTimeout(args.options.timeout);
  const fresh = Boolean(args.options.fresh);

  if (args.options["dry-run"]) {
    const blocks = chain.map((assignment, index) => {
      const plan = planFor(root.root, feature, assignment, { fresh, timeoutMs }, index === 0 ? null : { role: chain[index - 1].role, output: chain[index - 1].output, log: "<log of the previous run, known at run time>" },
        { id: "<chain>", index: index + 1, total: chain.length });
      const provisioned = provisionSession(plan.runner, feature.meta?.sessions?.[plan.role], plan.prompt, fresh);
      return `[${index + 1}/${chain.length}] ${assignment.role} (${assignment.runnerName}) — ${provisioned.mode}\n\nargv:\n${provisioned.argv.map((a) => `  ${JSON.stringify(a)}`).join("\n")}\n\nprompt:\n${plan.prompt}`;
    });
    return { code: 0, stdout: `Dry run — stage ${chain[0].stage}, chain: ${chain.map((a) => a.role).join(" → ")}\n\n${blocks.join("\n\n---\n\n")}` };
  }
  const active = runningRun(feature);
  if (active) return { code: 1, stdout: `Run ${active.id} (${active.role} @ ${active.stage}) is still running for '${name}'. Wait for it or check: kf runs ${name}`, stderr: "run in progress" };

  if (args.options.detach) {
    const record = await startDetached(root.root, name, chain, { fresh, timeoutMs });
    const rest = chain.slice(1).map((a) => a.role);
    return {
      code: 0,
      stdout: `▶ Chain ${record.id} started detached: ${chain.map((a) => `${a.role} (${a.runnerName})`).join(" → ")}\n  Log: ${relative(root.root, join(feature.dir, record.log))}${rest.length > 0 ? `\n  Remaining roles run after the first one finishes: ${rest.join(", ")}` : ""}\n  Poll with: kf runs ${name}`,
    };
  }
  const summary = await executeChain(root.root, name, chain, { fresh, timeoutMs });
  return {
    code: summary.ok ? 0 : 1,
    stdout: renderChain(root.root, findFeature(root.root, name) ?? feature, summary),
    stderr: summary.ok ? undefined : "chain not done",
  };
}

export interface RunView extends RunRecord {
  feature: string;
  displayStatus: string;
  /** Set when this run ended a chain before its last role, with nothing running since. */
  chainBroken: boolean;
}

/**
 * A chain that stopped early looks exactly like a finished one unless we say so:
 * flag the last run of a chain whose position is short of `total` and that has
 * no live run after it, so a detached supervisor dying mid-chain is visible.
 */
export function runViews(features: Feature[]): RunView[] {
  const views: RunView[] = [];
  for (const f of features) {
    const runs = f.meta?.runs ?? [];
    const lastOfChain = new Map<string, RunRecord>();
    for (const r of runs) if (r.chain) lastOfChain.set(r.chain.id, r);
    const anyLive = runs.some((r) => r.status === "running" && (isPidAlive(r.pid) || isPidAlive(r.supervisorPid)));
    for (const r of runs) {
      const lost = r.status === "running" && !isPidAlive(r.pid) && !isPidAlive(r.supervisorPid);
      const broken = Boolean(r.chain && r.chain.index < r.chain.total && lastOfChain.get(r.chain.id)?.id === r.id && !anyLive);
      views.push({
        ...r, feature: f.name, chainBroken: broken,
        displayStatus: lost ? "failed (supervisor lost)" : broken ? `${r.status} (chain stopped ${r.chain!.index}/${r.chain!.total})` : r.status,
      });
    }
  }
  return views.sort((a, b) => b.at.localeCompare(a.at));
}

export async function cmdRuns(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const name = args.positionals[0];
  let features: Feature[];
  if (name) {
    const f = findFeature(root.root, name);
    if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
    features = [f];
  } else {
    // Runs of finished or dropped work are history: only show them when asked by name.
    features = listFeatures(root.root).filter((f) => f.stage !== "dones" && f.stage !== "cancelled");
  }
  const views = runViews(features);
  if (args.options.json) return { code: 0, stdout: JSON.stringify(views, null, 2) };
  if (views.length === 0) return { code: 0, stdout: name ? `No runs for '${name}'.` : "No runs." };
  const lines = views.map((v) =>
    `${v.id}  ${v.feature.padEnd(20)} ${(v.chain ? `${v.chain.index}/${v.chain.total} ` : "").padEnd(4)}${v.role.padEnd(12)} ${v.runner.padEnd(10)} ${v.stage.padEnd(14)} ${v.mode.padEnd(6)} ${v.displayStatus.padEnd(30)} ${v.at}${v.statusLine ? `  STATUS: ${v.statusLine}` : ""}`);
  const broken = views.filter((v) => v.chainBroken);
  if (broken.length > 0) {
    lines.push("", ...broken.map((v) => `⚠ ${v.feature}: role chain stopped at ${v.role} (${v.chain!.index}/${v.chain!.total}); the remaining roles never ran — re-run the stage with kf run.`));
  }
  return { code: 0, stdout: lines.join("\n") };
}
