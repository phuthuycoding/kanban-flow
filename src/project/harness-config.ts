export interface HarnessConfig {
  /** Verification argv lists kf runs without a shell; set only by a human in .kf/config.json. */
  verify?: { task?: string[][]; stage?: string[][] };
}

/** Keys the removed drive runtime read. They are ignored on load; only `kf doctor --fix` deletes them. */
export const LEGACY_HARNESS_KEYS = ["main", "roles", "stages", "runners", "parallel", "retries", "maxLoops", "budget"] as const;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

type Fail = (field: string, why: string) => never;

function validateArgvList(at: string, value: unknown, fail: Fail): void {
  if (!Array.isArray(value)) fail(at, "must be an array of argv arrays, e.g. [[\"npm\", \"test\"]]");
  value.forEach((argv, i) => {
    const here = `${at}[${i}]`;
    if (!isStringArray(argv) || argv.length === 0) fail(here, "must be a non-empty argv array of strings");
    if (argv.some((a) => a === "")) fail(here, "must not contain an empty string");
    if (argv[0].startsWith("-")) fail(here, "must not start with an option (first element begins with -)");
    if (argv.some((a) => /\{[^}]*\}/.test(a))) fail(here, "must not contain {…} placeholders");
  });
}

/**
 * Validate the `harness` block of .kf/config.json; throws with the offending field. Only `verify` is
 * checked. Every other key is carried through unvalidated: init writes this object back, so dropping
 * or rejecting a legacy key here would erase it or block every command before `kf doctor --fix` runs.
 */
export function validateHarness(value: unknown, file: string): HarnessConfig {
  const fail: Fail = (field, why) => {
    throw new Error(`Invalid project config: ${file} — ${field} ${why}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("harness", "must be an object");
  const h = value as Record<string, unknown>;
  if (h.verify !== undefined) {
    if (!h.verify || typeof h.verify !== "object" || Array.isArray(h.verify)) fail("harness.verify", "must be an object { task?, stage? }");
    const v = h.verify as Record<string, unknown>;
    if (v.task !== undefined) validateArgvList("harness.verify.task", v.task, fail);
    if (v.stage !== undefined) validateArgvList("harness.verify.stage", v.stage, fail);
  }
  return h as HarnessConfig;
}
