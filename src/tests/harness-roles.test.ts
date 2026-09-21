import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { cmdRun, cmdRuns } from "../cli/commands/run.js";
import { cmdStatus, cmdView } from "../cli/commands/inspect.js";
import { readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { harnessProject, harnessWith, type HarnessProject } from "./helpers/harness-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

// These tests spawn real worker processes, so each one legitimately costs hundreds of
// milliseconds to a couple of seconds. Vitest's 5s default left almost no headroom: on a loaded
// machine they failed in a batch at ~5025ms — a timeout, not a defect. The raise is scoped to
// this file on purpose, so the fast unit suites keep the strict default and a genuine hang there
// still surfaces in five seconds rather than thirty.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const CHAIN = { brainstorm: ["researcher", "writer"] };
let p: HarnessProject;

beforeEach(async () => {
  p = await harnessProject({ stage: "brainstorm", stages: CHAIN });
});
afterEach(async () => {
  await p.cleanup();
});

describe("a stage runs its chain of roles in order", () => {
  it("runs every role as its own worker and records role plus runner", async () => {
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("researcher (codex)");
    expect(res.stdout).toContain("writer (gemini)");
    expect(res.stdout.indexOf("researcher (codex)")).toBeLessThan(res.stdout.indexOf("writer (gemini)"));

    const runs = p.feature().meta!.runs!;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ role: "researcher", runner: "codex", stage: "brainstorm", status: "done" });
    expect(runs[1]).toMatchObject({ role: "writer", runner: "gemini", stage: "brainstorm", status: "done" });
    expect(runs[0].log).not.toBe(runs[1].log);
    for (const run of runs) expect(existsSync(join(p.feature().dir, run.log))).toBe(true);
    expect(p.cli.prompt("codex")).not.toBe("");
    expect(p.cli.prompt("gemini")).not.toBe("");
  });

  it("gives each worker its role brief, its output file and what the previous role left", async () => {
    await cmdRun(args("run", ["demo"]), p.root);
    const first = p.cli.prompt("codex");
    const second = p.cli.prompt("gemini");

    expect(first).toContain('You are the "researcher" worker');
    expect(first).toContain("Your role: Explores breadth.");
    expect(first).toContain(join(".works", "brainstorm", "demo_20260919_1200", "research.md"));
    expect(first).not.toContain("Previous step:");

    expect(second).toContain('You are the "writer" worker');
    expect(second).toContain("Your role: Writes precise prose.");
    expect(second).toContain('The "researcher" role ran before you');
    expect(second).toContain(join("demo_20260919_1200", "research.md"));
    expect(second).toContain(join("demo_20260919_1200", "runs", `${p.feature().meta!.runs![0].id}.log`));
    expect(second).not.toContain("Write your findings to");
    for (const prompt of [first, second]) {
      expect(prompt).toContain("Never run `kf stage`");
      expect(prompt).toContain("STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT");
    }
  });

  it("stops the chain when a role does not finish, and keeps going on concerns", async () => {
    p.cli.scenario("codex", { stdout: "STATUS: BLOCKED\nSummary: need the API docs" });
    const blocked = await cmdRun(args("run", ["demo"]), p.root);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain('Chain stopped at role "researcher"');
    expect(blocked.stdout).toContain("not run: writer");
    expect(p.feature().meta!.runs).toHaveLength(1);
    expect(p.cli.prompt("gemini")).toBe("");

    p.cli.scenario("codex", { stdout: "STATUS: DONE_WITH_CONCERNS\nSummary: thin prior art" });
    const concerns = await cmdRun(args("run", ["demo"]), p.root);
    expect(concerns.code, concerns.stdout).toBe(0);
    expect(p.feature().meta!.runs).toHaveLength(3);
    expect(p.cli.prompt("gemini")).not.toBe("");

    p.cli.scenario("codex", { stdout: "nothing useful", exit: 1 });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(1);
    expect(p.feature().meta!.runs).toHaveLength(4);
  });

  it("runs one role with --role, rejects the removed --agent flag and plans the whole chain on --dry-run", async () => {
    const one = await cmdRun(args("run", ["demo"], { role: "writer" }), p.root);
    expect(one.code, one.stdout).toBe(0);
    expect(p.feature().meta!.runs).toHaveLength(1);
    expect(p.feature().meta!.runs![0].role).toBe("writer");
    expect(p.cli.prompt("codex")).toBe("");

    const unknown = await cmdRun(args("run", ["demo"], { role: "nobody" }), p.root);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("Known roles:");

    const offChain = await cmdRun(args("run", ["demo"], { role: "reviewer" }), p.root);
    expect(offChain.code).toBe(1);
    expect(offChain.stdout).toContain("researcher → writer");

    const removed = await cmdRun(args("run", ["demo"], { agent: "gemini" }), p.root);
    expect(removed.code).toBe(1);
    expect(removed.stdout).toContain("--agent was replaced by --role");

    const dry = await cmdRun(args("run", ["demo"], { "dry-run": true }), p.root);
    expect(dry.stdout).toContain("chain: researcher → writer");
    expect(dry.stdout).toContain("[1/2] researcher (codex)");
    expect(dry.stdout).toContain("[2/2] writer (gemini)");
    expect(p.feature().meta!.runs).toHaveLength(1);
  });
});

describe("sessions belong to the role, not the runner", () => {
  it("keeps two roles on the same runner apart and resumes each on its own", async () => {
    await p.writeHarness(harnessWith({ implementation: ["coder"], review: ["auditor"] }, { auditor: { runner: "claude", brief: "Audits." } }));
    await p.addFeature("impl", "implementation");
    await p.addFeature("rev", "review");

    expect((await cmdRun(args("run", ["impl"]), p.root)).code).toBe(0);
    expect((await cmdRun(args("run", ["rev"]), p.root)).code).toBe(0);
    const coderSession = p.feature("impl").meta!.sessions!.coder;
    const auditorSession = p.feature("rev").meta!.sessions!.auditor;
    expect(coderSession).toBeDefined();
    expect(auditorSession).toBeDefined();
    expect(coderSession).not.toBe(auditorSession);

    p.cli.scenario("claude", { resumeStdout: "STATUS: DONE\nSummary: resumed" });
    expect((await cmdRun(args("run", ["impl"]), p.root)).code).toBe(0);
    const argv = p.cli.argv("claude");
    expect(argv[argv.indexOf("-r") + 1]).toBe(coderSession);
    expect(p.feature("impl").meta!.runs!.map((r) => r.mode)).toEqual(["start", "resume"]);

    expect((await cmdRun(args("run", ["impl"], { fresh: true }), p.root)).code).toBe(0);
    expect(p.feature("impl").meta!.sessions!.coder).not.toBe(coderSession);
    expect(p.feature("rev").meta!.sessions!.auditor).toBe(auditorSession);
  });

  it("refuses metadata that still uses the old per-agent run shape", async () => {
    const dir = p.feature().dir;
    const base = { schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200" };
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ ...base, runs: [{ id: "x", agent: "gemini", stage: "testing", mode: "start", at: "t", log: "runs/x.log", status: "done" }] }));
    expect(() => readFeatureMeta(dir)).toThrow("Invalid feature metadata");
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ ...base, runs: [{ id: "x", role: "tester", runner: "gemini", stage: "testing", mode: "start", at: "t", log: "runs/x.log", status: "done" }], sessions: { tester: "s1" } }));
    expect(readFeatureMeta(dir)!.runs![0].role).toBe("tester");
  });
});

describe("the skills dir follows the runner, not the role name", () => {
  it("names both the role and its runner when the skill is missing", async () => {
    const res = await cmdRun(args("run", ["demo"], { role: "writer" }), p.root);
    expect(res.code).toBe(0);
    expect(p.cli.prompt("gemini")).toContain(join(".gemini", "skills", "kanban-brainstorm", "SKILL.md"));

    await p.writeHarness(harnessWith({ brainstorm: ["scribe"] }, { scribe: { runner: "opencode" } }));
    const { rm } = await import("node:fs/promises");
    await rm(join(p.root, ".opencode", "skills", "kanban-brainstorm"), { recursive: true, force: true });
    const missing = await cmdRun(args("run", ["demo"]), p.root);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain('role "scribe" (runner opencode)');
    expect(missing.stdout).toContain("kf install --agent opencode");
    expect(missing.stdout).toContain(join(".opencode", "skills"));
  });
});

describe("a chain that stopped early is visible", () => {
  it("marks the run that ended a chain short of its last role", async () => {
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("[1/2] researcher");
    expect(res.stdout).toContain("[2/2] writer");
    const done = (await cmdRuns(args("runs", ["demo"]), p.root)).stdout;
    expect(done).toContain("2/2");
    expect(done).not.toContain("chain stopped");

    // Supervisor dying mid-chain leaves exactly this: step 1 of 2 finished, nothing running.
    const runs = p.feature().meta!.runs!;
    await writeFeatureMeta(p.feature().dir, { ...p.feature().meta!, runs: [{ ...runs[0], chain: { id: "c9", index: 1, total: 2 } }] });
    const broken = await cmdRuns(args("runs", ["demo"]), p.root);
    expect(broken.stdout).toContain("chain stopped 1/2");
    expect(broken.stdout).toContain("the remaining roles never ran");
    expect(JSON.parse((await cmdRuns(args("runs", ["demo"], { json: true }), p.root)).stdout)[0].chainBroken).toBe(true);
  });

  it("flags the chain a blocked role cut short", async () => {
    p.cli.scenario("codex", { stdout: "STATUS: BLOCKED\nSummary: stuck" });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(1);
    const view = JSON.parse((await cmdRuns(args("runs", ["demo"], { json: true }), p.root)).stdout)[0];
    expect(view).toMatchObject({ role: "researcher", chainBroken: true });
    expect(view.chain).toEqual({ id: view.chain.id, index: 1, total: 2 });
  });

  it("keeps the placeholder in a dry-run prompt obviously fake", async () => {
    const dry = await cmdRun(args("run", ["demo"], { "dry-run": true }), p.root);
    expect(dry.stdout).toContain("<log of the previous run, known at run time>");
    expect(dry.stdout).not.toContain("runs/<previous>.log");
  });
});

describe("status, view and runs report roles", () => {
  it("shows the chain, per-role counts and per-role usage", async () => {
    await writeFeatureMeta(p.feature().dir, {
      ...p.feature().meta!,
      runs: [
        { id: "r1", role: "researcher", runner: "codex", stage: "brainstorm", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/r1.log", status: "done", exitCode: 0, usage: { input: 8, output: 2 } },
        { id: "w1", role: "writer", runner: "gemini", stage: "brainstorm", mode: "start", at: "2026-09-19T11:00:00Z", log: "runs/w1.log", status: "failed", exitCode: 1 },
      ],
    });
    const text = (await cmdStatus(args("status", [], { change: "demo" }), p.root)).stdout;
    expect(text).toContain("Assigned: researcher (codex) → writer (gemini) (kf run)");
    expect(text).toContain("Runs: 2 (researcher×1, writer×1)");

    const json = JSON.parse((await cmdStatus(args("status", [], { change: "demo", json: true }), p.root)).stdout);
    expect(json.assignedRoles).toEqual([{ role: "researcher", runner: "codex" }, { role: "writer", runner: "gemini" }]);

    const view = JSON.parse((await cmdView(args("view", [], { json: true }), p.root)).stdout);
    expect(view.metrics.runs.byRole).toEqual({ researcher: { runs: 1, done: 1, failed: 0 }, writer: { runs: 1, done: 0, failed: 1 } });
    expect(view.metrics.runs.usage.researcher).toEqual({ input: 8, output: 2, costUsd: 0 });
    expect(view.metrics.runs).not.toHaveProperty("byAgent");
    expect((await cmdView(args("view"), p.root)).stdout).toContain("Worker runs by role:");

    const runs = (await cmdRuns(args("runs", ["demo"]), p.root)).stdout;
    expect(runs).toMatch(/w1\s+demo\s+writer\s+gemini\s+brainstorm/);
    expect(runs).toMatch(/r1\s+demo\s+researcher\s+codex\s+brainstorm/);
    expect(await readFile(join(p.root, ".kf", "config.json"), "utf8")).toContain('"researcher"');
  });
});
