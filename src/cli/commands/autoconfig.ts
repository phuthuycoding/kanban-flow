import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { findWorksRoot } from "../../workflow/features.js";
import { commandHelp } from "../args.js";
import { effectiveDefaultContext } from "../../project/contexts.js";
import { readProjectConfig, detectStacks, configPath, projectKabanDir, effectiveSkillsScope, type ProjectConfig } from "../../project/config.js";
import { AGENTS, DEFAULT_AGENT, projectSkillsDir, userSkillsDir, type AgentId, type SkillScope } from "../../integrations/agents.js";
import { agentSkillsState, hasManagedEntries, skillsAreHealthy } from "../../integrations/install.js";
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

function installedAgents(root: string, scope: SkillScope): AgentId[] {
  return AGENTS.filter((a) => skillsAreHealthy(agentSkillsState(skillsDirAtScope(a, root, scope)))).map((a) => a.id);
}

function checklist(root: string, stacks: string[], agents: AgentId[], cfg: Partial<ProjectConfig>): CheckItem[] {
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
    const dir = skillsDirAtScope(a, root, scope);
    const state = agentSkillsState(dir);
    items.push({
      done: skillsAreHealthy(state),
      label: `Skills for ${a.label} (scope: ${scope}, ${dir}/) — ${state}`,
      action: `kf install --agent ${id} --scope ${scope}`,
    });
  }

  if (scope === "global") {
    const dupes = agents
      .map((id) => AGENTS.find((x) => x.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .filter((a) => hasManagedEntries(projectSkillsDir(a, root)));
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

  const assigned = Object.keys(cfg.harness?.stages ?? {}).length;
  items.push({
    done: cfg.harness !== undefined,
    label: cfg.harness ? `Multi-agent harness: main ${cfg.harness.main}, ${assigned} stage${assigned === 1 ? "" : "s"} assigned (kf harness)` : "Multi-agent harness (harness block in .kf/config.json)",
    action: cfg.harness ? undefined : "kf init --defaults (seeds runner presets)",
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
export const AGENT_COMMANDS = ["new", "status", "instruct", "approve", "validate", "stage", "run", "runs", "harness", "archive", "rules", "install"] as const;

/** The guide is generated from the registered help strings so it can never drift from the parser. */
export function workflowGuide(): string {
  const commands = AGENT_COMMANDS.map((cmd) => {
    const [usage, description = ""] = commandHelp(cmd).replace(/^Usage:\s*/, "").split(/\s+—\s+/);
    return `  ${usage}\n      ${description}`;
  }).join("\n");
  return `## Workflow guide

Pipeline: brainstorm -> planning -> backlog -> implementation -> testing -> review -> dones

Human gates (only places the agent must stop for the user):
1. brainstorm: confirm the requirement before planning
2. planning: kf approve the contract + choose start-now vs backlog

Every transition is also gated on artifacts and report status: files must exist,
be filled and carry no placeholders or secrets, and testing/review reports must
carry the current execution id with a PASS to move forward. kf validate lists
what blocks the next move; kf stage refuses the move while a gate fails.

Commands the agent will use (run \`kf help <command>\` for every option):
${commands}

Skills installed per agent: kanban-flow (orchestrator), kanban-brainstorm, kanban-bug,
kanban-plan, kanban-implement, kanban-test, kanban-review, kanban-archive.
Loop semantics: FAIL/REJECT in testing or review sends the item back to implementation
with a new execution id; BLOCKED stops; REQUIREMENT_BUG freezes all movement.
Never bypass a failed gate with --force or --skip-hooks unless the user explicitly approves;
every bypass is recorded in the work item's metadata and reported by kf status/validate.`;
}

/**
 * Print a self-contained briefing an agent can consume to configure this
 * project: current context, a setup checklist with missing actions, the
 * effective review rules to enforce, and the kanban workflow guide.
 */
export async function cmdAutoconfig(_parsed: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = findWorksRoot(cwd) ?? cwd;
  const cfg = readProjectConfig(root);
  const stacks = cfg.stacks?.length ? cfg.stacks : detectStacks(root);
  const known = new Set(AGENTS.map((a) => a.id));
  const configured = (cfg.agents ?? []).filter((a): a is AgentId => known.has(a as AgentId));
  const agents: AgentId[] = configured.length > 0 ? configured : [DEFAULT_AGENT];
  const scope = effectiveSkillsScope(cfg);
  const skills = installedAgents(root, scope);

  const ctx = [
    "## Project context",
    "",
    `- Root: ${root}`,
    `- ${cfg.stacks?.length ? "Configured" : "Detected"} stacks: ${stacks.length ? stacks.join(", ") : "none"}`,
    `- Config: ${existsSync(configPath(root)) ? `${configPath(root)} (context: ${effectiveDefaultContext(cfg)}, reviewer: ${cfg.reviewer ?? "unset"}, agents: ${agents.join(", ")})` : "missing — run kf init"}`,
    `- Skills installed (scope: ${scope}): [${skills.join(", ") || "none"}]`,
  ].join("\n");

  const items = checklist(root, stacks, agents, cfg);
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
