import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { AmbiguousFeatureError, findFeature, listFeatures, type Feature } from "../workflow/features.js";
import { readItemLog, sharedMeta, syncItemLog, withItemId, type FoldResult, type ItemState } from "../workflow/item-log.js";
import { withLock } from "../shared/lock.js";
import { writeFileAtomic } from "../shared/paths.js";
import { jsonIndent } from "./config.js";
import { isFixFailure } from "./legacy-migration.js";
import type { DoctorFinding } from "./doctor-types.js";

const ACTION_UNREADABLE = "Fix or remove the line by hand; kf doctor --fix does not rewrite a log.";

const areaOf = (f: Feature): string => `${f.stage}/${f.folder}/lifecycle.jsonl`;

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The state the item's own files describe: its stage and the shared part of its metadata. */
function snapshot(f: Feature): ItemState {
  return { stage: f.stage, meta: sharedMeta(f.meta as object) } as ItemState;
}

/** Sorted names of the shared fields that differ, with `stage` first when the stage differs. */
function differingFields(logged: ItemState, current: ItemState): string[] {
  const a = logged.meta as unknown as Record<string, unknown>;
  const b = current.meta as unknown as Record<string, unknown>;
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !isDeepStrictEqual(a[key], b[key]))
    .sort();
  return logged.stage === current.stage ? names : ["stage", ...names];
}

/** An item's log read without letting a filesystem error escape. */
function tryRead(dir: string): FoldResult | { error: string } {
  try {
    return readItemLog(dir);
  } catch (err) {
    return { error: errorText(err) };
  }
}

/** One WARNING per item whose lifecycle log cannot be read or disagrees with its stage and metadata. */
export function checkItemLogs(root: string): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  for (const f of listFeatures(root)) {
    if (!f.meta) continue;
    const area = areaOf(f);
    const folded = tryRead(f.dir);
    if ("error" in folded) {
      findings.push({ level: "WARNING", area, message: `Lifecycle log of '${f.name}' cannot be read: ${folded.error}.`, action: ACTION_UNREADABLE });
    } else if (!folded.ok) {
      findings.push({ level: "WARNING", area, message: `Lifecycle log of '${f.name}' cannot be read: line ${folded.line} (${folded.reason}).`, action: ACTION_UNREADABLE });
    } else if (folded.state) {
      const names = differingFields(folded.state, snapshot(f));
      if (names.length > 0) {
        findings.push({ level: "WARNING", area, message: `Lifecycle log of '${f.name}' is behind its .kfw.json: ${names.join(", ")}.`, action: "kf doctor --fix" });
      }
    }
  }
  return findings;
}

// The run-state keys stripLegacyRunState removes (src/project/legacy-migration.ts LEGACY_META_KEYS, not exported).
const LEGACY_META_KEYS = ["drive", "runs", "sessions", "tasks"] as const;

/** Opens a missing log and reconciles a behind one, under each item's lock; an unparsable log is left alone. */
export async function repairItemLogs(root: string, fixed: string[], failures: DoctorFinding[]): Promise<void> {
  for (const listed of listFeatures(root)) {
    if (!listed.meta) continue;
    const area = areaOf(listed);
    const failure = (message: string, cause?: string): DoctorFinding =>
      ({ level: "ERROR", area, message, action: cause ? `${cause}; then re-run kf doctor --fix` : "kf doctor --fix" });
    try {
      await withLock(root, listed.name, async () => {
        const f = findFeature(root, listed.folder);
        if (!f?.meta) return;
        const file = join(f.dir, ".kfw.json");
        const text = readFileSync(file, "utf8");
        const raw = JSON.parse(text) as Record<string, unknown>;
        // An item still holding run-state keys is one the strip left alone on purpose; it has already been reported.
        if (LEGACY_META_KEYS.some((key) => Object.hasOwn(raw, key))) return;
        const before = tryRead(f.dir);
        if ("error" in before) {
          failures.push(failure(`Lifecycle log of '${f.name}' could not be written.`, before.error));
          return;
        }
        let verb: "opened" | "reconciled";
        if (!before.ok) return;
        else if (before.state === null) verb = "opened";
        else if (differingFields(before.state, snapshot(f)).length > 0) verb = "reconciled";
        else return;
        const meta = withItemId(f.meta, f.dir);
        if (meta !== f.meta) {
          await writeFileAtomic(file, `${JSON.stringify({ ...raw, id: meta.id }, null, jsonIndent(text))}${text.endsWith("\n") ? "\n" : ""}`);
        }
        const current = { stage: f.stage, meta: sharedMeta(meta) } as ItemState;
        syncItemLog(root, f.dir, f.name, current);
        const after = tryRead(f.dir);
        if (!("error" in after) && after.ok && after.state !== null && differingFields(after.state, current).length === 0) {
          fixed.push(`lifecycle log of ${f.name} ${verb}`);
        } else {
          failures.push({ ...failure(`Lifecycle log of '${f.name}' could not be written.`), area: areaOf(f) });
        }
      });
    } catch (err) {
      if (err instanceof AmbiguousFeatureError) {
        if (!failures.some((x) => x.area.startsWith(`${listed.stage}/${listed.folder}/`))) failures.push(failure(`Lifecycle log of '${listed.name}' was left unchanged: ${err.message}`));
        continue;
      }
      if (!isFixFailure(err)) throw err;
      failures.push(failure(`Lifecycle log of '${listed.name}' could not be written.`, err.message));
    }
  }
}
