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
