import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, updateFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact, REVIEW_DOCS_NONE } from "./helpers/contract.js";
import { ITEM_LOG_FILE, itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { archiveItem } from "../workflow/archive.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import type { ParsedArgs } from "../cli/args.js";

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const confirmed = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-itemlog-life-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Rita Reviewer"]);
  await writeFile(join(root, ".gitignore"), ".works/\n.kf/\n");
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "commit", "-qm", "init"]);
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261113_0409", defaultContext: "cli",
    worktree: { enabled: false },
    harness: { main: "lead", roles: { lead: { runner: "claude" } }, runners: { claude: { start: ["claude", "{prompt}"] } } },
  }));
  vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(scratch, { recursive: true, force: true });
});

describe("the lifecycle log across a whole item life", () => {
  it("rebuilds the stage and shared metadata after every step and never records machine-local values", async () => {
    const name = "demo";
    const feature = () => findFeature(root, name)!;
    const snapshot = () => JSON.parse(readFileSync(join(feature().dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
    const checked: string[] = [];
    let dir = "";

    /** Fold the log and compare it with the item's stage and shared metadata. */
    const expectFoldEqualsSnapshot = (step: string): void => {
      const item = feature();
      dir = item.dir;
      const folded = readItemLog(item.dir);
      expect(folded.ok, `fold ok after ${step}`).toBe(true);
      if (!folded.ok) return;
      expect(folded.state, `fold after ${step}`).toEqual({ stage: item.stage, meta: sharedMeta(snapshot()) });
      checked.push(step);
    };
    const reportFor = async (id: "testing-result" | "review-report"): Promise<void> => {
      const execution = readFeatureMeta(feature().dir)!.executionId;
      await writeFile(join(feature().dir, ARTIFACTS[id].file),
        `---\nstatus: PASS\nexecution: ${execution}\n${id === "review-report" ? "ci: none\nlanding: none\n" + REVIEW_DOCS_NONE : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
    };

    expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
    expectFoldEqualsSnapshot("new");

    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), confirmed);
    expectFoldEqualsSnapshot("requirement confirmed");

    expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
    expect(feature().stage).toBe("planning");
    expectFoldEqualsSnapshot("stage planning");

    for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
      await writeFile(join(feature().dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
    }
    await mkdir(join(feature().dir, "use-cases"), { recursive: true });
    await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
    await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
    expectFoldEqualsSnapshot("planning contract written");

    expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
    expect(feature().stage).toBe("implementation");
    expectFoldEqualsSnapshot("approve");

    // Provisioning a real worktree is impractical in the fixture: register the block the way
    // the worktree step does, without an event, so the item carries machine-local data.
    const worktreePath = join(scratch, "wt", name);
    await mkdir(worktreePath, { recursive: true });
    await updateFeatureMeta(root, name, (meta) => ({
      ...meta,
      worktree: { path: worktreePath, branch: `kf/${name}`, domain: `${name}.test`, port: 5100, createdAt: "20261113_0409" },
    }));
    expect(snapshot().worktree).toBeDefined();
    expectFoldEqualsSnapshot("worktree registered");

    // A hook for the testing stage, skipped on this move: the bypass lands in `.kfw.json` with the
    // hook's absolute path, and the log must keep only its file name.
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    const hookFile = join(root, ".kf", "hooks", "testing.sh");
    await writeFile(hookFile, "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    expect((await cmdStage(args("stage", [name, "testing"], { "skip-hooks": true }), root)).code).toBe(0);
    expect(feature().stage).toBe("testing");
    expect(JSON.stringify(snapshot().bypasses)).toContain(hookFile);
    expectFoldEqualsSnapshot("stage testing");

    await reportFor("testing-result");
    expect((await cmdVerify(args("verify", [name], { stage: true, waive: "no stage suite in this fixture" }), root)).code).toBe(0);
    expectFoldEqualsSnapshot("testing report and stage waiver");

    const toReview = await cmdStage(args("stage", [name, "review"]), root);
    expect(toReview.code, toReview.stdout).toBe(0);
    expect(feature().stage).toBe("review");
    expectFoldEqualsSnapshot("stage review");

    await reportFor("review-report");
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
    expectFoldEqualsSnapshot("review report");

    // The worktree block must still be there until the close takes it away.
    expect(snapshot().worktree).toBeDefined();
    const outcome = await archiveItem(root, name);
    expect(outcome.kind, JSON.stringify(outcome)).not.toBe("refused");
    expect(outcome.kind).not.toBe("error");
    expect(feature().stage).toBe("done");
    expectFoldEqualsSnapshot("close into done");

    expect(checked.length).toBeGreaterThanOrEqual(10);
    const text = readFileSync(itemLogPath(dir), "utf8");
    expect(itemLogPath(dir).endsWith(ITEM_LOG_FILE)).toBe(true);
    const lines = text.split("\n").filter((l) => l !== "");
    expect(lines.length).toBeGreaterThan(0);
    const records = lines.map((l) => JSON.parse(l) as { event: string; derived?: true; set?: { bypasses?: Array<{ flag?: string; codes?: string[] }> } });
    expect(records.map((r) => r.event)).toEqual(["created", "stage", "approved", "stage", "stage", "waiver", "stage", "delivered"]);
    expect(records.filter((r) => r.derived === true)).toEqual([]);
    const skipped = records.flatMap((r) => r.set?.bypasses ?? []).filter((b) => b.flag === "skip-hooks");
    expect(skipped.flatMap((b) => b.codes ?? [])).toEqual(["hook:testing.sh"]);
    const leaks = ["\"worktree\"", hostname(), homedir(), scratch, root, worktreePath];
    for (const line of lines) {
      for (const leak of leaks) expect(line, `a record holds ${leak}`).not.toContain(leak);
    }
  });
});
