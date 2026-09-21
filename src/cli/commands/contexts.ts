import { readProjectConfig } from "../../project/config.js";
import { contextsInUse, normalizeContext } from "../../project/contexts.js";
import { findRoot } from "./helpers.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * The brief a worker reads when no list exists yet. It states the grouping rule, the size, and that
 * the human decides — the last one is a promise in prose, not something the CLI can enforce.
 */
function surveyBrief(inUse: Array<{ context: string; count: number }>): string {
  const lines = [
    "No contexts declared in .kf/config.json.",
    "",
    "Survey this repo and propose a context list:",
    "- read the top-level source directories and the package manifests",
    "- group by business domain, not by technical layer: billing and catalog,",
    "  never frontend and backend",
    "- propose 3 to 7 names, one word each; where a context is already in use,",
    "  match the spelling the work items use rather than re-casing it",
    "- show them to the human and write only the list they confirm to",
    "  .kf/config.json as \"contexts\"; the first entry becomes the default",
    "",
    "Do not write the list on your own. Naming a business domain is the",
    "product owner's call, not something to infer from a directory tree.",
    "",
  ];
  lines.push(inUse.length === 0
    ? "No work item uses a context yet."
    : `Contexts currently in use on disk: ${inUse.map((c) => `${c.context} (${c.count})`).join(", ")}`);
  return lines.join("\n");
}

const plural = (n: number): string => `${n} work item${n === 1 ? "" : "s"}`;

export async function cmdContexts(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const cfg = readProjectConfig(root.root);
  const inUse = contextsInUse(root.root);
  const declared = cfg.contexts ?? [];
  // Exact comparison on both sides. `kf new` accepts a context only on an exact match, so
  // "declared" here must mean the same thing, or the advice below becomes a lie.
  const countOf = (name: string): number => inUse.find((u) => u.context === name)?.count ?? 0;
  const missing = inUse.filter((u) => !declared.includes(u.context));
  // "Can this name be added?" depends on every other name that would sit beside it, not just on
  // what is already declared: two undeclared spellings of one name collide with each other too,
  // and readProjectConfig refuses the repeat either way.
  const undeclared = missing.map((u) => {
    const key = normalizeContext(u.context);
    // Every partner, not the first one found: with a declared clash AND another in-use spelling,
    // naming only one produces two instructions that cannot both be obeyed, and the reader
    // bounces between them forever. Only one name in the whole group can ever be declared.
    const declaredClash = declared.find((d) => normalizeContext(d) === key) ?? null;
    const inUseClashes = missing.filter((o) => o.context !== u.context && normalizeContext(o.context) === key).map((o) => o.context);
    return { ...u, collidesWith: declaredClash ?? inUseClashes[0] ?? null, collidesWithDeclared: declaredClash !== null, declaredClash, inUseClashes };
  });
  const collisionAdvice = (u: { context: string; declaredClash: string | null; inUseClashes: string[] }): string[] => {
    const others = [...(u.declaredClash ? [`declared "${u.declaredClash}"`] : []), ...u.inUseClashes.map((c) => `"${c}" (also in use)`)];
    const list = others.length > 1 ? `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}` : others[0];
    return [
      `    ⚠ differs only by case from ${list}.`,
      "      The config refuses two names that differ only by case, so only one of",
      `      these ${others.length + 1} names can be declared. Rename the other work items first.`,
    ];
  };

  const clashing = undeclared.filter((u) => u.inUseClashes.length > 0);
  // One brief, built once. Splitting it produced a text warning and a JSON brief without one,
  // and --json is the mode an agent reads, so the warning went missing exactly where it counts.
  const briefText = clashing.length === 0
    ? surveyBrief(inUse)
    : [surveyBrief(inUse), "", "Before you write the list, note:",
       ...clashing.flatMap((u) => [`  ${u.context}`, ...collisionAdvice(u)])].join("\n");

  if (args.options.json) {
    return {
      code: 0,
      stdout: JSON.stringify({
        declared: declared.map((name, index) => ({ name, count: countOf(name), default: index === 0 })),
        undeclared,
        restricted: declared.length > 0,
        // UC-003's actor is an agent, and --json is the mode an agent reads: it needs the brief most.
        ...(declared.length === 0 ? { brief: briefText } : {}),
      }, null, 2),
    };
  }

  if (declared.length === 0) return { code: 0, stdout: briefText };

  const lines = ["Declared contexts:"];
  for (const [index, name] of declared.entries()) {
    const marker = index === 0 ? "  (default)" : "";
    lines.push(`  ${name.padEnd(16)} ${plural(countOf(name))}${marker}`);
  }
  if (undeclared.length > 0) {
    lines.push("", "In use but not declared:");
    for (const u of undeclared) {
      lines.push(`  ${u.context.padEnd(16)} ${plural(u.count)}`);
      if (u.collidesWith) lines.push(...collisionAdvice(u));
    }
    if (undeclared.some((u) => !u.collidesWith)) {
      lines.push("", "kf new refuses these. Add the ones you want to keep to contexts in .kf/config.json.");
    }
  }
  return { code: 0, stdout: lines.join("\n") };
}
