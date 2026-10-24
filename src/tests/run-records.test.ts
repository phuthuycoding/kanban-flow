import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyRunRecord, mergeRunRecord } from "../harness/run.js";
import { findFeature, writeFeatureMeta, type RunRecord } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

vi.setConfig({ testTimeout: 60_000 });

const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: "r1", role: "coder", runner: "fake", stage: "implementation", mode: "start", at: "2026-01-01T00:00:00Z", log: "runs/r1.log", status: "running", ...over,
});

describe("run record merge", () => {
  it("TC-035: running -> done -> late running+pid keeps done and the pid", () => {
    const done = rec({ status: "done", exitCode: 0, statusLine: "DONE", summary: "ok", endedAt: "2026-01-01T00:01:00Z", usage: { input: 1, output: 2 } });
    const merged = mergeRunRecord(done, rec({ pid: 4242, supervisorPid: 4243 }));
    expect(merged).toMatchObject({ status: "done", exitCode: 0, statusLine: "DONE", summary: "ok", endedAt: "2026-01-01T00:01:00Z", usage: { input: 1, output: 2 }, pid: 4242, supervisorPid: 4243 });
  });

  it("TC-035: failed -> running stays failed", () => {
    const failed = rec({ status: "failed", exitCode: 1, error: "boom" });
    expect(mergeRunRecord(failed, rec())).toMatchObject({ status: "failed", exitCode: 1, error: "boom" });
  });

  it("every finished status resists a late running write", () => {
    for (const status of ["done", "failed", "timeout", "reset"] as const) {
      expect(mergeRunRecord(rec({ status }), rec({ pid: 1 })).status).toBe(status);
    }
  });

  it("normal sequence: running -> running+pid -> done carries everything and does not drop the pid", () => {
    let runs = applyRunRecord(undefined, rec({ supervisorPid: 7 }));
    runs = applyRunRecord(runs, rec({ pid: 9 }));
    runs = applyRunRecord(runs, rec({ pid: 9, status: "done", exitCode: 0, statusLine: "DONE" }));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done", pid: 9, supervisorPid: 7, exitCode: 0 });
  });

  it("an undefined field in a later write does not erase a stored one", () => {
    const runs = applyRunRecord(applyRunRecord(undefined, rec({ supervisorPid: 7 })), rec({ supervisorPid: undefined }));
    expect(runs[0].supervisorPid).toBe(7);
  });
});

describe("run records across processes", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kf-runrec-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("TC-027: two processes upserting 50 records each plus a late pid write lose and regress nothing", async () => {
    const dir = join(root, ".works", "implementation", "demo_20260101_0000");
    mkdirSync(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "demo", context: "ctx", created: "2026-01-01T00:00:00Z" });
    const features = join(PKG_ROOT, "dist", "workflow", "features.js");
    const run = join(PKG_ROOT, "dist", "harness", "run.js");
    const script = `
      const { updateFeatureMeta } = await import(${JSON.stringify(features)});
      const { applyRunRecord } = await import(${JSON.stringify(run)});
      const [root, tag] = process.argv.slice(1);
      const base = (id) => ({ id, role: "coder", runner: "fake", stage: "implementation", mode: "start", at: "2026-01-01T00:00:00Z", log: "runs/" + id + ".log" });
      const upsert = (record) => updateFeatureMeta(root, "demo", (meta) => ({ ...meta, runs: applyRunRecord(meta.runs, record) }));
      for (let i = 0; i < 50; i += 1) {
        const id = tag + i;
        await upsert({ ...base(id), status: "running" });
        if (i % 2 === 0) {
          await upsert({ ...base(id), status: "done", exitCode: 0, statusLine: "DONE" });
          await upsert({ ...base(id), status: "running", pid: 1000 + i });
        }
      }
    `;
    const child = (tag: string) => new Promise<void>((resolve, reject) => {
      const proc = spawn(process.execPath, ["--input-type=module", "-e", script, root, tag], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      proc.stderr.on("data", (d) => { err += String(d); });
      proc.once("error", reject);
      proc.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child ${tag} exited ${code}: ${err}`))));
    });
    await Promise.all([child("a"), child("b")]);

    const runs = findFeature(root, "demo")!.meta!.runs!;
    expect(runs).toHaveLength(100);
    expect(new Set(runs.map((r) => r.id)).size).toBe(100);
    const finishing = runs.filter((r) => Number(r.id.slice(1)) % 2 === 0);
    expect(finishing).toHaveLength(50);
    for (const r of finishing) {
      expect(r).toMatchObject({ status: "done", exitCode: 0, statusLine: "DONE", pid: 1000 + Number(r.id.slice(1)) });
    }
    expect(runs.filter((r) => Number(r.id.slice(1)) % 2 === 1).every((r) => r.status === "running")).toBe(true);
  });
});
