import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, cpSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { cmdInstall, cmdUninstall } from "../integrations/install.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import { copyName } from "../integrations/managed.js";

let dir: string;
let bin: string;
let log: string;
let prevPath: string | undefined;

/**
 * A `claude` on PATH that appends its argv to a log and answers `plugin list --json`
 * with whatever KF_STUB_LIST holds ("[]" when unset).
 */
async function writeStub(): Promise<void> {
  const script = [
    "#!/bin/sh",
    'echo "$*" >> "$KF_STUB_LOG"',
    'if [ "$1 $2" = "plugin list" ]; then echo "${KF_STUB_LIST:-[]}"; fi',
    'if [ -n "$KF_STUB_FAIL" ] && [ "$2" != "list" ]; then echo "$KF_STUB_FAIL" >&2; exit 3; fi',
    "exit 0",
    "",
  ].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

const calls = async () => (existsSync(log) ? (await readFile(log, "utf8")).split("\n").filter(Boolean) : []);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-claude-plugin-"));
  bin = join(dir, "bin");
  log = join(dir, "claude.log");
  await mkdir(bin);
  await writeStub();
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.KF_STUB_LOG = log;
  delete process.env.KF_STUB_LIST;
  const proj = join(dir, "proj");
  await mkdir(proj);
  ensureWorksStructure(proj);
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.KF_STUB_LOG;
  delete process.env.KF_STUB_LIST;
  delete process.env.KF_STUB_FAIL;
  await rm(dir, { recursive: true, force: true });
});

const projDir = () => join(dir, "proj");

describe("kf install --agent claude through the plugin CLI", () => {
  it("adds and installs on the first run, then only lists on the second", async () => {
    const first = await cmdInstall(["claude"], { cwd: projDir(), scope: "global" });
    expect(first.code).toBe(0);
    expect(await calls()).toEqual([
      "plugin list --json",
      `plugin marketplace add ${PKG_ROOT}`,
      "plugin install kf@kanban-flow --scope user",
    ]);

    await rm(log);
    process.env.KF_STUB_LIST = JSON.stringify([
      { id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT },
    ]);
    const second = await cmdInstall(["claude"], { cwd: projDir(), scope: "global" });
    expect(second.code).toBe(0);
    expect(await calls()).toEqual(["plugin list --json"]);
  });

  it("installs at project scope with --scope project", async () => {
    const res = await cmdInstall(["claude"], { cwd: projDir(), scope: "project" });
    expect(res.code).toBe(0);
    expect((await calls()).at(-1)).toBe("plugin install kf@kanban-flow --scope project");
  });

  it("writes nothing to .claude/skills or .claude/agents", async () => {
    await cmdInstall(["claude"], { cwd: projDir(), scope: "project" });
    await cmdInstall(["claude"], { cwd: projDir(), scope: "global" });
    expect(existsSync(join(projDir(), ".claude", "skills"))).toBe(false);
    expect(existsSync(join(projDir(), ".claude", "agents"))).toBe(false);
    expect(existsSync(join(process.env.HOME!, ".claude", "skills"))).toBe(false);
    expect(existsSync(join(process.env.HOME!, ".claude", "agents"))).toBe(false);
  });

  it("exits non-zero and lists the manual commands when claude is not on PATH", async () => {
    process.env.PATH = bin; // stub dir only, then remove the stub
    await rm(join(bin, "claude"));
    const res = await cmdInstall(["claude"], { cwd: projDir(), scope: "global" });
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("/plugin marketplace add");
    expect(res.stdout).toContain("/plugin install");
  });
});

describe("kf uninstall --agent claude through the plugin CLI", () => {
  it("uninstalls the plugin then removes the marketplace", async () => {
    const res = await cmdUninstall(["claude"], { cwd: projDir(), scope: "global" });
    expect(res.code).toBe(0);
    expect(await calls()).toEqual([
      "plugin uninstall kf --scope user",
      "plugin list --json",
      "plugin marketplace remove kanban-flow",
    ]);
  });
});

describe("kf uninstall when the plugin removal fails", () => {
  it("exits 1 and still removes the other agents' copies", async () => {
    await cmdInstall(["codex"], { cwd: projDir(), scope: "project" });
    expect(existsSync(join(projDir(), ".agents", "skills", copyName("flow"), "SKILL.md"))).toBe(true);
    process.env.KF_STUB_FAIL = "plugin store is locked";

    const res = await cmdUninstall(["claude", "codex"], { cwd: projDir(), scope: "project" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("plugin store is locked");
    expect(existsSync(join(projDir(), ".agents", "skills", copyName("flow")))).toBe(false);
  });
});

describe("kf install --agent claude,codex without claude on PATH", () => {
  it("still installs the codex copies and exits 1", async () => {
    await rm(join(bin, "claude"));
    process.env.PATH = bin;
    const res = await cmdInstall(["claude", "codex"], { cwd: projDir(), scope: "project" });
    expect(res.code).toBe(1);
    expect(existsSync(join(projDir(), ".agents", "skills", copyName("flow"), "SKILL.md"))).toBe(true);
  });
});

describe("kf install --global --agent claude from a linked worktree", () => {
  it("is refused before any claude call, like the codex refusal", async () => {
    const pkg = join(dir, "pkg");
    mkdirSync(pkg);
    cpSync(join(PKG_ROOT, "dist"), join(pkg, "dist"), { recursive: true });
    cpSync(join(PKG_ROOT, "package.json"), join(pkg, "package.json"));
    for (const d of ["skills", "agents", ".claude-plugin"]) {
      if (existsSync(join(PKG_ROOT, d))) cpSync(join(PKG_ROOT, d), join(pkg, d), { recursive: true });
    }
    symlinkSync(join(PKG_ROOT, "node_modules"), join(pkg, "node_modules"), "dir");
    const gitdir = join(dirname(pkg), "common-git", "worktrees", "transient");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(pkg, ".git"), `gitdir: ${gitdir}\n`);

    const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
    const r = spawnSync(process.execPath, [join(pkg, "dist", "index.js"), "install", "--global", "--agent", "claude"], {
      cwd: projDir(), encoding: "utf8", env: base,
    });
    if (r.error) throw r.error;
    expect(r.status, `${r.stdout}${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain("primary checkout");
    expect(await calls()).toEqual([]);
  });
});
