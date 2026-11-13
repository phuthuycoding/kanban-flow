import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, executionContractHash, findFeature, readFeatureMeta, updateFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact, REVIEW_DOCS_NONE } from "./helpers/contract.js";
import { grantStageWaiver } from "./support/stage-waiver.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { cancelItem } from "../workflow/cancel.js";
import { prepareCanonicalCopies, writeCanonicalCopies } from "../workflow/canonical-docs.js";
import * as paths from "../shared/paths.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdList, cmdStatus } from "../cli/commands/inspect.js";
import type { ParsedArgs } from "../cli/args.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let scratch: string;
let root: string;
let stderrWrites: string[];
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name = "demo") => findFeature(root, name)!;
const confirmed = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

type Rec = Record<string, unknown> & { event: string; from?: string; stage?: string; set?: Record<string, unknown>; unset?: string[]; derived?: true };

/** The log's exact bytes as text, or null when the item has no log file. */
const rawLog = (name = "demo"): string | null => {
  const path = itemLogPath(feature(name).dir);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};
const logLines = (name = "demo"): Rec[] => (rawLog(name) ?? "").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Rec);
/** Every record a command appended after the first `before` ones. */
const appendedAfter = (before: number, name = "demo"): Rec[] => logLines(name).slice(before);
/** The same without the derived catch-up records (`opened`, `reconciled`). */
const eventsAfter = (before: number, name = "demo"): Rec[] => appendedAfter(before, name).filter((r) => r.derived !== true);
const snapshot = (name = "demo"): Record<string, unknown> => JSON.parse(readFileSync(join(feature(name).dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
const expectFoldEqualsSnapshot = (name = "demo"): void => {
  const folded = readItemLog(feature(name).dir);
  expect(folded.ok).toBe(true);
  if (!folded.ok) return;
  expect(folded.state).toEqual({ stage: feature(name).stage, meta: sharedMeta(snapshot(name)) });
};
const warnings = (): string[] => stderrWrites.filter((w) => w.includes("lifecycle log not written"));

async function configure(): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261113_0409", defaultContext: "cli",
    worktree: { enabled: false },
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
    },
  }));
}

/** `name` in planning with a complete contract: the only thing left is `kf approve`. */
async function plannedItem(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), confirmed);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

async function implementationItem(name: string): Promise<void> {
  await plannedItem(name);
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect(feature(name).stage).toBe("implementation");
}

async function testingItem(name: string): Promise<void> {
  await implementationItem(name);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
}

async function report(name: string, id: "testing-result" | "review-report", status = "PASS"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: ${status}\nexecution: ${execution}\n${id === "review-report" ? "ci: none\nlanding: none\n" + REVIEW_DOCS_NONE : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/** A review PASS item with no PR and no worktree: ready to close. */
async function reviewItem(name: string): Promise<void> {
  await testingItem(name);
  await report(name, "testing-result");
  await grantStageWaiver(root, name);
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report(name, "review-report");
  await writeFile(join(feature(name).dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
}

/** Make `name` look like an item written by an earlier release: no id in `.kfw.json`, no log. */
async function makeLegacy(name: string): Promise<void> {
  const file = join(feature(name).dir, ".kfw.json");
  const { id: _dropped, ...withoutId } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify(withoutId, null, 2));
  await rm(itemLogPath(feature(name).dir), { force: true });
  expect(snapshot(name).id).toBeUndefined();
  expect(rawLog(name)).toBeNull();
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-itemlog-moves-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "Rita Reviewer");
  await writeFile(join(root, ".gitignore"), ".works/\n.kf/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await configure();
  stderrWrites = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

describe("a stage move", () => {
  it("appends one stage record from brainstorm to planning", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    const before = logLines().length;

    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);

    const appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("stage");
    expect(appended[0].from).toBe("brainstorm");
    expect(appended[0].stage).toBe("planning");
    expectFoldEqualsSnapshot();
  });

  it("records the new execution id when an approved item moves to testing", async () => {
    await implementationItem("demo");
    const before = logLines().length;

    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);

    const appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("stage");
    expect(appended[0].from).toBe("implementation");
    expect(appended[0].stage).toBe("testing");
    expect(String(snapshot().executionId)).toMatch(UUID);
    expect(appended[0].set?.executionId).toBe(snapshot().executionId);
    expectFoldEqualsSnapshot();
  });

  it("records a pending approval and the cleared execution id when an item goes back to planning", async () => {
    await testingItem("demo");
    const before = logLines().length;

    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);

    const appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("stage");
    expect(appended[0].from).toBe("testing");
    expect(appended[0].stage).toBe("planning");
    expect(appended[0].set?.approval).toEqual({ status: "pending" });
    expect(appended[0].unset).toContain("executionId");
    expectFoldEqualsSnapshot();
  });

  it("records the bypass of a forced move as the last entry of the bypasses it sets", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed.replace("confirmed", "draft"));
    const before = logLines().length;

    const res = await cmdStage(args("stage", ["demo", "planning"], { force: true }), root);

    expect(res.code, res.stdout).toBe(0);
    const appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("stage");
    const recorded = appended[0].set?.bypasses as Array<Record<string, unknown>>;
    const stored = snapshot().bypasses as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(recorded[recorded.length - 1]).toEqual(stored[stored.length - 1]);
    expect(recorded[recorded.length - 1]).toMatchObject({ from: "brainstorm", to: "planning", flag: "force" });
    expectFoldEqualsSnapshot();
  });

  it("reconciles a hand edit of the metadata before the stage record", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    writeFileSync(join(feature().dir, ".kfw.json"), JSON.stringify({ ...snapshot(), goal: "edited by hand" }, null, 2));
    const before = logLines().length;

    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);

    const appended = appendedAfter(before);
    expect(appended.map((r) => r.event)).toEqual(["reconciled", "stage"]);
    expect(appended[0].set).toEqual({ goal: "edited by hand" });
    expect(appended[0].unset).toBeUndefined();
    expect(appended[0].derived).toBe(true);
    expect(appended[1].from).toBe("brainstorm");
    expect(appended[1].stage).toBe("planning");
    expectFoldEqualsSnapshot();
  });
});

describe("cancelling and reopening", () => {
  it("appends a cancelled record with the cancellation and status, then a stage record that clears them on reopen", async () => {
    await implementationItem("demo");
    let before = logLines().length;

    const cancelled = await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root);

    expect(cancelled.code, cancelled.stdout).toBe(0);
    let appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("cancelled");
    expect(appended[0].from).toBe("implementation");
    expect(appended[0].stage).toBe("cancelled");
    expect(appended[0].set?.cancellation).toEqual(snapshot().cancellation);
    expect(appended[0].set?.cancellation).toMatchObject({ reason: "x", fromStage: "implementation" });
    expect(appended[0].set?.status).toBe("cancelled");
    expectFoldEqualsSnapshot();

    before = logLines().length;
    const reopened = await cmdStage(args("stage", ["demo", "implementation"]), root);

    expect(reopened.code, reopened.stdout).toBe(0);
    appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("stage");
    expect(appended[0].from).toBe("cancelled");
    expect(appended[0].stage).toBe("implementation");
    expect(appended[0].unset).toEqual(expect.arrayContaining(["cancellation", "status"]));
    expectFoldEqualsSnapshot();
  });
});

describe("a refusal or a rolled-back move", () => {
  it("leaves the log byte-identical when the gate refuses a stage move", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed.replace("confirmed", "draft"));
    const bytes = rawLog();

    const res = await cmdStage(args("stage", ["demo", "planning"]), root);

    expect(res.code).toBe(1);
    expect(res.stderr).toBe("gate failed");
    expect(feature().stage).toBe("brainstorm");
    expect(rawLog()).toBe(bytes);
  });

  it("leaves the log byte-identical when a stage move finds its target taken", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    await writeFile(join(root, ".works", "planning", feature().folder), "in the way");
    const bytes = rawLog();

    const res = await cmdStage(args("stage", ["demo", "planning"]), root);

    expect(res.code).toBe(1);
    expect(res.stderr).toBe("target exists");
    expect(feature().stage).toBe("brainstorm");
    expect(rawLog()).toBe(bytes);
  });

  it("leaves the log byte-identical and rolls the metadata back when a stage move fails after the metadata was written", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    // A file where the destination stage directory should be: the move throws after the metadata write.
    await rm(join(root, ".works", "planning"), { recursive: true });
    await writeFile(join(root, ".works", "planning"), "not a directory");
    const bytes = rawLog();
    const metaBefore = snapshot();

    await expect(cmdStage(args("stage", ["demo", "planning"]), root)).rejects.toThrow(/EEXIST/);

    expect(feature().stage).toBe("brainstorm");
    expect(rawLog()).toBe(bytes);
    expect(snapshot()).toEqual(metaBefore);
  });

  it("leaves the log byte-identical when a cancel is refused", async () => {
    await implementationItem("demo");
    expect((await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root)).code).toBe(0);
    const bytes = rawLog();

    const res = await cmdCancel(args("cancel", ["demo"], { reason: "again" }), root);

    expect(res.code).toBe(1);
    expect(res.stderr).toBe("already cancelled");
    expect(rawLog()).toBe(bytes);
  });

  it("leaves the log byte-identical and rolls the metadata back when the cancel's rename fails", async () => {
    await implementationItem("demo");
    await writeFile(join(root, ".works", "cancelled", feature().folder), "in the way");
    const bytes = rawLog();
    const metaBefore = snapshot();

    const outcome = await cancelItem(root, "demo", { reason: "x" });

    expect(outcome.kind).toBe("error");
    expect(feature().stage).toBe("implementation");
    expect(rawLog()).toBe(bytes);
    expect(snapshot()).toEqual(metaBefore);
  });

  it("leaves the log byte-identical when a close is refused", async () => {
    await reviewItem("demo");
    await report("demo", "review-report", "FAIL");
    const bytes = rawLog();

    const res = await cmdArchive(args("archive", ["demo"]), root);

    expect(res.code).toBe(1);
    expect(feature().stage).toBe("review");
    expect(rawLog()).toBe(bytes);
  });

  it("leaves a metadata-less move without the id it would have stamped when the move fails", async () => {
    await plannedItem("demo");
    await updateFeatureMeta(root, "demo", (meta) => ({
      ...meta,
      approval: { status: "approved", by: "human", at: "20261113_0409", contractHash: executionContractHash(feature().dir) ?? "", livingDocs: true },
    }));
    await makeLegacy("demo");
    await rm(join(root, ".works", "backlog"), { recursive: true });
    await writeFile(join(root, ".works", "backlog"), "not a directory");
    const metaBefore = snapshot();

    await expect(cmdStage(args("stage", ["demo", "backlog"]), root)).rejects.toThrow(/EEXIST/);

    expect(feature().stage).toBe("planning");
    expect(snapshot()).toEqual(metaBefore);
    expect(snapshot().id).toBeUndefined();
    expect(rawLog()).toBeNull();
  });

  it("leaves a cancelled-to-be item without the id it would have stamped when the cancel's rename fails", async () => {
    await implementationItem("demo");
    await makeLegacy("demo");
    await writeFile(join(root, ".works", "cancelled", feature().folder), "in the way");
    const metaBefore = snapshot();

    const outcome = await cancelItem(root, "demo", { reason: "x" });

    expect(outcome.kind).toBe("error");
    expect(snapshot()).toEqual(metaBefore);
    expect(snapshot().id).toBeUndefined();
    expect(rawLog()).toBeNull();
  });
});

describe("a close", () => {
  it("appends a delivered record from review to done carrying the delivery", async () => {
    await reviewItem("demo");
    const before = logLines().length;

    const res = await cmdArchive(args("archive", ["demo"]), root);

    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    const appended = appendedAfter(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("delivered");
    expect(appended[0].from).toBe("review");
    expect(appended[0].stage).toBe("done");
    expect(appended[0].set?.delivered).toBe(true);
    expect(typeof appended[0].set?.deliveredAt).toBe("string");
    expect(appended[0].set?.deliveredAt).toBe(snapshot().deliveredAt);
    expect(appended[0].set?.status).toBe("archived");
    expectFoldEqualsSnapshot();
  });

  it("restores the folder to review and leaves the log byte-identical when the delivered stamp fails", async () => {
    await reviewItem("demo");
    const bytes = rawLog();
    const writer = paths.writeFileAtomic;
    let failed = false;
    vi.spyOn(paths, "writeFileAtomic").mockImplementation(async (file, content) => {
      if (!failed && file.includes(join(".works", "done")) && file.endsWith(".kfw.json")) {
        failed = true;
        throw new Error("Simulated metadata write failure");
      }
      await writer(file, content);
    });

    await expect(cmdArchive(args("archive", ["demo"]), root)).rejects.toThrow("Simulated metadata write failure");

    expect(failed).toBe(true);
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
    expect(existsSync(join(root, ".works", "done", feature().folder))).toBe(false);
    expect(rawLog()).toBe(bytes);
  });

  it("appends a delivered record without a stage change when a done item lost its delivered flag", async () => {
    await reviewItem("demo");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    const { delivered: _removed, ...withoutFlag } = snapshot();
    writeFileSync(join(feature().dir, ".kfw.json"), JSON.stringify(withoutFlag, null, 2));
    const before = logLines().length;

    const res = await cmdArchive(args("archive", ["demo"]), root);

    expect(res.code, res.stdout).toBe(0);
    const events = eventsAfter(before);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("delivered");
    expect(events[0].set?.delivered).toBe(true);
    expect(events[0].from).toBeUndefined();
    expect(events[0].stage).toBeUndefined();
    expect(snapshot().delivered).toBe(true);
    expectFoldEqualsSnapshot();
  });

  it("leaves the log byte-identical when a done item has nothing to change", async () => {
    await reviewItem("demo");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    const bytes = rawLog();

    const res = await cmdArchive(args("archive", ["demo"]), root);

    expect(res.code, res.stdout).toBe(0);
    expect(rawLog()).toBe(bytes);
  });

  it("appends a docs record when the docs branch of a done item is proven landed", async () => {
    await reviewItem("demo");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    // A bare origin that already holds the item's canonical docs on its default branch.
    const origin = join(scratch, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", origin]);
    const base = git("symbolic-ref", "--short", "HEAD");
    git("remote", "add", "origin", origin);
    git("push", "-q", "-u", "origin", base);
    execFileSync("git", ["-C", origin, "symbolic-ref", "HEAD", `refs/heads/${base}`]);
    git("remote", "set-head", "origin", base);
    await writeCanonicalCopies(prepareCanonicalCopies(root, feature()));
    git("add", "-A");
    git("commit", "-qm", "docs");
    git("push", "-q", "origin", "HEAD");
    // A docs branch an earlier release recorded: gone here and on origin, its docs on the default branch.
    await writeFeatureMeta(feature().dir, { ...readFeatureMeta(feature().dir)!, docsBranch: "docs/app-demo" });
    const before = logLines().length;

    const res = await cmdStatus(args("status", [], { all: true }), root);

    expect(res.code, res.stdout).toBe(0);
    const meta = readFeatureMeta(feature().dir)!;
    expect(meta.docsBranch).toBeUndefined();
    expect(meta.docsLanded).toMatchObject({ branch: "docs/app-demo", by: "content" });
    const events = eventsAfter(before);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("docs");
    expect(events[0].set?.docsLanded).toEqual(meta.docsLanded);
    expect(events[0].unset).toContain("docsBranch");
    expectFoldEqualsSnapshot();
  }, 15_000);
});

describe("an item written by an earlier release", () => {
  it("lists as before, then gets opened with its earlier stage and a new id on its first move", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    await makeLegacy("demo");

    const listed = await cmdList(args("list"), root);
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("demo");
    expect(rawLog()).toBeNull();

    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);

    const lines = logLines();
    expect(lines.map((r) => r.event)).toEqual(["opened", "stage"]);
    expect(lines[0].stage).toBe("brainstorm");
    expect(String(lines[0].set?.id)).toMatch(UUID);
    expect(lines[0].derived).toBe(true);
    expect(lines[1].from).toBe("brainstorm");
    expect(lines[1].stage).toBe("planning");
    expect(snapshot().id).toBe(lines[0].set?.id);
    expectFoldEqualsSnapshot();
  });

  it("gets its id and an opened record on a move that writes no other metadata, and later moves add no reconciled record", async () => {
    await plannedItem("demo");
    await updateFeatureMeta(root, "demo", (meta) => ({
      ...meta,
      approval: { status: "approved", by: "human", at: "20261113_0409", contractHash: executionContractHash(feature().dir) ?? "", livingDocs: true },
    }));
    await makeLegacy("demo");

    const toBacklog = await cmdStage(args("stage", ["demo", "backlog"]), root);

    expect(toBacklog.code, toBacklog.stdout).toBe(0);
    expect(feature().stage).toBe("backlog");
    let lines = logLines();
    expect(lines.map((r) => r.event)).toEqual(["opened", "stage"]);
    expect(lines[0].stage).toBe("planning");
    expect(String(lines[0].set?.id)).toMatch(UUID);
    expect(lines[1].from).toBe("planning");
    expect(lines[1].stage).toBe("backlog");
    expect(snapshot().id).toBe(lines[0].set?.id);
    expectFoldEqualsSnapshot();

    const before = lines.length;
    const next = await cmdStage(args("stage", ["demo", "implementation"]), root);

    expect(next.code, next.stdout).toBe(0);
    lines = appendedAfter(before);
    expect(lines.map((r) => r.event)).toEqual(["stage"]);
    expectFoldEqualsSnapshot();
  });

  it("gets its id and an opened record on a cancel", async () => {
    await implementationItem("demo");
    await makeLegacy("demo");

    expect((await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root)).code).toBe(0);

    const lines = logLines();
    expect(lines.map((r) => r.event)).toEqual(["opened", "cancelled"]);
    expect(lines[0].stage).toBe("implementation");
    expect(String(lines[0].set?.id)).toMatch(UUID);
    expect(snapshot().id).toBe(lines[0].set?.id);
    expectFoldEqualsSnapshot();
  });
});

describe("a log that cannot be written", () => {
  it("never refuses or changes a move, warns once, and opens the log with the state before the next move", async () => {
    await implementationItem("demo");
    const log = itemLogPath(feature().dir);
    await rm(log);
    await mkdir(log);

    const first = await cmdStage(args("stage", ["demo", "testing"]), root);

    expect(first.code, first.stdout).toBe(0);
    expect(feature().stage).toBe("testing");
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("'demo'");
    expect(warnings()[0]).toContain(itemLogPath(feature().dir));
    const executionId = snapshot().executionId;
    expect(String(executionId)).toMatch(UUID);

    await rm(itemLogPath(feature().dir), { recursive: true });
    const second = await cmdStage(args("stage", ["demo", "planning"]), root);

    expect(second.code, second.stdout).toBe(0);
    expect(feature().stage).toBe("planning");
    expect(warnings()).toHaveLength(1);
    const lines = logLines();
    expect(lines.map((r) => r.event)).toEqual(["opened", "stage"]);
    expect(lines[0].stage).toBe("testing");
    expect(lines[0].set?.executionId).toBe(executionId);
    expect(lines[1].from).toBe("testing");
    expect(lines[1].stage).toBe("planning");
    expectFoldEqualsSnapshot();
  });
});

describe("a log whose last line is cut off", () => {
  it("appends nothing, warns once naming the unreadable line, and still moves the item", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    appendFileSync(itemLogPath(feature().dir), '{"v":1,"at":"2026-11-13T05:0');
    const bytes = rawLog();

    const res = await cmdStage(args("stage", ["demo", "planning"]), root);

    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("planning");
    expect(rawLog()).toBe(bytes);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("'demo'");
    expect(warnings()[0]).toContain(itemLogPath(feature().dir));
    expect(warnings()[0]).toContain("line 2 is unreadable");
  });
});
