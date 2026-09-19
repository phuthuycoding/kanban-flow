import { rename, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, METADATA_FILE } from "../../workflow/schema.js";
import { findFeature, stageDir, assertPathName, writeFeatureMeta, type Feature } from "../../workflow/features.js";
import { validateFeature, checkDirectionGate, renderValidateText } from "../../workflow/validate.js";
import { splitFrontmatter, applyFrontmatter } from "../../shared/frontmatter.js";
import { writeFileAtomic } from "../../shared/paths.js";
import { runHook, resolveHook, type HookSource } from "../../integrations/hooks.js";
import { findRoot, recordBypasses, bypassNote } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

interface CanonicalCopy {
  destination: string;
  content: string;
  original: string | null;
}

function archivedDocument(raw: string): string {
  const { fm, body } = splitFrontmatter(raw);
  if (Object.keys(fm).length === 0) return raw;
  fm.status = "archived";
  return applyFrontmatter(fm, body);
}

function prepareCanonicalCopies(root: string, feature: Feature): CanonicalCopy[] {
  if (!feature.context) return [];
  if (feature.meta?.kind === "bug") return [];
  assertPathName(feature.context, "context");
  assertPathName(feature.name, "feature");

  const context = feature.context;
  const base = join(root, "docs");
  const mappings = [
    [ARTIFACTS["spec-requirement"].file, join(base, "requirement", context, `${feature.name}.md`), true],
    [ARTIFACTS["use-case-specification"].file, join(base, "use-cases", context, feature.name, "README.md"), false],
    [ARTIFACTS["use-case-diagram"].file, join(base, "use-cases", context, feature.name, "diagram.md"), false],
    [ARTIFACTS["test-cases"].file, join(base, "testplan", context, `${feature.name}.md`), false],
    [ARTIFACTS["testing-result"].file, join(base, "testplan", context, `${feature.name}-result.md`), false],
  ] as const;

  const copies = mappings.map(([sourceFile, destination, archiveStatus]) => {
    const source = join(feature.dir, sourceFile);
    if (!existsSync(source)) throw new Error(`Cannot sync canonical docs: missing source artifact ${source}`);
    const raw = readFileSync(source, "utf8");
    const content = sourceFile === ARTIFACTS["use-case-specification"].file
      ? raw.replace(/use-cases\/(UC-\d+\.md)/gi, "$1")
      : archiveStatus ? archivedDocument(raw) : raw;
    return {
      destination,
      content,
      original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
    };
  });

  const useCaseSourceDir = join(feature.dir, "use-cases");
  if (existsSync(useCaseSourceDir)) {
    for (const file of readdirSync(useCaseSourceDir).filter((entry) => /^UC-\d+\.md$/i.test(entry))) {
      const source = join(useCaseSourceDir, file);
      const destination = join(base, "use-cases", context, feature.name, file);
      copies.push({
        destination,
        content: readFileSync(source, "utf8"),
        original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
      });
    }
  }

  const legacy = join(base, "use-cases", context, `${feature.name}.md`);
  // Older versions stored requirement mirrors under docs/use-cases.
  if (existsSync(legacy) && !copies.some((copy) => copy.destination === legacy)) {
    const raw = readFileSync(legacy, "utf8");
    copies.push({ destination: legacy, content: archivedDocument(raw), original: raw });
  }
  return copies;
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

  // Only review → dones transition is archive-able. If already dones, refresh canonical docs idempotently.
  if (f.stage === "dones") {
    const check = validateFeature(f);
    if (!check.valid && !args.options.force) return { code: 1, stdout: renderValidateText(check), stderr: "gate failed" };
    const copies = args.options["skip-specs"] ? [] : prepareCanonicalCopies(root.root, f);
    const changedDocs = copies.filter((copy) => copy.original !== null && copy.original !== copy.content);
    if (changedDocs.length > 0 && !args.options.force) {
      return {
        code: 1,
        stdout: `Canonical docs have changed since archive:\n${changedDocs.map((copy) => `  ${copy.destination}`).join("\n")}\nUse --skip-specs to preserve them, or --force only to intentionally restore the archived snapshot.`,
        stderr: "canonical docs changed",
      };
    }
    const metaPath = join(f.dir, METADATA_FILE);
    const originalMeta = f.meta && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : null;
    try {
      await writeCanonicalCopies(copies);
      if (f.meta) await writeFeatureMeta(f.dir, { ...f.meta, status: "archived" });
    } catch (err) {
      const rollback = await Promise.allSettled([
        rollbackCanonicalCopies(copies),
        ...(originalMeta === null ? [] : [writeFileAtomic(metaPath, originalMeta)]),
      ]);
      const failures = rollback.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
      if (failures.length > 0) throw new AggregateError([err, ...failures], `Canonical docs sync failed and rollback was incomplete for '${name}'.`);
      throw new Error(`Canonical docs sync failed for '${name}'; feature remains in dones.`, { cause: err });
    }
    return {
      code: 0,
      stdout:
        `Feature '${name}' is already in dones.\n${copies.length > 0 ? `Canonical docs synced:\n${copies.map((copy) => `  ${copy.destination}`).join("\n")}` : args.options["skip-specs"] ? "(--skip-specs: canonical docs not touched)" : "(no canonical docs synced)"}`,
    };
  }
  if (f.stage !== "review") {
    return {
      code: 1,
      stdout: `Cannot archive '${name}': feature is in stage "${f.stage}". Archive only from review (run: kf stage ${name} review first).`,
      stderr: "wrong stage",
    };
  }

  const force = Boolean(args.options.force);
  const forcedCodes: string[] = [];
  const check = validateFeature({ ...f, stage: "dones" });
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

  const afterHook = validateFeature({ ...f, stage: "dones" });
  if (!afterHook.valid && !force) return { code: 1, stdout: renderValidateText(afterHook), stderr: "gate failed" };
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };
  const recorded = recordBypasses(f.stage, "dones", forcedCodes, skippedHook);
  const bypasses = recorded.length > 0 ? [...(f.meta.bypasses ?? []), ...recorded] : f.meta.bypasses;
  if (f.context) assertPathName(f.context, "context");
  assertPathName(f.name, "feature");
  const copies = args.options["skip-specs"] ? [] : prepareCanonicalCopies(root.root, f);
  const originalMeta = readFileSync(join(f.dir, METADATA_FILE), "utf8");
  let moved = false;
  try {
    await rename(f.dir, target);
    moved = true;
    await writeCanonicalCopies(copies);
    await writeFeatureMeta(target, { ...f.meta, bypasses, status: "archived" });
  } catch (err) {
    if (!moved) throw err;
    const rollback = await Promise.allSettled([
      writeFileAtomic(join(target, METADATA_FILE), originalMeta),
      rollbackCanonicalCopies(copies),
    ]);
    const failures = rollback.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
    try {
      await rename(target, f.dir);
    } catch (rollbackError) {
      failures.push(rollbackError);
    }
    if (failures.length > 0) throw new AggregateError([err, ...failures], `Archive failed and rollback was incomplete for '${name}'.`);
    throw new Error(`Archive failed for '${name}'; feature restored to review.`, { cause: err });
  }

  return {
    code: 0,
    stdout:
      `✓ Archived '${name}'  review → dones\n  ${target}\n${copies.length > 0 ? `  Canonical docs synced:\n${copies.map((copy) => `    ${copy.destination}`).join("\n")}` : args.options["skip-specs"] ? "  (--skip-specs: canonical docs not touched)" : "  (no canonical docs synced)"}${bypassNote(recorded)}`,
  };
}
