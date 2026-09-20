import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta, type Bypass } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdView, cmdStatus } from "../cli/commands/inspect.js";
import { validateFeature } from "../workflow/validate.js";
import { computeStatus, renderStatusText, statusToJson } from "../workflow/status.js";
import { dashboardData, renderDashboardHtml } from "../dashboard/dashboard.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = () => findFeature(root, "demo")!;
const confirmed = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-bypass-"));
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("gate bypass audit trail", () => {
  it("records --force when the gate actually failed and surfaces it everywhere", async () => {
    await cmdNew(args("new", ["demo"], { context: "app" }), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed.replace("confirmed", "draft"));
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(1);
    const forced = await cmdStage(args("stage", ["demo", "planning"], { force: true }), root);
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain("Bypass recorded: --force");

    const bypasses = feature().meta!.bypasses!;
    expect(bypasses).toHaveLength(1);
    expect(bypasses[0]).toMatchObject({ from: "brainstorm", to: "planning", flag: "force" });
    expect(bypasses[0].codes).toContain("requirement_unconfirmed");
    expect(bypasses[0].at).toMatch(/^\d{8}_\d{4}$/);

    const check = validateFeature(feature(), false, false);
    expect(check.issues.some((i) => i.code === "gate_bypassed" && i.severity === "WARNING")).toBe(true);
    expect(renderStatusText(computeStatus(feature()))).toContain("Bypasses: 1 (--force → planning)");
    expect(statusToJson(computeStatus(feature())).bypasses).toHaveLength(1);
    expect(JSON.parse((await cmdStatus(args("status", [], { change: "demo", json: true }), root)).stdout).bypasses).toHaveLength(1);
  });

  it("records nothing when --force/--skip-hooks skipped nothing, and records a skipped hook", async () => {
    await cmdNew(args("new", ["demo"], { context: "app" }), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    const clean = await cmdStage(args("stage", ["demo", "planning"], { force: true, "skip-hooks": true }), root);
    expect(clean.code).toBe(0);
    expect(clean.stdout).not.toContain("Bypass recorded");
    expect(feature().meta!.bypasses).toBeUndefined();

    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "backlog.sh"), "exit 9\n");
    await writeFeatureMeta(feature().dir, { ...feature().meta!, approval: { status: "approved", contractHash: "x" } });
    expect((await cmdStage(args("stage", ["demo", "backlog"], { force: true }), root)).stderr).toBe("hook failed");
    const skipped = await cmdStage(args("stage", ["demo", "backlog"], { force: true, "skip-hooks": true }), root);
    expect(skipped.code).toBe(0);
    const bypasses = feature().meta!.bypasses!;
    expect(bypasses.map((b) => b.flag)).toEqual(["force", "skip-hooks"]);
    expect(bypasses[1].codes[0]).toMatch(/^hook:.*backlog\.sh$/);
  });

  it("counts bypassed items in view and dashboard data", async () => {
    const forced: Bypass[] = [{ at: "20260919_1200", from: "brainstorm", to: "planning", flag: "force", codes: ["gate_blocked"] }];
    for (const [name, bypasses] of [["clean", undefined], ["forced", forced]] as Array<[string, Bypass[] | undefined]>) {
      const dir = join(root, ".works", "planning", `${name}_20260919_1200`);
      await mkdir(dir, { recursive: true });
      await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", bypasses });
    }
    expect(dashboardData(root).metrics.bypassed).toBe(1);
    expect(dashboardData(root, { context: "other" }).metrics.bypassed).toBe(0);
    expect(JSON.parse((await cmdView(args("view", [], { json: true }), root)).stdout).metrics.bypassed).toBe(1);
    expect((await cmdView(args("view"), root)).stdout).toContain("Bypassed: 1");
    expect(renderDashboardHtml()).toContain("Gate bypasses");
  });

  it("treats missing bypasses as none and rejects a malformed list", async () => {
    const dir = join(root, ".works", "brainstorm", "legacy_20260919_1200");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "legacy", context: "app", created: "20260919_1200" }));
    const legacy = findFeature(root, "legacy")!;
    expect(validateFeature(legacy).issues.some((i) => i.code === "gate_bypassed")).toBe(false);
    expect(renderStatusText(computeStatus(legacy))).not.toContain("Bypasses:");
    expect(statusToJson(computeStatus(legacy)).bypasses).toEqual([]);

    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "legacy", context: "app", created: "20260919_1200", bypasses: "x" }));
    expect(() => readFeatureMeta(dir)).toThrow("Invalid feature metadata");
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "legacy", context: "app", created: "20260919_1200", bypasses: [{ at: "x", from: "nowhere", to: "planning", flag: "force", codes: [] }] }));
    expect(() => readFeatureMeta(dir)).toThrow("Invalid feature metadata");
  });
});
