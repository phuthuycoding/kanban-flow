import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { STAGES } from "../../workflow/schema.js";
import { assertPathName, ensureWorksStructure } from "../../workflow/features.js";
import { checkContext, contextRefusal, effectiveDefaultContext } from "../../project/contexts.js";
import { readProjectConfig, detectStacks, writeProjectConfig, configPath } from "../../project/config.js";
import { seedHarness } from "../../harness/config.js";
import { nowTimestamp } from "../../shared/time.js";
import { parseAgentIds } from "../../integrations/agents.js";
import { installProjectSkills } from "../../integrations/install.js";
import { hasWorkItems, bootstrapDefaults, onboardAnswers, seedOverrides, saveConfig, appendIgnoreWorks, seedAgentsFile, type BootstrapAnswers } from "../../project/bootstrap.js";
import { cmdNew } from "./new.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export async function cmdInit(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const target = resolve(cwd, args.positionals[0] ?? ".");
  const agents = parseAgentIds(args.options.agent);
  if (typeof args.options.context === "string") {
    assertPathName(args.options.context, "context");
    // Seeding docs/{ctx}/ for a context kf new would refuse leaves a tree nothing can ever fill.
    // This runs before either branch, so --minimal and the bootstrap path are both covered.
    const explicit = checkContext(args.options.context, readProjectConfig(target));
    if (!explicit.ok) return { code: 1, stdout: contextRefusal(args.options.context, explicit), stderr: "unknown context" };
  }

  const minimal = Boolean(args.options.minimal);
  const useDefaults = Boolean(args.options.defaults);

  if (!minimal) {
    return cmdBootstrap(args, target, !useDefaults);
  }

  const cfg = readProjectConfig(target);
  const ctx = typeof args.options.context === "string" ? args.options.context : effectiveDefaultContext(cfg);
  // Same rule as the bootstrap path: an explicit --context on a genuinely new project is a
  // decision and gets declared. --minimal writes a config anyway, so leaving it out here would
  // mean the same command declares or not depending on a flag that says nothing about contexts.
  const declareHere = typeof args.options.context === "string"
    && cfg.contexts === undefined && !existsSync(configPath(target)) && !hasWorkItems(target);
  ensureWorksStructure(target);
  // A named context must be recorded even when FR-007 forbids declaring a list, or --minimal
  // seeds docs/{ctx}/ and then sends every new item somewhere else — but only where nothing else
  // already decides the default. With `contexts` present, `contexts[0]` is the default and
  // `defaultContext` is ignored, so writing it would leave a config contradicting itself: the
  // file naming one default while `kf new` and `kf contexts` use another.
  const recordContext = typeof args.options.context === "string" && cfg.contexts === undefined;
  // The write sits OUTSIDE the harness check on purpose. Every project kf init has already
  // touched carries a harness, so guarding it on `!cfg.harness` meant the record never happened
  // on any real project — only on the two config shapes a real init never produces.
  if (!cfg.harness || recordContext) {
    await mkdir(join(target, ".kf"), { recursive: true });
    writeProjectConfig(target, {
      ...cfg, schema: "kanban-flow", created: cfg.created ?? nowTimestamp(),
      ...(declareHere ? { contexts: [ctx] } : {}),
      ...(!declareHere && recordContext ? { defaultContext: ctx } : {}),
      harness: cfg.harness ?? seedHarness(agents.length ? agents : parseAgentIds(cfg.agents)),
    });
  }
  await mkdir(join(target, ".kf", "templates"), { recursive: true });
  await mkdir(join(target, ".kf", "hooks"), { recursive: true });
  await mkdir(join(target, ".kf", "review", "rules"), { recursive: true });
  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, ctx), { recursive: true });
  }
  const skills = await installProjectSkills(target, agents.length ? agents : parseAgentIds(cfg.agents));
  if (skills.code !== 0) return skills;
  const agentsFile = seedAgentsFile(target, cfg.stacks?.length ? cfg.stacks : detectStacks(target));
  return {
    code: 0,
    stdout: `✓ Initialized kanban-flow in ${target}\n  .works/{${STAGES.join(",")}}\n  docs/{requirement,use-cases,testplan}/${ctx}\n  .kf/templates (project overrides)\n  .kf/hooks (phase hooks, e.g. hooks/planning.sh)\n  .kf/review/rules (project review rules)\n  AGENTS.md: ${agentsFile === "created" ? "created" : "kept existing AGENTS.md/CLAUDE.md"}\n\n${skills.stdout}`,
  };
}

async function cmdBootstrap(args: ParsedArgs, target: string, interactive: boolean): Promise<CmdResult> {
  const tty = process.stdin.isTTY && process.stdout.isTTY;

  const explicitContext = typeof args.options.context === "string" ? args.options.context : undefined;

  let answers: BootstrapAnswers;
  if (interactive && !tty) {
    answers = bootstrapDefaults(target, explicitContext);
  } else if (interactive) {
    answers = await onboardAnswers(target, explicitContext);
  } else {
    answers = bootstrapDefaults(target, explicitContext);
  }

  const flagged = parseAgentIds(args.options.agent);
  if (flagged.length > 0) answers.agents = flagged;

  // Name validity lives in saveConfig, the one point every set of answers passes through;
  // repeating it here would be a guard that can never fire.
  ensureWorksStructure(target);
  await seedOverrides(target);
  saveConfig(target, answers);
  const skills = await installProjectSkills(target, answers.agents);
  if (skills.code !== 0) return skills;

  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, answers.defaultContext), { recursive: true });
  }

  const out: string[] = [];
  out.push(`✓ Bootstrapped kanban-flow in ${target}${interactive && !tty ? " (non-interactive: using defaults)" : ""}`);
  out.push(`  .works/{${STAGES.join(",")}}`);
  const ctxLine = answers.contexts.length > 0 ? `contexts: ${answers.contexts.join(", ")}` : `context: ${answers.defaultContext} (not restricted)`;
  out.push(`  ${ctxLine}   stacks: ${answers.stacks.join(", ") || "unset"}   reviewer: ${answers.reviewer}`);
  out.push(`  agents: ${answers.agents.join(", ")}`);
  out.push(`  .kf/config.json (defaults for new features)`);
  out.push(`  .kf/{templates,hooks,review/rules} seeded from package`);
  out.push(skills.stdout);
  out.push(`  AGENTS.md: ${seedAgentsFile(target, answers.stacks) === "created" ? "created" : "kept existing AGENTS.md/CLAUDE.md"}`);

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
