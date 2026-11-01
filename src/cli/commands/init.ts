import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { STAGES } from "../../workflow/schema.js";
import { assertPathName, ensureWorksStructure } from "../../workflow/features.js";
import { checkContext, contextRefusal, effectiveDefaultContext } from "../../project/contexts.js";
import { readProjectConfig, detectStacks, writeProjectConfig, patchProjectConfig, configPath, effectiveSkillsScope } from "../../project/config.js";
import { detectRepository } from "../../project/repository.js";
import { nowTimestamp } from "../../shared/time.js";
import { parseAgentIds } from "../../integrations/agents.js";
import { globalLinkRefusal, installSkills } from "../../integrations/install.js";
import { hasWorkItems, bootstrapDefaults, onboardAnswers, seedOverrides, seedGithubHooks, saveConfig, appendIgnoreWorks, seedAgentsFile, type BootstrapAnswers } from "../../project/bootstrap.js";
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
  const refusal = effectiveSkillsScope(cfg) === "global" ? globalLinkRefusal() : null;
  if (refusal) return { code: 1, stdout: "", stderr: refusal };
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
  const repository = cfg.repository ?? detectRepository(target) ?? undefined;
  if (!existsSync(configPath(target))) {
    await mkdir(join(target, ".kf"), { recursive: true });
    writeProjectConfig(target, {
      ...cfg, schema: "kanban-flow", created: cfg.created ?? nowTimestamp(),
      ...(declareHere ? { contexts: [ctx] } : {}),
      ...(!declareHere && recordContext ? { defaultContext: ctx } : {}),
      repository,
    });
  } else {
    // An existing config is patched as written, never rewritten from the normalised read, which drops
    // ship, renames legacy statusMap keys and loses the indent: only a recorded context and a missing
    // schema, created or detectable repository are added.
    const additions: Record<string, unknown> = {
      ...(cfg.schema === undefined ? { schema: "kanban-flow" } : {}),
      ...(cfg.created === undefined ? { created: nowTimestamp() } : {}),
      ...(recordContext ? { defaultContext: ctx } : {}),
      ...(repository !== cfg.repository ? { repository } : {}),
    };
    if (Object.keys(additions).length > 0) await patchProjectConfig(target, additions);
  }
  await mkdir(join(target, ".kf", "templates"), { recursive: true });
  await mkdir(join(target, ".kf", "hooks"), { recursive: true });
  await mkdir(join(target, ".kf", "review", "rules"), { recursive: true });
  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, ctx), { recursive: true });
  }
  const scope = effectiveSkillsScope(cfg);
  const skills = await installSkills(target, agents.length ? agents : parseAgentIds(cfg.agents), scope, { declaredScope: cfg.skills?.scope });
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

  // A scope known before the prompts (declared, or the global default) is refused before the user answers anything.
  const declared = readProjectConfig(target).skills?.scope;
  const early = (declared ?? "global") === "global" ? globalLinkRefusal() : null;
  if (early) return { code: 1, stdout: "", stderr: early };

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
  // A global scope chosen in the prompts is refused here, still before the first write.
  const refusal = answers.skillScope === "global" ? globalLinkRefusal() : null;
  if (refusal) return { code: 1, stdout: "", stderr: refusal };

  // Name validity lives in saveConfig, the one point every set of answers passes through;
  // repeating it here would be a guard that can never fire.
  ensureWorksStructure(target);
  await seedOverrides(target);
  if (answers.installGithubHooks) await seedGithubHooks(target);
  saveConfig(target, answers);
  const skills = await installSkills(target, answers.agents, answers.skillScope, { declaredScope: answers.skillScope });
  if (skills.code !== 0) return skills;

  for (const docsDir of ["requirement", "use-cases", "testplan"]) {
    await mkdir(join(target, "docs", docsDir, answers.defaultContext), { recursive: true });
  }

  const out: string[] = [];
  out.push(`✓ Bootstrapped kanban-flow in ${target}${interactive && !tty ? " (non-interactive: using defaults)" : ""}`);
  out.push(`  .works/{${STAGES.join(",")}}`);
  const ctxLine = answers.contexts.length > 0 ? `contexts: ${answers.contexts.join(", ")}` : `context: ${answers.defaultContext} (not restricted)`;
  out.push(`  ${ctxLine}   stacks: ${answers.stacks.join(", ") || "unset"}   reviewer: ${answers.reviewer}${answers.repository ? `   repository: ${answers.repository}` : ""}`);
  out.push(`  agents: ${answers.agents.join(", ")}`);
  out.push(`  .kf/config.json (defaults for new features)`);
  out.push(`  .kf/{templates,hooks,review/rules} seeded from package`);
  out.push(skills.stdout);
  out.push(`  AGENTS.md: ${seedAgentsFile(target, answers.stacks) === "created" ? "created" : "kept existing AGENTS.md/CLAUDE.md"}`);

  if (answers.ignoreWorks) {
    const { added, gitError } = appendIgnoreWorks(target);
    if (added.length > 0) out.push(`  .gitignore: added ${added.join(", ")}`);
    if (gitError) out.push(`  note: git could not check .gitignore (${gitError}); only its lines were matched`);
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
