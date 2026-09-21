import { listFeatures } from "../workflow/features.js";
import type { ProjectConfig } from "./config.js";

/** Fallback when neither `contexts` nor `defaultContext` is set. Matches the historical default. */
export const FALLBACK_CONTEXT = "app";

/**
 * Contexts are compared case-insensitively when suggesting a correction: `assertPathName` accepts
 * `Auth`, but on a case-sensitive filesystem that would be a second docs tree next to `auth`.
 */
export function normalizeContext(context: string): string {
  return context.trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  // Single-row dynamic programming; the strings here are short context names.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Nearest declared context, or null when nothing is close enough. A suggestion is always a verbatim
 * element of `declared`, so following one is always accepted by `checkContext`.
 */
export function suggestContext(input: string, declared: string[]): string | null {
  const target = normalizeContext(input);
  let best: { name: string; distance: number } | null = null;
  for (const name of declared) {
    const candidate = normalizeContext(name);
    // Budget from the longer of the two, so dropping characters does not shrink the allowance:
    // keyed off the typo alone, "au" would be further from "auth" than "biling" is from "billing".
    const span = Math.max(target.length, candidate.length);
    const budget = Math.min(3, Math.max(1, Math.ceil(span / 3)));
    const distance = levenshtein(target, candidate);
    // The two must still share something: "b" and "a" are one edit apart and wholly unrelated.
    if (distance <= budget && distance < span && (best === null || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name ?? null;
}

/**
 * The default context the config actually states, or null when it states none. `contexts` declares
 * it by position, so there is no second field to drift out of sync and no config shape whose
 * default its own guard rejects.
 */
export function declaredDefaultContext(cfg: Partial<ProjectConfig>): string | null {
  if (cfg.contexts && cfg.contexts.length > 0) return cfg.contexts[0];
  return cfg.defaultContext ?? null;
}

/** The default context to act on, falling back to the historical value. */
export function effectiveDefaultContext(cfg: Partial<ProjectConfig>): string {
  return declaredDefaultContext(cfg) ?? FALLBACK_CONTEXT;
}

export interface ContextCheck {
  ok: boolean;
  suggestion: string | null;
  declared: string[];
}

/** Check a context against the declared list. An undeclared project is unrestricted, as before. */
export function checkContext(context: string, cfg: Partial<ProjectConfig>): ContextCheck {
  const declared = cfg.contexts;
  if (!declared || declared.length === 0) return { ok: true, suggestion: null, declared: [] };
  if (declared.includes(context)) return { ok: true, suggestion: null, declared };
  // A case-only difference is refused rather than folded: accepting `Auth` would create a second
  // directory beside `auth` on a case-sensitive filesystem, which is the whole point of the list.
  // No special case is needed for it: after normalising, the same name sits at distance 0, which
  // no other candidate can beat, so suggestContext already returns exactly it.
  return { ok: false, suggestion: suggestContext(context, declared), declared };
}

/** Human-readable refusal naming the input, the nearest declared name, and the whole list. */
export function contextRefusal(context: string, check: ContextCheck): string {
  const lines = [`"${context}" is not a declared context.`];
  if (check.suggestion) lines.push(`  Did you mean "${check.suggestion}"?`);
  lines.push(`  Declared: ${check.declared.join(", ")}`);
  lines.push("  Add one by editing contexts in .kf/config.json");
  return lines.join("\n");
}

/**
 * Contexts that work items actually use on disk, with a count each, busiest first.
 *
 * Grouped by the exact spelling, not a folded one. `Legacy` and `legacy` are two directories and
 * therefore two rows: collapsing them would hide the case drift this feature exists to surface,
 * and would make the surviving spelling depend on folder sort order. Callers compare exactly.
 */
export function contextsInUse(root: string): Array<{ context: string; count: number }> {
  const counts = new Map<string, number>();
  for (const f of listFeatures(root)) {
    if (!f.context) continue;
    counts.set(f.context, (counts.get(f.context) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([context, count]) => ({ context, count }))
    .sort((a, b) => b.count - a.count || a.context.localeCompare(b.context));
}
