import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import type { ArchiveOutcome } from "../workflow/archive.js";
import type { MigrationResult } from "../workflow/migrate.js";
import type { ParsedArgs } from "../cli/args.js";

const fake = vi.hoisted(() => ({
  migration: { lines: [], failed: false } as MigrationResult,
  outcome: null as ArchiveOutcome | null,
}));

vi.mock("../workflow/migrate.js", () => ({ migrateLegacyStages: async () => fake.migration }));
vi.mock("../workflow/archive.js", async (original) => ({
  ...(await original<typeof import("../workflow/archive.js")>()),
  archiveItem: async () => fake.outcome,
}));
vi.mock("../workflow/status.js", async (original) => ({
  ...(await original<typeof import("../workflow/status.js")>()),
  currentReportStatus: () => "PASS",
}));

const TS = "20260101_0000";
const status = (options: Record<string, unknown>): ParsedArgs => ({ command: "status", positionals: [], options });

let root: string;

/** A new item moved into review, where kf status tries to close it. */
async function inReview(name: string): Promise<void> {
  expect((await cmdNew({ command: "new", positionals: [name], options: { context: "app" } }, root)).code).toBe(0);
  const dir = findFeature(root, name)!.dir;
  await rename(dir, join(root, ".works", "review", dir.split("/").pop()!));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-status-close-"));
  ensureWorksStructure(root);
  fake.migration = { lines: [], failed: false };
  fake.outcome = null;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf status naming why a review PASS item did not close", () => {
  it("names a gate refusal's failed checks by their codes", async () => {
    await inReview("demo");
    fake.outcome = { kind: "refused", reason: "gate", stderrTag: "gate refused", stdout: "Cannot archive 'demo': gates failed.\n  - testing result missing (missing_testing_result)" } as ArchiveOutcome;

    const res = await cmdStatus(status({ change: "demo" }), root);
    expect(res.stdout).toContain("Not closed: Cannot archive 'demo': gates failed. missing_testing_result");
  });

  it("keeps a failed done hook's output whole instead of reading codes out of it", async () => {
    await inReview("demo");
    const stdout = "Hook 'done' failed (exit 2).\nArchive refused.\n\nrm: cannot remove (node_modules)\n\nRe-run with --skip-hooks to bypass.";
    fake.outcome = { kind: "hook-failed", hook: { code: 2 }, stderrTag: "hook failed", stdout } as unknown as ArchiveOutcome;

    const res = await cmdStatus(status({ change: "demo" }), root);
    expect(res.stdout).toContain("Not closed: Hook 'done' failed (exit 2). Archive refused. rm: cannot remove (node_modules) Re-run with --skip-hooks to bypass.");
  });
});

describe("kf status exit code after a legacy move", () => {
  it("exits 1 for the item whose close failed after its move to review, and 0 for another item", async () => {
    await inReview("shipped");
    await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root);
    fake.migration = { lines: [`✗ migrated shipped_${TS}: .works/shipping → .works/review (PR merged, close failed: boom)`], failed: true };
    fake.outcome = { kind: "reconciled" } as ArchiveOutcome;

    expect((await cmdStatus(status({ change: "shipped" }), root)).code).toBe(1);
    expect((await cmdStatus(status({ change: "demo" }), root)).code).toBe(0);
    expect((await cmdStatus(status({ all: true }), root)).code).toBe(1);
  });
});
