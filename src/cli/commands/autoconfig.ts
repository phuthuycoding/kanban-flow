import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { findWorksRoot } from "../../workflow/features.js";
import { commandHelp } from "../args.js";
import { readProjectConfig, detectStacks, configPath, projectKabanDir, type ProjectConfig } from "../../project/config.js";
import { AGENTS, DEFAULT_AGENT, projectSkillsDir, type AgentId } from "../../integrations/agents.js";
import { MANAGED_SKILLS } from "../../integrations/install.js";
import { PKG_RULES_DIR, USER_KABAN_DIR, resolveRule } from "../../shared/paths.js";
import type { CmdResult } from "../result.js";
import type { ParsedArgs } from "../args.js";

interface CheckItem {
  done: boolean;
  label: string;
  action?: string;
}

function installedAgents(root: string): AgentId[] {
  const has = (dir: string) => MANAGED_SKILLS.every((s) => existsSync(join(dir, s, "SKILL.md")));
  return AGENTS.filter((a) => has(projectSkillsDir(a, root))).map((a) => a.id);
}

function checklist(root: string, stacks: string[], agents: AgentId[], cfg: Partial<ProjectConfig>): CheckItem[] {
  const items: CheckItem[] = [];
  const kf = projectKabanDir(root);

  items.push({
    done: existsSync(configPath(root)),
    label: "Project config (.kf/config.json)",
    action: "kf init --defaults",
  });

  for (const id of agents) {
    const a = AGENTS.find((x) => x.id === id);
    if (!a) continue;
    items.push({
      done: MANAGED_SKILLS.every((s) => existsSync(join(projectSkillsDir(a, root), s, "SKILL.md"))),
      label: `Project skills for ${a.label} (${projectSkillsDir(a, root)}/)`,
      action: `kf install --agent ${id}`,
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
  const skills = installedAgents(root);

  const ctx = [
    "## Project context",
    "",
    `- Root: ${root}`,
    `- ${cfg.stacks?.length ? "Configured" : "Detected"} stacks: ${stacks.length ? stacks.join(", ") : "none"}`,
    `- Config: ${existsSync(configPath(root)) ? `${configPath(root)} (context: ${cfg.defaultContext ?? "app"}, reviewer: ${cfg.reviewer ?? "unset"}, agents: ${agents.join(", ")})` : "missing — run kf init"}`,
    `- Skills installed (project scope): [${skills.join(", ") || "none"}]`,
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
    "# kaban-flow agent setup briefing",
    "",
    `> You are configuring the project at ${basename(root)} for the kaban-flow workflow.`,
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
