import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import type { ParsedArgs } from "../cli/args.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

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
  await writeFile(join(feature().dir, ARTIFACTS[id].file), `---\nstatus: PASS\nexecution: ${feature().meta?.executionId}\n${id === "review-report" ? "ci: none\nlanding: none\n" + REVIEW_DOCS_NONE : ""}---\n# Evidence\nVerified current implementation.\n${id === "testing-result" ? evidence : ""}`);
}

async function archived(uc = ucFile, beforeArchive?: () => void): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["implementation-plan"].file), withDocsImpact("# Contract\nUC-001: Create a task"));
  await writeFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), ucIndex);
  await writeFile(join(feature().dir, ARTIFACTS["use-case-diagram"].file), diagram);
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001-create-task.md"), uc);
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), testPlan);
  expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await report("testing-result");
  await grantStageWaiver(root, "demo");
  expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
  await report("review-report");
  await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified scope and tests");
  beforeArchive?.();
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

/** Write `content` at a canonical snapshot path, as an earlier release's close left it. */
async function snapshot(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

describe("archive writes nothing under docs/", () => {
  it("leaves docs/ absent and the item's own artifacts as approved", async () => {
    await archived();
    expect(feature().stage).toBe("done");
    expect(existsSync(join(root, "docs")), "a close copies no canonical doc").toBe(false);
    expect(await readFile(join(feature().dir, ARTIFACTS["use-case-diagram"].file), "utf8")).toBe(diagram);
    expect(await readFile(join(feature().dir, ARTIFACTS["test-cases"].file), "utf8")).toBe(testPlan);
    expect(await readFile(join(feature().dir, "use-cases", "UC-001-create-task.md"), "utf8")).toBe(ucFile);
  });

  it("creates a missing done directory before the move", async () => {
    await archived(ucFile, () => rmSync(join(root, ".works", "done"), { recursive: true, force: true }));
    expect(feature().stage).toBe("done");
    expect(existsSync(join(root, ".works", "done", feature().folder))).toBe(true);
  });

  it("copies a source without frontmatter nowhere and leaves it as written", async () => {
    const plain = "# UC-001 Create a task\nUser can create a task.\n";
    await archived(plain);
    expect(existsSync(docs.uc())).toBe(false);
    expect(await readFile(join(feature().dir, "use-cases", "UC-001-create-task.md"), "utf8")).toBe(plain);
  });

  it("flips no use case row: the item's index stays as approved and no canonical index is written", async () => {
    await archived();
    expect(existsSync(docs.index())).toBe(false);
    expect(await readFile(join(feature().dir, ARTIFACTS["use-case-specification"].file), "utf8")).toBe(ucIndex);
  });
});

describe("re-archive of a done item with legacy snapshots", () => {
  /** The stamped snapshots an earlier release wrote at close. */
  const stamped = () => ({
    [docs.index()]: ucIndex.replace("use-cases/UC-001", "UC-001").replace("status: planning", "status: archived").replace("| planned |\n\n##", "| implemented |\n\n##"),
    [docs.uc()]: ucFile.replace("status: planning", "status: archived"),
    [docs.diagram()]: diagram.replace("status: planning", "status: archived"),
    [docs.plan()]: testPlan.replace("status: planning", "status: archived"),
  });

  async function seed(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) await snapshot(path, content);
  }

  async function expectUntouched(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) expect(await readFile(path, "utf8"), path).toBe(content);
  }

  it("reports no changed docs and records no bypass", async () => {
    await archived();
    await seed(stamped());
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    await expectUntouched(stamped());
    expect(feature().meta?.bypasses ?? []).toHaveLength(0);
  });

  it("no longer refuses a canonical doc edited after archive, and keeps the edit", async () => {
    await archived();
    await seed(stamped());
    const edited = `${stamped()[docs.uc()]}\n> **Superseded by \`later\`.** Kept for history.\n`;
    await writeFile(docs.uc(), edited);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stderr).not.toBe("canonical docs changed");
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("no longer refuses a status-only edit on an archived doc, and keeps it", async () => {
    await archived();
    await seed(stamped());
    const edited = stamped()[docs.uc()].replace("status: archived", "status: superseded");
    await writeFile(docs.uc(), edited);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("no longer refuses a body edit on an unstamped doc from an older version, and keeps it", async () => {
    await archived();
    const edited = `${ucFile}\nHand-written note.\n`;
    await snapshot(docs.uc(), edited);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(await readFile(docs.uc(), "utf8")).toBe(edited);
  });

  it("leaves unstamped docs written by an older version as they are, without a bypass", async () => {
    await archived();
    // What older versions wrote: sources copied as-is, only links rewritten in the index.
    const older = {
      [docs.index()]: ucIndex.replace("use-cases/UC-001", "UC-001"),
      [docs.uc()]: ucFile,
      [docs.diagram()]: diagram,
      [docs.plan()]: testPlan,
    };
    await seed(older);
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(feature().meta?.bypasses ?? []).toHaveLength(0);
    await expectUntouched(older);
  });
});

describe("closure guidance and repository docs", () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  it("the archive skill points to the living docs edited at review and neither copies nor banners", () => {
    const skill = readFileSync(join(repo, "assets", "skills", "archive", "SKILL.md"), "utf8");
    const review = readFileSync(join(repo, "assets", "skills", "review", "SKILL.md"), "utf8");
    expect(skill).toContain("](reconcile.md)");
    expect(existsSync(join(repo, "assets", "skills", "archive", "reconcile.md"))).toBe(true);
    expect(skill).toContain("docs/specs/");
    expect(skill).toContain("the close copies nothing");
    expect(skill).toContain("docs({context}): update living docs for {feature_name}");
    expect(review).toContain("docs({context}): update living docs for {feature_name}");
    expect(skill).not.toContain("Reconcile superseded docs");
    expect(skill).not.toContain("docs({context}): sync canonical docs for {feature_name}");
  });

  it("the feature report template asks for the reconciled docs", () => {
    expect(readFileSync(join(repo, "assets", "templates", "phase-6-feature-report.md"), "utf8")).toContain("## Docs Reconciled");
  });

  it("no canonical use case or test plan is left in planning, and superseded docs are marked", async () => {
    const files = [...walk(join(repo, "docs", "use-cases")), ...walk(join(repo, "docs", "testplan"))].filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => /^status: planning$/m.test(readFileSync(f, "utf8")))).toEqual([]);
    const doneTrigger = join(repo, "docs", "use-cases", "cli", "done-trigger", "UC-001-archive-leaves-issue-open.md");
    expect(await readFile(doneTrigger, "utf8")).toContain("Superseded by `archive-after-merge`");
  });
});
