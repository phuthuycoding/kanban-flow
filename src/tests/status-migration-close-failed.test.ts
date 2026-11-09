import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr) [ "$2" = view ] && printf '{"state":"MERGED","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n'; exit 0 ;;
esac
exit 0
`;

const status = (options: Record<string, unknown>): ParsedArgs => args("status", [], options);

let root: string;
let prevPath: string | undefined;

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n## Affected surfaces\nN/A\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

async function report(id: "testing-result" | "review-report"): Promise<void> {
  const dir = findFeature(root, "shipped")!.dir;
  await writeFile(join(dir, ARTIFACTS[id].file),
    `---\nstatus: PASS\nexecution: ${readFeatureMeta(dir)!.executionId}\n${id === "review-report" ? "ci: none\nlanding: pr\n" : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/**
 * A review PASS item with a merged PR, put back in the legacy shipping stage, whose close then
 * throws: a file sits where its canonical requirement doc's directory goes, so the docs write fails.
 */
async function shippedItemWhoseCloseThrows(): Promise<string> {
  const dir = () => findFeature(root, "shipped")!.dir;
  expect((await cmdNew(args("new", ["shipped"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(dir(), ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["shipped", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(dir(), ARTIFACTS[id].file), "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(dir(), "use-cases"), { recursive: true });
  await writeFile(join(dir(), "use-cases", "UC-001.md"), "# UC-001 Ship it\nUser ships.");
  await writeFile(join(dir(), ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", ["shipped"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", ["shipped", "testing"]), root)).code).toBe(0);
  await report("testing-result");
  await grantStageWaiver(root, "shipped");
  expect((await cmdStage(args("stage", ["shipped", "review"]), root)).code).toBe(0);
  await report("review-report");
  await writeFile(join(dir(), ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
  await writeFeatureMeta(dir(), { ...readFeatureMeta(dir())!, pr: "https://github.com/o/r/pull/9" });
  const folder = basename(dir());
  await mkdir(join(root, ".works", "shipping"), { recursive: true });
  await rename(dir(), join(root, ".works", "shipping", folder));
  await mkdir(join(root, "docs", "requirement"), { recursive: true });
  await writeFile(join(root, "docs", "requirement", "app"), "not a directory");
  return folder;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-status-migrate-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
  const stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(root, { recursive: true, force: true });
});

describe("kf status after a real legacy move whose close failed", () => {
  it("exits 1 for that item's --change and for --all", async () => {
    const folder = await shippedItemWhoseCloseThrows();
    expect((await cmdNew(args("new", ["other"], { context: "app" }), root)).code).toBe(0);

    const res = await cmdStatus(status({ change: "shipped" }), root);
    expect(res.stdout).toContain(`✗ migrated ${folder}: .works/shipping → .works/review (PR merged, close failed:`);
    expect(res.code).toBe(1);
    expect(findFeature(root, "shipped")!.stage).toBe("review");
    expect((await cmdStatus(status({ all: true }), root)).code).toBe(1);
  });

  it("exits 0 for an unrelated item on the run that moves it", async () => {
    await shippedItemWhoseCloseThrows();
    expect((await cmdNew(args("new", ["other"], { context: "app" }), root)).code).toBe(0);

    const res = await cmdStatus(status({ change: "other" }), root);
    expect(res.stdout).toContain("✗ migrated shipped_");
    expect(res.code).toBe(0);
  });
});
