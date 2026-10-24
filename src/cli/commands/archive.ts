import { mkdir, rename, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, METADATA_FILE, UC_FILE_NAME, UC_FILE_PATTERN } from "../../workflow/schema.js";
import { findFeature, stageDir, assertPathName, updateFeatureMeta, writeFeatureMeta, type Feature } from "../../workflow/features.js";
import { withLock } from "../../shared/lock.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "../../workflow/validate.js";
import { splitFrontmatter, applyFrontmatter, getFmValue } from "../../shared/frontmatter.js";
import { writeFileAtomic } from "../../shared/paths.js";
import { runHook, resolveHook, type HookSource } from "../../integrations/hooks.js";
import { findRoot } from "./helpers.js";
import { recordBypasses, bypassNote } from "../../workflow/bypass.js";
import { checkMergeGate } from "../../integrations/github.js";
import { readProjectConfig } from "../../project/config.js";
import { worktreeConfig } from "../../worktree/config.js";
import { teardownWorktree } from "../../worktree/lifecycle.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

interface CanonicalCopy {
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

function prepareCanonicalCopies(root: string, feature: Feature): CanonicalCopy[] {
  if (!feature.context) return [];
  if (feature.meta?.kind === "bug") return [];
  assertPathName(feature.context, "context");
  assertPathName(feature.name, "feature");

  const context = feature.context;
  const base = join(root, "docs");
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
function isUnstampedSnapshot(copy: CanonicalCopy): boolean {
  if (copy.original === null) return false;
  const status = getFmValue(copy.original, "status");
  if (status !== null && status !== "planning") return false;
  return canonicalContent(copy.kind, copy.original) === copy.content;
}

async function writeCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) await writeFileAtomic(copy.destination, copy.content);
}

async function rollbackCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) {
    if (copy.original === null) await rm(copy.destination, { force: true });
    else await writeFileAtomic(copy.destination, copy.original);
  }
}

export async function cmdArchive(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf archive <feature>", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (f.stage === "cancelled") {
    return { code: 1, stdout: `'${name}' was cancelled (${f.meta?.cancellation?.reason ?? "no reason recorded"}). Move it back to ${f.meta?.cancellation?.fromStage ?? "its stage"} first if you want to finish it.`, stderr: "cancelled" };
  }

  // Delivery gate: a recorded PR must be verifiably merged — archive is the post-delivery
  // step, so an unmerged/unverifiable PR refuses before any side effect, on both the
  // review → dones move and the dones reconcile path. No --force escape.
  const merge = checkMergeGate(f, readProjectConfig(root.root).repository);
  if (merge) return merge;

  // Only review → dones transition is archive-able. If already dones, refresh canonical docs idempotently.
  if (f.stage === "dones") {
    const check = validateFeature(f, false, true, readProjectConfig(root.root).harness);
    if (!check.valid && !args.options.force) return { code: 1, stdout: renderValidateText(check), stderr: "gate failed" };
    const copies = args.options["skip-specs"] ? [] : prepareCanonicalCopies(root.root, f);
    const changedDocs = copies.filter((copy) => copy.original !== null && copy.original !== copy.content && !isUnstampedSnapshot(copy));
    if (changedDocs.length > 0 && !args.options.force) {
      return {
        code: 1,
        stdout: `Canonical docs have changed since archive:\n${changedDocs.map((copy) => `  ${copy.destination}`).join("\n")}\nUse --skip-specs to preserve them, or --force only to intentionally restore the archived snapshot.`,
        stderr: "canonical docs changed",
      };
    }
    // --force here skips either the validation gate or the changed-docs refusal above;
    // reaching this point with either failing means force was given. Record it like the
    // review → dones path does, or a forced refresh would leave no trail.
    const forcedCodes = [
      ...(check.valid ? [] : check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code)),
      ...(changedDocs.length > 0 ? ["canonical_docs_changed"] : []),
    ];
    // Reconcile also re-runs the dones hook: the AC gate re-checks, the board re-syncs and
    // the issue close is a no-op on an already-closed issue. --skip-hooks records a bypass.
    const skipHooks = Boolean(args.options["skip-hooks"]);
    const skippedHook: HookSource | null = skipHooks ? resolveHook(root.root, "dones") : null;
    if (!skipHooks) {
      const hook = runHook(root.root, {
        feature: f.name,
        context: f.context,
        dir: f.dir,
        root: root.root,
        from: "dones",
        to: "dones",
        approval: f.meta?.approval?.status ?? "pending",
      });
      if (hook.ran && !hook.ok) {
        return {
          code: 1,
          stdout:
            `Hook 'dones' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\nArchive refused.\n\n${hook.output}\n\nRe-run with --skip-hooks to bypass.`,
          stderr: "hook failed",
        };
      }
    }
    const recorded = recordBypasses(f.stage, "dones", forcedCodes, skippedHook);
    const metaPath = join(f.dir, METADATA_FILE);
    const originalMeta = f.meta && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
    try {
      await writeCanonicalCopies(copies);
      if (f.meta) await updateFeatureMeta(root.root, f.name, (meta) => ({
        ...meta,
        bypasses: recorded.length > 0 ? [...(meta.bypasses ?? []), ...recorded] : meta.bypasses,
        status: "archived",
        // Reconciling an item already stamped keeps its first delivery timestamp.
        delivered: true,
        deliveredAt: meta.deliveredAt ?? new Date().toISOString(),
      }));
    } catch (err) {
      const rollback = await Promise.allSettled([
        rollbackCanonicalCopies(copies),
        ...(originalMeta === null ? [] : [writeFileAtomic(metaPath, originalMeta)]),
      ]);
      const failures = rollback.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
      if (failures.length > 0) throw new AggregateError([err, ...failures], `Canonical docs sync failed and rollback was incomplete for '${name}'.`);
      throw new Error(`Canonical docs sync failed for '${name}'; feature remains in dones.`, { cause: err });
    }
    const deliveredNote = f.meta?.delivered
      ? "\n  Delivery finalized — item was already marked delivered; side effects re-checked."
      : "\n  Delivery finalized — `delivered` stamped in .kfw.json.";
    const issueNote = f.meta?.issue ? "" : "\n  ⚠ no linked issue — tracker has no delivery record.";
    return {
      code: 0,
      stdout:
        `Feature '${name}' is already in dones.\n${copies.length > 0 ? `Canonical docs synced:\n${copies.map((copy) => `  ${copy.destination}`).join("\n")}` : args.options["skip-specs"] ? "(--skip-specs: canonical docs not touched)" : "(no canonical docs synced)"}${deliveredNote}${issueNote}${bypassNote(recorded)}`,
    };
  }
  if (f.stage !== "review" && f.stage !== "shipping") {
    return {
      code: 1,
      stdout: `Cannot archive '${name}': feature is in stage "${f.stage}". Archive only from review or shipping (run: kf stage ${name} review first).`,
      stderr: "wrong stage",
    };
  }

  const force = Boolean(args.options.force);
  const forcedCodes: string[] = [];
  const check = validateFeature({ ...f, stage: "dones" }, false, true, readProjectConfig(root.root).harness);
  if (!check.valid) {
    if (!force) {
      return {
        code: 1,
        stdout: `Gate failed for '${name}'. Fix validation before archiving:\n\n${renderValidateText(check)}\n\nOr re-run with --force.`,
        stderr: "gate failed",
      };
    }
    forcedCodes.push(...check.issues.filter((i) => i.severity === "ERROR").map((i) => i.code));
  }

  // Directional gate: only a PASS review-report may enter dones.
  const direction = checkDirectionGate(f, "dones");
  if (direction.length > 0) {
    if (!force) {
      const lines = direction.map((i) => `  [${i.severity}] ${i.file}: ${i.message} (${i.code})`).join("\n");
      return {
        code: 1,
        stdout: `Cannot archive '${name}' — review result does not allow dones:\n\n${lines}\n\nOr re-run with --force.`,
        stderr: "direction gate failed",
      };
    }
    forcedCodes.push(...direction.map((i) => i.code));
  }

  const dest = stageDir(root.root, "dones");
  const target = join(dest, f.folder);
  if (existsSync(target)) {
    return { code: 1, stdout: `Target already exists: ${target}`, stderr: "target exists" };
  }

  // Phase hook: run the 'dones' hook before archiving (unless --skip-hooks).
  const skipHooks = Boolean(args.options["skip-hooks"]);
  const skippedHook: HookSource | null = skipHooks ? resolveHook(root.root, "dones") : null;
  if (!skipHooks) {
    const hook = runHook(root.root, {
      feature: f.name,
      context: f.context,
      dir: f.dir,
      root: root.root,
      from: f.stage,
      to: "dones",
      approval: f.meta?.approval?.status ?? "pending",
    });
    if (hook.ran && !hook.ok) {
      return {
        code: 1,
        stdout:
          `Hook 'dones' failed (exit ${hook.code})${hook.hook ? ` [${hook.hook.path}]` : ""}.\nArchive refused.\n\n${hook.output}\n\nRe-run with --skip-hooks to bypass.`,
        stderr: "hook failed",
      };
    }
  }

  const afterHook = validateFeature({ ...f, stage: "dones" }, false, true, readProjectConfig(root.root).harness);
  if (!afterHook.valid && !force) return { code: 1, stdout: renderValidateText(afterHook), stderr: "gate failed" };
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };

  // Worktree teardown is the last refusal point before the move: a dirty worktree keeps the
  // item in review untouched. Removing a CLEAN worktree before a possibly-failing docs sync
  // is safe — resume is `kf worktree create`, which rebuilds it from the kept branch.
  let teardown: Awaited<ReturnType<typeof teardownWorktree>> | null = null;
  if (f.meta.worktree) {
    const wtCfg = worktreeConfig(root.root, readProjectConfig(root.root).worktree);
    try {
      teardown = await teardownWorktree(root.root, f, wtCfg);
    } catch (err) {
      return {
        code: 1,
        stdout: `Cannot archive '${name}': ${err instanceof Error ? err.message : String(err)}`,
        stderr: "worktree dirty",
      };
    }
  }

  const recorded = recordBypasses(f.stage, "dones", forcedCodes, skippedHook);
  if (f.context) assertPathName(f.context, "context");
  assertPathName(f.name, "feature");
  const copies = args.options["skip-specs"] ? [] : prepareCanonicalCopies(root.root, f);
  const stale = await withLock(root.root, f.name, async (): Promise<CmdResult | null> => {
    const cur = findFeature(root.root, f.name);
    if (!cur?.meta || cur.stage !== f.stage || cur.dir !== f.dir) {
      return { code: 1, stdout: `Cannot archive '${name}': it changed while the archive was running. Re-run: kf archive ${name}`, stderr: "changed concurrently" };
    }
    const originalMeta = readFileSync(join(cur.dir, METADATA_FILE), "utf8");
    let moved = false;
    try {
      await mkdir(dest, { recursive: true });
      await rename(cur.dir, target);
      moved = true;
      await writeCanonicalCopies(copies);
      // `delivered` is the terminal fact — written last, after every other side effect landed.
      await writeFeatureMeta(target, { ...cur.meta, bypasses: recorded.length > 0 ? [...(cur.meta.bypasses ?? []), ...recorded] : cur.meta.bypasses, status: "archived", worktree: undefined, delivered: true, deliveredAt: new Date().toISOString() });
    } catch (err) {
      if (!moved) throw err;
      const rollback = await Promise.allSettled([
        writeFileAtomic(join(target, METADATA_FILE), originalMeta),
        rollbackCanonicalCopies(copies),
      ]);
      const failures = rollback.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
      try {
        await rename(target, cur.dir);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
      if (failures.length > 0) throw new AggregateError([err, ...failures], `Archive failed and rollback was incomplete for '${name}'.`);
      throw new Error(`Archive failed for '${name}'; feature restored to review.`, { cause: err });
    }
    return null;
  });
  if (stale) return stale;

  const worktreeNote = teardown
    ? `\n  Worktree removed: ${f.meta?.worktree?.path ?? ""} (branch ${teardown.branch} kept)` +
      (teardown.unmergedCommits > 0
        ? `\n  ⚠ ${teardown.branch} has ${teardown.unmergedCommits} commit(s) not merged into HEAD — merge or PR it yourself.`
        : "") +
      teardown.taskBranches.map((b) => `\n  kept task branch: ${b}`).join("") +
      teardown.warnings.map((w) => `\n  ⚠ ${w}`).join("")
    : "";
  const issueNote = f.meta?.issue ? "" : "\n  ⚠ no linked issue — tracker has no delivery record.";
  return {
    code: 0,
    stdout:
      `✓ Archived '${name}'  review → dones\n  ${target}\n${copies.length > 0 ? `  Canonical docs synced:\n${copies.map((copy) => `    ${copy.destination}`).join("\n")}` : args.options["skip-specs"] ? "  (--skip-specs: canonical docs not touched)" : "  (no canonical docs synced)"}\n  Delivery finalized — \`delivered\` stamped in .kfw.json.${issueNote}${worktreeNote}${bypassNote(recorded)}`,
  };
}
