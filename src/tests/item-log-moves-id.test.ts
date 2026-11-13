import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact, REVIEW_DOCS_NONE } from "./helpers/contract.js";
import { grantStageWaiver } from "./support/stage-waiver.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { archiveItem } from "../workflow/archive.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import type { ParsedArgs } from "../cli/args.js";

let scratch: string;
let root: string;
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
const snapshot = (name = "demo"): Record<string, unknown> => JSON.parse(readFileSync(join(feature(name).dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
const expectFoldEqualsSnapshot = (name = "demo"): void => {
  const folded = readItemLog(feature(name).dir);
  expect(folded.ok).toBe(true);
  if (!folded.ok) return;
  expect(folded.state).toEqual({ stage: feature(name).stage, meta: sharedMeta(snapshot(name)) });
};

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


/** Remove the id from `.kfw.json` by hand; the log still holds it. Returns that id. */
function dropSnapshotId(name: string): string {
  const file = join(feature(name).dir, ".kfw.json");
  const { id, ...rest } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify(rest, null, 2));
  expect(typeof id).toBe("string");
  expect(logLines(name)[0].set?.id).toBe(id);
  return id as string;
}

function expectIdKept(id: string, before: number, name = "demo"): void {
  expect(snapshot(name).id).toBe(id);
  for (const r of appendedAfter(before, name)) {
    expect(r.set?.id, `${r.event} must not set the id`).toBeUndefined();
    expect(r.unset ?? [], `${r.event} must not unset the id`).not.toContain("id");
  }
  expectFoldEqualsSnapshot(name);
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-itemlog-moves-id-")));
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
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("an item whose snapshot lost its id while its log still holds it", () => {
  it("keeps the logged id on a stage move", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    const id = dropSnapshotId("demo");
    const before = logLines().length;

    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);

    expect(feature().stage).toBe("planning");
    expectIdKept(id, before);
  });

  it("keeps the logged id on a cancel", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const id = dropSnapshotId("demo");
    const before = logLines().length;

    expect((await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root)).code).toBe(0);

    expect(feature().stage).toBe("cancelled");
    expectIdKept(id, before);
  });

  it("keeps the logged id on the close into done", async () => {
    await reviewItem("demo");
    const id = dropSnapshotId("demo");
    const before = logLines().length;

    const outcome = await archiveItem(root, "demo");

    expect(outcome.kind).toBe("archived");
    expect(feature().stage).toBe("done");
    expectIdKept(id, before);
  });
});
