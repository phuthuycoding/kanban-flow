import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { cmdRun, cmdRuns } from "../cli/commands/run.js";
import { cmdStatus, cmdView } from "../cli/commands/inspect.js";
import { harnessPresets } from "../harness/config.js";
import { captureSession, parseUsage } from "../harness/session.js";
import { extractStatus, isPidAlive } from "../harness/run.js";
import { writeFeatureMeta } from "../workflow/features.js";
import * as paths from "../shared/paths.js";
import { vi } from "vitest";
import { harnessProject, harnessWith, DEFAULT_STAGES, type HarnessProject } from "./helpers/harness-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
let p: HarnessProject;

beforeEach(async () => {
  p = await harnessProject();
});
afterEach(async () => {
  await p.cleanup();
});

describe("kf run hands a stage to the assigned worker", () => {
  it("spawns the runner with a provided session, records the run and reports STATUS", async () => {
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("STATUS: DONE");
    expect(res.stdout).toContain("Summary: fake ok");

    const argv = p.cli.argv("gemini");
    expect(argv[0]).toBe("-p");
    expect(argv.slice(2)).toEqual(["--approval-mode", "auto_edit"]);
    const prompt = argv[1];
    expect(prompt.startsWith("kf-run:")).toBe(true);
    expect(prompt).toContain(join(".works", "testing", "demo_20260919_1200"));
    expect(prompt).toContain(join(".gemini", "skills", "kanban-test", "SKILL.md"));
    expect(prompt).toContain("kf instruct");
    expect(prompt).toContain("Never run `kf stage`");
    expect(prompt).toContain("STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT");

    const meta = p.feature().meta!;
    expect(meta.sessions).toBeUndefined();
    const run = meta.runs![0];
    expect(run).toMatchObject({ role: "tester", runner: "gemini", stage: "testing", mode: "start", status: "done", exitCode: 0, statusLine: "DONE", summary: "fake ok" });
    expect(await readFile(join(p.feature().dir, run.log), "utf8")).toContain("STATUS: DONE");
  });

  it("uses --session-id for providers that accept a kf-generated id and resumes it next time", async () => {
    await p.writeHarness(harnessWith({ testing: ["coder"] }));
    p.cli.scenario("claude", { stdout: '{"type":"result","session_id":"ignored","usage":{"input_tokens":10,"output_tokens":5},"total_cost_usd":0.5}\nSTATUS: DONE\nSummary: first' });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    const first = p.cli.argv("claude");
    const uuid = first[first.indexOf("--session-id") + 1];
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.feature().meta!.sessions).toEqual({ coder: uuid });
    expect(p.feature().meta!.runs![0].usage).toEqual({ input: 10, output: 5, costUsd: 0.5 });

    p.cli.scenario("claude", { resumeStdout: "STATUS: DONE\nSummary: second" });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    const second = p.cli.argv("claude");
    expect(second).toContain("-r");
    expect(second[second.indexOf("-r") + 1]).toBe(uuid);
    expect(second).not.toContain("--session-id");
    expect(p.feature().meta!.runs!.map((r) => r.mode)).toEqual(["start", "resume"]);

    expect((await cmdRun(args("run", ["demo"], { fresh: true }), p.root)).code).toBe(0);
    const third = p.cli.argv("claude");
    expect(third).toContain("--session-id");
    expect(p.feature().meta!.sessions!.coder).not.toBe(uuid);
  });

  it("points a repair run at the current FAIL report", async () => {
    const dir = await p.addFeature("fix-me", "implementation");
    await writeFile(join(dir, "phase-4-testing-result.md"), "---\nstatus: FAIL\n---\n# fail");
    expect((await cmdRun(args("run", ["fix-me"]), p.root)).code).toBe(0);
    expect(p.cli.prompt("claude")).toContain(join(".works", "implementation", "fix-me_20260919_1200", "phase-4-testing-result.md"));
  });

  it("prints argv and prompt on --dry-run without side effects", async () => {
    const res = await cmdRun(args("run", ["demo"], { "dry-run": true }), p.root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('"--approval-mode"');
    expect(res.stdout).toContain("kf-run:");
    expect(p.cli.argv("gemini")).toEqual([]);
    expect(p.feature().meta!.runs).toBeUndefined();
  });

  it("refuses unassigned stages unless --agent overrides, and archived or unknown items", async () => {
    await p.addFeature("free", "review");
    const unassigned = await cmdRun(args("run", ["free"]), p.root);
    expect(unassigned.code).toBe(1);
    expect(unassigned.stdout).toContain("main role (architect) does it");
    expect((await cmdRun(args("run", ["free"], { role: "reviewer" }), p.root)).code).toBe(0);
    expect(p.cli.prompt("codex")).toContain("kanban-review");
    await p.addFeature("old", "dones");
    expect((await cmdRun(args("run", ["old"]), p.root)).code).toBe(1);
    expect((await cmdRun(args("run", ["nope"]), p.root)).code).toBe(1);
    expect((await cmdRun(args("run", ["demo"], { stage: "nowhere" }), p.root)).code).toBe(1);
  });

  it("refuses to run when the worker's skill is not installed", async () => {
    await rm(join(p.root, ".gemini", "skills", "kanban-test"), { recursive: true, force: true });
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain('role "tester" (runner gemini)');
    expect(p.feature().meta!.runs).toBeUndefined();
  });

  it("fails a run whose worker exits 0 without a STATUS line, and keeps the last STATUS otherwise", async () => {
    p.cli.scenario("gemini", { stdout: "did things" });
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("STATUS: (missing)");
    expect(p.feature().meta!.runs![0]).toMatchObject({ status: "done", exitCode: 0, statusLine: null });

    p.cli.scenario("gemini", { stdout: "STATUS: BLOCKED\nlater\nSTATUS: DONE\nSummary: recovered" });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    expect(p.feature().meta!.runs![1].statusLine).toBe("DONE");
    expect(extractStatus(`${"x".repeat(70_000)}\nSTATUS: DONE\n`).statusLine).toBe("DONE");
  });

  it("reads STATUS from inside JSON output as claude and codex really print it", async () => {
    await p.writeHarness(harnessWith({ testing: ["coder"], review: ["reviewer"] }));
    const claudeJson = JSON.stringify({ type: "result", subtype: "success", result: "Wrote the report.\n\nSTATUS: DONE_WITH_CONCERNS\nSummary: coverage tool missing", session_id: "x", usage: { input_tokens: 7, output_tokens: 3 }, modelUsage: { "claude-opus-5": { inputTokens: 7 } } });
    p.cli.scenario("claude", { stdout: claudeJson });
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(p.feature().meta!.runs![0]).toMatchObject({ statusLine: "DONE_WITH_CONCERNS", summary: "coverage tool missing", usage: { input: 7, output: 3 } });

    await p.addFeature("rev", "review");
    p.cli.scenario("codex", { stdout: [
      JSON.stringify({ type: "thread.started", thread_id: "t-1" }),
      JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "All good.\nSTATUS: DONE\nSummary: reviewed" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
    ].join("\n") });
    expect((await cmdRun(args("run", ["rev"]), p.root)).code).toBe(0);
    expect(p.feature("rev").meta!.runs![0]).toMatchObject({ role: "reviewer", runner: "codex", statusLine: "DONE", summary: "reviewed", session: "t-1" });
    expect(extractStatus(`${JSON.stringify({ result: "STATUS: BLOCKED" })}\nSTATUS: DONE`)).toMatchObject({ statusLine: "BLOCKED" });
  });

  it("kills the worker when its pid cannot be recorded", async () => {
    p.cli.scenario("gemini", { sleep: 5 });
    const writer = paths.writeFileAtomic;
    vi.spyOn(paths, "writeFileAtomic").mockImplementation(async (file, content) => {
      if (file.endsWith(".kfw.json") && content.includes('"pid"')) throw new Error("Simulated metadata write failure");
      await writer(file, content);
    });
    try {
      await expect(cmdRun(args("run", ["demo"]), p.root)).rejects.toThrow("Simulated metadata write failure");
    } finally {
      vi.restoreAllMocks();
    }
    for (let i = 0; i < 20 && isPidAlive(p.cli.pid("gemini") ?? undefined); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(isPidAlive(p.cli.pid("gemini") ?? undefined)).toBe(false);
  }, 15_000);

  it("captures a session id from stdout for codex-style runners and warns when absent", async () => {
    await p.writeHarness(harnessWith({ testing: ["reviewer"] }));
    p.cli.scenario("codex", { stdout: '{"type":"thread.started","thread_id":"abc-123"}\n{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":1}}\nSTATUS: DONE\nSummary: ok' });
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    expect(p.feature().meta!.sessions).toEqual({ reviewer: "abc-123" });
    expect(p.feature().meta!.runs![0].usage).toEqual({ input: 3, output: 1 });
    expect(captureSession(harnessPresets().codex, undefined, { stdout: "nothing", marker: "m", cwd: p.root, env: process.env })).toBeNull();

    await p.addFeature("second", "testing");
    p.cli.scenario("codex", { stdout: "STATUS: DONE\nSummary: no id" });
    expect((await cmdRun(args("run", ["second"]), p.root)).code).toBe(0);
    expect(p.feature("second").meta!.sessions).toBeUndefined();
    expect(p.feature("second").meta!.runs![0].warning).toContain("not captured");
  });

  it("looks the session up through a list command matching the run marker (devin-style)", async () => {
    await p.writeHarness(harnessWith({ implementation: ["builder"] }, { builder: { runner: "devin" } }));
    await p.addFeature("impl", "implementation");
    p.cli.scenario("devin", { stdout: "STATUS: DONE\nSummary: ok", list: '[{"id":"lead-porcupine","title":"other"},{"id":"sordid-guanaco","title":"{marker} more"}]' });
    expect((await cmdRun(args("run", ["impl"]), p.root)).code).toBe(0);
    expect(p.feature("impl").meta!.sessions).toEqual({ builder: "sordid-guanaco" });
  });

  it("always starts fresh for runners without resume", async () => {
    await p.writeHarness(harnessWith({ testing: ["scribe"] }, { scribe: { runner: "opencode" } }));
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);
    expect(p.feature().meta!.runs!.map((r) => r.mode)).toEqual(["start", "start"]);
    expect(p.feature().meta!.sessions).toBeUndefined();
    expect(p.cli.argv("opencode")).toEqual(["run", p.cli.argv("opencode")[1]]);
  });

  it("resets a dead session once and re-runs fresh, but not on other failures", async () => {
    await p.writeHarness(harnessWith({ testing: ["coder"] }));
    await writeFeatureMeta(p.feature().dir, { ...p.feature().meta!, sessions: { coder: "dead-session" } });
    p.cli.scenario("claude", { resumeStdout: "Error: session not found", resumeExit: 1, stdout: "STATUS: DONE\nSummary: fresh" });
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("was reset");
    const runs = p.feature().meta!.runs!;
    expect(runs.map((r) => [r.mode, r.status])).toEqual([["resume", "reset"], ["start", "done"]]);
    expect(p.feature().meta!.sessions!.coder).not.toBe("dead-session");

    p.cli.scenario("claude", { resumeStdout: "boom: disk full", resumeExit: 1 });
    const kept = p.feature().meta!.sessions!.coder;
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(1);
    expect(p.feature().meta!.runs!.at(-1)).toMatchObject({ mode: "resume", status: "failed" });
    expect(p.feature().meta!.sessions!.coder).toBe(kept);
  });

  it("kills a worker that exceeds --timeout and honours --timeout 0", async () => {
    p.cli.scenario("gemini", { sleep: 5 });
    const started = Date.now();
    const res = await cmdRun(args("run", ["demo"], { timeout: "0.02" }), p.root);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(res.code).toBe(1);
    const run = p.feature().meta!.runs![0];
    expect(run.status).toBe("timeout");
    expect(() => process.kill(run.pid!, 0)).toThrow();

    p.cli.scenario("gemini", { sleep: undefined });
    expect((await cmdRun(args("run", ["demo"], { timeout: "0" }), p.root)).code).toBe(0);
  }, 15_000);

  it("reports a missing CLI without hiding the error", async () => {
    await p.writeHarness(harnessWith({ testing: ["tester"] }, { tester: { runner: "ghost" } }, { ghost: { start: ["definitely-not-a-cli", "-p", "{prompt}"], skillsDir: ".gemini/skills" } }));
    const res = await cmdRun(args("run", ["demo"]), p.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("definitely-not-a-cli");
    expect(p.feature().meta!.runs![0]).toMatchObject({ status: "failed" });
    expect(p.feature().meta!.runs![0].error).toContain("ENOENT");
  });
});

describe("status, view and runs show worker activity", () => {
  it("renders assignment and run counts", async () => {
    await writeFeatureMeta(p.feature().dir, {
      ...p.feature().meta!,
      runs: [
        { id: "a1", role: "tester", runner: "gemini", stage: "testing", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/a1.log", status: "done", exitCode: 0, usage: { input: 10, output: 2 } },
        { id: "a2", role: "tester", runner: "gemini", stage: "testing", mode: "resume", at: "2026-09-19T11:00:00Z", log: "runs/a2.log", status: "done", exitCode: 0, usage: { input: 5, output: 1 } },
        { id: "b1", role: "reviewer", runner: "codex", stage: "testing", mode: "start", at: "2026-09-19T12:00:00Z", log: "runs/b1.log", status: "failed", exitCode: 1 },
      ],
    });
    const text = (await cmdStatus(args("status", [], { change: "demo" }), p.root)).stdout;
    expect(text).toContain("Assigned: tester (gemini) (kf run)");
    expect(text).toContain("Runs: 3 (tester×2, reviewer×1)");
    const json = JSON.parse((await cmdStatus(args("status", [], { change: "demo", json: true }), p.root)).stdout);
    expect(json.assignedRoles).toEqual([{ role: "tester", runner: "gemini" }]);
    expect(json.runs).toHaveLength(3);

    const view = JSON.parse((await cmdView(args("view", [], { json: true }), p.root)).stdout);
    expect(view.metrics.runs.byRole).toEqual({ tester: { runs: 2, done: 2, failed: 0 }, reviewer: { runs: 1, done: 0, failed: 1 } });
    expect(view.metrics.runs.usage.tester).toEqual({ input: 15, output: 3, costUsd: 0 });
    expect((await cmdView(args("view"), p.root)).stdout).toContain("tester       2 runs (2 done, 0 failed)  15 in / 3 out");

    const runs = (await cmdRuns(args("runs"), p.root)).stdout.split("\n");
    expect(runs[0].startsWith("b1")).toBe(true);
    expect(runs).toHaveLength(3);
    expect(JSON.parse((await cmdRuns(args("runs", ["demo"], { json: true }), p.root)).stdout)[0].displayStatus).toBe("failed");

    await p.addFeature("plain", "review");
    expect((await cmdStatus(args("status", [], { change: "plain" }), p.root)).stdout).not.toContain("Assigned:");
    expect(DEFAULT_STAGES.testing).toEqual(["tester"]);
  });

  it("parses usage only from JSON that carries token counts", () => {
    expect(parseUsage('{"usage":{"input_tokens":1,"output_tokens":2}}')).toEqual({ input: 1, output: 2 });
    expect(parseUsage("plain text\nSTATUS: DONE")).toBeNull();
    expect(parseUsage('{"usage":{"input_tokens":"x"}}')).toBeNull();
    expect(existsSync(p.root)).toBe(true);
  });
});
