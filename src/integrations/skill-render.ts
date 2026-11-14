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

const AGENT_FENCE = /Agent:\r?\n  subagent_type: kf:([a-z0-9-]+)[^\r\n]*\r?\n  model:\s*([^\r\n]+)\r?\n  description: ([^\r\n]+)\r?\n  prompt: \|/g;
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/;

function mapAgyModelAlias(alias: string): string {
  if (alias === "sonnet") return "inherit";
  if (alias === "opus" || alias === "fable") return "pro";
  if (alias === "haiku") return "flash";
  return alias;
}

function mapAgyModelLine(raw: string): string {
  const hash = raw.indexOf("#");
  const valuePart = (hash === -1 ? raw : raw.slice(0, hash)).trim();
  const commentPart = hash === -1 ? "" : raw.slice(hash).trim();
  const mappedValue = valuePart === "[MODEL]"
    ? "[MODEL]"
    : valuePart.startsWith("<")
      ? valuePart.replace(/\b(sonnet|opus|fable|haiku)\b/g, mapAgyModelAlias)
      : mapAgyModelAlias(valuePart);
  const quoted = `"${mappedValue}"`;
  if (!commentPart) return quoted;
  const mappedComment = commentPart
    .replace(/\bopus\s*\|\s*fable\b/g, "pro")
    .replace(/\b(sonnet|opus|fable|haiku)\b/g, mapAgyModelAlias);
  return `${quoted} ${mappedComment}`;
}

/**
 * Rewrite plugin-form skill text for an Antigravity (`agy`) plugin bundle at `pluginRoot`.
 * Skill dirs are `kf-<name>` (so `/kf-<name>` avoids AGY's built-in `/plan`), agents are
 * registered under `agents/<name>.md`, and dispatches use `invoke_subagent` / `send_message`.
 */
export function renderForAgy(text: string, pluginRoot: string): string {
  const skills = join(pluginRoot, "skills");
  const skillFile = (name: string): string => join(skills, copyName(name), "SKILL.md");
  let out = text.replace(AGENT_FENCE, (match, seat: string, model: string, description: string) => {
    const eol = match.includes("\r\n") ? "\r\n" : "\n";
    return [
      "invoke_subagent:",
      `  TypeName: "${seat}"`,
      `  Model: ${mapAgyModelLine(model)}`,
      `  Role: ${description.trim()}`,
      "  Prompt: |",
    ].join(eol);
  });
  out = out
    .replace(new RegExp(`Skill\\(kf:(${NAME})\\)`, "g"), (_m, name: string) => `follow skill ${copyName(name)} (read ${skillFile(name)})`)
    .replace(new RegExp(`Agent\\(kf:(${NAME})\\)`, "g"), (_m, seat: string) => `invoke_subagent(TypeName: "${seat}")`)
    .replace(new RegExp(`/kf:(${NAME})`, "g"), (_m, name: string) => `/${copyName(name)}`)
    .replace(BARE_HANDOFF, (_m, name: string) => copyName(name))
    .replaceAll("every `dispatch` is an `Agent()` call you make", "every `dispatch` is an `invoke_subagent` call you make")
    .replaceAll(
      "**Resuming the developer** — send one of these as the message, never a new brief:",
      "**Resuming the developer** — call `send_message` with `Recipient` set to that developer's `conversationId` and `Message` containing only the lines below, never a new brief:",
    )
    .replaceAll(
      "Send the open findings verbatim. If the runtime cannot message a live subagent, dispatch a fresh one carrying the brief path, the report path and the findings.",
      "Send the open findings verbatim with `send_message` (`Recipient` set to that developer's `conversationId`). When that conversation is gone, dispatch a fresh `invoke_subagent` carrying the brief path, the report path and the findings.",
    )
    .replaceAll("run the command in the background", "run the command with `run_command` (`WaitMsBeforeAsync: 500`)")
    .replaceAll(
      "with the runtime's background option, never in the foreground",
      "with `run_command` (`WaitMsBeforeAsync: 500`), never in the foreground",
    )
    .replaceAll(
      "Run the loop as a background command that wakes the session when it exits",
      "Run the loop with `run_command` (`WaitMsBeforeAsync: 500`) so it wakes the session when it exits",
    )
    .replaceAll("AskUserQuestion", "ask_question")
    .replaceAll(
      "When `code-reviewer` is not registered but the runtime has a subagent tool, dispatch `subagent_type: general-purpose` with the same prompt, **prefixed by the full body of",
      'When `code-reviewer` is not registered, dispatch `invoke_subagent(TypeName: "self")` with the same prompt, **prefixed by the full body of',
    );
  return out
    .replace(new RegExp(`${PLUGIN}/assets/skills/(${NAME})`, "g"), (_m, x: string) => join(skills, copyName(x)))
    .replace(new RegExp(`${PLUGIN}/assets/agents`, "g"), () => join(pluginRoot, "agents"))
    .replace(new RegExp(`${PLUGIN}/assets/shared`, "g"), () => join(pluginRoot, "shared"))
    .replace(new RegExp(PLUGIN, "g"), () => PKG_ROOT);
}

export const AGY_MAX_SKILL_BODY_BYTES = 22_800;

function slugifyHeading(heading: string): string {
  return heading.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function splitAgyBodyUnits(body: string): Array<{ text: string; canOffload: boolean }> {
  const h2s = body.split(/(?=^## )/m);
  const units: Array<{ text: string; canOffload: boolean }> = [];
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i]!;
    if (i === 0 || /^## (References|Done)\b/.test(h2)) {
      units.push({ text: h2, canOffload: false });
      continue;
    }
    if (Buffer.byteLength(h2, "utf8") > 10_000 && /^### /m.test(h2)) {
      const h3s = h2.split(/(?=^### )/m);
      units.push({ text: h3s[0]!, canOffload: false });
      for (let j = 1; j < h3s.length; j++) {
        units.push({ text: h3s[j]!, canOffload: true });
      }
    } else {
      units.push({ text: h2, canOffload: true });
    }
  }
  return units;
}

/**
 * Render a managed skill's SKILL.md for Antigravity, setting frontmatter `name:` to `kf-<name>`.
 * When the body exceeds `AGY_MAX_SKILL_BODY_BYTES`, trailing/oversized sections are offloaded into
 * `references/agy-<slug>.md` with read pointers so AGY's 24,000-byte load limit drops nothing.
 */
export function renderAgySkillBundle(
  text: string,
  pluginRoot: string,
  name: string,
): { skillMd: string; extraFiles: Map<string, string> } {
  const rendered = renderForAgy(text, pluginRoot).replace(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/, (block) =>
    block.replace(/^name:.*$/m, `name: ${copyName(name)}`));
  const fmMatch = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(rendered);
  const frontmatter = fmMatch ? fmMatch[0] : "";
  const body = rendered.slice(frontmatter.length);
  if (Buffer.byteLength(body, "utf8") <= AGY_MAX_SKILL_BODY_BYTES) {
    return { skillMd: rendered, extraFiles: new Map() };
  }

  const units = splitAgyBodyUnits(body);
  const extraFiles = new Map<string, string>();
  for (let i = units.length - 1; i >= 0; i--) {
    if (Buffer.byteLength(units.map((u) => u.text).join(""), "utf8") <= AGY_MAX_SKILL_BODY_BYTES) break;
    if (!units[i]!.canOffload) continue;
    const unit = units[i]!.text;
    const nl = unit.indexOf("\n");
    if (nl === -1) continue;
    const headingLine = unit.slice(0, nl).replace(/\r$/, "");
    const rel = join("references", `agy-${slugifyHeading(headingLine)}.md`);
    const abs = join(pluginRoot, "skills", copyName(name), rel);
    const stub = `${headingLine}\n\nRead \`${abs}\` before continuing this step.\n\n`;
    if (Buffer.byteLength(stub, "utf8") >= Buffer.byteLength(unit, "utf8")) continue;
    extraFiles.set(rel, unit);
    units[i]!.text = stub;
  }
  return { skillMd: `${frontmatter}${units.map((u) => u.text).join("")}`, extraFiles };
}

/** Render a managed skill's SKILL.md for Antigravity, setting frontmatter `name:` to `kf-<name>`. */
export function renderAgySkillMd(text: string, pluginRoot: string, name: string): string {
  return renderAgySkillBundle(text, pluginRoot, name).skillMd;
}

function mapAgyAgentTool(tool: string): string[] {
  if (tool === "Read" || tool === "Grep" || tool === "Glob") return ["read_file"];
  if (tool === "Edit" || tool === "MultiEdit") return ["edit_file"];
  if (tool === "Write") return ["write_file"];
  if (tool === "Bash") return ["run_command", "manage_task"];
  if (tool === "WebSearch" || tool === "WebFetch") return ["search_web"];
  if (tool.startsWith("mcp__")) return ["call_mcp_tool"];
  return [];
}

/**
 * Render a packaged agent markdown file for Antigravity's `agents/<name>.md` schema:
 * converts `tools` to AGY native tool names, sets `subagent: true` / `mainAgent: false`,
 * JSON-quotes `description` for YAML safety, and renders the body with `renderForAgy`.
 */
export function renderAgentForAgy(text: string, pluginRoot: string): string {
  const match = FRONTMATTER_BLOCK.exec(text);
  if (!match) return renderForAgy(text, pluginRoot);
  const eol = match[0].includes("\r\n") ? "\r\n" : "\n";
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const name = fields.get("name") ?? "";
  const description = renderForAgy(fields.get("description") ?? "", pluginRoot);
  const rawTools = (fields.get("tools") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const tools = [...new Set(rawTools.flatMap(mapAgyAgentTool))];
  const head = [
    "---",
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    "subagent: true",
    "mainAgent: false",
    ...(tools.length > 0 ? ["tools:", ...tools.map((t) => `  - ${t}`)] : []),
    "---",
  ].join(eol);
  const body = renderForAgy(text.slice(match[0].length), pluginRoot);
  return `${head}${body}`;
}

/** The warning for copies rendered from a package in a purgeable cache: their package-root paths dangle once it is purged. `copyRoots` names the dirs written. */
export function ephemeralPackageWarning(copyRoots: string): string {
  return `⚠ the copies in ${copyRoots} point at ${PKG_ROOT}, a temporary package cache — install kf globally (npm i -g @phuthuycoding/kanban-flow) and re-run kf install so they keep resolving`;
}
