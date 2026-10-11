import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdSync } from "../cli/commands/sync.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command: "sync", positionals, options });

let root: string;
let stubBin: string;
let prevPath: string | undefined;
const callsFile = () => join(root, "gh-calls.log");

/** gh stub — per-PR state via GH_PR_STATE_<num> (falling back to GH_PR_STATE, default MERGED). */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "${"${GH_CALLS}"}"
if [ -n "$GH_FAIL" ]; then echo "boom" >&2; exit 1; fi
case "$1" in
  auth) exit 0 ;;
  pr)
    if [ "$2" = view ]; then
      num="\${3##*/}"
      state=$(printenv "GH_PR_STATE_$num"); state="\${state:-\${GH_PR_STATE:-MERGED}}"
      printf '{"state":"%s"}\\n' "$state"
    fi; exit 0 ;;
esac
exit 0
`;

const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
const feature = (name: string) => findFeature(root, name)!;

async function report(name: string, id: "testing-result" | "review-report"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/** A bug work item driven to a review-stage PASS state — archive-ready when merged. */
async function reviewBug(name: string): Promise<void> {
  expect((await cmdNew({ command: "new", positionals: [name], options: { context: "app", type: "bug" } }, root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), bugSpec);
  expect((await cmdStage({ command: "stage", positionals: [name, "planning"], options: {} }, root)).code).toBe(0);
  expect((await cmdApprove({ command: "approve", positionals: [name], options: {} }, root)).code).toBe(0);
  expect((await cmdStage({ command: "stage", positionals: [name, "implementation"], options: {} }, root)).code).toBe(0);
  expect((await cmdStage({ command: "stage", positionals: [name, "testing"], options: {} }, root)).code).toBe(0);
  await report(name, "testing-result");
  expect((await cmdStage({ command: "stage", positionals: [name, "review"], options: {} }, root)).code).toBe(0);
  await report(name, "review-report");
}

/** Seed a bare folder + .kfw.json — for items the sweep will skip, not archive. */
async function seedItem(stage: string, name: string, meta: Record<string, unknown>): Promise<void> {
  const dir = join(root, ".works", stage, `${name}_20260101_0000`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".kfw.json"), JSON.stringify({
    schema: "kanban-flow", feature: name, context: "app", created: "x", kind: "bug", ...meta,
  }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-sync-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow",
    created: "x",
    repository: "o/r",
    worktree: { enabled: false },
  }));
  stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_CALLS = callsFile();
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of Object.keys(process.env)) {
    if (v.startsWith("GH_")) delete process.env[v];
  }
  await rm(root, { recursive: true, force: true });
});

describe("kf sync — delivery sweep (UC-006, TC-019/TC-020)", () => {
  it("archives merged PR-linked items and skips the rest (TC-019)", async () => {
    await reviewBug("mergedbug");
    await writeFeatureMeta(feature("mergedbug").dir,
      { ...readFeatureMeta(feature("mergedbug").dir)!, issue: "https://github.com/o/r/issues/7", pr: "https://github.com/o/r/pull/9" });
    await seedItem("review", "openitem", { pr: "https://github.com/o/r/pull/10" });
    await seedItem("review", "nopritem", {});
    process.env.GH_PR_STATE_10 = "OPEN";

    const res = await cmdSync(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("mergedbug: archived");
    expect(res.stdout).toContain("openitem: skipped");
    expect(feature("mergedbug").stage).toBe("dones");
    expect(readFeatureMeta(feature("mergedbug").dir)!.delivered).toBe(true);
    expect(feature("openitem").stage).toBe("review");
    expect(feature("nopritem").stage).toBe("review");
  });

  it("reports nothing to sync when no PR-linked items exist", async () => {
    await seedItem("review", "nopritem", {});
    const res = await cmdSync(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("nothing to sync");
  });

  it("refuses without a repository (TC-020a)", async () => {
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
    const res = await cmdSync(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("repository");
  });

  it("skips unverifiable items with a warning and keeps sweeping (TC-020b)", async () => {
    await seedItem("review", "unverifiable", { pr: "https://github.com/o/r/pull/11" });
    process.env.GH_FAIL = "1";
    const res = await cmdSync(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("could not verify");
    expect(feature("unverifiable").stage).toBe("review");
  });

  it("reports a failed archive but continues the sweep (TC-020c)", async () => {
    // "baditem" merges but can't archive (no valid artifacts — the gate refuses).
    await seedItem("review", "baditem", { pr: "https://github.com/o/r/pull/12" });
    await reviewBug("goodbug");
    await writeFeatureMeta(feature("goodbug").dir,
      { ...readFeatureMeta(feature("goodbug").dir)!, issue: "https://github.com/o/r/issues/8", pr: "https://github.com/o/r/pull/13" });

    const res = await cmdSync(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("✗ baditem");
    expect(res.stdout).toContain("goodbug: archived");
    expect(feature("goodbug").stage).toBe("dones");
    expect(feature("baditem").stage).toBe("review");
  });
});
