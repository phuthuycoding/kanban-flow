import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readlink, symlink, chmod } from "node:fs/promises";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";

import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";
import { PKG_ROOT } from "../shared/paths.js";

import {
  PKG_AGENTS_DIR,
  agentEntryState,
  agentSkillsState,
  copySkillsTo,
  installSkills,
  ownsSkillEntry,
  skillEntryState,
  installAgentsTo,
  legacyEntries,
  legacyLines,
  linkOrCopySkillsTo,
  removeLegacy,
  removeRetiredSkills,
} from "../integrations/install.js";
import { copyName, MANAGED_AGENTS, MANAGED_SKILLS } from "../integrations/managed.js";

// An upgrade must recognise what an earlier kf put on disk in either package layout: links into
// <pkg>/skills|agents (old) and <pkg>/assets/skills|agents (new). Ownership is decided by the kf
// plugin manifest at the package root, so the fixture roots carry arbitrary directory names.
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-layout-upgrade-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type Layout = "old" | "new";
const LAYOUTS: Layout[] = ["old", "new"];

function inPackage(pkg: string, layout: Layout, kind: "skills" | "agents", leaf: string): string {
  return layout === "old" ? join(pkg, kind, leaf) : join(pkg, "assets", kind, leaf);
}

/** A fixture package root holding the given plugin manifest (null = no manifest), its agent and skill files in the given layout. */
async function fixturePackage(name: string, layout: Layout, pluginName: string | null, skills: string[]): Promise<string> {
  const pkg = join(dir, name);
  await mkdir(inPackage(pkg, layout, "agents", "."), { recursive: true });
  await writeFile(inPackage(pkg, layout, "agents", "scout.md"), "scout of a fixture package");
  for (const skill of skills) {
    await mkdir(inPackage(pkg, layout, "skills", skill), { recursive: true });
    await writeFile(join(inPackage(pkg, layout, "skills", skill), "SKILL.md"), `---\nname: ${skill}\n---\n${skill}\n`);
  }
  if (pluginName !== null) {
    await mkdir(join(pkg, ".claude-plugin"), { recursive: true });
    await writeFile(join(pkg, ".claude-plugin", "plugin.json"), JSON.stringify({ name: pluginName }));
  }
  return pkg;
}

async function agentLinkTo(agentsDir: string, target: string, name = "scout"): Promise<void> {
  await mkdir(agentsDir, { recursive: true });
  await symlink(target, join(agentsDir, `${name}.md`), "file");
}

async function skillLinkTo(skillsDir: string, entry: string, target: string): Promise<void> {
  await mkdir(skillsDir, { recursive: true });
  await symlink(target, join(skillsDir, entry), "dir");
}

describe("agent entry state across package layouts", () => {
  for (const layout of LAYOUTS) {
    it(`reports a live link into a kf package in the ${layout} layout as stale, never foreign`, async () => {
      const pkg = await fixturePackage("my-checkout", layout, "kf", []);
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(pkg, layout, "agents", "scout.md"));
      expect(agentEntryState(agents, "scout")).toBe("stale");
    });

    it(`reports a link into a non-kf package in the ${layout} layout as foreign`, async () => {
      const pkg = await fixturePackage("other-checkout", layout, "other", []);
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(pkg, layout, "agents", "scout.md"));
      expect(agentEntryState(agents, "scout")).toBe("foreign");
    });

    it(`reports a link into a package without a manifest in the ${layout} layout as foreign`, async () => {
      const pkg = await fixturePackage("bare-checkout", layout, null, []);
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(pkg, layout, "agents", "scout.md"));
      expect(agentEntryState(agents, "scout")).toBe("foreign");
    });

    it(`reports a dangling link into a deleted kanban-flow package dir in the ${layout} layout as stale`, async () => {
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(join(dir, "gone", "node_modules", "kanban-flow"), layout, "agents", "scout.md"));
      expect(agentEntryState(agents, "scout")).toBe("stale");
    });
  }

  it("reports a copy whose hash the sidecar manifest recorded as stale", async () => {
    const agents = join(dir, "agents");
    await mkdir(agents, { recursive: true });
    const body = "scout rendered by an earlier release";
    await writeFile(join(agents, "scout.md"), body);
    await writeFile(join(agents, ".kanban-flow-agents.json"), JSON.stringify({ scout: createHash("sha256").update(body).digest("hex") }));
    expect(agentEntryState(agents, "scout")).toBe("stale");
  });

  it("never claims the user's own file at an agent name", async () => {
    const agents = join(dir, "agents");
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, "scout.md"), "my own scout");
    expect(agentEntryState(agents, "scout")).toBe("foreign");
  });
});

describe("installing agents over links from either layout", () => {
  for (const layout of LAYOUTS) {
    it(`replaces a live link into a kf package in the ${layout} layout with the current install`, async () => {
      const pkg = await fixturePackage("my-checkout", layout, "kf", []);
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(pkg, layout, "agents", "scout.md"));
      const res = await installAgentsTo(agents, "link");
      expect(res.code).toBe(0);
      expect(await readlink(join(agents, "scout.md"))).toBe(join(PKG_AGENTS_DIR, "scout.md"));
      expect(res.stdout).not.toContain("left untouched");
    });

    it(`replaces a dangling link into a deleted kanban-flow dir in the ${layout} layout`, async () => {
      const agents = join(dir, "agents");
      await agentLinkTo(agents, inPackage(join(dir, "gone", "kanban-flow"), layout, "agents", "scout.md"));
      const res = await installAgentsTo(agents, "link");
      expect(await readlink(join(agents, "scout.md"))).toBe(join(PKG_AGENTS_DIR, "scout.md"));
      expect(res.stdout).not.toContain("left untouched");
    });
  }

  it("leaves the user's own file and a link into a non-kf dir untouched and names them", async () => {
    const other = await fixturePackage("not-kf", "new", "other", []);
    const agents = join(dir, "agents");
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, "scout.md"), "my own scout");
    await agentLinkTo(agents, inPackage(other, "new", "agents", "scout.md"), "researcher");
    const res = await installAgentsTo(agents, "link");
    expect(lstatSync(join(agents, "scout.md")).isSymbolicLink()).toBe(false);
    expect(await readlink(join(agents, "researcher.md"))).toBe(inPackage(other, "new", "agents", "scout.md"));
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("scout.md");
    expect(res.stdout).toContain("researcher.md");
  });

  it("relinks a dangling agent link into a deleted dir not named kanban-flow", async () => {
    const agents = join(dir, "agents");
    await agentLinkTo(agents, join(dir, "deleted-dir", "agents", "scout.md"));
    const res = await installAgentsTo(agents, "link");
    expect(res.code).toBe(0);
    expect(await readlink(join(agents, "scout.md"))).toBe(join(PKG_AGENTS_DIR, "scout.md"));
  });
});

describe("installing skill copies over links from either layout", () => {
  for (const layout of LAYOUTS) {
    it(`replaces a live skill link into a kf package in the ${layout} layout with a rendered copy`, async () => {
      const pkg = await fixturePackage("my-checkout", layout, "kf", ["review"]);
      const skills = join(dir, "skills-home");
      await skillLinkTo(skills, copyName("review"), inPackage(pkg, layout, "skills", "review"));
      const res = await linkOrCopySkillsTo(skills);
      expect(res.code).toBe(0);
      const entry = join(skills, copyName("review"));
      expect(lstatSync(entry).isSymbolicLink()).toBe(false);
      expect(existsSync(join(entry, "SKILL.md"))).toBe(true);
      expect(res.stdout).not.toContain("left untouched");
    });

    it(`replaces a dangling skill link into a deleted kanban-flow dir in the ${layout} layout`, async () => {
      const skills = join(dir, "skills-home");
      await skillLinkTo(skills, copyName("review"), inPackage(join(dir, "gone", "kanban-flow"), layout, "skills", "review"));
      const res = await linkOrCopySkillsTo(skills);
      expect(res.code).toBe(0);
      expect(lstatSync(join(skills, copyName("review"))).isSymbolicLink()).toBe(false);
      expect(res.stdout).not.toContain("left untouched");
    });
  }

  it("leaves a skill link into a non-kf package untouched and names it", async () => {
    const other = await fixturePackage("not-kf", "new", "other", ["review"]);
    const skills = join(dir, "skills-home");
    await skillLinkTo(skills, copyName("review"), inPackage(other, "new", "skills", "review"));
    const res = await linkOrCopySkillsTo(skills);
    expect(await readlink(join(skills, copyName("review")))).toBe(inPackage(other, "new", "skills", "review"));
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain(copyName("review"));
  });
});

describe("removing the retired skill", () => {
  for (const layout of LAYOUTS) {
    it(`removes a live link into a kf package in the ${layout} layout`, async () => {
      const pkg = await fixturePackage("my-checkout", layout, "kf", ["kanban-ship"]);
      const skills = join(dir, "skills");
      await skillLinkTo(skills, "kanban-ship", inPackage(pkg, layout, "skills", "kanban-ship"));
      const res = await removeRetiredSkills(skills);
      expect(res).toEqual({ removed: ["kanban-ship"], kept: [] });
      expect(lstatSync(join(skills, "kanban-ship"), { throwIfNoEntry: false })).toBeUndefined();
    });

    it(`removes a dangling link into a deleted kanban-flow dir in the ${layout} layout`, async () => {
      const skills = join(dir, "skills");
      await skillLinkTo(skills, "kanban-ship", inPackage(join(dir, "gone", "kanban-flow"), layout, "skills", "kanban-ship"));
      const res = await removeRetiredSkills(skills);
      expect(res).toEqual({ removed: ["kanban-ship"], kept: [] });
    });
  }

  it("keeps and reports a dangling link into a deleted dir not named kanban-flow, without crashing", async () => {
    const skills = join(dir, "skills");
    await skillLinkTo(skills, "kanban-ship", join(dir, "deleted-dir", "skills", "kanban-ship"));
    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: [], kept: ["kanban-ship"] });
    expect(lstatSync(join(skills, "kanban-ship")).isSymbolicLink()).toBe(true);
  });

  it("keeps a link into a non-kf package", async () => {
    const other = await fixturePackage("not-kf", "new", "other", ["kanban-ship"]);
    const skills = join(dir, "skills");
    await skillLinkTo(skills, "kanban-ship", inPackage(other, "new", "skills", "kanban-ship"));
    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: [], kept: ["kanban-ship"] });
  });
});

describe("removing legacy entries", () => {
  const LEGACY_NAMES = ["kanban-flow", "travel", "kanban-ship"];

  for (const layout of LAYOUTS) {
    it(`removes legacy kanban-flow, bare travel and retired kanban-ship links into a kf package in the ${layout} layout`, async () => {
      const pkg = await fixturePackage("my-checkout", layout, "kf", LEGACY_NAMES);
      const root = join(dir, "project");
      const skills = join(root, ".claude", "skills");
      for (const name of LEGACY_NAMES) await skillLinkTo(skills, name, inPackage(pkg, layout, "skills", name));
      const results = await removeLegacy(root, "project");
      const slot = results.find((r) => r.dir === skills);
      expect(slot?.removed.slice().sort()).toEqual([...LEGACY_NAMES].sort());
      expect(slot?.kept).toEqual([]);
      const lines = legacyLines(results).join("\n");
      for (const name of LEGACY_NAMES) expect(lines).toContain(name);
      expect(lines).not.toContain("kept");
    });

    it(`removes legacy and travel links into a deleted kanban-flow dir in the ${layout} layout`, async () => {
      const root = join(dir, "project");
      const skills = join(root, ".claude", "skills");
      for (const name of LEGACY_NAMES) await skillLinkTo(skills, name, inPackage(join(dir, "gone", "kanban-flow"), layout, "skills", name));
      const results = await removeLegacy(root, "project");
      const slot = results.find((r) => r.dir === skills);
      expect(slot?.removed.slice().sort()).toEqual([...LEGACY_NAMES].sort());
      expect(slot?.kept).toEqual([]);
    });
  }

  it("keeps a bare travel link into a non-kf package and names it", async () => {
    const other = await fixturePackage("not-kf", "new", "other", ["travel"]);
    const root = join(dir, "project");
    const skills = join(root, ".claude", "skills");
    await skillLinkTo(skills, "travel", inPackage(other, "new", "skills", "travel"));
    const entries = legacyEntries(root, "project").filter((e) => e.dir === skills);
    expect(entries).toEqual([{ dir: skills, name: "travel", owned: false }]);
    const results = await removeLegacy(root, "project");
    expect(legacyLines(results).join("\n")).toContain("kept travel");
    expect(lstatSync(join(skills, "travel")).isSymbolicLink()).toBe(true);
  });
});

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

const findingLines = (stdout: string) => stdout.split("\n").filter((l) => /^\s+\[(ERROR|WARNING)\]/.test(l));

describe("upgrading a home that holds links from an earlier install", () => {
  let root: string;

  /** A claude that reports the kf plugin installed from this package, so only skills and agents can raise findings. */
  async function stubClaude(): Promise<void> {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
    await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
    await chmod(join(bin, "claude"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
  }

  /** Links in HOME into an earlier kf package: skills alternate live and dangling, agents likewise, plus a legacy kanban-flow link. */
  async function seedHome(layout: Layout): Promise<string> {
    const pkg = await fixturePackage("earlier-install", layout, "kf", [...MANAGED_SKILLS, "kanban-flow"]);
    for (const a of MANAGED_AGENTS) await writeFile(inPackage(pkg, layout, "agents", `${a}.md`), `agent ${a}`);
    const gone = join(dir, "gone", "kanban-flow");
    const home = process.env.HOME!;
    const skills = join(home, ".agents", "skills");
    const agents = join(home, ".claude", "agents");
    for (const [i, name] of MANAGED_SKILLS.entries()) {
      const from = i % 2 === 0 ? pkg : gone;
      await skillLinkTo(skills, copyName(name), inPackage(from, layout, "skills", name));
    }
    for (const [i, a] of MANAGED_AGENTS.entries()) {
      const from = i % 2 === 0 ? pkg : gone;
      await agentLinkTo(agents, inPackage(from, layout, "agents", `${a}.md`), a);
    }
    await skillLinkTo(join(home, ".claude", "skills"), "kanban-flow", inPackage(pkg, layout, "skills", "kanban-flow"));
    return pkg;
  }

  beforeEach(async () => {
    root = join(dir, "proj");
    await mkdir(root);
    await stubClaude();
    const res = await cmdInit(args("init", [], { minimal: true, context: "app", agent: "codex" }), root);
    expect(res.code).toBe(0);
    // --minimal does not record the agent, so the config is patched the way a user's choice would be.
    const cfgPath = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath, JSON.stringify({ ...cfg, agents: ["claude", "codex"] }, null, 2));
    // cmdInit may have installed into HOME; the seeded earlier install replaces it.
    for (const rel of [".claude", ".agents"]) await rm(join(process.env.HOME!, rel), { recursive: true, force: true });
  });

  for (const layout of LAYOUTS) {
    it(`reads every earlier ${layout}-layout skill and agent link as ours before the install`, async () => {
      await seedHome(layout);
      const skills = join(process.env.HOME!, ".agents", "skills");
      for (const name of MANAGED_SKILLS) expect(ownsSkillEntry(skills, name, {})).toBe(true);
      for (const a of MANAGED_AGENTS) expect(agentEntryState(join(process.env.HOME!, ".claude", "agents"), a)).toBe("stale");
    });

    it(`replaces the earlier ${layout}-layout skill links with the current install`, async () => {
      const pkg = await seedHome(layout);
      const skills = join(process.env.HOME!, ".agents", "skills");
      const res = await installSkills(root, ["codex"], "global");
      expect(res.code).toBe(0);
      expect(res.stdout).not.toContain("left untouched");
      expect(["linked", "copied"]).toContain(agentSkillsState(skills));
      for (const name of MANAGED_SKILLS) {
        const entry = join(skills, copyName(name));
        if (lstatSync(entry).isSymbolicLink()) expect((await readlink(entry)).startsWith(pkg)).toBe(false);
        expect(skillEntryState(skills, name)).not.toBe("broken-link");
      }
    });

    it(`leaves no finding after one doctor --fix over an earlier ${layout}-layout install`, async () => {
      await seedHome(layout);
      const fixed = await cmdDoctor(args("doctor", [], { fix: true }), root);
      expect(fixed.stdout).not.toMatch(/\[ERROR\]/);
      const after = await cmdDoctor(args("doctor"), root);
      expect(findingLines(after.stdout)).toEqual([]);
      expect(after.code).toBe(0);
    });
  }
});

describe("a copy runtime holding skills rendered from the old layout", () => {
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

  function filesOf(base: string, rel = ""): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const e of readdirSync(join(base, rel), { withFileTypes: true })) {
      const r = rel === "" ? e.name : join(rel, e.name);
      if (e.isDirectory()) for (const [k, v] of filesOf(base, r)) out.set(k, v);
      else if (e.isFile()) out.set(r, readFileSync(join(base, r)));
    }
    return out;
  }

  /** The digest the sidecar manifest records for a copy: its files by relative path. */
  function digestOf(files: Map<string, Buffer>): string {
    const hash = createHash("sha256");
    for (const name of [...files.keys()].sort()) hash.update(`${name.split(sep).join("/")}\0${sha(files.get(name)!)}\n`);
    return hash.digest("hex");
  }

  it("reports the old-layout copy stale and the install re-renders it to the new layout", async () => {
    const skills = join(process.env.HOME!, ".agents", "skills");
    expect((await copySkillsTo(skills)).code).toBe(0);
    const current = new Map<string, Map<string, Buffer>>();
    for (const name of MANAGED_SKILLS) current.set(name, filesOf(join(skills, copyName(name))));

    // Rewrite the package-root paths of the copies back to the old layout, as the 0.18.0 render wrote them.
    const manifest: Record<string, string> = {};
    let rewritten = 0;
    const rewrittenSkills: string[] = [];
    for (const name of MANAGED_SKILLS) {
      const files = new Map<string, Buffer>();
      for (const [rel, bytes] of current.get(name)!) {
        const text = bytes.toString("utf8");
        const old = rel.endsWith(".md") ? text.split(`${PKG_ROOT}/assets/`).join(`${PKG_ROOT}/`) : text;
        if (old !== text) {
          rewritten++;
          if (!rewrittenSkills.includes(name)) rewrittenSkills.push(name);
          await writeFile(join(skills, copyName(name), rel), old);
        }
        files.set(rel, Buffer.from(old));
      }
      manifest[copyName(name)] = digestOf(files);
    }
    expect(rewritten).toBeGreaterThan(0);
    await writeFile(join(skills, ".kanban-flow-skills.json"), JSON.stringify(manifest, null, 2));

    for (const name of MANAGED_SKILLS) {
      expect(ownsSkillEntry(skills, name, manifest)).toBe(true);
      // A skill whose text names no package path renders the same in both layouts.
      expect(skillEntryState(skills, name)).toBe(rewrittenSkills.includes(name) ? "stale" : "copied");
    }
    expect(agentSkillsState(skills)).toBe("stale");

    const res = await copySkillsTo(skills);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("left untouched");
    expect(agentSkillsState(skills)).toBe("copied");
    for (const name of MANAGED_SKILLS) {
      for (const [rel, bytes] of current.get(name)!) {
        expect(readFileSync(join(skills, copyName(name), rel)).equals(bytes)).toBe(true);
      }
    }
    expect(existsSync(join(skills, copyName("flow"), "SKILL.md"))).toBe(true);
  });
});
