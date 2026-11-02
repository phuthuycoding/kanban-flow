import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readdir, writeFile, readFile, symlink } from "node:fs/promises";
import { existsSync, lstatSync, statSync, cpSync, symlinkSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { copySkillsTo, removeSkillsFrom, removeRetiredSkills, MANAGED_SKILLS, RETIRED_SKILLS, cmdInstall, cmdUninstall } from "../integrations/install.js";
import { parseAgentIds, DEFAULT_AGENT, projectSkillsDir, agentById } from "../integrations/agents.js";
import { isLinkedWorktree, PKG_ROOT } from "../shared/paths.js";
import { copyName } from "../integrations/managed.js";
import type { Stage } from "../workflow/schema.js";

/** Skill a worker loads for each stage; backlog has no work to hand off. */
const STAGE_SKILL: Record<Stage, string | null> = {
  brainstorm: "brainstorm",
  planning: "plan",
  backlog: null,
  implementation: "implement",
  testing: "test",
  review: "review",
  done: "archive",
  cancelled: null,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-skill-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("managed skills", () => {
  it("no longer installs a ship stage skill and maps the done stage to the archive skill", () => {
    expect(MANAGED_SKILLS).not.toContain("kanban-ship");
    expect(STAGE_SKILL.done).toBe("archive");
    for (const skill of Object.values(STAGE_SKILL)) if (skill) expect(MANAGED_SKILLS).toContain(skill);
  });

  it("manages the phase skills plus travel and lists kanban-ship as retired", () => {
    expect(MANAGED_SKILLS).toContain("travel");
    expect(RETIRED_SKILLS).toEqual(["kanban-ship"]);
  });

  it.skipIf(process.platform === "win32")("keeps the executable bit of travel's estimates script when copying", async () => {
    await copySkillsTo(dir);
    const script = join(dir, "travel", "scripts", "estimates");
    expect(existsSync(script)).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dir, "travel", "references"))).toBe(true);
  });
});

describe("retired skills", () => {
  it.skipIf(process.platform === "win32")("removes a kanban-ship symlink that points into a kanban-flow package", async () => {
    const pkg = join(dir, "pkg", "kanban-flow", "skills", "kanban-ship");
    await mkdir(pkg, { recursive: true });
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(pkg, join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: ["kanban-ship"], kept: [] });
    expect(() => lstatSync(join(skills, "kanban-ship"))).toThrow();
    expect(existsSync(pkg)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("removes a dangling kanban-ship symlink whose target ends in kanban-flow/skills/kanban-ship", async () => {
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(join(dir, "gone", "kanban-flow", "skills", "kanban-ship"), join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res.removed).toEqual(["kanban-ship"]);
    expect(() => lstatSync(join(skills, "kanban-ship"))).toThrow();
  });

  it("leaves a foreign kanban-ship directory untouched and warns on install", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const foreign = join(dir, ".agents", "skills", "kanban-ship");
    await mkdir(foreign, { recursive: true });
    await writeFile(join(foreign, "SKILL.md"), "mine");

    const res = await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kanban-ship");
    expect(res.stdout).toContain("left untouched");
    expect(await readFile(join(foreign, "SKILL.md"), "utf8")).toBe("mine");
  });

  it.skipIf(process.platform === "win32")("leaves a symlink to somewhere else untouched", async () => {
    const elsewhere = join(dir, "other", "kanban-ship");
    await mkdir(elsewhere, { recursive: true });
    const skills = join(dir, "skills");
    await mkdir(skills, { recursive: true });
    await symlink(elsewhere, join(skills, "kanban-ship"), "dir");

    const res = await removeRetiredSkills(skills);
    expect(res).toEqual({ removed: [], kept: ["kanban-ship"] });
    expect(lstatSync(join(skills, "kanban-ship")).isSymbolicLink()).toBe(true);
  });
});

describe("copySkillsTo / removeSkillsFrom", () => {
  it("copies all managed skills into the target skill dir", async () => {
    const res = await copySkillsTo(dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`→ ${dir}/`);
    expect(await readdir(dir)).toEqual(expect.arrayContaining(MANAGED_SKILLS.map(copyName)));
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, copyName(name), "SKILL.md"))).toBe(true);
    }
  });

  it("removes the managed skills, leaving unrelated dirs intact", async () => {
    await copySkillsTo(dir);
    await mkdir(join(dir, "unrelated"), { recursive: true });

    const { removed } = await removeSkillsFrom(dir);
    expect(removed).toHaveLength(MANAGED_SKILLS.length);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, copyName(name)))).toBe(false);
    }
    expect(existsSync(join(dir, "unrelated"))).toBe(true);
  });

  it("reports empty removal when nothing is installed", async () => {
    const { removed } = await removeSkillsFrom(dir);
    expect(removed).toHaveLength(0);
  });
});

describe("install/uninstall (project scope)", () => {
  it("cmdInstall copies skills into {root}/.agents/skills for a runtime without a plugin", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(join(dir, ".agents", "skills"));
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".agents", "skills", copyName(name), "SKILL.md"))).toBe(true);
    }
  });

  it("cmdInstall refuses outside a kanban project", async () => {
    const res = await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("kf init");
    expect(existsSync(join(dir, ".claude"))).toBe(false);
  });

  it("cmdUninstall removes project-level skills, leaving unrelated dirs intact", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    await mkdir(join(dir, ".agents", "skills", "unrelated"), { recursive: true });

    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`removed ${MANAGED_SKILLS.length} skills`);
    expect(existsSync(join(dir, ".agents", "skills", "unrelated"))).toBe(true);
    for (const name of MANAGED_SKILLS) {
      expect(existsSync(join(dir, ".agents", "skills", copyName(name)))).toBe(false);
    }
  });

  it("install resolves the .works root, not the current subdirectory", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const nested = join(dir, "services", "api");
    await mkdir(nested, { recursive: true });

    await cmdInstall(["codex"], { cwd: nested, scope: "project" });
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(nested, ".agents", "skills"))).toBe(false);
  });

  it("cmdInstall with claude and codex copies only for codex, claude goes through the plugin", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    const res = await cmdInstall(["claude", "codex"], { cwd: dir, scope: "project" });
    expect(res.code).toBe(0);
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(dir, ".claude", "agents"))).toBe(false);
  });

  it("uninstall --purge --force removes skills plus .works/, .kf/ and kanban doc dirs", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    await mkdir(join(dir, ".works", "done", "x"), { recursive: true });
    await mkdir(join(dir, ".kf", "review", "rules"), { recursive: true });
    await mkdir(join(dir, "docs", "requirement"), { recursive: true });
    await mkdir(join(dir, "docs", "notes"), { recursive: true });

    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Purged project data");
    expect(existsSync(join(dir, ".works"))).toBe(false);
    expect(existsSync(join(dir, ".kf"))).toBe(false);
    expect(existsSync(join(dir, "docs", "requirement"))).toBe(false);
    expect(existsSync(join(dir, "docs", "notes"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow"))).toBe(false);
  });

  it("uninstall --purge without --force refuses on non-TTY and deletes nothing", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });

    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--force");
    expect(existsSync(join(dir, ".works"))).toBe(true);
    expect(existsSync(join(dir, ".agents", "skills", "kanban-flow"))).toBe(true);
  });

  it("says the .gitignore line is still there, and does not touch the file", async () => {
    // kf init can add `.works/` to .gitignore. Purge leaves it on purpose — it is the user's
    // file — but a command claiming to have purged the project data has to say what it left,
    // or the line only surfaces later when some unrelated .works/ is quietly ignored.
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    const gitignore = join(dir, ".gitignore");
    const before = "node_modules/\n\n# kanban-flow\n.works/\n";
    await writeFile(gitignore, before);

    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.stdout).toContain(".gitignore still ignores .works/");
    expect(await readFile(gitignore, "utf8"), "the file must come out byte-identical").toBe(before);
  });

  it("stays quiet when .gitignore does not mention .works/", async () => {
    // The notice is only worth anything because its absence means something.
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    await writeFile(join(dir, ".gitignore"), "node_modules/\ndist/\n");
    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("stays quiet when there is no .gitignore at all", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("does not mention .gitignore when uninstalling without --purge", async () => {
    await mkdir(join(dir, ".works"), { recursive: true });
    await cmdInstall(["codex"], { cwd: dir, scope: "project" });
    await writeFile(join(dir, ".gitignore"), "# kanban-flow\n.works/\n");
    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project" });
    expect(res.stdout).not.toContain(".gitignore");
  });

  it("uninstall --purge --force reports when there is no project data", async () => {
    const res = await cmdUninstall(["codex"], { cwd: dir, scope: "project", purge: true, force: true });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No project data");
  });
});

describe("agents adapter", () => {
  it("defaults to claude", () => {
    expect(DEFAULT_AGENT).toBe("claude");
  });

  it("maps each agent to its project skill dir", () => {
    expect(projectSkillsDir(agentById("claude")!, dir)).toBe(join(dir, ".claude", "skills"));
    expect(projectSkillsDir(agentById("codex")!, dir)).toBe(join(dir, ".agents", "skills"));
    expect(projectSkillsDir(agentById("kiro")!, dir)).toBe(join(dir, ".kiro", "skills"));
    expect(projectSkillsDir(agentById("opencode")!, dir)).toBe(join(dir, ".opencode", "skills"));
    expect(projectSkillsDir(agentById("devin")!, dir)).toBe(join(dir, ".devin", "skills"));
  });

  it("parseAgentIds de-dupes and rejects unknown ids", () => {
    expect(parseAgentIds(["claude", "claude"])).toEqual(["claude"]);
    expect(() => parseAgentIds(["claude", "bogus"])).toThrow("Unknown agent 'bogus'");
    expect(parseAgentIds(undefined)).toEqual([]);
    expect(parseAgentIds(["claude", "codex"])).toEqual(["claude", "codex"]);
  });
});

describe("a linked git worktree as the package root", () => {
  it("is not mistaken for a submodule, even one whose gitdir path contains worktrees", () => {
    const sub = join(dir, "sub");
    const nested = join(dir, "nested");
    for (const d of [sub, nested]) mkdirSync(d, { recursive: true });
    mkdirSync(join(dir, ".git", "modules", "x"), { recursive: true });
    writeFileSync(join(sub, ".git"), `gitdir: ${join(dir, ".git", "modules", "x")}\n`);
    mkdirSync(join(dir, ".git", "modules", "foo", "worktrees", "bar"), { recursive: true });
    writeFileSync(join(nested, ".git"), `gitdir: ${join(dir, ".git", "modules", "foo", "worktrees", "bar")}\n`);
    expect(isLinkedWorktree(sub)).toBe(false);
    expect(isLinkedWorktree(nested)).toBe(false);
  });

  it("is recognised for a gitdir that holds a commondir file", () => {
    const wt = join(dir, "wt");
    const gitdir = join(dir, "main", ".git", "worktrees", "wt");
    mkdirSync(wt, { recursive: true });
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(wt, ".git"), `gitdir: ${gitdir}\n`);
    expect(isLinkedWorktree(wt)).toBe(true);
  });

  it("is recognised for a real git worktree add worktree", () => {
    const main = join(dir, "real");
    const wt = join(dir, "real-wt");
    const git = (...a: string[]) => execFileSync("git", ["-C", main, ...a], { stdio: "pipe" });
    mkdirSync(main, { recursive: true });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-q", "-m", "init");
    git("worktree", "add", "-q", wt);
    expect(isLinkedWorktree(wt)).toBe(true);
    expect(isLinkedWorktree(main)).toBe(false);
  });

  it("is recognised by a .git file and not by a .git directory or no .git", () => {
    const linked = join(dir, "linked");
    const primary = join(dir, "primary");
    const bare = join(dir, "bare");
    for (const d of [linked, primary, bare]) mkdirSync(d, { recursive: true });
    const gitdir = join(dir, "common", ".git", "worktrees", "linked");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
    mkdirSync(join(primary, ".git"));
    expect(isLinkedWorktree(linked)).toBe(true);
    expect(isLinkedWorktree(primary)).toBe(false);
    expect(isLinkedWorktree(bare)).toBe(false);
  });

  /** A copy of the built package at `pkg`, so the CLI under test resolves it as its own package root. */
  function stagePackage(pkg: string, gitMarker: "file" | "dir"): void {
    mkdirSync(pkg, { recursive: true });
    cpSync(join(PKG_ROOT, "dist"), join(pkg, "dist"), { recursive: true });
    cpSync(join(PKG_ROOT, "skills"), join(pkg, "skills"), { recursive: true });
    cpSync(join(PKG_ROOT, "agents"), join(pkg, "agents"), { recursive: true });
    cpSync(join(PKG_ROOT, "package.json"), join(pkg, "package.json"));
    symlinkSync(join(PKG_ROOT, "node_modules"), join(pkg, "node_modules"), "dir");
    if (gitMarker === "file") {
      const gitdir = join(dirname(pkg), "common-git", "worktrees", "transient");
      mkdirSync(gitdir, { recursive: true });
      writeFileSync(join(gitdir, "commondir"), "../..\n");
      writeFileSync(join(pkg, ".git"), `gitdir: ${gitdir}\n`);
    }
    else mkdirSync(join(pkg, ".git"));
  }

  /** The suite sets the opt-out for every test; the refusal cases must run without it. */
  function kfFrom(pkg: string, cwd: string, home: string, ...argv: string[]): { code: number; out: string; err: string } {
    return kfWithEnv(pkg, cwd, home, {}, ...argv);
  }

  function kfWithEnv(pkg: string, cwd: string, home: string, extra: Record<string, string>, ...argv: string[]): { code: number; out: string; err: string } {
    const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
    const r = spawnSync(process.execPath, [join(pkg, "dist", "index.js"), ...argv], {
      cwd, encoding: "utf8", env: { ...base, HOME: home, USERPROFILE: home, ...extra },
    });
    if (r.error) throw r.error;
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}`, err: r.stderr };
  }

  async function projectAt(root: string): Promise<void> {
    await mkdir(join(root, ".works"), { recursive: true });
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"] }));
  }

  it("kf install --global refuses, names the primary checkout and links nothing", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "file");

    const res = kfFrom(pkg, cwd, home, "install", "--global", "--agent", "codex");
    expect(res.code, res.out).not.toBe(0);
    expect(res.out).toContain("primary checkout");
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it("kf install --global reports the refusal on stderr with exit 1", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "file");

    const res = kfFrom(pkg, cwd, home, "install", "--global", "--agent", "codex");
    expect(res.code, res.out).toBe(1);
    expect(res.err).toContain("primary checkout");
  });

  it("kf doctor --fix refuses the global link with an error finding and links nothing", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "file");
    await projectAt(root);

    const res = kfFrom(pkg, root, home, "doctor", "--fix");
    expect(res.code, res.out).toBe(1);
    expect(res.out.split("\n").some((l) => l.includes("[ERROR]") && l.includes("primary checkout")), res.out).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it("kf install --project still copies skills from a linked worktree package", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "file");
    await projectAt(root);

    const res = kfFrom(pkg, root, home, "install", "--project", "--agent", "codex");
    expect(res.code, res.out).toBe(0);
    expect(existsSync(join(root, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("kf install --global refuses and names the .git file it cannot read", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "file");
    chmodSync(join(pkg, ".git"), 0o000);

    const res = kfFrom(pkg, cwd, home, "install", "--global", "--agent", "codex");
    expect(res.code, res.out).toBe(1);
    expect(res.err).toContain(join(pkg, ".git"));
    expect(res.err).toContain("EACCES");
    expect(res.err).toContain("primary checkout");
    expect(res.err).not.toMatch(/^\s+at /m);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("kf install --global refuses and names the path when the worktree's gitdir cannot be read", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "file");
    // Exactly as stagePackage writes it into the .git file; the refusal reports the path as git recorded it.
    const gitdir = join(dirname(pkg), "common-git", "worktrees", "transient");
    chmodSync(gitdir, 0o000);
    try {
      const res = kfFrom(pkg, cwd, home, "install", "--global", "--agent", "codex");
      expect(res.code, res.out).toBe(1);
      expect(res.err).toContain(join(gitdir, "commondir"));
      expect(res.err).toContain("EACCES");
      expect(res.err).toContain("primary checkout");
      expect(res.err).not.toContain(join(pkg, ".git"));
      expect(existsSync(join(home, ".claude"))).toBe(false);
    } finally {
      chmodSync(gitdir, 0o755);
    }
  });

  it("kf doctor --fix with an unreadable project config links nothing and still reports the config error", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "dir");
    await mkdir(join(root, ".works"), { recursive: true });
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), "{ not json");

    const res = kfFrom(pkg, root, home, "doctor", "--fix");
    expect(res.code, res.out).toBe(1);
    expect(res.out.split("\n").some((l) => l.includes("[ERROR]") && l.includes("Cannot read the project config")), res.out).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("kf doctor --fix with a project config it cannot read does not crash, links nothing and reports the config", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "dir");
    await projectAt(root);
    chmodSync(join(root, ".kf", "config.json"), 0o000);
    try {
      const res = kfFrom(pkg, root, home, "doctor", "--fix");
      expect(res.code, res.out).toBe(1);
      expect(res.out).not.toMatch(/^\s+at /m);
      expect(res.out.split("\n").some((l) => l.includes("[ERROR]") && l.includes(".kf/config.json")), res.out).toBe(true);
      expect(existsSync(join(home, ".claude"))).toBe(false);
    } finally {
      chmodSync(join(root, ".kf", "config.json"), 0o644);
    }
  });

  /** The interactive path needs a terminal on both ends; a pty from python gives one while stdin stays closed. */
  function kfOnTerminal(pkg: string, cwd: string, home: string, ...argv: string[]): { code: number; out: string } {
    const prog = "import os,pty,sys; sys.exit(os.waitstatus_to_exitcode(pty.spawn(sys.argv[1:])))";
    const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
    const r = spawnSync("python3", ["-I", "-c", prog, process.execPath, join(pkg, "dist", "index.js"), ...argv], {
      cwd, encoding: "utf8", input: "", timeout: 8_000, env: { ...base, HOME: home, USERPROFILE: home },
    });
    // A kf that waits at a prompt never exits; the timeout is the signal, and the output shows the prompt.
    if (r.error && (r.error as NodeJS.ErrnoException).code !== "ETIMEDOUT") throw r.error;
    return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  /** Like kfOnTerminal, but answers the prompts: customize setup, "no" to global skills, Enter for the rest. */
  function kfAnswering(pkg: string, cwd: string, home: string, ...argv: string[]): { code: number; out: string } {
    const prog = [
      "import os,pty,re,select,sys,time",
      "pid,fd=pty.fork()",
      "if pid==0: os.execv(sys.argv[1],sys.argv[1:])",
      "buf=b'';done=0;menu=0;end=time.time()+40",
      "while time.time()<end:",
      "  if not select.select([fd],[],[],0.3)[0]:",
      "    continue",
      "  try: d=os.read(fd,4096)",
      "  except OSError: break",
      "  if not d: break",
      "  buf+=d;tail=re.sub(r'\\x1b\\[[0-9;]*[A-Za-z]','',buf[done:].decode('utf8','replace'))",
      "  if not menu and 'Customize' in tail and tail.endswith('\\n'):",
      "    os.write(fd,b'2');time.sleep(0.2);os.write(fd,b'\\r');done=len(buf);menu=1",
      "  elif tail.rstrip().endswith((':','(Y/n)','(y/N)')):",
      "    os.write(fd,b'n\\r' if 'globally' in tail else b'\\r');done=len(buf)",
      "if time.time()>=end: os.kill(pid,9)",
      "_,st=os.waitpid(pid,0)",
      "sys.stdout.write(buf.decode('utf8','replace'));sys.exit(os.waitstatus_to_exitcode(st))",
    ].join("\n");
    const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
    const r = spawnSync("python3", ["-I", "-c", prog, process.execPath, join(pkg, "dist", "index.js"), ...argv], {
      cwd, encoding: "utf8", timeout: 60_000, env: { ...base, HOME: home, USERPROFILE: home },
    });
    if (r.error) throw r.error;
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  }

  it.skipIf(process.platform === "win32")("with no declared scope, interactive kf init prompts first and still lets the user choose project scope from a linked worktree", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    await mkdir(root, { recursive: true });
    stagePackage(pkg, "file");

    const res = kfAnswering(pkg, root, home, "init", "--agent", "codex");
    expect(res.out).toContain("Setup mode");
    expect(res.out).not.toContain("primary checkout");
    expect(res.code, res.out).toBe(0);
    expect(existsSync(join(root, ".agents", "skills", "kanban-flow", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  }, 70_000);

  it.skipIf(process.platform === "win32")("interactive kf init from a linked worktree refuses before it prompts when the config declares global", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "file");
    await projectAt(root);
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", skills: { scope: "global" } }));

    const res = kfOnTerminal(pkg, root, home, "init");
    expect(res.out).not.toContain("Setup mode");
    expect(res.out).toContain("primary checkout");
    expect(res.code, res.out).toBe(1);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it("kf doctor without --fix tells a linked-worktree user to run from the primary checkout", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    stagePackage(pkg, "file");
    await projectAt(root);

    const res = kfFrom(pkg, root, home, "doctor");
    const lines = res.out.split("\n");
    const at = lines.findIndex((l) => l.includes("[ERROR]") && l.includes("skills"));
    expect(at, res.out).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1], res.out).toContain("primary checkout");
  });

  it.each([
    ["kf init --minimal", ["init", "--minimal"]],
    ["kf init --defaults", ["init", "--defaults"]],
  ])("%s at global scope from a linked worktree refuses on stderr and writes nothing", async (_name, argv) => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const root = join(dir, "proj");
    await mkdir(home, { recursive: true });
    await mkdir(root, { recursive: true });
    stagePackage(pkg, "file");

    const res = kfFrom(pkg, root, home, ...argv);
    expect(res.code, res.out).toBe(1);
    expect(res.err).toContain("primary checkout");
    expect(await readdir(root)).toEqual([]);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });

  it("kf install --global from a linked worktree still links when KF_ALLOW_WORKTREE_LINK=1", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "file");

    const res = kfWithEnv(pkg, cwd, home, { KF_ALLOW_WORKTREE_LINK: "1" }, "install", "--global", "--agent", "codex");
    expect(res.code, res.out).toBe(0);
    expect(lstatSync(join(home, ".agents", "skills", "kanban-flow")).isSymbolicLink()).toBe(true);
  });

  it("kf install --global from a package in a primary checkout still links", async () => {
    const pkg = join(dir, "pkg");
    const home = join(dir, "home");
    const cwd = join(dir, "cwd");
    await mkdir(home, { recursive: true });
    await mkdir(cwd, { recursive: true });
    stagePackage(pkg, "dir");

    const res = kfFrom(pkg, cwd, home, "install", "--global", "--agent", "codex");
    expect(res.code, res.out).toBe(0);
    expect(lstatSync(join(home, ".agents", "skills", "kanban-flow")).isSymbolicLink()).toBe(true);
  });
});
