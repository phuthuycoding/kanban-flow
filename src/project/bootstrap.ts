import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import { nowTimestamp } from "../shared/time.js";
import { detectStacks, writeProjectConfig, configPath, type ProjectConfig } from "./config.js";
import { effectiveDefaultContext, normalizeContext } from "./contexts.js";
import { STAGES } from "../workflow/schema.js";
import { assertPathName } from "../workflow/features.js";
import { seedHarness } from "../harness/config.js";
import { AGENTS, DEFAULT_AGENT, parseAgentIds, type AgentId } from "../integrations/agents.js";
import { readProjectConfig } from "./config.js";

export interface BootstrapAnswers {
  /** Declared contexts; the first is the default. Empty means "leave the project unrestricted". */
  contexts: string[];
  defaultContext: string;
  /** True when a person named the default. False when the tool fell back to it. */
  defaultContextStated: boolean;
  stacks: string[];
  reviewer: string;
  ignoreWorks: boolean;
  seedFeature: boolean;
  agents: AgentId[];
}

/** git user.name, else $USER, else "human". */
export function detectReviewer(root = process.cwd()): string {
  try {
    const name = execFileSync("git", ["-C", root, "config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (name) return name;
  } catch (err) {
    if (!(err instanceof Error && (("status" in err && err.status === 1) || ("code" in err && err.code === "ENOENT")))) throw err;
  }
  return process.env.USER || process.env.USERNAME || "human";
}

/** True when .git exists and .works/ is not already ignored. */
export function shouldSuggestIgnoreWorks(root: string): boolean {
  if (!existsSync(join(root, ".git"))) return false;
  const gi = join(root, ".gitignore");
  if (!existsSync(gi)) return true;
  const content = readFileSync(gi, "utf8");
  return !/^\s*\.works\/?\s*$/m.test(content) && !content.split("\n").some((l) => l.includes(".works"));
}

export function appendIgnoreWorks(root: string): void {
  const gi = join(root, ".gitignore");
  const add = "\n# kanban-flow\n.works/\n";
  if (!existsSync(gi)) writeFileSync(gi, add, "utf8");
  else writeFileSync(gi, readFileSync(gi, "utf8") + add, "utf8");
}

async function confirm(rl: ReturnType<typeof createInterface>, q: string, def: boolean): Promise<boolean> {
  const hint = def ? "Y/n" : "y/N";
  const ans = (await rl.question(`${q} (${hint}) `)).trim().toLowerCase();
  if (ans === "") return def;
  return ans === "y" || ans === "yes";
}

/** Drop case-insensitive repeats, keeping the first spelling: the config reader refuses them. */
function dedupeContexts(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = normalizeContext(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Does `.works/` hold any work item folder? Deliberately only reads directory entries: reading
 * work item metadata would make `kf init` die on a half-broken project, which is the one moment
 * someone reaches for it. An empty `.works/` is not an existing project.
 */
export function hasWorkItems(root: string): boolean {
  for (const stage of STAGES) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, ".works", stage));
    } catch (err) {
      // Missing means nothing to count. Anything else — unreadable, not a directory — means we
      // cannot tell, and the safe answer is "existing": declaring a list would be the change
      // that locks someone out, while declining to declare one changes nothing.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      return true;
    }
    // A work item is a folder named `<feature>_<timestamp>`. A .gitkeep or a .DS_Store is not one,
    // and counting it would silently suppress the list — the very failure this check exists for.
    if (entries.some((name) => /_\d{8}_\d{4}$/.test(name))) return true;
  }
  return false;
}

export function bootstrapDefaults(root: string, explicitContext?: string): BootstrapAnswers {
  const cfg = readProjectConfig(root);
  const defaultContext = explicitContext || effectiveDefaultContext(cfg);
  // Declaring a list is a decision, and `--defaults` means nobody made one, so only an explicit
  // --context declares. Even then, not on a project that already exists: declaring one name there
  // would lock out every context its work items already use, which is what FR-007 forbids. An
  // existing project declares by answering on a TTY, or by hand.
  const isNewProject = !existsSync(configPath(root)) && !hasWorkItems(root);
  const declared = cfg.contexts?.length ? cfg.contexts
    : explicitContext && isNewProject ? [explicitContext]
    : [];
  return {
    contexts: declared,
    defaultContext,
    defaultContextStated: Boolean(explicitContext) || cfg.contexts !== undefined || cfg.defaultContext !== undefined,
    stacks: cfg.stacks?.length ? cfg.stacks : detectStacks(root),
    reviewer: cfg.reviewer ?? detectReviewer(root),
    ignoreWorks: shouldSuggestIgnoreWorks(root),
    seedFeature: false,
    agents: cfg.agents?.length ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT],
  };
}

/** Arrow-key radio select on a TTY; digit keys also work. Returns the chosen index. */
export async function selectOption(question: string, options: string[]): Promise<number> {
  return new Promise<number>((resolveP, reject) => {
    let idx = 0;
    let drawn = 0;
    const draw = () => {
      if (drawn > 0) output.write(`\x1b[${drawn}A\x1b[J`);
      const text = `${question}\n${options.map((o, i) => ` ${i === idx ? "❯" : " "} ${o}`).join("\n")}`;
      output.write(`${text}\n`);
      drawn = text.split("\n").length;
    };
    const cleanup = () => {
      input.setRawMode(false);
      input.off("keypress", onKey);
      input.pause();
    };
    const onKey = (_s: string, key: { name: string; ctrl?: boolean }) => {
      if (key.name === "up") idx = (idx - 1 + options.length) % options.length;
      else if (key.name === "down") idx = (idx + 1) % options.length;
      else if (/^[1-9]$/.test(key.name) && Number(key.name) <= options.length) idx = Number(key.name) - 1;
      else if (key.name === "return") { cleanup(); resolveP(idx); return; }
      else if (key.name === "c" && key.ctrl) {
        cleanup();
        reject(new Error("Setup aborted (Ctrl+C). Re-run with --defaults to skip prompts."));
        return;
      } else return;
      draw();
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    draw();
  });
}

/**
 * Onboarding entry: let the user pick quick setup (defaults) or customize,
 * then collect answers accordingly.
 */
export async function onboardAnswers(
  root: string,
  explicitContext?: string,
): Promise<BootstrapAnswers> {
  const d = bootstrapDefaults(root, explicitContext);
  const mode = await selectOption("Setup mode (↑/↓ + Enter):", [
    `Quick setup — defaults (context: ${d.defaultContext}, stacks: ${d.stacks.join(", ") || "unset"}, reviewer: ${d.reviewer}, agents: ${d.agents.join(", ")})`,
    "Customize — answer each question",
  ]);
  if (mode === 0) return d;
  return promptAnswers(root, explicitContext);
}

/**
 * Ask the bootstrap questions interactively. Every question has a sensible
 * default — Enter accepts it. Returns the collected answers.
 */
export async function promptAnswers(
  root: string,
  explicitContext?: string,
): Promise<BootstrapAnswers> {
  const rl = createInterface({ input, output });
  try {
    return await askAll(rl, root, explicitContext);
  } catch (err) {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "ERR_ABORT")) {
      throw new Error("Setup aborted (EOF/Ctrl+C). Re-run with --defaults to skip prompts.");
    }
    throw err;
  } finally {
    rl.close();
  }
}

/**
 * Exported for tests: the interactive branch is otherwise unreachable without a TTY, and it owns
 * the context-list dedupe and the empty-answer fallback, both of which must not regress silently.
 */
export async function askAll(
  rl: ReturnType<typeof createInterface>,
  root: string,
  explicitContext?: string,
): Promise<BootstrapAnswers> {
  const d = bootstrapDefaults(root, explicitContext);

  // One question, not two: the list declares the default by position, so there is no second
  // field to keep in step with it.
  //
  // On a project that is already unrestricted, `d.contexts` is empty and the prompt says so:
  // pressing Enter there must leave it unrestricted. Enter is not a decision, and declaring a
  // list on someone's behalf would lock out every context their work items already use.
  const hint = d.contexts.length > 0 ? d.contexts.join(",") : "leave empty to keep this project unrestricted";
  const ctxRaw = (await rl.question(`Contexts, comma separated, first is the default [${hint}]: `)).trim();
  const typed = ctxRaw.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean);
  const contexts = typed.length > 0 ? dedupeContexts(typed) : d.contexts;
  const defaultContext = contexts[0] ?? d.defaultContext;

  let stacks = d.stacks;
  const parseStacks = (raw: string): string[] =>
    raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (stacks.length > 0) {
    const ok = await confirm(rl, `Detected stacks: ${stacks.join(", ")}. Use them?`, true);
    if (!ok) {
      const s = (await rl.question("Stacks (comma-separated, e.g. node,go — or skip): ")).trim();
      stacks = parseStacks(s);
    }
  } else {
    const s = (await rl.question("Stacks (comma-separated, e.g. node,go — or skip): ")).trim();
    stacks = parseStacks(s);
  }

  const rev = (await rl.question(`Default reviewer for kf approve [${d.reviewer}]: `)).trim();
  const reviewer = rev || d.reviewer;

  const agents = (await promptAgents(rl, d.agents)).agents;

  let ignoreWorks = d.ignoreWorks;
  if (d.ignoreWorks) {
    ignoreWorks = await confirm(rl, "Add .works/ to .gitignore?", true);
  }

  const seedFeature = await confirm(rl, "Seed a demo feature to show the structure?", false);

  // Typing a list is a decision; pressing Enter is not. Recording Enter as one would repoint
  // every future context-less `kf new` at the invented fallback, on the one path where the
  // prompt has just promised "leave empty to keep this project unrestricted".
  return { contexts, defaultContext, defaultContextStated: typed.length > 0 || d.defaultContextStated, stacks, reviewer, ignoreWorks, seedFeature, agents };
}

/** Multi-select agent prompt (comma-separated ids; Enter = default agent). */
async function promptAgents(
  rl: ReturnType<typeof createInterface>,
  defaults: AgentId[],
): Promise<{ agents: AgentId[] }> {
  const list = AGENTS.map((a) => a.id).join(", ");
  const ans = (await rl.question(`Install skills for which agents? (comma-separated, default: ${defaults.join(", ")}) [${list}]: `)).trim();
  if (ans === "") return { agents: defaults };
  return { agents: parseAgentIds(ans.toLowerCase().split(/[\s,]+/)) };
}

/** Copy package templates/rules (+ empty hooks dir) into the new project override dirs. */
export async function seedOverrides(root: string): Promise<void> {
  const dirs = [
    join(root, ".kf", "templates"),
    join(root, ".kf", "hooks"),
    join(root, ".kf", "review", "rules"),
  ];
  await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));

  const { PKG_TEMPLATES_DIR, PKG_RULES_DIR } = await import("../shared/paths.js");
  await copyDirInto(PKG_TEMPLATES_DIR, join(root, ".kf", "templates"));
  await copyDirInto(PKG_RULES_DIR, join(root, ".kf", "review", "rules"));
}

async function copyDirInto(src: string, dest: string): Promise<void> {
  if (!existsSync(src)) return;
  const files = await readdir(src);
  for (const f of files) {
    const from = resolve(src, f);
    const to = resolve(dest, f);
    if (!existsSync(from) || existsSync(to)) continue;
    await mkdir(dest, { recursive: true });
    await copyFile(from, to);
  }
}

/** Write .kf/config.json for this project. */
export function saveConfig(root: string, a: BootstrapAnswers): void {
  const existing = readProjectConfig(root);
  // Both halves of the rule live here, not at a caller: this is the one point every set of
  // answers passes through, so no producer — present or future — can write a contexts list that
  // readProjectConfig then refuses. Dedupe covers the repeat rule; assertPathName covers names.
  const contexts = dedupeContexts(a.contexts);
  for (const c of contexts) assertPathName(c, "context");
  // `contexts[0]` is the default once a list exists, so a second field would only drift. With no
  // list, keep whatever the project already stated and invent nothing: a default the tool made up
  // would make `kf new`'s guess-from-work-items arm unreachable.
  // Four cases, and each one matters:
  //   named by a person      → write it, or `--context X` would seed docs/X and then send every
  //                            new item somewhere else
  //   already in the config  → counts as named: `defaultContextStated` is true whenever the
  //                            config already carried context information, so this is the same
  //                            branch. A separate `existing.defaultContext ??` fallback here
  //                            would be unreachable, since both read the same file.
  //   nothing, no work items → write the fallback; on a fresh project there is nothing to
  //                            override, and the field is how someone discovers it exists
  //   nothing, but work items exist → write nothing, or the invented default would make
  //                            `kf new`'s guess-from-work-items arm unreachable
  const keepDefault = a.defaultContextStated ? a.defaultContext : hasWorkItems(root) ? undefined : a.defaultContext;
  const legacyDefault = contexts.length === 0 && keepDefault ? { defaultContext: keepDefault } : {};
  const cfg: ProjectConfig = {
    schema: "kanban-flow",
    ...(contexts.length > 0 ? { contexts } : {}),
    ...legacyDefault,
    stacks: a.stacks,
    reviewer: a.reviewer,
    agents: a.agents,
    harness: existing.harness ?? seedHarness(a.agents),
    created: existing.created ?? nowTimestamp(),
  };
  writeProjectConfig(root, cfg);
}

const AGENT_SCRIPTS: Array<[string, string]> = [["Install", "ci"], ["Build", "build"], ["Typecheck", "typecheck"], ["Lint", "lint"], ["Test", "test"]];

function nodeCommandRows(root: string): string[] {
  const manifest = join(root, "package.json");
  if (!existsSync(manifest)) return [];
  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> };
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Invalid JSON in ${manifest}`, { cause: err });
    throw err;
  }
  const scripts = pkg.scripts ?? {};
  return AGENT_SCRIPTS
    .filter(([, script]) => script === "ci" || script in scripts)
    .map(([label, script]) => `| ${label} | \`${script === "ci" ? (existsSync(join(root, "package-lock.json")) ? "npm ci" : "npm install") : script === "test" ? "npm test" : `npm run ${script}`}\` |`);
}

/**
 * Seed AGENTS.md at the project root so agents know the commands and the
 * kanban-flow conventions. Never overwrites an existing AGENTS.md or CLAUDE.md.
 */
export function seedAgentsFile(root: string, stacks: string[]): "created" | "kept" {
  if (existsSync(join(root, "AGENTS.md")) || existsSync(join(root, "CLAUDE.md"))) return "kept";
  const rows = stacks.includes("node") ? nodeCommandRows(root) : [];
  const commands = rows.length > 0
    ? rows.join("\n")
    : "| Build | `TODO: fill in` |\n| Test | `TODO: fill in` |\n| Lint | `TODO: fill in` |";
  const content = `# AGENTS.md

Conventions for AI coding agents working in this repository. Seeded by \`kf init\`; edit freely.

## Commands

| Task | Command |
|---|---|
${commands}

Detect anything else by reading the repository, never by guessing.

## Workflow (kanban-flow)

- Start a feature with one command: \`kanban <context> <feature>\` (bug: \`kanban <context> <name> --type bug\`).
- Only two human gates: confirm the requirement (Phase 1) and approve the plan + choose start-now vs backlog (Phase 2). Do not ask "continue?" between other phases.
- Work item state lives in \`.works/\`; move items only with \`kf stage\` / \`kf archive\`, never by moving folders.
- Never use \`--force\` or \`--skip-hooks\` without explicit user approval; every bypass is recorded in the work item's metadata.
- Run \`kf autoconfig\` for the setup checklist and the review rules to apply as coding conventions.
`;
  writeFileSync(join(root, "AGENTS.md"), content, "utf8");
  return "created";
}
