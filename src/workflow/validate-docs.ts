import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, STAGE_INDEX } from "./schema.js";
import { readMarkdownSection, sectionItems } from "../shared/frontmatter.js";
import { git, isGitFailure, runGit } from "../shared/git.js";
import { ProjectConfigError, readProjectConfig } from "../project/config.js";
import { finding, type Finding } from "./findings.js";
import { findWorksRoot, type Feature } from "./features.js";
import {
  addedSpecsFiles,
  checkLivingDocTree,
  docsSpecsChanged,
  removedLegacyFindings,
  resolveDocsBase,
  scanLegacyFeatures,
  type DocsFinding,
} from "./living-docs.js";

const PLAN = ARTIFACTS["implementation-plan"].file;
const REVIEW = ARTIFACTS["review-report"].file;
const SPECS_DIR = "docs/specs";
/** Same rule as `assertPathName`: contexts and feature names. */
const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const SPEC_PATH = /docs\/specs\/([^/\s`'"()<>]+)\/([^/\s`'"()<>]+)\.md/gi;
const CONSOLIDATES = /^consolidates:\s*`?([^\s`]*)`?/i;
const WAIVER = /^none\s*[—–-]+\s*(.*)$/i;

interface Impact {
  /** `{context, capability}` of every `docs/specs/<ctx>/<capability>.md` the section names. */
  specs: { context: string; capability: string }[];
  /** `{context, feature}` of every well-formed `consolidates:` entry. */
  consolidates: { context: string; feature: string; token: string }[];
  /** `consolidates:` values that are not `<ctx>/<feature>`. */
  malformed: string[];
  waived: boolean;
}

/** The project root of an item: `.works/` lives there, never in a worktree. */
function projectRoot(feature: Feature): string {
  const root = findWorksRoot(feature.dir);
  if (!root) throw new Error(`No .works/ root found above ${feature.dir}`);
  return root;
}

/**
 * The declared contexts of the project config, or the finding that says why they cannot be read:
 * an invalid config must not crash `kf status`, and must not let a context pass unchecked.
 */
function declaredContexts(feature: Feature, file: string): { contexts: string[] | undefined } | { issue: Finding } {
  try {
    return { contexts: readProjectConfig(projectRoot(feature)).contexts };
  } catch (err) {
    if (!(err instanceof ProjectConfigError)) throw err;
    return { issue: finding(feature, "ERROR", file, "docs_config_invalid", `Living-doc contexts cannot be checked: ${err.message}`) };
  }
}

const hasMarker = (feature: Feature): boolean => feature.meta?.approval?.livingDocs === true;

/** The parsed `## Documentation Impact` of the item's plan; null when the plan or the section is absent. */
function readImpact(feature: Feature): Impact | null | "no-plan" {
  const path = join(feature.dir, PLAN);
  if (!existsSync(path)) return "no-plan";
  const section = readMarkdownSection(readFileSync(path, "utf8"), "Documentation Impact");
  if (section === null) return null;
  const impact: Impact = { specs: [], consolidates: [], malformed: [], waived: false };
  for (const item of sectionItems(section)) {
    const consolidates = CONSOLIDATES.exec(item);
    if (consolidates) {
      const [context, name, ...rest] = consolidates[1].split("/");
      if (rest.length === 0 && context && name && NAME.test(context) && NAME.test(name)) {
        impact.consolidates.push({ context, feature: name, token: `${context}/${name}` });
      } else {
        impact.malformed.push(consolidates[1]);
      }
      continue;
    }
    const waiver = WAIVER.exec(item);
    if (waiver) {
      if (waiver[1].trim()) impact.waived = true;
      continue;
    }
    for (const match of item.matchAll(SPEC_PATH)) impact.specs.push({ context: match[1], capability: match[2] });
  }
  return impact;
}

/** Why `context` may not be named, or null: declared contexts when the project declares them, else any valid name. */
function contextRefusal(context: string, contexts: string[] | undefined): string | null {
  if (contexts) return contexts.includes(context) ? null : `"${context}" is not a declared context (${contexts.join(", ")})`;
  return NAME.test(context) ? null : `"${context}" is not a valid context name`;
}

/**
 * The plan's `## Documentation Impact` (FR-004): a feature item in planning, or in a later stage
 * before done when it was approved with the living-docs marker, names a living doc
 * `docs/specs/<ctx>/<capability>.md` or waives with `none — <reason>`. README is the context index,
 * never a capability. Contexts in paths and `consolidates:` entries follow the declared contexts.
 */
export function checkDocumentationImpact(feature: Feature): Finding[] {
  if (feature.meta?.kind === "bug") return [];
  const index = STAGE_INDEX[feature.stage];
  if (index < STAGE_INDEX.planning || index >= STAGE_INDEX.done) return [];
  if (feature.stage !== "planning" && !hasMarker(feature)) return [];
  const impact = readImpact(feature);
  // A missing plan is already an artifact_missing finding of the stage gate.
  if (impact === "no-plan") return [];
  if (impact === null || (impact.specs.length === 0 && !impact.waived)) {
    return [finding(feature, "ERROR", PLAN, "docs_impact_missing",
      `${impact === null ? "The plan has no ## Documentation Impact section" : "## Documentation Impact names no living doc"}: list the docs/specs/<context>/<capability>.md it changes, or "none — <reason>"`)];
  }
  if (impact.specs.length === 0 && impact.consolidates.length === 0 && impact.malformed.length === 0) return [];
  const declared = declaredContexts(feature, PLAN);
  if ("issue" in declared) return [declared.issue];
  const { contexts } = declared;
  const issues: Finding[] = [];
  for (const { context, capability } of impact.specs) {
    const path = `${SPECS_DIR}/${context}/${capability}.md`;
    if (capability.toLowerCase() === "readme") {
      issues.push(finding(feature, "ERROR", PLAN, "docs_capability_reserved",
        `${path}: README is reserved for the context index and is not a capability name`));
    }
    const refusal = contextRefusal(context, contexts);
    if (refusal) issues.push(finding(feature, "ERROR", PLAN, "docs_context_undeclared", `${path}: ${refusal}`));
  }
  for (const { context, token } of impact.consolidates) {
    const refusal = contextRefusal(context, contexts);
    if (refusal) issues.push(finding(feature, "ERROR", PLAN, "docs_context_undeclared", `consolidates: ${token}: ${refusal}`));
  }
  for (const value of impact.malformed) {
    issues.push(finding(feature, "ERROR", PLAN, "docs_context_undeclared",
      `consolidates: ${value || "(empty)"}: expected <context>/<feature>`));
  }
  return issues;
}

/** The checkout the item's code lives in: its worktree when it has one, else the project root. */
function itemCheckout(feature: Feature): string {
  return feature.meta?.worktree?.path ?? projectRoot(feature);
}

/** The plan's consolidation entries; none without a plan or section. */
function consolidations(feature: Feature): Impact["consolidates"] {
  const impact = readImpact(feature);
  return impact && impact !== "no-plan" ? impact.consolidates : [];
}

/**
 * The git-free half of the review report's docs rules (FR-006, FR-007, FR-013), for a PASS report on
 * an item approved with the living-docs marker: `docs:` is `updated` or `none`, `none` gives a
 * non-blank `docs_reason`, and every legacy feature the plan consolidates has no file left in the
 * item checkout. Shared by `kf validate` in review and the review → done gate.
 */
export function checkReviewDocsKeys(feature: Feature, fm: Record<string, string>): Finding[] {
  if (fm.status !== "PASS" || !hasMarker(feature)) return [];
  const issues: Finding[] = [];
  const docs = fm.docs ?? "";
  if (docs !== "updated" && docs !== "none") {
    issues.push(finding(feature, "ERROR", REVIEW, "docs_key_missing",
      `PASS needs docs: updated or docs: none in the frontmatter (found "${docs}").`));
  } else if (docs === "none" && !(fm.docs_reason ?? "").trim()) {
    issues.push(finding(feature, "ERROR", REVIEW, "docs_reason_missing",
      "docs: none needs a non-blank docs_reason saying why no living doc changes."));
  }
  const planned = consolidations(feature);
  if (planned.length > 0) {
    const checkout = itemCheckout(feature);
    const dir = existsSync(checkout) ? checkout : projectRoot(feature);
    for (const { context, feature: legacy, token } of planned) {
      if (!scanLegacyFeatures(dir, [context])[context]?.includes(legacy)) continue;
      issues.push(finding(feature, "ERROR", REVIEW, "docs_consolidation_incomplete",
        `The plan consolidates ${token}, but files of it are still under docs/requirement, docs/use-cases or docs/testplan: remove every one of them`));
    }
  }
  return issues;
}

const toFinding = (feature: Feature, f: DocsFinding): Finding => finding(feature, f.severity, f.file, f.code, f.message);

/** The `docs/specs/<context>` folders the committed diff since `mergeBase` touches. */
function touchedContexts(repo: string, mergeBase: string): string[] {
  const paths = git(repo, ["diff", "--name-only", "-z", mergeBase, "HEAD", "--", SPECS_DIR]).split("\0").filter(Boolean);
  return paths.map((p) => p.split("/")).filter((parts) => parts.length >= 4).map((parts) => parts[2]);
}

/**
 * The git half of the review report's docs rules (FR-002, FR-006, FR-008, FR-013, FR-017), for a
 * PASS report in review on an item approved with the living-docs marker. It runs at the item
 * checkout against the merge-base of HEAD with origin/HEAD, over committed refs only. A base that
 * cannot be resolved fails `docs: updated` (the change cannot be proven) and only warns otherwise;
 * any other failed git lookup is an ERROR carrying git's error, never a pass.
 */
export function checkReviewDocsGit(feature: Feature, fm: Record<string, string>): Finding[] {
  if (feature.stage !== "review" || fm.status !== "PASS" || !hasMarker(feature)) return [];
  const updated = fm.docs === "updated";
  const checkout = itemCheckout(feature);
  const unresolved = (why: string): Finding[] => [updated
    ? finding(feature, "ERROR", REVIEW, "docs_git_failed", `docs: updated cannot be proven: ${why}`)
    : finding(feature, "WARNING", REVIEW, "docs_base_unresolved", `Living-doc git checks skipped: ${why}`)];

  const top = runGit(checkout, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    const detail = `git rev-parse --show-toplevel failed (exit ${top.code}) in ${checkout}: ${top.stderr.trim()}`;
    if (/not a git repository/i.test(top.stderr)) return unresolved(detail);
    return [finding(feature, "ERROR", REVIEW, "docs_git_failed", detail)];
  }
  const repo = top.stdout.trim();
  const declared = declaredContexts(feature, REVIEW);
  if ("issue" in declared) return [declared.issue];
  const { contexts } = declared;
  try {
    const base = resolveDocsBase(repo, undefined);
    if ("skipped" in base) return unresolved(base.skipped);
    const issues: Finding[] = [];
    if (updated && !docsSpecsChanged(repo, base.mergeBase)) {
      issues.push(finding(feature, "ERROR", REVIEW, "docs_updated_no_change",
        `docs: updated, but the item changes no file under ${SPECS_DIR}/ since its merge-base with ${base.ref} (committed changes only).`));
    }
    if (feature.meta?.kind === "bug") {
      // A context index is not a living doc: a bug may edit or add one.
      const created = addedSpecsFiles(repo, base.mergeBase).filter((p) => !p.endsWith("/README.md"));
      if (created.length > 0) {
        issues.push(finding(feature, "ERROR", REVIEW, "docs_bug_new_spec",
          `A bug may not create a living doc: ${created.join(", ")}. Edit an existing capability, or move the new one to a feature item.`));
      }
    }
    issues.push(...removedLegacyFindings(repo, base.mergeBase, contexts).map((f) => toFinding(feature, f)));
    const impact = readImpact(feature);
    const folders = new Set([
      ...(feature.meta?.context ? [feature.meta.context] : []),
      ...touchedContexts(repo, base.mergeBase),
      ...(impact && impact !== "no-plan" ? impact.specs.map((s) => s.context) : []),
    ]);
    issues.push(...checkLivingDocTree(repo, [...folders].filter((c) => NAME.test(c))).map((f) => toFinding(feature, f)));
    return issues;
  } catch (err) {
    if (!isGitFailure(err)) throw err;
    return [finding(feature, "ERROR", REVIEW, "docs_git_failed", err.message)];
  }
}
