import { findWorksRoot, findFeature } from "../workflow/features.js";
import type { ParsedArgs } from "./args.js";
import type { CmdResult } from "./result.js";

/**
 * Kind gate for `kf feature|bug <verb>` paths: the verb's target must match the noun.
 * Missing items and verbless noun paths are left for the handler's own errors.
 */
export function nounKindGate(parsed: ParsedArgs, cwd: string): CmdResult | null {
  if (parsed.command === "new") {
    const type = parsed.options.type;
    if (type !== undefined && type !== parsed.noun) {
      return { code: 1, stdout: `kf ${parsed.noun} start implies --type ${parsed.noun} — got --type ${String(type)}.`, stderr: "kind mismatch" };
    }
    return null;
  }
  const name = parsed.positionals[0];
  if (!name) return null;
  const root = findWorksRoot(cwd);
  if (!root) return null;
  const f = findFeature(root, name);
  if (!f?.meta) return null;
  const kind = f.meta.kind ?? "feature";
  if (kind !== parsed.noun) {
    return { code: 1, stdout: `'${name}' is a ${kind} — use 'kf ${kind} ...' for it.`, stderr: "kind mismatch" };
  }
  return null;
}
