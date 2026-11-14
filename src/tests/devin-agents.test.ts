import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentById } from "../integrations/agents.js";
import { MANAGED_AGENTS, PKG_AGENTS_DIR, agentEntryState, agentsState, installAgentsTo, cmdInstall, cmdUninstall, installSkills } from "../integrations/install.js";
import { renderAgentProfile } from "../integrations/skill-render.js";

// The devin registry entry carries the agents-target descriptor the lifecycle calls read:
// managed name kf-<seat>.md, expected bytes = the rendered profile, linking forbidden.
const DEVIN = agentById("devin")!;

let dir: string;
const HOME = () => process.env.HOME!;
const devinAgentsDir = () => join(HOME(), ".config", "devin", "agents");
const sharedSkillsDir = () => join(HOME(), ".agents", "skills");

const managed = (seat: string): string => `kf-${seat}.md`;
const packaged = (seat: string): string => readFileSync(join(PKG_AGENTS_DIR, `${seat}.md`), "utf8");
const rendered = (seat: string): string => renderAgentProfile(packaged(seat), seat);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const MANIFEST = ".kanban-flow-agents.json";

async function readManifest(agentsDir: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(agentsDir, MANIFEST), "utf8"));
}

/** A project root the scoped commands can resolve (findWorksRoot + readProjectConfig). */
async function projectDir(agents: string[]): Promise<string> {
  await mkdir(join(dir, ".works"), { recursive: true });
  await mkdir(join(dir, ".kf"), { recursive: true });
  await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", agents }));
  return dir;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-devin-agents-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("kf install for devin at global scope", () => {
  it("writes the seven seats as regular rendered kf-<seat>.md files under the devin user agents dir", async () => {
    const res = await cmdInstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);

    const agents = devinAgentsDir();
    for (const seat of MANAGED_AGENTS) {
      const file = join(agents, managed(seat));
      expect(existsSync(file), file).toBe(true);
      // Rendered profiles are copies — never symlinks, even at global scope where other targets link.
      expect(lstatSync(file).isSymbolicLink(), file).toBe(false);
      expect(await readFile(file, "utf8"), file).toBe(rendered(seat));
      // The bare seat name belongs to the user under this target; nothing writes it.
      expect(existsSync(join(agents, `${seat}.md`)), `${seat}.md`).toBe(false);
    }

    // The sidecar records the sha256 of each rendered copy, keyed by the managed name.
    const manifest = await readManifest(agents);
    expect(Object.keys(manifest).sort()).toEqual(MANAGED_AGENTS.map((s) => `kf-${s}`).sort());
    for (const seat of MANAGED_AGENTS) {
      expect(manifest[`kf-${seat}`], seat).toBe(sha256(rendered(seat)));
    }
  });

  it("names the devin agents dir and the Devin CLI restart in the install summary", async () => {
    const res = await cmdInstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(devinAgentsDir());
    // One line tells the user Devin CLI itself needs a restart to pick the profiles up.
    expect(res.stdout.split("\n").some((line) => /devin/i.test(line) && /restart/i.test(line))).toBe(true);
  });

  it("converges on a second run — every profile reports copied against the rendered bytes", async () => {
    expect((await cmdInstall(["devin"], { cwd: dir, scope: "global" })).code).toBe(0);
    const res = await cmdInstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(agentsState(devinAgentsDir(), DEVIN)).toBe("copied");
  });
});

describe("installAgentsTo on the devin target", () => {
  it("lands copies even when the caller asks for links, and the dir then reads copied", async () => {
    const agents = join(dir, "devin-agents");
    const res = await installAgentsTo(agents, "link", DEVIN);
    expect(res.code).toBe(0);
    expect(res.mode).toBe("copy");
    for (const seat of MANAGED_AGENTS) {
      const file = join(agents, managed(seat));
      expect(existsSync(file), file).toBe(true);
      expect(lstatSync(file).isSymbolicLink(), file).toBe(false);
      expect(await readFile(file, "utf8"), file).toBe(rendered(seat));
    }
    expect(agentsState(agents, DEVIN)).toBe("copied");
  });

  it("reads copied only for rendered-equal bytes — the packaged Claude file at a managed name is never copied", async () => {
    const agents = join(dir, "devin-agents");
    await mkdir(agents, { recursive: true });
    // A kf-<seat>.md holding the raw packaged body differs from the render by design:
    // unrecorded it is foreign; recorded by the manifest it is an outdated copy of ours.
    await writeFile(join(agents, managed("developer")), packaged("developer"));
    expect(agentEntryState(agents, "developer", DEVIN)).toBe("foreign");

    await writeFile(join(agents, MANIFEST), JSON.stringify({ "kf-developer": sha256(packaged("developer")) }));
    expect(agentEntryState(agents, "developer", DEVIN)).toBe("stale");
  });

  it("maps each seeded seat state and aggregates missing, partial, stale and foreign", async () => {
    const agents = join(dir, "devin-agents");
    expect(agentsState(agents, DEVIN)).toBe("missing");
    expect(agentEntryState(agents, "scout", DEVIN)).toBe("absent");

    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, managed("scout")), rendered("scout"));
    expect(agentEntryState(agents, "scout", DEVIN)).toBe("copied");
    expect(agentsState(agents, DEVIN)).toBe("partial");

    // A file hashing to what an earlier render wrote is our outdated copy: stale, not foreign.
    const older = "---\nname: kf-developer\ndescription: an older render\n---\nold\n";
    await writeFile(join(agents, managed("developer")), older);
    await writeFile(join(agents, MANIFEST), JSON.stringify({ "kf-developer": sha256(older) }));
    expect(agentEntryState(agents, "developer", DEVIN)).toBe("stale");
    expect(agentsState(agents, DEVIN)).toBe("stale");

    // Unrecorded bytes at a managed name are the user's file.
    const foreign = "---\nname: kf-code-reviewer\ndescription: hand-made\n---\nmine\n";
    await writeFile(join(agents, managed("code-reviewer")), foreign);
    expect(agentEntryState(agents, "code-reviewer", DEVIN)).toBe("foreign");
    expect(agentsState(agents, DEVIN)).toBe("foreign");
  });

  it("rewrites a stale profile to the current render and then stays copied", async () => {
    const agents = join(dir, "devin-agents");
    await installAgentsTo(agents, "copy", DEVIN);
    const older = "---\nname: kf-scout\ndescription: an older render\n---\nold\n";
    await writeFile(join(agents, managed("scout")), older);
    const manifest = await readManifest(agents);
    manifest["kf-scout"] = sha256(older);
    await writeFile(join(agents, MANIFEST), JSON.stringify(manifest));
    expect(agentEntryState(agents, "scout", DEVIN)).toBe("stale");

    await installAgentsTo(agents, "copy", DEVIN);
    expect(agentEntryState(agents, "scout", DEVIN)).toBe("copied");
    expect(agentsState(agents, DEVIN)).toBe("copied");
  });
});

describe("kf install for devin at project scope", () => {
  it("writes the rendered profiles under .devin/agents", async () => {
    await projectDir(["devin"]);
    const res = await cmdInstall(["devin"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);

    const agents = join(dir, ".devin", "agents");
    for (const seat of MANAGED_AGENTS) {
      const file = join(agents, managed(seat));
      expect(existsSync(file), file).toBe(true);
      expect(lstatSync(file).isSymbolicLink(), file).toBe(false);
      expect(await readFile(file, "utf8"), file).toBe(rendered(seat));
    }
  });

  it("removes the owned project profiles on a later global install and keeps a foreign one", async () => {
    await projectDir(["devin"]);
    expect((await cmdInstall(["devin"], { cwd: dir, scope: "project" })).code).toBe(0);
    const projectAgents = join(dir, ".devin", "agents");
    const foreign = "---\nname: kf-scout\ndescription: my own shim\n---\nmine\n";
    await writeFile(join(projectAgents, managed("scout")), foreign);

    const res = await cmdInstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    for (const seat of MANAGED_AGENTS) {
      if (seat === "scout") continue;
      expect(existsSync(join(projectAgents, managed(seat))), seat).toBe(false);
    }
    expect(await readFile(join(projectAgents, managed("scout")), "utf8")).toBe(foreign);
    expect(existsSync(join(devinAgentsDir(), managed("developer")))).toBe(true);
  });
});

describe("a foreign file at a managed devin profile name", () => {
  it("is skipped and named on install, and its bytes stay untouched", async () => {
    const agents = devinAgentsDir();
    await mkdir(agents, { recursive: true });
    const foreign = "---\nname: kf-code-reviewer\ndescription: hand-made shim\n---\nmine\n";
    await writeFile(join(agents, managed("code-reviewer")), foreign);

    const res = await cmdInstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("kf-code-reviewer.md");
    expect(await readFile(join(agents, managed("code-reviewer")), "utf8")).toBe(foreign);
    expect(agentEntryState(agents, "code-reviewer", DEVIN)).toBe("foreign");
    expect(existsSync(join(agents, managed("developer")))).toBe(true);
  });
});

describe("kf uninstall for devin", () => {
  it("removes the owned profiles and keeps and names a foreign one", async () => {
    expect((await cmdInstall(["devin"], { cwd: dir, scope: "global" })).code).toBe(0);
    const agents = devinAgentsDir();
    const foreign = "---\nname: kf-scout\ndescription: hand-made shim\n---\nmine\n";
    await writeFile(join(agents, managed("scout")), foreign);

    const res = await cmdUninstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    for (const seat of MANAGED_AGENTS) {
      if (seat === "scout") continue;
      expect(existsSync(join(agents, managed(seat))), seat).toBe(false);
    }
    expect(await readFile(join(agents, managed("scout")), "utf8")).toBe(foreign);
    expect(res.stdout).toContain("kf-scout.md");
    expect(existsSync(join(agents, MANIFEST))).toBe(false);
  });

  it("still cleans the devin agents dir when the shared skills dir is kept for another declared runtime", async () => {
    await projectDir(["codex", "devin"]);
    expect((await cmdInstall(["codex", "devin"], { cwd: dir, scope: "global" })).code).toBe(0);
    expect(existsSync(join(devinAgentsDir(), managed("scout")))).toBe(true);

    // Codex is declared and not uninstalled, so the shared .agents/skills copies stay —
    // but that decision must not skip the devin agents dir.
    const res = await cmdUninstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(existsSync(join(sharedSkillsDir(), "kf-flow", "SKILL.md"))).toBe(true);
    for (const seat of MANAGED_AGENTS) {
      expect(existsSync(join(devinAgentsDir(), managed(seat))), seat).toBe(false);
    }
  });

  it("still cleans the devin agents dir when codex handled the shared skills dir first in the same run", async () => {
    await projectDir(["codex", "devin"]);
    expect((await cmdInstall(["codex", "devin"], { cwd: dir, scope: "global" })).code).toBe(0);
    expect(existsSync(join(devinAgentsDir(), managed("scout")))).toBe(true);

    const res = await cmdUninstall(["codex", "devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    for (const seat of MANAGED_AGENTS) {
      expect(existsSync(join(devinAgentsDir(), managed(seat))), seat).toBe(false);
    }
  });

  it("reports already clean when nothing is installed", async () => {
    const res = await cmdUninstall(["devin"], { cwd: dir, scope: "global" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already clean");
  });
});

describe("one install run covering devin and a runtime that shares its skills dir", () => {
  it("writes the devin profiles when codex wrote the shared skills dir first", async () => {
    const res = await installSkills(dir, ["codex", "devin"], "global");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("reads the copies written for");
    for (const seat of MANAGED_AGENTS) {
      expect(existsSync(join(devinAgentsDir(), managed(seat))), seat).toBe(true);
    }
  });

  it("writes the devin profiles when devin precedes codex in the same run", async () => {
    const res = await installSkills(dir, ["devin", "codex"], "global");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("reads the copies written for");
    for (const seat of MANAGED_AGENTS) {
      expect(existsSync(join(devinAgentsDir(), managed(seat))), seat).toBe(true);
    }
  });
});
