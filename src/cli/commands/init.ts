import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { STAGES } from "../../workflow/schema.js";
import { assertPathName, ensureWorksStructure } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
import { parseAgentIds } from "../../integrations/agents.js";
import { installProjectSkills } from "../../integrations/install.js";
import { bootstrapDefaults, promptAnswers, seedOverrides, saveConfig, appendIgnoreWorks, type BootstrapAnswers } from "../../project/bootstrap.js";
import { cmdNew } from "./new.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdInit(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const target = resolve(cwd, args.positionals[0] ?? ".");
  const agents = parseAgentIds(args.options.agent);
  if (typeof args.options.context === "string") assertPathName(args.options.context, "context");

  const interactive = Boolean(args.options.interactive);
  const useDefaults = Boolean(args.options.defaults);

  if (interactive || useDefaults) {
    return cmdBootstrap(args, target, interactive);
  }

  const cfg = readProjectConfig(target);
  const ctx = typeof args.options.context === "string" ? args.options.context : cfg.defaultContext ?? "app";
  ensureWorksStructure(target);
  await mkdir(join(target, ".kf", "templates"), { recursive: true });
  await mkdir(join(target, ".kf", "hooks"), { recursive: true });
  await mkdir(join(target, ".kf", "review", "rules"), { recursive: true });
  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, ctx), { recursive: true });
  }
  const skills = await installProjectSkills(target, agents.length ? agents : parseAgentIds(cfg.agents));
  if (skills.code !== 0) return skills;
  return {
    code: 0,
    stdout: `✓ Initialized kaban-flow in ${target}\n  .works/{${STAGES.join(",")}}\n  docs/{requirement,use-cases,testplan}/${ctx}\n  .kf/templates (project overrides)\n  .kf/hooks (phase hooks, e.g. hooks/planning.sh)\n  .kf/review/rules (project review rules)\n\n${skills.stdout}`,
  };
}

async function cmdBootstrap(args: ParsedArgs, target: string, interactive: boolean): Promise<CmdResult> {
  const tty = process.stdin.isTTY && process.stdout.isTTY;

  let answers: BootstrapAnswers;
  if (interactive && !tty) {
    answers = bootstrapDefaults(target, typeof args.options.context === "string" ? args.options.context : undefined);
  } else if (interactive) {
    answers = await promptAnswers(target, typeof args.options.context === "string" ? args.options.context : undefined);
  } else {
    answers = bootstrapDefaults(target, typeof args.options.context === "string" ? args.options.context : undefined);
  }

  const flagged = parseAgentIds(args.options.agent);
  if (flagged.length > 0) answers.agents = flagged;

  assertPathName(answers.defaultContext, "context");
  ensureWorksStructure(target);
  await seedOverrides(target);
  saveConfig(target, answers);
  const skills = await installProjectSkills(target, answers.agents);
  if (skills.code !== 0) return skills;

  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, answers.defaultContext), { recursive: true });
  }

  const out: string[] = [];
  out.push(`✓ Bootstrapped kaban-flow in ${target}${interactive && !tty ? " (non-interactive: using defaults)" : ""}`);
  out.push(`  .works/{${STAGES.join(",")}}`);
  out.push(`  context: ${answers.defaultContext}   stack: ${answers.stack ?? "unset"}   reviewer: ${answers.reviewer}`);
  out.push(`  agents: ${answers.agents.join(", ")}`);
  out.push(`  .kf/config.json (defaults for new features)`);
  out.push(`  .kf/{templates,hooks,review/rules} seeded from package`);
  out.push(skills.stdout);

  if (answers.ignoreWorks) {
    appendIgnoreWorks(target);
    out.push(`  .gitignore: added .works/`);
  }
  if (answers.seedFeature) {
    const seed = await cmdNew(
      { command: "new", positionals: ["demo"], options: { context: answers.defaultContext } },
      target,
    );
    if (seed.code !== 0) return seed;
    out.push(`  seeded demo feature → brainstorm`);
  }
  return { code: 0, stdout: out.join("\n") };
}
