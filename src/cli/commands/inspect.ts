import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS } from "../../workflow/schema.js";
import { driveLive, findFeature, listFeatures, parseFolderName, updateFeatureMeta, withDocsLanded, type Feature } from "../../workflow/features.js";
import { migrateLegacyStages } from "../../workflow/migrate.js";
import { archiveItem } from "../../workflow/archive.js";
import {
  computeBuckets,
  computeStatus,
  currentReportStatus,
  DOCS_LOOKUP_RERUN,
  renderBuckets,
  renderStatusText,
  statusToJson,
  type CloseState,
} from "../../workflow/status.js";
import { branchPushed, revParse, type LandedRun } from "../../shared/git.js";
import { docsLandedProof } from "../../workflow/canonical-docs.js";
import { LockTimeoutError } from "../../shared/lock.js";
import { closeDetails } from "./archive.js";
import { validateFeature, renderValidateText, validateToJson } from "../../workflow/validate.js";
import { dashboardData } from "../../dashboard/dashboard.js";
import { readProjectConfig } from "../../project/config.js";
import { findRoot, resolveItem } from "./helpers.js";
import { worktreeConfig, readMachineConfig } from "../../worktree/config.js";
import { probeDomainInfra } from "../../worktree/health.js";
import { driveConfigReady } from "../../harness/drive/claim.js";
import { liveRecords } from "../../harness/run.js";
import type { Finding } from "../../workflow/findings.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdList(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const features = listFeatures(root.root);
  if (args.options.json) {
    return {
      code: 0,
      stdout: JSON.stringify(features.map((f) => ({
        name: f.name,
        kind: f.meta?.kind ?? "feature",
        context: f.context,
        stage: f.stage,
        folder: f.folder,
      })), null, 2),
    };
  }
  if (features.length === 0) {
    return { code: 0, stdout: "No features found." };
  }
  const lines = features.map((f) => `${f.stage.padEnd(14)} ${(f.meta?.kind === "bug" ? "[bug] " : "") + f.name}${f.context ? ` (${f.context})` : ""}`);
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdShow(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Missing feature name.", stderr: "missing feature" };
  const root = await resolveItem(cwd, name);
  if (!root.ok) return root.refusal;
  const f = root.item;
  const specPath = join(f.dir, ARTIFACTS["spec-requirement"].file);
  let content: string;
  try {
    content = await readFile(specPath, "utf8");
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
    content = `(no ${ARTIFACTS["spec-requirement"].file} in ${f.dir})`;
  }
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ feature: f.name, kind: f.meta?.kind ?? "feature", context: f.context, stage: f.stage, spec: content }) };
  }
  return { code: 0, stdout: content };
}

export async function cmdView(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const data = dashboardData(root.root);
  if (args.options.json) return { code: 0, stdout: JSON.stringify(data, null, 2) };
  const m = data.metrics;
  const lines = [
    "kanban-flow analytics", "",
    `Total: ${m.total} (${m.features} features, ${m.bugs} bugs)`,
    `Executing: ${m.executing}   Backlog: ${m.backlog}   Completed: ${m.completed}   Cancelled: ${m.cancelled}   Bypassed: ${m.bypassed}`,
    `Completion rate: ${m.completionRate === null ? "N/A" : m.completionRate + "%"} (cancelled work excluded)`,
    `Executing tasks: ${m.tasks.done}/${m.tasks.total} (${m.tasks.completionRate === null ? "N/A" : m.tasks.completionRate + "%"})`,
    ...(Object.keys(m.runs.byRole).length > 0
      ? ["", "Worker runs by role:", ...Object.entries(m.runs.byRole).map(([role, r]) => `  ${role.padEnd(12)} ${r.runs} runs (${r.done} done, ${r.failed} failed)${m.runs.usage[role] ? `  ${m.runs.usage[role].input} in / ${m.runs.usage[role].output} out` : ""}`)]
      : []),
    "", "By stage:",
    ...data.charts.byStage.map((row) => `  ${row.id.padEnd(14)} ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "By context:",
    ...data.charts.byContext.map((row) => `  ${row.label}: ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "Approval (planning through review):",
    ...data.charts.approvals.map((row) => `  ${row.id}: ${row.count}`),
  ];
  return { code: 0, stdout: lines.join("\n") };
}

/**
 * A gate or direction refusal spans lines (the heading, then one line per check); the status line
 * keeps the heading and names the failed checks by the ERROR codes the refusal carries. Every other
 * refusal, and hook output, keeps every line: its text may quote gh, git or the project's hook.
 */
function oneLine(text: string, codes: string[] = []): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return codes.length > 0 ? `${lines[0] ?? ""} ${codes.join(", ")}` : lines.join(" ");
}

/**
 * A review PASS item closes on the next `kf status` once its PR merged (or it has
 * nothing to land), through the same archiveItem transaction as `kf archive`. An item with a
 * live drive is left to the drive, and one with a live worker run is left to that run: the
 * worker may be the one calling kf status, from inside the worktree the close would remove.
 * Returns the printed lines and, per item that stayed in review, why — the renderer turns
 * that into the Next line.
 */
async function closeLanded(root: string, items: Feature[]): Promise<{ lines: string[]; states: Map<string, CloseState>; failed: boolean }> {
  const lines: string[] = [];
  const states = new Map<string, CloseState>();
  let failed = false;
  for (const f of items) {
    if (f.stage !== "review" || currentReportStatus(f, "review-report") !== "PASS" || driveLive(f.meta?.drive) || liveRecords(f.meta?.runs).length > 0) continue;
    const outcome = await archiveItem(root, f.name, { trigger: "status" });
    switch (outcome.kind) {
      case "archived":
        lines.push(`✓ done ${outcome.name} (${outcome.pr ? `PR merged: ${outcome.pr}` : "nothing to land"})${closeDetails(outcome)}`);
        break;
      case "reconciled":
        break;
      case "refused":
        if (outcome.merge?.reason === "not-merged") {
          states.set(f.name, outcome.merge.state === "CLOSED" ? { kind: "pr-closed", pr: outcome.merge.pr } : { kind: "awaiting-merge", pr: outcome.merge.pr });
        } else {
          states.set(f.name, { kind: "refused", detail: oneLine(outcome.stdout, outcome.codes) });
        }
        break;
      case "hook-failed":
        states.set(f.name, { kind: "refused", detail: oneLine(outcome.stdout) });
        break;
      case "error": {
        failed = true;
        lines.push(`✗ ${f.name}: close failed: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
        break;
      }
    }
  }
  return { lines, states, failed };
}

/**
 * The items whose legacy move failed, read from the migration's `✗` lines (a dirty worktree's `⚠` line
 * is not a failure): `✗ <folder> left in …` when the move threw, `✗ migrated <folder>: …` when the close after it did.
 */
function migrationFailedItems(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const m = /^✗ (?:migrated (\S+):|(\S+) left in )/.exec(line);
    if (!m) return [];
    const folder = m[1] ?? m[2];
    return [folder, parseFolderName(folder).name];
  });
}

export async function cmdStatus(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all for every feature).\nRun: kf list', stderr: "missing --change" };
  }

  // Before the item lookup: a legacy `.works/dones` or `.works/shipping` item is invisible until it moves.
  const migration = await migrateLegacyStages(root.root);
  const lookup = () => change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  const closed = await closeLanded(root.root, lookup());
  // Like a failed close, a failed move counts against the view that includes it: --all, or the
  // item's own --change. Pollers of an unrelated item must not see exit 1 on every tick.
  const migrationFailedHere = migration.failed && (change ? migrationFailedItems(migration.lines).includes(change) : all);
  const code = migrationFailedHere || closed.failed ? 1 : 0;
  // Before the statuses are read: a docs branch this run proves landed must not still show in its item block.
  const docsBranches = all ? await docsBranchesUnpushed(root.root, lookup()) : null;
  const notes = [...migration.lines, ...closed.lines, ...(docsBranches?.warnings ?? [])];
  const migrated = notes.length > 0 ? `${notes.join("\n")}\n\n` : "";

  // Read again: an item that just closed now lives in done.
  const features = lookup();

  if (change && features.length === 0) {
    return { code: 1, stdout: `${migrated}Unknown feature '${change}'. Run: kf list`, stderr: "unknown feature" };
  }
  const harness = readProjectConfig(root.root).harness;
  const statuses = features.map((f) => {
    const s = computeStatus(f, harness, f.stage === "implementation" && driveConfigReady(root.root, f));
    const close = closed.states.get(f.name);
    return close ? { ...s, close } : s;
  });
  const buckets = docsBranches
    ? computeBuckets(
      statuses,
      docsBranches.entries,
      features.filter((f) => driveLive(f.meta?.drive)).length,
    )
    : null;
  if (json) {
    // stdout stays parseable JSON; the migration and close lines go to stderr.
    return {
      code,
      stderr: notes.length > 0 ? notes.join("\n") : undefined,
      stdout: JSON.stringify(
        change
          ? statusToJson(statuses[0])
          : { features: statuses.map(statusToJson), ...buckets },
        null, 2,
      ),
    };
  }
  if (statuses.length === 0) {
    return { code, stdout: `${migrated}No active features. Create one with: kf new <feature> --context <ctx>` };
  }
  const blocks = statuses.map(renderStatusText);
  return { code, stdout: migrated + blocks.join("\n\n") + (buckets ? `\n\n${renderBuckets(buckets)}` : "") };
}

/** How long the advisory docsLanded write waits for the item lock before leaving it to the next run. */
const DOCS_LANDED_LOCK_MS = 2_000;

/**
 * The docs branches `kf status --all` lists. A branch proven landed is recorded as
 * `docsLanded` in place of `docsBranch`, so later polls never ask gh about it again. That record
 * is a cache: when another kf command holds the item lock, it waits for the next run.
 */
async function docsBranchesUnpushed(root: string, features: Feature[]): Promise<{
  entries: Array<{ feature: string; branch: string; reason?: string; command?: string; remedy?: string; gone?: true }>;
  warnings: string[];
}> {
  const run: LandedRun = {};
  const out: Array<{ feature: string; branch: string; reason?: string; command?: string; remedy?: string; gone?: true }> = [];
  const warnings: string[] = [];
  for (const f of features) {
    const branch = f.meta?.docsBranch;
    if (!branch) continue;
    // null: no local branch. It is still pushed work when origin has it; otherwise landedProof says it is gone.
    const pushed = branchPushed(root, "origin", branch);
    if (pushed === true || (pushed === null && revParse(root, `refs/remotes/origin/${branch}`))) continue;
    const proof = docsLandedProof(root, f, run);
    if (proof.landed) {
      try {
        await updateFeatureMeta(root, f.name, (meta) => withDocsLanded(meta, branch, proof.by), { timeoutMs: DOCS_LANDED_LOCK_MS });
      } catch (err) {
        if (!(err instanceof LockTimeoutError)) throw err;
        warnings.push(`⚠ ${f.name}: docs branch ${branch} landed; the item is locked by another kf command, so the landing is recorded on a later run`);
      }
      continue;
    }
    if (proof.gone) {
      out.push({ feature: f.name, branch, reason: proof.reason, ...(proof.remedy ? { remedy: proof.remedy } : {}), gone: true });
      continue;
    }
    // No local branch to push: only a lookup that can run again can still prove it.
    if (pushed === null) {
      out.push({ feature: f.name, branch, ...(proof.reason ? { reason: proof.reason } : {}), command: DOCS_LOOKUP_RERUN });
      continue;
    }
    // No trace of a push (and no merged PR found) shows as awaiting push, not unproven.
    out.push({ feature: f.name, branch, ...(proof.pushed && proof.reason ? { reason: proof.reason } : {}) });
  }
  return { entries: out, warnings };
}

/** The `task_harness_needs_worktree` text; `kf approve` prints it too, before it starts or parks the item. */
export function taskHarnessNeedsWorktreeMessage(feature: string): string {
  return `The task harness (kf drive / kf run --task) cannot start while worktrees are off. Set "worktree": { "enabled": true } in .kf/config.json before starting '${feature}'.`;
}

export async function cmdValidate(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const strict = Boolean(args.options.strict);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all).', stderr: "missing --change" };
  }
  const features = change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  if (change && features.length === 0) {
    return { code: 1, stdout: `Unknown feature '${change}'.`, stderr: "unknown feature" };
  }
  const harness = readProjectConfig(root.root).harness;
  const results = features.map((f) => validateFeature(f, strict, true, harness));

  // Domain infra is environmental, not contractual — a WARNING telling the human to onboard,
  // never an ERROR that blocks a gate. It surfaces here because `kf validate` is the command
  // agents are trained to run.
  const wtCfg = worktreeConfig(root.root, readProjectConfig(root.root).worktree);
  if (wtCfg.enabled && features.length > 0) {
    const machine = readMachineConfig();
    const infra = await probeDomainInfra(machine, wtCfg.routesFile);
    const failed = infra.probes.filter((p) => !p.ok);
    if (failed.length > 0) {
      for (const r of results) {
        r.issues.push({
          severity: "WARNING",
          feature: r.feature,
          stage: r.stage,
          file: ".kf/config.json",
          code: "worktree_infra_missing",
          message: `Domain infra not ready (${failed.map((p) => p.detail).join("; ")}). Run: sudo kf worktree setup`,
        } satisfies Finding);
        if (strict) r.valid = !r.issues.some((i) => i.severity === "ERROR") && !r.issues.some((i) => i.severity === "WARNING");
      }
    }
  }

  // Raised before approval starts the item, so the human enables worktrees before the drive
  // rather than learning it from a refused `kf drive`.
  if (!wtCfg.enabled && (harness?.verify?.stage?.length ?? 0) > 0) {
    for (const r of results) {
      if (r.stage !== "planning" && r.stage !== "backlog") continue;
      r.issues.push({
        severity: "WARNING",
        feature: r.feature,
        stage: r.stage,
        file: ".kf/config.json",
        code: "task_harness_needs_worktree",
        message: taskHarnessNeedsWorktreeMessage(r.feature),
      } satisfies Finding);
      if (strict) r.valid = false;
    }
  }

  const allValid = results.every((r) => r.valid);
  if (json) {
    return { code: allValid ? 0 : 1, stdout: JSON.stringify(results.map(validateToJson), null, 2), stderr: allValid ? undefined : "validation failed" };
  }
  const blocks = results.map(renderValidateText);
  const codes = blocks.join("\n") + `\nTotals: ${results.filter((r) => r.valid).length} passed, ${results.filter((r) => !r.valid).length} failed (${results.length} items)`;
  return { code: allValid ? 0 : 1, stdout: codes, stderr: allValid ? undefined : "validation failed" };
}
