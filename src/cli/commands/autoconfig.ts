import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { findWorksRoot } from "../../workflow/features.js";
import { commandHelp } from "../args.js";
import { effectiveDefaultContext } from "../../project/contexts.js";
import { readProjectConfig, detectStacks, configPath, projectKabanDir, effectiveSkillsScope, type ProjectConfig } from "../../project/config.js";
import { AGENTS, DEFAULT_AGENT, projectAgentsDir, projectSkillsDir, userAgentsDir, userSkillsDir, type AgentId, type SkillScope } from "../../integrations/agents.js";
import { ClaudePluginError, PLUGIN_ID, claudeRunner, claudeScope, pluginState, type ClaudeRun, type PluginState } from "../../integrations/claude-plugin.js";
import { agentSkillsState, agentsAreHealthy, agentsState, foreignSkills, hasOwnedEntries, MANAGED_AGENTS, unhealthySkills } from "../../integrations/install.js";
import { PKG_RULES_DIR, USER_KABAN_DIR, resolveRule } from "../../shared/paths.js";
import type { CmdResult } from "../result.js";
import type { ParsedArgs } from "../args.js";

interface CheckItem {
  done: boolean;
  label: string;
  action?: string;
}

function skillsDirAtScope(a: (typeof AGENTS)[number], root: string, scope: SkillScope): string {
  return scope === "global" ? userSkillsDir(a) : projectSkillsDir(a, root);
}

/** The kf plugin as Claude Code reports it, or why the probe could not tell. */
type PluginProbe = { state: PluginState } | { error: string };

async function probePlugin(run: ClaudeRun, scope: SkillScope): Promise<PluginProbe> {
  try {
    return { state: await pluginState(run, scope) };
  } catch (err) {
    if (err instanceof ClaudePluginError) return { error: err.message };
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") return { error: "the `claude` CLI was not found on PATH." };
    throw err;
  }
}

function pluginLine(probe: PluginProbe, scope: SkillScope): string {
  if ("error" in probe) return `⚠ cannot check kf plugin: ${probe.error}`;
  const at = claudeScope(scope);
  const s = probe.state;
  switch (s.status) {
    case "current": return `installed, enabled (scope: ${at})`;
    case "disabled": return `installed but disabled (scope: ${s.scope})`;
    case "unknown": return `installed (scope: ${at}) — claude does not report its source folder`;
    case "stale": return `installed (scope: ${at}) but reading ${s.readFromFolder || "an unknown folder"}, not this package`;
    case "outdated": return `installed (scope: ${at}) at ${s.installed}, this package is ${s.available}`;
    case "missing": return `not installed (scope: ${at})`;
  }
}

function installedAgents(root: string, scope: SkillScope, probe: PluginProbe | undefined): AgentId[] {
  return AGENTS.filter((a) => {
    if (a.id === "claude") return probe !== undefined && "state" in probe && (probe.state.status === "current" || probe.state.status === "unknown");
    const dir = skillsDirAtScope(a, root, scope);
    return unhealthySkills(dir, foreignSkills(dir)).length === 0;
  }).map((a) => a.id);
}

function checklist(root: string, stacks: string[], agents: AgentId[], cfg: Partial<ProjectConfig>, probe: PluginProbe | undefined): CheckItem[] {
  const items: CheckItem[] = [];
  const kf = projectKabanDir(root);
  const scope = effectiveSkillsScope(cfg);

  items.push({
    done: existsSync(configPath(root)),
    label: "Project config (.kf/config.json)",
    action: "kf init --defaults",
  });

  for (const id of agents) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    if (id === "claude" && probe) {
      items.push({
        // An unknown source is installed and enabled; kf install cannot do more, so the item is not left open.
        done: "state" in probe && (probe.state.status === "current" || probe.state.status === "unknown"),
        label: `kf plugin (${PLUGIN_ID}, ${a.label}) — ${pluginLine(probe, scope)}`,
        action: `kf install --agent claude --scope ${scope}`,
      });
      continue;
    }
    const dir = skillsDirAtScope(a, root, scope);
    // A user's own skill at a managed name is left alone by kf install, so it is neither stale nor pending.
    const foreign = foreignSkills(dir);
    const bad = unhealthySkills(dir, foreign);
    const state = foreign.length === 0 ? agentSkillsState(dir) : bad.length > 0 ? "incomplete" : "installed";
    items.push({
      done: bad.length === 0,
      label: `Skills for ${a.label} (scope: ${scope}, ${dir}/) — ${state}${foreign.length > 0 ? ` (your own ${foreign.join(", ")} kept)` : ""}`,
      action: `kf install --agent ${id} --scope ${scope}`,
    });
    const agentsDir = scope === "global" ? userAgentsDir(a) : projectAgentsDir(a, root);
    if (agentsDir) {
      const agentsHealth = agentsState(agentsDir, a);
      items.push({
        done: agentsAreHealthy(agentsHealth),
        label: `Agents for ${a.label} (${MANAGED_AGENTS.map((s) => a.agentTarget?.managedName?.(s) ?? s).join(", ")}; scope: ${scope}, ${agentsDir}/) — ${agentsHealth}`,
        action: agentsHealth === "foreign" ? "your own file sits at a managed agent name — rename it or keep the substitution" : `kf install --agent ${id} --scope ${scope}`,
      });
    }
  }

  if (scope === "global") {
    const dupes = agents
      .map((id) => AGENTS.find((x) => x.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .filter((a) => hasOwnedEntries(projectSkillsDir(a, root)));
    items.push({
      done: dupes.length === 0,
      label: dupes.length === 0
        ? "No duplicate project-scope copies (scope: global)"
        : `Duplicate project-scope copies shadowing global skills: ${dupes.map((a) => projectSkillsDir(a, root)).join(", ")}/`,
      action: dupes.length === 0 ? undefined : "kf install (cleans project copies), or kf uninstall --scope project",
    });
  }

  const rulesDir = join(kf, "review", "rules");
  const hasBase = ["general.md", "security.md", "performance.md"].every((f) => existsSync(join(rulesDir, f)));
  items.push({
    done: hasBase,
    label: "Base review rules (.kf/review/rules/)",
    action: "kf init --defaults (seeds templates + rules)",
  });

  const missingStacks = stacks.filter((s) => !existsSync(join(rulesDir, `${s}.md`)));
  items.push({
    done: stacks.length > 0 && missingStacks.length === 0,
    label: stacks.length === 0 ? "Stack rule packs (no stack detected)" : `Stack rule packs: ${stacks.join(", ")}`,
    action: stacks.length === 0 ? "kf rules --stack <id> (see: kf rules --list)" : `kf rules${missingStacks.map((s) => ` --stack ${s}`).join("")}`,
  });

  const hasGit = existsSync(join(root, ".git"));
  if (hasGit) {
    const gi = join(root, ".gitignore");
    const ignored = existsSync(gi) && readFileSync(gi, "utf8").split("\n").some((l) => l.trim().replace(/\/$/, "") === ".works");
    items.push({
      done: ignored,
      label: ".works/ ignored in .gitignore",
      action: "echo '.works/' >> .gitignore",
    });
  }

  const workflows = join(root, ".github", "workflows");
  const hasDocsCi = existsSync(workflows) && readdirSync(workflows).some((f) => /\.ya?ml$/.test(f) && readFileSync(join(workflows, f), "utf8").includes("validate --all --strict --base"));
  items.push({
    done: hasDocsCi,
    label: "CI",
    action: "add a pull_request step (fetch-depth 0) running: kf validate --all --strict --base origin/<base_ref>, so a change without its living-doc update fails",
  });

  items.push({
    done: existsSync(join(root, "AGENTS.md")) || existsSync(join(root, "CLAUDE.md")),
    label: "AGENTS.md (build/test/lint commands, conventions) at root",
    action: "create AGENTS.md documenting the commands and conventions below",
  });

  const declared = cfg.contexts ?? [];
  items.push({
    done: declared.length > 0,
    label: declared.length > 0
      ? `Declared contexts: ${declared.join(", ")} (first is the default)`
      : "Declared contexts (contexts in .kf/config.json) — kf new accepts any context until one is declared",
    action: declared.length > 0 ? undefined : "kf contexts (prints a survey brief; the human confirms the list)",
  });

  const hooksDir = join(kf, "hooks");
  const hooks = existsSync(hooksDir) ? readdirSync(hooksDir).filter((f) => f !== ".gitkeep").length : 0;
  items.push({
    done: hooks > 0,
    label: "Phase hooks (.kf/hooks/) — optional",
    action: "add shell hooks named after stages (e.g. testing) to run on kf stage",
  });

  items.push({
    done: cfg.repository !== undefined,
    label: cfg.repository ? `GitHub link: ${cfg.repository} (kf issues${cfg.project ? ", project board" : ""})` : "GitHub link (repository in .kf/config.json) — optional",
    action: cfg.repository ? undefined : "kf doctor --fix fills it from the GitHub origin remote, or set repository by hand",
  });

  return items;
}

function effectiveRules(cwd: string): Array<{ name: string; path: string; source: string }> {
  const names = new Set<string>();
  const dirs = [PKG_RULES_DIR, join(USER_KABAN_DIR, "review", "rules"), join(projectKabanDir(findWorksRoot(cwd) ?? cwd), "review", "rules")];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (f.endsWith(".md") && f !== "README.md") names.add(f);
    }
  }
  const rules: Array<{ name: string; path: string; source: string }> = [];
  for (const name of [...names].sort()) {
    const resolved = resolveRule(cwd, name);
    if (resolved) rules.push({ name, path: resolved.path, source: resolved.source });
  }
  return rules;
}

/** Commands an agent drives the pipeline with, in the order they are used. */
export const AGENT_COMMANDS = ["new", "status", "instruct", "approve", "validate", "stage", "tasks", "archive", "rules", "install"] as const;

/** The guide is generated from the registered help strings so it can never drift from the parser. */
export function workflowGuide(): string {
  const commands = AGENT_COMMANDS.map((cmd) => {
    const [usage, description = ""] = commandHelp(cmd).replace(/^Usage:\s*/, "").split(/\s+—\s+/);
    return `  ${usage}\n      ${description}`;
  }).join("\n");
  return `## Workflow guide

Pipeline: brainstorm -> planning -> backlog -> implementation -> testing -> review -> done

Human gates (only places the agent must stop for the user):
1. brainstorm: confirm the requirement before planning
2. planning: kf approve the contract; it moves the item to implementation (--backlog parks it)
3. review PASS: merge the PR on GitHub; kf status --change <feature>, kf sync or kf archive closes the item into done

Every transition is also gated on artifacts and report status: files must exist,
be filled and carry no placeholders or secrets, and testing/review reports must
carry the current execution id with a PASS to move forward. kf validate lists
what blocks the next move; kf stage refuses the move while a gate fails.

Commands the agent will use (run \`kf help <command>\` for every option):
${commands}

Skills (11) and agents (7): Claude Code gets them through the kf plugin (\`kf install\` runs
\`claude plugin marketplace add\` and \`claude plugin install kf@kanban-flow\`, or inside Claude Code
\`/plugin marketplace add <package root>\` then \`/plugin install kf@kanban-flow\`). Start with \`/kf:flow\`;
the phase skills are /kf:brainstorm, /kf:plan, /kf:implement, /kf:test, /kf:review, /kf:archive,
/kf:bug, /kf:spike, /kf:travel and /kf:docs. Other runtimes get kf-<name> skill copies (kf-flow, kf-plan, ...).
Loop semantics: FAIL in testing or review sends the item back to implementation
with a new execution id; BLOCKED stops; REQUIREMENT_BUG freezes all movement.
Never bypass a failed gate with --force or --skip-hooks unless the user explicitly approves;
every bypass is recorded in the work item's metadata and reported by kf status/validate.`;
}

/**
 * Print a self-contained briefing an agent can consume to configure this
 * project: current context, a setup checklist with missing actions, the
 * effective review rules to enforce, and the kanban workflow guide.
 */
export async function cmdAutoconfig(_parsed: ParsedArgs, cwd: string, run: ClaudeRun = claudeRunner(cwd)): Promise<CmdResult> {
  const root = findWorksRoot(cwd) ?? cwd;
  const cfg = readProjectConfig(root);
  const stacks = cfg.stacks?.length ? cfg.stacks : detectStacks(root);
  const known = new Set(AGENTS.map((a) => a.id));
  const configured = (cfg.agents ?? []).filter((a): a is AgentId => known.has(a as AgentId));
  const agents: AgentId[] = configured.length > 0 ? configured : [DEFAULT_AGENT];
  const scope = effectiveSkillsScope(cfg);
  const probe = agents.includes("claude") ? await probePlugin(run, scope) : undefined;
  const skills = installedAgents(root, scope, probe);

  const ctx = [
    "## Project context",
    "",
    `- Root: ${root}`,
    `- ${cfg.stacks?.length ? "Configured" : "Detected"} stacks: ${stacks.length ? stacks.join(", ") : "none"}`,
    `- Config: ${existsSync(configPath(root)) ? `${configPath(root)} (context: ${effectiveDefaultContext(cfg)}, reviewer: ${cfg.reviewer ?? "unset"}, agents: ${agents.join(", ")})` : "missing — run kf init"}`,
    `- Skills installed (scope: ${scope}): [${skills.join(", ") || "none"}]`,
    ...(probe && "error" in probe ? [`- ${pluginLine(probe, scope)}`] : []),
  ].join("\n");

  const items = checklist(root, stacks, agents, cfg, probe);
  const check = [
    "## Setup checklist",
    "",
    ...items.map((i) => `- [${i.done ? "x" : " "}] ${i.label}${i.done || !i.action ? "" : ` — run: \`${i.action}\``}`),
  ].join("\n");

  const rules = effectiveRules(cwd);
  const rulesSection = [
    "## Review rules to enforce",
    "",
    rules.length === 0
      ? "No review rules found — run `kf init --defaults` then `kf rules`."
      : "These rules apply at review (precedence: project -> user -> package). Apply them as coding conventions now:",
    ...rules.flatMap((r) => ["", `### ${r.name} (${r.source}: ${r.path})`, "", readFileSync(r.path, "utf8").trim()]),
  ].join("\n");

  const out = [
    "# kanban-flow agent setup briefing",
    "",
    `> You are configuring the project at ${basename(root)} for the kanban-flow workflow.`,
    "> Work through the checklist, adopt the rules below as conventions, and use the",
    "> workflow guide as your reference for driving features through the pipeline.",
    "",
    ctx,
    "",
    check,
    "",
    rulesSection,
    "",
    workflowGuide(),
  ].join("\n");

  return { code: 0, stdout: out };
}
