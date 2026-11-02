import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

const STALE_LINE = "⚠ kf plugin path is stale — run kf install";

let dir: string;
let root: string;
let bin: string;
let log: string;
let prevPath: string | undefined;

const entry = (over: Record<string, unknown> = {}) => ({
  id: "kf@kanban-flow",
  scope: "user",
  enabled: true,
  readFromFolder: PKG_ROOT,
  ...over,
});

async function writeStub(): Promise<void> {
  const script = [
    "#!/bin/sh",
    'echo "$*" >> "$KF_STUB_LOG"',
    'if [ "$1 $2" = "plugin list" ]; then echo "${KF_STUB_LIST:-[]}"; fi',
    "exit 0",
    "",
  ].join("\n");
  await writeFile(join(bin, "claude"), script);
  await chmod(join(bin, "claude"), 0o755);
}

const setList = (list: unknown) => {
  process.env.KF_STUB_LIST = typeof list === "string" ? list : JSON.stringify(list);
};
const status = () => cmdStatus(args("status", [], { all: true }), root);

async function project(agent: string): Promise<void> {
  setList([]);
  const res = await cmdInit(args("init", [], { minimal: true, context: "app", agent }), root);
  expect(res.code).toBe(0);
  // --minimal does not record the agent, so the config is patched the way a user's choice would be.
  const cfgPath = join(root, ".kf", "config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
  await writeFile(cfgPath, JSON.stringify({ ...cfg, agents: [agent] }, null, 2));
  await rm(log, { force: true });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-status-pl-"));
  root = join(dir, "proj");
  bin = join(dir, "bin");
  log = join(dir, "claude.log");
  await mkdir(root);
  await mkdir(bin);
  await writeStub();
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.KF_STUB_LOG = log;
  delete process.env.KF_STUB_LIST;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.KF_STUB_LOG;
  delete process.env.KF_STUB_LIST;
  await rm(dir, { recursive: true, force: true });
});

describe("kf status and the kf plugin path", () => {
  it("prints a one-line warning after the status when the registered path is stale", async () => {
    await project("claude");
    setList([entry({ readFromFolder: "/old/nvm/lib/node_modules/kanban-flow" })]);
    const res = await status();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(STALE_LINE);
    expect(res.stdout.trimEnd().endsWith(STALE_LINE)).toBe(true);
    expect(res.stdout.indexOf("No active features")).toBeLessThan(res.stdout.indexOf(STALE_LINE));
  });

  it("prints nothing about the plugin when the registered path is current", async () => {
    await project("claude");
    setList([entry()]);
    const res = await status();
    expect(res.stdout).not.toMatch(/plugin/i);
  });

  it("leaves a missing or disabled plugin to doctor", async () => {
    await project("claude");
    setList([]);
    expect((await status()).stdout).not.toMatch(/plugin/i);
    setList([entry({ enabled: false })]);
    expect((await status()).stdout).not.toMatch(/plugin/i);
  });

  it("says it cannot check when the probe output is unreadable, and never stays silent", async () => {
    await project("claude");
    setList("garbage-out");
    const res = await status();
    expect(res.stdout).toContain("⚠ cannot check kf plugin:");
    expect(res.stdout).not.toContain(STALE_LINE);
  });

  it("says it cannot check when claude is not on PATH", async () => {
    await project("claude");
    const empty = join(dir, "empty");
    await mkdir(empty);
    process.env.PATH = `${empty}:/usr/bin:/bin`;
    const res = await status();
    expect(res.stdout).toContain("⚠ cannot check kf plugin:");
  });

  it("does not probe the plugin when claude is not a configured agent", async () => {
    await project("codex");
    setList([entry({ readFromFolder: "/old/kf" })]);
    const res = await status();
    expect(res.stdout).not.toMatch(/plugin/i);
    expect(existsSync(log) ? await readFile(log, "utf8") : "").toBe("");
  });
});
