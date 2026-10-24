import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectConfig } from "../../project/config.js";
import { issueUrl, prUrl } from "../../project/repository.js";
import { findFeature, updateFeatureMeta } from "../../workflow/features.js";
import { splitFrontmatter, isFilledFile } from "../../shared/frontmatter.js";
import { ARTIFACTS } from "../../workflow/schema.js";
import { findRoot, gh, ghFailure, noRepository } from "./helpers.js";
import { cmdArchive } from "./archive.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

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
  await updateFeatureMeta(root, f.name, (meta) => ({ ...meta, issue: url }));
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
  await updateFeatureMeta(root, f.name, (meta) => ({ ...meta, ...(isPrRef ? { pr: url } : { issue: url }) }));
  return { code: 0, stdout: `Linked '${f.name}' → ${url}` };
}

/**
 * `kf issues done` shipped in v0.8.0 and is deprecated: archive is the delivery gate now —
 * the run itself is the confirmation, and the merge gate + dones hook cover what the
 * delivered pseudo-stage used to do. Kept as a thin alias that forwards to `kf archive`.
 */
async function cmdDoneAlias(name: string | undefined, cwd: string): Promise<CmdResult> {
  if (!name) return { code: 1, stdout: "Missing feature name. Usage: kf issues done <feature> (deprecated — use kf archive <feature>)", stderr: "missing feature" };
  const res = await cmdArchive({ command: "archive", positionals: [name], options: {} }, cwd);
  return {
    ...res,
    stdout: `⚠ 'kf issues done' is deprecated — delivery is finalized by 'kf archive' (forwarding).\n${res.stdout}`,
  };
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
  if (sub === "done") return cmdDoneAlias(args.positionals[1], cwd);
  if (sub === "view") return cmdView(repo, args.positionals[1]);
  if (sub !== undefined && /^\d+$/.test(sub)) return cmdView(repo, sub);
  if (sub !== undefined) {
    return { code: 1, stdout: `Unknown issues subcommand '${sub}'. Usage: kf issues [view <n>|create <feature>|link <feature> <n|url> [--pr]|sync <feature>|done <feature> (deprecated alias for kf archive)].`, stderr: "unknown subcommand" };
  }
  return cmdList(repo, args);
}
