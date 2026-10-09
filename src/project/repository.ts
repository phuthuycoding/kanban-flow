import { execFileSync } from "node:child_process";

/**
 * Normalize a GitHub repository reference to `owner/name`. Accepts the short form
 * plus the URL shapes `git remote get-url` returns: https, ssh and git@scp-style.
 * Returns null for anything that is not a GitHub repo (other hosts, local paths).
 */
export function normalizeRepository(input: string): string | null {
  const s = input.trim();
  const owner = "([A-Za-z0-9-]+)";
  const repo = "([A-Za-z0-9_.-]+?)";
  const tail = "(?:\\.git)?/?$";
  const short = new RegExp(`^${owner}/${repo}${tail}`).exec(s);
  if (short) return `${short[1]}/${short[2]}`;
  const url = new RegExp(
    `^(?:https?://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${owner}/${repo}${tail}`,
  ).exec(s);
  if (url) return `${url[1]}/${url[2]}`;
  return null;
}

/** `owner/name` of the origin remote, when it points at GitHub; null otherwise. */
export function detectRepository(root: string): string | null {
  let url: string;
  try {
    url = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // not a git repo, or no origin — there is simply nothing to detect
  }
  return normalizeRepository(url);
}

/** Issue tracker URL for a normalized `owner/name` repository. */
export function issueUrl(repository: string, number: number): string {
  return `https://github.com/${repository}/issues/${number}`;
}
