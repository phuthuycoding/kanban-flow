import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, executionContractHash, findFeature, readFeatureMeta, writeFeatureMeta, type RunRecord } from "../workflow/features.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (options: Record<string, unknown>): ParsedArgs => ({ command: "status", positionals: [], options });

/** A review item with a current PASS report and nothing to land: `kf status` closes it unless something holds it. */
async function passedReviewItem(): Promise<string> {
  const ts = "20260916_1800";
  const dir = join(root, ".works", "review", `demo_${ts}`);
  await mkdir(join(dir, "use-cases"), { recursive: true });
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\nreal content\nFR-001");
  for (const f of ["phase-2-implementation-plan.md", "phase-2-use-case-specification.md", "phase-2-use-case-diagram.md", "phase-2-test-case.md"]) {
    await writeFile(join(dir, f), `# ${f}\nreal content\n## TC-001\nFR-001 UC-001`);
  }
  await writeFile(join(dir, "use-cases", "UC-001.md"), "# UC-001\nreal content");
  await writeFile(join(dir, "phase-4-testing-result.md"), "---\nstatus: PASS\nexecution: run-1\n---\n# Test\nreal content\nOverall: 85%\n## Commands and Evidence\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | ok |");
  await writeFile(join(dir, "phase-5-review-report.md"), "---\nstatus: PASS\nexecution: run-1\nci: none\nlanding: none\n---\n# Review\nreal content");
  await writeFile(join(dir, "phase-6-feature-report.md"), "# Feature Report\nreal content");
  await writeFeatureMeta(dir, {
    schema: "kanban-flow", feature: "demo", context: "app", created: ts,
    approval: { status: "approved", by: "human", at: ts, contractHash: executionContractHash(dir)! },
    executionId: "run-1",
  });
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-status-run-"));
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf status auto-close", () => {
  it("leaves a review PASS item alone while one of its worker runs is still running", async () => {
    const dir = await passedReviewItem();
    const run: RunRecord = {
      id: "run-a", role: "reviewer", runner: "codex", stage: "review", mode: "start", at: new Date().toISOString(),
      log: "runs/run-a.log", status: "running", pid: process.pid, supervisorPid: process.pid,
    };
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [run] });

    const res = await cmdStatus(args({ change: "demo" }), root);
    expect(res.stdout).not.toContain("✓ done demo");
    expect(findFeature(root, "demo")!.stage).toBe("review");

    // Once the run is over the same item closes, so the run is what held it.
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [{ ...run, status: "done", endedAt: new Date().toISOString() }] });
    const closed = await cmdStatus(args({ change: "demo" }), root);
    expect(closed.stdout).toContain("✓ done demo (nothing to land)");
  });
});
