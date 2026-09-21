import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { cmdRun, cmdRuns } from "../cli/commands/run.js";
import { writeFeatureMeta } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import { harnessProject, type HarnessProject } from "./helpers/harness-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

// These tests spawn real worker processes, so each one legitimately costs hundreds of
// milliseconds to a couple of seconds. Vitest's 5s default left almost no headroom: on a loaded
// machine they failed in a batch at ~5025ms — a timeout, not a defect. The raise is scoped to
// this file on purpose, so the fast unit suites keep the strict default and a genuine hang there
// still surfaces in five seconds rather than thirty.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let p: HarnessProject;

beforeEach(async () => {
  p = await harnessProject();
});
afterEach(async () => {
  await p.cleanup();
});

describe("kf run --detach", () => {
  it("returns immediately, the supervisor finishes the run and kf runs tracks it", async () => {
    expect(existsSync(join(PKG_ROOT, "dist", "index.js"))).toBe(true);
    p.cli.scenario("gemini", { sleep: 1 });
    const started = Date.now();
    const res = await cmdRun(args("run", ["demo"], { detach: true }), p.root);
    expect(res.code, res.stdout).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(res.stdout).toContain("started detached");
    const first = p.feature().meta!.runs![0];
    expect(first.status).toBe("running");
    expect(first.supervisorPid).toBeGreaterThan(0);

    expect((await cmdRuns(args("runs", ["demo"]), p.root)).stdout).toContain("running");
    for (let i = 0; i < 40 && p.feature().meta!.runs![0].status === "running"; i += 1) await wait(250);
    const done = p.feature().meta!.runs![0];
    expect(done).toMatchObject({ id: first.id, status: "done", exitCode: 0, statusLine: "DONE" });
    expect(done.endedAt).toBeDefined();
    const views = JSON.parse((await cmdRuns(args("runs", ["demo"], { json: true }), p.root)).stdout);
    expect(views[0]).toMatchObject({ id: first.id, displayStatus: "done" });
  }, 20_000);

  it("shows a lost supervisor without rewriting metadata, and refuses a second run while one is alive", async () => {
    await writeFeatureMeta(p.feature().dir, {
      ...p.feature().meta!,
      runs: [{ id: "dead", role: "tester", runner: "gemini", stage: "testing", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/dead.log", status: "running", pid: 999_999, supervisorPid: 999_998 }],
    });
    expect((await cmdRuns(args("runs", ["demo"]), p.root)).stdout).toContain("failed (supervisor lost)");
    expect(p.feature().meta!.runs![0].status).toBe("running");
    expect((await cmdRun(args("run", ["demo"]), p.root)).code).toBe(0);

    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      await writeFeatureMeta(p.feature().dir, {
        ...p.feature().meta!,
        runs: [{ id: "alive", role: "tester", runner: "gemini", stage: "testing", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/alive.log", status: "running", pid: sleeper.pid }],
      });
      const res = await cmdRun(args("run", ["demo"]), p.root);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("Run alive");
      expect(p.cli.argv("gemini").length).toBeGreaterThan(0);
    } finally {
      sleeper.kill();
    }
  });
});
