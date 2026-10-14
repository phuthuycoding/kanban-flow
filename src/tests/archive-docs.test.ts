import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = () => findFeature(root, "demo")!;
const fm = (status: string) => `---\nfeature: "demo"\ncontext: "app"\nstatus: ${status}\n---\n`;

const spec = `${fm("confirmed")}# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A`;
const ucIndex = `${fm("planning")}
# Use Case Index

## Use Case Files

| ID | Name | File | Primary Actor | Status |
|---|---|---|---|---|
| UC-001 | Create a task | [UC-001](use-cases/UC-001-create-task.md) | User | planned |

## Use Case Coverage

| UC ID | FR references | TC references | Acceptance coverage |
|---|---|---|---|
| UC-001 | FR-001 | TC-001 | planned |
`;
const ucFile = `${fm("planning")}\n# UC-001 Create a task\nUser can create a task.\n`;
const diagram = `${fm("planning")}\n# Use Case Diagram\nUC-001\n`;
const testPlan = `${fm("planning")}\n# Test Plan\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n`;
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

const docs = {
  index: () => join(root, "docs", "use-cases", "app", "demo", "README.md"),
  uc: () => join(root, "docs", "use-cases", "app", "demo", "UC-001-create-task.md"),
  diagram: () => join(root, "docs", "use-cases", "app", "demo", "diagram.md"),
  plan: () => join(root, "docs", "testplan", "app", "demo.md"),
  result: () => join(root, "docs", "testplan", "app", "demo-result.md"),
};

async function report(id: "testing-result" | "review-report"): Promise<void> {
  await writeFile(join(feature().dir, ARTIFACTS[id].file), `---\nstatus: PASS\nexecution: ${feature().meta?.executionId}\n---\n# Evidence\nVerified current implementation.\n${id === "testing-result" ? evidence : ""}`);
}

async function archived(uc = ucFile): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["implementation-plan"].file), "# Contract\nUC-001: Create a task");
  await writeFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), ucIndex);
  await writeFile(join(feature().dir, ARTIFACTS["use-case-diagram"].file), diagram);
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001-create-task.md"), uc);
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), testPlan);
  expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
  for (const stage of ["implementation", "testing"]) expect((await cmdStage(args("stage", ["demo", stage]), root)).code).toBe(0);
  await report("testing-result");
  expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
  await report("review-report");
  await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified scope and tests");
  const result = await cmdArchive(args("archive", ["demo"]), root);
  expect(result.code, result.stdout).toBe(0);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-archive-docs-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("archive stamps canonical docs", () => {
  it("marks the UC index, UC files, diagram and test plan archived and keeps the result status", async () => {
    await archived();
    for (const path of [docs.index(), docs.uc(), docs.diagram(), docs.plan()]) {
      const content = await readFile(path, "utf8");
      expect(content, path).toContain("status: archived");
      expect(content, path).not.toContain("status: planning");
    }
    expect(await readFile(docs.result(), "utf8")).toContain("status: PASS");
  });

  it("copies a source without frontmatter unchanged", async () => {
    const plain = "# UC-001 Create a task\nUser can create a task.\n";
    await archived(plain);
    expect(await readFile(docs.uc(), "utf8")).toBe(plain);
  });

  it("flips use case rows to implemented and leaves the coverage table alone", async () => {
    await archived();
    const index = await readFile(docs.index(), "utf8");
    expect(index).toContain("| UC-001 | Create a task | [UC-001](UC-001-create-task.md) | User | implemented |");
    expect(index).toContain("| UC-001 | FR-001 | TC-001 | planned |");
    expect(await readFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), "utf8")).toBe(ucIndex);
  });
});

describe("re-archive with stamped docs", () => {
  it("reports no changed docs and records no bypass", async () => {
    await archived();
    const before = await readFile(docs.index(), "utf8");
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(await readFile(docs.index(), "utf8")).toBe(before);
    expect(feature().meta?.bypasses ?? []).toHaveLength(0);
  });

  it("still refuses when a canonical doc was edited after archive", async () => {
    await archived();
    const edited = `${await readFile(docs.uc(), "utf8")}\n> **Superseded by \`later\`.** Kept for history.\n`;
    await writeFile(docs.uc(), edited);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.stderr).toBe("canonical docs changed");
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("still refuses a status-only edit on an archived doc", async () => {
    await archived();
    const edited = (await readFile(docs.uc(), "utf8")).replace("status: archived", "status: superseded");
    await writeFile(docs.uc(), edited);
    expect((await cmdArchive(args("archive", ["demo"]), root)).stderr).toBe("canonical docs changed");
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("still refuses a body edit on an unstamped doc from an older version", async () => {
    await archived();
    const edited = `${ucFile}\nHand-written note.\n`;
    await writeFile(docs.uc(), edited);
    expect((await cmdArchive(args("archive", ["demo"]), root)).stderr).toBe("canonical docs changed");
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("upgrades unstamped docs written by an older version without a bypass", async () => {
    await archived();
    // What older versions wrote: sources copied as-is, only links rewritten in the index.
    await writeFile(docs.index(), ucIndex.replace("use-cases/UC-001", "UC-001"));
    await writeFile(docs.uc(), ucFile);
    await writeFile(docs.diagram(), diagram);
    await writeFile(docs.plan(), testPlan);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(feature().meta?.bypasses ?? []).toHaveLength(0);
    expect(await readFile(docs.index(), "utf8")).toContain("| User | implemented |");
    for (const path of [docs.index(), docs.uc(), docs.diagram(), docs.plan()]) {
      expect(await readFile(path, "utf8"), path).toContain("status: archived");
    }
  });
});

describe("closure guidance and repository docs", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  it("kanban-archive carries the reconcile step and the post-merge docs commit", () => {
    const skill = readFileSync(join(repo, "skills", "kanban-archive", "SKILL.md"), "utf8");
    expect(skill).toContain("Reconcile superseded docs");
    expect(skill).toContain("](reconcile.md)");
    expect(existsSync(join(repo, "skills", "kanban-archive", "reconcile.md"))).toBe(true);
    expect(skill).toContain("docs({context}): sync canonical docs for {feature_name}");
  });

  it("the feature report template asks for the reconciled docs", () => {
    expect(readFileSync(join(repo, "kanban-flow", "templates", "phase-6-feature-report.md"), "utf8")).toContain("## Docs Reconciled");
  });

  it("no canonical use case or test plan is left in planning, and superseded docs are marked", async () => {
    const files = [...walk(join(repo, "docs", "use-cases")), ...walk(join(repo, "docs", "testplan"))].filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /^status: planning$/m.test(readFileSync(f, "utf8")))).toEqual([]);
    const doneTrigger = join(repo, "docs", "use-cases", "cli", "done-trigger", "UC-001-archive-leaves-issue-open.md");
    expect(await readFile(doneTrigger, "utf8")).toContain("Superseded by `archive-after-merge`");
  });
});
