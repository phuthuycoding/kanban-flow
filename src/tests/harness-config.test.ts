import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readOriginConfig, readProjectConfig } from "../project/config.js";
import { harnessPresets, harnessLimits, legacyHarnessStageKeys, validateHarness, ROLE_BRIEFS, seedHarness } from "../harness/config.js";
import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

describe("claude item directory", () => {
  it("fills {itemDir} on the preset start and resume argv", () => {
    const claude = harnessPresets().claude;
    expect(claude.start).toEqual(expect.arrayContaining(["--add-dir", "{itemDir}"]));
    expect(claude.resume).toEqual(expect.arrayContaining(["--add-dir", "{itemDir}"]));
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const cfg = JSON.parse(readFileSync(join(repoRoot, ".kf/config.json"), "utf8")) as { harness: { runners: { "claude-dev": { start: string[]; resume: string[] } } } };
    expect(cfg.harness.runners["claude-dev"].start).toEqual(expect.arrayContaining(["--add-dir", "{itemDir}"]));
    expect(cfg.harness.runners["claude-dev"].resume).toEqual(expect.arrayContaining(["--add-dir", "{itemDir}"]));
  });
});

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

  it("reads the 0.13 stage keys: dones as done, shipping dropped", async () => {
    await write({ ...base(), stages: { dones: "writer", shipping: ["architect"], testing: "writer" } });
    expect(readProjectConfig(dir).harness!.stages).toEqual({ done: ["writer"], testing: ["writer"] });
    await write({ ...base(), stages: { shipping: "architect" } });
    expect(readProjectConfig(dir).harness!.stages).toEqual({});
  });

  it("keeps an explicit done over the legacy dones", async () => {
    await write({ ...base(), stages: { done: "architect", dones: "writer" } });
    expect(readProjectConfig(dir).harness!.stages).toEqual({ done: ["architect"] });
  });

  it("names the legacy stage keys a raw harness block still has", () => {
    expect(legacyHarnessStageKeys({ ...base(), stages: { dones: "writer", shipping: "architect", testing: "writer" } })).toEqual(["shipping", "dones"]);
    expect(legacyHarnessStageKeys({ ...base(), stages: { done: "writer" } })).toEqual([]);
    expect(legacyHarnessStageKeys(undefined)).toEqual([]);
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

describe("readOriginConfig", () => {
  let dir: string;
  let primary: string;
  const config = (harness?: unknown) => JSON.stringify({ schema: "kanban-flow", created: "x", ...(harness ? { harness } : {}) });
  const harness = (main: string) => ({ main, roles: { [main]: "claude" }, stages: {}, runners: harnessPresets() });
  const gitIn = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-hres-"));
    primary = join(dir, "repo");
    await mkdir(join(primary, ".kf"), { recursive: true });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads origin's default branch with git show, and treats a missing origin, ref or file as absent", async () => {
    expect(readOriginConfig(dir)).toEqual({ ref: null, text: null });
    gitIn(primary, "init", "-q");
    gitIn(primary, "commit", "-q", "--allow-empty", "-m", "init");
    expect(readOriginConfig(primary)).toEqual({ ref: null, text: null });

    const bare = join(dir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", bare]);
    const branch = gitIn(primary, "symbolic-ref", "--short", "HEAD");
    gitIn(primary, "remote", "add", "origin", bare);
    gitIn(primary, "push", "-q", "origin", branch);
    gitIn(primary, "remote", "set-head", "origin", branch);
    expect(readOriginConfig(primary)).toEqual({ ref: `origin/${branch}`, text: null });

    await writeFile(join(primary, ".kf", "config.json"), config(harness("origin")));
    gitIn(primary, "add", ".kf/config.json");
    gitIn(primary, "commit", "-qm", "config");
    gitIn(primary, "push", "-q", "origin", branch);
    gitIn(primary, "fetch", "-q", "origin");
    const read = readOriginConfig(primary);
    expect(read.ref).toBe(`origin/${branch}`);
    expect(JSON.parse(read.text!).harness.main).toBe("origin");
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
