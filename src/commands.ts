import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  STAGES,
  ARTIFACTS,
  type WorkItemKind,
} from "./schema.js";
import {
  findWorksRoot,
  ensureWorksStructure,
  findFeature,
  listFeatures,
  featureFolderName,
  writeFeatureMeta,
  stageDir,
  assertPathName,
} from "./features.js";
import { computeStatus, renderStatusText, statusToJson } from "./status.js";
import { validateFeature, renderValidateText, validateToJson } from "./validate.js";
import { resolveTemplate, readTemplate } from "./paths.js";
import { readProjectConfig } from "./config.js";
import type { ParsedArgs } from "./args.js";
import { parseAgentIds } from "./agents.js";
import { installProjectSkills } from "./install.js";
import { dashboardData } from "./dashboard.js";
import { runHook } from "./hooks.js";
import {
  bootstrapDefaults,
  promptAnswers,
  seedOverrides,
  saveConfig,
  appendIgnoreWorks,
  type BootstrapAnswers,
} from "./bootstrap.js";

export interface CmdResult {
  code: number;
  stdout: string;
  stderr?: string;
}

export function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
}

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

export async function cmdNew(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const feature = args.positionals[0];
  if (!feature) {
    return { code: 1, stdout: "Missing feature name. Usage: kf new <feature> --context <ctx>", stderr: "missing feature" };
  }
  assertPathName(feature, "feature");
  const kindRaw = args.options.type;
  const kindValue = kindRaw === undefined ? "feature" : String(kindRaw);
  if (kindValue !== "feature" && kindValue !== "bug") {
    return { code: 1, stdout: `Unknown work item type '${kindValue}'. Expected feature or bug.`, stderr: "invalid type" };
  }
  const kind = kindValue as WorkItemKind;
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  if (listFeatures(root.root).some((f) => f.name === feature)) {
    return { code: 1, stdout: `Feature '${feature}' already exists. Select it with kf status --change ${feature}.`, stderr: "feature exists" };
  }

  let ctx: string;
  if (typeof args.options.context === "string") {
    ctx = args.options.context;
  } else {
    const cfg = readProjectConfig(root.root);
    ctx = cfg.defaultContext ?? listFeatures(root.root).find((f) => f.context)?.context ?? "app";
  }

  assertPathName(ctx, "context");
  const requirementTemplate = kind === "bug" ? "phase-1-bug-report.md" : ARTIFACTS["spec-requirement"].template;
  const tpl = await readTemplate(root.root, requirementTemplate);
  if (!tpl) return { code: 1, stdout: "Requirement template not found.", stderr: "no template" };
  const ts = nowTimestamp();
  const dir = join(stageDir(root.root, "brainstorm"), featureFolderName(feature, ts));
  try {
    await mkdir(dir);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "EEXIST") {
      return { code: 1, stdout: `Feature folder already exists: ${dir}`, stderr: "feature exists" };
    }
    throw err;
  }
  await writeFeatureMeta(dir, {
    schema: "kanban-flow",
    feature,
    context: ctx,
    created: ts,
    kind,
    goal: typeof args.options.goal === "string" ? args.options.goal : undefined,
  });

  if (tpl) {
    const rendered = tpl
      .replaceAll("{feature_name}", feature)
      .replaceAll("{Feature Name}", feature.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" "))
      .replaceAll("{context}", ctx)
      .replaceAll("{timestamp}", ts);
    await writeFile(join(dir, ARTIFACTS["spec-requirement"].file), rendered, "utf8");
  }

  const hook = runHook(root.root, {
    feature, context: ctx, dir, root: root.root, from: null, to: "brainstorm", approval: "pending",
  });
  if (hook.ran && !hook.ok) {
    await rm(dir, { recursive: true });
    return { code: 1, stdout: `Brainstorm hook failed (exit ${hook.code}). Feature creation rolled back.\n${hook.output}`, stderr: "hook failed" };
  }

  return {
    code: 0,
    stdout: `Created ${kind} '${feature}' at ${dir}/\nContext: ${ctx}\nNext: kf instruct spec-requirement --change "${feature}"`,
  };
}

export async function cmdList(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const features = listFeatures(root.root);
  if (args.options.json) {
    return {
      code: 0,
      stdout: JSON.stringify(features.map((f) => ({
        name: f.name,
        kind: f.meta?.kind ?? "feature",
        context: f.context,
        stage: f.stage,
        folder: f.folder,
      })), null, 2),
    };
  }
  if (features.length === 0) {
    return { code: 0, stdout: "No features found." };
  }
  const lines = features.map((f) => `${f.stage.padEnd(14)} ${(f.meta?.kind === "bug" ? "[bug] " : "") + f.name}${f.context ? ` (${f.context})` : ""}`);
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdShow(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Missing feature name.", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  const specPath = join(f.dir, ARTIFACTS["spec-requirement"].file);
  let content: string;
  try {
    content = await readFile(specPath, "utf8");
  } catch (err) {
    if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) throw err;
    content = `(no ${ARTIFACTS["spec-requirement"].file} in ${f.dir})`;
  }
  if (args.options.json) {
    return { code: 0, stdout: JSON.stringify({ feature: f.name, kind: f.meta?.kind ?? "feature", context: f.context, stage: f.stage, spec: content }) };
  }
  return { code: 0, stdout: content };
}

export async function cmdView(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const data = dashboardData(root.root);
  if (args.options.json) return { code: 0, stdout: JSON.stringify(data, null, 2) };
  const m = data.metrics;
  const lines = [
    "kaban-flow analytics", "",
    `Total: ${m.total} (${m.features} features, ${m.bugs} bugs)`,
    `Executing: ${m.executing}   Backlog: ${m.backlog}   Completed: ${m.completed}`,
    `Completion rate: ${m.completionRate === null ? "N/A" : m.completionRate + "%"}`,
    `Executing tasks: ${m.tasks.done}/${m.tasks.total} (${m.tasks.completionRate === null ? "N/A" : m.tasks.completionRate + "%"})`,
    "", "By stage:",
    ...data.charts.byStage.map((row) => `  ${row.id.padEnd(14)} ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "By context:",
    ...data.charts.byContext.map((row) => `  ${row.label}: ${row.count} (${row.features} features, ${row.bugs} bugs)`),
    "", "Approval (planning through review):",
    ...data.charts.approvals.map((row) => `  ${row.id}: ${row.count}`),
  ];
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdStatus(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all for every feature).\nRun: kf list', stderr: "missing --change" };
  }

  const features = change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  if (change && features.length === 0) {
    return { code: 1, stdout: `Unknown feature '${change}'. Run: kf list`, stderr: "unknown feature" };
  }
  const statuses = features.map((f) => computeStatus(f));
  if (json) {
    return {
      code: 0,
      stdout: JSON.stringify(
        change
          ? statusToJson(statuses[0])
          : { features: statuses.map(statusToJson) },
        null, 2,
      ),
    };
  }
  if (statuses.length === 0) {
    return { code: 0, stdout: "No active features. Create one with: kf new <feature> --context <ctx>" };
  }
  const blocks = statuses.map(renderStatusText);
  return { code: 0, stdout: blocks.join("\n\n") };
}

export async function cmdInstruct(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const artifact = args.positionals[0];
  const change = typeof args.options.change === "string" ? args.options.change : null;
  const useCase = artifact === "use-case";
  const useCaseId = typeof args.options.id === "string" ? args.options.id.toUpperCase() : null;
  if (!artifact) {
    const known = Object.values(ARTIFACTS).map((a) => a.id).join(", ");
    return { code: 1, stdout: `Missing artifact. Usage: kf instruct <artifact|use-case> --change <feature>\nArtifacts: ${known}, use-case`, stderr: "missing artifact" };
  }
  const def = Object.values(ARTIFACTS).find((a) => a.id === artifact);
  if (!def && !useCase) {
    const known = Object.values(ARTIFACTS).map((a) => a.id).join(", ");
    return { code: 1, stdout: `Unknown artifact '${artifact}'. Artifacts: ${known}, use-case`, stderr: "unknown artifact" };
  }
  if (useCase && !useCaseId) {
    return { code: 1, stdout: "Use case ID is required. Usage: kf instruct use-case --id UC-### [--change <feature>]", stderr: "missing use-case id" };
  }
  if (useCase && useCaseId && !/^UC-\d+$/.test(useCaseId)) {
    return { code: 1, stdout: `Invalid use-case id '${useCaseId}'. Expected UC-###.`, stderr: "invalid use-case id" };
  }

  const root = findWorksRoot(cwd) ?? cwd;
  const feature = change ? findFeature(root, change) : null;
  if (change && !feature) return { code: 1, stdout: `Unknown feature '${change}'.`, stderr: "unknown feature" };
  const templateName = useCase ? "phase-2-use-case.md" : def!.id === "spec-requirement" && feature?.meta?.kind === "bug"
    ? "phase-1-bug-report.md"
    : def!.template;
  const raw = await readTemplate(root, templateName);
  const tpl = raw && feature ? raw
    .replaceAll("{feature_name}", feature.name)
    .replaceAll("{context}", feature.context ?? "app")
    .replaceAll("{timestamp}", nowTimestamp())
    .replaceAll("{use_case_id}", useCaseId ?? "{use_case_id}")
    .replaceAll("{execution_id}", feature.meta?.executionId ?? "{execution_id}") : raw;
  if (!tpl) {
    return { code: 1, stdout: `Template '${templateName}' not found anywhere (project → ~/.kf → package).`, stderr: "no template" };
  }

  if (args.options.json) {
    const file = useCase ? `${useCaseId ?? "UC-###"}.md` : def!.file;
    const outputPath = feature ? join(feature.dir, useCase ? "use-cases" : "", file) : null;
    return {
      code: 0,
      stdout: JSON.stringify({
        artifact: useCase ? "use-case" : def!.id,
        file,
        templatePath: resolveTemplate(cwd, templateName)?.path,
        instruction: `Write ${outputPath ?? file}. Fill all {placeholders}.`,
        outputPath,
        executionId: feature?.meta?.executionId ?? null,
        unlocks: useCase ? "Planning contract — one UC-### per file" : def!.unlocks,
        template: tpl,
      }, null, 2),
    };
  }

  const lines: string[] = [];
  lines.push(`<artifact id="${useCase ? "use-case" : def!.id}" stage-phase="${useCase ? "plan" : def!.phase}">`);
  lines.push("");
  const outputPath = useCase ? `${useCaseId ?? "UC-###"}.md` : def!.file;
  lines.push(`Write to: ${feature ? join(feature.dir, useCase ? "use-cases" : "", outputPath) : `<feature-folder>/${useCase ? "use-cases/" : ""}${outputPath}`}`);
  lines.push(`Template (${resolveTemplate(cwd, templateName)?.source ?? "?"}): ${resolveTemplate(cwd, templateName)?.path}`);
  lines.push("");
  lines.push(`Unlocks: ${useCase ? "Planning contract — one UC-### per file" : def!.unlocks}`);
  if (change) lines.push(`Feature: ${change}`);
  lines.push("");
  lines.push("--- template ---");
  lines.push(tpl);
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdTemplates(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const rows = [
    ...Object.values(ARTIFACTS).map((a) => ({
    artifact: a.id,
    template: a.template,
    path: resolveTemplate(cwd, a.template)?.path ?? null,
    source: resolveTemplate(cwd, a.template)?.source ?? "missing",
    })),
    {
      artifact: "spec-requirement (bug)",
      template: "phase-1-bug-report.md",
      path: resolveTemplate(cwd, "phase-1-bug-report.md")?.path ?? null,
      source: resolveTemplate(cwd, "phase-1-bug-report.md")?.source ?? "missing",
    },
    {
      artifact: "use-case",
      template: "phase-2-use-case.md",
      path: resolveTemplate(cwd, "phase-2-use-case.md")?.path ?? null,
      source: resolveTemplate(cwd, "phase-2-use-case.md")?.source ?? "missing",
    },
  ];
  if (args.options.json) return { code: 0, stdout: JSON.stringify(rows, null, 2) };
  const lines = rows.map((r) => `${r.artifact.padEnd(16)} ${r.source.padEnd(8)} ${r.path}`);
  return { code: 0, stdout: lines.join("\n") };
}

export async function cmdValidate(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const json = Boolean(args.options.json);
  const strict = Boolean(args.options.strict);
  const all = Boolean(args.options.all);
  const change = typeof args.options.change === "string" ? args.options.change : null;

  if (!change && !all) {
    return { code: 1, stdout: 'Missing required option --change <feature> (or --all).', stderr: "missing --change" };
  }
  const features = change
    ? (() => { const f = findFeature(root.root, change); return f ? [f] : []; })()
    : listFeatures(root.root);

  if (change && features.length === 0) {
    return { code: 1, stdout: `Unknown feature '${change}'.`, stderr: "unknown feature" };
  }
  const results = features.map((f) => validateFeature(f, strict));
  const allValid = results.every((r) => r.valid);
  if (json) {
    return { code: allValid ? 0 : 1, stdout: JSON.stringify(results.map(validateToJson), null, 2), stderr: allValid ? undefined : "validation failed" };
  }
  const blocks = results.map(renderValidateText);
  const codes = blocks.join("\n") + `\nTotals: ${results.filter((r) => r.valid).length} passed, ${results.filter((r) => !r.valid).length} failed (${results.length} items)`;
  return { code: allValid ? 0 : 1, stdout: codes, stderr: allValid ? undefined : "validation failed" };
}
