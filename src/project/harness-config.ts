export interface HarnessConfig {
  /** Verification argv lists kf runs without a shell; set only by a human in .kf/config.json. */
  verify?: { task?: string[][]; stage?: string[][]; related?: string[] };
  /** Ceiling on parallel developer seats in the task loop; the loop starts lower and steps up to it. */
  developers?: { max?: number };
}

export const DEFAULT_DEVELOPER_MAX = 6;

/** Keys the removed drive runtime read. They are ignored on load; only `kf doctor --fix` deletes them. */
export const LEGACY_HARNESS_KEYS = ["main", "roles", "stages", "runners", "parallel", "retries", "maxLoops", "budget"] as const;

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

type Fail = (field: string, why: string) => never;

function validateArgv(here: string, argv: unknown, fail: Fail): asserts argv is string[] {
  if (!isStringArray(argv) || argv.length === 0) fail(here, "must be a non-empty argv array of strings");
  if (argv.some((a) => a === "")) fail(here, "must not contain an empty string");
  if (argv[0].startsWith("-")) fail(here, "must not start with an option (first element begins with -)");
  if (argv.some((a) => /\{[^}]*\}/.test(a))) fail(here, "must not contain {…} placeholders");
}

function validateArgvList(at: string, value: unknown, fail: Fail): void {
  if (!Array.isArray(value)) fail(at, "must be an array of argv arrays, e.g. [[\"npm\", \"test\"]]");
  value.forEach((argv, i) => validateArgv(`${at}[${i}]`, argv, fail));
}

/**
 * Validate the `harness` block of .kf/config.json; throws with the offending field. Only `verify` and
 * `developers` are checked. Every other key is carried through unvalidated: init writes this object back, so dropping
 * or rejecting a legacy key here would erase it or block every command before `kf doctor --fix` runs.
 */
export function validateHarness(value: unknown, file: string): HarnessConfig {
  const fail: Fail = (field, why) => {
    throw new Error(`Invalid project config: ${file} — ${field} ${why}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("harness", "must be an object");
  const h = value as Record<string, unknown>;
  if (h.verify !== undefined) {
    if (!h.verify || typeof h.verify !== "object" || Array.isArray(h.verify)) fail("harness.verify", "must be an object { task?, stage?, related? }");
    const v = h.verify as Record<string, unknown>;
    if (v.task !== undefined) validateArgvList("harness.verify.task", v.task, fail);
    if (v.stage !== undefined) validateArgvList("harness.verify.stage", v.stage, fail);
    if (v.related !== undefined) validateArgv("harness.verify.related", v.related, fail);
  }
  if (h.developers !== undefined) {
    if (!h.developers || typeof h.developers !== "object" || Array.isArray(h.developers)) fail("harness.developers", "must be an object { max? }");
    const max = (h.developers as Record<string, unknown>).max;
    if (max !== undefined && (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > 16)) {
      fail("harness.developers.max", "must be an integer from 1 to 16");
    }
  }
  return h as HarnessConfig;
}
