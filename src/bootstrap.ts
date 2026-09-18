import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, copyFile, readdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

import { nowTimestamp } from "./commands.js";
import { detectStack, writeProjectConfig, type ProjectConfig } from "./config.js";
import { AGENTS, DEFAULT_AGENT, parseAgentIds, type AgentId } from "./agents.js";
import { readProjectConfig } from "./config.js";

export interface BootstrapAnswers {
  defaultContext: string;
  stack: string | null;
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
  const add = "\n# kaban-flow\n.works/\n";
  if (!existsSync(gi)) writeFileSync(gi, add, "utf8");
  else writeFileSync(gi, readFileSync(gi, "utf8") + add, "utf8");
}

async function confirm(rl: ReturnType<typeof createInterface>, q: string, def: boolean): Promise<boolean> {
  const hint = def ? "Y/n" : "y/N";
  const ans = (await rl.question(`${q} (${hint}) `)).trim().toLowerCase();
  if (ans === "") return def;
  return ans === "y" || ans === "yes";
}

export function bootstrapDefaults(root: string, explicitContext?: string): BootstrapAnswers {
  const cfg = readProjectConfig(root);
  return {
    defaultContext: explicitContext || cfg.defaultContext || "app",
    stack: cfg.stack ?? detectStack(root),
    reviewer: cfg.reviewer ?? detectReviewer(root),
    ignoreWorks: shouldSuggestIgnoreWorks(root),
    seedFeature: false,
    agents: cfg.agents?.length ? parseAgentIds(cfg.agents) : [DEFAULT_AGENT],
  };
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

async function askAll(
  rl: ReturnType<typeof createInterface>,
  root: string,
  explicitContext?: string,
): Promise<BootstrapAnswers> {
  const d = bootstrapDefaults(root, explicitContext);

  const ctxRaw = (await rl.question(`Default context for new features [${d.defaultContext}]: `)).trim();
  const defaultContext = ctxRaw || d.defaultContext;

  let stack = d.stack;
  if (stack) {
    const ok = await confirm(rl, `Detected stack: ${stack}. Use it?`, true);
    if (!ok) {
      const s = (await rl.question("Stack (node/go/rust/python/php/ruby/java/...): ")).trim();
      stack = s || null;
    }
  } else {
    const s = (await rl.question("Stack (node/go/rust/python/... or skip): ")).trim();
    stack = s || null;
  }

  const rev = (await rl.question(`Default reviewer for kf approve [${d.reviewer}]: `)).trim();
  const reviewer = rev || d.reviewer;

  const agents = (await promptAgents(rl, d.agents)).agents;

  let ignoreWorks = d.ignoreWorks;
  if (d.ignoreWorks) {
    ignoreWorks = await confirm(rl, "Add .works/ to .gitignore?", true);
  }

  const seedFeature = await confirm(rl, "Seed a demo feature to show the structure?", false);

  return { defaultContext, stack, reviewer, ignoreWorks, seedFeature, agents };
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

  const { PKG_TEMPLATES_DIR, PKG_RULES_DIR } = await import("./paths.js");
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
  const cfg: ProjectConfig = {
    schema: "kanban-flow",
    defaultContext: a.defaultContext,
    stack: a.stack,
    reviewer: a.reviewer,
    agents: a.agents,
    created: readProjectConfig(root).created ?? nowTimestamp(),
  };
  writeProjectConfig(root, cfg);
}
