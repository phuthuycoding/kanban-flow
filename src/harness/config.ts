import { STAGES, type Stage } from "../workflow/schema.js";

/** How kf learns the worker's session id after a `start` run. */
export type SessionCapture =
  | "provided"
  | { stdout: string }
  | { command: string[]; idField: string; matchField: string };

export interface RunnerConfig {
  /** argv for a fresh session; `{prompt}` required, `{session}` only with capture "provided". */
  start: string[];
  /** argv to continue a known session; must contain `{session}`. Absent = agent always starts fresh. */
  resume?: string[];
  session?: SessionCapture;
  /** "json": parse `usage.input_tokens/output_tokens` from JSON on stdout (claude, codex). */
  usage?: "json";
  /** Project-relative dir holding kanban-* skills for this runner; defaults per agent id. */
  skillsDir?: string;
  /** Regex on worker output that marks a failed resume (session gone); default built in. */
  resumeFailure?: string;
}

/** A job in the workflow (writer, coder, reviewer…) bound to the runner that is good at it. */
export interface RoleConfig {
  runner: string;
  /** One or two sentences describing the role, injected into the worker prompt. */
  brief?: string;
  /** Extra file this role must write, relative to the work item folder (e.g. research.md). */
  output?: string;
}

export interface HarnessConfig {
  /** Role the orchestrating agent plays. */
  main: string;
  roles: Record<string, RoleConfig>;
  /** Stage → roles to run in order. A single role is normalized to a one-element chain. */
  stages: Partial<Record<Stage, string[]>>;
  runners: Record<string, RunnerConfig>;
}

export const HARNESS_STAGES: Stage[] = STAGES.filter((s) => s !== "backlog");

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

type Fail = (field: string, why: string) => never;

function validateRunner(name: string, value: unknown, fail: Fail): RunnerConfig {
  const at = `harness.runners.${name}`;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(at, "must be an object");
  const r = value as Record<string, unknown>;
  if (!isStringArray(r.start) || r.start.length === 0) fail(`${at}.start`, "must be a non-empty array of strings");
  if (!r.start.some((a) => a.includes("{prompt}"))) fail(`${at}.start`, "must contain {prompt}");
  if (r.resume !== undefined) {
    if (!isStringArray(r.resume) || r.resume.length === 0) fail(`${at}.resume`, "must be a non-empty array of strings");
    if (!r.resume.some((a) => a.includes("{session}"))) fail(`${at}.resume`, "must contain {session}");
  }
  const session = r.session;
  if (session !== undefined && session !== "provided") {
    if (!session || typeof session !== "object") fail(`${at}.session`, 'must be "provided", { stdout } or { command, idField, matchField }');
    const s = session as Record<string, unknown>;
    if ("stdout" in s) {
      if (typeof s.stdout !== "string") fail(`${at}.session.stdout`, "must be a regex string");
    } else if (!isStringArray(s.command) || typeof s.idField !== "string" || typeof s.matchField !== "string") {
      fail(`${at}.session`, "command capture needs command[], idField, matchField");
    }
  }
  if (r.start.some((a) => a.includes("{session}")) && session !== "provided") {
    fail(`${at}.start`, '{session} is only allowed when session is "provided"');
  }
  if (r.usage !== undefined && r.usage !== "json") fail(`${at}.usage`, 'must be "json"');
  if (r.skillsDir !== undefined && typeof r.skillsDir !== "string") fail(`${at}.skillsDir`, "must be a string");
  if (r.resumeFailure !== undefined && typeof r.resumeFailure !== "string") fail(`${at}.resumeFailure`, "must be a regex string");
  return r as unknown as RunnerConfig;
}

function validateRole(name: string, value: unknown, runners: Record<string, RunnerConfig>, fail: Fail): RoleConfig {
  const at = `harness.roles.${name}`;
  const role: Record<string, unknown> = typeof value === "string" ? { runner: value } : { ...(value as object) };
  if (!value || (typeof value !== "string" && (typeof value !== "object" || Array.isArray(value)))) {
    fail(at, "must be a runner name or an object { runner, brief?, output? }");
  }
  if (typeof role.runner !== "string" || !role.runner) fail(`${at}.runner`, "must be a runner name");
  if (!(role.runner in runners)) fail(`${at}.runner`, `"${role.runner}" is not declared in harness.runners`);
  if (role.brief !== undefined && typeof role.brief !== "string") fail(`${at}.brief`, "must be a string");
  if (role.output !== undefined) {
    if (typeof role.output !== "string" || !role.output) fail(`${at}.output`, "must be a path relative to the work item folder");
    const output = role.output;
    if (output.startsWith("/") || output.split(/[/\\]/).includes("..")) fail(`${at}.output`, "must stay inside the work item folder");
  }
  return role as unknown as RoleConfig;
}

function validateChain(stage: string, value: unknown, roles: Record<string, RoleConfig>, runners: Record<string, RunnerConfig>, fail: Fail): string[] {
  const at = `harness.stages.${stage}`;
  const chain = typeof value === "string" ? [value] : value;
  if (!isStringArray(chain)) fail(at, "must be a role name or an array of role names");
  if (chain.length === 0) fail(at, "must list at least one role");
  const seen = new Set<string>();
  for (const role of chain) {
    if (!(role in roles)) {
      // The previous release let stages point straight at a runner; say so instead of "unknown role".
      if (role in runners) fail(at, `"${role}" is a runner, not a role; declare a role in harness.roles that points at it`);
      fail(at, `"${role}" is not a role. Known roles: ${Object.keys(roles).join(", ")}`);
    }
    if (seen.has(role)) fail(at, `lists role "${role}" twice; each role runs once per stage`);
    seen.add(role);
  }
  return chain;
}

/** Validate the `harness` block of .kf/config.json; throws with the offending field. */
export function validateHarness(value: unknown, file: string): HarnessConfig {
  const fail: Fail = (field, why) => {
    throw new Error(`Invalid project config: ${file} — ${field} ${why}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("harness", "must be an object");
  const h = value as Record<string, unknown>;
  if (!h.runners || typeof h.runners !== "object" || Array.isArray(h.runners)) fail("harness.runners", "must be an object");
  const runners: Record<string, RunnerConfig> = {};
  for (const [name, runner] of Object.entries(h.runners as Record<string, unknown>)) runners[name] = validateRunner(name, runner, fail);

  if (!h.roles || typeof h.roles !== "object" || Array.isArray(h.roles)) fail("harness.roles", "must be an object mapping role names to runners");
  const roles: Record<string, RoleConfig> = {};
  for (const [name, role] of Object.entries(h.roles as Record<string, unknown>)) roles[name] = validateRole(name, role, runners, fail);

  const main = typeof h.main === "string" ? h.main : "";
  if (!main) fail("harness.main", "must be a role name");
  if (!(main in roles)) {
    if (main in runners) fail("harness.main", `"${main}" is a runner, not a role; declare a role in harness.roles that points at it`);
    fail("harness.main", `"${main}" is not a role. Known roles: ${Object.keys(roles).join(", ")}`);
  }

  const stagesRaw = h.stages ?? {};
  if (!stagesRaw || typeof stagesRaw !== "object" || Array.isArray(stagesRaw)) fail("harness.stages", "must be an object");
  const stages: Partial<Record<Stage, string[]>> = {};
  for (const [stage, chain] of Object.entries(stagesRaw as Record<string, unknown>)) {
    if (!HARNESS_STAGES.includes(stage as Stage)) fail(`harness.stages.${stage}`, `is not an assignable stage (${HARNESS_STAGES.join(", ")})`);
    stages[stage as Stage] = validateChain(stage, chain, roles, runners, fail);
  }
  return { main, roles, stages, runners };
}

/**
 * Runner presets verified against each CLI's --help and a one-prompt smoke run
 * on 2026-09-19. gemini and opencode could not be verified for resume, so they
 * start fresh every time until the user adds a `resume` template.
 */
export function harnessPresets(): Record<string, RunnerConfig> {
  return {
    claude: {
      start: ["claude", "-p", "{prompt}", "--session-id", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
      resume: ["claude", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "acceptEdits", "--output-format", "json"],
      session: "provided",
      usage: "json",
    },
    codex: {
      start: ["codex", "exec", "--json", "{prompt}"],
      resume: ["codex", "exec", "resume", "{session}", "{prompt}"],
      session: { stdout: "\"thread_id\":\"([^\"]+)\"" },
      usage: "json",
    },
    devin: {
      start: ["devin", "-p", "{prompt}", "--permission-mode", "accept-edits"],
      resume: ["devin", "-p", "{prompt}", "-r", "{session}", "--permission-mode", "accept-edits"],
      session: { command: ["devin", "list", "--format", "json"], idField: "id", matchField: "title" },
    },
    gemini: {
      start: ["gemini", "-p", "{prompt}", "--approval-mode", "auto_edit"],
    },
    opencode: {
      start: ["opencode", "run", "{prompt}"],
    },
  };
}

/** Default roles: the jobs a kanban pipeline actually has, all pointing at one runner until the user splits them. */
export const ROLE_BRIEFS: Record<string, string> = {
  architect: "Orchestrates the pipeline and keeps the human gates. Decides transitions; does not do a stage's work when that stage has its own role.",
  researcher: "Explores breadth: prior art, libraries, existing code paths, comparable features. Reports findings and trade-offs; does not design or write the spec.",
  writer: "Turns agreed decisions into precise prose that follows the template exactly. Adds no scope of its own.",
  coder: "Implements the approved plan and keeps the build green. Changes nothing outside the approved contract.",
  tester: "Runs the real test suite against the approved test cases and records evidence with exact commands and exit codes. Never claims a result it did not observe.",
  reviewer: "Audits the diff against the contract and the review rules, hunting for failures the author would not see. Reproduces plausible failures instead of guessing.",
};

export function seedHarness(agents: string[]): HarnessConfig {
  const runners = harnessPresets();
  const runner = agents.find((a) => a in runners) ?? "claude";
  const roles = Object.fromEntries(Object.entries(ROLE_BRIEFS).map(([name, brief]) => [name, { runner, brief }]));
  return { main: "architect", roles, stages: {}, runners };
}
