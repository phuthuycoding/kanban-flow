import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../cli/commands/init.js";
import { runDoctorFixes } from "../project/doctor.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

const GLOBAL = { reviewer: "A", agents: ["claude", "codex"], skills: { scope: "project" } };

let root: string;
const projectFile = () => join(root, ".kf", "config.json");
const globalFile = () => join(homedir(), ".kf", "config.json");
const readProject = () => JSON.parse(readFileSync(projectFile(), "utf8")) as Record<string, unknown>;

function writeGlobal(content: unknown): string {
  mkdirSync(join(homedir(), ".kf"), { recursive: true });
  const text = JSON.stringify(content, null, 2) + "\n";
  writeFileSync(globalFile(), text, "utf8");
  return text;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-config-layers-writers-"));
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  writeGlobal(GLOBAL);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf init never copies global values into the project file", () => {
  it("writes no global reviewer, agents or skills on init --defaults", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(written.reviewer).not.toBe("A");
    expect(written.agents).not.toEqual(["claude", "codex"]);
    expect((written.skills as { scope?: string } | undefined)?.scope).not.toBe("project");
  });

  it("writes no global reviewer, agents or skills on init --minimal", async () => {
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(written.reviewer).toBeUndefined();
    expect(written.agents).toBeUndefined();
    expect(written.skills).toBeUndefined();
    expect(written.schema).toBe("kanban-flow");
    expect(typeof written.created).toBe("string");
  });

  it("writes no global values when init is repeated", async () => {
    expect((await cmdInit(args("init", [], { defaults: true }), root)).code).toBe(0);
    expect((await cmdInit(args("init", [], { defaults: true }), root)).code).toBe(0);
    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);
    const raw = readFileSync(projectFile(), "utf8");
    expect(raw).not.toContain('"A"');
    expect(readProject().agents).not.toEqual(["claude", "codex"]);
    expect((readProject().skills as { scope?: string } | undefined)?.scope).not.toBe("project");
  });

  it("keeps the project's own reviewer and adds nothing global when patching an existing file", async () => {
    mkdirSync(join(root, ".kf"), { recursive: true });
    writeFileSync(projectFile(), JSON.stringify({ reviewer: "B" }, null, 2) + "\n", "utf8");
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(written.reviewer).toBe("B");
    expect(written.agents).toBeUndefined();
    expect(written.skills).toBeUndefined();
    expect(written.schema).toBe("kanban-flow");
  });

  it("leaves the global file untouched", async () => {
    const before = writeGlobal(GLOBAL);
    await cmdInit(args("init", [], { defaults: true }), root);
    await cmdInit(args("init", [], { minimal: true }), root);
    expect(readFileSync(globalFile(), "utf8")).toBe(before);
  });
});

describe("kf doctor --fix creating a missing project file", () => {
  // findRoot only accepts a directory that already has .kf/, so the repair starts from an empty one.
  beforeEach(() => {
    mkdirSync(join(root, ".kf"), { recursive: true });
  });

  it("writes the detected reviewer, not the global one, and leaves the global file unchanged", async () => {
    const before = writeGlobal({ reviewer: "A" });
    const { fixed, failures } = await runDoctorFixes(root);
    expect(failures).toEqual([]);
    expect(fixed.join("\n")).toContain(".kf/config.json");
    const written = readProject();
    expect(written.reviewer).not.toBe("A");
    expect(readFileSync(projectFile(), "utf8")).not.toContain('"A"');
    expect(readFileSync(globalFile(), "utf8")).toBe(before);
  });

  it("writes no global agents or skills into the created file", async () => {
    await runDoctorFixes(root);
    const written = readProject();
    expect(written.agents).not.toEqual(["claude", "codex"]);
    expect((written.skills as { scope?: string } | undefined)?.scope).not.toBe("project");
  });
});
