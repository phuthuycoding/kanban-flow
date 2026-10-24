import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, type Feature, type FeatureMeta } from "../../workflow/features.js";
import { ARTIFACTS, type Stage, type WorkItemKind } from "../../workflow/schema.js";
import { cmdNew } from "../../cli/commands/new.js";
import { cmdStage } from "../../cli/commands/stage.js";
import { cmdApprove } from "../../cli/commands/approve.js";
import { skillsDirFor } from "../../integrations/agents.js";
import { STAGE_SKILL } from "../../harness/prompt.js";
import type { ParsedArgs } from "../../cli/args.js";
import type { RoleConfig } from "../../harness/config.js";
import { DEFAULT_ROLES, harnessWith } from "./harness-fixture.js";
import { fakeCli, type FakeCall, type FakeCli } from "./fake-cli.js";

export interface DriveTask {
  id: string;
  description?: string;
  area?: string;
  /** Task ids, rendered comma-separated; "-" when empty. */
  deps?: string[];
  expected?: string;
  refs?: string;
  role?: string;
  /** Declared file allowlist, rendered comma-separated; "-" when empty. */
  files?: string[];
}

export interface GitDriveOptions {
  kind?: WorkItemKind;
  tasks: DriveTask[];
  /** Move the approved item to implementation (creates the item worktree). Default true. */
  implementation?: boolean;
  /** Replaces the default `{ stage: [["true"]] }`. Written verbatim, so it works before `harness.verify` is validated. */
  verify?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  roles?: Record<string, RoleConfig>;
  stages?: Record<string, string[]>;
  agents?: string[];
}

export interface GitDriveProject {
  /** Physical path of the git repository (the project root). */
  root: string;
  /** Temp dir holding the repo, worktrees and routes file. */
  scratch: string;
  cli: FakeCli;
  /** Environment for spawning the CLI with the fakes first on PATH and a git identity. */
  env: NodeJS.ProcessEnv;
  feature: () => Feature;
  itemDir: () => string;
  /** The item worktree; null until the item has entered implementation. */
  worktreePath: () => string | null;
  readMeta: () => FeatureMeta | null;
  git: (dir: string, ...args: string[]) => string;
  calls: (name: string) => FakeCall[];
  /** Re-run the real approve/stage commands, e.g. after rewriting the plan. */
  stage: (to: Stage) => Promise<void>;
  /** Overwrite the implementation plan with a fresh task table, keeping the rest of the contract. */
  writePlan: (tasks: DriveTask[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

export const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

/** The implementation-plan body: a Task Breakdown table built from the caller's tasks. */
export function planWithTasks(tasks: DriveTask[]): string {
  const list = (v: string[] | undefined) => (v && v.length ? v.join(", ") : "-");
  const rows = tasks.map((t) =>
    `| ${t.id} | ${t.description ?? `Do ${t.id}`} | ${t.area ?? "Core"} | ${list(t.deps)} | ${t.expected ?? "Change merged"} | ${t.refs ?? "FR-001 / UC-001"} | ${t.role ?? "coder"} | ${list(t.files)} |`);
  return `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${rows.join("\n")}\n`;
}

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n";

/**
 * The "Drive fixture": a git-backed temp project (local identity, `.works/` ignored, one commit),
 * worktrees enabled with baseDir/routesFile inside the temp dir, fake agent CLIs on PATH, and an
 * approved item `demo` carrying the caller's task table. Built with the real new/stage/approve commands.
 */
export async function gitDriveProject(opts: GitDriveOptions): Promise<GitDriveProject> {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-drive-")));
  const root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  const git = (...a: string[]) => gitIn(root, ...a);
  git("init", "-q");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);

  const agents = opts.agents ?? ["claude", "gemini", "devin", "codex", "opencode"];
  const cli = fakeCli(scratch, agents);
  const restorePath = cli.install();
  const harness = {
    ...harnessWith((opts.stages ?? { implementation: ["coder"], testing: ["tester"] }) as never, { ...DEFAULT_ROLES, ...opts.roles }),
    verify: opts.verify ?? { stage: [["true"]] },
    ...opts.limits,
  };
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    worktree: { enabled: true, baseDir: join(scratch, "wt"), routesFile: join(scratch, "routes.json") },
    harness,
  }, null, 2));
  for (const agent of agents) {
    for (const skill of Object.values(STAGE_SKILL)) {
      if (!skill) continue;
      const dir = join(skillsDirFor(agent, root), skill);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${skill}`);
    }
  }

  const name = "demo";
  const kind = opts.kind ?? "feature";
  const feature = () => findFeature(root, name)!;
  const writeArtifact = (id: keyof typeof ARTIFACTS, body: string) => writeFile(join(feature().dir, ARTIFACTS[id].file), body);
  const stage = async (to: Stage): Promise<void> => {
    const res = await cmdStage(args("stage", [name, to]), root);
    if (res.code !== 0) throw new Error(`kf stage ${to} failed: ${res.stdout}${res.stderr ?? ""}`);
  };
  const writePlan = (tasks: DriveTask[]) => writeArtifact("implementation-plan", planWithTasks(tasks));

  const created = await cmdNew(args("new", [name], { context: "app", ...(kind === "bug" ? { type: "bug" } : {}) }), root);
  if (created.code !== 0) throw new Error(`kf new failed: ${created.stdout}`);
  await writeArtifact("spec-requirement", kind === "bug" ? bugSpec : spec);
  await stage("planning");
  await writePlan(opts.tasks);
  if (kind === "feature") {
    for (const id of ["use-case-specification", "use-case-diagram"] as const) await writeArtifact(id, "# Contract\nUC-001: Create a task");
    await mkdir(join(feature().dir, "use-cases"), { recursive: true });
    await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
    await writeArtifact("test-cases", "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  }
  const approved = await cmdApprove(args("approve", [name]), root);
  if (approved.code !== 0) throw new Error(`kf approve failed: ${approved.stdout}${approved.stderr ?? ""}`);
  if (opts.implementation ?? true) await stage("implementation");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  return {
    root, scratch, cli, env, feature,
    itemDir: () => feature().dir,
    worktreePath: () => feature().meta?.worktree?.path ?? null,
    readMeta: () => readFeatureMeta(feature().dir),
    git: gitIn,
    calls: (n) => cli.calls(n),
    stage,
    writePlan,
    cleanup: async () => {
      restorePath();
      cli.resetScenarios();
      await rm(scratch, { recursive: true, force: true });
    },
  };
}
