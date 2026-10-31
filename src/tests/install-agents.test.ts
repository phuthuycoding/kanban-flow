import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MANAGED_AGENTS, installAgentsTo, removeAgentsFrom, cmdInstall, cmdUninstall } from "../integrations/install.js";
import { PKG_ROOT } from "../shared/paths.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-agents-install-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the packaged agent definitions", () => {
  it("exist for every managed agent and declare the same name in their frontmatter", async () => {
    for (const name of MANAGED_AGENTS) {
      const file = join(PKG_ROOT, "agents", `${name}.md`);
      expect(existsSync(file), file).toBe(true);
      const head = (await readFile(file, "utf8")).split("---")[1] ?? "";
      expect(head, file).toMatch(new RegExp(`\\nname:\\s*${name}\\s*\\n`));
      expect(head, file).toMatch(/\ndescription:\s*\S/);
    }
  });

  it("are shipped in the npm tarball", async () => {
    const pkg = JSON.parse(await readFile(join(PKG_ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("agents");
  });
});

describe("installAgentsTo / removeAgentsFrom", () => {
  it("copies the managed agents and removes only them", async () => {
    const target = join(dir, "agents");
    const res = await installAgentsTo(target, "copy");
    expect(res.code).toBe(0);
    expect(res.mode).toBe("copy");
    for (const name of MANAGED_AGENTS) expect(existsSync(join(target, `${name}.md`))).toBe(true);
    await writeFile(join(target, "mine.md"), "---\nname: mine\n---\n");

    const { removed } = await removeAgentsFrom(target);
    expect(removed).toHaveLength(MANAGED_AGENTS.length);
    for (const name of MANAGED_AGENTS) expect(existsSync(join(target, `${name}.md`))).toBe(false);
    expect(existsSync(join(target, "mine.md"))).toBe(true);
  });

  it("reports empty removal when nothing is installed", async () => {
    const { removed } = await removeAgentsFrom(join(dir, "nowhere"));
    expect(removed).toHaveLength(0);
  });
});

describe("kf install / uninstall carry the agents at project scope", () => {
  it("installs the agents into .claude/agents for claude, and nothing for codex", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall(["claude", "codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Claude Code agents:");
    for (const name of MANAGED_AGENTS) {
      expect(existsSync(join(dir, ".claude", "agents", `${name}.md`))).toBe(true);
    }
    expect(existsSync(join(dir, ".agents", "agents"))).toBe(false);
    expect(res.stdout).not.toContain("OpenAI Codex agents:");
  });

  it("uninstall removes the agents with the skills", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall([], { cwd: dir, scope: "project" });
    await writeFile(join(dir, ".claude", "agents", "mine.md"), "---\nname: mine\n---\n");

    const res = await cmdUninstall([], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`removed ${MANAGED_AGENTS.length} agents`);
    for (const name of MANAGED_AGENTS) {
      expect(existsSync(join(dir, ".claude", "agents", `${name}.md`))).toBe(false);
    }
    expect(existsSync(join(dir, ".claude", "agents", "mine.md"))).toBe(true);
  });
});
