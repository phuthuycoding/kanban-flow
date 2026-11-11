import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdValidate, cmdStatus } from "../cli/commands/inspect.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { validateFeature, checkDirectionGate } from "../workflow/validate.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import { grantStageWaiver } from "./support/stage-waiver.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = () => findFeature(root, "demo")!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
const text = (r: { stdout?: string; stderr?: string }) => `${r.stdout ?? ""}\n${r.stderr ?? ""}`;

async function implementation(): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature().dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
}

async function report(id: "testing-result" | "review-report", status: string): Promise<void> {
  await writeFile(join(feature().dir, ARTIFACTS[id].file), `---\nstatus: ${status}\nexecution: ${feature().meta?.executionId}\n${id === "review-report" ? "ci: none\nlanding: none\n" + REVIEW_DOCS_NONE : ""}---\n# Evidence\nVerified current implementation.\n${id === "testing-result" ? evidence : ""}`);
}

async function inTesting(status: string): Promise<void> {
  await implementation();
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await report("testing-result", status);
  await grantStageWaiver(root, "demo");
}

async function inReview(status: string): Promise<void> {
  await implementation();
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await report("testing-result", "PASS");
  await grantStageWaiver(root, "demo");
  expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
  await report("review-report", status);
}

const codes = () => validateFeature(feature()).issues;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-reject-fail-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("a REJECT testing report reads as FAIL", () => {
  it("refuses entering review with the same exit code and a FAIL-only message", async () => {
    await inTesting("REJECT");
    const rejected = await cmdStage(args("stage", ["demo", "review"]), root);
    expect(rejected.code).toBe(1);
    expect(text(rejected)).toContain("status is FAIL");
    expect(text(rejected)).toContain("only PASS may enter review (FAIL must loop back to implementation)");
    expect(text(rejected)).not.toContain("REJECT");

    await report("testing-result", "FAIL");
    const failed = await cmdStage(args("stage", ["demo", "review"]), root);
    expect(failed.code).toBe(rejected.code);
    expect(text(failed)).toBe(text(rejected));
  });

  it("raises no testing_status error and warns with the word FAIL", async () => {
    await inTesting("REJECT");
    const issues = codes();
    expect(issues.some((i) => i.code === "testing_status")).toBe(false);
    const warning = issues.find((i) => i.code === "testing_loops_back");
    expect(warning?.severity).toBe("WARNING");
    expect(warning?.message).toContain("Testing FAIL:");
    expect(warning?.message).not.toContain("REJECT");
  });

  it("kf validate output names FAIL and never REJECT", async () => {
    await inTesting("REJECT");
    const out = text(await cmdValidate(args("validate", [], { change: "demo" }), root));
    expect(out).toContain("Testing FAIL");
    expect(out).not.toContain("REJECT");
  });

  it("states FAIL, PASS and BLOCKED in the invalid-status message", async () => {
    await inTesting("MAYBE");
    const message = codes().find((i) => i.code === "testing_status")?.message;
    expect(message).toContain("PASS/FAIL/BLOCKED");
    expect(message).not.toContain("REJECT");
  });
});

describe("a REJECT review report reads as FAIL", () => {
  it("states the closing refusal with FAIL only, like a FAIL report", async () => {
    await inReview("REJECT");
    const rejected = checkDirectionGate(feature(), "done").find((i) => i.code === "review_not_pass")?.message;
    expect(rejected).toContain("review-report status is FAIL; only PASS may enter done (FAIL loops back to implementation)");
    expect(rejected).not.toContain("REJECT");
    await report("review-report", "FAIL");
    expect(checkDirectionGate(feature(), "done").find((i) => i.code === "review_not_pass")?.message).toBe(rejected);
  });

  it("refuses closing with the same exit code and a FAIL-only message", async () => {
    await inReview("REJECT");
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nCurrent summary");
    const rejected = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(rejected.code).toBe(1);
    expect(text(rejected)).not.toContain("REJECT");

    await report("review-report", "FAIL");
    const failed = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(failed.code).toBe(rejected.code);
    expect(text(failed)).toBe(text(rejected));
  });

  it("raises no review_status error and warns with the word FAIL", async () => {
    await inReview("REJECT");
    const issues = codes();
    expect(issues.some((i) => i.code === "review_status")).toBe(false);
    const warning = issues.find((i) => i.code === "review_loops_back");
    expect(warning?.message).toContain("Review FAIL:");
    expect(warning?.message).not.toContain("REJECT");
  });

  it("states FAIL, PASS and REQUIREMENT_BUG in the invalid-status message", async () => {
    await inReview("MAYBE");
    const message = codes().find((i) => i.code === "review_status")?.message;
    expect(message).toContain("PASS/FAIL/REQUIREMENT_BUG");
    expect(message).not.toContain("REJECT");
  });

  it("shows the needs-you decision as review FAIL in kf status --all", async () => {
    await inReview("REJECT");
    const out = text(await cmdStatus(args("status", [], { all: true }), root));
    expect(out).toContain("review FAIL — repair (kf stage demo implementation)");
    expect(out).not.toContain("REJECT");
  });
});

describe("kf autoconfig", () => {
  it("never offers REJECT as a status", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kfw-autoconfig-reject-"));
    try {
      await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
      const res = await cmdAutoconfig(args("autoconfig"), dir, async () => ({ code: 0, stdout: "[]", stderr: "" }));
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("Loop semantics: FAIL");
      expect(res.stdout).not.toContain("REJECT");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
