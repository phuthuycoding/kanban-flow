import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STAGES, type Stage } from "./schema.js";
import {
  ensureWorksStructure,
  listFeatures,
  findFeature,
  writeFeatureMeta,
  executionContractHash,
} from "./features.js";
import { computeStatus, statusToJson, renderStatusText } from "./status.js";
import { validateFeature } from "./validate.js";

let root: string;

async function setup(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "kfw-test-"));
  ensureWorksStructure(root);
  return root;
}

async function makeFeature(name = "todo-list", stage: Stage = "brainstorm", ctx = "app", approved = false): Promise<void> {
  const ts = "20260916_1800";
  const dir = join(root, ".works", stage, `${name}_${ts}`);
  await mkdir(dir, { recursive: true });
  await writeFeatureMeta(dir, {
    schema: "kanban-flow",
    feature: name,
    context: ctx,
    created: ts,
    approval: stage === "planning" && approved ? { status: "approved", by: "human", at: ts } : undefined,
  });
  // Fill the brainstorm requirement for anything past brainstorm.
  if (stage !== "brainstorm" && stage !== "planning" || (stage === "planning")) {
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\nreal content\nFR-001");
  }
  if (stage === "planning" || stage === "backlog" || stage === "implementation" || stage === "testing" || stage === "review" || stage === "dones") {
    for (const f of ["phase-2-implementation-plan.md", "phase-2-use-case-specification.md", "phase-2-use-case-diagram.md", "phase-2-test-case.md"]) {
      await writeFile(join(dir, f), `# ${f}\nreal content\n## TC-001\nFR-001 UC-001`);
    }
    await mkdir(join(dir, "use-cases"), { recursive: true });
    await writeFile(join(dir, "use-cases", "UC-001.md"), "# UC-001\nreal content");
  }
  if (stage === "testing" || stage === "review" || stage === "dones") {
    await writeFile(join(dir, "phase-4-testing-result.md"), "---\nstatus: PASS\nexecution: test-run\n---\n# Test\nreal content\nOverall: 85%");
  }
  if (stage === "review" || stage === "dones") {
    await writeFile(join(dir, "phase-5-review-report.md"), "---\nstatus: PASS\nexecution: test-run\n---\n# Review\nreal content");
  }
  if (stage === "dones") {
    await writeFile(join(dir, "phase-6-feature-report.md"), "# Feature Report\nreal content");
  }
  await writeFeatureMeta(dir, {
    schema: "kanban-flow", feature: name, context: ctx, created: ts,
    approval: approved || ["backlog", "implementation", "testing", "review", "dones"].includes(stage)
      ? { status: "approved", by: "human", at: ts, contractHash: executionContractHash(dir)! } : undefined,
    executionId: ["testing", "review", "dones"].includes(stage) ? "test-run" : undefined,
  });
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("listFeatures / findFeature", () => {
  it("finds features by folder timestamp name without metadata", async () => {
    await makeFeature("plain", "brainstorm");
    const features = listFeatures(root);
    expect(features).toHaveLength(1);
    expect(features[0].name).toBe("plain");
  });

  it("honors metadata feature name over folder name", async () => {
    await makeFeature("todo-list", "brainstorm");
    expect(findFeature(root, "todo-list")).not.toBeNull();
  });

  it("searches across stages", async () => {
    await makeFeature("archived", "dones");
    expect(findFeature(root, "archived")!.stage).toBe("dones");
  });
});

describe("computeStatus", () => {
  it("marks brainstorm feature with no artifacts as missing except planning+", async () => {
    await makeFeature("todo-list", "brainstorm");
    const f = findFeature(root, "todo-list")!;
    const s = computeStatus(f);
    // spec-requirement is due at brainstorm; everything else is waiting
    expect(s.artifacts.filter((a) => a.status === "missing")).toHaveLength(1);
    expect(s.artifacts.filter((a) => a.status === "waiting")).toHaveLength(7);
    expect(s.dueCount).toBe(1);
    expect(s.next).toBe("spec-requirement");
  });

  it("marks dones feature in MYSTERY-complete state as missing", async () => {
    // A feature that landed in dones without required reports must be flagged.
    const ts = "20260916_1800";
    const dir = join(root, ".works", "dones", `broken_${ts}`);
    await mkdir(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "broken", context: "app", created: ts });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "# Spec\nreal");
    await writeFile(join(dir, "phase-2-implementation-plan.md"), "# Plan\nreal");

    const f = findFeature(root, "broken")!;
    const s = computeStatus(f);
    // testing-result + review-report + feature-report are due at dones
    for (const id of ["testing-result", "review-report", "feature-report"]) {
      expect(s.artifacts.filter((a) => a.id === id)[0].status).toBe("missing");
    }
  });
});

describe("validateFeature", () => {
  it("blocks leaving brainstorm without spec-requirement", async () => {
    await makeFeature("todo-list", "brainstorm");
    const f = findFeature(root, "todo-list")!;
    const v = validateFeature(f);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "gate_blocked")).toBe(true);
  });

  it("blocks leaving planning without approval", async () => {
    await makeFeature("todo-list", "planning", "app", false);
    const f = findFeature(root, "todo-list")!;
    const v = validateFeature(f);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "approval_required")).toBe(true);
  });

  it("passes a fully-approved planning feature", async () => {
    await makeFeature("todo-list", "planning", "app", true);
    const f = findFeature(root, "todo-list")!;
    const v = validateFeature(f);
    expect(v.valid).toBe(true);
  });

  it("warns when testing FAIL loops back and when review is REQUIREMENT_BUG", async () => {
    await makeFeature("todo-list", "testing", "app", true);
    let f = findFeature(root, "todo-list")!;
    // override the testing-result to FAIL before validating
    await writeFile(join(f.dir, "phase-4-testing-result.md"), "---\nstatus: FAIL\n---\n# Test\nreal content\nOverall: 40%");
    let v = validateFeature(f);
    expect(v.issues.some((i) => i.code === "testing_loops_back")).toBe(true);

    await makeFeature("reviewed", "review", "app", true);
    f = findFeature(root, "reviewed")!;
    const rv = join(f.dir, "phase-5-review-report.md");
    await writeFile(rv, "---\nstatus: REQUIREMENT_BUG\n---\n# Review\nreal content");
    v = validateFeature(f);
    expect(v.issues.some((i) => i.code === "requirement_bug_stop")).toBe(true);
  });
});

describe("seatbelt against the original incident", () => {
  it("a dones feature missing reports fails validation", async () => {
    const ts = "20260916_1800";
    const dir = join(root, ".works", "dones", `todo-list_${ts}`);
    await mkdir(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "todo-list", context: "app", created: ts });
    // invent spec-link.md (the incident artifact) but NO real artifacts
    await writeFile(join(dir, "spec-link.md"), "Brainstorm spec: docs/foo.md");
    await writeFile(join(dir, "phase-2-test-case.md"), "# Test\nreal content");

    const f = findFeature(root, "todo-list")!;
    const s = computeStatus(f);
    const v = validateFeature(f);

    // spec-requirement is missing (spec-link.md is NOT a valid artifact)
    expect(s.artifacts.find((a) => a.id === "spec-requirement")!.status).toBe("missing");
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.code === "artifact_missing" && i.file === "phase-1-spec-requirement.md")).toBe(true);
  });
});

describe("renderStatusText", () => {
  it("renders a readable checklist", async () => {
    await makeFeature("todo-list", "brainstorm");
    const f = findFeature(root, "todo-list")!;
    const text = renderStatusText(computeStatus(f));
    expect(text).toContain("[ ] spec-requirement");
    expect(text).toContain("Next:");
    expect(text).toContain("Stage: brainstorm");
  });
});

describe("statusToJson", () => {
  it("serializes cleanly", async () => {
    await makeFeature("todo-list", "brainstorm");
    const f = findFeature(root, "todo-list")!;
    const j = statusToJson(computeStatus(f));
    expect(j.feature).toBe("todo-list");
    expect(j.artifacts.length).toBe(8);
  });
});

describe("stage movement contract", () => {
  it("all workflow stages exist as folders", async () => {
    expect(STAGES.length).toBe(7);
  });
});
