import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { copySkillsTo, linkOrCopySkillsTo, removeSkillsFrom, removeRetiredSkills } from "../integrations/install.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Spelled out here on purpose: the tree is checked against the intended names, not against the module under test.
const SKILLS = ["flow", "brainstorm", "plan", "implement", "test", "review", "archive", "bug", "spike", "travel", "docs"];
const AGENTS = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer", "researcher"];
const LEGACY = ["kanban-flow", "kanban-brainstorm", "kanban-plan", "kanban-implement", "kanban-test", "kanban-review", "kanban-archive", "kanban-bug"];

function walk(dir: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const isMd = (p: string) => p.endsWith(".md");
const skillDocs = () => walk(join(ROOT, "assets", "skills"), isMd);
const agentDocs = () => walk(join(ROOT, "assets", "agents"), isMd);

function frontmatterName(file: string): string | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"));
  const line = m?.[1].split("\n").find((l) => l.startsWith("name:"));
  return line ? line.slice("name:".length).trim().replace(/^["']|["']$/g, "") : null;
}

describe("the managed name lists", () => {
  it("names the bare skills, the agents and the legacy kanban-* skills", async () => {
    const managed = await import("../integrations/managed.js");
    expect(managed.MANAGED_SKILLS).toEqual(SKILLS);
    expect(managed.MANAGED_AGENTS).toEqual(AGENTS);
    expect(managed.LEGACY_SKILLS).toEqual(LEGACY);
  });

  it("is re-exported by install.ts so existing importers keep working", async () => {
    const managed = await import("../integrations/managed.js");
    const install = await import("../integrations/install.js");
    expect(install.MANAGED_SKILLS).toEqual(managed.MANAGED_SKILLS);
    expect(install.MANAGED_AGENTS).toEqual(managed.MANAGED_AGENTS);
  });

  it("names every copy for other runtimes with the kf- prefix, travel included", async () => {
    const { copyName } = await import("../integrations/managed.js");
    expect(copyName("review")).toBe("kf-review");
    expect(copyName("flow")).toBe("kf-flow");
    expect(copyName("travel")).toBe("kf-travel");
  });

  it("has a skill dir whose frontmatter name is the bare name for every managed skill", () => {
    for (const name of SKILLS) {
      const file = join(ROOT, "assets", "skills", name, "SKILL.md");
      expect(existsSync(file), `${relative(ROOT, file)} exists`).toBe(true);
      expect(frontmatterName(file), `${relative(ROOT, file)} frontmatter name`).toBe(name);
    }
  });

  it("has no kanban-* skill dir left in the tree", () => {
    for (const name of LEGACY) expect(existsSync(join(ROOT, "assets", "skills", name)), `skills/${name}`).toBe(false);
  });

  it("has an agent file at agents/<name>.md for every managed agent and none left under skills", () => {
    for (const name of AGENTS) expect(existsSync(join(ROOT, "assets", "agents", `${name}.md`)), `agents/${name}.md`).toBe(true);
    expect(existsSync(join(ROOT, "assets", "skills", "flow", "agents"))).toBe(false);
  });
});

describe("cross-references name the kf plugin", () => {
  it("never dispatches a managed agent or loads a skill without the kf: prefix", () => {
    const agentNames = AGENTS.join("|");
    const skillNames = [...SKILLS, ...LEGACY].join("|");
    const bad = [
      new RegExp(`Agent\\((?!kf:)["']?(${agentNames})\\b`),
      new RegExp(`Skill\\((?!kf:)["']?(${skillNames})\\b`),
      new RegExp(`subagent_type:\\s*["']?(?!kf:)(${agentNames})\\b`),
    ];
    const hits: string[] = [];
    for (const file of [...skillDocs(), ...agentDocs()]) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (bad.some((re) => re.test(line))) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("the plugin package", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string; files: string[] };

  it("declares the kf plugin at the package version", () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin.name).toBe("kf");
    expect(plugin.version).toBe(pkg.version);
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description.length).toBeGreaterThan(0);
  });

  it("lists the kf plugin in the kanban-flow marketplace with the package root as source", () => {
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(market.name).toBe("kanban-flow");
    const kf = market.plugins.find((p: { name: string }) => p.name === "kf");
    expect(kf).toBeDefined();
    expect(kf.source).toBe("./");
  });

  it("ships .claude-plugin and assets in the published files", () => {
    expect(pkg.files).toContain(".claude-plugin");
    expect(pkg.files).toContain("assets");
  });

  it("only references bundled paths that exist", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of skillDocs()) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./<>-]*)/g)) {
        // A placeholder (<name>, <skill>, <x>) cannot be resolved, so the path up to it must exist.
        const rel = m[1].split("<")[0].replace(/[.,;:]+$/, "");
        checked++;
        if (!existsSync(join(ROOT, rel))) missing.push(`${relative(ROOT, file)}: \${CLAUDE_PLUGIN_ROOT}/${rel}`);
      }
    }
    expect(checked, "skills reference bundled files through the plugin root").toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it("keeps CLAUDE_PLUGIN_ROOT out of every agent body", () => {
    const files = agentDocs();
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("CLAUDE_PLUGIN_ROOT")).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  const claude = spawnSync("which", ["claude"], { encoding: "utf8" });
  const hasClaude = claude.status === 0;
  // Skipped with a reason when the claude CLI is not installed: validation needs the real binary.
  it.skipIf(!hasClaude)("passes claude plugin validate at the repository root", () => {
    expect(existsSync(join(ROOT, ".claude-plugin", "plugin.json")), "plugin manifest exists to validate").toBe(true);
    const res = spawnSync("claude", ["plugin", "validate", ROOT], { encoding: "utf8", timeout: 60_000 });
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
  });
});

describe("no leftover pre-plugin names", () => {
  const SELF = "src/tests/plugin-package.test.ts";
  const EXCLUDED = [":(exclude)src/cli/commands/autoconfig.ts", ":(exclude)src/cli/args.ts", ":(exclude)src/project/bootstrap.ts", ":(exclude)src/tests/fixtures/kanban-ship-0.13.0", ":(exclude)src/integrations/managed.ts", `:(exclude)${SELF}`];
  // Only tests that seed legacy kanban-* names on disk to prove migration and doctor handling may spell them, plus the docs grep test whose literals are search patterns.
  const SEEDING_TESTS = new Set(["src/tests/migration.test.ts", "src/tests/doctor-plugin.test.ts", "src/tests/doctor.test.ts", "src/tests/spike-surface.test.ts", "src/tests/docs-plugin-surface.test.ts"]);
  const SCOPE = ["assets", ".claude-plugin", "src"];

  function grep(pattern: string): string[] {
    const res = spawnSync("git", ["grep", "-nE", pattern, "--", ...SCOPE, ...EXCLUDED], { cwd: ROOT, encoding: "utf8" });
    if (res.status === 1) return [];
    expect(res.status, res.stderr).toBe(0);
    return res.stdout.split("\n").filter(Boolean).filter((l) => !SEEDING_TESTS.has(l.split(":")[0]));
  }

  it("has no kanban-<skill> name outside the legacy list and its migration tests", () => {
    expect(grep("kanban-(brainstorm|plan|implement|test|review|archive|bug)([^A-Za-z0-9_]|$)")).toEqual([]);
  });

  it("has no kanban-flow skill path or name outside the legacy list and its migration tests", () => {
    const lines = grep("(^|[^A-Za-z0-9_@./~-])/kanban-flow([^A-Za-z0-9_-]|$)|Skill\\(kanban-flow|skills/kanban-flow|kanban-flow skill|kanban-flow/(SKILL|agents|references)");
    // Product-name uses stay: package and repo names, the config dir, the package dirs, and the process-detection regex.
    const product = [
      /@phuthuycoding\/kanban-flow/,
      /github\.com\/phuthuycoding\/kanban-flow/,
      /\.config\/kanban-flow/,
      /kanban-flow\/(templates|review|github-hooks|hooks|skills)/,
    ];
    expect(lines.filter((l) => !l.startsWith("src/shared/process.ts:") && !product.some((re) => re.test(l)))).toEqual([]);
  });
});

describe("install and uninstall leave user-owned bare-name skill dirs alone", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  async function seeded(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "kfw-bare-"));
    dirs.push(dir);
    for (const name of ["test", "plan", "review"]) {
      await mkdir(join(dir, name), { recursive: true });
      await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\n---\nmine ${name}\n`);
    }
    return dir;
  }

  async function expectUntouched(dir: string): Promise<void> {
    for (const name of ["test", "plan", "review"]) {
      expect(await readFile(join(dir, name, "SKILL.md"), "utf8")).toBe(`---\nname: ${name}\n---\nmine ${name}\n`);
      expect(readdirSync(join(dir, name))).toEqual(["SKILL.md"]);
    }
  }

  it("keeps them through a copy install, a link install, a removal and a retired-skill sweep", async () => {
    const dir = await seeded();
    expect((await copySkillsTo(dir)).code).toBe(0);
    await expectUntouched(dir);
    expect((await linkOrCopySkillsTo(dir)).code).toBe(0);
    await expectUntouched(dir);
    await removeSkillsFrom(dir);
    await expectUntouched(dir);
    await removeRetiredSkills(dir);
    await expectUntouched(dir);
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
