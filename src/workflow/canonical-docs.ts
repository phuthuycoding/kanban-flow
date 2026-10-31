import { rm } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { ARTIFACTS, UC_FILE_NAME, UC_FILE_PATTERN } from "./schema.js";
import { assertPathName, type Feature } from "./features.js";
import { splitFrontmatter, applyFrontmatter, getFmValue } from "../shared/frontmatter.js";
import { writeFileAtomic } from "../shared/paths.js";
import {
  blobId,
  blobIdsAt,
  commitAll,
  countCommits,
  currentBranch,
  deleteBranch,
  fetchBranch,
  git,
  goneBranchText,
  goneLookupProof,
  hasRemote,
  insideWorkTree,
  isAncestor,
  landedProof,
  originDefaultRef,
  removeWorktree,
  repoPrefix,
  revParse,
  trackedChanges,
  type LandedProof,
  type LandedRun,
} from "../shared/git.js";

export interface CanonicalCopy {
  destination: string;
  content: string;
  original: string | null;
  kind: CanonicalKind;
}

function archivedDocument(raw: string): string {
  const { fm, body } = splitFrontmatter(raw);
  if (Object.keys(fm).length === 0) return raw;
  fm.status = "archived";
  return applyFrontmatter(fm, body);
}

/** Only the Status column of the "Use Case Files" table flips; coverage tables keep their text. */
function implementedUseCaseRows(raw: string): string {
  let inFiles = false;
  return raw
    .split("\n")
    .map((line) => {
      if (line.startsWith("## ")) inFiles = line.trim() === "## Use Case Files";
      return inFiles && line.startsWith("|") ? line.replace(/\|\s*planned\s*\|\s*$/, "| implemented |") : line;
    })
    .join("\n");
}

/**
 * How a source artifact becomes its canonical doc. `result` keeps its own status (PASS);
 * everything else describes delivered behavior and is stamped archived.
 */
export type CanonicalKind = "requirement" | "use-case-index" | "use-case" | "diagram" | "testplan" | "result";

export function canonicalContent(kind: CanonicalKind, raw: string): string {
  if (kind === "result") return raw;
  if (kind === "use-case-index") {
    const linked = raw.replace(new RegExp(`use-cases/(${UC_FILE_NAME})`, "gi"), "$1");
    return archivedDocument(implementedUseCaseRows(linked));
  }
  return archivedDocument(raw);
}

/** Canonical doc paths a feature owns, whether or not they exist on disk. */
export function canonicalDocPaths(root: string, feature: Feature): string[] {
  if (!feature.context || feature.meta?.kind === "bug") return [];
  const base = join(root, "docs");
  const { context, name } = { context: feature.context, name: feature.name };
  const useCaseDir = join(base, "use-cases", context, name);
  const files = [
    join(base, "requirement", context, `${name}.md`),
    join(base, "testplan", context, `${name}.md`),
    join(base, "testplan", context, `${name}-result.md`),
  ];
  if (existsSync(useCaseDir)) files.push(useCaseDir);
  return files.filter((p) => existsSync(p));
}

/**
 * The canonical copies of a feature. Sources are always the item's artifacts; `docsRoot` is the
 * project root the copies land under and are compared against — the primary working tree by
 * default, or a checkout of `origin/<default>` when the docs go onto a branch.
 */
export function prepareCanonicalCopies(root: string, feature: Feature, docsRoot: string = root): CanonicalCopy[] {
  if (!feature.context) return [];
  if (feature.meta?.kind === "bug") return [];
  assertPathName(feature.context, "context");
  assertPathName(feature.name, "feature");

  const context = feature.context;
  const base = join(docsRoot, "docs");
  const copies: CanonicalCopy[] = snapshotSources(feature, context, base).map(([source, destination, kind]) => {
    if (!existsSync(source)) throw new Error(`Cannot sync canonical docs: missing source artifact ${source}`);
    return {
      destination,
      content: canonicalContent(kind, readFileSync(source, "utf8")),
      original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
      kind,
    };
  });

  const legacy = join(base, "use-cases", context, `${feature.name}.md`);
  // Older versions stored requirement mirrors under docs/use-cases.
  if (existsSync(legacy) && !copies.some((copy) => copy.destination === legacy)) {
    const raw = readFileSync(legacy, "utf8");
    copies.push({ destination: legacy, content: archivedDocument(raw), original: raw, kind: "requirement" });
  }
  return copies;
}

/** Source artifact, canonical destination under `base` and kind of every doc in a feature's archived snapshot. */
function snapshotSources(feature: Feature, context: string, base: string): [string, string, CanonicalKind][] {
  const sources: [string, string, CanonicalKind][] = ([
    [ARTIFACTS["spec-requirement"].file, join(base, "requirement", context, `${feature.name}.md`), "requirement"],
    [ARTIFACTS["use-case-specification"].file, join(base, "use-cases", context, feature.name, "README.md"), "use-case-index"],
    [ARTIFACTS["use-case-diagram"].file, join(base, "use-cases", context, feature.name, "diagram.md"), "diagram"],
    [ARTIFACTS["test-cases"].file, join(base, "testplan", context, `${feature.name}.md`), "testplan"],
    [ARTIFACTS["testing-result"].file, join(base, "testplan", context, `${feature.name}-result.md`), "result"],
  ] as [string, string, CanonicalKind][]).map(([file, destination, kind]) => [join(feature.dir, file), destination, kind]);
  const useCaseSourceDir = join(feature.dir, "use-cases");
  if (existsSync(useCaseSourceDir)) {
    for (const file of readdirSync(useCaseSourceDir).filter((entry) => UC_FILE_PATTERN.test(entry))) {
      sources.push([join(useCaseSourceDir, file), join(base, "use-cases", context, feature.name, file), "use-case"]);
    }
  }
  return sources;
}

/**
 * Whether origin/<default> already holds this feature's archived snapshot: every canonical doc
 * byte-identical there. False when origin/HEAD is not set or a source artifact is missing (the
 * snapshot cannot be built, so nothing is proven). Reads only local refs; nothing is fetched.
 * One git spawn: the blob ids on `base` are compared to the ids of the expected bytes.
 */
export function docsOnDefault(root: string, feature: Feature, base: string | null = originDefaultRef(root)): boolean {
  if (!feature.context || feature.meta?.kind === "bug") return false;
  assertPathName(feature.context, "context");
  assertPathName(feature.name, "feature");
  if (!base) return false;
  const sources = snapshotSources(feature, feature.context, join(root, "docs"));
  if (!sources.every(([source]) => existsSync(source))) return false;
  const docs = sources.map(([source, destination, kind]): [string, Buffer] =>
    [relative(root, destination).split(sep).join("/"), Buffer.from(canonicalContent(kind, readFileSync(source, "utf8")), "utf8")]);
  const ids = blobIdsAt(root, base, docs.map(([path]) => path));
  return docs.every(([path, content]) => {
    const id = ids.get(path);
    return id !== undefined && id === blobId(content, id.length);
  });
}

/**
 * landedProof for a feature's recorded docs branch. A branch gone locally whose docs are already
 * on origin/<default> is landed by content, whatever route they took; with a recorded docs commit
 * the one-spawn ancestor check runs first and the gh lookup last. A gone branch with no recorded
 * docs commit is never asked about on GitHub: no merged PR could be tied to it.
 */
export function docsLandedProof(root: string, feature: Feature, run: LandedRun = {}): LandedProof {
  const branch = feature.meta?.docsBranch;
  if (!branch) throw new Error(`'${feature.name}' has no docs branch to prove`);
  const commit = feature.meta?.docsCommit;
  if (revParse(root, `refs/heads/${branch}`)) return landedProof(root, branch, commit, run);
  const base = originDefaultRef(root);
  if (commit && base && isAncestor(root, commit, base)) return { landed: true, by: "ancestor" };
  if (docsOnDefault(root, feature, base)) return { landed: true, by: "content" };
  if (commit) return goneLookupProof(root, branch, commit, run);
  if (!base) {
    return {
      landed: false,
      pushed: true,
      gone: true,
      remedy: "git remote set-head origin -a",
      reason: `${goneBranchText(branch)}; no docs commit was recorded and origin/HEAD is not set, so the docs on the default branch cannot be compared (set it: git remote set-head origin -a)`,
    };
  }
  return { landed: false, pushed: true, gone: true, reason: `${goneBranchText(branch)}; no docs commit was recorded and ${base} does not hold these docs` };
}

/**
 * Older versions copied these docs without the archived stamp. Such a doc is not an edit when
 * stamping it yields the new copy. Only the pre-stamp statuses qualify, so a hand-set status
 * (e.g. superseded) is still reported as changed instead of being normalized away.
 */
export function isUnstampedSnapshot(copy: CanonicalCopy): boolean {
  if (copy.original === null) return false;
  const status = getFmValue(copy.original, "status");
  if (status !== null && status !== "planning") return false;
  return canonicalContent(copy.kind, copy.original) === copy.content;
}

export async function writeCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) await writeFileAtomic(copy.destination, copy.content);
}

export async function rollbackCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) {
    if (copy.original === null) await rm(copy.destination, { force: true });
    else await writeFileAtomic(copy.destination, copy.original);
  }
}

/**
 * Where a close writes canonical docs. `tree`: the primary working tree, as always. `branch`: a
 * branch cut from `base` (`origin/<default>`) in a temporary worktree, because the primary is not
 * a safe place — on another branch, carrying uncommitted changes, or behind origin.
 */
export type DocsTarget =
  | { kind: "tree"; note?: string }
  | { kind: "branch"; branch: string; base: string; why: string }
  | { kind: "refused"; message: string };

export const docsBranchName = (feature: Feature): string => `docs/${feature.context}-${feature.name}`;

/**
 * Decide the docs target before anything irreversible runs; fetches origin's default branch to
 * know "behind". `opts.branchOnly` is why these docs must go to a branch even from a safe
 * checkout (the overwrite has to show in a PR diff): where the decision would be the working
 * tree, that becomes the branch, or a refusal when there is no origin/<default> to cut it from.
 */
export function resolveDocsTarget(root: string, feature: Feature, opts: { branchOnly?: string } = {}): DocsTarget {
  if (!insideWorkTree(root) || !hasRemote(root, "origin")) {
    return opts.branchOnly ? { kind: "refused", message: `there is no origin to cut a docs branch from, and ${opts.branchOnly}.` } : { kind: "tree" };
  }
  const base = originDefaultRef(root);
  if (!base) {
    if (opts.branchOnly) return { kind: "refused", message: `origin/HEAD is not set, so there is no default branch to cut a docs branch from (set it: git remote set-head origin -a), and ${opts.branchOnly}.` };
    return { kind: "tree", note: "origin/HEAD is not set, so the default branch is unknown — docs written to the working tree (set it: git remote set-head origin -a)" };
  }
  const defaultBranch = base.slice(base.indexOf("/") + 1);
  const fetched = fetchBranch(root, "origin", defaultBranch);
  if (fetched.code !== 0) {
    return {
      kind: "refused",
      message: `could not fetch ${base} to place the canonical docs: ${fetched.stderr.trim() || `git fetch exited ${fetched.code}`}. Re-run when origin is reachable.`,
    };
  }
  const current = currentBranch(root);
  let why: string | null = null;
  if (current !== defaultBranch) why = `the checkout is on ${current ?? "a detached HEAD"}, not ${defaultBranch}`;
  else if (trackedChanges(root).length > 0) why = "the checkout has uncommitted changes";
  else {
    const behind = countCommits(root, "HEAD", base);
    if (behind > 0) why = `the checkout is ${behind} commit(s) behind ${base}`;
  }
  if (!why && !opts.branchOnly) return { kind: "tree" };
  const branch = docsBranchName(feature);
  if (revParse(root, `refs/heads/${branch}`)) {
    return { kind: "refused", message: `the canonical docs branch ${branch} already exists — push or delete it, then re-run.` };
  }
  return { kind: "branch", branch, base, why: why ?? opts.branchOnly! };
}

export interface DocsBranchResult {
  /** The committed branch; null when the docs on `base` were already current and nothing was committed. */
  branch: string | null;
  /** The docs commit on `branch`; null when nothing was committed. */
  commit: string | null;
  /** Destinations relative to the repository top level. */
  docs: string[];
}

/**
 * Write the canonical docs onto `target.branch` in a temporary worktree cut from `target.base`
 * and commit them there. The branch is not pushed. On failure the worktree and the branch are
 * removed again and the error propagates; the primary working tree is never touched.
 */
export async function writeCanonicalDocsBranch(
  root: string,
  feature: Feature,
  target: Extract<DocsTarget, { kind: "branch" }>,
): Promise<DocsBranchResult> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-docs-")));
  const wt = join(scratch, "wt");
  let added = false;
  try {
    // --no-track: cut from origin/<default>, the branch must not inherit it as upstream, or a
    // bare `git push` from it would target the default branch.
    git(root, ["worktree", "add", "--no-track", "-b", target.branch, wt, target.base]);
    added = true;
    const copies = prepareCanonicalCopies(root, feature, join(wt, repoPrefix(root)));
    await writeCanonicalCopies(copies);
    const docs = copies.map((copy) => relative(wt, copy.destination));
    if (git(wt, ["status", "--porcelain"]) === "") {
      removeWorktree(root, wt, { force: true });
      deleteBranch(root, target.branch);
      return { branch: null, commit: null, docs };
    }
    // --no-verify: kf authored every byte of this commit, and the repo's hooks cannot run in a
    // temp worktree without node_modules — a hook failure here would land after the irreversible
    // steps of the close.
    const commit = commitAll(wt, `docs(${feature.context}): sync canonical docs for ${feature.name}`, { noVerify: true });
    if (!commit.ok) throw new Error(`committing the canonical docs on ${target.branch} failed: ${commit.error}`);
    removeWorktree(root, wt);
    return { branch: target.branch, commit: commit.sha, docs };
  } catch (err) {
    if (!added) throw err;
    const failures: unknown[] = [];
    for (const undo of [() => removeWorktree(root, wt, { force: true }), () => deleteBranch(root, target.branch)]) {
      try {
        undo();
      } catch (undoError) {
        failures.push(undoError);
      }
    }
    if (failures.length > 0) throw new AggregateError([err, ...failures], `Canonical docs branch ${target.branch} failed and its cleanup was incomplete.`);
    throw err;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
