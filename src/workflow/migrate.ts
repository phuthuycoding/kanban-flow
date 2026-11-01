import { existsSync, readdirSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { LEGACY_REOPEN_STAGE, METADATA_FILE, type LegacyStageName, type Stage } from "./schema.js";
import { parseFolderName, readFeatureMeta, stageDir, type FeatureMeta } from "./features.js";
import { archiveItem } from "./archive.js";
import { withLock } from "../shared/lock.js";
import { checkMergeGate } from "../integrations/github.js";
import { readProjectConfig } from "../project/config.js";
import { worktreeDirty } from "../worktree/manager.js";

export interface MigrationResult {
  /** One line per item moved, left in place or failed; empty when there was nothing legacy. */
  lines: string[];
  /** True when a move threw; the item stays where it was and its line names the cause. */
  failed: boolean;
}

const rel = (stage: string) => `.works/${stage}`;

interface LegacyItem {
  folder: string;
  dir: string;
  name: string;
  meta: FeatureMeta | null;
}

/** Folders under a legacy stage dir; an absent dir (already migrated, or never there) yields none. */
export function legacyFolders(root: string, legacy: LegacyStageName): string[] {
  const dir = join(root, ".works", legacy);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(dir).filter((folder) => statSync(join(dir, folder), { throwIfNoEntry: false })?.isDirectory()).sort();
}

/** Whether the migration treats a legacy folder as a work item: it has a .kfw.json or a timestamped name. */
export function isLegacyItemFolder(root: string, legacy: LegacyStageName, folder: string): boolean {
  return parseFolderName(folder).ts !== null || existsSync(join(root, ".works", legacy, folder, METADATA_FILE));
}

/** One folder read the way listFeatures reads a stage; null when it is not a work item. A corrupt .kfw.json throws. */
function readLegacyItem(root: string, legacy: LegacyStageName, folder: string): LegacyItem | null {
  if (!isLegacyItemFolder(root, legacy, folder)) return null;
  const dir = join(root, ".works", legacy, folder);
  const meta = readFeatureMeta(dir);
  return { folder, dir, name: meta?.feature ?? parseFolderName(folder).name, meta };
}

/** The item worktree when it exists and holds uncommitted work; null otherwise. */
function dirtyWorktree(meta: FeatureMeta | null): string | null {
  const path = meta?.worktree?.path;
  if (!path || !existsSync(path)) return null;
  return worktreeDirty(path) ? path : null;
}

/**
 * Rename one legacy folder into a current stage under the item lock. Returns false when the
 * source vanished meanwhile (another kf process migrated it), so nothing is reported twice.
 */
async function moveFolder(root: string, item: LegacyItem, to: Stage): Promise<boolean> {
  return withLock(root, item.name, async () => {
    if (!existsSync(item.dir)) return false;
    const target = join(stageDir(root, to), item.folder);
    if (existsSync(target)) throw new Error(`target already exists: ${target}`);
    await mkdir(stageDir(root, to), { recursive: true });
    await rename(item.dir, target);
    return true;
  });
}

/** Where a shipping item belongs: done when its recorded PR is verifiably merged, review otherwise. */
function shippingTarget(root: string, meta: FeatureMeta | null): { merged: boolean; note: string } {
  if (!meta?.pr) return { merged: false, note: "no PR recorded" };
  const result = checkMergeGate({ meta }, readProjectConfig(root).repository);
  if (result.kind !== "failed") return { merged: true, note: "PR merged" };
  const gate = result.failure;
  switch (gate.reason) {
    case "not-merged":
      return { merged: false, note: `PR ${gate.state.toLowerCase()}` };
    case "no-repository":
      return { merged: false, note: `PR ${gate.pr} unverifiable: no repository configured` };
    case "unverifiable":
      return { merged: false, note: `PR ${gate.pr} unverifiable: ${gate.detail}` };
    case "parse":
      return { merged: false, note: `PR ${gate.pr} unverifiable: unexpected gh output` };
  }
}

async function migrateShipping(root: string, item: LegacyItem): Promise<{ line: string; failed: boolean } | null> {
  const { merged, note } = shippingTarget(root, item.meta);
  // A merged item closes through the same archive transaction as any review item, so it
  // passes the review → done gates, the done hook and worktree teardown. archiveItem only
  // finds items in current stages, hence the move to review first.
  if (!(await moveFolder(root, item, LEGACY_REOPEN_STAGE.shipping))) return null;
  if (!merged) {
    return { line: `migrated ${item.folder}: ${rel("shipping")} → ${rel("review")} (${note})`, failed: false };
  }
  const outcome = await archiveItem(root, item.folder);
  switch (outcome.kind) {
    case "archived":
    case "reconciled":
      return { line: `migrated ${item.folder}: ${rel("shipping")} → ${rel("done")} (PR merged)`, failed: false };
    case "refused":
    case "hook-failed": {
      // A gate or direction refusal lists its checks on the lines below the heading; the codes name them on this one.
      const codes = outcome.kind === "refused" && outcome.codes?.length ? ` ${outcome.codes.join(", ")}` : "";
      return {
        line: `⚠ migrated ${item.folder}: ${rel("shipping")} → ${rel("review")} (PR merged, close refused: ${outcome.stdout.split("\n")[0]}${codes}) — fix it, then run kf archive ${item.name}`,
        failed: false,
      };
    }
    case "error": {
      const cause = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      return { line: `✗ migrated ${item.folder}: ${rel("shipping")} → ${rel("review")} (PR merged, close failed: ${cause})`, failed: true };
    }
  }
}

/** Files macOS drops into any folder it shows. Any other dotfile may be the user's, so it is never deleted. */
export const isOsLitter = (name: string): boolean => name === ".DS_Store" || name.startsWith("._");

const isFsError = (err: unknown): err is NodeJS.ErrnoException => err instanceof Error && typeof (err as NodeJS.ErrnoException).code === "string";

/** Runs one fs step; ENOENT means a concurrent kf process already removed the entry, which is the goal. */
function unlessGone(step: () => void): void {
  try {
    step();
  } catch (err) {
    if (!(isFsError(err) && err.code === "ENOENT")) throw err;
  }
}

/**
 * Drop a legacy stage dir once only OS litter is left in it, so later runs have nothing to look at.
 * A .DS_Store would otherwise keep the dir, and doctor's warning, forever. An fs failure is only a
 * failed cleanup, not a failed migration: it comes back as a ⚠ line and doctor keeps naming the dir.
 */
function removeIfEmpty(root: string, legacy: LegacyStageName): string | null {
  const dir = join(root, ".works", legacy);
  try {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return null;
    const entries = readdirSync(dir, { withFileTypes: true });
    if (!entries.every((e) => isOsLitter(e.name) && !e.isDirectory())) return null;
    for (const e of entries) unlessGone(() => unlinkSync(join(dir, e.name)));
    unlessGone(() => rmdirSync(dir));
  } catch (err) {
    if (!isFsError(err)) throw err;
    if (err.code === "ENOENT") return null;
    return `⚠ could not remove ${rel(legacy)}/: ${err.message} — remove it by hand`;
  }
  return null;
}

/**
 * One-time move of folders left by releases that had `dones` and `shipping` stages:
 * `dones/*` → `done/*`; `shipping/*` → `review/*`, or on to `done/*` through archiveItem when
 * the recorded PR is merged. The stage is the folder, so `.kfw.json` is not rewritten and its
 * history keeps the legacy names. An item with a dirty worktree, a live run, a clashing
 * target or an unreadable `.kfw.json` stays where it is and gets a line; everything else is untouched.
 */
export async function migrateLegacyStages(root: string): Promise<MigrationResult> {
  const lines: string[] = [];
  let failed = false;
  const legacyPlan: Array<[LegacyStageName, (item: LegacyItem) => Promise<{ line: string; failed: boolean } | null>]> = [
    ["dones", async (item) => (await moveFolder(root, item, LEGACY_REOPEN_STAGE.dones))
      ? { line: `migrated ${item.folder}: ${rel("dones")} → ${rel("done")}`, failed: false }
      : null],
    ["shipping", (item) => migrateShipping(root, item)],
  ];
  for (const [legacy, migrate] of legacyPlan) {
    for (const folder of legacyFolders(root, legacy)) {
      try {
        const item = readLegacyItem(root, legacy, folder);
        if (!item) continue;
        const dirty = dirtyWorktree(item.meta);
        if (dirty) {
          lines.push(`⚠ ${item.folder} left in ${rel(legacy)}: worktree has uncommitted changes (${dirty}) — commit or discard them, then re-run kf status --change ${item.name}`);
          continue;
        }
        const res = await migrate(item);
        if (!res) continue;
        lines.push(res.line);
        failed ||= res.failed;
      } catch (err) {
        lines.push(`✗ ${folder} left in ${rel(legacy)}: ${err instanceof Error ? err.message : String(err)} — repair or remove ${rel(legacy)}/${folder}`);
        failed = true;
      }
    }
    const cleanup = removeIfEmpty(root, legacy);
    if (cleanup) lines.push(cleanup);
  }
  return { lines, failed };
}
