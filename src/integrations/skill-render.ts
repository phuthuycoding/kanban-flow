import { PKG_ROOT } from "../shared/paths.js";

const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
const NAME = "[a-z][a-z0-9-]*";

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
    .replace(new RegExp(`${PLUGIN}/skills/(${NAME})`, "g"), (_m, x: string) => `${copyRoot}/kf-${x}`)
    .replace(new RegExp(`${PLUGIN}/agents`, "g"), () => `${copyRoot}/kf-flow/agents`)
    .replace(new RegExp(PLUGIN, "g"), () => PKG_ROOT);
}
