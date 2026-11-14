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

/** The warning for copies rendered from a package in a purgeable cache: their package-root paths dangle once it is purged. `copyRoots` names the dirs written. */
export function ephemeralPackageWarning(copyRoots: string): string {
  return `⚠ the copies in ${copyRoots} point at ${PKG_ROOT}, a temporary package cache — install kf globally (npm i -g @phuthuycoding/kanban-flow) and re-run kf install so they keep resolving`;
}

/** The Devin `allowed-tools` name of each Claude tool; Edit and Write share `edit`. An `mcp__<server>__<tool>` name passes through verbatim — any other name has no Devin equivalent. */
const DEVIN_TOOLS: Readonly<Record<string, string>> = {
  Read: "read",
  Edit: "edit",
  Write: "edit",
  Grep: "grep",
  Glob: "glob",
  Bash: "exec",
};

/**
 * Render a packaged Claude agent profile for Devin's agent registry: the frontmatter `name:`
 * becomes `kf-<seat>` and the `tools:` list becomes Devin's `allowed-tools:` names. A seat
 * carrying a tool with no Devin name emits no allowed-tools key at all — a partial list would
 * silently cut its tools. The rest of the frontmatter and the body carry over unchanged.
 */
export function renderAgentProfile(text: string, seat: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/);
  if (!m) return text;
  const block = m[0];
  const eol = block.includes("\r\n") ? "\r\n" : "\n";
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^name\s*:/.test(line)) {
      out.push(`name: ${copyName(seat)}`);
      continue;
    }
    const tools = line.match(/^tools\s*:\s*(.*)$/);
    if (!tools) {
      out.push(line);
      continue;
    }
    // The tools entry is an inline list, a [flow] list or a `- item` block; collect the names.
    const raw: string[] = [];
    const inline = tools[1].trim().replace(/^\[/, "").replace(/\]$/, "");
    if (inline) raw.push(...inline.split(","));
    else {
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        raw.push(lines[i].replace(/^\s*-\s*/, ""));
      }
    }
    const allowed: string[] = [];
    let translatable = true;
    for (const name of raw.map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean)) {
      const devin = DEVIN_TOOLS[name] ?? (name.startsWith("mcp__") ? name : null);
      if (devin === null) {
        translatable = false;
        break;
      }
      if (!allowed.includes(devin)) allowed.push(devin);
    }
    if (translatable && allowed.length > 0) out.push(`allowed-tools: ${allowed.join(", ")}`);
  }
  return out.join(eol) + text.slice(block.length);
}
