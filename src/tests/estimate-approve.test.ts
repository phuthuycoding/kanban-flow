import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact } from "./helpers/contract.js";
import { foldItemLog, itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { checkItemLogs } from "../project/doctor-item-log.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus, cmdValidate } from "../cli/commands/inspect.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

/*
 * The contract estimate travels with the approval: `kf approve` records it in `.kfw.json` and in the `approved`
 * record, and a planning item whose estimate is missing or XL is told so by validate, status and approve,
 * without the approval ever being refused for it.
 */

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name = "demo") => findFeature(root, name)!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const PLAN_FILE = ARTIFACTS["implementation-plan"].file;
const HEADER = "date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin";

type Rec = Record<string, unknown> & { event: string; set?: Record<string, unknown>; derived?: true };
interface Notice { code: string; file: string; message: string }

const logLines = (name = "demo"): Rec[] => {
  const path = itemLogPath(feature(name).dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Rec);
};
const approvedRecords = (name = "demo"): Rec[] => logLines(name).filter((r) => r.event === "approved");
const snapshot = (name = "demo"): Record<string, unknown> =>
  JSON.parse(readFileSync(join(feature(name).dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
const expectFoldEqualsSnapshot = (name = "demo"): void => {
  const folded = readItemLog(feature(name).dir);
  expect(folded.ok).toBe(true);
  if (!folded.ok) return;
  expect(folded.state).toEqual({ stage: feature(name).stage, meta: sharedMeta(snapshot(name)) });
};

/** A plan with an optional `## Estimate` line and one Task Breakdown row per Files cell. */
function planText(estimate: string | null, filesCells: string[] = ["`src/a.ts`, `src/b.ts`", "`src/c.ts`, `src/d.ts`"]): string {
  const rows = filesCells.map((cell, i) => `| TASK-00${i + 1} | Step ${i + 1} | - | Done | FR-001 / UC-001 | ${cell} |`);
  return withDocsImpact([
    "# Contract",
    "UC-001: Create a task",
    "",
    ...(estimate === null ? [] : ["## Estimate", "", estimate, ""]),
    "## Task Breakdown",
    "",
    "| Task | Description | Dependencies | Expected output | FR / UC references | Files |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n"));
}

/** `name` in planning with a complete contract whose plan is `plan`: the only thing left is `kf approve`. */
async function plannedItem(name: string, plan: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, PLAN_FILE), plan);
  for (const id of ["use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

async function statusJson(name = "demo"): Promise<{ notices: Notice[]; blockers: unknown[] }> {
  const res = await cmdStatus(args("status", [], { change: name, json: true }), root);
  expect(res.code, res.stdout).toBe(0);
  return JSON.parse(res.stdout) as { notices: Notice[]; blockers: unknown[] };
}

/** The ERROR and WARNING codes `kf validate --json` reports for the item. */
async function validateCodes(name: string): Promise<{ errors: string[]; warnings: string[] }> {
  const res = await cmdValidate(args("validate", [], { change: name, json: true }), root);
  const [entry] = JSON.parse(res.stdout) as Array<{ issues: Array<{ severity: string; code: string }> }>;
  const codes = (severity: string): string[] => entry.issues.filter((i) => i.severity === severity).map((i) => i.code).sort();
  return { errors: codes("ERROR"), warnings: codes("WARNING") };
}

async function failingHook(stage: string): Promise<void> {
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  const hook = join(root, ".kf", "hooks", `${stage}.sh`);
  await writeFile(hook, "#!/bin/sh\necho 'gate is red'\nexit 1\n");
  await chmod(hook, 0o755);
}

async function legacyLedger(text: string): Promise<void> {
  await mkdir(join(root, ".kf", "travel"), { recursive: true });
  await writeFile(join(root, ".kf", "travel", "estimates.md"), text);
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-estimate-approve-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("a planning item without a usable estimate", () => {
  it("warns estimate_missing on the plan in validate, as a warning and never an error", async () => {
    await plannedItem("demo", planText(null));

    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).toMatch(new RegExp(`\\[WARNING\\] ${PLAN_FILE.replace(/\./g, "\\.")}: .+\\(estimate_missing\\)`));
    // An unapproved planning item already fails validate on the approval gate alone; the estimate adds no error.
    expect(await validateCodes("demo")).toEqual({ errors: ["approval_required"], warnings: ["estimate_missing"] });
  });

  it("warns estimate_missing when the Estimate section holds no number", async () => {
    await plannedItem("demo", planText("- Agent minutes: soon"));

    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).toMatch(/\[WARNING\] .+\(estimate_missing\)/);
    expect(await validateCodes("demo")).toEqual({ errors: ["approval_required"], warnings: ["estimate_missing"] });
  });

  it("lists the notice in status text and JSON while the blockers stay empty", async () => {
    await plannedItem("demo", planText(null));

    const json = await statusJson();
    expect(json.blockers).toEqual([]);
    expect(json.notices).toEqual([{ code: "estimate_missing", file: PLAN_FILE, message: expect.any(String) }]);
    const message = json.notices[0].message;
    expect(message.trim()).not.toBe("");

    const text = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("Notices");
    expect(text.stdout).toContain(message);
    expect(text.stdout.indexOf("Notices")).toBeLessThan(text.stdout.indexOf(message));
  });

  it("kf approve prints the notice and still moves the item to implementation", async () => {
    await plannedItem("demo", planText(null));
    const message = (await statusJson()).notices.find((n) => n.code === "estimate_missing")?.message;
    expect(message).toBeDefined();

    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(message!);
    expect(feature().stage).toBe("implementation");
  });

  it("raises no estimate_missing once the item has left planning", async () => {
    await plannedItem("demo", planText(null));
    expect((await statusJson()).notices.map((n) => n.code)).toContain("estimate_missing");
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    expect(feature().stage).toBe("implementation");

    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).not.toContain("estimate_missing");
    expect((await statusJson()).notices.map((n) => n.code)).not.toContain("estimate_missing");
  });
});

describe("a planning item whose estimate sizes XL", () => {
  it("warns estimate_should_split naming the minutes and files, and approve prints it and still moves the item", async () => {
    await plannedItem("demo", planText("- Agent minutes: 90"));

    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).toMatch(/\[WARNING\] .+\(estimate_should_split\)/);
    expect(await validateCodes("demo")).toEqual({ errors: ["approval_required"], warnings: ["estimate_should_split"] });

    const notice = (await statusJson()).notices.find((n) => n.code === "estimate_should_split");
    expect(notice).toBeDefined();
    expect(notice!.message).toMatch(/90 min/);
    expect(notice!.message).toMatch(/4 files/);
    expect(notice!.message).toMatch(/XL/);

    const text = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(text.stdout).toContain("Notices");
    expect(text.stdout).toContain(notice!.message);

    const approve = await cmdApprove(args("approve", ["demo"]), root);
    expect(approve.code, approve.stdout).toBe(0);
    expect(approve.stdout).toContain(notice!.message);
    expect(feature().stage).toBe("implementation");
    expect(snapshot().estimate).toMatchObject({ minutes: 90, files: 4, filesMark: "exact", size: "XL" });
  });
});

describe("kf approve records the estimate", () => {
  it("sets the estimate in .kfw.json and in the approved record", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));

    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);

    const estimate = snapshot().estimate as Record<string, unknown>;
    // 30 minutes sizes L, 4 files size M: the higher wins. No history means factor 1.
    expect(estimate).toEqual({ minutes: 30, files: 4, filesMark: "exact", size: "L", factor: 1, at: expect.any(String) });
    const approved = approvedRecords();
    expect(approved).toHaveLength(1);
    expect(approved[0].set?.estimate).toEqual(estimate);
    expectFoldEqualsSnapshot();
  });

  it("appends a second estimate on re-approval and the fold keeps the latest", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, PLAN_FILE), planText("- Agent minutes: 45"));

    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);

    const approved = approvedRecords();
    expect(approved.map((r) => (r.set?.estimate as { minutes?: unknown } | undefined)?.minutes)).toEqual([30, 45]);
    const folded = readItemLog(feature().dir);
    expect(folded.ok).toBe(true);
    if (!folded.ok) return;
    expect(folded.state?.meta).toMatchObject({ estimate: { minutes: 45, files: 4, filesMark: "exact", size: "L", factor: 1 } });
    expect(snapshot().estimate).toMatchObject({ minutes: 45 });
  });

  it("records none with a reason when the plan has no estimate", async () => {
    await plannedItem("demo", planText(null));

    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);

    const estimate = snapshot().estimate as Record<string, unknown>;
    expect(estimate).toEqual({ none: true, reason: expect.any(String), at: expect.any(String) });
    expect(String(estimate.reason).trim()).not.toBe("");
    expect(approvedRecords()[0].set?.estimate).toEqual(estimate);
  });

  it("sizes from the minutes times the learned factor and records that factor", async () => {
    // 20 measured feature rows whose work is twice their estmin: the learned factor is 2.
    const rows = Array.from({ length: 20 }, (_, i) =>
      ["2026-10-02", `r${i}`, "demo", "feature", "M", "M", "20", "0", "4", "1", "implementation→review", "T1", "0", "10"].join(" · "));
    await legacyLedger(`# Travel estimates\n\n${HEADER}\n${rows.join("\n")}\n`);
    await plannedItem("demo", planText("- Agent minutes: 15", ["`src/a.ts`"]));

    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);

    // 15 min alone sizes M; × 2 = 30 min sizes L.
    expect(snapshot().estimate).toMatchObject({ minutes: 15, files: 1, filesMark: "exact", size: "L", factor: 2 });
  });

  it("records a bug report's estimate with the file count unknown and the size from the minutes", async () => {
    const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n\n## Estimate\n\n- Agent minutes: 15\n";
    expect((await cmdNew(args("new", ["buggy"], { context: "app", type: "bug" }), root)).code).toBe(0);
    await writeFile(join(feature("buggy").dir, ARTIFACTS["spec-requirement"].file), bugSpec);
    expect((await cmdStage(args("stage", ["buggy", "planning"]), root)).code).toBe(0);

    const res = await cmdApprove(args("approve", ["buggy"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature("buggy").stage).toBe("implementation");

    const estimate = snapshot("buggy").estimate as Record<string, unknown>;
    expect(estimate).toEqual({ minutes: 15, files: null, filesMark: "unknown", size: "M", factor: 1, at: expect.any(String) });
    expect(approvedRecords("buggy")[0].set?.estimate).toEqual(estimate);
  });
});

describe("a malformed legacy estimates history", () => {
  it("does not stop the approval: factor 1 is used and the notice names the bad line", async () => {
    await legacyLedger(`# Travel estimates\n\n${HEADER}\n2026-10-01 · a · demo · feature · M\n`);
    await plannedItem("demo", planText("- Agent minutes: 30"));

    const res = await cmdApprove(args("approve", ["demo"]), root);

    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("implementation");
    expect(res.stdout).toContain("estimates.md:4");
    expect(res.stdout).toContain("factor 1 used");
    expect(snapshot().estimate).toMatchObject({ minutes: 30, factor: 1 });
  });
});

describe("a measurement the release cannot read", () => {
  it("is dropped from the item's metadata and never makes the item unreadable", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));
    const metaPath = join(feature().dir, ".kfw.json");
    const raw = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    await writeFile(metaPath, JSON.stringify({ ...raw, estimate: { size: "XXL" }, filesChanged: { count: "seven" } }));

    const found = feature();
    expect(found.metaError).toBeUndefined();
    expect(found.meta).toBeDefined();
    expect(found.meta!.feature).toBe("demo");
    expect(Object.hasOwn(found.meta!, "estimate")).toBe(false);
    expect(Object.hasOwn(found.meta!, "filesChanged")).toBe(false);

    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.code, status.stdout).toBe(0);

    const codes = await validateCodes("demo");
    expect(codes.errors).not.toContain("metadata_invalid");
    expect(codes.errors).not.toContain("metadata_missing");
  });
});

describe("a malformed history with an estimate in the contract", () => {
  it("is a status notice and never a validator warning", async () => {
    await legacyLedger(`# Travel estimates\n\n${HEADER}\n2026-10-01 · a · demo · feature · M\n`);
    await plannedItem("demo", planText("- Agent minutes: 30"));

    // The unapproved planning item still fails strict validate on the approval gate alone; the history adds nothing.
    const strict = await cmdValidate(args("validate", [], { change: "demo", strict: true, json: true }), root);
    const [entry] = JSON.parse(strict.stdout) as Array<{ issues: Array<{ severity: string; code: string }> }>;
    expect(entry.issues.map((i) => i.code)).toEqual(["approval_required"]);
    expect(strict.stdout).not.toContain("estimate_history");

    const json = await statusJson();
    expect(json.notices).toContainEqual({ code: "estimate_history", file: expect.any(String), message: expect.stringContaining("estimates.md:4") });
    expect(json.blockers).toEqual([]);
  });
});

describe("a refused move puts the previous estimate back", () => {
  it("leaves no estimate when the first approval's move is refused", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));
    await failingHook("implementation");

    const res = await cmdApprove(args("approve", ["demo"]), root);

    expect(res.code).toBe(1);
    expect(feature().stage).toBe("planning");
    // The approved record carried the estimate; the restore removed it again.
    expect(approvedRecords()[0].set?.estimate).toMatchObject({ minutes: 30 });
    expect(Object.hasOwn(snapshot(), "estimate")).toBe(false);
    expectFoldEqualsSnapshot();
  });

  it("restores the earlier estimate when a re-approval's move is refused", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    const first = snapshot().estimate;
    expect(first).toMatchObject({ minutes: 30 });
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, PLAN_FILE), planText("- Agent minutes: 45"));
    await failingHook("implementation");

    const res = await cmdApprove(args("approve", ["demo"]), root);

    expect(res.code).toBe(1);
    expect(feature().stage).toBe("planning");
    expect(snapshot().estimate).toEqual(first);
    expectFoldEqualsSnapshot();
  });
});

describe("the lifecycle log carries the estimate and the files changed", () => {
  const BASE = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
  const HEAD = '"v":1,"at":"2026-11-13T05:00:00.000Z","actor":"t","origin":{"machine":"m","via":"cli"}';
  const ESTIMATE = { minutes: 30, files: 4, filesMark: "exact", size: "L", factor: 1, at: "2026-11-13T05:00:00.000Z" };
  const FILES_CHANGED = { count: 7, at: "2026-11-13T06:00:00.000Z" };

  it("keeps both keys in the fold", () => {
    const log = [
      `{${HEAD},"event":"created","stage":"planning","set":${JSON.stringify(BASE)}}`,
      `{${HEAD},"event":"approved","stage":"implementation","set":${JSON.stringify({ estimate: ESTIMATE })}}`,
      `{${HEAD},"event":"stage","stage":"review","set":${JSON.stringify({ filesChanged: FILES_CHANGED })}}`,
    ].join("\n") + "\n";

    const result = foldItemLog(log);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual({ stage: "review", meta: { ...BASE, estimate: ESTIMATE, filesChanged: FILES_CHANGED } });
  });

  it("leaves doctor nothing to report on the log of an approved item with an estimate", async () => {
    await plannedItem("demo", planText("- Agent minutes: 30"));
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    expect(snapshot().estimate).toMatchObject({ minutes: 30 });

    expect(checkItemLogs(root)).toEqual([]);
    expectFoldEqualsSnapshot();
  });
});

describe("the contract templates", () => {
  it.each(["phase-2-implementation-plan.md", "phase-1-bug-report.md"])("%s asks for the agent minutes in an Estimate section", (template) => {
    const text = readFileSync(join(PKG_ROOT, "assets", "templates", template), "utf8");
    const start = text.search(/^## Estimate\s*$/m);
    expect(start, "no ## Estimate heading").not.toBe(-1);
    const rest = text.slice(start).split("\n").slice(1).join("\n");
    const next = rest.search(/^## /m);
    const section = next === -1 ? rest : rest.slice(0, next);
    expect(section).toMatch(/^- Agent minutes: \{estimate_minutes\}\s*$/m);
  });
});
