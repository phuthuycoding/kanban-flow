import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ARTIFACTS, type WorkItemKind } from "../../workflow/schema.js";
import { assertPathName, listFeatures, featureFolderName, writeFeatureMeta, stageDir } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
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
