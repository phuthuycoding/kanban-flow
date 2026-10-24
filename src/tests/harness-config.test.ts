import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectConfig } from "../project/config.js";
import { harnessPresets, harnessLimits, validateHarness, ROLE_BRIEFS, seedHarness } from "../harness/config.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdHarness } from "../cli/commands/harness.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { harnessProject, type HarnessProject } from "./helpers/harness-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

describe("harness config validation", () => {
  let dir: string;
  const write = async (harness: unknown) => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", harness }));
  };
  const base = () => ({
    main: "architect",
    roles: { architect: "claude", writer: { runner: "gemini", brief: "prose", output: "draft.md" } } as Record<string, unknown>,
    stages: {} as Record<string, unknown>,
    runners: harnessPresets(),
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-hcfg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects a role pointing at an undeclared runner", async () => {
    await write({ ...base(), roles: { architect: "claude", writer: "gemini-pro" } });
    expect(() => readProjectConfig(dir)).toThrow("harness.roles.writer.runner");
  });

  it("rejects an output path that escapes the work item folder", async () => {
    for (const output of ["../escape.md", "/etc/passwd", "a/../../b.md"]) {
      await write({ ...base(), roles: { architect: "claude", writer: { runner: "gemini", output } } });
      expect(() => readProjectConfig(dir), output).toThrow("harness.roles.writer.output");
    }
  });

  it("rejects a main that is a runner instead of a role", async () => {
    await write({ ...base(), main: "claude" });
    expect(() => readProjectConfig(dir)).toThrow('harness.main "claude" is a runner, not a role');
  });

  it("rejects an empty chain and a role listed twice in one stage", async () => {
    await write({ ...base(), stages: { brainstorm: [] } });
    expect(() => readProjectConfig(dir)).toThrow("must list at least one role");
    await write({ ...base(), stages: { brainstorm: ["writer", "writer"] } });
    expect(() => readProjectConfig(dir)).toThrow('lists role "writer" twice');
  });

  it("rejects invalid verify and limit values naming the field (TC-028)", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ verify: { task: "npm test" } }, "harness.verify.task"],
      [{ verify: { task: [[]] } }, "harness.verify.task[0]"],
      [{ verify: { task: [["npm", "test"], [""]] } }, "harness.verify.task[1]"],
      [{ verify: { stage: [["-rf"]] } }, "harness.verify.stage[0]"],
      [{ verify: { task: [["npm", "{x}"]] } }, "harness.verify.task[0]"],
      [{ parallel: 0 }, "harness.parallel"],
      [{ parallel: 1.5 }, "harness.parallel"],
      [{ retries: -1 }, "harness.retries"],
      [{ maxLoops: "2" }, "harness.maxLoops"],
      [{ budget: { maxRuns: 0 } }, "harness.budget.maxRuns"],
    ];
    for (const [extra, field] of cases) {
      await write({ ...base(), ...extra });
      expect(() => readProjectConfig(dir), JSON.stringify(extra)).toThrow(field);
    }
  });

  it("accepts valid verify and limits, including zero retries and loops", async () => {
    const extra = { verify: { task: [["npm", "test"]], stage: [["npm", "run", "lint"]] }, parallel: 2, retries: 0, maxLoops: 0, budget: { maxRuns: 5 } };
    await write({ ...base(), ...extra });
    const h = readProjectConfig(dir).harness!;
    expect(h.verify).toEqual(extra.verify);
    expect(harnessLimits(h)).toEqual({ parallel: 2, retries: 0, maxLoops: 0, maxRuns: 5 });
  });

  it("applies limit defaults without writing them into the config", () => {
    expect(harnessLimits(undefined)).toEqual({ parallel: 3, retries: 1, maxLoops: 2, maxRuns: 30 });
    const seeded = seedHarness([]);
    expect(harnessLimits(seeded)).toEqual({ parallel: 3, retries: 1, maxLoops: 2, maxRuns: 30 });
    for (const key of ["verify", "parallel", "retries", "maxLoops", "budget"]) expect(seeded, key).not.toHaveProperty(key);
  });

  it("rejects backlog as an assignable stage", async () => {
    await write({ ...base(), stages: { backlog: "writer" } });
    expect(() => readProjectConfig(dir)).toThrow("harness.stages.backlog");
  });

  it("normalizes the short role form and a single-role stage", async () => {
    await write({ ...base(), stages: { testing: "writer" } });
    const harness = readProjectConfig(dir).harness!;
    expect(harness.roles.architect).toEqual({ runner: "claude" });
    expect(harness.stages.testing).toEqual(["writer"]);
  });

  it("reads a config without harness unchanged", async () => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x" }));
    expect(readProjectConfig(dir).harness).toBeUndefined();
    expect(validateHarness(base(), "f").stages).toEqual({});
  });
});

describe("migrating a stage that points straight at a runner", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-hmig-"));
    await mkdir(join(dir, ".kf"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("says the name is a runner and points at harness.roles", async () => {
    const harness = { main: "architect", roles: { architect: "claude" }, stages: { testing: "gemini" }, runners: harnessPresets() };
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", harness }));
    expect(() => readProjectConfig(dir)).toThrow('"gemini" is a runner, not a role');

    const unknown = { ...harness, stages: { testing: "nobody" } };
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", harness: unknown }));
    expect(() => readProjectConfig(dir)).toThrow("Known roles: architect");
  });
});

describe("kf init seeds roles and runner presets", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-hinit-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("seeds six roles on one runner with architect as main, and keeps a user-edited harness", async () => {
    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    const h = readProjectConfig(dir).harness!;
    expect(h.main).toBe("architect");
    expect(h.stages).toEqual({});
    expect(Object.keys(h.roles).sort()).toEqual(["architect", "coder", "researcher", "reviewer", "tester", "writer"]);
    for (const [name, role] of Object.entries(h.roles)) {
      expect(role.runner, name).toBe("claude");
      expect(role.brief, name).toBe(ROLE_BRIEFS[name]);
    }
    expect(Object.keys(h.runners).sort()).toEqual(["claude", "codex", "devin", "gemini", "opencode"]);
    expect(h.runners.claude.session).toBe("provided");
    expect(h.runners.opencode.resume).toBeUndefined();

    const cfg = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8"));
    cfg.harness.roles.writer.runner = "gemini";
    cfg.harness.stages = { brainstorm: ["researcher", "writer"] };
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify(cfg));
    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    const kept = readProjectConfig(dir).harness!;
    expect(kept.roles.writer.runner).toBe("gemini");
    expect(kept.stages.brainstorm).toEqual(["researcher", "writer"]);
  });

  it("keeps verify and limits when init is re-run (TC-028)", async () => {
    for (const options of [{ defaults: true }, { minimal: true }]) {
      expect((await cmdInit(args("init", [], options), dir)).code).toBe(0);
      const cfg = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8"));
      Object.assign(cfg.harness, { verify: { task: [["npm", "test"]] }, parallel: 2, retries: 0, maxLoops: 4, budget: { maxRuns: 9 } });
      await writeFile(join(dir, ".kf", "config.json"), JSON.stringify(cfg));
      expect((await cmdInit(args("init", [], options), dir)).code).toBe(0);
      const kept = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8")).harness;
      expect(kept, JSON.stringify(options)).toMatchObject({ verify: { task: [["npm", "test"]] }, parallel: 2, retries: 0, maxLoops: 4, budget: { maxRuns: 9 } });
    }
  });

  it("seeds harness with --minimal too", async () => {
    expect((await cmdInit(args("init", [], { minimal: true }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).harness?.main).toBe("architect");
  });
});

describe("kf harness and autoconfig", () => {
  let p: HarnessProject;
  beforeEach(async () => {
    p = await harnessProject({ stages: { brainstorm: ["researcher", "writer"], testing: ["tester"] }, agents: ["gemini"] });
  });
  afterEach(async () => {
    await p.cleanup();
  });

  it("shows the three layers and which runner CLIs are on PATH", async () => {
    const text = (await cmdHarness(args("harness"), p.root)).stdout;
    expect(text).toContain("main role: architect (claude)");
    expect(text).toMatch(/brainstorm\s+researcher → writer/);
    expect(text).toMatch(/testing\s+tester/);
    expect(text).toMatch(/writer\s+gemini\s+on PATH/);
    expect(text).toMatch(/researcher\s+codex\s+missing\s+output: research\.md/);
    expect(text).toContain("Explores breadth.");
    expect(text).toMatch(/gemini\s+gemini\s+on PATH\s+resume: no/);
    expect(text).toMatch(/task\s+not set/);
    expect(text).toContain("limits: parallel 3, retries 1, maxLoops 2, maxRuns 30");

    const json = JSON.parse((await cmdHarness(args("harness", [], { json: true }), p.root)).stdout);
    expect(json.main).toBe("architect");
    expect(json.verify).toEqual({ task: null, stage: null });
    expect(json.limits).toEqual({ parallel: 3, retries: 1, maxLoops: 2, maxRuns: 30 });
    expect(json.stages.find((s: { stage: string }) => s.stage === "brainstorm").roles).toEqual(["researcher", "writer"]);
    expect(json.roles.find((r: { name: string }) => r.name === "writer")).toMatchObject({ runner: "gemini", available: true });
    expect(json.runners.find((r: { name: string }) => r.name === "codex").available).toBe(false);
  });

  it("lists the harness commands in the autoconfig guide and checklist", async () => {
    const out = (await cmdAutoconfig(args("autoconfig"), p.root)).stdout;
    for (const cmd of ["kf run <feature>", "kf runs [<feature>]", "kf harness [--json]"]) expect(out).toContain(cmd);
    expect(out).toContain("[x] Multi-agent harness: main architect, 2 stages assigned");
  });
});
