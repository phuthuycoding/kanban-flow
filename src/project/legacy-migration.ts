import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isPidAlive } from "../shared/process.js";
import { AmbiguousFeatureError, findFeature, listFeatures } from "../workflow/features.js";
import { LEGACY_HARNESS_KEYS } from "./harness-config.js";
import { writeFileAtomic } from "../shared/paths.js";
import { LockTimeoutError, withLock } from "../shared/lock.js";
import { jsonIndent } from "./config.js";
import type { DoctorFinding } from "./doctor-types.js";

/** The harness keys of the removed drive runtime still in the raw file; they load as ignored, so only doctor names them. */
export function legacyHarnessKeys(harness: unknown): string[] {
  if (!harness || typeof harness !== "object" || Array.isArray(harness)) return [];
  return LEGACY_HARNESS_KEYS.filter((key) => Object.hasOwn(harness, key));
}

export function checkHarnessLegacyKeys(raw: Record<string, unknown> | null): DoctorFinding[] {
  return legacyHarnessKeys(raw?.harness).map((key) => ({
    level: "WARNING" as const,
    area: ".kf/config.json",
    message: `harness_legacy_key: harness.${key} belonged to the removed task harness runtime and is ignored.`,
    action: `kf doctor --fix (removes harness.${key})`,
  }));
}

/** Remove the legacy harness keys from a raw config in place; returns the fix line, or null when there were none. */
export function removeLegacyHarnessKeys(raw: Record<string, unknown>): string | null {
  const keys = legacyHarnessKeys(raw.harness);
  if (keys.length === 0) return null;
  const harness = raw.harness as Record<string, unknown>;
  for (const key of keys) delete harness[key];
  if (Object.keys(harness).length === 0) delete raw.harness;
  return `removed legacy harness keys: ${keys.map((k) => `harness.${k}`).join(", ")}`;
}

/** Item meta keys the removed drive runtime wrote; they pass through every other write untouched. */
const LEGACY_META_KEYS = ["drive", "runs", "sessions", "tasks"] as const;

/** Pids a pre-upgrade supervisor or worker recorded that still exist. kf never signals them. */
function liveLegacyPids(meta: Record<string, unknown>): number[] {
  const pids: unknown[] = [(meta.drive as { supervisorPid?: unknown } | undefined)?.supervisorPid];
  if (Array.isArray(meta.runs)) pids.push(...meta.runs.map((r) => (r as { pid?: unknown } | null)?.pid));
  const numeric = pids.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0);
  return [...new Set(numeric)].filter((pid) => isPidAlive(pid));
}

export function checkLegacyRunState(root: string): DoctorFinding[] {
  return listFeatures(root).flatMap((f) => {
    const meta = f.meta as unknown as Record<string, unknown> | null;
    if (!meta) return [];
    const keys = LEGACY_META_KEYS.filter((key) => Object.hasOwn(meta, key));
    if (keys.length === 0) return [];
    const live = liveLegacyPids(meta);
    const liveNote = live.length > 0
      ? ` Pid ${live.join(", ")} recorded there is still alive: stop this process yourself before closing the item, or its worktree is torn down under it.`
      : "";
    return [{
      level: "WARNING" as const,
      area: `${f.stage}/${f.folder}`,
      message: `meta_legacy_run_state: .kfw.json still holds ${keys.join(", ")} from the removed task harness runtime.${liveNote}`,
      action: live.length > 0
        ? `stop pid ${live.join(", ")}, then kf doctor --fix`
        : `kf doctor --fix (removes ${keys.join(", ")} from .kfw.json; it never stops a process)`,
    }];
  });
}

/** A failure --fix reports and moves past: bad JSON, a file-system error, or an item lock it could not take. */
export function isFixFailure(err: unknown): err is Error {
  return err instanceof SyntaxError || err instanceof LockTimeoutError || (err instanceof Error && "code" in err);
}

export function fixFailure(area: string, err: Error): DoctorFinding {
  return {
    level: "ERROR",
    area,
    message: `kf doctor --fix could not rewrite this file and left it unchanged: ${err.message}`,
    action: `repair ${area} by hand (or its permissions), then re-run kf doctor --fix`,
  };
}

/**
 * Remove the drive runtime's leftover keys from every item's .kfw.json, under the item lock and with
 * an atomic write like every other meta write. A file that cannot be written, an item whose name is
 * ambiguous, and an item naming a live pid become ERROR findings and are left as they were; the
 * other items are still fixed.
 */
export async function stripLegacyRunState(root: string, fixed: string[], failures: DoctorFinding[]): Promise<void> {
  for (const listed of listFeatures(root)) {
    const area = `${listed.stage}/${listed.folder}/.kfw.json`;
    try {
      await withLock(root, listed.name, async () => {
        // Re-found inside the lock: a stage move may have renamed the folder since it was listed.
        const f = findFeature(root, listed.folder);
        if (!f) return;
        const file = join(f.dir, ".kfw.json");
        if (!existsSync(file)) return;
        const text = readFileSync(file, "utf8");
        let meta: unknown;
        try {
          meta = JSON.parse(text);
        } catch (err) {
          // runDoctor reports this item as unreadable metadata with the parse error; a second ERROR would repeat it.
          if (err instanceof SyntaxError) return;
          throw err;
        }
        if (!meta || typeof meta !== "object" || Array.isArray(meta)) return;
        const keys = LEGACY_META_KEYS.filter((key) => Object.hasOwn(meta, key));
        if (keys.length === 0) return;
        const live = liveLegacyPids(meta as Record<string, unknown>);
        if (live.length > 0) {
          failures.push({
            level: "ERROR",
            area: `${f.stage}/${f.folder}/.kfw.json`,
            message: `kf doctor --fix left ${keys.join(", ")} in place: pid ${live.join(", ")} recorded there is still alive — stop it yourself first.`,
            action: `stop pid ${live.join(", ")}, then re-run kf doctor --fix`,
          });
          return;
        }
        for (const key of keys) delete (meta as Record<string, unknown>)[key];
        await writeFileAtomic(file, `${JSON.stringify(meta, null, jsonIndent(text))}${text.endsWith("\n") ? "\n" : ""}`);
        fixed.push(`removed ${keys.join(", ")} from ${f.stage}/${f.folder}/.kfw.json`);
      });
    } catch (err) {
      if (err instanceof AmbiguousFeatureError) {
        failures.push({ level: "ERROR", area, message: `kf doctor --fix left this file unchanged: ${err.message}`, action: `rename one of the clashing item folders, then re-run kf doctor --fix` });
        continue;
      }
      if (!isFixFailure(err)) throw err;
      failures.push(fixFailure(area, err));
    }
  }
}
