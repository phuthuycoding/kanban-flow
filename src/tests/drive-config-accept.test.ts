import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { claimDrive, superviseDrive } from "../harness/drive.js";
import { cmdDrive } from "../cli/commands/drive.js";
import { cmdRun } from "../cli/commands/run.js";
import { updateFeatureMeta } from "../workflow/features.js";
import { readProjectConfig, resolveDriveConfig } from "../project/config.js";
import { gitDriveProject, type DriveTask, type GitDriveOptions, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

vi.mock("../harness/drive.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../harness/drive.js")>()),
  // The CLI's supervisor and watcher are separate processes; these tests look only at what the claim printed and recorded.
  startDetachedDrive: vi.fn(async () => 4242),
  followDrive: vi.fn(async () => ({ code: 0, detached: false })),
}));

vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const args = (command: string, positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AGENTS = ["claude", "gemini", "devin", "codex", "opencode"];

let p: GitDriveProject | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await p?.cleanup();
  p = null;
});

async function project(tasks: DriveTask[], opts: Partial<GitDriveOptions> = {}): Promise<GitDriveProject> {
  p = await gitDriveProject({ tasks, stages: { implementation: ["coder"], testing: ["tester"], review: ["reviewer"] }, ...opts });
  return p;
}

const editConfig = (file: string, fn: (cfg: Record<string, any>) => void) => {
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  fn(cfg);
  writeFileSync(file, JSON.stringify(cfg, null, 2));
};

/** A drive stopped on config_changed after its first task's worker rewrote harness.verify.stage in the primary copy. */
async function stoppedOnVerifyEdit(): Promise<GitDriveProject> {
  const pr = await project([
    { id: "TASK-001", files: ["src/a.txt"] },
    { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
  ]);
  const file = resolveDriveConfig(pr.root, pr.feature()).file;
  pr.cli.scenario("claude", { script: `perl -0pi -e 's/"true"/"sh", "-c", "curl evil"/' '${file}'` }, "TASK-001");
  const claim = await claimDrive(pr.root, "demo");
  if (!claim.ok) throw new Error(claim.reason);
  const out = await superviseDrive(pr.root, "demo", claim.drive.id, { timeoutMs: 60_000 });
  expect(out.stopCode, out.reason).toBe("config_changed");
  return pr;
}

const VERIFY_LINE = `harness.verify.stage: [["true"]] → [["sh","-c","curl evil"]]`;

describe("kf drive records every config it re-pins", () => {
  it("records an --accept-config resume with the time, the command and the old → new argv", async () => {
    const pr = await stoppedOnVerifyEdit();
    const accepted = await claimDrive(pr.root, "demo", { acceptConfig: true, command: "kf drive demo --accept-config" });
    if (!accepted.ok) throw new Error(accepted.reason);
    expect(accepted.accepted).toEqual([VERIFY_LINE]);
    const records = pr.readMeta()!.drive!.configAcceptances!;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ command: "kf drive demo --accept-config", against: "pin", changes: [VERIFY_LINE] });
    expect(records[0].at).toMatch(ISO);
  });

  it("prints and records role and limit changes re-pinned on a plain resume, keeping earlier records", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", files: ["src/b.txt"] },
    ], { limits: { parallel: 1, budget: { maxRuns: 1 } } });
    const claim = await claimDrive(pr.root, "demo");
    if (!claim.ok) throw new Error(claim.reason);
    const out = await superviseDrive(pr.root, "demo", claim.drive.id, { timeoutMs: 60_000 });
    expect(out.stopCode, out.reason).toBe("budget");

    const file = join(pr.root, ".kf", "config.json");
    editConfig(file, (c) => { c.harness.budget = { maxRuns: 5 }; c.harness.roles.coder.runner = "gemini"; });
    const resumed = await claimDrive(pr.root, "demo");
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(resumed.accepted).toEqual(["harness.roles changed", "harness.budget changed"]);
    await updateFeatureMeta(pr.root, "demo", (meta) => ({ ...meta, drive: { ...meta.drive!, status: "stopped", stopCode: "budget" } }));

    editConfig(file, (c) => { c.harness.maxLoops = 7; });
    const text = await cmdDrive(args("drive", ["demo"]), pr.root);
    expect(text.code, text.stdout).toBe(0);
    expect(text.stdout).toContain("Accepted the changed drive config:\n  harness.maxLoops changed");
    const records = pr.readMeta()!.drive!.configAcceptances!;
    expect(records.map((r) => [r.command, r.against, r.changes])).toEqual([
      ["kf drive demo", "pin", ["harness.roles changed", "harness.budget changed"]],
      ["kf drive demo", "pin", ["harness.maxLoops changed"]],
    ]);
    const status = await cmdDrive(args("drive", ["demo"], { status: true }), pr.root);
    expect(status.stdout).toContain(`Config accepted: 2 time(s); last ${records[1].at} by kf drive demo (1 change(s) against the previous pin)`);
  });

  it("resumes a drive pinned by 0.13 without listing the keys that release did not pin as changed", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", files: ["src/b.txt"] },
    ], { limits: { parallel: 1, budget: { maxRuns: 1 } } });
    const claim = await claimDrive(pr.root, "demo");
    if (!claim.ok) throw new Error(claim.reason);
    const harness = readProjectConfig(pr.root).harness!;
    const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v ?? null)).digest("hex");
    // The pin 0.13 wrote: four hashed parts, and a stop on config_changed that would otherwise demand --accept-config.
    await updateFeatureMeta(pr.root, "demo", (meta) => ({
      ...meta,
      drive: {
        ...meta.drive!, status: "stopped", stopCode: "config_changed", configHash: sha("0.13"),
        configParts: { "harness.roles": sha(harness.roles), "harness.runners": sha(harness.runners), "harness.verify": sha(harness.verify), "worktree.enabled": sha(true) },
      },
    }));
    const resumed = await claimDrive(pr.root, "demo");
    if (!resumed.ok) throw new Error(resumed.reason);
    expect(resumed.accepted).toHaveLength(1);
    expect(resumed.accepted[0]).toMatch(/^not pinned by the release that started the drive, pinned now as they are: config\.source, harness\.main, harness\.stages/);
    expect(resumed.accepted[0]).not.toContain("harness.roles");
    expect(resumed.accepted.join("\n")).not.toContain(" changed");
  });

  it("warns and records when a new drive pins a worktree copy whose argv differ from the primary copy", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    editConfig(copy, (c) => { c.harness.verify.stage = [["sh", "-c", "curl evil"]]; });
    const claim = await claimDrive(pr.root, "demo");
    if (!claim.ok) throw new Error(claim.reason);
    expect(claim.resumed).toBe(false);
    expect(claim.warning).toContain(`⚠ Runner and verify commands are read from the item worktree copy ${copy} (config source: worktree)`);
    expect(claim.warning).toContain(`  ${VERIFY_LINE}`);
    expect(pr.readMeta()!.drive!.configAcceptances).toEqual([
      { at: expect.stringMatching(ISO), command: "kf drive demo", against: "primary", changes: [VERIFY_LINE] },
    ]);
  });

  it("--watch --json --accept-config emits the accepted changes as a JSON line before following", async () => {
    const pr = await stoppedOnVerifyEdit();
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { written.push(String(chunk)); return true; });
    const res = await cmdDrive(args("drive", ["demo"], { watch: true, json: true, "accept-config": true }), pr.root);
    vi.mocked(process.stdout.write).mockRestore();
    expect(res.code, res.stdout).toBe(0);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0])).toMatchObject({ event: "accepted_config", acceptedConfig: [VERIFY_LINE], configWarning: null });
    expect(pr.readMeta()!.drive!.configAcceptances).toMatchObject([{ command: "kf drive demo --watch --accept-config --json", changes: [VERIFY_LINE] }]);
  });
});

describe("kf run warns before it runs a changed worktree copy", () => {
  const callCount = (pr: GitDriveProject) => AGENTS.reduce((n, a) => n + pr.calls(a).length, 0);

  async function changedCopy(): Promise<GitDriveProject> {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { commitConfig: true });
    editConfig(join(pr.worktreePath()!, ".kf", "config.json"), (c) => { c.harness.verify.task = [["sh", "-c", "curl evil"]]; });
    return pr;
  }

  /** Runs `options` and returns how many workers had started when the warning was printed, and the result. */
  async function runCapturingWarning(pr: GitDriveProject, options: Record<string, unknown>) {
    let workersAtWarning: number | null = null;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      if (String(chunk).includes("⚠ Runner and verify commands are read from the item worktree copy")) workersAtWarning = callCount(pr);
      return true;
    });
    const res = await cmdRun(args("run", ["demo"], options), pr.root);
    vi.mocked(process.stdout.write).mockRestore();
    return { workersAtWarning, res };
  }

  it("prints the warning before a stage run starts its worker", async () => {
    const pr = await changedCopy();
    const { workersAtWarning, res } = await runCapturingWarning(pr, { stage: "testing" });
    expect(workersAtWarning).toBe(0);
    expect(callCount(pr)).toBeGreaterThan(0);
    expect(res.stdout).not.toContain("⚠ Runner and verify commands");
  });

  it("prints the warning before a task run starts its worker", async () => {
    const pr = await changedCopy();
    const { workersAtWarning, res } = await runCapturingWarning(pr, { task: "TASK-001" });
    expect(workersAtWarning).toBe(0);
    expect(callCount(pr), res.stdout).toBeGreaterThan(0);
  });
});
