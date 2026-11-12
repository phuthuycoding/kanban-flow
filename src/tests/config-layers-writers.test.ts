import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const INHERITABLE = ["reviewer", "agents", "skills"];
const inheritableKeys = (cfg: Record<string, unknown>) => Object.keys(cfg).filter((k) => INHERITABLE.includes(k));

describe("kf init never copies inherited values into the project file", () => {
  it("writes no reviewer, agents or skills key on init --defaults", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    expect(inheritableKeys(readProject())).toEqual([]);
  });

  it("writes no reviewer, agents or skills key on init --minimal", async () => {
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(inheritableKeys(written)).toEqual([]);
    expect(written.schema).toBe("kanban-flow");
    expect(typeof written.created).toBe("string");
  });

  it("writes no reviewer, agents or skills key when init is repeated", async () => {
    expect((await cmdInit(args("init", [], { defaults: true }), root)).code).toBe(0);
    expect((await cmdInit(args("init", [], { defaults: true }), root)).code).toBe(0);
    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);
    expect(inheritableKeys(readProject())).toEqual([]);
  });

  it("keeps the project's own reviewer and adds nothing inherited when patching an existing file", async () => {
    mkdirSync(join(root, ".kf"), { recursive: true });
    writeFileSync(projectFile(), JSON.stringify({ reviewer: "B" }, null, 2) + "\n", "utf8");
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(written.reviewer).toBe("B");
    expect(inheritableKeys(written)).toEqual(["reviewer"]);
    expect(written.schema).toBe("kanban-flow");
  });

  it("leaves the global file untouched", async () => {
    const before = writeGlobal(GLOBAL);
    await cmdInit(args("init", [], { defaults: true }), root);
    await cmdInit(args("init", [], { minimal: true }), root);
    expect(readFileSync(globalFile(), "utf8")).toBe(before);
  });
});

describe("kf init without any layer file", () => {
  beforeEach(() => {
    rmSync(globalFile());
  });

  it("still writes reviewer, agents and skills on init --defaults", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    const written = readProject();
    expect(typeof written.reviewer).toBe("string");
    expect(Array.isArray(written.agents)).toBe(true);
    expect(written.skills).toBeDefined();
  });
});

describe("kf init --minimal installs with the inherited skills settings", () => {
  it("installs skill copies at project scope for the inherited agents when global says scope project", async () => {
    // Write decisions stay on the project file, but the install step follows what kf install would do.
    writeGlobal({ agents: ["codex"], skills: { scope: "project" } });
    const res = await cmdInit(args("init", [], { minimal: true }), root);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    expect(existsSync(join(root, ".agents", "skills"))).toBe(true);
    expect(existsSync(join(homedir(), ".agents", "skills"))).toBe(false);
    expect(inheritableKeys(readProject())).toEqual([]);
  });
});

describe("kf doctor --fix creating a missing project file", () => {
  // findRoot only accepts a directory that already has .kf/, so the repair starts from an empty one.
  beforeEach(() => {
    mkdirSync(join(root, ".kf"), { recursive: true });
  });

  it("writes no reviewer, agents or skills key and leaves the global file unchanged", async () => {
    const before = writeGlobal(GLOBAL);
    const { fixed, failures } = await runDoctorFixes(root);
    expect(failures).toEqual([]);
    expect(fixed.join("\n")).toContain(".kf/config.json");
    expect(inheritableKeys(readProject())).toEqual([]);
    expect(readFileSync(globalFile(), "utf8")).toBe(before);
  });

  it("still writes reviewer, agents and skills when no layer file exists", async () => {
    rmSync(globalFile());
    await runDoctorFixes(root);
    const written = readProject();
    expect(typeof written.reviewer).toBe("string");
    expect(Array.isArray(written.agents)).toBe(true);
    expect(written.skills).toBeDefined();
  });
});
