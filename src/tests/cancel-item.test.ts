import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { cancelItem } from "../workflow/cancel.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import type { Stage } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "cancel", positionals, options });
let root: string;
let sleeper: ChildProcess | null = null;

async function addItem(name: string, stage: Stage, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = join(root, ".works", stage, `${name}_20260919_1200`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nX");
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", ...extra });
  return dir;
}

async function addLiveRun(name: string): Promise<void> {
  sleeper = spawn("sleep", ["30"], { stdio: "ignore" });
  await addItem(name, "implementation", {
    runs: [{ id: "live", role: "coder", runner: "claude", stage: "implementation", mode: "start", at: "2026-09-19T10:00:00Z", log: "runs/live.log", status: "running", pid: sleeper.pid }],
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-cancel-item-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});
afterEach(async () => {
  sleeper?.kill();
  sleeper = null;
  await rm(root, { recursive: true, force: true });
});

describe("cancelItem returns a typed outcome", () => {
  it("cancels and reports what it did", async () => {
    await addItem("demo", "implementation");
    const outcome = await cancelItem(root, "demo", { reason: "  dropped  ", by: " Quyen " });
    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome).toMatchObject({
      reason: "dropped",
      by: "Quyen",
      target: join(root, ".works", "cancelled", "demo_20260919_1200"),
      docs: [],
      purged: false,
      teardown: null,
      bypasses: [],
    });
    expect(outcome.cancellation).toMatchObject({ by: "Quyen", reason: "dropped", fromStage: "implementation" });
    expect(findFeature(root, "demo")!.stage).toBe("cancelled");
  });

  it("refuses a missing reason without touching the item", async () => {
    await addItem("demo", "implementation");
    for (const reason of ["", "   "]) {
      expect(await cancelItem(root, "demo", { reason })).toEqual({
        kind: "refused",
        reason: "missing-reason",
        stderrTag: "missing reason",
        stdout: 'Cancelling needs a reason: kf cancel demo --reason "<why it is being dropped>"',
      });
    }
    expect(findFeature(root, "demo")!.stage).toBe("implementation");
  });

  it("refuses while a worker run is live, and records the bypass when forced", async () => {
    await addLiveRun("busy");
    expect(await cancelItem(root, "busy", { reason: "stop" })).toEqual({
      kind: "refused",
      reason: "run-in-progress",
      stderrTag: "run in progress",
      stdout: "Run live (coder @ implementation) is still running for 'busy'. Wait for it, or re-run with --force.",
    });
    expect(findFeature(root, "busy")!.stage).toBe("implementation");

    const forced = await cancelItem(root, "busy", { reason: "stop", force: true });
    expect(forced.kind).toBe("cancelled");
    if (forced.kind !== "cancelled") return;
    expect(forced.bypasses).toHaveLength(1);
    expect(forced.bypasses[0]).toMatchObject({ flag: "force", to: "cancelled", codes: ["run_in_progress"] });
  });

  it("asks the caller before purging, and keeps everything when declined", async () => {
    const doc = join(root, "docs", "requirement", "app", "arch.md");
    await mkdir(join(doc, ".."), { recursive: true });
    await writeFile(doc, "x");
    await addItem("arch", "dones", { status: "archived" });

    expect(await cancelItem(root, "arch", { reason: "superseded", purgeDocs: true })).toMatchObject({ kind: "refused", reason: "purge-unconfirmed" });
    let asked: string[] = [];
    const kept = await cancelItem(root, "arch", {
      reason: "superseded",
      purgeDocs: true,
      confirmPurge: async (docs) => { asked = docs; return false; },
    });
    expect(asked).toEqual([doc]);
    expect(kept.kind).toBe("kept");
    expect(findFeature(root, "arch")!.stage).toBe("dones");
    expect(existsSync(doc)).toBe(true);
  });

  it("returns a failed move as an error instead of throwing", async () => {
    await addItem("demo", "dones", { status: "archived" });
    await writeFile(join(root, ".works", "cancelled", "demo_20260919_1200"), "in the way");
    const outcome = await cancelItem(root, "demo", { reason: "superseded" });
    expect(outcome.kind).toBe("error");
    expect(findFeature(root, "demo")!.meta!.cancellation).toBeUndefined();
  });
});

/** Output of `kf cancel` recorded from the pre-refactor command; `<root>` stands for the temp project. */
describe("kf cancel output is unchanged", () => {
  const render = (s: string) => s.split(root).join("<root>");

  it("success", async () => {
    await addItem("demo", "implementation");
    const res = await cmdCancel(args(["demo"], { reason: "dropped\nsecond line", by: "Quyen" }), root);
    expect({ ...res, stdout: render(res.stdout) }).toEqual({
      code: 0,
      stdout: "✓ Cancelled 'demo' (was implementation) by Quyen\n  Reason: dropped\n  <root>/.works/cancelled/demo_20260919_1200\n  Reopen with: kf stage demo implementation",
    });
  });

  it("missing reason, checked before the project is looked for", async () => {
    await addItem("demo", "implementation");
    const expected = { code: 1, stdout: 'Cancelling needs a reason: kf cancel demo --reason "<why it is being dropped>"', stderr: "missing reason" };
    expect(await cmdCancel(args(["demo"]), root)).toEqual(expected);
    const outside = await mkdtemp(join(tmpdir(), "kf-no-works-"));
    try {
      expect(await cmdCancel(args(["demo"]), outside)).toEqual(expected);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("live run refusal, and the bypass note once forced", async () => {
    await addLiveRun("busy");
    expect(await cmdCancel(args(["busy"], { reason: "stop" }), root)).toEqual({
      code: 1,
      stdout: "Run live (coder @ implementation) is still running for 'busy'. Wait for it, or re-run with --force.",
      stderr: "run in progress",
    });
    const forced = await cmdCancel(args(["busy"], { reason: "stop", force: true, "skip-hooks": true }), root);
    expect({ ...forced, stdout: render(forced.stdout) }).toEqual({
      code: 0,
      stdout: "✓ Cancelled 'busy' (was implementation) by human\n  Reason: stop\n  <root>/.works/cancelled/busy_20260919_1200\n  Reopen with: kf stage busy implementation\n  ⚠ Bypass recorded: --force (run_in_progress)",
    });
  });

  it("canonical docs left in place and deleted", async () => {
    const docDir = join(root, "docs", "requirement", "app");
    await mkdir(docDir, { recursive: true });
    await writeFile(join(docDir, "arch.md"), "x");
    await writeFile(join(docDir, "gone.md"), "x");
    await addItem("arch", "dones", { status: "archived" });
    await addItem("gone", "dones", { status: "archived" });

    const kept = await cmdCancel(args(["arch"], { reason: "superseded" }), root);
    expect(render(kept.stdout)).toBe("✓ Cancelled 'arch' (was dones) by human\n  Reason: superseded\n  <root>/.works/cancelled/arch_20260919_1200\n  Canonical docs left in place (use --purge-docs to delete them):\n    docs/requirement/app/arch.md\n  Reopen with: kf stage arch dones");
    const purged = await cmdCancel(args(["gone"], { reason: "superseded", "purge-docs": true, force: true }), root);
    expect(render(purged.stdout)).toBe("✓ Cancelled 'gone' (was dones) by human\n  Reason: superseded\n  <root>/.works/cancelled/gone_20260919_1200\n  Deleted canonical docs:\n    docs/requirement/app/gone.md\n  Reopen with: kf stage gone dones");
  });
});
