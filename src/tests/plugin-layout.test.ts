import { describe, it, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { MANAGED_SKILLS } from "../integrations/install.js";

// Returns every way the plugin manifest disagrees with the files under `root`; empty means in sync.
function manifestDrift(root: string): string[] {
  const problems: string[] = [];
  const manifest = JSON.parse(readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8")) as { skills?: string; agents?: string[] };

  const agentsDir = join(root, "assets", "agents");
  const onDisk = existsSync(agentsDir) ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort().map((f) => `./assets/agents/${f}`) : [];
  const declared = manifest.agents ?? [];
  for (const p of onDisk) if (!declared.includes(p)) problems.push(`agent file without manifest entry: ${p}`);
  for (const p of declared) if (!onDisk.includes(p)) problems.push(`manifest agent entry without file: ${p}`);
  if (declared.join("\n") !== [...declared].sort().join("\n")) problems.push("agents array is not sorted");

  if (manifest.skills !== "./assets/skills/") problems.push(`skills must be ./assets/skills/, got ${String(manifest.skills)}`);
  for (const p of [manifest.skills, ...declared]) {
    if (typeof p !== "string") continue;
    if (!p.startsWith("./")) problems.push(`path does not start with ./: ${p}`);
    else if (!existsSync(join(root, p))) problems.push(`path does not exist: ${p}`);
  }
  for (const name of MANAGED_SKILLS) {
    if (!existsSync(join(root, "assets", "skills", name, "SKILL.md"))) problems.push(`skills dir lacks ${name}/SKILL.md`);
  }
  return problems;
}

describe("plugin manifest layout", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
  });

  it("matches the files under assets/ on the real tree", () => {
    expect(manifestDrift(PKG_ROOT)).toEqual([]);
  });

  it("points skills at ./assets/skills/ and lists the agents sorted", () => {
    const manifest = JSON.parse(readFileSync(join(PKG_ROOT, ".claude-plugin", "plugin.json"), "utf8")) as { skills: string; agents: string[] };
    expect(manifest.skills).toBe("./assets/skills/");
    const files = readdirSync(join(PKG_ROOT, "assets", "agents")).filter((f) => f.endsWith(".md")).sort();
    expect(manifest.agents).toEqual(files.map((f) => `./assets/agents/${f}`));
    expect(MANAGED_SKILLS).toHaveLength(11);
  });

  it("reports an agent file that has no manifest entry", () => {
    const copy = mkdtempSync(join(tmpdir(), "plugin-layout-"));
    temps.push(copy);
    mkdirSync(join(copy, ".claude-plugin"), { recursive: true });
    cpSync(join(PKG_ROOT, ".claude-plugin", "plugin.json"), join(copy, ".claude-plugin", "plugin.json"));
    cpSync(join(PKG_ROOT, "assets", "agents"), join(copy, "assets", "agents"), { recursive: true });
    cpSync(join(PKG_ROOT, "assets", "skills"), join(copy, "assets", "skills"), { recursive: true });
    writeFileSync(join(copy, "assets", "agents", "ghost-agent.md"), "# ghost\n");

    const problems = manifestDrift(copy);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("ghost-agent");
  });
});

describe("npm package contents", () => {
  it("ships assets/ and nothing from the old layout", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PKG_ROOT, encoding: "utf8", timeout: 120_000 });
    const json = JSON.parse(out.slice(out.indexOf("["))) as { files: { path: string }[] }[];
    const paths = json[0]!.files.map((f) => f.path);
    for (const expected of [
      "assets/skills/flow/SKILL.md",
      "assets/agents/code-reviewer.md",
      "assets/templates/phase-1-spec-requirement.md",
      "assets/review/rules/general.md",
      "assets/github-hooks/lib-github.sh",
    ]) expect(paths, expected).toContain(expected);
    const old = paths.filter((p) => /^(skills|agents|kanban-flow)\//.test(p));
    expect(old).toEqual([]);
  }, 150_000);
});
