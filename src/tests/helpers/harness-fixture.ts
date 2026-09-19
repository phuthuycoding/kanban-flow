import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta, type Feature } from "../../workflow/features.js";
import type { Stage } from "../../workflow/schema.js";
import { harnessPresets, type HarnessConfig, type RoleConfig } from "../../harness/config.js";
import { skillsDirFor } from "../../integrations/agents.js";
import { STAGE_SKILL } from "../../harness/prompt.js";
import { fakeCli, type FakeCli } from "./fake-cli.js";

export interface HarnessProject {
  root: string;
  cli: FakeCli;
  feature: (name?: string) => Feature;
  writeHarness: (harness: HarnessConfig) => Promise<void>;
  addFeature: (name: string, stage: Stage, extra?: Record<string, unknown>) => Promise<string>;
  cleanup: () => Promise<void>;
}

export const DEFAULT_ROLES: Record<string, RoleConfig> = {
  architect: { runner: "claude", brief: "Orchestrates the pipeline." },
  researcher: { runner: "codex", brief: "Explores breadth.", output: "research.md" },
  writer: { runner: "gemini", brief: "Writes precise prose." },
  coder: { runner: "claude", brief: "Implements the plan." },
  tester: { runner: "gemini", brief: "Runs the suite." },
  reviewer: { runner: "codex", brief: "Audits the diff." },
};

export const DEFAULT_STAGES: HarnessConfig["stages"] = { testing: ["tester"], implementation: ["coder"] };

/** Build a harness with the fixture roles, overriding stages, roles and runners as needed. */
export function harnessWith(
  stages: HarnessConfig["stages"],
  roles: Record<string, RoleConfig> = {},
  runners: HarnessConfig["runners"] = {},
): HarnessConfig {
  return { main: "architect", roles: { ...DEFAULT_ROLES, ...roles }, stages, runners: { ...harnessPresets(), ...runners } };
}

/** A temp project with a harness config, a work item, worker skills and fake agent CLIs on PATH. */
export async function harnessProject(opts: { stage?: Stage; stages?: HarnessConfig["stages"]; roles?: Record<string, RoleConfig>; agents?: string[] } = {}): Promise<HarnessProject> {
  const root = await mkdtemp(join(tmpdir(), "kf-harness-"));
  ensureWorksStructure(root);
  const agents = opts.agents ?? ["claude", "gemini", "devin", "codex", "opencode"];
  const cli = fakeCli(root, agents);
  const restorePath = cli.install();
  const writeHarness = async (harness: HarnessConfig): Promise<void> => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20260919_1200", defaultContext: "app", harness }, null, 2));
  };
  await writeHarness(harnessWith(opts.stages ?? DEFAULT_STAGES, opts.roles));
  for (const agent of agents) {
    for (const skill of Object.values(STAGE_SKILL)) {
      if (!skill) continue;
      const dir = join(skillsDirFor(agent, root), skill);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), `# ${skill}`);
    }
  }
  const addFeature = async (name: string, stage: Stage, extra: Record<string, unknown> = {}): Promise<string> => {
    const dir = join(root, ".works", stage, `${name}_20260919_1200`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\nFR-001 real");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", ...extra });
    return dir;
  };
  await addFeature("demo", opts.stage ?? "testing");
  return {
    root,
    cli,
    feature: (name = "demo") => findFeature(root, name)!,
    writeHarness,
    addFeature,
    cleanup: async () => {
      restorePath();
      cli.resetScenarios();
      await rm(root, { recursive: true, force: true });
    },
  };
}
