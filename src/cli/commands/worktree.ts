import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findFeature, listFeatures, writeFeatureMeta } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
import { createProxyServer } from "../../proxy/server.js";
import { readMachineConfig, splitListen, worktreeConfig } from "../../worktree/config.js";
import { ensureWorktree, forceRemoveWorktree, teardownWorktree } from "../../worktree/lifecycle.js";
import { listWorktrees, gitWorktreeEntries } from "../../worktree/manager.js";
import { buildSetupPlan, renderPlan, type SetupStep } from "../../worktree/setup.js";
import { attachWorktreeToAdes, renderAdeResults, type AdeTarget } from "../../integrations/ade/index.js";
import { syncBase } from "../../project/base-sync.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = `Usage: kf worktree <subcommand>
  create <feature>           — create the item's worktree + domain (also runs automatically on stage → implementation)
  sync [feature]             — attach worktrees into detected ADEs (Orca, Herdr); inside a worktree syncs that checkout, no arg at the root syncs all
  remove <feature> [--force] — remove worktree + route; branch is kept; --force discards uncommitted changes
  list [--json]              — all registered worktrees + orphans
  setup [--print]            — one-time domain infra: dnsmasq rule, resolver, launchd proxy daemon (needs sudo)
`;

function worktreeInfoLines(wt: { path: string; branch: string; domain: string; port: number }): string {
  return `  path:   ${wt.path}\n  branch: ${wt.branch}\n  domain: http://${wt.domain}\n  direct: http://127.0.0.1:${wt.port}`;
}

const real = (p: string): string => (existsSync(p) ? realpathSync(p) : p);

/** `git rev-parse --show-toplevel` / `branch --show-current` for an arbitrary cwd. */
function gitCwd(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || null;
  } catch {
    return null;
  }
}

async function cmdWorktreeCreate(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[1];
  if (!name) return { code: 1, stdout: "Usage: kf worktree create <feature>", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };
  const cfg = worktreeConfig(root.root, readProjectConfig(root.root).worktree);
  // Sync the base checkout to upstream before the kf/<feature> branch is cut.
  const sync = syncBase(root.root);
  const created = await ensureWorktree(root.root, f, cfg);
  const adeResults = attachWorktreeToAdes({ root: root.root, target: { path: created.path, branch: created.branch, label: name, focus: true } });
  const autoWs = adeResults.find((r) => r.autoWorkspaceId)?.autoWorkspaceId;
  const wt = autoWs ? { ...created, adeRepoWorkspaceId: autoWs } : created;
  if (f.meta.worktree !== wt) {
    await writeFeatureMeta(f.dir, { ...f.meta, worktree: wt });
  }
  const syncNote = sync.warning ? `\n  ⚠ ${sync.warning}` : sync.note ? `\n  ${sync.note}` : "";
  const rendered = renderAdeResults(adeResults);
  const ade = rendered ? `\n${rendered}` : "";
  return { code: 0, stdout: `Worktree for '${name}':\n${worktreeInfoLines(wt)}${syncNote}${ade}` };
}

async function cmdWorktreeRemove(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[1];
  if (!name) return { code: 1, stdout: "Usage: kf worktree remove <feature> [--force]", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta?.worktree) return { code: 1, stdout: `Feature '${name}' has no worktree.`, stderr: "no worktree" };
  const cfg = worktreeConfig(root.root, readProjectConfig(root.root).worktree);
  const result = args.options.force
    ? await forceRemoveWorktree(root.root, f, cfg)
    : await teardownWorktree(root.root, f, cfg);
  await writeFeatureMeta(f.dir, { ...f.meta, worktree: undefined });
  const unmerged = result.unmergedCommits > 0
    ? `\n  ⚠ Branch ${result.branch} has ${result.unmergedCommits} commit(s) not merged into HEAD — merge or PR it yourself.`
    : "";
  const warnings = result.warnings.map((w) => `\n  ⚠ ${w}`).join("");
  return {
    code: 0,
    stdout: `Removed worktree for '${name}'${result.removed ? ` (${f.meta.worktree.path})` : " (was already gone)"}\n  branch kept: ${result.branch}${unmerged}${warnings}`,
  };
}

/**
 * `kf worktree sync [feature]` — broadcast worktrees to every reachable ADE.
 * Named arg → that item's registered worktree. No arg inside a linked worktree
 * → that checkout (registered or foreign; foreign ones get a branch/dir label
 * and are never written to `.works`). No arg at the root → all registered.
 */
async function cmdWorktreeSync(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const name = args.positionals[1];

  const targets: { title: string; target: AdeTarget }[] = [];
  if (name) {
    const f = findFeature(root.root, name);
    if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
    const wt = f.meta?.worktree;
    if (!wt) return { code: 1, stdout: `Feature '${name}' has no worktree.`, stderr: "no worktree" };
    targets.push({ title: name, target: { path: wt.path, branch: wt.branch, label: name } });
  } else {
    const top = gitCwd(cwd, ["rev-parse", "--show-toplevel"]);
    if (top && real(top) !== real(root.root)) {
      const topReal = real(top);
      const owned = listFeatures(root.root).find((f) => f.meta?.worktree && real(f.meta.worktree.path) === topReal);
      const branch = gitCwd(top, ["branch", "--show-current"]);
      const label = owned?.name ?? branch?.split("/").pop() ?? basename(topReal);
      targets.push({ title: label, target: { path: topReal, branch: owned?.meta?.worktree?.branch ?? branch, label } });
    } else {
      // Registered kf worktrees keep their feature label…
      const seen = new Set<string>();
      for (const f of listFeatures(root.root)) {
        const wt = f.meta?.worktree;
        if (wt) {
          targets.push({ title: f.name, target: { path: wt.path, branch: wt.branch, label: f.name } });
          seen.add(real(wt.path));
        }
      }
      // …plus every other linked worktree of the repo (created by an ADE or by
      // hand) — "No worktrees" only when git lists the main checkout alone.
      const mainPath = real(root.root);
      for (const e of gitWorktreeEntries(root.root)) {
        const p = real(e.path);
        if (p === mainPath || seen.has(p)) continue;
        const label = e.branch?.split("/").pop() ?? basename(p);
        targets.push({ title: label, target: { path: p, branch: e.branch, label } });
      }
      if (targets.length === 0) return { code: 0, stdout: "No worktrees registered." };
    }
  }

  const lines: string[] = [];
  for (const t of targets) {
    const rendered = renderAdeResults(attachWorktreeToAdes({ root: root.root, target: t.target }));
    lines.push(rendered ? `${t.title}:\n${rendered}` : `${t.title}: no ADEs reachable`);
  }
  return { code: 0, stdout: lines.join("\n") };
}

async function cmdWorktreeList(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const cfg = worktreeConfig(root.root, readProjectConfig(root.root).worktree);
  const { items, orphans } = listWorktrees(root.root, cfg);
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ items, orphans }, null, 2) };
  }
  const lines: string[] = [];
  if (items.length === 0) lines.push("No worktrees registered.");
  for (const i of items) {
    lines.push(`${i.item} (${i.stage})`);
    lines.push(`  path:   ${i.path}${i.missing ? "  (missing)" : ""}`);
    lines.push(`  branch: ${i.branch}${i.dirty === null ? "" : i.dirty ? "  (dirty)" : ""}`);
    lines.push(`  domain: http://${i.domain}  → 127.0.0.1:${i.port}`);
  }
  if (orphans.length > 0) {
    lines.push("", "Orphans:");
    for (const o of orphans) lines.push(`  [${o.kind}] ${o.detail}`);
  }
  return { code: 0, stdout: lines.join("\n") };
}

function applyStep(step: SetupStep): string {
  if (step.file) {
    const existing = existsSync(step.file.path) ? readFileSync(step.file.path, "utf8") : null;
    if (existing === step.file.content) return `${step.id}: already in place`;
    mkdirSync(dirname(step.file.path), { recursive: true });
    writeFileSync(step.file.path, step.file.content, "utf8");
    return `${step.id}: wrote ${step.file.path}`;
  }
  if (step.command) {
    execSync(step.command.join(" "), { stdio: "inherit" });
    return `${step.id}: ran ${step.command.join(" ")}`;
  }
  return `${step.id}: nothing to do`;
}

async function cmdWorktreeSetup(args: ParsedArgs): Promise<CmdResult> {
  const machine = readMachineConfig();
  const entrypoint = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "index.js");
  const plan = buildSetupPlan(machine, { kfEntrypoint: entrypoint, nodePath: process.execPath });

  if (args.options.print) {
    return { code: plan.conflict ? 1 : 0, stdout: renderPlan(plan) };
  }
  if (plan.conflict) {
    return { code: 1, stdout: renderPlan(plan), stderr: "dns zone conflict" };
  }
  if (plan.steps.some((s) => s.needsSudo) && process.getuid?.() !== 0) {
    return {
      code: 1,
      stdout: `${renderPlan(plan)}\n\nSome steps need root — run: sudo kf worktree setup`,
      stderr: "needs sudo",
    };
  }

  const lines: string[] = [];
  try {
    for (const step of plan.steps) lines.push(applyStep(step));
  } catch (err) {
    return {
      code: 1,
      stdout: `Setup failed:\n${lines.join("\n")}\n\n${err instanceof Error ? err.message : String(err)}`,
      stderr: "setup failed",
    };
  }
  lines.push("", "Done. Verify with: kf doctor");
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdWorktree(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  switch (args.positionals[0]) {
    case "create": return cmdWorktreeCreate(args, cwd);
    case "sync": return cmdWorktreeSync(args, cwd);
    case "remove": return cmdWorktreeRemove(args, cwd);
    case "list": return cmdWorktreeList(args, cwd);
    case "setup": return cmdWorktreeSetup(args);
    default:
      return { code: 1, stdout: USAGE, stderr: "unknown worktree subcommand" };
  }
}

/**
 * `kf proxy serve` runs in the foreground forever (launchd KeepAlive restarts it) —
 * it only resolves when the listen itself fails.
 */
export function cmdProxyServe(args: ParsedArgs): Promise<CmdResult> {
  const machine = readMachineConfig();
  const listen = splitListen(typeof args.options.listen === "string" ? args.options.listen : machine.proxyListen);
  const routesFile = typeof args.options.routes === "string" ? args.options.routes : machine.routesFile;
  const fallback = args.options.fallback === "off"
    ? null
    : typeof args.options.fallback === "string" ? args.options.fallback : machine.fallbackUpstream;

  return new Promise((resolvePromise) => {
    const server = createProxyServer({ routesFile, fallbackUpstream: fallback });
    server.listen(listen.port, listen.host, () => {
      process.stdout.write(`kf proxy listening on ${listen.host}:${listen.port}\n`);
    });
    server.on("error", (err) => {
      resolvePromise({ code: 1, stdout: `kf proxy: cannot listen on ${listen.host}:${listen.port}: ${err.message}`, stderr: "listen failed" });
    });
  });
}
