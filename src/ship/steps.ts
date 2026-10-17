import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Feature } from "../workflow/features.js";
import type { ShipConfig } from "../project/config.js";
import { splitFrontmatter } from "../shared/frontmatter.js";

export interface StepResult {
  ok: boolean;
  /** One line describing what happened or why it stopped. */
  line: string;
  /** Progress fields to merge into meta.ship (and meta.pr where relevant). */
  stamp?: Record<string, unknown>;
}

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export type Gh = (args: string[]) => { ok: boolean; missing: boolean; stdout: string; stderr: string };

/** Branch the item ships from: registered worktree branch, else the checkout's current branch. */
export function shipBranch(root: string, f: Feature): string | null {
  if (f.meta?.worktree?.branch) return f.meta.worktree.branch;
  try {
    return git(root, ["branch", "--show-current"]) || null;
  } catch {
    return null;
  }
}

/** First heading text of a markdown section, used for PR/release notes. */
function sectionText(file: string, heading: string): string {
  if (!existsSync(file)) return "";
  const body = splitFrontmatter(readFileSync(file, "utf8")).body;
  const m = new RegExp(`^## ${heading}\\s*\\n([\\s\\S]*?)(?=^## |\\z)`, "m").exec(body);
  return (m?.[1] ?? "").trim();
}

function specObjective(f: Feature): string {
  return sectionText(join(f.dir, "phase-1-spec-requirement.md"), "Objective")
    || `Work item ${f.name}`;
}

/** Step 1 — publish: push the branch, open the PR, record `meta.pr`. Skipped once a PR exists. */
export function shipPublish(
  root: string, f: Feature, repo: string, gh: Gh, opts: { draft?: boolean },
): StepResult {
  if (f.meta?.pr) return { ok: true, line: `publish: already recorded ${f.meta.pr}`, stamp: { published: new Date().toISOString() } };
  const branch = shipBranch(root, f);
  if (!branch) return { ok: false, line: "publish: could not resolve a branch (no worktree, detached HEAD?)" };
  try {
    git(root, ["push", "-u", "origin", branch]);
  } catch (err) {
    return { ok: false, line: `publish: git push failed — ${err instanceof Error ? err.message : String(err)}` };
  }
  const title = `${f.name}${f.meta?.kind === "bug" ? " (bug)" : ""}`;
  const body = `## Objective\n\n${specObjective(f)}\n\n---\nShipped via kanban-flow \`kf ship\`.`;
  const args = ["pr", "create", "-R", repo, "--head", branch, "--title", title, "--body", body];
  if (opts.draft) args.push("--draft");
  const res = gh(args);
  if (!res.ok) {
    return {
      ok: false,
      line: `publish: ${res.missing ? "gh CLI not found — install it and run gh auth login." : `gh pr create failed:\n${res.stderr.trim() || res.stdout.trim()}`}`,
    };
  }
  const pr = res.stdout.trim().split("\n").pop() ?? "";
  if (!/^https?:\/\//.test(pr)) return { ok: false, line: `publish: gh pr create returned no PR URL:\n${res.stdout.trim()}` };
  return { ok: true, line: `publish: PR opened — ${pr}`, stamp: { published: new Date().toISOString(), pr } };
}

export type MergeState = "merged" | "open" | "closed" | "unknown";

export function prState(repo: string, pr: string, gh: Gh): { state: MergeState; err?: string } {
  const res = gh(["pr", "view", pr, "-R", repo, "--json", "state"]);
  if (!res.ok) return { state: "unknown", err: res.missing ? "gh CLI not found" : res.stderr.trim() || res.stdout.trim() };
  try {
    const s = ((JSON.parse(res.stdout) as { state?: string }).state ?? "UNKNOWN").toUpperCase();
    return { state: s === "MERGED" ? "merged" : s === "CLOSED" ? "closed" : s === "OPEN" ? "open" : "unknown" };
  } catch {
    return { state: "unknown", err: `unexpected gh output: ${res.stdout.trim()}` };
  }
}

/** Step 2 — merge gate: observe the recorded PR; auto schedules `gh pr merge --auto` once. */
export function shipMerge(
  f: Feature, repo: string, cfg: ShipConfig, gh: Gh,
): StepResult & { proceed: boolean } {
  const pr = f.meta!.pr!;
  const { state, err } = prState(repo, pr, gh);
  if (state === "merged") return { ok: true, proceed: true, line: `merge: ${pr} is merged`, stamp: { merged: new Date().toISOString() } };
  if (state === "closed") return { ok: false, proceed: false, line: `merge: ${pr} was closed unmerged — human decides (fix + reopen, or cancel ship)` };
  if (state === "unknown") return { ok: false, proceed: false, line: `merge: could not read ${pr} — ${err}` };
  if (cfg.merge === "auto") {
    if (f.meta?.ship?.autoMerge) return { ok: true, proceed: false, line: `merge: --auto already scheduled for ${pr} — waiting for CI/review` };
    const res = gh(["pr", "merge", pr, "-R", repo, "--auto", "--squash"]);
    if (!res.ok) {
      return { ok: false, proceed: false, line: `merge: ${res.missing ? "gh CLI not found" : `gh pr merge --auto failed (allow-auto-merge off for the repo?):\n${res.stderr.trim() || res.stdout.trim()}`}` };
    }
    return { ok: true, proceed: false, line: `merge: auto-merge scheduled for ${pr} — GitHub merges when checks pass`, stamp: { autoMerge: new Date().toISOString() } };
  }
  return { ok: true, proceed: false, line: `merge: waiting — ${pr} is open (merge it, or set ship.merge: "auto")` };
}

/** Step 3 — release: tag + `gh release create`, notes from the item's artifacts. */
export function shipRelease(root: string, f: Feature, repo: string, gh: Gh): StepResult {
  const pkgPath = join(root, "package.json");
  const tag = existsSync(pkgPath)
    ? `v${(JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? f.name}`
    : `release-${f.name}`;
  const notes = `## ${f.name}\n\n${specObjective(f)}`;
  const res = gh(["release", "create", tag, "-R", repo, "--title", `${f.name} — ${tag}`, "--notes", notes]);
  if (!res.ok) {
    return { ok: false, line: `release: ${res.missing ? "gh CLI not found" : `gh release create ${tag} failed:\n${res.stderr.trim() || res.stdout.trim()}`}` };
  }
  return { ok: true, line: `release: created ${tag}`, stamp: { release: "done", releaseTag: tag } };
}

/** Step 4 — changelog: append an entry under the file's existing format. */
export function shipChangelog(root: string, f: Feature): StepResult {
  const file = join(root, "CHANGELOG.md");
  const date = new Date().toISOString().slice(0, 10);
  const entry = `- **${f.name}**: ${specObjective(f).split("\n")[0]}${f.meta?.pr ? ` (${f.meta.pr})` : ""}`;
  let body: string;
  if (!existsSync(file)) {
    body = `# Changelog\n\n## [Unreleased] - ${date}\n\n### Added\n${entry}\n`;
  } else {
    const existing = readFileSync(file, "utf8");
    const unreleased = /^## \[Unreleased\].*$/m.exec(existing);
    if (unreleased) {
      const at = unreleased.index + unreleased[0].length;
      body = `${existing.slice(0, at)}\n\n### Added\n${entry}${existing.slice(at)}`;
    } else {
      const firstVersion = /^## \[/m.exec(existing);
      const insert = `## [${f.meta?.ship?.releaseTag ?? "Unreleased"}] - ${date}\n\n### Added\n${entry}\n\n`;
      body = firstVersion
        ? `${existing.slice(0, firstVersion.index)}${insert}${existing.slice(firstVersion.index)}`
        : `${existing}\n${insert}`;
    }
  }
  writeFileSync(file, body, "utf8");
  return { ok: true, line: `changelog: entry added to CHANGELOG.md`, stamp: { changelog: "done" } };
}
