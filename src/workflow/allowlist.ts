// `[` is deliberately not a glob character: Files lists real paths such as `src/[id].ts`, and globToRegExp has no bracket classes.
const GLOB_CHARS = /[*?]/;

const normalise = (pattern: string): string => {
  let p = pattern.replace(/`/g, "").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
};

// A single star or question mark stays inside one path segment; a double star crosses segments, and a double star followed by a slash may match nothing.
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Exact path, directory prefix, or glob; a glob that matches a parent directory also allows what is inside it. */
export function pathAllowed(path: string, patterns: string[]): boolean {
  const segments = path.split("/");
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join("/"));
  return patterns.some((raw) => {
    const p = normalise(raw);
    if (p === "" || p === "." || p === "**") return true;
    if (!GLOB_CHARS.test(p)) return path === p || path.startsWith(`${p}/`);
    const re = globToRegExp(p);
    return prefixes.some((x) => re.test(x));
  });
}

function matchesAll(p: string): boolean {
  return p === "**" || p === "*" || p === "." || p === "";
}

/** Directory portion that is fixed before the first glob char; a partially-written segment is dropped so the prefix stays segment-aligned. */
function staticPrefix(p: string): string {
  const at = p.search(GLOB_CHARS);
  if (at === -1) return p;
  const head = p.slice(0, at);
  return head.slice(0, head.lastIndexOf("/") + 1).replace(/\/+$/, "");
}

function isPathPrefix(prefix: string, path: string): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

export function patternsOverlap(a: string, b: string): boolean {
  const x = normalise(a);
  const y = normalise(b);
  if (x === y || matchesAll(x) || matchesAll(y)) return true;
  const px = staticPrefix(x);
  const py = staticPrefix(y);
  return isPathPrefix(px, py) || isPathPrefix(py, px);
}

/** A task whose files are unknown (null) may touch anything, so it overlaps every other task. */
export function filesOverlap(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return true;
  return a.some((x) => b.some((y) => patternsOverlap(x, y)));
}
