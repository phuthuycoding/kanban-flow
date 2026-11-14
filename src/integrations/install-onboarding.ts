import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CmdResult } from "../cli/result.js";
import { readProjectConfig } from "../project/config.js";
import { resolveWorkspaceFolder } from "../project/config-layers.js";
import { PromptAbort, selectChoice, selectMany, withLoading, type Choice } from "../project/prompts.js";
import { findWorksRoot } from "../workflow/features.js";
import { AGENTS, DEFAULT_AGENT, parseAgentIds, type AgentId } from "./agents.js";
import { ClaudePluginError, claudeRunner, pluginState } from "./claude-plugin.js";
import { cmdInstall, cmdUninstall, scopeFromArgs, type InstallTarget } from "./install.js";

export type Given = { agents?: AgentId[]; scope?: InstallTarget; purge?: boolean };

export type Prompter = {
  select(question: string, choices: readonly Choice[], initial: number): Promise<number>;
  many(question: string, options: readonly string[], initial: ReadonlySet<number>, emptyHint: string): Promise<number[]>;
  print(line: string): void;
  loading<T>(message: string, work: () => Promise<T>): Promise<T>;
};

export type Ctx = {
  cwd: string;
  projectRoot: string | null;
  configuredScope: "global" | "project";
  workspace: { folder: string; create: boolean } | { unavailable: string };
  /** Asks claude, so it is called only once the workspace scope is chosen. */
  hasUserPlugin: () => Promise<boolean>;
  /** The existing .works/ and .kf/ cmdUninstall would purge: under projectRoot, else under cwd. */
  purgeTargets: string[];
};

/** removeUserPlugin is absent when claude could not be asked: cmdInstall then reports that failure itself. */
export type InstallPlan = { agents: AgentId[]; scope: InstallTarget; removeUserPlugin?: boolean } | { cancelled: true };
export type UninstallPlan = { agents: AgentId[]; scope: InstallTarget; purge: boolean; purgeConfirmed: boolean } | { cancelled: true };

const SCOPES: readonly InstallTarget[] = ["global", "project", "workspace"];
const NO_PROJECT = "no .works/ — run kf init";
const CLAUDE_ONLY = "workspace scope supports claude only";
// cmdUninstall's PURGE_DIRS; the purge step lists what that command will delete.
const PURGE_DIRS = [".works", ".kf"];

/** The purge step is offered only in a kanban project, never for a folder holding just .kf/ (a workspace's). */
function purgeStepApplies(ctx: Ctx): boolean {
  return ctx.projectRoot !== null && ctx.purgeTargets.length > 0;
}

/** "Step n/N — " where N counts the steps known to be asked when the label is drawn. */
class Steps {
  private n = 0;
  constructor(private total: number) {}
  add(): void {
    this.total += 1;
  }
  next(): string {
    this.n += 1;
    return `Step ${this.n}/${this.total} — `;
  }
}

async function askAgents(p: Prompter, label: string): Promise<AgentId[]> {
  const initial = new Set([AGENTS.findIndex((a) => a.id === DEFAULT_AGENT)]);
  const picked = await p.many(
    `${label}Which agents? (↑/↓, Space to toggle, Enter to accept)`,
    AGENTS.map((a) => `${a.id} — ${a.label}`),
    initial,
    "Select at least one agent (Space toggles).",
  );
  return picked.map((i) => AGENTS[i].id);
}

async function askScope(p: Prompter, label: string, agents: AgentId[], ctx: Ctx, forInstall: boolean): Promise<InstallTarget> {
  const ws = ctx.workspace;
  const choices: Choice[] = [
    { label: "global — every project for this user" },
    forInstall && ctx.projectRoot === null
      ? { label: "project — this project only", unavailable: NO_PROJECT }
      : { label: "project — this project only" },
    agents.some((a) => a !== "claude")
      ? { label: "workspace — Claude Code, only when started in the workspace folder", unavailable: CLAUDE_ONLY }
      : "unavailable" in ws
        ? { label: "workspace — Claude Code, only when started in the workspace folder", unavailable: ws.unavailable }
        : { label: `workspace — Claude Code, only when started in ${ws.folder}` },
  ];
  const pick = await p.select(`${label}Which scope?`, choices, SCOPES.indexOf(ctx.configuredScope));
  return SCOPES[pick];
}

/** The one-line summary with the action and Cancel; false on Cancel. */
async function confirm(p: Prompter, label: string, summary: string, action: "Install" | "Uninstall"): Promise<boolean> {
  const pick = await p.select(`${label}${summary}`, [{ label: `${action} — go ahead` }, { label: "Cancel — change nothing" }], 0);
  return pick === 0;
}

function where(scope: InstallTarget, ctx: Ctx): string {
  return scope === "workspace" && "folder" in ctx.workspace ? `scope workspace (${ctx.workspace.folder})` : `scope ${scope}`;
}

/** The user-scope probe; undefined when claude is missing or answered badly, any other failure propagates. */
async function probeUserPlugin(ctx: Ctx): Promise<boolean | undefined> {
  try {
    return await ctx.hasUserPlugin();
  } catch (err) {
    if (err instanceof ClaudePluginError) return undefined;
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/** Asks only the steps whose choice was not given; with nothing given, a Quick/Customize choice comes first. */
export async function planInstall(given: Given, ctx: Ctx, p: Prompter): Promise<InstallPlan> {
  if (given.agents !== undefined && given.scope !== undefined) {
    return { agents: given.agents, scope: given.scope, removeUserPlugin: false };
  }
  if (given.agents === undefined && given.scope === undefined) {
    const quick = { agents: [DEFAULT_AGENT], scope: ctx.configuredScope };
    const mode = await p.select(
      "Setup mode — how do you want to install kanban-flow?",
      [{ label: `Quick — ${quick.agents.join(", ")}, scope ${quick.scope}` }, { label: "Customize — choose each step" }],
      0,
    );
    if (mode === 0) return { ...quick, removeUserPlugin: false };
  }
  const steps = new Steps((given.agents === undefined ? 1 : 0) + (given.scope === undefined ? 1 : 0) + 1);
  const agents = given.agents ?? (await askAgents(p, steps.next()));
  const scope = given.scope ?? (await askScope(p, steps.next(), agents, ctx, true));
  const ws = ctx.workspace;
  const userPlugin = scope === "workspace" && "folder" in ws && agents.every((a) => a === "claude") ? await p.loading("Checking the Claude Code plugin install…", () => probeUserPlugin(ctx)) : false;
  let removeUserPlugin = userPlugin === undefined ? undefined : false;
  // "folder" in ws again only narrows the type for the question text.
  if (userPlugin === true && "folder" in ws) {
    steps.add();
    const pick = await p.select(
      `${steps.next()}kf is also installed for every project (user scope). Remove it so /kf:* only appears in ${ws.folder}?`,
      [{ label: "No — keep the user-scope install" }, { label: "Yes — remove it after the workspace install succeeds" }],
      0,
    );
    removeUserPlugin = pick === 1;
  }
  const removal = removeUserPlugin ? ", then remove the user-scope install" : "";
  if (!(await confirm(p, steps.next(), `Install ${agents.join(", ")} at ${where(scope, ctx)}${removal}?`, "Install"))) return { cancelled: true };
  return { agents, scope, removeUserPlugin };
}

/** Agents, scope, purge (only when .works/ was found), confirm — each only when not given. */
export async function planUninstall(given: Given, ctx: Ctx, p: Prompter): Promise<UninstallPlan> {
  const askPurge = given.purge === undefined && purgeStepApplies(ctx);
  if (given.agents !== undefined && given.scope !== undefined && !askPurge) {
    return { agents: given.agents, scope: given.scope, purge: given.purge ?? false, purgeConfirmed: false };
  }
  const steps = new Steps((given.agents === undefined ? 1 : 0) + (given.scope === undefined ? 1 : 0) + (askPurge ? 1 : 0) + 1);
  const agents = given.agents ?? (await askAgents(p, steps.next()));
  const scope = given.scope ?? (await askScope(p, steps.next(), agents, ctx, false));
  let purge = given.purge ?? false;
  if (askPurge) {
    const pick = await p.select(
      `${steps.next()}Also delete the project data in ${ctx.projectRoot ?? ctx.cwd}?`,
      [{ label: "No — skills/agents only" }, { label: "Yes — delete .works/ and .kf/" }],
      0,
    );
    purge = pick === 1;
  }
  const deletes = purge && ctx.purgeTargets.length > 0 ? ` and permanently delete ${ctx.purgeTargets.map((t) => `${t}/`).join(", ")}` : "";
  if (!(await confirm(p, steps.next(), `Uninstall ${agents.join(", ")} at ${where(scope, ctx)}${deletes}?`, "Uninstall"))) return { cancelled: true };
  // Only a confirm that listed the directories stands in for cmdUninstall's own purge question.
  return { agents, scope, purge, purgeConfirmed: purge && ctx.purgeTargets.length > 0 };
}

function contextFor(cwd: string): Ctx {
  const projectRoot = findWorksRoot(cwd);
  return {
    cwd,
    projectRoot,
    configuredScope: (projectRoot ? readProjectConfig(projectRoot).skills?.scope : undefined) ?? "global",
    workspace: resolveWorkspaceFolder(cwd, projectRoot),
    hasUserPlugin: async () => (await pluginState(claudeRunner(cwd), "global")).status !== "missing",
    purgeTargets: PURGE_DIRS.map((d) => join(projectRoot ?? cwd, d)).filter((d) => existsSync(d)),
  };
}

const terminalPrompter: Prompter = {
  select: selectChoice,
  many: selectMany,
  print: (line) => {
    process.stdout.write(`${line}\n`);
  },
  loading: withLoading,
};

const NOTHING_CHANGED: CmdResult = { code: 0, stdout: "Nothing changed." };
const ABORTED: CmdResult = { code: 1, stdout: "Aborted — nothing changed.", stderr: "aborted" };

/**
 * `kf install` / `kf uninstall`. Off a TTY, or with every choice given, the commands run exactly as
 * before; otherwise the missing choices are asked first.
 */
export async function runInstallCommand(
  command: "install" | "uninstall",
  options: Record<string, unknown>,
  cwd: string,
  isTty: boolean,
  deps: {
    prompter?: Prompter;
    planInstall?: typeof planInstall;
    planUninstall?: typeof planUninstall;
    cmdInstall?: typeof cmdInstall;
    cmdUninstall?: typeof cmdUninstall;
  } = {},
): Promise<CmdResult> {
  const install = deps.cmdInstall ?? cmdInstall;
  const uninstall = deps.cmdUninstall ?? cmdUninstall;
  const agents = parseAgentIds(options.agent);
  const scope = scopeFromArgs(options);
  const purge = Boolean(options.purge);
  const force = Boolean(options.force);
  const asIs = (): Promise<CmdResult> =>
    command === "install" ? install(agents, { cwd, scope }) : uninstall(agents, { cwd, scope, purge, force });
  if (!isTty) return asIs();
  const allGiven = agents.length > 0 && scope !== undefined;
  if (command === "install" && allGiven) return asIs();
  const ctx = contextFor(cwd);
  // cmdInstall refuses these scopes; it must do so before any prompt.
  const scopeUnusable =
    (scope === "project" && ctx.projectRoot === null) || (scope === "workspace" && "unavailable" in ctx.workspace);
  if (command === "install" && scopeUnusable) return asIs();
  // cmdUninstall refuses a workspace scope with no folder or with a non-claude agent; refuse before any prompt too.
  const workspaceRefused =
    scope === "workspace" && ("unavailable" in ctx.workspace || agents.some((id) => id !== "claude"));
  if (command === "uninstall" && workspaceRefused) return asIs();
  if (command === "uninstall" && allGiven && (purge || !purgeStepApplies(ctx))) return asIs();
  const given: Given = { agents: agents.length > 0 ? agents : undefined, scope, purge: purge ? true : undefined };
  const prompter = deps.prompter ?? terminalPrompter;
  // Only the planning is guarded: an abort there has changed nothing yet.
  const planned = async <T>(plan: () => Promise<T>): Promise<T | null> => {
    try {
      return await plan();
    } catch (err) {
      if (err instanceof PromptAbort) return null;
      throw err;
    }
  };
  if (command === "install") {
    const plan = await planned(() => (deps.planInstall ?? planInstall)(given, ctx, prompter));
    if (plan === null) return ABORTED;
    if ("cancelled" in plan) return NOTHING_CHANGED;
    return install(plan.agents, { cwd, scope: plan.scope, removeUserPlugin: plan.removeUserPlugin });
  }
  const plan = await planned(() => (deps.planUninstall ?? planUninstall)(given, ctx, prompter));
  if (plan === null) return ABORTED;
  if ("cancelled" in plan) return NOTHING_CHANGED;
  return uninstall(plan.agents, { cwd, scope: plan.scope, purge: plan.purge, purgeConfirmed: plan.purgeConfirmed, force });
}
