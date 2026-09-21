import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
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
import { cmdNew } from "../cli/commands/new.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { ARTIFACTS } from "../workflow/schema.js";
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

/**
 * An item archived by the real pipeline, so `kf archive` can actually re-sync canonical docs.
 * `addItem` writes one artifact, which makes archive refuse at its own gate long before the
 * two branches below are reached — the reason the first version of these tests proved nothing.
 */
async function archivedItem(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  const dir = () => feature(name).dir;
  await writeFile(join(dir(), ARTIFACTS["spec-requirement"].file),
    "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.");
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(dir(), ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(dir(), "use-cases"), { recursive: true });
  await writeFile(join(dir(), "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(dir(), ARTIFACTS["test-cases"].file),
    "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
  const report = async (id: "testing-result" | "review-report") =>
    writeFile(join(dir(), ARTIFACTS[id].file),
      `---\nstatus: PASS\nexecution: ${feature(name).meta?.executionId}\n---\n# Evidence\nVerified current implementation.\n${id === "testing-result" ? evidence : ""}`);
  await report("testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report("review-report");
  await writeFile(join(dir(), ARTIFACTS["feature-report"].file), "# Feature Report\nShipped FR-001 as specified.");
  const done = await cmdArchive(args("archive", [name]), root);
  expect(done.code, done.stdout).toBe(0);
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

describe("the requirement-confirmed gate belongs to brainstorm only", () => {
  it("does not demand confirmation from stages whose spec has moved on", async () => {
    // Unguarded it told an archived item its requirement must be confirmed "before leaving
    // brainstorm". A later edit to a confirmed spec is the approval fingerprint's business.
    for (const [stage, status] of [["dones", "archived"], ["review", "approved"], ["backlog", "draft"]] as const) {
      const dir = join(root, ".works", stage, `spec-${stage}_20260919_1200`);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "phase-1-spec-requirement.md"), `---\nstatus: ${status}\n---\n# Spec\n### FR-001\nReal content.`);
      await writeFeatureMeta(dir, { schema: "kanban-flow", feature: `spec-${stage}`, context: "app", created: "20260919_1200" });
      const codes = validateFeature(feature(`spec-${stage}`)).issues.map((i) => i.code);
      expect(codes, `${stage} (${status})`).not.toContain("requirement_unconfirmed");
    }
  });

  it("still blocks kf approve when the requirement was reopened during planning", async () => {
    // This is the whole point of keeping the check alive past brainstorm: approve validates at
    // planning, and it is the only check that reads the spec's status. The fingerprint cannot
    // stand in — it hashes the spec as it is at approval time, so a pending spec becomes the
    // contract and it is the later correction that reads as drift.
    const dir = join(root, ".works", "planning", "reopened_20260919_1200");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: pending\n---\n# Spec\n### FR-001\nReal content.");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "reopened", context: "app", created: "20260919_1200", kind: "bug" });
    const codes = validateFeature(feature("reopened"), false, false).issues.map((i) => i.code);
    expect(codes, "kf approve validates with requireApproval=false at planning").toContain("requirement_unconfirmed");
  });

  it("still blocks an unconfirmed requirement from leaving brainstorm", async () => {
    const dir = join(root, ".works", "brainstorm", "fresh_20260919_1200");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: pending\n---\n# Spec\n### FR-001\nReal content.");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "fresh", context: "app", created: "20260919_1200" });
    expect(validateFeature(feature("fresh")).issues.map((i) => i.code)).toContain("requirement_unconfirmed");
  });
});

describe("what a cancelled item is still asked for", () => {
  // Built from parts so the literal never sits in the file as one string — this repo's own
  // artifact gate scans its work items, and a whole token here would trip it.
  const ghp = "ghp_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

  it("reports a secret inside a cancelled item's artifact", async () => {
    // STAGE_INDEX = -1 made checkDueArtifacts skip every artifact, and the secret scan lived
    // inside that loop — so cancelling an item was the quietest way to take a committed token
    // off the radar while leaving it in the repo.
    const dir = await addItem("leaky", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "human", reason: "superseded", fromStage: "brainstorm" },
    });
    await writeFile(join(dir, "phase-1-spec-requirement.md"),
      `---\nstatus: confirmed\n---\n# Spec\n## FR-001\nReal content.\ntoken = ${ghp}\n`);
    const codes = validateFeature(feature("leaky")).issues.map((i) => i.code);
    expect(codes).toContain("artifact_secret");
  });

  it("reports a secret in an artifact the stage has not reached yet", async () => {
    // The same guard hid this for live items too: a credential in a file that exists is a
    // credential, whether or not the workflow has reached the phase that asks for the file.
    const dir = await addItem("early", "planning");
    await writeFile(join(dir, "phase-4-testing-result.md"),
      `---\nstatus: PASS\n---\n# Evidence\nkey = ${ghp}\n`);
    const secrets = validateFeature(feature("early")).issues.filter((i) => i.code === "artifact_secret");
    expect(secrets.map((i) => i.file)).toEqual(["phase-4-testing-result.md"]);
  });

  it("reports a secret in a due artifact exactly once", async () => {
    // The scan moved out of the due-artifact loop; leaving it in both places would double-report.
    const dir = await addItem("dupe", "planning");
    await writeFile(join(dir, "phase-1-spec-requirement.md"),
      `---\nstatus: confirmed\n---\n# Spec\n## FR-001\nReal content.\ntoken = ${ghp}\n`);
    const secrets = validateFeature(feature("dupe")).issues.filter((i) => i.code === "artifact_secret");
    expect(secrets).toHaveLength(1);
  });

  it("says nothing about secrets when a cancelled item has clean artifacts", async () => {
    await addItem("clean", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "human", reason: "dropped", fromStage: "brainstorm" },
    });
    expect(validateFeature(feature("clean")).issues.map((i) => i.code)).not.toContain("artifact_secret");
  });
});

describe("reopening a cancelled item into planning", () => {
  it("succeeds even when the spec was reset to pending while it sat cancelled", async () => {
    // kf cancel prints this exact command. It used to be refused: the move to planning was
    // validated as if the item were in brainstorm, which walked past the cancelled shortcut and
    // re-raised requirement_unconfirmed. The only way through was --force, which stamps a
    // permanent bypass record for a gate that should never have held.
    const dir = await addItem("reworked", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "human", reason: "superseded", fromStage: "planning" },
    });
    await writeFile(join(dir, "phase-1-spec-requirement.md"),
      "---\nstatus: pending\n---\n# Spec\n## FR-001\nReworked while the item was stopped.");

    expect(validateFeature(feature("reworked")).valid, "kf validate calls it valid").toBe(true);
    const res = await cmdStage(args("stage", ["reworked", "planning"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature("reworked").stage).toBe("planning");
    // And no bypass was invented on the way, which --force would have recorded forever.
    expect(feature("reworked").meta?.bypasses ?? []).toEqual([]);
  });

  it("does not blame a stage the item is not in when it does refuse", async () => {
    // The refusal report used to print "stage brainstorm" for an item sitting in cancelled.
    const dir = await addItem("mismatch", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "human", reason: "superseded", fromStage: "planning" },
    });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: pending\n---\n# Spec\n## FR-001\nOk.");
    const res = await cmdStage(args("stage", ["mismatch", "planning"]), root);
    expect(res.stdout).not.toContain("stage brainstorm");
  });

  it("still checks a live item against the brainstorm gate on its way back to planning", async () => {
    // The exemption is for cancelled only. Loosening it for every return to planning would drop
    // the one check that reads the spec's status.
    const dir = await addItem("live", "implementation");
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: pending\n---\n# Spec\n## FR-001\nOk.");
    const res = await cmdStage(args("stage", ["live", "planning"]), root);
    expect(res.code, "a live item still owes a confirmed requirement").toBe(1);
    expect(res.stdout).toContain("requirement_unconfirmed");
  });

  it("leaves the reopened item awaiting approval, which is the point of planning", async () => {
    // Recorded on purpose rather than treated as a defect: arriving in planning means the
    // contract has to be approved again, so approval_required is the correct next thing to see.
    const dir = await addItem("reapprove", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "human", reason: "superseded", fromStage: "planning" },
      approval: { status: "approved", contractHash: "h" },
    });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nOk.");
    expect((await cmdStage(args("stage", ["reapprove", "planning"]), root)).code).toBe(0);
    expect(feature("reapprove").meta?.approval?.status, "the move resets approval").toBe("pending");
    expect(validateFeature(feature("reapprove")).issues.map((i) => i.code)).toContain("approval_required");
  });
});

describe("a cancelled item owes nothing, whatever stage it was dropped from", () => {
  /** Cancelling out of brainstorm is the common case, and there the spec is still `pending`. */
  async function unconfirmedItem(name: string): Promise<string> {
    const dir = join(root, ".works", "brainstorm", `${name}_20260919_1200`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: pending\n---\n# Spec\n## FR-001\nReal content.");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200" });
    return dir;
  }

  it("validates clean after being cancelled with its requirement still unconfirmed", async () => {
    await unconfirmedItem("loginflow");
    expect((await cmdCancel(args("cancel", ["loginflow"], { reason: "superseded by another approach" }), root)).code).toBe(0);
    const res = validateFeature(feature("loginflow"));
    expect(res.issues.map((i) => i.code), "a cancelled item is off the track and owes nothing").toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("reopens with the very command kf cancel prints, without --force", async () => {
    await unconfirmedItem("loginflow");
    const cancelled = await cmdCancel(args("cancel", ["loginflow"], { reason: "superseded" }), root);
    expect(cancelled.stdout).toContain("kf stage loginflow brainstorm");

    const reopened = await cmdStage(args("stage", ["loginflow", "brainstorm"]), root);
    expect(reopened.code, "the advertised reopen must not need --force").toBe(0);
    expect(feature("loginflow").stage).toBe("brainstorm");
    expect(feature("loginflow").meta?.cancellation).toBeUndefined();
  });

  it("does not make kf validate --all fail for the whole project", async () => {
    await unconfirmedItem("loginflow");
    await addItem("healthy", "brainstorm");
    await cmdCancel(args("cancel", ["loginflow"], { reason: "superseded" }), root);
    for (const name of ["loginflow", "healthy"]) {
      expect(validateFeature(feature(name)).valid, name).toBe(true);
    }
  });

  it("still surfaces a recorded bypass, which is a record about a person, not a demand on the item", async () => {
    // Three places promise a bypass shows up on every validation; being cancelled must not
    // silence the very --force the trap used to push people into.
    await addItem("forced", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "q", reason: "dropped", fromStage: "planning" },
      bypasses: [{ at: "20260919_1250", from: "brainstorm", to: "planning", flag: "force", codes: ["requirement_unconfirmed"] }],
    });
    const res = validateFeature(feature("forced"));
    expect(res.issues.map((i) => i.code)).toContain("gate_bypassed");
    expect(res.valid, "a warning must not block a cancelled item").toBe(true);
    expect(validateFeature(feature("forced"), true).valid, "--strict still treats it as a failure").toBe(false);
  });

  it("keys off the stage, not a stale status left in metadata", async () => {
    // The two agree everywhere today, so nothing else can tell the guards apart. If they ever
    // drift, an item in implementation must still owe everything implementation owes.
    await addItem("drifted", "implementation", { status: "cancelled" });
    const codes = validateFeature(feature("drifted")).issues.map((i) => i.code);
    expect(codes, "a stale status must not switch off the whole battery").toContain("approval_required");
  });

  it("reopens into every stage it could have been cancelled from", async () => {
    for (const from of ["brainstorm", "planning", "backlog", "implementation", "testing", "review", "dones"] as Stage[]) {
      const name = `back-${from}`;
      await addItem(name, from);
      expect((await cmdCancel(args("cancel", [name], { reason: "dropped" }), root)).code, from).toBe(0);
      const res = await cmdStage(args("stage", [name, from]), root);
      expect(res.code, `${from}: the advertised reopen must work without --force`).toBe(0);
      expect(feature(name).stage, from).toBe(from);
      expect(feature(name).meta?.cancellation, from).toBeUndefined();
    }
  });

  it("refuses --force straight into dones for an item cancelled from elsewhere", async () => {
    // isReopen must mean "back where it came from". If it were true for any target, --force
    // would land an item in dones with no archive, no canonical docs and no validation.
    await addItem("elsewhere", "review");
    await cmdCancel(args("cancel", ["elsewhere"], { reason: "dropped" }), root);
    const res = await cmdStage(args("stage", ["elsewhere", "dones"], { force: true }), root);
    expect(res.code, "dones is not where it was cancelled from").toBe(1);
    expect(feature("elsewhere").stage).toBe("cancelled");
  });

  it("still sends a live review item to dones through archive, not the plain move", async () => {
    // isReopen must be false for an item that was never cancelled, or --force would skip archive.
    await addItem("live", "review");
    // Archive is what handles review → dones; here it refuses because the fixture has no
    // planning artifacts to copy. The point is that the plain move never runs.
    await expect(cmdStage(args("stage", ["live", "dones"], { force: true }), root)).rejects.toThrow(/canonical docs/i);
    expect(feature("live").stage).toBe("review");
  });

  it("restores the archived state when reopened into dones", async () => {
    await addItem("archived-then-dropped", "dones");
    await cmdCancel(args("cancel", ["archived-then-dropped"], { reason: "superseded" }), root);
    const res = await cmdStage(args("stage", ["archived-then-dropped", "dones"]), root);
    expect(res.code).toBe(0);
    // Reaching dones by reopening must leave the same state as reaching it by archiving.
    expect(feature("archived-then-dropped").meta?.status).toBe("archived");
  });

  it("asks archive to re-sync the canonical docs when reopened into dones", async () => {
    // kf cancel --purge-docs can delete them; the move alone would leave them gone and silent.
    await addItem("resync", "dones");
    await cmdCancel(args("cancel", ["resync"], { reason: "superseded" }), root);
    const res = await cmdStage(args("stage", ["resync", "dones"]), root);
    expect(res.code).toBe(0);
    // This fixture is too thin for archive to succeed, so the hand-off must say so rather than
    // leave the docs silently missing.
    expect(res.stdout).toContain("kf archive resync");
  });

  it("does not let --force on kf stage overwrite canonical docs that changed", async () => {
    // --force on kf stage means "skip a gate". Forwarding it into archive also means "restore
    // the archived snapshot over hand edits", which this command never offered to do — and the
    // bypass record it stamps says nothing about documents.
    await archivedItem("edited");
    const doc = join(root, "docs", "requirement", "app", "edited.md");
    await cmdCancel(args("cancel", ["edited"], { reason: "superseded" }), root);
    await writeFile(doc, "hand edited after archive\n");

    const res = await cmdStage(args("stage", ["edited", "dones"], { force: true }), root);
    expect(res.code).toBe(0);
    expect(await readFile(doc, "utf8"), "the edit must survive the reopen").toBe("hand edited after archive\n");
    // And the refusal has to be visible, or the stale doc looks re-synced.
    expect(res.stdout).toContain("Canonical docs have changed since archive");
  });

  it("keeps the reopen successful when the doc re-sync throws", async () => {
    // The move and the metadata write have already committed by the time archive runs, so a
    // throw from it must not report the reopen as failed. Archive throws, rather than returning
    // non-zero, whenever it cannot even read a canonical destination.
    await archivedItem("thrower");
    await cmdCancel(args("cancel", ["thrower"], { reason: "superseded" }), root);
    const doc = join(root, "docs", "requirement", "app", "thrower.md");
    await rm(doc);
    await mkdir(doc, { recursive: true });

    const res = await cmdStage(args("stage", ["thrower", "dones"]), root);
    expect(res.code, "the reopen itself succeeded").toBe(0);
    expect(res.stdout).toContain("✓ Moved 'thrower' cancelled → dones");
    expect(res.stdout, "and it says what is left undone").toContain("Canonical docs were not re-synced");
    expect(res.stdout).toContain("kf archive thrower");
    expect(feature("thrower").stage).toBe("dones");
  });

  it("clears cancellation metadata even when forced into a stage it did not come from", async () => {
    // Keying the clear on isReopen instead of the stage would leave a live item carrying
    // status: cancelled and a stale fromStage, which nothing else would notice.
    await addItem("forced-elsewhere", "implementation");
    await cmdCancel(args("cancel", ["forced-elsewhere"], { reason: "dropped" }), root);
    const res = await cmdStage(args("stage", ["forced-elsewhere", "backlog"], { force: true }), root);
    expect(res.code).toBe(0);
    const meta = feature("forced-elsewhere").meta;
    expect(meta?.status, "a live item must not keep status: cancelled").toBeUndefined();
    expect(meta?.cancellation).toBeUndefined();
  });

  it("drops the no-tasks warning along with the rest, which is intended", async () => {
    // Documented here because it is a second thing the central skip silences, beyond the
    // artifact battery: the bypass trail is kept, this is not.
    const dir = await addItem("tasky", "cancelled", {
      status: "cancelled",
      cancellation: { at: "20260919_1300", by: "q", reason: "dropped", fromStage: "implementation" },
    });
    await writeFile(join(dir, "tasks.md"), "# Tasks\n\nNo checkboxes here.\n");
    expect(validateFeature(feature("tasky")).issues.map((i) => i.code)).not.toContain("no_tasks");
  });

  it("still demands a reason, which is the one thing it does owe", async () => {
    const dir = await addItem("dropped", "cancelled", { status: "cancelled", cancellation: { at: "20260919_1300", by: "q", reason: "   ", fromStage: "planning" } });
    expect(existsSync(dir)).toBe(true);
    expect(validateFeature(feature("dropped")).issues.map((i) => i.code)).toContain("cancellation_missing");
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
