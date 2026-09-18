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

/** Returns true if the content still contains unresolved template placeholder tokens like `{feature_name}`. */
export function hasUnresolvedPlaceholders(content: string): boolean {
  return /\{[a-z0-9_-]+\}/i.test(content);
}

/** True when an artifact file is considered "filled" — exists, non-empty, no template tokens left. */
export function isFilledFile(raw: string, body: string): boolean {
  const text = body.trim();
  if (text.length === 0) return false;
  return !hasUnresolvedPlaceholders(raw);
}
