import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { MANAGED_SKILLS, copyName } from "./managed.js";

const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const NAME = "[a-z][a-z0-9-]*";

// A bare `kf:<name>` hand-off in prose names a managed skill; the copy is `kf-<name>`. A bare `kf:<agent>` stays: no copy runtime registers a `kf-<agent>` name.
const BARE_HANDOFF = new RegExp(`(?<![\\w-])kf:(${[...MANAGED_SKILLS].map(escape).join("|")})(?![a-z0-9]|-[a-z0-9])`, "g");

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PLUGIN = escape(PLUGIN_ROOT);

/**
 * Rewrite plugin-form skill text for a `kf-<name>` copy in `copyRoot`, the skills dir of a runtime
 * that reads copies instead of the kf plugin. The output never names the plugin root variable.
 */
export function renderForCopy(text: string, copyRoot: string): string {
  return text
    .replace(new RegExp(`Skill\\(kf:(${NAME})\\)`, "g"), "Skill(kf-$1)")
    // Without an agent registry the runtime gets the body itself; the wording is the paste form harness-tools.md documents.
    .replace(new RegExp(`Agent\\(kf:(${NAME})\\)`, "g"), (_m, a: string) => `paste ${copyRoot}/kf-flow/agents/${a}.md as a subagent prompt`)
    .replace(new RegExp(`/kf:(${NAME})`, "g"), "kf-$1")
    .replace(BARE_HANDOFF, "kf-$1")
    .replace(new RegExp(`${PLUGIN}/assets/skills/(${NAME})`, "g"), (_m, x: string) => `${copyRoot}/kf-${x}`)
    .replace(new RegExp(`${PLUGIN}/assets/agents`, "g"), () => `${copyRoot}/kf-flow/agents`)
    .replace(new RegExp(`${PLUGIN}/assets/shared`, "g"), () => `${copyRoot}/kf-flow/shared`)
    .replace(new RegExp(PLUGIN, "g"), () => PKG_ROOT);
}

/**
 * Render a managed skill's SKILL.md for its copy: renderForCopy, plus the frontmatter `name:` set
 * to the copy name, so the runtime registers `kf-<name>` and not a bare name the user may own.
 */
export function renderSkillMd(text: string, copyRoot: string, name: string): string {
  return renderForCopy(text, copyRoot).replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, (block) =>
    block.replace(/^name:.*$/m, `name: ${copyName(name)}`));
}

const AGENT_FENCE = /Agent:\r?\n  subagent_type: kf:([a-z0-9-]+)[^\n]*\r?\n  model:[^\n]*\r?\n  description: ([^\n]+)\r?\n  prompt: \|/g;

/**
 * Rewrite plugin-form skill text for the Grok plugin. Skill directory names stay the packaged
 * names (`flow`, `plan`, …). Dispatch fences become `spawn_subagent` with no `subagent_type`
 * and no `model`. The source files are not changed.
 */
export function renderForGrok(text: string, pluginRoot: string): string {
  const skills = join(pluginRoot, "skills");
  const agentFile = (seat: string): string => join(skills, "flow", "agents", `${seat}.md`);
  const skillFile = (name: string): string => join(skills, name, "SKILL.md");
  let out = text.replace(AGENT_FENCE, (_m, seat: string, description: string) =>
    [
      "spawn_subagent:",
      `  description: ${description}`,
      "  prompt: |",
      `    Follow ${agentFile(seat)} as your instructions before the brief below.`,
      "    Pass no subagent_type and no model. Record the session model in the ledger.",
    ].join("\n"));
  out = out.replace(new RegExp(`Skill\\(kf:(${NAME})\\)`, "g"), (_m, name: string) => `follow skill ${name} (read ${skillFile(name)})`);
  out = out.replace(new RegExp(`Agent\\(kf:(${NAME})\\)`, "g"), (_m, seat: string) =>
    `spawn_subagent with ${agentFile(seat)} pasted as the first lines of the prompt and no subagent_type`);
  out = out
    .replace(new RegExp(`/kf:(${NAME})`, "g"), "$1")
    .replace(BARE_HANDOFF, "$1")
    .replaceAll("every `dispatch` is an `Agent()` call you make", "every `dispatch` is a `spawn_subagent` call you make")
    .replaceAll(
      "**Resuming the developer** — send one of these as the message, never a new brief:",
      "**Resuming the developer** — `spawn_subagent` with `resume_from` set to that seat's id and the prompt only the lines below, never a new brief:",
    )
    .replaceAll(
      "Send the open findings verbatim. If the runtime cannot message a live subagent, dispatch a fresh one carrying the brief path, the report path and the findings.",
      "Send the open findings verbatim with `spawn_subagent` and `resume_from` set to that developer's id. When that id is gone, dispatch a fresh `spawn_subagent` carrying the brief path, the report path and the findings.",
    )
    .replaceAll("run the command in the background", "run the command with `run_terminal_command` and `block_until_ms: 0`")
    .replaceAll(
      "with the runtime's background option, never in the foreground",
      "with `run_terminal_command` and `block_until_ms: 0`, never in the foreground",
    )
    .replaceAll(
      "Run the loop as a background command that wakes the session when it exits",
      "Run the loop with `run_terminal_command` and `block_until_ms: 0` so it wakes the session when it exits",
    )
    .replaceAll(
      "Use the least powerful model that can do the role, and **name it on every dispatch** — a dispatch without a model lands on the runtime's default, which is a configuration, not a decision.",
      "Use the least powerful model that can do the role. On Grok, `spawn_subagent` takes no model argument: record the session model in the ledger (`model=<that name>`). When the session has one model, say the review is not independent in capability. The tiers below name the seat, not a model flag.",
    )
    .replaceAll("AskUserQuestion", "ask_user_question")
    .replaceAll(
      "When `code-reviewer` is not registered but the runtime has a subagent tool, dispatch `subagent_type: general-purpose` with the same prompt, **prefixed by the full body of",
      "When `code-reviewer` is not registered, `spawn_subagent` with no `subagent_type`, the prompt prefixed by the full body of",
    );
  return out
    .replace(new RegExp(`${PLUGIN}/assets/skills/(${NAME})`, "g"), (_m, x: string) => join(skills, x))
    .replace(new RegExp(`${PLUGIN}/assets/agents`, "g"), () => join(skills, "flow", "agents"))
    .replace(new RegExp(`${PLUGIN}/assets/shared`, "g"), () => join(skills, "flow", "shared"))
    .replace(new RegExp(PLUGIN, "g"), () => PKG_ROOT);
}

/** Printed by `kf install --agent grok`. The command does not write this into config. */
export const GROK_CONFIG_HINT = [
  "Grok also loads the Claude kf plugin and any kf-* skill copies. This install does not edit config.",
  "To keep one catalog, add to ~/.grok/config.toml:",
  "",
  "[skills]",
  `ignore = [${MANAGED_SKILLS.map((n) => `"~/.agents/skills/kf-${n}"`).join(", ")}, "~/.claude/plugins/cache/kanban-flow"]`,
].join("\n");

/** The warning for copies rendered from a package in a purgeable cache: their package-root paths dangle once it is purged. `copyRoots` names the dirs written. */
export function ephemeralPackageWarning(copyRoots: string): string {
  return `⚠ the copies in ${copyRoots} point at ${PKG_ROOT}, a temporary package cache — install kf globally (npm i -g @phuthuycoding/kanban-flow) and re-run kf install so they keep resolving`;
}
