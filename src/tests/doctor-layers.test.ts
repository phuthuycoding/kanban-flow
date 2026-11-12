import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmod, mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (options: Record<string, unknown> = {}): ParsedArgs => ({ command: "doctor", positionals: [], options });

interface Finding { level: string; area: string; message: string }
interface Report {
  findings: Finding[];
  ok: boolean;
  configLayers: { layer: string; path: string }[];
}

let base: string;
let root: string;
let prevPath: string | undefined;

/** A `claude` first on PATH that reports the kf plugin current, so plugin findings cannot interfere. */
async function currentPluginStub(): Promise<void> {
  const bin = join(base, "bin");
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

/** The project file is rewritten without a reviewer so only an inherited value could supply one. */
async function project(): Promise<void> {
  await currentPluginStub();
  expect((await cmdInit({ command: "init", positionals: [], options: { minimal: true, context: "cli" } }, root)).code).toBe(0);
  const cfgPath = join(root, ".kf", "config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
  delete cfg.reviewer;
  await writeFile(cfgPath, JSON.stringify(cfg, null, 2));
}

async function writeGlobal(text: string): Promise<string> {
  const path = join(homedir(), ".kf", "config.json");
  await mkdir(join(homedir(), ".kf"), { recursive: true });
  await writeFile(path, text);
  return path;
}

async function doctorJson(options: Record<string, unknown> = {}): Promise<{ code: number; report: Report }> {
  const res = await cmdDoctor(args({ json: true, ...options }), root);
  return { code: res.code, report: JSON.parse(res.stdout) as Report };
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "kf-doctor-layers-"));
  root = join(base, "proj");
  await mkdir(root);
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  prevPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(base, { recursive: true, force: true });
});

describe("kf doctor with a global config layer", () => {
  const globalText = JSON.stringify({ contexts: ["x"], reviewer: "A" });

  it("lists the active layer file in the text output and in --json", async () => {
    await project();
    const path = await writeGlobal(globalText);
    const text = await cmdDoctor(args(), root);
    expect(text.stdout).toContain(path);
    const { report } = await doctorJson();
    expect(report.configLayers).toEqual([{ layer: "global", path }]);
  });

  it("warns naming the global file and the key that is not applied", async () => {
    await project();
    const path = await writeGlobal(globalText);
    const { report } = await doctorJson();
    const warning = report.findings.find((f) => f.level === "WARNING" && f.message.includes("contexts"));
    expect(warning).toBeDefined();
    expect(warning!.message).toContain(path);
    expect(report.findings.filter((f) => f.level === "ERROR")).toEqual([]);
  });

  it("reports no project-file finding about an inherited reviewer", async () => {
    await project();
    await writeGlobal(globalText);
    const { report } = await doctorJson();
    expect(report.findings.filter((f) => /reviewer/i.test(f.message))).toEqual([]);
  });

  it("leaves the global file byte-for-byte unchanged under --fix", async () => {
    await project();
    const path = await writeGlobal(globalText);
    const before = await readFile(path);
    const res = await cmdDoctor(args({ fix: true }), root);
    expect(res.stdout).toContain("contexts");
    expect(Buffer.compare(await readFile(path), before)).toBe(0);
  });

  it("does not copy the inherited reviewer into the project file under --fix", async () => {
    await project();
    await writeGlobal(globalText);
    await cmdDoctor(args({ fix: true }), root);
    const cfg = JSON.parse(await readFile(join(root, ".kf", "config.json"), "utf8")) as Record<string, unknown>;
    expect(cfg.reviewer).toBeUndefined();
  });
});

describe("kf doctor with an invalid workspace layer", () => {
  it("reports an error finding naming the workspace file and does not crash", async () => {
    await project();
    const dir = join(base, ".kf");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "workspace.json");
    await writeFile(path, JSON.stringify({ agents: "claude" }));
    const { code, report } = await doctorJson();
    const error = report.findings.find((f) => f.level === "ERROR" && f.message.includes(path));
    expect(error).toBeDefined();
    expect(report.ok).toBe(false);
    expect(code).toBe(1);
  });

  it("names the workspace file in the text output too", async () => {
    await project();
    const dir = join(base, ".kf");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "workspace.json");
    await writeFile(path, JSON.stringify({ agents: "claude" }));
    const res = await cmdDoctor(args(), root);
    expect(res.stdout).toContain(`[ERROR]`);
    expect(res.stdout).toContain(path);
  });
});
