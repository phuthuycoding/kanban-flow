import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta, type Feature } from "../workflow/features.js";
import { STAGES, STAGE_INDEX, type Stage } from "../workflow/schema.js";
import { validateFeature } from "../workflow/validate.js";
import { computeStatus, renderStatusText, statusToJson } from "../workflow/status.js";
import { dashboardData, renderDashboardHtml } from "../dashboard/dashboard.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdList, cmdStatus, cmdView } from "../cli/commands/inspect.js";
import { cmdRuns } from "../cli/commands/run.js";
import * as paths from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
let root: string;
const feature = (name = "demo"): Feature => findFeature(root, name)!;

async function addItem(name: string, stage: Stage, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = join(root, ".works", stage, `${name}_20260919_1200`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nReal content.");
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", ...extra });
  return dir;
}

async function addCanonicalDocs(name: string): Promise<string[]> {
  const paths = [
    join(root, "docs", "requirement", "app", `${name}.md`),
    join(root, "docs", "testplan", "app", `${name}.md`),
    join(root, "docs", "testplan", "app", `${name}-result.md`),
    join(root, "docs", "use-cases", "app", name, "README.md"),
  ];
  for (const p of paths) {
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, `# ${name}`);
  }
  return paths;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-cancel-"));
  ensureWorksStructure(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf cancel stops a work item with a reason", () => {
  it("records who, why and where it stood, then moves the folder", async () => {
    await addItem("demo", "implementation", {
      approval: { status: "approved", contractHash: "h" },
      runs: [{ id: "r1", role: "coder", runner: "claude", stage: "implementation", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/r1.log", status: "done" }],
    });
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", reviewer: "Quyen" }));

    const res = await cmdCancel(args("cancel", ["demo"], { reason: "  đổi hướng sang giải pháp khác  " }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("was implementation");
    expect(res.stdout).toContain("kf stage demo implementation");

    const meta = feature().meta!;
    expect(feature().stage).toBe("cancelled");
    expect(meta.status).toBe("cancelled");
    expect(meta.cancellation).toMatchObject({ by: "Quyen", reason: "đổi hướng sang giải pháp khác", fromStage: "implementation" });
    expect(meta.cancellation!.at).toMatch(/^\d{8}_\d{4}$/);
    expect(meta.runs).toHaveLength(1);
    expect(existsSync(join(root, ".works", "implementation", "demo_20260919_1200"))).toBe(false);
  });

  it("falls back to the configured reviewer then to human, and honours --by", async () => {
    await addItem("a", "brainstorm");
    await addItem("b", "brainstorm");
    expect((await cmdCancel(args("cancel", ["a"], { reason: "x" }), root)).code).toBe(0);
    expect(feature("a").meta!.cancellation!.by).toBe("human");
    expect((await cmdCancel(args("cancel", ["b"], { reason: "x", by: "Quyen" }), root)).code).toBe(0);
    expect(feature("b").meta!.cancellation!.by).toBe("Quyen");
  });

  it("refuses an empty reason, a secret reason, an unknown item and a second cancel", async () => {
    await addItem("demo", "planning");
    for (const options of [{}, { reason: "   " }]) {
      const res = await cmdCancel(args("cancel", ["demo"], options), root);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("reason");
      expect(feature().stage).toBe("planning");
    }
    const secret = await cmdCancel(args("cancel", ["demo"], { reason: `token was ghp_${"AbCdEf1234567890".repeat(2)} so we stopped` }), root);
    expect(secret.code).toBe(1);
    expect(secret.stdout).toContain("credential");
    expect(feature().stage).toBe("planning");

    expect((await cmdCancel(args("cancel", ["nope"], { reason: "x" }), root)).code).toBe(1);
    expect((await cmdCancel(args("cancel", ["demo"], { reason: "real reason" }), root)).code).toBe(0);
    const again = await cmdCancel(args("cancel", ["demo"], { reason: "again" }), root);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("already cancelled");
    expect(feature().meta!.cancellation!.reason).toBe("real reason");
  });

  it("waits for a live worker run unless forced", async () => {
    const sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      await addItem("demo", "implementation", {
        runs: [{ id: "live", role: "coder", runner: "claude", stage: "implementation", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/live.log", status: "running", pid: sleeper.pid }],
      });
      const blocked = await cmdCancel(args("cancel", ["demo"], { reason: "stop" }), root);
      expect(blocked.code).toBe(1);
      expect(blocked.stdout).toContain("live");
      expect(feature().stage).toBe("implementation");

      const forced = await cmdCancel(args("cancel", ["demo"], { reason: "stop", force: true }), root);
      expect(forced.code).toBe(0);
      expect(feature().stage).toBe("cancelled");
      expect(feature().meta!.bypasses![0]).toMatchObject({ flag: "force", to: "cancelled" });
      expect(feature().meta!.bypasses![0].codes).toContain("run_in_progress");
    } finally {
      sleeper.kill();
    }
  });

  it("runs the cancelled hook and records a skip", async () => {
    await addItem("demo", "planning");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "cancelled.sh"), "echo hook-said-no\nexit 9\n");
    const blocked = await cmdCancel(args("cancel", ["demo"], { reason: "stop" }), root);
    expect(blocked.code).toBe(1);
    expect(blocked.stdout).toContain("hook-said-no");
    expect(feature().stage).toBe("planning");

    const skipped = await cmdCancel(args("cancel", ["demo"], { reason: "stop", "skip-hooks": true }), root);
    expect(skipped.code).toBe(0);
    expect(feature().meta!.bypasses![0]).toMatchObject({ flag: "skip-hooks" });
    expect(feature().meta!.bypasses![0].codes[0]).toMatch(/^hook:.*cancelled\.sh$/);
  });
});

describe("cancelling something already archived", () => {
  it("lists its canonical docs and only deletes them when told twice", async () => {
    const kept = await addCanonicalDocs("demo");
    const other = await addCanonicalDocs("sibling");
    await addItem("demo", "dones", { status: "archived" });
    await addItem("sibling", "dones", { status: "archived" });

    const listed = await cmdCancel(args("cancel", ["demo"], { reason: "superseded" }), root);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("Canonical docs left in place");
    for (const p of kept) expect(existsSync(p), p).toBe(true);

    const purged = await cmdCancel(args("cancel", ["sibling"], { reason: "superseded", "purge-docs": true, force: true }), root);
    expect(purged.code).toBe(0);
    expect(purged.stdout).toContain("Deleted canonical docs");
    for (const p of other) expect(existsSync(p), p).toBe(false);
    for (const p of kept) expect(existsSync(p), p).toBe(true);
  });

  it("refuses to purge without confirmation when there is no TTY", async () => {
    const docs = await addCanonicalDocs("demo");
    await addItem("demo", "dones", { status: "archived" });
    const res = await cmdCancel(args("cancel", ["demo"], { reason: "superseded", "purge-docs": true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--force");
    expect(feature().stage).toBe("dones");
    for (const p of docs) expect(existsSync(p)).toBe(true);
  });

  it("says nothing about docs for an item that was never archived", async () => {
    await addItem("demo", "backlog");
    const res = await cmdCancel(args("cancel", ["demo"], { reason: "dropped" }), root);
    expect(res.stdout).not.toContain("Canonical docs");
  });
});

describe("a cancelled item is asked for nothing but its reason", () => {
  it("passes validation from any stage, and fails without a reason", async () => {
    await addItem("mid", "cancelled", {
      approval: { status: "approved", contractHash: "h" },
      status: "cancelled",
      cancellation: { at: "20260919_1200", by: "Quyen", reason: "dropped", fromStage: "implementation" },
    });
    const check = validateFeature(feature("mid"));
    expect(check.valid, JSON.stringify(check.issues)).toBe(true);
    expect(check.issues).toEqual([]);

    await addItem("bare", "cancelled", { status: "cancelled" });
    const missing = validateFeature(feature("bare"));
    expect(missing.valid).toBe(false);
    expect(missing.issues.map((i) => i.code)).toEqual(["cancellation_missing"]);

    await addItem("blank", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1200", by: "q", reason: "   ", fromStage: "planning" },
    });
    expect(validateFeature(feature("blank")).issues.some((i) => i.code === "cancellation_missing")).toBe(true);
  });

  it("keeps cancelled off the linear pipeline", () => {
    expect(STAGES).toHaveLength(8);
    expect(STAGES[6]).toBe("dones");
    expect(STAGES[7]).toBe("cancelled");
    expect(STAGE_INDEX.cancelled).toBe(-1);
  });

  it("cannot be archived", async () => {
    await addItem("demo", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1200", by: "q", reason: "dropped", fromStage: "review" },
    });
    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("dropped");
    expect(feature().stage).toBe("cancelled");
  });
});

describe("reopening a cancelled item", () => {
  it("goes back to the stage it was cancelled from and clears the cancellation", async () => {
    await addItem("demo", "planning", { sessions: { coder: "s1" } });
    expect((await cmdCancel(args("cancel", ["demo"], { reason: "paused" }), root)).code).toBe(0);

    const wrong = await cmdStage(args("stage", ["demo", "testing"]), root);
    expect(wrong.code).toBe(1);
    expect(wrong.stdout).toContain("only be reopened at planning");

    const back = await cmdStage(args("stage", ["demo", "planning"]), root);
    expect(back.code, back.stdout).toBe(0);
    expect(feature().stage).toBe("planning");
    expect(feature().meta!.cancellation).toBeUndefined();
    expect(feature().meta!.status).toBeUndefined();
    expect(feature().meta!.sessions).toEqual({ coder: "s1" });
  });

  it("refuses when the metadata lost its fromStage", async () => {
    await addItem("demo", "cancelled", { status: "cancelled" });
    const res = await cmdStage(args("stage", ["demo", "planning"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--force");
  });
});

describe("failure paths of cancelling", () => {
  it("keeps the docs when the move fails, and reports both errors", async () => {
    const docs = await addCanonicalDocs("demo");
    await addItem("demo", "dones", { status: "archived" });
    // A plain file where the folder would land makes rename fail; listFeatures skips non-directories.
    await writeFile(join(root, ".works", "cancelled", "demo_20260919_1200"), "in the way");

    await expect(cmdCancel(args("cancel", ["demo"], { reason: "superseded", "purge-docs": true, force: true }), root)).rejects.toThrow();
    for (const p of docs) expect(existsSync(p), p).toBe(true);
    expect(feature().stage).toBe("dones");
    expect(feature().meta!.cancellation).toBeUndefined();
    expect(feature().meta!.status).toBe("archived");
  });

  it("wraps a failed rollback together with the original error", async () => {
    await addItem("demo", "dones", { status: "archived" });
    await writeFile(join(root, ".works", "cancelled", "demo_20260919_1200"), "in the way");
    const writer = paths.writeFileAtomic;
    let calls = 0;
    vi.spyOn(paths, "writeFileAtomic").mockImplementation(async (file, content) => {
      calls += 1;
      if (calls > 1 && file.endsWith(".kfw.json")) throw new Error("Simulated rollback failure");
      await writer(file, content);
    });
    try {
      await expect(cmdCancel(args("cancel", ["demo"], { reason: "superseded" }), root)).rejects.toThrow(AggregateError);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("cancelled work stays visible without skewing the numbers", () => {
  it("shows up in list and status, and drops out of the completion rate", async () => {
    await addItem("done-a", "dones", { status: "archived" });
    await addItem("done-b", "dones", { status: "archived" });
    await addItem("busy", "testing");
    await addItem("dropped", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1200", by: "Quyen", reason: "trùng việc khác\nchi tiết ở ticket 42", fromStage: "planning" },
    });

    expect((await cmdList(args("list"), root)).stdout).toContain("cancelled");
    const text = (await cmdStatus(args("status", [], { change: "dropped" }), root)).stdout;
    expect(text).toContain("Cancelled: 20260919_1200 by Quyen (was planning) — trùng việc khác");
    expect(text).not.toContain("chi tiết ở ticket 42");
    expect(text).not.toContain("Next:");
    const json = JSON.parse((await cmdStatus(args("status", [], { change: "dropped", json: true }), root)).stdout);
    expect(json.cancellation.reason).toContain("chi tiết ở ticket 42");
    expect(statusToJson(computeStatus(feature("busy"))).cancellation).toBeNull();
    expect(renderStatusText(computeStatus(feature("busy")))).not.toContain("Cancelled:");

    const metrics = dashboardData(root).metrics;
    expect(metrics).toMatchObject({ total: 4, completed: 2, cancelled: 1, completionRate: 67 });
    expect(dashboardData(root).stages).toHaveLength(8);
    expect((await cmdView(args("view"), root)).stdout).toContain("Cancelled: 1");
    // Runs of dropped work are history: out of the default list, still visible by name.
    await writeFeatureMeta(feature("dropped").dir, {
      ...feature("dropped").meta!,
      runs: [{ id: "old", role: "coder", runner: "claude", stage: "planning", mode: "start", at: "2026-09-19T09:00:00Z", log: "runs/old.log", status: "done" }],
    });
    expect((await cmdRuns(args("runs"), root)).stdout).not.toContain("old");
    expect((await cmdRuns(args("runs", ["dropped"]), root)).stdout).toContain("old");
    expect(renderDashboardHtml()).toContain("Cancelled");
  });

  it("reports N/A when every item was cancelled", async () => {
    await addItem("gone", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1200", by: "q", reason: "dropped", fromStage: "brainstorm" },
    });
    expect(dashboardData(root).metrics).toMatchObject({ total: 1, cancelled: 1, completionRate: null });
  });
});
