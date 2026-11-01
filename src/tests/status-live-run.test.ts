import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, executionContractHash, findFeature, readFeatureMeta, writeFeatureMeta, type RunRecord } from "../workflow/features.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdSync } from "../cli/commands/sync.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdIssues } from "../cli/commands/issues.js";
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

describe("kf sync and kf archive under a live worker run", () => {
  const liveRun = (): RunRecord => ({
    id: "run-a", role: "reviewer", runner: "codex", stage: "review", mode: "start", at: new Date().toISOString(),
    log: "runs/run-a.log", status: "running", pid: process.pid, supervisorPid: process.pid,
  });

  it("kf sync skips the item while the run lives and closes it once the run is over", async () => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
    const dir = await passedReviewItem();
    const run = liveRun();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [run] });

    const res = await cmdSync({ command: "sync", positionals: [], options: {} }, root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("- demo: skipped (a worker run is in progress)");
    expect(findFeature(root, "demo")!.stage).toBe("review");

    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [{ ...run, status: "done", endedAt: new Date().toISOString() }] });
    const closed = await cmdSync({ command: "sync", positionals: [], options: {} }, root);
    expect(closed.stdout).toContain("✓ demo: archived (nothing to land)");
  });

  it("kf archive refuses while the run lives, even with --force, and closes once the run is over", async () => {
    const dir = await passedReviewItem();
    const run = liveRun();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [run] });

    for (const options of [{}, { force: true }]) {
      const res = await cmdArchive({ command: "archive", positionals: ["demo"], options }, root);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain(`Cannot archive 'demo': worker run run-a (reviewer, pid ${process.pid} (alive)) is still running`);
      expect(res.stderr).toBe("run in progress");
      expect(findFeature(root, "demo")!.stage).toBe("review");
    }

    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [{ ...run, status: "done", endedAt: new Date().toISOString() }] });
    const closed = await cmdArchive({ command: "archive", positionals: ["demo"], options: {} }, root);
    expect(closed.code).toBe(0);
    expect(findFeature(root, "demo")!.stage).toBe("done");
  });

  it("the refusal names the run record on its first line and how to end a dead run whose pid was reused", async () => {
    const dir = await passedReviewItem();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [liveRun()] });

    const res = await cmdArchive({ command: "archive", positionals: ["demo"], options: {} }, root);
    const [first] = res.stdout.split("\n");
    expect(first).toContain(`the run record is in ${join(".works", "review", "demo_20260916_1800", ".kfw.json")}`);
    expect(first).toContain("Wait for it to end, then re-run: kf archive demo");
    expect(res.stdout).toContain('If the alive pid is not the run (it died and the pid was reused), set the record\'s status to "failed" there');
  });

  it("names which of the worker and supervisor pids is alive", async () => {
    const dir = await passedReviewItem();
    const dead = 2 ** 22 + 12345;
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [{ ...liveRun(), pid: dead, supervisorPid: process.pid }] });

    const res = await cmdArchive({ command: "archive", positionals: ["demo"], options: {} }, root);
    expect(res.stdout).toContain(`worker run run-a (reviewer, pid ${dead} (dead), supervisor ${process.pid} (alive)) is still running`);
  });

  it("the re-run hint repeats kf archive with the flags it was given", async () => {
    const dir = await passedReviewItem();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [liveRun()] });

    const res = await cmdArchive({ command: "archive", positionals: ["demo"], options: { force: true, "skip-specs": true } }, root);
    expect(res.stdout).toContain("then re-run: kf archive demo --force --skip-specs\n");
  });

  it("kf stage <item> done refuses while the run lives, even with --force", async () => {
    const dir = await passedReviewItem();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [liveRun()] });

    for (const options of [{}, { force: true }]) {
      const res = await cmdStage({ command: "stage", positionals: ["demo", "done"], options }, root);
      expect(res.code).toBe(1);
      expect(res.stderr).toBe("run in progress");
      expect(res.stdout).toContain(`Cannot archive 'demo': worker run run-a (reviewer, pid ${process.pid} (alive)) is still running`);
      expect(findFeature(root, "demo")!.stage).toBe("review");
    }
  });

  it("kf stage <item> done names itself, with the flags it was given, as the re-run command", async () => {
    const dir = await passedReviewItem();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [liveRun()] });

    const res = await cmdStage({ command: "stage", positionals: ["demo", "done"], options: { force: true, "skip-hooks": true, "skip-specs": true } }, root);
    expect(res.stdout).toContain("then re-run: kf stage demo done --force --skip-hooks --skip-specs\n");
  });

  it("kf issues done refuses while the run lives", async () => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
    const dir = await passedReviewItem();
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, runs: [liveRun()] });

    const res = await cmdIssues({ command: "issues", positionals: ["done", "demo"], options: {} }, root);
    expect(res.code).toBe(1);
    expect(res.stderr).toBe("run in progress");
    expect(res.stdout).toContain(`Cannot archive 'demo': worker run run-a (reviewer, pid ${process.pid} (alive)) is still running`);
    expect(res.stdout).toContain("then re-run: kf issues done demo\n");
    expect(findFeature(root, "demo")!.stage).toBe("review");
  });
});
