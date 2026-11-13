import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, cpSync, mkdirSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { copyName } from "../integrations/managed.js";

const DOWN = "\x1b[B";
const ENTER = "\r";
const SPACE = " ";
const CTRL_C = "\x03";
const CTRL_D = "\x04";

/**
 * Drives the real CLI on a pty. Each step waits until the (ANSI-stripped) output since the previous
 * keys contains the given text and stays quiet for a moment, then sends the keys. After the last
 * step it waits for the exit. The parent keeps the slave side open so the terminal flags can be read
 * once the child is gone: a CLI that leaves raw mode on leaves echo off.
 */
const DRIVER = [
  "import os,pty,re,select,subprocess,sys,time,json,termios",
  "steps=json.loads(sys.argv[1]);argv=sys.argv[2:]",
  "m,s=pty.openpty()",
  "p=subprocess.Popen(argv,stdin=s,stdout=s,stderr=s)",
  "buf=b'';mark=0;failed=''",
  "def pump(t):",
  "  global buf",
  "  if select.select([m],[],[],t)[0]:",
  "    try: buf+=os.read(m,4096)",
  "    except OSError: pass",
  "def tail(): return re.sub(r'\\x1b\\[[0-9;?]*[A-Za-z]','',buf[mark:].decode('utf8','replace'))",
  "for want,keys in steps:",
  "  end=time.time()+10;seen=0",
  "  while time.time()<end and want not in tail(): pump(0.1)",
  "  if want not in tail(): failed='never saw: '+want;break",
  "  q=time.time()+0.4",
  "  while time.time()<q: pump(0.1)",
  "  mark=len(buf)",
  "  os.write(m,keys.encode())",
  "if failed: p.kill()",
  "end=time.time()+20",
  "while time.time()<end and p.poll() is None: pump(0.1)",
  "if p.poll() is None: p.kill();failed=failed or 'did not exit'",
  "code=p.wait()",
  "q=time.time()+0.3",
  "while time.time()<q: pump(0.1)",
  "echo=bool(termios.tcgetattr(s)[3]&termios.ECHO)",
  "sys.stdout.write(json.dumps({'code':code,'echo':echo,'failed':failed,'out':re.sub(r'\\x1b\\[[0-9;?]*[A-Za-z]','',buf.decode('utf8','replace'))}))",
].join("\n");

type Run = { code: number; echo: boolean; failed: string; out: string };

let dir: string;
let bin: string;
let log: string;
let home: string;
let proj: string;
let pkg: string;

/** A copy of the built package outside the linked worktree this suite may run in, so a global install is not refused. */
function stagePackage(root: string): void {
  mkdirSync(root, { recursive: true });
  cpSync(join(PKG_ROOT, "dist"), join(root, "dist"), { recursive: true });
  cpSync(join(PKG_ROOT, "assets", "skills"), join(root, "assets", "skills"), { recursive: true });
  cpSync(join(PKG_ROOT, "assets", "agents"), join(root, "assets", "agents"), { recursive: true });
  cpSync(join(PKG_ROOT, "assets", "shared"), join(root, "assets", "shared"), { recursive: true });
  cpSync(join(PKG_ROOT, "package.json"), join(root, "package.json"));
  symlinkSync(join(PKG_ROOT, "node_modules"), join(root, "node_modules"), "dir");
  mkdirSync(join(root, ".git"));
}

async function writeStub(): Promise<void> {
  const script = [
    "#!/bin/sh",
    'echo "$*" >> "$KF_STUB_LOG"',
    'if [ "$1 $2" = "plugin list" ]; then echo "[]"; fi',
    "exit 0",
    "",
  ].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

const calls = async () => (existsSync(log) ? (await readFile(log, "utf8")).split("\n").filter(Boolean) : []);

function kfOnPty(cwd: string, steps: [string, string][], ...argv: string[]): Run {
  const { KF_ALLOW_WORKTREE_LINK: _optOut, ...base } = process.env;
  const r = spawnSync(
    "python3",
    ["-I", "-c", DRIVER, JSON.stringify(steps), process.execPath, join(pkg, "dist", "index.js"), ...argv],
    {
      cwd, encoding: "utf8", timeout: 120_000,
      env: { ...base, HOME: home, USERPROFILE: home, PATH: `${bin}:${process.env.PATH}`, KF_STUB_LOG: log },
    },
  );
  if (r.error) throw r.error;
  return JSON.parse(r.stdout) as Run;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-onboarding-pty-"));
  bin = join(dir, "bin");
  log = join(dir, "claude.log");
  home = join(dir, "home");
  proj = join(dir, "proj");
  await mkdir(bin);
  await mkdir(home);
  await mkdir(join(proj, ".works"), { recursive: true });
  await mkdir(join(proj, ".kf"));
  await writeFile(join(proj, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"] }));
  await writeStub();
  pkg = join(dir, "pkg");
  stagePackage(pkg);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("kf install and kf uninstall onboarding on a terminal", () => {
  it("aborts kf install on Ctrl+C at the agents step: exit 1, nothing changed, terminal restored, no claude call", async () => {
    const res = kfOnPty(proj, [
      ["Setup mode", DOWN + ENTER],
      ["Step 1/", CTRL_C],
    ], "install");
    expect(res.failed, res.out).toBe("");
    expect(res.code, res.out).toBe(1);
    expect(res.out).toContain("nothing changed");
    expect(res.echo, "terminal echo is back on").toBe(true);
    expect(await calls()).toEqual([]);
    expect(existsSync(join(home, ".claude"))).toBe(false);
  }, 130_000);

  it("aborts kf install on end of input at the agents step: exit 1, nothing changed, terminal restored, no claude call", async () => {
    const res = kfOnPty(proj, [
      ["Setup mode", DOWN + ENTER],
      ["Step 1/", CTRL_D],
    ], "install");
    expect(res.failed, res.out).toBe("");
    expect(res.code, res.out).toBe(1);
    expect(res.out).toContain("nothing changed");
    expect(res.echo, "terminal echo is back on").toBe(true);
    expect(await calls()).toEqual([]);
  }, 130_000);

  it("installs the plugin for user scope and the codex copies under HOME after Customize, codex, global, Install", async () => {
    const res = kfOnPty(proj, [
      ["Setup mode", DOWN + ENTER],
      ["Step 1/3", DOWN + SPACE + ENTER],
      ["Step 2/3", ENTER],
      ["Step 3/3", ENTER],
    ], "install");
    expect(res.failed, res.out).toBe("");
    expect(res.code, res.out).toBe(0);
    expect(res.echo, "terminal echo is back on").toBe(true);
    expect((await calls()).at(-1)).toBe("plugin install kf@kanban-flow --scope user");
    expect(existsSync(join(home, ".agents", "skills", copyName("flow"), "SKILL.md"))).toBe(true);
  }, 130_000);

  it("aborts kf uninstall on Ctrl+C at the purge step: exit 1, nothing changed, .works kept, no claude call", async () => {
    const res = kfOnPty(proj, [
      ["Step 1/4", ENTER],
      ["Step 2/4", ENTER],
      ["Step 3/4", CTRL_C],
    ], "uninstall");
    expect(res.failed, res.out).toBe("");
    expect(res.code, res.out).toBe(1);
    expect(res.out).toContain("nothing changed");
    expect(res.echo, "terminal echo is back on").toBe(true);
    expect(existsSync(join(proj, ".works"))).toBe(true);
    expect(existsSync(join(proj, ".kf"))).toBe(true);
    expect(await calls()).toEqual([]);
  }, 130_000);
});
