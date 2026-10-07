import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findFeature, writeFeatureMeta } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
import { createProxyServer } from "../../proxy/server.js";
import { readMachineConfig, splitListen, worktreeConfig } from "../../worktree/config.js";
import { ensureWorktree, forceRemoveWorktree, teardownWorktree } from "../../worktree/lifecycle.js";
import { listWorktrees } from "../../worktree/manager.js";
import { buildSetupPlan, renderPlan, type SetupStep } from "../../worktree/setup.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

const USAGE = `Usage: kf worktree <subcommand>
  create <feature>           — create the item's worktree + domain (also runs automatically on stage → implementation)
  remove <feature> [--force] — remove worktree + route; branch is kept; --force discards uncommitted changes
  list [--json]              — all registered worktrees + orphans
  setup [--print]            — one-time domain infra: dnsmasq rule, resolver, launchd proxy daemon (needs sudo)
`;

function worktreeInfoLines(wt: { path: string; branch: string; domain: string; port: number }): string {
  return `  path:   ${wt.path}\n  branch: ${wt.branch}\n  domain: http://${wt.domain}\n  direct: http://127.0.0.1:${wt.port}`;
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
  const wt = await ensureWorktree(root.root, f, cfg);
  if (f.meta.worktree !== wt) {
    await writeFeatureMeta(f.dir, { ...f.meta, worktree: wt });
  }
  return { code: 0, stdout: `Worktree for '${name}':\n${worktreeInfoLines(wt)}` };
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
