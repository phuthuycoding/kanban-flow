import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile, readlink, symlink, copyFile } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MANAGED_AGENTS, PKG_AGENTS_DIR, agentsState, installAgentsTo, removeAgentsFrom, cmdInstall, cmdUninstall } from "../integrations/install.js";
import { commandHelp } from "../cli/args.js";
import { PKG_ROOT } from "../shared/paths.js";

let dir: string;
const FOREIGN = "---\nname: scout\ndescription: my own scout\n---\nmine\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-agents-install-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(join(process.env.HOME!, ".claude", "agents"), { recursive: true, force: true });
});

describe("the packaged agent definitions", () => {
  it("live at the plugin root and declare the same name in their frontmatter", async () => {
    expect(PKG_AGENTS_DIR).toBe(join(PKG_ROOT, "assets", "agents"));
    for (const name of MANAGED_AGENTS) {
      const file = join(PKG_AGENTS_DIR, `${name}.md`);
      expect(existsSync(file), file).toBe(true);
      const head = (await readFile(file, "utf8")).split("---")[1] ?? "";
      expect(head, file).toMatch(new RegExp(`\\nname:\\s*${name}\\s*\\n`));
      expect(head, file).toMatch(/\ndescription:\s*\S/);
    }
  });

  it("ship in the tarball beside the skills", async () => {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("assets");
  });
});

describe("installAgentsTo / removeAgentsFrom", () => {
  it("copies the managed agents and removes only them", async () => {
    const target = join(dir, "agents");
    const res = await installAgentsTo(target, "copy");
    expect(res.code).toBe(0);
    expect(res.mode).toBe("copy");
    for (const name of MANAGED_AGENTS) expect(existsSync(join(target, `${name}.md`))).toBe(true);
    expect(agentsState(target)).toBe("copied");
    await writeFile(join(target, "mine.md"), "---\nname: mine\n---\n");

    const { removed, kept } = await removeAgentsFrom(target);
    expect(removed).toHaveLength(MANAGED_AGENTS.length);
    expect(kept).toEqual([]);
    for (const name of MANAGED_AGENTS) expect(existsSync(join(target, `${name}.md`))).toBe(false);
    expect(existsSync(join(target, "mine.md"))).toBe(true);
    expect(existsSync(join(target, ".kanban-flow-agents.json"))).toBe(false);
  });

  it("links the managed agents into the package at global mode", async () => {
    const target = join(dir, "agents");
    const res = await installAgentsTo(target, "link");
    expect(res.code).toBe(0);
    expect(res.mode).toBe("link");
    expect(lstatSync(join(target, "code-reviewer.md")).isSymbolicLink()).toBe(true);
    expect(await readlink(join(target, "code-reviewer.md"))).toBe(join(PKG_AGENTS_DIR, "code-reviewer.md"));
    expect(agentsState(target)).toBe("linked");
  });

  it("never overwrites or removes a user's own file that carries a managed name", async () => {
    const target = join(dir, "agents");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "scout.md"), FOREIGN);

    const res = await installAgentsTo(target, "copy");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("scout.md");
    expect(await readFile(join(target, "scout.md"), "utf8")).toBe(FOREIGN);
    expect(existsSync(join(target, "code-reviewer.md"))).toBe(true);
    expect(agentsState(target)).toBe("foreign");

    const { removed, kept } = await removeAgentsFrom(target);
    expect(kept).toEqual(["scout"]);
    expect(removed.sort()).toEqual(MANAGED_AGENTS.filter((n) => n !== "scout").sort());
    expect(await readFile(join(target, "scout.md"), "utf8")).toBe(FOREIGN);
  });

  it("replaces an outdated copy of its own (the upgrade case) but still not an edited one", async () => {
    const target = join(dir, "agents");
    await installAgentsTo(target, "copy");
    // Simulate a package upgrade: the copy on disk is what an older kf wrote and recorded.
    const old = "---\nname: scout\ndescription: an older packaged scout\n---\nold body\n";
    await writeFile(join(target, "scout.md"), old);
    const manifest = JSON.parse(await readFile(join(target, ".kanban-flow-agents.json"), "utf8"));
    manifest.scout = createHash("sha256").update(old).digest("hex");
    await writeFile(join(target, ".kanban-flow-agents.json"), JSON.stringify(manifest));
    expect(agentsState(target)).toBe("stale");

    const res = await installAgentsTo(target, "copy");
    expect(res.stdout).not.toContain("left untouched");
    expect(await readFile(join(target, "scout.md"), "utf8")).toBe(await readFile(join(PKG_AGENTS_DIR, "scout.md"), "utf8"));
    expect(agentsState(target)).toBe("copied");

    // The same bytes with no manifest record behind them belong to the user.
    await writeFile(join(target, "scout.md"), old);
    expect(agentsState(target)).toBe("foreign");
  });

  it("treats a symlink from another install of this package, or a dangling one, as its own and relinks it", async () => {
    const target = join(dir, "agents");
    await mkdir(target, { recursive: true });
    const elsewhere = join(dir, "other-node", "lib", "node_modules", "@phuthuycoding", "kanban-flow", "skills", "kanban-flow", "agents");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "scout.md"), "older packaged scout");
    await symlink(join(elsewhere, "scout.md"), join(target, "scout.md"), "file");
    const plugin = join(dir, "other-node", "lib", "node_modules", "@phuthuycoding", "kanban-flow", "agents");
    await mkdir(plugin, { recursive: true });
    await writeFile(join(plugin, "developer.md"), "packaged developer of another install");
    await symlink(join(plugin, "developer.md"), join(target, "developer.md"), "file");
    await symlink(join(dir, "gone", "code-reviewer.md"), join(target, "code-reviewer.md"), "file");
    await symlink(join(dir, "mine", "spec-reviewer.md"), join(target, "spec-reviewer.md"), "file");
    await mkdir(join(dir, "mine"), { recursive: true });
    await writeFile(join(dir, "mine", "spec-reviewer.md"), "the user's own agent, linked by hand");
    expect(agentsState(target)).toBe("foreign");

    const res = await installAgentsTo(target, "link");
    expect(res.code).toBe(0);
    expect(await readlink(join(target, "scout.md"))).toBe(join(PKG_AGENTS_DIR, "scout.md"));
    expect(await readlink(join(target, "code-reviewer.md"))).toBe(join(PKG_AGENTS_DIR, "code-reviewer.md"));
    expect(await readlink(join(target, "developer.md"))).toBe(join(PKG_AGENTS_DIR, "developer.md"));
    expect(await readlink(join(target, "spec-reviewer.md"))).toBe(join(dir, "mine", "spec-reviewer.md"));
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("spec-reviewer.md");
  });

  it("writes byte-identical copies of the packaged files under the packaged names", async () => {
    const target = join(dir, "agents");
    const res = await installAgentsTo(target, "copy");
    expect(res.code).toBe(0);
    for (const name of MANAGED_AGENTS) {
      expect(await readFile(join(target, `${name}.md`), "utf8"), name).toBe(await readFile(join(PKG_AGENTS_DIR, `${name}.md`), "utf8"));
      expect(existsSync(join(target, `kf-${name}.md`)), `kf-${name}.md`).toBe(false);
    }
  });

  it("reports empty removal when nothing is installed", async () => {
    const { removed, kept } = await removeAgentsFrom(join(dir, "nowhere"));
    expect(removed).toHaveLength(0);
    expect(kept).toHaveLength(0);
  });
});

describe("kf install / uninstall leave Claude Code agents to the plugin", () => {
  it("writes no agents under .claude/agents for claude at project scope, and nothing for codex", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall(["claude", "codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".claude", "agents"))).toBe(false);
    expect(existsSync(join(dir, ".agents", "agents"))).toBe(false);
    expect(res.stdout).not.toContain("Claude Code agents:");
    expect(res.stdout).not.toContain("OpenAI Codex agents:");
  });

  it("links no agents under the home dir at global scope and keeps a foreign file there", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const home = join(process.env.HOME!, ".claude", "agents");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "scout.md"), FOREIGN);

    const res = await cmdInstall(["claude"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(existsSync(join(home, "code-reviewer.md"))).toBe(false);
    expect(await readFile(join(home, "scout.md"), "utf8")).toBe(FOREIGN);
  });

  it("uninstall leaves the user's own agent files alone", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await mkdir(join(dir, ".claude", "agents"), { recursive: true });
    await writeFile(join(dir, ".claude", "agents", "mine.md"), "---\nname: mine\n---\n");
    await writeFile(join(dir, ".claude", "agents", "scout.md"), FOREIGN);
    // An installed copy of a managed agent beside the foreign one, so the test cannot pass by uninstall doing nothing.
    const owned = join(dir, ".claude", "agents", "developer.md");
    await copyFile(join(PKG_AGENTS_DIR, "developer.md"), owned);

    const res = await cmdUninstall(["claude"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(existsSync(owned)).toBe(false);
    expect(existsSync(join(dir, ".claude", "agents", "mine.md"))).toBe(true);
    expect(await readFile(join(dir, ".claude", "agents", "scout.md"), "utf8")).toBe(FOREIGN);
  });
});

describe("kf install / uninstall help", () => {
  it("names every managed agent", () => {
    for (const command of ["install", "uninstall"]) {
      const help = commandHelp(command);
      expect(help).toContain(`${MANAGED_AGENTS.length} kanban agents`);
      for (const name of MANAGED_AGENTS) {
        expect(help).toContain(name);
      }
    }
  });
});
