import { join } from "node:path";
import { ARTIFACTS } from "../../workflow/schema.js";
import { findWorksRoot, findFeature } from "../../workflow/features.js";
import { resolveTemplate, readTemplate } from "../../shared/paths.js";
import { nowTimestamp } from "../../shared/time.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

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
