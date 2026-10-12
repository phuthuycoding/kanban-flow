import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { validateFeature } from "../workflow/validate.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { readMarkdownSection, sectionItems } from "../shared/frontmatter.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = (name = "surf") => findFeature(root, name)!;
const specPath = (name = "surf") => join(feature(name).dir, ARTIFACTS["spec-requirement"].file);
const writeSpec = async (body: string, name = "surf") =>
  writeFile(specPath(name), `---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n${body}`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-surfaces-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function brainstorm(name = "surf"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
}

const codes = (name = "surf") => validateFeature(feature(name)).issues.map((i) => i.code);

describe("readMarkdownSection + sectionItems — section primitives", () => {
  it("extracts a ## section body and stops at the next heading", () => {
    const body = "# T\n## Affected surfaces\n- README\n- docs site\n## Actors\n- human\n";
    expect(readMarkdownSection(body, "Affected surfaces")).toBe("\n- README\n- docs site\n");
    expect(readMarkdownSection(body, "Actors")).toBe("\n- human\n");
    expect(readMarkdownSection(body, "Missing")).toBeNull();
    expect(sectionItems(readMarkdownSection(body, "Affected surfaces")!)).toEqual(["README", "docs site"]);
  });

  it("drops comments, blanks, markers and template tokens from items", () => {
    const s = "\n<!-- hint -->\n\n- {affected_surfaces}\n- README\nplain line\n";
    expect(sectionItems(s)).toEqual(["README", "plain line"]);
  });
});

describe("templates and docs teach the contract (UC-002, TC-005/006)", () => {
  it("spec template ships the section and the plan template documents coverage (TC-005)", async () => {
    const specTpl = await readFile(join(process.cwd(), "kanban-flow", "templates", "phase-1-spec-requirement.md"), "utf8");
    expect(specTpl).toContain("## Affected surfaces");
    expect(specTpl).toContain("{affected_surfaces}");
    const planTpl = await readFile(join(process.cwd(), "kanban-flow", "templates", "phase-2-implementation-plan.md"), "utf8");
    expect(planTpl).toContain("Affected surfaces");
  });

  it("skills, workflow docs and changelog all mention the contract (TC-006)", async () => {
    for (const rel of [
      "skills/kanban-brainstorm/SKILL.md",
      "skills/kanban-plan/SKILL.md",
      "docs/workflow/gates.md",
      "docs/workflow/cli-reference.md",
      "CHANGELOG.md",
    ]) {
      expect(await readFile(join(process.cwd(), rel), "utf8"), rel).toMatch(/affected surfaces|Affected surfaces/i);
    }
  });
});

describe("brainstorm gate — ## Affected surfaces (UC-001, TC-001…004)", () => {
  it("refuses brainstorm exit when the heading is absent (TC-001)", async () => {
    await brainstorm();
    await writeSpec("");
    expect(codes()).toContain("affected_surfaces_missing");
    const res = await cmdStage(args("stage", ["surf", "planning"]), root);
    expect(res.code).toBe(1);
    expect(feature().stage).toBe("brainstorm");
  });

  it("refuses placeholder, comment-only and empty bodies alike (TC-002)", async () => {
    await brainstorm();
    for (const body of [
      "\n## Affected surfaces\n{affected_surfaces}\n",
      "\n## Affected surfaces\n<!-- suggestion only -->\n",
      "\n## Affected surfaces\n\n",
    ]) {
      await writeSpec(body);
      expect(codes(), JSON.stringify(body)).toContain("affected_surfaces_missing");
    }
  });

  it("lets a spec with real declared surfaces stage to planning (TC-003)", async () => {
    await brainstorm();
    await writeSpec("\n## Affected surfaces\n- README\n- docs site\n");
    expect(codes()).not.toContain("affected_surfaces_missing");
    expect((await cmdStage(args("stage", ["surf", "planning"]), root)).code).toBe(0);
  });

  it("never fires outside brainstorm — legacy items keep validating (TC-004)", async () => {
    const dir = join(root, ".works", "implementation", "legacy_20261001_1000");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nOld spec, no section.");
    await writeFile(join(dir, "tasks.md"), "# Tasks\n- [x] done\n");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "legacy", context: "app", created: "20261001_1000" });
    expect(codes("legacy")).not.toContain("affected_surfaces_missing");
  });
});

describe("coverage warning — declared but unplanned surfaces (UC-003, TC-007/008)", () => {
  const planPath = () => join(feature().dir, ARTIFACTS["implementation-plan"].file);
  async function planningItem(withSurfaces = "\n## Affected surfaces\n- docs site\n- README\n"): Promise<void> {
    await brainstorm();
    await writeSpec(withSurfaces);
    expect((await cmdStage(args("stage", ["surf", "planning"]), root)).code).toBe(0);
  }

  it("warns per uncovered surface and stays non-blocking (TC-007)", async () => {
    await planningItem();
    await writeFile(planPath(), "# Plan\n## Task Breakdown\n- README gets a task.\n");
    const res = validateFeature(feature());
    const uncovered = res.issues.filter((i) => i.code === "affected_surface_uncovered");
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].severity).toBe("WARNING");
    expect(uncovered[0].message).toContain("docs site");
    expect(res.issues.some((i) => i.severity === "ERROR" && i.code === "affected_surface_uncovered")).toBe(false);
  });

  it("is silent when every declared surface is covered (TC-008)", async () => {
    await planningItem();
    await writeFile(planPath(), "# Plan\n- README task\n- docs site entry in Documentation Impact\n");
    expect(codes()).not.toContain("affected_surface_uncovered");
  });
});

describe("N/A escape and immunities (UC-004, TC-009/010)", () => {
  it("accepts N/A variants through the gate with zero coverage warnings (TC-009)", async () => {
    let i = 0;
    for (const na of ["N/A", "n/a", "N/A."]) {
      const name = `s-na-${i++}`;
      await brainstorm(name);
      await writeSpec(`\n## Affected surfaces\n${na}\n`, name);
      expect(codes(name), na).not.toContain("affected_surfaces_missing");
      expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
      expect(codes(name)).not.toContain("affected_surface_uncovered");
    }
  });

  it("bug specs and N/A-mixed sections behave (TC-010)", async () => {
    // bug: no surfaces check at all
    expect((await cmdNew(args("new", ["buggy"], { context: "app", type: "bug" }), root)).code).toBe(0);
    await writeFile(specPath("buggy"), "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n");
    expect(codes("buggy")).not.toContain("affected_surfaces_missing");
    // N/A alongside real bullets exempts only the N/A line
    await brainstorm();
    await writeSpec("\n## Affected surfaces\n- N/A\n- landing page\n");
    expect((await cmdStage(args("stage", ["surf", "planning"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["implementation-plan"].file), "# Plan\nNothing declared.\n");
    const uncovered = validateFeature(feature()).issues.filter((i) => i.code === "affected_surface_uncovered");
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0].message).toContain("landing page");
    expect(uncovered[0].message).not.toContain("N/A");
  });
});
