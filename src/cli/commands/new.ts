import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ARTIFACTS, type WorkItemKind } from "../../workflow/schema.js";
import { assertPathName, listFeatures, featureFolderName, writeFeatureMeta, stageDir } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
import { checkContext, contextRefusal, declaredDefaultContext, effectiveDefaultContext } from "../../project/contexts.js";
import { readTemplate } from "../../shared/paths.js";
import { nowTimestamp } from "../../shared/time.js";
import { runHook } from "../../integrations/hooks.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

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

  const cfg = readProjectConfig(root.root);
  // The config's own answer wins; only when it states none do we guess from existing work items.
  const ctx = typeof args.options.context === "string"
    ? args.options.context
    : declaredDefaultContext(cfg) ?? listFeatures(root.root).find((f) => f.context)?.context ?? effectiveDefaultContext(cfg);

  assertPathName(ctx, "context");
  // Only bites once the project has declared a list; an undeclared project behaves exactly as before.
  const check = checkContext(ctx, cfg);
  if (!check.ok) return { code: 1, stdout: contextRefusal(ctx, check), stderr: "unknown context" };
  const requirementTemplate = kind === "bug" ? "phase-1-bug-report.md" : ARTIFACTS["spec-requirement"].template;
  const tpl = await readTemplate(root.root, requirementTemplate);
  if (!tpl) return { code: 1, stdout: "Requirement template not found.", stderr: "no template" };
  const ts = nowTimestamp();
  const dir = join(stageDir(root.root, "brainstorm"), featureFolderName(feature, ts));
  await mkdir(dirname(dir), { recursive: true });
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

  const rendered = tpl
    .replaceAll("{feature_name}", feature)
    .replaceAll("{Feature Name}", feature.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" "))
    .replaceAll("{context}", ctx)
    .replaceAll("{timestamp}", ts);
  await writeFile(join(dir, ARTIFACTS["spec-requirement"].file), rendered, "utf8");

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
