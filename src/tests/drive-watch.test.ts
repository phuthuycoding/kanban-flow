import { describe, it, expect, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, appendFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgsCli } from "../cli/args.js";
import { cmdDrive } from "../cli/commands/drive.js";
import { followDrive } from "../harness/drive.js";
import { DRIVE_HEARTBEAT_MS } from "../harness/drive/watch.js";
import { formatElapsed, liveRunLabel } from "../harness/drive/progress.js";
import { driveLogPath } from "../harness/drive-log.js";
import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import { gitDriveProject, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const args = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "drive", positionals, options });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("drive progress labels", () => {
  it("formats elapsed time and the heartbeat label", () => {
    const now = Date.parse("2026-10-28T00:02:14.000Z");
    expect(formatElapsed("2026-10-28T00:00:00.000Z", now)).toBe("2m14s");
    expect(formatElapsed("2026-10-28T00:01:11.000Z", now)).toBe("1m03s");
    expect(formatElapsed("2026-10-28T00:02:00.000Z", now)).toBe("14s");
    expect(liveRunLabel({ task: "TASK-006", role: "coder", runner: "claude-dev", stage: "implementation", elapsed: "2m14s" })).toBe("TASK-006 coder claude-dev 2m14s");
    expect(liveRunLabel({ role: "tester", runner: "gemini", stage: "testing", elapsed: "1m03s" })).toBe("tester @ testing 1m03s");
    expect(DRIVE_HEARTBEAT_MS).toBeLessThanOrEqual(15_000);
  });

  it("keeps integrations off the CLI result type", () => {
    const src = fileURLToPath(new URL("..", import.meta.url));
    for (const file of ["integrations/github.ts", "integrations/install.ts"]) {
      expect(readFileSync(join(src, file), "utf8"), file).not.toMatch(/from ["'][^"']*\/cli\//);
    }
  });

  it("parses --watch, --follow and --tail", () => {
    expect(parseArgsCli(["drive", "demo", "--follow", "--tail", "--json"]).options).toMatchObject({ follow: true, tail: true, json: true });
    expect(parseArgsCli(["drive", "demo", "--watch"]).options.watch).toBe(true);
  });
});

describe("followDrive", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function item(): Promise<string> {
    root = await mkdtemp(join(tmpdir(), "kf-watch-"));
    ensureWorksStructure(root);
    const dir = join(root, ".works", "implementation", "demo_20261028_0000");
    await mkdir(join(dir, "runs"), { recursive: true });
    await writeFeatureMeta(dir, {
      schema: "kanban-flow", feature: "demo", context: "app", created: "20261028_0000",
      drive: {
        id: "drv1", status: "running", step: "implementation", loops: 0, runs: 1, configHash: "abc",
        supervisorPid: process.pid, startedAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z",
      },
      runs: [{
        id: "run1", role: "coder", runner: "claude-dev", stage: "implementation", mode: "start", task: "TASK-006",
        at: new Date(Date.now() - 134_000).toISOString(), log: "runs/run1.log", status: "running", supervisorPid: process.pid,
      }],
    });
    await writeFile(join(dir, "runs", "run1.log"), "working\n");
    return dir;
  }

  it("prints new events and a heartbeat, then the drive result", async () => {
    const dir = await item();
    const lines: string[] = [];
    const ac = new AbortController();
    const followed = followDrive({
      root, name: "demo", json: false, tail: true, replay: true, signal: ac.signal,
      heartbeatMs: 40, pollMs: 15, write: (line) => lines.push(line),
    });
    const until = async (ok: () => boolean) => {
      const end = Date.now() + 2_000;
      while (!ok()) {
        if (Date.now() > end) throw new Error(`timed out; lines ${JSON.stringify(lines)}`);
        await wait(15);
      }
    };
    await until(() => lines.some((l) => l.startsWith("♥ TASK-006 coder claude-dev") && lines.some((t) => t.includes("working"))));
    await appendFile(driveLogPath(dir, "drv1"), `${JSON.stringify({ at: "2026-10-28T00:00:01.000Z", event: "task", task: "TASK-006", state: "running" })}\n`);
    await until(() => lines.some((l) => l.includes("task") && l.includes("TASK-006")));
    const feature = findFeature(root, "demo")!;
    await writeFeatureMeta(feature.dir, {
      ...feature.meta!,
      drive: { ...feature.meta!.drive!, status: "ready", reason: "ready for ship decision", nextCommand: "kf ship demo" },
    });
    const result = await followed;
    expect(result).toEqual({ code: 0, detached: false });
    expect(lines.some((l) => l.includes("ready for ship decision") && l.includes("kf ship demo"))).toBe(true);
  });

  it("streams JSON lines and detaches on abort without stopping the drive", async () => {
    await item();
    const lines: string[] = [];
    const ac = new AbortController();
    const followed = followDrive({
      root, name: "demo", json: true, tail: false, replay: false, signal: ac.signal,
      heartbeatMs: 20, pollMs: 10, write: (line) => lines.push(line),
    });
    const end = Date.now() + 2_000;
    while (!lines.some((l) => l.includes('"heartbeat"'))) {
      if (Date.now() > end) throw new Error(`timed out; lines ${JSON.stringify(lines)}`);
      await wait(10);
    }
    ac.abort();
    expect(await followed).toEqual({ code: 0, detached: true });
    for (const line of lines) expect(() => JSON.parse(line), line).not.toThrow();
    expect(findFeature(root, "demo")!.meta!.drive!.status).toBe("running");
  });
});

describe("kf drive --watch on a live drive", () => {
  let p: GitDriveProject | null = null;
  afterEach(async () => {
    await p?.cleanup();
    p = null;
  });

  const status = async (pr: GitDriveProject) => JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);

  it("shows the live run, logs run_start, and Ctrl+C leaves the drive running", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001", files: ["src/a.txt"] }], stages: { implementation: ["coder"], testing: ["tester"], review: ["reviewer"] } });
    const pr = p;
    pr.cli.scenario("claude", { sleep: 30 }, "TASK-001");
    expect((await cmdDrive(args(["demo"]), pr.root)).code).toBe(0);
    const end = Date.now() + 30_000;
    let view: any;
    for (;;) {
      view = await status(pr);
      if (view.runningTasks?.includes("TASK-001") && view.liveRuns?.length > 0) break;
      if (Date.now() > end) throw new Error(`timed out; last status ${JSON.stringify(view)}`);
      await wait(200);
    }
    const live = view.liveRuns[0];
    expect(live).toMatchObject({ role: "coder", task: "TASK-001" });
    expect(live.runner).toEqual(expect.any(String));
    expect(live.elapsed).toMatch(/^\d+s$|^\d+m\d{2}s$/);
    expect(live.log).toContain(`${live.id}.log`);
    expect(view.lastEvent.at).toEqual(expect.any(String));
    expect(view.lastEvent.summary.length).toBeGreaterThan(0);
    const text = await cmdDrive(args(["demo"], { status: true }), pr.root);
    expect(text.stdout).toContain(`Live: TASK-001 coder ${live.runner}`);
    expect(text.stdout).toContain(live.log);

    const id = pr.readMeta()!.drive!.id;
    const logged = readFileSync(join(pr.itemDir(), "runs", `drive-${id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const start = logged.find((e) => e.event === "run_start" && e.task === "TASK-001");
    expect(start).toMatchObject({ role: "coder", runner: live.runner, log: expect.stringContaining(`${live.id}.log`) });

    const child = spawn(process.execPath, [join(PKG_ROOT, "dist", "index.js"), "drive", "demo", "--watch", "--json"], { cwd: pr.root });
    let out = "";
    let err = "";
    child.stderr.on("data", (buf: Buffer) => { err += buf.toString("utf8"); });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`watcher still up; stdout ${out}; stderr ${err}`)), 20_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    let signaled = false;
    child.stdout.on("data", (buf: Buffer) => {
      out += buf.toString("utf8");
      if (!signaled && out.includes("\"heartbeat\"")) {
        signaled = true;
        child.kill("SIGINT");
      }
    });
    const done = await exited;
    expect(done, `stdout ${JSON.stringify(out)}\nstderr ${JSON.stringify(err)}`).toEqual({ code: 0, signal: null });
    expect(out).toContain("Detached from drive");
    expect(out).toContain("keeps running");
    for (const line of out.split("\n").filter((l) => l.startsWith("{"))) expect(() => JSON.parse(line)).not.toThrow();
    expect((await status(pr)).state).toBe("running");
    expect(existsSync(join(pr.itemDir(), "runs", `drive-${id}.jsonl`))).toBe(true);
    expect((await cmdDrive(args(["demo"], { stop: true }), pr.root)).code).toBe(0);
  });
});
