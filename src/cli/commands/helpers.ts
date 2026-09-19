import { findWorksRoot, type Bypass } from "../../workflow/features.js";
import type { Stage } from "../../workflow/schema.js";
import type { HookSource } from "../../integrations/hooks.js";
import { nowTimestamp } from "../../shared/time.js";

export async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
}

/** Build the audit records for this transition: only bypasses that actually skipped something are recorded. */
export function recordBypasses(
  from: Stage | null,
  to: Stage,
  forcedCodes: string[],
  skippedHook: HookSource | null,
): Bypass[] {
  const at = nowTimestamp();
  const records: Bypass[] = [];
  if (forcedCodes.length > 0) records.push({ at, from, to, flag: "force", codes: [...new Set(forcedCodes)] });
  if (skippedHook) records.push({ at, from, to, flag: "skip-hooks", codes: [`hook:${skippedHook.path}`] });
  return records;
}

export function bypassNote(recorded: Bypass[]): string {
  return recorded.map((b) => `\n  ⚠ Bypass recorded: --${b.flag} (${b.codes.join(", ")})`).join("");
}
