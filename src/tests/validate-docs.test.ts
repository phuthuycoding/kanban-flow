import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, updateFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { validateFeature, checkDirectionGate, type Finding } from "../workflow/validate.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus, cmdValidate } from "../cli/commands/inspect.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import type { ParsedArgs } from "../cli/args.js";
import { grantStageWaiver } from "./support/stage-waiver.js";
import { REVIEW_DOCS_NONE, writePlan } from "./helpers/contract.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let scratch: string;
let root: string;
let prevPath: string | undefined;

const sh = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name: string) => findFeature(root, name)!;

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A\n";
const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

// Spelled out here rather than read from the module, so a wrong constant cannot make a fixture agree with it.
const FIVE_HEADINGS = ["## Purpose", "## Current behaviour", "## Use cases", "## Surfaces", "## History"];

function livingDoc(history = "- Created the capability (#1)"): string {
  const sections = FIVE_HEADINGS.map((h) => (h === "## History" ? `${h}\n\n${history}\n` : `${h}\n\nSome text.\n`));
  return ["# Capability", "", ...sections].join("\n");
}

function index(links: string[]): string {
  return ["# cli", "", "## Capabilities", "", ...links.map((l) => `- [${l}](${l}) — one line`), ""].join("\n");
}

interface ProjectOptions {
  git?: boolean;
  origin?: boolean;
  worktree?: boolean;
  contexts?: string[];
  repository?: string;
  /** Files committed in the base commit (and pushed when there is an origin). */
  base?: Record<string, string>;
}

/** A project in `root`: optionally a git repo on `main` whose origin/HEAD points at origin/main. */
async function project(opts: ProjectOptions = {}): Promise<void> {
  const { git = true, origin = true, worktree = false, contexts = ["cli"], repository, base = {} } = opts;
  await mkdir(root, { recursive: true });
  if (git) {
    execFileSync("git", ["init", "-q", "-b", "main", root], { stdio: "pipe" });
    sh(root, "config", "user.email", "t@t");
    sh(root, "config", "user.name", "t");
    sh(root, "config", "commit.gpgsign", "false");
    writeAt(root, ".gitignore", ".works/\n.kf/\n");
    writeAt(root, "README.md", "# project\n");
    for (const [rel, body] of Object.entries(base)) writeAt(root, rel, body);
    commitAll(root, "base");
    if (origin) {
      const bare = join(scratch, "origin.git");
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare], { stdio: "pipe" });
      sh(root, "remote", "add", "origin", bare);
      sh(root, "push", "-q", "-u", "origin", "main");
      sh(root, "remote", "set-head", "origin", "main");
    }
  }
  ensureWorksStructure(root);
  await writeConfig({ worktree, contexts, repository });
}

async function writeConfig(opts: { worktree: boolean; contexts?: string[]; repository?: string }): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow",
    created: "x",
    ...(opts.contexts ? { contexts: opts.contexts } : {}),
    ...(opts.repository ? { repository: opts.repository } : {}),
    worktree: opts.worktree
      ? { enabled: true, baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") }
      : { enabled: false },
  }));
}

function writeAt(dir: string, rel: string, body: string): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function commitAll(dir: string, message: string): void {
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", message);
}

/** The checkout the item's code lives in: its worktree when it has one, else the project root. */
const checkout = (name: string): string => readFeatureMeta(feature(name).dir)!.worktree?.path ?? root;

/** A feature item in planning whose contract is complete apart from the plan, written with `impact` entries. */
async function plannedFeature(name: string, impact: string[] | null): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "cli" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  const dir = feature(name).dir;
  if (impact === null) {
    await writeFile(join(dir, ARTIFACTS["implementation-plan"].file), "# Contract\nUC-001: Create a task\n");
  } else {
    await writePlan(dir, "# Contract\nUC-001: Create a task", impact);
  }
  for (const id of ["use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(dir, "use-cases"), { recursive: true });
  await writeFile(join(dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

async function testingReport(name: string): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS["testing-result"].file),
    `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${evidence}`);
}

/** Writes the review report with the given status and extra frontmatter lines (each ending in a newline). */
async function reviewReport(name: string, status: string, extra: string, landing = "none"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS["review-report"].file),
    `---\nstatus: ${status}\nexecution: ${execution}\nci: none\nlanding: ${landing}\n${extra}---\n# Review\nVerified.\n`);
}

/** Approve through kf approve and drive the item from implementation into review. */
async function approveToReview(name: string): Promise<void> {
  const approved = await cmdApprove(args("approve", [name]), root);
  expect(approved.code, approved.stdout).toBe(0);
  await implementationToReview(name);
}

async function implementationToReview(name: string): Promise<void> {
  const testing = await cmdStage(args("stage", [name, "testing"]), root);
  expect(testing.code, testing.stdout).toBe(0);
  await testingReport(name);
  await grantStageWaiver(root, name);
  const review = await cmdStage(args("stage", [name, "review"]), root);
  expect(review.code, review.stdout).toBe(0);
}

/** A feature item in review, approved through kf approve on this version, with the given plan entries. */
async function featureInReview(name: string, impact: string[] = ["none — test fixture"]): Promise<void> {
  await plannedFeature(name, impact);
  await approveToReview(name);
}

/** A bug item in review, approved through kf approve on this version. */
async function bugInReview(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "cli", type: "bug" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), bugSpec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  await approveToReview(name);
}

/** An item approved on an earlier version: the approval it carries has no living-docs marker. */
async function dropMarker(name: string): Promise<void> {
  await updateFeatureMeta(root, name, (meta) => {
    const { livingDocs: _dropped, ...approval } = meta.approval as NonNullable<typeof meta.approval> & { livingDocs?: unknown };
    return { ...meta, approval };
  });
}

async function validate(name: string): Promise<{ code: number; valid: boolean; issues: Finding[] }> {
  const res = await cmdValidate(args("validate", [], { change: name, json: true }), root);
  const [entry] = JSON.parse(res.stdout) as { valid: boolean; issues: Finding[] }[];
  return { code: res.code, valid: entry.valid, issues: entry.issues };
}

const codes = (issues: Finding[]) => issues.map((i) => i.code);
const docsFindings = (issues: Finding[]) => issues.filter((i) => i.code.startsWith("docs_"));
const docsErrors = (issues: Finding[]) => docsFindings(issues).filter((i) => i.severity === "ERROR");
const withCode = (issues: Finding[], code: string) => issues.filter((i) => i.code === code);

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-validate-docs-"));
  root = join(scratch, "repo");
  prevPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(scratch, { recursive: true, force: true });
});

describe("plan Documentation Impact", () => {
  it("refuses validate and approve when the section names no living doc and no waiver, until a docs/specs path is added", async () => {
    await project();
    await plannedFeature("demo", ["TBD"]);

    const before = await validate("demo");
    expect(before.code).toBe(1);
    const missing = withCode(before.issues, "docs_impact_missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("ERROR");
    expect(missing[0].file).toBe(ARTIFACTS["implementation-plan"].file);

    const approve = await cmdApprove(args("approve", ["demo"]), root);
    expect(approve.code).toBe(1);
    expect(approve.stdout).toContain("docs_impact_missing");
    expect(feature("demo").stage).toBe("planning");
    expect(readFeatureMeta(feature("demo").dir)!.approval).toEqual({ status: "pending" });

    await writePlan(feature("demo").dir, "# Contract\nUC-001: Create a task", ["docs/specs/cli/x.md"]);
    const after = await validate("demo");
    expect(codes(after.issues)).not.toContain("docs_impact_missing");
    expect(docsErrors(after.issues)).toEqual([]);
  });

  it("refuses a plan with no Documentation Impact section at all", async () => {
    await project();
    await plannedFeature("demo", null);
    const res = await validate("demo");
    expect(res.code).toBe(1);
    expect(withCode(res.issues, "docs_impact_missing").map((i) => i.severity)).toEqual(["ERROR"]);
  });

  it("accepts a none waiver that gives a reason", async () => {
    await project();
    await plannedFeature("demo", ["none — internal refactor, no user-visible behaviour"]);
    const res = await validate("demo");
    expect(docsFindings(res.issues)).toEqual([]);
  });

  it.each([
    "docs/specs/cli/README.md",
    "docs/specs/cli/readme.md",
    "docs/specs/cli/ReadMe.md",
  ])("refuses %s because README is not a capability name", async (entry) => {
    await project();
    await plannedFeature("demo", [entry]);
    const found = withCode(validateFeature(feature("demo"), false, false).issues, "docs_capability_reserved");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");
  });

  it("refuses a docs/specs path in an undeclared context while contexts are declared, and accepts any valid context name otherwise", async () => {
    await project({ contexts: ["cli"] });
    await plannedFeature("demo", ["docs/specs/nope/x.md"]);
    const declared = withCode(validateFeature(feature("demo"), false, false).issues, "docs_context_undeclared");
    expect(declared).toHaveLength(1);
    expect(declared[0].severity).toBe("ERROR");
    expect(declared[0].message).toContain("nope");

    await writeConfig({ worktree: false });
    expect(codes(validateFeature(feature("demo"), false, false).issues)).not.toContain("docs_context_undeclared");
    expect(docsErrors(validateFeature(feature("demo"), false, false).issues)).toEqual([]);
  });

  it("applies the declared-context rule to consolidates entries", async () => {
    await project({ contexts: ["cli"] });
    await plannedFeature("demo", ["docs/specs/cli/x.md", "consolidates: nope/foo"]);
    const found = withCode(validateFeature(feature("demo"), false, false).issues, "docs_context_undeclared");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");
  });
});

describe("living-docs approval marker", () => {
  it("is recorded by kf approve, and a refused move puts back the previous approval without it", async () => {
    await project();
    await plannedFeature("demo", ["none — test fixture"]);
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    const hook = join(root, ".kf", "hooks", "implementation.sh");
    await writeFile(hook, "#!/bin/sh\necho 'lint gate is red'\nexit 1\n");
    await chmod(hook, 0o755);

    const refused = await cmdApprove(args("approve", ["demo"]), root);
    expect(refused.code).toBe(1);
    expect(feature("demo").stage).toBe("planning");
    const restored = readFeatureMeta(feature("demo").dir)!.approval;
    expect(restored).toEqual({ status: "pending" });
    expect(restored).not.toHaveProperty("livingDocs");

    rmSync(hook);
    const approved = await cmdApprove(args("approve", ["demo"]), root);
    expect(approved.code, approved.stdout).toBe(0);
    expect(feature("demo").stage).toBe("implementation");
    expect(readFeatureMeta(feature("demo").dir)!.approval).toMatchObject({ status: "approved", livingDocs: true });
  });

  it("is recorded when a legacy item returns to planning and is approved again", async () => {
    await project();
    await plannedFeature("demo", ["none — test fixture"]);
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    await dropMarker("demo");
    expect(readFeatureMeta(feature("demo").dir)!.approval).not.toHaveProperty("livingDocs");

    const back = await cmdStage(args("stage", ["demo", "planning"]), root);
    expect(back.code, back.stdout).toBe(0);
    expect(readFeatureMeta(feature("demo").dir)!.approval).toEqual({ status: "pending" });

    const again = await cmdApprove(args("approve", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(readFeatureMeta(feature("demo").dir)!.approval).toMatchObject({ status: "approved", livingDocs: true });
  });

  it("rejects metadata whose marker is anything but true", async () => {
    await project();
    await plannedFeature("demo", ["none — test fixture"]);
    const metaFile = join(feature("demo").dir, ".kfw.json");
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    writeFileSync(metaFile, JSON.stringify({ ...meta, approval: { status: "approved", livingDocs: "yes" } }));
    expect(() => readFeatureMeta(feature("demo").dir)).toThrow(/Invalid feature metadata/);
  });
});

describe("review report docs keys", () => {
  it("refuses a PASS report without docs: on an item approved on this version", async () => {
    await project();
    await featureInReview("demo");
    await reviewReport("demo", "PASS", "");
    const res = await validate("demo");
    expect(res.code).toBe(1);
    const found = withCode(res.issues, "docs_key_missing");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");
    expect(found[0].file).toBe(ARTIFACTS["review-report"].file);
  });

  it.each([
    ["an empty docs_reason", 'docs: none\ndocs_reason: ""\n'],
    ["a whitespace-only docs_reason", 'docs: none\ndocs_reason: "   "\n'],
    ["no docs_reason", "docs: none\n"],
  ])("refuses docs: none with %s", async (_label, extra) => {
    await project();
    await featureInReview("demo");
    await reviewReport("demo", "PASS", extra);
    const res = await validate("demo");
    expect(res.code).toBe(1);
    expect(withCode(res.issues, "docs_reason_missing").map((i) => i.severity)).toEqual(["ERROR"]);
  });

  it("raises no docs finding for docs: none with a reason", async () => {
    await project();
    await featureInReview("demo");
    await reviewReport("demo", "PASS", "docs: none\ndocs_reason: internal refactor only\n");
    const res = await validate("demo");
    expect(docsFindings(res.issues)).toEqual([]);
    expect(res.valid).toBe(true);
  });
});

describe("review report git rules", () => {
  it("requires a docs/specs change on the item branch for docs: updated, then passes once it is committed", async () => {
    await project({ worktree: true });
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    const wt = checkout("demo");
    expect(wt).not.toBe(root);
    await reviewReport("demo", "PASS", "docs: updated\n");

    const before = await validate("demo");
    expect(before.code).toBe(1);
    expect(withCode(before.issues, "docs_updated_no_change").map((i) => i.severity)).toEqual(["ERROR"]);

    writeAt(wt, "docs/specs/cli/x.md", livingDoc());
    writeAt(wt, "docs/specs/cli/README.md", index(["x.md"]));
    commitAll(wt, "docs: x capability");
    const after = await validate("demo");
    expect(docsErrors(after.issues)).toEqual([]);
    expect(after.valid).toBe(true);
  });

  it("does not count docs/specs edits that landed on the base branch after the item branched", async () => {
    await project();
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    await reviewReport("demo", "PASS", "docs: updated\n");

    const other = join(scratch, "other");
    execFileSync("git", ["clone", "-q", join(scratch, "origin.git"), other], { stdio: "pipe" });
    sh(other, "config", "user.email", "o@o");
    sh(other, "config", "user.name", "o");
    sh(other, "config", "commit.gpgsign", "false");
    writeAt(other, "docs/specs/cli/y.md", livingDoc());
    writeAt(other, "docs/specs/cli/README.md", index(["y.md"]));
    commitAll(other, "docs: someone else's capability");
    sh(other, "push", "-q", "origin", "main");
    sh(root, "fetch", "-q", "origin");

    const res = await validate("demo");
    expect(res.code).toBe(1);
    expect(withCode(res.issues, "docs_updated_no_change").map((i) => i.severity)).toEqual(["ERROR"]);
  });

  it("diffs committed refs only in the main checkout when worktrees are disabled", async () => {
    await project({ worktree: false });
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    expect(checkout("demo")).toBe(root);
    await reviewReport("demo", "PASS", "docs: updated\n");

    writeAt(root, "docs/specs/cli/x.md", livingDoc());
    writeAt(root, "docs/specs/cli/README.md", index(["x.md"]));
    const uncommitted = await validate("demo");
    expect(uncommitted.code).toBe(1);
    expect(withCode(uncommitted.issues, "docs_updated_no_change").map((i) => i.severity)).toEqual(["ERROR"]);

    commitAll(root, "docs: x capability");
    const committed = await validate("demo");
    expect(docsErrors(committed.issues)).toEqual([]);
    expect(committed.valid).toBe(true);
  });

  it("refuses a capability the context index does not link, until the link is added", async () => {
    await project({ base: { "docs/specs/cli/README.md": index([]) } });
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    await reviewReport("demo", "PASS", "docs: updated\n");
    writeAt(root, "docs/specs/cli/x.md", livingDoc());
    commitAll(root, "docs: x capability");

    const unlinked = await validate("demo");
    expect(unlinked.code).toBe(1);
    const found = withCode(unlinked.issues, "docs_index_missing_entry");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");
    expect(found[0].file).toBe("docs/specs/cli/x.md");

    writeAt(root, "docs/specs/cli/README.md", index(["x.md"]));
    commitAll(root, "docs: link x");
    const linked = await validate("demo");
    expect(docsErrors(linked.issues)).toEqual([]);
    expect(linked.valid).toBe(true);
  });

  it("refuses a bug that creates a living doc, and accepts a bug that waives or only edits an index", async () => {
    await project({ base: { "docs/specs/cli/README.md": index([]) } });
    await bugInReview("buggy");
    await reviewReport("buggy", "PASS", "docs: updated\n");

    writeAt(root, "docs/specs/cli/new.md", livingDoc());
    writeAt(root, "docs/specs/cli/README.md", index(["new.md"]));
    commitAll(root, "docs: new capability from a bug");
    const created = await validate("buggy");
    expect(created.code).toBe(1);
    const found = withCode(created.issues, "docs_bug_new_spec");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");

    rmSync(join(root, "docs/specs/cli/new.md"));
    writeAt(root, "docs/specs/cli/README.md", index([]));
    commitAll(root, "docs: drop the new capability");
    await reviewReport("buggy", "PASS", "docs: none\ndocs_reason: the fix changes no documented behaviour\n");
    const waived = await validate("buggy");
    expect(docsErrors(waived.issues)).toEqual([]);
    expect(waived.valid).toBe(true);

    writeAt(root, "docs/specs/cli/README.md", `${index([])}\nOne more line about the context.\n`);
    commitAll(root, "docs: edit the index");
    await reviewReport("buggy", "PASS", "docs: updated\n");
    const indexOnly = await validate("buggy");
    expect(codes(indexOnly.issues)).not.toContain("docs_bug_new_spec");
    expect(docsErrors(indexOnly.issues)).toEqual([]);
  });

  it("refuses a declared consolidation while a file of the legacy feature is left, then passes once all are removed and named", async () => {
    await project({
      base: {
        "docs/specs/cli/README.md": index([]),
        "docs/requirement/cli/foo.md": "# foo requirement\n",
        "docs/use-cases/cli/foo/README.md": "# foo use cases\n",
        "docs/testplan/cli/foo.md": "# foo test plan\n",
      },
    });
    await featureInReview("demo", ["docs/specs/cli/x.md", "consolidates: cli/foo"]);
    await reviewReport("demo", "PASS", "docs: updated\n");

    writeAt(root, "docs/specs/cli/x.md", livingDoc("- Consolidated cli/foo into this capability"));
    writeAt(root, "docs/specs/cli/README.md", index(["x.md"]));
    rmSync(join(root, "docs/requirement/cli/foo.md"));
    rmSync(join(root, "docs/use-cases/cli/foo"), { recursive: true });
    commitAll(root, "docs: consolidate foo, partly");
    const partial = await validate("demo");
    expect(partial.code).toBe(1);
    expect(withCode(partial.issues, "docs_consolidation_incomplete").map((i) => i.severity)).toEqual(["ERROR"]);

    rmSync(join(root, "docs/testplan/cli/foo.md"));
    commitAll(root, "docs: consolidate foo, rest");
    const complete = await validate("demo");
    expect(docsErrors(complete.issues)).toEqual([]);
    expect(complete.valid).toBe(true);
  });

  it("reports a failing git lookup for docs: updated as an ERROR carrying git's error", async () => {
    await project({ worktree: true });
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    await reviewReport("demo", "PASS", "docs: updated\n");
    const plain = join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    await updateFeatureMeta(root, "demo", (meta) => ({ ...meta, worktree: { ...meta.worktree!, path: plain } }));

    const res = await validate("demo");
    expect(res.code).toBe(1);
    expect(res.valid).toBe(false);
    const found = withCode(res.issues, "docs_git_failed");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("ERROR");
    expect(found[0].message).toMatch(/not a git repository/i);
  });

  it("refuses docs: updated when origin/HEAD is unset, because the change cannot be proven", async () => {
    await project({ origin: false });
    await featureInReview("demo", ["docs/specs/cli/x.md"]);
    await reviewReport("demo", "PASS", "docs: updated\n");
    writeAt(root, "docs/specs/cli/x.md", livingDoc());
    writeAt(root, "docs/specs/cli/README.md", index(["x.md"]));
    commitAll(root, "docs: x capability");

    const res = await validate("demo");
    expect(res.code).toBe(1);
    expect(withCode(res.issues, "docs_git_failed").map((i) => i.severity)).toEqual(["ERROR"]);
  });

  it("only warns that the base is unresolved for a docs: none waiver when origin/HEAD is unset", async () => {
    await project({ origin: false });
    await featureInReview("demo");
    await reviewReport("demo", "PASS", "docs: none\ndocs_reason: internal refactor only\n");

    const res = await validate("demo");
    expect(withCode(res.issues, "docs_base_unresolved").map((i) => i.severity)).toEqual(["WARNING"]);
    expect(res.issues.filter((i) => i.severity === "ERROR")).toEqual([]);
    expect(res.code).toBe(0);
  });
});

describe("items the docs rules leave alone", () => {
  it("lets a legacy item with a FAIL report loop back without any docs finding when origin/HEAD is unset", async () => {
    await project({ origin: false });
    await featureInReview("demo");
    await dropMarker("demo");
    await reviewReport("demo", "FAIL", "");

    const res = await validate("demo");
    expect(codes(res.issues)).not.toContain("docs_git_failed");
    expect(codes(res.issues)).not.toContain("docs_base_unresolved");
    expect(docsFindings(res.issues)).toEqual([]);

    const back = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(back.code, back.stdout).toBe(0);
    expect(feature("demo").stage).toBe("implementation");
  });

  it("gives a legacy PASS item in review no docs finding", async () => {
    await project();
    await featureInReview("demo");
    await dropMarker("demo");
    await reviewReport("demo", "PASS", "");
    expect(docsFindings((await validate("demo")).issues)).toEqual([]);
  });

  it("gives a cancelled item no docs finding", async () => {
    await project();
    await plannedFeature("demo", null);
    const cancelled = await cmdCancel(args("cancel", ["demo"], { reason: "superseded by another item" }), root);
    expect(cancelled.code, cancelled.stdout).toBe(0);
    expect(feature("demo").stage).toBe("cancelled");
    expect(docsFindings(validateFeature(feature("demo")).issues)).toEqual([]);
  });

  it("gives a done legacy item no docs finding", async () => {
    await project({ git: false });
    await featureInReview("demo");
    await dropMarker("demo");
    await reviewReport("demo", "PASS", "");
    await writeFile(join(feature("demo").dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
    const archived = await cmdArchive(args("archive", ["demo"]), root);
    expect(archived.code, archived.stdout).toBe(0);
    expect(feature("demo").stage).toBe("done");
    expect(docsFindings(validateFeature(feature("demo")).issues)).toEqual([]);
  });
});

describe("closing an item approved on this version", () => {
  const PR = "https://github.com/o/r/pull/9";

  /** `gh` reporting every PR as merged, so archive reaches its gates. */
  async function mergedPrGh(): Promise<void> {
    const bin = join(scratch, "stubbin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "gh"), `#!/usr/bin/env bash
case "$1" in
  pr) if [ "$2" = view ]; then printf '{"state":"MERGED","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n'; fi; exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${prevPath}`;
  }

  it.each([
    ["without docs:", "", "docs_key_missing"],
    ["with docs: none and a blank docs_reason", 'docs: none\ndocs_reason: "  "\n', "docs_reason_missing"],
  ])("kf archive refuses a merged PASS report %s at the review to done gate", async (_label, extra, code) => {
    await project({ git: false, repository: "o/r" });
    await mergedPrGh();
    await featureInReview("demo");
    await updateFeatureMeta(root, "demo", (meta) => ({ ...meta, pr: PR }));
    await reviewReport("demo", "PASS", extra, "pr");
    await writeFile(join(feature("demo").dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");

    const gate = checkDirectionGate(feature("demo"), "done", true);
    expect(gate.filter((i) => i.code === code).map((i) => i.severity)).toEqual(["ERROR"]);

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(code);
    expect(feature("demo").stage).toBe("review");
  });

  it("kf archive closes a merged PASS report that waives the docs with a reason", async () => {
    await project({ git: false, repository: "o/r" });
    await mergedPrGh();
    await featureInReview("demo");
    await updateFeatureMeta(root, "demo", (meta) => ({ ...meta, pr: PR }));
    await reviewReport("demo", "PASS", REVIEW_DOCS_NONE, "pr");
    await writeFile(join(feature("demo").dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");

    expect(checkDirectionGate(feature("demo"), "done", true)).toEqual([]);
    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature("demo").stage).toBe("done");
  });
});

describe("plan check edge cases", () => {
  it("reports an unreadable project config as one docs finding, and kf status still answers", async () => {
    await project();
    await plannedFeature("demo", ["docs/specs/cli/x.md"]);
    // An empty contexts list is refused by the config parser, so the declared contexts cannot be read.
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", contexts: [], worktree: { enabled: false },
    }));

    const found = docsFindings(validateFeature(feature("demo"), false, false).issues);
    expect(found.map((i) => [i.code, i.severity])).toEqual([["docs_config_invalid", "ERROR"]]);

    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.stdout).toContain("demo");
  });

  it.each(["implementation", "review"] as const)(
    "does not ask a legacy item in %s for a Documentation Impact section",
    async (stage) => {
      await project();
      await plannedFeature("demo", ["none — test fixture"]);
      expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
      await dropMarker("demo");
      if (stage === "review") await implementationToReview("demo");
      expect(feature("demo").stage).toBe(stage);
      // A plan written before living docs existed: no Documentation Impact section at all.
      await writeFile(join(feature("demo").dir, ARTIFACTS["implementation-plan"].file), "# Contract\nUC-001: Create a task\n");

      const res = await validate("demo");
      expect(docsFindings(res.issues)).toEqual([]);
    },
  );
});
