import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderAgentProfile } from "../integrations/skill-render.js";
import { MANAGED_AGENTS } from "../integrations/managed.js";
import { PKG_ROOT } from "../shared/paths.js";

function packaged(seat: string): string {
  return readFileSync(join(PKG_ROOT, "assets", "agents", `${seat}.md`), "utf8");
}

function frontmatterOf(text: string): string {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error("profile has no frontmatter block");
  return m[1];
}

function bodyOf(text: string): string {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!m) throw new Error("profile has no frontmatter block");
  return text.slice(m[0].length);
}

/** Parse the frontmatter `allowed-tools:` value — inline comma list, `[flow]` list or `- item` block. */
function allowedTools(frontmatter: string): string[] | null {
  const lines = frontmatter.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^allowed-tools\s*:/.test(l));
  if (idx === -1) return null;
  const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, "");
  const inline = lines[idx].replace(/^allowed-tools\s*:\s*/, "").trim();
  if (inline) {
    const inner = inline.replace(/^\[/, "").replace(/\]$/, "");
    return inner.split(",").map(unquote).filter(Boolean);
  }
  const tools: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const item = lines[i].match(/^\s*-\s*(.+?)\s*$/);
    if (!item) break;
    tools.push(unquote(item[1]));
  }
  return tools;
}

// Devin's allowed-tools vocabulary maps Read→read, Edit/Write→edit, Grep→grep, Glob→glob,
// Bash→exec and keeps mcp__<server>__<tool> names verbatim. A seat whose list holds a tool
// with no Devin name (researcher's WebSearch/WebFetch) emits no allowed-tools key at all.
const EXPECTED_TOOLS: Record<string, string[] | null> = {
  "code-reviewer": ["read", "grep", "glob"],
  developer: ["read", "edit", "grep", "glob", "exec"],
  "test-writer": ["read", "edit", "grep", "glob", "exec"],
  "automation-writer": [
    "read",
    "edit",
    "grep",
    "glob",
    "exec",
    "mcp__playwright__browser_navigate",
    "mcp__playwright__browser_snapshot",
    "mcp__playwright__browser_click",
    "mcp__playwright__browser_type",
    "mcp__playwright__browser_wait_for",
    "mcp__playwright__browser_take_screenshot",
    "mcp__playwright__browser_console_messages",
  ],
  scout: ["read", "grep", "glob", "exec"],
  "spec-reviewer": ["read", "edit", "grep", "glob", "exec"],
  researcher: null,
};

describe("renderAgentProfile", () => {
  it("translates every packaged seat's Claude tool names into Devin's allowed-tools names", () => {
    for (const seat of MANAGED_AGENTS) {
      const expected = EXPECTED_TOOLS[seat];
      expect(expected, seat).not.toBeUndefined();
      const tools = allowedTools(frontmatterOf(renderAgentProfile(packaged(seat), seat)));
      expect(tools === null ? null : [...tools].sort(), seat).toEqual(expected === null ? null : [...expected].sort());
    }
  });

  it("emits a single edit name for seats carrying both Edit and Write", () => {
    const tools = allowedTools(frontmatterOf(renderAgentProfile(packaged("developer"), "developer")));
    expect(tools).not.toBeNull();
    expect(tools!.filter((t) => t === "edit")).toHaveLength(1);
  });

  it("keeps mcp__server__tool names verbatim", () => {
    const tools = allowedTools(frontmatterOf(renderAgentProfile(packaged("automation-writer"), "automation-writer")));
    for (const name of [
      "mcp__playwright__browser_navigate",
      "mcp__playwright__browser_snapshot",
      "mcp__playwright__browser_click",
      "mcp__playwright__browser_type",
      "mcp__playwright__browser_wait_for",
      "mcp__playwright__browser_take_screenshot",
      "mcp__playwright__browser_console_messages",
    ]) {
      expect(tools, name).toContain(name);
    }
  });

  it("removes the Claude tools key from the rendered frontmatter", () => {
    for (const seat of MANAGED_AGENTS) {
      const fm = frontmatterOf(renderAgentProfile(packaged(seat), seat));
      expect(fm, seat).not.toMatch(/^tools\s*:/m);
    }
  });

  it("names every rendered profile kf-<seat>", () => {
    for (const seat of MANAGED_AGENTS) {
      const fm = frontmatterOf(renderAgentProfile(packaged(seat), seat));
      expect(fm, seat).toMatch(new RegExp(`^name:\\s*kf-${seat}\\s*$`, "m"));
    }
  });

  it("carries the model line through unchanged", () => {
    for (const seat of MANAGED_AGENTS) {
      const source = frontmatterOf(packaged(seat)).match(/^model:\s*(.+?)\s*$/m);
      expect(source, seat).not.toBeNull();
      const fm = frontmatterOf(renderAgentProfile(packaged(seat), seat));
      expect(fm, seat).toMatch(new RegExp(`^model:\\s*${source![1]}\\s*$`, "m"));
    }
  });

  it("emits no allowed-tools key for a seat with an untranslatable tool", () => {
    const fm = frontmatterOf(renderAgentProfile(packaged("researcher"), "researcher"));
    expect(fm).not.toMatch(/^allowed-tools\s*:/m);
  });

  it("leaves the body text untouched", () => {
    for (const seat of MANAGED_AGENTS) {
      const source = packaged(seat);
      expect(bodyOf(renderAgentProfile(source, seat)), seat).toBe(bodyOf(source));
    }
  });
});
