import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { readProjectConfig } from "../../project/config.js";
import { issueUrl, prUrl } from "../../project/repository.js";
import { findFeature, writeFeatureMeta } from "../../workflow/features.js";
import { runHook } from "../../integrations/hooks.js";
import { splitFrontmatter, isFilledFile } from "../../shared/frontmatter.js";
import { ARTIFACTS } from "../../workflow/schema.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

interface GhResult {
  ok: boolean;
  missing: boolean;
  stdout: string;
  stderr: string;
}

/** `gh` is an optional dependency — surfaces only when a repository is configured and used. */
function gh(args: string[]): GhResult {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  const missing = res.error !== undefined && "code" in res.error && res.error.code === "ENOENT";
  return {
    ok: res.status === 0,
    missing,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function ghFailure(res: GhResult, what: string): CmdResult {
  if (res.missing) return { code: 1, stdout: `gh CLI not found — install it and run gh auth login to ${what}.`, stderr: "gh missing" };
  return { code: 1, stdout: `gh failed to ${what}:\n${res.stderr.trim() || res.stdout.trim()}`, stderr: "gh failed" };
}

function noRepository(): CmdResult {
  return {
    code: 1,
    stdout: 'No repository configured. Set "repository": "owner/name" in .kf/config.json (kf init detects it from the origin remote).',
    stderr: "no repository",
  };
}

function parseLimit(raw: unknown): number | null {
  if (raw === undefined) return 30;
  const n = Number(String(raw));
  return /^\d+$/.test(String(raw)) && n >= 1 && n <= 1000 ? n : null;
}

interface IssueRow {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string }>;
  url: string;
}

function cmdList(repo: string, args: ParsedArgs): CmdResult {
  const state = typeof args.options.state === "string" ? args.options.state : "open";
  if (!["open", "closed", "all"].includes(state)) {
    return { code: 1, stdout: `Unknown state '${state}'. Expected open, closed or all.`, stderr: "invalid state" };
  }
  const limit = parseLimit(args.options.limit);
  if (limit === null) return { code: 1, stdout: `Invalid --limit '${String(args.options.limit)}': expected 1..1000.`, stderr: "invalid limit" };
  const res = gh(["issue", "list", "-R", repo, "--state", state, "--limit", String(limit),
    "--json", "number,title,state,labels,url"]);
  if (!res.ok) return ghFailure(res, "list issues");
  const issues = JSON.parse(res.stdout) as IssueRow[];
  if (args.options.json) return { code: 0, stdout: JSON.stringify(issues, null, 2) };
  if (issues.length === 0) return { code: 0, stdout: `No ${state} issues on ${repo}.` };
  return {
    code: 0,
    stdout: issues.map((i) => {
      const labels = i.labels.length > 0 ? `  [${i.labels.map((l) => l.name).join(", ")}]` : "";
      return `#${String(i.number).padEnd(4)} ${i.state.padEnd(7)} ${i.title}${labels}`;
    }).join("\n"),
  };
}

function cmdView(repo: string, numRaw: string | undefined): CmdResult {
  const num = Number(numRaw);
  if (!numRaw || !/^\d+$/.test(numRaw) || num < 1) {
    return { code: 1, stdout: "Missing issue number. Usage: kf issues view <n>", stderr: "missing issue" };
  }
  const res = gh(["issue", "view", String(num), "-R", repo]);
  if (!res.ok) return ghFailure(res, `view issue #${num}`);
  return { code: 0, stdout: res.stdout.trim() };
}

/** The filled requirement as issue body: frontmatter stripped, kf footer appended. Null when not filled. */
function specBody(dir: string): string | null {
  const spec = join(dir, ARTIFACTS["spec-requirement"].file);
  const raw = existsSync(spec) ? readFileSync(spec, "utf8") : "";
  const { body } = splitFrontmatter(raw);
  if (!raw || !isFilledFile(raw, body)) return null;
  return `${body.trim()}\n\n---\n**Work item kf:** \`${dir}\` — synced from \`${ARTIFACTS["spec-requirement"].file}\`.`;
}

function issueBody(dir: string): string {
  const filled = specBody(dir);
  if (filled) return filled;
  return `Work item \`${dir}\` created by kf; the requirement is being drafted in \`${ARTIFACTS["spec-requirement"].file}\` and will be synced when it is confirmed.\n\nConvention: one branch + one PR into the default branch, the PR notes \`Closes #<this issue>\`.`;
}

async function cmdSync(root: string, repo: string, name: string | undefined): Promise<CmdResult> {
  if (!name) return { code: 1, stdout: "Missing feature name. Usage: kf issues sync <feature>", stderr: "missing feature" };
  const f = findFeature(root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta?.issue) {
    return { code: 1, stdout: `'${f.name}' has no linked issue — run kf issues create or kf issues link first.`, stderr: "no issue" };
  }
  const body = specBody(f.dir);
  if (!body) {
    return { code: 1, stdout: `'${f.name}' has no filled requirement to sync — write ${ARTIFACTS["spec-requirement"].file} first.`, stderr: "spec not filled" };
  }
  const tmp = await mkdtemp(join(tmpdir(), "kf-issue-"));
  try {
    const file = join(tmp, "body.md");
    await writeFile(file, body, "utf8");
    const res = gh(["issue", "edit", f.meta.issue, "-R", repo, "--body-file", file]);
    if (!res.ok) return ghFailure(res, `sync '${f.name}' into its issue`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return { code: 0, stdout: `Synced requirement → ${f.meta.issue}` };
}

/**
 * The issue title prefers the human-written goal over the slug — "ci-pipeline-dedup" tells a
 * reader nothing on a repo's issue list. An explicit --title wins over both.
 */
export function issueTitle(meta: { goal?: string }, feature: string, override?: string): string {
  return override ?? meta.goal ?? feature;
}

async function cmdCreate(root: string, repo: string, name: string | undefined, labels: unknown, titleOverride: unknown): Promise<CmdResult> {
  if (!name) return { code: 1, stdout: "Missing feature name. Usage: kf issues create <feature> [--title <t>] [--label <l> ...]", stderr: "missing feature" };
  const f = findFeature(root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta) return { code: 1, stdout: `'${f.name}' has no metadata file — cannot record the issue link.`, stderr: "no meta" };
  if (f.meta.issue) {
    return { code: 1, stdout: `'${f.name}' already links to ${f.meta.issue}.`, stderr: "issue exists" };
  }
  const kind = f.meta.kind === "bug" ? "bug" : "enhancement";
  const labelArgs = (Array.isArray(labels) && labels.length > 0 ? labels as string[] : [kind])
    .flatMap((l) => ["--label", l]);
  const title = issueTitle(f.meta, f.name, typeof titleOverride === "string" && titleOverride !== "" ? titleOverride : undefined);
  const res = gh(["issue", "create", "-R", repo, "--title", title, "--body", issueBody(f.dir), ...labelArgs]);
  if (!res.ok) return ghFailure(res, `create issue for '${f.name}'`);
  const url = res.stdout.trim().split("\n").at(-1) ?? "";
  if (!/^https:\/\/[^/]+\/[^/]+\/[^/]+\/issues\/\d+$/.test(url)) {
    return { code: 1, stdout: `gh did not return an issue URL:\n${res.stdout.trim()}`, stderr: "no issue url" };
  }
  await writeFeatureMeta(f.dir, { ...f.meta, issue: url });
  return { code: 0, stdout: `Created ${url}\nRecorded on work item '${f.name}' (${f.dir}/.kfw.json).` };
}

async function cmdLink(root: string, repo: string, name: string | undefined, target: string | undefined, isPr: boolean): Promise<CmdResult> {
  if (!name || !target) {
    return { code: 1, stdout: "Usage: kf issues link <feature> <issue-number-or-url|--pr> — a pull request URL (…/pull/<n>) or --pr records the PR that delivers the item.", stderr: "missing args" };
  }
  const f = findFeature(root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  // Bare numbers stay "issue" — issue and PR numbers share a sequence; disambiguate with --pr or a /pull/ URL.
  const isPrRef = isPr || /^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(target);
  if (isPrRef && f.meta?.pr) {
    return { code: 1, stdout: `'${f.name}' already links PR ${f.meta.pr}.`, stderr: "pr exists" };
  }
  if (!isPrRef && f.meta?.issue) {
    return { code: 1, stdout: `'${f.name}' already links to ${f.meta.issue}.`, stderr: "issue exists" };
  }
  let url: string;
  if (isPrRef) {
    if (/^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+$/.test(target)) url = target;
    else if (/^\d+$/.test(target)) url = prUrl(repo, Number(target));
    else return { code: 1, stdout: `'${target}' is neither a PR number nor a GitHub pull request URL.`, stderr: "invalid pr" };
  } else {
    if (/^\d+$/.test(target)) url = issueUrl(repo, Number(target));
    else if (/^https:\/\/[^/]+\/[^/]+\/[^/]+\/issues\/\d+$/.test(target)) url = target;
    else return { code: 1, stdout: `'${target}' is neither an issue number nor a GitHub issue URL.`, stderr: "invalid issue" };
  }
  if (!f.meta) return { code: 1, stdout: `'${f.name}' has no metadata file — cannot record the link.`, stderr: "no meta" };
  await writeFeatureMeta(f.dir, { ...f.meta, ...(isPrRef ? { pr: url } : { issue: url }) });
  return { code: 0, stdout: `Linked '${f.name}' → ${url}` };
}

/**
 * `kf issues done` — the delivery trigger. Archive ends the kanban lifecycle; this command
 * is the human saying "it shipped": it verifies a recorded PR is merged, then runs the
 * `delivered` hook (issue close + board → statusMap.delivered) and stamps `delivered`.
 * Every side effect is idempotent, so re-runs reconcile after a partial failure — the flag
 * records state, it never gates re-execution.
 */
async function cmdDone(root: string, repo: string, name: string | undefined): Promise<CmdResult> {
  if (!name) return { code: 1, stdout: "Missing feature name. Usage: kf issues done <feature>", stderr: "missing feature" };
  const f = findFeature(root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta) return { code: 1, stdout: `'${f.name}' has no metadata file.`, stderr: "no meta" };
  if (f.stage !== "dones") {
    return { code: 1, stdout: `'${f.name}' is in '${f.stage}' — kf issues done marks delivery after archive.`, stderr: "not archived" };
  }
  if (f.meta.pr) {
    const res = gh(["pr", "view", f.meta.pr, "-R", repo, "--json", "state"]);
    if (!res.ok) return ghFailure(res, `view ${f.meta.pr}`);
    let state = "UNKNOWN";
    try {
      state = ((JSON.parse(res.stdout) as { state?: string }).state ?? "UNKNOWN").toUpperCase();
    } catch {
      return { code: 1, stdout: `gh pr view ${f.meta.pr} returned unexpected output:\n${res.stdout.trim()}`, stderr: "pr view parse" };
    }
    if (state !== "MERGED") {
      return { code: 1, stdout: `PR ${f.meta.pr} is not merged (state: ${state}) — merge it first, or deliver by hand.`, stderr: "pr not merged" };
    }
  }

  const hookRes = runHook(root, {
    feature: f.name,
    context: f.context,
    dir: f.dir,
    root,
    from: "dones",
    to: "dones",
    approval: f.meta.approval?.status ?? "pending",
  }, { hookName: "delivered" });

  const lines: string[] = [];
  if (!f.meta.issue) lines.push("⚠ no linked issue — recording delivery only");
  if (!hookRes.ran) lines.push("⚠ no delivered.sh hook found — GitHub side effects skipped (reseed .kf/hooks/ to get the pack's)");
  else if (!hookRes.ok) lines.push(`⚠ delivered hook failed (exit ${hookRes.code}) — re-run 'kf issues done ${f.name}' to reconcile\n${hookRes.output}`);
  if (f.meta.delivered) lines.push(`'${f.name}' already marked delivered — re-checked side effects.`);
  else lines.push(`✓ '${f.name}' delivered${f.meta.pr ? ` (PR merged)` : ""}${f.meta.issue ? ` — issue closed, board → delivered` : ""}`);

  await writeFeatureMeta(f.dir, { ...f.meta, delivered: true, deliveredAt: new Date().toISOString() });
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdIssues(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const repo = readProjectConfig(root.root).repository;
  if (!repo) return noRepository();

  const sub = args.positionals[0];
  if (sub === "create") return cmdCreate(root.root, repo, args.positionals[1], args.options.label, args.options.title);
  if (sub === "sync") return cmdSync(root.root, repo, args.positionals[1]);
  if (sub === "link") return cmdLink(root.root, repo, args.positionals[1], args.positionals[2], Boolean(args.options.pr));
  if (sub === "done") return cmdDone(root.root, repo, args.positionals[1]);
  if (sub === "view") return cmdView(repo, args.positionals[1]);
  if (sub !== undefined && /^\d+$/.test(sub)) return cmdView(repo, sub);
  if (sub !== undefined) {
    return { code: 1, stdout: `Unknown issues subcommand '${sub}'. Usage: kf issues [view <n>|create <feature>|link <feature> <n|url> [--pr]|sync <feature>|done <feature>].`, stderr: "unknown subcommand" };
  }
  return cmdList(repo, args);
}
