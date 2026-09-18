import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorksStructure, findFeature, listFeatures, readFeatureMeta, writeFeatureMeta, executionContractHash } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdInstruct } from "../cli/commands/artifacts.js";
import { cmdValidate, cmdStatus, cmdView } from "../cli/commands/inspect.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { validateFeature } from "../workflow/validate.js";
import { computeStatus, renderStatusText } from "../workflow/status.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { bootstrapDefaults } from "../project/bootstrap.js";
import { readProjectConfig } from "../project/config.js";
import { resolveTemplate, resolveRule } from "../shared/paths.js";
import * as paths from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = () => findFeature(root, "demo")!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## FR-010\nUser can list tasks.";

async function planning(): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature().dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

async function implementation(): Promise<void> {
  await planning();
  expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
}

async function report(id: "testing-result" | "review-report", status = "PASS", execution = feature().meta?.executionId): Promise<void> {
  await writeFile(join(feature().dir, ARTIFACTS[id].file), `---\nstatus: ${status}\nexecution: ${execution}\n---\n# Evidence\nVerified current implementation.\n`);
}

async function review(): Promise<void> {
  await implementation();
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await report("testing-result");
  expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
  await report("review-report");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-workflow-"));
  ensureWorksStructure(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe("feature creation and project resolution", () => {
  it("creates a bug work item with the bug triage template", async () => {
    const result = await cmdNew(args("new", ["login-timeout"], { context: "auth", type: "bug" }), root);
    expect(result.code).toBe(0);
    const f = findFeature(root, "login-timeout")!;
    expect(f.meta?.kind).toBe("bug");
    expect(await readFile(join(f.dir, ARTIFACTS["spec-requirement"].file), "utf8")).toContain("# Bug Report");
    const instruction = await cmdInstruct(args("instruct", ["spec-requirement"], { change: "login-timeout", json: true }), root);
    expect(JSON.parse(instruction.stdout).template).toContain("# Bug Report");
  });

  it("rejects an unknown work item type", async () => {
    const result = await cmdNew(args("new", ["bad-type"], { type: "incident" }), root);
    expect(result.code).toBe(1);
    expect(findFeature(root, "bad-type")).toBeNull();
  });

  it("runs the brainstorm entry hook and rolls back a refused creation", async () => {
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "brainstorm.sh"), "echo refused\nexit 5\n");
    const result = await cmdNew(args("new", ["demo"]), root);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("refused");
    expect(findFeature(root, "demo")).toBeNull();
    expect(await readdir(join(root, ".works", "brainstorm"))).toEqual([]);
  });
  it("rejects a duplicate without overwriting its requirement or metadata", async () => {
    await planning();
    const originalMeta = await readFile(join(feature().dir, ".kfw.json"), "utf8");
    expect((await cmdNew(args("new", ["demo"], { context: "other" }), root)).code).toBe(1);
    expect(await readFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), "utf8")).toBe(spec);
    expect(await readFile(join(feature().dir, ".kfw.json"), "utf8")).toBe(originalMeta);
  });

  it.each(["../../escaped", "../x", "x/y", "x\\y", ".", "..", "<img>"])("rejects an unsafe feature name %s", async (name) => {
    await expect(cmdNew(args("new", [name]), root)).rejects.toThrow("Invalid feature");
    expect(await readdir(join(root, ".works", "brainstorm"))).toEqual([]);
  });

  it("rejects unsafe contexts before creating files", async () => {
    await expect(cmdNew(args("new", ["demo"], { context: "../../x" }), root)).rejects.toThrow("Invalid context");
    await expect(cmdInit(args("init", [], { context: "../x" }), root)).rejects.toThrow("Invalid context");
    expect(await readdir(join(root, ".works", "brainstorm"))).toEqual([]);
  });

  it("init onboards by default: seeds config, --minimal keeps the bare structure", async () => {
    expect((await cmdInit(args("init"), root)).code).toBe(0);
    const cfg = readProjectConfig(root);
    expect(cfg.defaultContext).toBe("app");

    const bare = await mkdtemp(join(tmpdir(), "kf-init-minimal-"));
    expect((await cmdInit(args("init", [], { minimal: true }), bare)).code).toBe(0);
    expect(readProjectConfig(bare).defaultContext).toBeUndefined();
    await rm(bare, { recursive: true, force: true });
  });

  it("resolves project templates, rules and blocking hooks from a subdirectory", async () => {
    const sub = join(root, "src");
    await mkdir(sub);
    await mkdir(join(root, ".kf", "templates"), { recursive: true });
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await mkdir(join(root, ".kf", "review", "rules"), { recursive: true });
    await writeFile(join(root, ".kf", "templates", ARTIFACTS["spec-requirement"].file), spec);
    await writeFile(join(root, ".kf", "review", "rules", "general.md"), "Project rule");
    await writeFile(join(root, ".kf", "hooks", "planning.sh"), "exit 9\n");
    expect(resolveTemplate(sub, ARTIFACTS["spec-requirement"].file)?.source).toBe("project");
    expect(resolveRule(sub, "general.md")?.source).toBe("project");
    await cmdNew(args("new", ["demo"]), sub);
    const result = await cmdStage(args("stage", ["demo", "planning"]), sub);
    expect(result.stderr).toBe("hook failed");
    expect(feature().stage).toBe("brainstorm");
  });
});

describe("requirement and approval gates", () => {
  it("runs a lightweight bug through backlog, testing, review and archive without feature artifacts", async () => {
    await cmdNew(args("new", ["demo"], { type: "bug", context: "app" }), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\nkind: bug\n---\n# Bug Report\nReproduce: submit twice. Actual: duplicate task. Expected: one task. Severity: medium. Regression: repeat-submit unit test. Docs: unchanged behavior.");
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
    expect(computeStatus(feature()).totalCount).toBe(3);
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "backlog"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
    await report("testing-result");
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
    await report("review-report");
    const canonical = join(root, "docs", "requirement", "app", "demo.md");
    await mkdir(join(root, "docs", "requirement", "app"), { recursive: true });
    await writeFile(canonical, "Existing feature documentation");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    expect(feature().stage).toBe("dones");
    expect(validateFeature(feature()).valid).toBe(true);
    expect(await readFile(canonical, "utf8")).toBe("Existing feature documentation");
    expect(await readdir(join(root, "docs", "use-cases"))).toEqual([]);
    expect(await readdir(join(root, "docs", "testplan"))).toEqual([]);
  });

  it("invalidates bug approval when the triage contract changes", async () => {
    await cmdNew(args("new", ["demo"], { type: "bug" }), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
    await cmdStage(args("stage", ["demo", "planning"]), root);
    await cmdApprove(args("approve", ["demo"]), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec + "\nChanged fix scope");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(1);
  });

  it.each(["edit", "add", "remove"])("invalidates feature approval after a use-case file %s", async (change) => {
    await planning();
    await cmdApprove(args("approve", ["demo"]), root);
    if (change === "remove") await rm(join(feature().dir, "use-cases", "UC-001.md"));
    else await writeFile(join(feature().dir, "use-cases", change === "add" ? "UC-002.md" : "UC-001.md"), "# UC-001 UC-002\nChanged acceptance behavior");
    expect(JSON.parse((await cmdStatus(args("status", [], { change: "demo", json: true }), root)).stdout).approval).toBe("changed");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(1);
  });

  it("rejects a test reference that only exists in the use-case index", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), "# Index\nUC-001 UC-002");
    await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "## TC-001\nFR-001 UC-002\nVerify behavior");
    expect(validateFeature(feature(), false, false).issues.some((issue) => issue.code === "uc_ref_missing")).toBe(true);
  });

  it("requires a file for every indexed use-case even without test references", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), "# Index\nUC-001 UC-002");
    expect(validateFeature(feature(), false, false).issues.some((issue) => issue.code === "use_case_file_missing")).toBe(true);
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(1);
  });

  it("supports the planning start-or-backlog decision", async () => {
    await planning();
    await cmdApprove(args("approve", ["demo"]), root);
    expect((await cmdStage(args("stage", ["demo", "backlog"]), root)).code).toBe(0);
    expect(feature().stage).toBe("backlog");
    expect(renderStatusText(computeStatus(feature()))).toContain("implementation (start) or planning (revise)");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect(feature().stage).toBe("implementation");
  });

  it("blocks a filled but unconfirmed requirement", async () => {
    await cmdNew(args("new", ["demo"]), root);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec.replace("confirmed", "draft"));
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(1);
  });

  it("rejects approval before the complete contract exists", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["implementation-plan"].file), "");
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(1);
    expect(feature().meta?.approval?.status).toBe("pending");
  });

  it("validates each test case in planning, including exact FR/UC ids", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "## TC-001\nFR-001 UC-001\n## TC-002\nFR-002 UC-002\n## TC-003\nNo references\n");
    const check = validateFeature(feature(), false, false);
    expect(check.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["tc_refs_missing", "fr_ref_missing", "uc_ref_missing"]));
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(1);
  });

  it("requires one use-case file per UC and renders the dedicated template", async () => {
    await planning();
    const instruction = JSON.parse((await cmdInstruct(args("instruct", ["use-case"], { change: "demo", id: "UC-002", json: true }), root)).stdout);
    expect(instruction.outputPath).toBe(join(feature().dir, "use-cases", "UC-002.md"));
    expect(instruction.template).toContain("# Use Case");
    expect((await cmdInstruct(args("instruct", ["use-case"], { change: "demo" }), root)).stderr).toBe("missing use-case id");
    await rm(join(feature().dir, "use-cases", "UC-001.md"), { force: true });
    expect(validateFeature(feature(), false, false).issues.some((issue) => issue.code === "use_cases_missing")).toBe(true);
  });

  it("does not confuse FR-001 with FR-0010", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec.replace("FR-001", "FR-0010"));
    expect(validateFeature(feature(), false, false).issues.some((i) => i.code === "fr_ref_missing")).toBe(true);
  });

  it.each(["spec-requirement", "implementation-plan", "use-case-specification", "use-case-diagram", "test-cases"] as const)("invalidates approval when %s changes", async (id) => {
    await planning();
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    const file = join(feature().dir, ARTIFACTS[id].file);
    await writeFile(file, (await readFile(file, "utf8")) + "\nNew scope");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(1);
    expect(JSON.parse((await cmdStatus(args("status", [], { change: "demo", json: true }), root)).stdout).approval).toBe("changed");
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
  });

  it("checks approval throughout autonomous execution and supports returning to planning", async () => {
    await implementation();
    await writeFile(join(feature().dir, ARTIFACTS["implementation-plan"].file), "# Changed contract\nNew scope");
    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(1);
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
    expect(feature().meta?.approval?.status).toBe("pending");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(1);
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
  });

  it("blocks empty earlier artifacts and unfinished tasks", async () => {
    await implementation();
    await writeFile(join(feature().dir, "tasks.md"), "- [ ] Implement task\n");
    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(1);
    await writeFile(join(feature().dir, "tasks.md"), "- [x] Implement task\n");
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), "");
    expect(validateFeature(feature()).issues.some((i) => i.code === "artifact_unfilled")).toBe(true);
  });
});

describe("testing and review cycles", () => {
  it.each(["FAIL", "REJECT", "BLOCKED", "pass", ""])("blocks forward testing with status %s", async (status) => {
    await implementation();
    await cmdStage(args("stage", ["demo", "testing"]), root);
    await report("testing-result", status);
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(1);
  });

  it("requires a new test result after a review fix loop", async () => {
    await review();
    const oldExecution = feature().meta!.executionId;
    await report("review-report", "FAIL");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
    expect(feature().meta!.executionId).not.toBe(oldExecution);
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(1);
    await report("testing-result");
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nCurrent summary");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(1);
    await report("review-report");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
  });

  it("loops from failing testing and requires a result for the new execution", async () => {
    await implementation();
    await cmdStage(args("stage", ["demo", "testing"]), root);
    await report("testing-result", "FAIL");
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    await cmdStage(args("stage", ["demo", "testing"]), root);
    expect(validateFeature(feature()).issues.some((i) => i.code === "testing_stale")).toBe(true);
  });

  it("stops all review transitions on REQUIREMENT_BUG", async () => {
    await review();
    await report("review-report", "REQUIREMENT_BUG");
    for (const next of ["dones", "implementation", "planning"]) {
      expect((await cmdStage(args("stage", ["demo", next]), root)).code).toBe(1);
    }
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(1);
  });

  it("renders instruct with an exact path and the current execution id", async () => {
    await implementation();
    await cmdStage(args("stage", ["demo", "testing"]), root);
    const result = JSON.parse((await cmdInstruct(args("instruct", ["testing-result"], { change: "demo", json: true }), root)).stdout);
    expect(result.outputPath).toBe(join(feature().dir, ARTIFACTS["testing-result"].file));
    expect(result.template).toContain(`execution: "${feature().meta!.executionId}"`);
    expect((await cmdInstruct(args("instruct", ["testing-result"], { change: "unknown" }), root)).code).toBe(1);
  });
});

describe("archive consistency", () => {
  it("runs the dones hook from a subdirectory and preserves review on failure", async () => {
    await review();
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Closure\nVerified");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "dones.sh"), "exit 9\n");
    await mkdir(join(root, "src"));
    expect((await cmdArchive(args("archive", ["demo"]), join(root, "src"))).stderr).toBe("hook failed");
    expect(feature().stage).toBe("review");
  });
  it("requires the feature report before moving to dones", async () => {
    await review();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(1);
    expect(feature().stage).toBe("review");
  });

  it("copies requirement, use cases and test plan into canonical docs on archive", async () => {
    await planning();
    await writeFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), "# Index\n[UC-001](use-cases/UC-001.md)");
    await cmdApprove(args("approve", ["demo"]), root);
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    await cmdStage(args("stage", ["demo", "testing"]), root);
    await report("testing-result");
    await cmdStage(args("stage", ["demo", "review"]), root);
    await report("review-report");
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified scope and tests");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);

    const canonical = join(root, "docs");
    expect(await readFile(join(canonical, "requirement", "app", "demo.md"), "utf8")).toContain("status: archived");
    expect(await readFile(join(canonical, "use-cases", "app", "demo", "README.md"), "utf8")).toContain("UC-001");
    expect(await readFile(join(canonical, "use-cases", "app", "demo", "README.md"), "utf8")).toContain("[UC-001](UC-001.md)");
    expect(await readFile(join(canonical, "use-cases", "app", "demo", "diagram.md"), "utf8")).toContain("Contract");
    expect(await readFile(join(canonical, "use-cases", "app", "demo", "UC-001.md"), "utf8")).toContain("UC-001");
    expect(await readFile(join(canonical, "testplan", "app", "demo.md"), "utf8")).toContain("TC-001");
    expect(await readFile(join(canonical, "testplan", "app", "demo-result.md"), "utf8")).toContain("status: PASS");
  });

  it.each(["archive", "stage"])("completes the pipeline through %s with consistent spec and metadata", async (command) => {
    await review();
    await mkdir(join(root, "docs", "use-cases", "app"), { recursive: true });
    const canonical = join(root, "docs", "use-cases", "app", "demo.md");
    await writeFile(canonical, spec);
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified scope and tests");
    const result = command === "archive" ? await cmdArchive(args(command, ["demo"]), root) : await cmdStage(args(command, ["demo", "dones"]), root);
    expect(result.code, result.stdout).toBe(0);
    expect(feature().stage).toBe("dones");
    expect(feature().meta?.status).toBe("archived");
    expect(await readFile(canonical, "utf8")).toContain("status: archived");
    expect(validateFeature(feature()).valid).toBe(true);
    expect(JSON.parse((await cmdStatus(args("status", [], { all: true, json: true }), root)).stdout).features).toHaveLength(1);
  });

  it("honors skip-specs on first and repeated archive while marking metadata", async () => {
    await review();
    await mkdir(join(root, "docs", "use-cases", "app"), { recursive: true });
    const canonical = join(root, "docs", "use-cases", "app", "demo.md");
    await writeFile(canonical, spec);
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Closure\nVerified");
    expect((await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root)).code).toBe(0);
    expect((await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root)).code).toBe(0);
    expect(await readFile(canonical, "utf8")).toBe(spec);
    expect(feature().meta?.status).toBe("archived");
  });

  it("preserves a related feature's canonical docs updated after a bug fix", async () => {
    await review();
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Closure\nVerified");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    const canonical = join(root, "docs", "requirement", "app", "demo.md");
    const updated = (await readFile(canonical, "utf8")) + "\nBug fix: clarified duplicate-submit behavior.";
    await writeFile(canonical, updated);
    expect((await cmdArchive(args("archive", ["demo"]), root)).stderr).toBe("canonical docs changed");
    expect(await readFile(canonical, "utf8")).toBe(updated);
    expect((await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root)).code).toBe(0);
    expect(await readFile(canonical, "utf8")).toBe(updated);
  });

  it("restores stage, spec and metadata if metadata archival fails", async () => {
    await review();
    await mkdir(join(root, "docs", "use-cases", "app"), { recursive: true });
    const canonical = join(root, "docs", "use-cases", "app", "demo.md");
    await writeFile(canonical, spec);
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Closure\nVerified");
    const originalMeta = await readFile(join(feature().dir, ".kfw.json"), "utf8");
    const writer = paths.writeFileAtomic;
    let failed = false;
    vi.spyOn(paths, "writeFileAtomic").mockImplementation(async (file, content) => {
      if (file.endsWith(".kfw.json") && !failed) {
        failed = true;
        throw new Error("Simulated metadata write failure");
      }
      await writer(file, content);
    });
    await expect(cmdArchive(args("archive", ["demo"]), root)).rejects.toThrow("feature restored to review");
    expect(feature().stage).toBe("review");
    expect(await readFile(canonical, "utf8")).toBe(spec);
    expect(await readFile(join(feature().dir, ".kfw.json"), "utf8")).toBe(originalMeta);
  });
});

describe("CLI output and persisted data", () => {
  it("returns failure consistently for invalid JSON and text validation", async () => {
    await planning();
    for (const json of [true, false]) {
      expect((await cmdValidate(args("validate", [], { change: "demo", json }), root)).code).toBe(1);
    }
    await cmdApprove(args("approve", ["demo"]), root);
    expect((await cmdValidate(args("validate", [], { change: "demo", json: true }), root)).code).toBe(0);
    expect(JSON.parse((await cmdView(args("view", [], { json: true }), root)).stdout).stages).toHaveLength(7);
  });

  it("reports corrupt metadata and config instead of silently falling back", async () => {
    await planning();
    await writeFile(join(feature().dir, ".kfw.json"), "{");
    const corrupt = findFeature(root, "demo")!;
    expect(corrupt.metaError).toContain("Invalid JSON");
    const check = validateFeature(corrupt);
    expect(check.valid).toBe(false);
    expect(check.issues.some((i) => i.code === "metadata_invalid")).toBe(true);
    expect((await cmdStatus(args("status", [], { all: true }), root)).code).toBe(0);
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), "null");
    expect(() => readProjectConfig(root)).toThrow("Invalid project config");
  });

  it("skips stray directories that are not work items", async () => {
    await mkdir(join(root, ".works", "testing", "scratchpad"));
    await mkdir(join(root, ".works", "review", "notes.txt"));
    expect(listFeatures(root)).toEqual([]);
    await mkdir(join(root, ".works", "testing", "ghost_20200101_0000"));
    expect(listFeatures(root).map((f) => f.folder)).toEqual(["ghost_20200101_0000"]);
  });

  it("preserves bootstrap defaults when initialized again", async () => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ defaultContext: "auth", reviewer: "reviewer", agents: ["codex"], stack: "go" }));
    expect(bootstrapDefaults(root)).toMatchObject({ defaultContext: "auth", reviewer: "reviewer", agents: ["codex"], stack: "go" });
  });

  it("rejects ambiguous legacy names and allows exact folder selection", async () => {
    await planning();
    const secondDir = join(root, ".works", "brainstorm", "demo_20200101_0000");
    await mkdir(secondDir);
    await writeFeatureMeta(secondDir, { schema: "kanban-flow", feature: "demo", context: "app", created: "20200101_0000" });
    expect(() => findFeature(root, "demo")).toThrow("Ambiguous feature");
    expect(findFeature(root, "demo_20200101_0000")?.dir).toBe(secondDir);
    expect(readFeatureMeta(secondDir)?.feature).toBe("demo");
    expect(executionContractHash(secondDir)).toBeNull();
  });
});
