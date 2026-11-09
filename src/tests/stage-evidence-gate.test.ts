import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, updateFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const evidenceTable = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

let scratch: string;
let root: string;
let marker: string;
const feature = () => findFeature(root, "f")!;

async function configure(stage?: string[][]): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    worktree: { enabled: false },
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...(stage ? { verify: { stage } } : {}),
    },
  }));
}

/** The marker-appending command proves the gate itself runs nothing. */
const markerCmd = (): string[] => ["node", "-e", `require('fs').appendFileSync(${JSON.stringify(marker)},'x')`];

async function writeTestingReport(table = evidenceTable): Promise<void> {
  await writeFile(join(feature().dir, ARTIFACTS["testing-result"].file),
    `---\nstatus: PASS\nexecution: ${feature().meta?.executionId}\n---\n# Evidence\nVerified current implementation.\n${table}`);
}

/** A bug item `f` in testing with a PASS testing report; no worktree, so the project root's HEAD is the item's HEAD. */
async function itemInTesting(table = evidenceTable): Promise<void> {
  const must = (res: { code: number; stdout: string }, what: string): void => {
    if (res.code !== 0) throw new Error(`${what} failed: ${res.stdout}`);
  };
  must(await cmdNew(args("new", ["f"], { context: "app", type: "bug" }), root), "kf new");
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file),
    "---\nstatus: confirmed\nkind: bug\n---\n# Bug Report\nReproduce: submit twice. Actual: duplicate task. Expected: one task. Severity: medium. Regression: repeat-submit unit test. Docs: unchanged behavior.");
  must(await cmdStage(args("stage", ["f", "planning"]), root), "stage planning");
  must(await cmdApprove(args("approve", ["f"], { backlog: true }), root), "approve");
  must(await cmdStage(args("stage", ["f", "implementation"]), root), "stage implementation");
  must(await cmdStage(args("stage", ["f", "testing"]), root), "stage testing");
  await writeTestingReport(table);
}

const head = (): string => gitIn(root, "rev-parse", "HEAD");

async function writeRecord(overrides: Record<string, unknown> = {}, argvs: string[][] = [["npm", "test"]]): Promise<void> {
  await mkdir(join(feature().dir, "loop"), { recursive: true });
  const rec = {
    at: new Date().toISOString(), sha: head(), clean: true,
    commands: argvs.map((argv) => ({ argv, outcome: "exit", code: 0 })),
    outputSha256: "0".repeat(64), exit: 0, ...overrides,
  };
  await appendFile(join(feature().dir, "loop", "stage-verify.jsonl"), `${JSON.stringify(rec)}\n`);
}

const toReview = (extra: Record<string, unknown> = {}) => cmdStage(args("stage", ["f", "review"], extra), root);
const bypasses = () => feature().meta?.bypasses ?? [];

async function commitFile(name: string, content: string): Promise<void> {
  await writeFile(join(root, name), content);
  gitIn(root, "add", name);
  gitIn(root, "commit", "-qm", `touch ${name}`);
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-gate-")));
  root = join(scratch, "repo");
  marker = join(scratch, "marker");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  await writeFile(join(root, "tracked.txt"), "one");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("testing → review stage evidence gate", () => {
  describe("with harness.verify.stage pinned", () => {
    beforeEach(async () => {
      await configure([markerCmd()]);
      await itemInTesting();
    });

    it("moves to review on a passing record at HEAD without running any command and with an untracked file in the tree", async () => {
      await writeRecord({}, [markerCmd()]);
      await writeFile(join(root, "untracked.txt"), "x");

      const res = await toReview();

      expect(res.code).toBe(0);
      expect(feature().stage).toBe("review");
      expect(existsSync(marker)).toBe(false);
    });

    it("refuses a stale record with verify_record_stale naming the record sha, HEAD and the command to run", async () => {
      await writeRecord({}, [markerCmd()]);
      const recorded = head();
      await commitFile("later.txt", "x");

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_record_stale");
      expect(res.stdout).toContain(recorded.slice(0, 7));
      expect(res.stdout).toContain(head().slice(0, 7));
      expect(res.stdout).toContain("kf verify f --stage");
      expect(feature().stage).toBe("testing");
    });

    it("refuses with verify_record_failed when the latest of a pass then a fail at HEAD failed", async () => {
      await writeRecord({}, [markerCmd()]);
      await writeRecord({ exit: 1 }, [markerCmd()]);

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_record_failed");
    });

    it("refuses with verify_tree_dirty when the latest record was taken on a dirty tree", async () => {
      await writeRecord({ clean: false }, [markerCmd()]);

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_tree_dirty");
    });

    it("refuses with verify_tree_dirty when a tracked file is modified after a clean record", async () => {
      await writeRecord({}, [markerCmd()]);
      await writeFile(join(root, "tracked.txt"), "two");

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_tree_dirty");
    });

    it.each([
      ["reordered", [["npm", "test"], ["npm", "run", "lint"]], [["npm", "run", "lint"], ["npm", "test"]]],
      ["with a command added", [["npm", "test"]], [["npm", "test"], ["npm", "run", "lint"]]],
      ["with a command removed", [["npm", "test"], ["npm", "run", "lint"]], [["npm", "test"]]],
    ])("refuses with verify_config_changed when harness.verify.stage is %s after the record", async (_n, recorded, configured) => {
      // The record lists what was configured when it ran; the config is then changed.
      await writeRecord({}, recorded);
      await configure(configured);

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_config_changed");
    });

    it("refuses with verify_record_missing when there is no record file", async () => {
      const res = await toReview();
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_record_missing");
    });

    it("refuses with verify_record_invalid when the last line is unparsable, even after an earlier pass at HEAD", async () => {
      await writeRecord({}, [markerCmd()]);
      await appendFile(join(feature().dir, "loop", "stage-verify.jsonl"), "{bad\n");

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_record_invalid");
      expect(feature().stage).toBe("testing");
    });

    it("refuses with verify_dir_missing when the item worktree path was deleted", async () => {
      await writeRecord({}, [markerCmd()]);
      await updateFeatureMeta(root, "f", (m) => ({
        ...m,
        worktree: { path: join(scratch, "gone"), branch: "b", domain: "d", port: 1, createdAt: new Date().toISOString() },
      }));

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_dir_missing");
    });

    it("refuses with verify_record_missing when the item has a waiver but the project now pins stage commands", async () => {
      await updateFeatureMeta(root, "f", (m) => ({
        ...m,
        verifyWaiver: { reason: "no suite yet", at: new Date().toISOString(), by: "someone" },
      }));

      const res = await toReview();

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("verify_record_missing");
      expect(feature().stage).toBe("testing");
    });

    it("lets --force pass a missing record and records it in the bypasses", async () => {
      const res = await toReview({ force: true });

      expect(res.code).toBe(0);
      expect(feature().stage).toBe("review");
      const forced = bypasses().filter((b) => b.flag === "force");
      expect(forced).toHaveLength(1);
      expect(forced[0].codes).toContain("verify_record_missing");
    });

    it("lets --force pass a stale record and records verify_record_stale in the bypasses", async () => {
      await writeRecord({}, [markerCmd()]);
      await commitFile("later.txt", "x");

      const res = await toReview({ force: true });

      expect(res.code).toBe(0);
      expect(feature().stage).toBe("review");
      expect(bypasses().filter((b) => b.flag === "force").flatMap((b) => b.codes)).toContain("verify_record_stale");
    });

    it("leaves other moves such as testing → implementation without the gate", async () => {
      await writeFile(join(feature().dir, ARTIFACTS["testing-result"].file),
        `---\nstatus: FAIL\nexecution: ${feature().meta?.executionId}\n---\n# Evidence\nA test failed.\n${evidenceTable}`);
      const res = await cmdStage(args("stage", ["f", "implementation"]), root);
      expect(res.code).toBe(0);
      expect(feature().stage).toBe("implementation");
    });
  });

  describe("without harness.verify.stage", () => {
    it.each([["absent", undefined], ["empty", [] as string[][]]])("refuses when it is %s, then moves once a waiver is recorded", async (_n, stage) => {
      await configure(stage);
      await itemInTesting();

      const refused = await toReview();
      expect(refused.code).toBe(1);
      expect(refused.stdout).toContain("verify_not_configured");
      expect(refused.stdout).toContain("harness.verify.stage");
      expect(refused.stdout).toContain("--waive");

      const waived = await cmdVerify(args("verify", ["f"], { stage: true, waive: "no suite yet" }), root);
      expect(waived.code).toBe(0);

      expect((await toReview()).code).toBe(0);
      expect(feature().stage).toBe("review");
    });
  });

  it("gates a bug without a worktree on the project root's HEAD and records that sha", async () => {
    await configure([markerCmd()]);
    await itemInTesting();
    await writeRecord({}, [markerCmd()]);

    const res = await toReview();

    expect(res.code).toBe(0);
    const lines = readFileSync(join(feature().dir, "loop", "stage-verify.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(lines[lines.length - 1]).sha).toBe(head());
  });
});
