/**
 * Minimal YAML frontmatter support (key: value lines). No external deps.
 * Used only for the standard `---` blocks in our templates.
 */

export interface Frontmatter {
  [key: string]: string;
}

/** Extract the frontmatter block and body from a markdown file. */
export function splitFrontmatter(content: string): { fm: Frontmatter; body: string } {
  if (!content.startsWith("---")) {
    return { fm: {}, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: content };
  const block = content.slice(3, end).trim();
  const body = content.slice(end + 4);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !/^\s/.test(line)) fm[key] = value.replace(/^["']|["']$/g, "");
  }
  return { fm, body };
}

/** Serialize frontmatter back into a `---\n...\n---\n` document. */
export function applyFrontmatter(fm: Frontmatter, body: string): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return body;
  const block = keys.map((k) => `${k}: ${fm[k]}`).join("\n");
  const trimmed = body.replace(/^\n+/, "");
  return `---\n${block}\n---\n${trimmed}`;
}

/** Get one frontmatter key value (string) if present. */
export function getFmValue(content: string, key: string): string | null {
  const { fm } = splitFrontmatter(content);
  return fm[key] ?? null;
}

/** Returns true if the content still contains unresolved template placeholder tokens like `{feature_name}`. Tokens inside code blocks and inline code are literal content, not placeholders. */
export function hasUnresolvedPlaceholders(content: string): boolean {
  const stripped = content
    .replace(/```[\s\S]*?(```|$)/g, "")
    .replace(/`[^`\n]*`/g, "");
  return /\{[a-z0-9_-]+\}/i.test(stripped);
}

/** True when an artifact file is considered "filled" — exists, non-empty, no template tokens left. */
export function isFilledFile(raw: string, body: string): boolean {
  const text = body.trim();
  if (text.length === 0) return false;
  return !hasUnresolvedPlaceholders(raw);
}

/** Body of a `## <heading>` section, up to the next `## ` heading; null when the heading is absent. */
export function readMarkdownSection(body: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}[ \\t]*$`, "im").exec(body);
  if (!match) return null;
  const rest = body.slice(match.index + match[0].length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Real content lines of a markdown section — comments, blanks, list markers and template tokens dropped. */
export function sectionItems(section: string): string[] {
  return section
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*+]\s+/, "").trim())
    .filter((line) => line.length > 0 && !/^\{[a-z0-9_-]+\}$/i.test(line));
}
