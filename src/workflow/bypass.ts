import type { Bypass } from "./features.js";
import type { Stage } from "./schema.js";
import type { HookSource } from "../integrations/hooks.js";
import { nowTimestamp } from "../shared/time.js";

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
