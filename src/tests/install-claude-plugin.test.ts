import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInstall, cmdUninstall } from "../integrations/install.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

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
      "plugin marketplace remove kanban-flow",
    ]);
  });
});
