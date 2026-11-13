import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { cmdInstall, cmdUninstall } from "../integrations/install.js";
import * as bootstrap from "../project/bootstrap.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

let dir: string;
let bin: string;
let log: string;
let prevPath: string | undefined;

/**
 * A `claude` on PATH that logs one line per call: `<physical cwd>|<argv>|file:<yes|no>`, where
 * `file` says whether `.kf/workspace.json` already existed in that cwd when claude ran. It answers
 * `plugin list --json` with KF_STUB_LIST ("[]" when unset) and, when KF_STUB_FAIL is set, fails
 * every other call with that text.
 */
async function writeStub(): Promise<void> {
  const script = [
    "#!/bin/sh",
    'if [ -f .kf/workspace.json ]; then has=yes; else has=no; fi',
    'echo "$(pwd -P)|$*|file:$has" >> "$KF_STUB_LOG"',
    'if [ "$1 $2" = "plugin list" ]; then echo "${KF_STUB_LIST:-[]}"; exit 0; fi',
    'if [ -n "$KF_STUB_FAIL" ]; then echo "$KF_STUB_FAIL" >&2; exit 3; fi',
    "exit 0",
    "",
  ].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

interface Call {
  cwd: string;
  argv: string;
  fileBefore: boolean;
}

const calls = async (): Promise<Call[]> => {
  if (!existsSync(log)) return [];
  return (await readFile(log, "utf8")).split("\n").filter(Boolean).map((line) => {
    const [cwd, argv, file] = line.split("|");
    return { cwd, argv, fileBefore: file === "file:yes" };
  });
};

const USER_SCOPE_KF = JSON.stringify([
  { id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT },
]);

const NO_WORKSPACE_REASON = "no .kf/workspace.json above this project — run kf install from the workspace folder";

const wsFile = (folder: string) => join(folder, ".kf", "workspace.json");
const output = (r: { stdout: string; stderr?: string }) => `${r.stdout}\n${r.stderr ?? ""}`;

let ws: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-workspace-"));
  bin = join(dir, "bin");
  log = join(dir, "claude.log");
  await mkdir(bin);
  await writeStub();
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.KF_STUB_LOG = log;
  delete process.env.KF_STUB_LIST;
  delete process.env.KF_STUB_FAIL;
  ws = join(dir, "ws");
  await mkdir(ws);
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.KF_STUB_LOG;
  delete process.env.KF_STUB_LIST;
  delete process.env.KF_STUB_FAIL;
  await rm(dir, { recursive: true, force: true });
});

/** Makes stdin and stdout look like a terminal for the duration of `body`. */
async function onTty<T>(body: () => Promise<T>): Promise<T> {
  const stdinWas = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const stdoutWas = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  try {
    return await body();
  } finally {
    if (stdinWas) Object.defineProperty(process.stdin, "isTTY", stdinWas);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutWas) Object.defineProperty(process.stdout, "isTTY", stdoutWas);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

describe("kf install --scope workspace in a plain folder", () => {
  it("installs the plugin at Claude Code local scope, running claude in the workspace folder", async () => {
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    const log = await calls();
    expect(log.map((c) => c.argv)).toContain("plugin install kf@kanban-flow --scope local");
    for (const c of log) expect(c.cwd, c.argv).toBe(realpathSync(ws));
  });

  it("creates .kf/workspace.json holding {} only after the plugin install succeeded", async () => {
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    const install = (await calls()).find((c) => c.argv === "plugin install kf@kanban-flow --scope local");
    expect(install, "the local-scope install ran").toBeDefined();
    expect(install!.fileBefore, "workspace.json must not exist while the install is still running").toBe(false);
    expect(JSON.parse(readFileSync(wsFile(ws), "utf8"))).toEqual({});
  });

  it("names the workspace folder in its result", async () => {
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    const named = res.stdout.includes(ws) || res.stdout.includes(realpathSync(ws));
    expect(named, res.stdout).toBe(true);
  });

  it("leaves no workspace.json when the plugin install fails", async () => {
    process.env.KF_STUB_FAIL = "plugin store is locked";
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("plugin store is locked");
    expect(existsSync(wsFile(ws))).toBe(false);
  });
});

describe("kf install --scope workspace from a project below a workspace folder", () => {
  it("runs claude in the folder holding workspace.json, not in the project", async () => {
    await mkdir(join(ws, ".kf"));
    await writeFile(wsFile(ws), "{}");
    const repo = join(ws, "repo");
    await mkdir(repo);
    ensureWorksStructure(repo);

    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: repo });
    expect(res.code, output(res)).toBe(0);
    const install = (await calls()).find((c) => c.argv === "plugin install kf@kanban-flow --scope local");
    expect(install?.cwd).toBe(realpathSync(ws));
    expect(existsSync(wsFile(repo)), "no second workspace file in the project").toBe(false);
  });

  it("finds a workspace.json two levels above the project", async () => {
    await mkdir(join(ws, ".kf"));
    await writeFile(wsFile(ws), "{}");
    const repo = join(ws, "group", "repo");
    await mkdir(repo, { recursive: true });
    ensureWorksStructure(repo);

    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: repo });
    expect(res.code, output(res)).toBe(0);
    const log = await calls();
    expect(log.map((c) => c.argv)).toContain("plugin install kf@kanban-flow --scope local");
    for (const c of log) expect(c.cwd, c.argv).toBe(realpathSync(ws));
  });

  it("is refused inside a project with no workspace.json above it, changing nothing", async () => {
    const repo = join(ws, "repo");
    await mkdir(repo);
    ensureWorksStructure(repo);

    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: repo });
    expect(res.code).toBe(1);
    expect(output(res)).toContain(NO_WORKSPACE_REASON);
    expect(await calls()).toEqual([]);
    expect(existsSync(wsFile(repo))).toBe(false);
    expect(existsSync(wsFile(ws))).toBe(false);
  });

  it("never makes the home directory a workspace folder", async () => {
    const home = process.env.HOME!;
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: home });
    expect(res.code).toBe(1);
    expect(await calls()).toEqual([]);
    expect(existsSync(wsFile(home))).toBe(false);
  });
});

describe("kf install --scope workspace with an agent other than claude", () => {
  it("refuses codex alone with exit 1 before any claude call", async () => {
    const res = await cmdInstall(["codex"], { scope: "workspace", cwd: ws });
    expect(res.code).toBe(1);
    expect(output(res)).toContain("codex");
    expect(output(res)).toMatch(/supports\W+claude\W+only/i);
    expect(await calls()).toEqual([]);
    expect(existsSync(wsFile(ws))).toBe(false);
  });

  it("refuses claude together with codex before installing either", async () => {
    const res = await cmdInstall(["claude", "codex"], { scope: "workspace", cwd: ws });
    expect(res.code).toBe(1);
    expect(output(res)).toContain("codex");
    expect(output(res)).toMatch(/supports\W+claude\W+only/i);
    expect(await calls()).toEqual([]);
    expect(existsSync(wsFile(ws))).toBe(false);
    expect(existsSync(join(ws, ".agents")), "no codex copies written").toBe(false);
  });
});

describe("kf uninstall --scope workspace", () => {
  it("removes the plugin at local scope in the workspace folder and creates no file", async () => {
    const res = await cmdUninstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    const uninstall = (await calls()).find((c) => c.argv === "plugin uninstall kf --scope local");
    expect(uninstall, "the local-scope uninstall ran").toBeDefined();
    expect(uninstall!.cwd).toBe(realpathSync(ws));
    expect(existsSync(wsFile(ws))).toBe(false);
    expect(existsSync(join(ws, ".kf")), "uninstall must not create .kf/").toBe(false);
  });

  it("runs in the folder holding workspace.json when called from a project below it", async () => {
    await mkdir(join(ws, ".kf"));
    await writeFile(wsFile(ws), "{}");
    const repo = join(ws, "repo");
    await mkdir(repo);
    ensureWorksStructure(repo);

    const res = await cmdUninstall(["claude"], { scope: "workspace", cwd: repo });
    expect(res.code, output(res)).toBe(0);
    const uninstall = (await calls()).find((c) => c.argv === "plugin uninstall kf --scope local");
    expect(uninstall?.cwd).toBe(realpathSync(ws));
  });

  it("is refused inside a project with no workspace.json above it, changing nothing", async () => {
    const repo = join(ws, "repo");
    await mkdir(repo);
    ensureWorksStructure(repo);

    const res = await cmdUninstall(["claude"], { scope: "workspace", cwd: repo });
    expect(res.code).toBe(1);
    expect(output(res)).toContain(NO_WORKSPACE_REASON);
    expect(await calls()).toEqual([]);
    expect(existsSync(join(repo, ".works")), "project data untouched").toBe(true);
  });

  it("refuses codex with exit 1 before any change", async () => {
    const res = await cmdUninstall(["claude", "codex"], { scope: "workspace", cwd: ws });
    expect(res.code).toBe(1);
    expect(output(res)).toContain("codex");
    expect(output(res)).toMatch(/supports\W+claude\W+only/i);
    expect(await calls()).toEqual([]);
  });
});

describe("kf install --scope workspace while kf is also installed at user scope", () => {
  it("removes the user-scope plugin only after the workspace install succeeded", async () => {
    process.env.KF_STUB_LIST = USER_SCOPE_KF;
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws, removeUserPlugin: true });
    expect(res.code, output(res)).toBe(0);
    const argv = (await calls()).map((c) => c.argv);
    const installAt = argv.indexOf("plugin install kf@kanban-flow --scope local");
    const removeAt = argv.findIndex((a) => /^plugin uninstall kf(@kanban-flow)? --scope user$/.test(a));
    expect(installAt, argv.join("\n")).toBeGreaterThanOrEqual(0);
    expect(removeAt, argv.join("\n")).toBeGreaterThan(installAt);
  });

  it("removes nothing and reports the error when the workspace install fails", async () => {
    process.env.KF_STUB_LIST = USER_SCOPE_KF;
    process.env.KF_STUB_FAIL = "plugin store is locked";
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws, removeUserPlugin: true });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("plugin store is locked");
    expect((await calls()).map((c) => c.argv).filter((a) => a.startsWith("plugin uninstall"))).toEqual([]);
    expect(existsSync(wsFile(ws))).toBe(false);
  });

  it("keeps the user-scope plugin off a terminal and names kf uninstall --global", async () => {
    process.env.KF_STUB_LIST = USER_SCOPE_KF;
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    expect(res.stdout).toContain("kf uninstall --global");
    expect((await calls()).map((c) => c.argv).filter((a) => a.startsWith("plugin uninstall"))).toEqual([]);
  });

  it("asks nothing on a terminal when every choice was given, and still names kf uninstall --global", async () => {
    process.env.KF_STUB_LIST = USER_SCOPE_KF;
    // A prompt here would block on real input; the stand-in answers "No" so a call is visible, not hung.
    const asked = vi.spyOn(bootstrap, "selectOption").mockResolvedValue(0);
    try {
      const res = await onTty(() => cmdInstall(["claude"], { scope: "workspace", cwd: ws }));
      expect(res.code, output(res)).toBe(0);
      expect(asked).not.toHaveBeenCalled();
      expect(res.stdout).toContain("kf uninstall --global");
      expect((await calls()).map((c) => c.argv).filter((a) => a.startsWith("plugin uninstall"))).toEqual([]);
    } finally {
      asked.mockRestore();
    }
  });

  it("prints no kf uninstall --global note when kf is not installed at user scope", async () => {
    const res = await cmdInstall(["claude"], { scope: "workspace", cwd: ws });
    expect(res.code, output(res)).toBe(0);
    expect(res.stdout).not.toContain("kf uninstall --global");
  });

  it("prints no kf uninstall --global note for a project-scope install", async () => {
    // The note belongs to the workspace scope only; existing scopes keep today's output.
    process.env.KF_STUB_LIST = USER_SCOPE_KF;
    const proj = join(dir, "proj");
    await mkdir(proj);
    ensureWorksStructure(proj);
    const res = await cmdInstall(["claude"], { scope: "project", cwd: proj });
    expect(res.code, output(res)).toBe(0);
    expect(res.stdout).not.toContain("kf uninstall --global");
  });
});

describe("kf uninstall --purge when the onboarding confirm already covered the purge", () => {
  it("does not ask the purge question again and deletes .works/ and .kf/", async () => {
    const proj = join(dir, "proj");
    await mkdir(proj);
    ensureWorksStructure(proj);
    await mkdir(join(proj, ".kf"), { recursive: true });
    await writeFile(join(proj, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x" }));
    // Answers "Cancel" if called, so an unwanted prompt also shows up as data left behind.
    const asked = vi.spyOn(bootstrap, "selectOption").mockResolvedValue(0);
    try {
      const res = await onTty(() => cmdUninstall(["claude"], { cwd: proj, scope: "project", purge: true, purgeConfirmed: true }));
      expect(asked).not.toHaveBeenCalled();
      expect(res.code, output(res)).toBe(0);
      expect(existsSync(join(proj, ".works"))).toBe(false);
      expect(existsSync(join(proj, ".kf"))).toBe(false);
      expect(res.stdout).toContain("Purged project data");
    } finally {
      asked.mockRestore();
    }
  });

  it("still asks the existing purge question when the confirm did not cover it", async () => {
    // No onboarding step was asked: the existing prompt stays the only guard before deletion.
    const proj = join(dir, "proj");
    await mkdir(proj);
    ensureWorksStructure(proj);
    const asked = vi.spyOn(bootstrap, "selectOption").mockResolvedValue(0);
    try {
      const res = await onTty(() => cmdUninstall(["claude"], { cwd: proj, scope: "project", purge: true }));
      expect(asked).toHaveBeenCalledTimes(1);
      expect(res.code).toBe(0);
      expect(existsSync(join(proj, ".works"))).toBe(true);
    } finally {
      asked.mockRestore();
    }
  });
});

describe("kf install --scope workspace from a linked worktree", () => {
  it("is refused before any claude call, like a global install", async () => {
    const pkg = join(dir, "pkg");
    mkdirSync(pkg);
    cpSync(join(PKG_ROOT, "dist"), join(pkg, "dist"), { recursive: true });
    cpSync(join(PKG_ROOT, "package.json"), join(pkg, "package.json"));
    for (const d of ["assets", ".claude-plugin"]) {
      if (existsSync(join(PKG_ROOT, d))) cpSync(join(PKG_ROOT, d), join(pkg, d), { recursive: true });
    }
    symlinkSync(join(PKG_ROOT, "node_modules"), join(pkg, "node_modules"), "dir");
    const gitdir = join(dirname(pkg), "common-git", "worktrees", "transient");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(pkg, ".git"), `gitdir: ${gitdir}\n`);

    const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
    const r = spawnSync(process.execPath, [join(pkg, "dist", "index.js"), "install", "--scope", "workspace", "--agent", "claude"], {
      cwd: ws, encoding: "utf8", env: base,
    });
    if (r.error) throw r.error;
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("primary checkout");
    expect(await calls()).toEqual([]);
    expect(existsSync(wsFile(ws))).toBe(false);
  });
});
