import { rm } from "node:fs/promises";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { ARTIFACTS, UC_FILE_NAME, UC_FILE_PATTERN } from "./schema.js";
import { assertPathName, type Feature } from "./features.js";
import { splitFrontmatter, applyFrontmatter, getFmValue } from "../shared/frontmatter.js";
import { writeFileAtomic } from "../shared/paths.js";
import {
  commitAll,
  countCommits,
  currentBranch,
  deleteBranch,
  fetchBranch,
  git,
  hasRemote,
  insideWorkTree,
  originDefaultRef,
  removeWorktree,
  repoPrefix,
  revParse,
  trackedChanges,
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
  const mappings: [string, string, CanonicalKind][] = [
    [ARTIFACTS["spec-requirement"].file, join(base, "requirement", context, `${feature.name}.md`), "requirement"],
    [ARTIFACTS["use-case-specification"].file, join(base, "use-cases", context, feature.name, "README.md"), "use-case-index"],
    [ARTIFACTS["use-case-diagram"].file, join(base, "use-cases", context, feature.name, "diagram.md"), "diagram"],
    [ARTIFACTS["test-cases"].file, join(base, "testplan", context, `${feature.name}.md`), "testplan"],
    [ARTIFACTS["testing-result"].file, join(base, "testplan", context, `${feature.name}-result.md`), "result"],
  ];

  const copies: CanonicalCopy[] = mappings.map(([sourceFile, destination, kind]) => {
    const source = join(feature.dir, sourceFile);
    if (!existsSync(source)) throw new Error(`Cannot sync canonical docs: missing source artifact ${source}`);
    return {
      destination,
      content: canonicalContent(kind, readFileSync(source, "utf8")),
      original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
      kind,
    };
  });

  const useCaseSourceDir = join(feature.dir, "use-cases");
  if (existsSync(useCaseSourceDir)) {
    for (const file of readdirSync(useCaseSourceDir).filter((entry) => UC_FILE_PATTERN.test(entry))) {
      const source = join(useCaseSourceDir, file);
      const destination = join(base, "use-cases", context, feature.name, file);
      copies.push({
        destination,
        content: canonicalContent("use-case", readFileSync(source, "utf8")),
        original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
        kind: "use-case",
      });
    }
  }

  const legacy = join(base, "use-cases", context, `${feature.name}.md`);
  // Older versions stored requirement mirrors under docs/use-cases.
  if (existsSync(legacy) && !copies.some((copy) => copy.destination === legacy)) {
    const raw = readFileSync(legacy, "utf8");
    copies.push({ destination: legacy, content: archivedDocument(raw), original: raw, kind: "requirement" });
  }
  return copies;
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

/** Decide the docs target before anything irreversible runs; fetches origin's default branch to know "behind". */
export function resolveDocsTarget(root: string, feature: Feature): DocsTarget {
  if (!insideWorkTree(root) || !hasRemote(root, "origin")) return { kind: "tree" };
  const base = originDefaultRef(root);
  if (!base) {
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
  if (!why) return { kind: "tree" };
  const branch = docsBranchName(feature);
  if (revParse(root, `refs/heads/${branch}`)) {
    return { kind: "refused", message: `the canonical docs branch ${branch} already exists — push or delete it, then re-run.` };
  }
  return { kind: "branch", branch, base, why };
}

export interface DocsBranchResult {
  /** The committed branch; null when the docs on `base` were already current and nothing was committed. */
  branch: string | null;
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
      return { branch: null, docs };
    }
    const commit = commitAll(wt, `docs(${feature.context}): sync canonical docs for ${feature.name}`);
    if (!commit.ok) throw new Error(`committing the canonical docs on ${target.branch} failed: ${commit.error}`);
    removeWorktree(root, wt);
    return { branch: target.branch, docs };
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
