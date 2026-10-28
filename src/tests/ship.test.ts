import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS, STAGES, TRANSITIONS, STAGE_GATES, STAGE_INDEX } from "../workflow/schema.js";
import { readProjectConfig } from "../project/config.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdShip } from "../cli/commands/ship.js";
import { cmdSync } from "../cli/commands/sync.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const feature = (name = "demo") => findFeature(root, name)!;

let scratch: string;
let root: string;
let bin: string;
let prevPath: string | undefined;

/** Fake gh: logs args to $GH_LOG, serves `pr view` state from $GH_STATE, canned outputs otherwise. */
function fakeGh(): void {
  bin = join(scratch, "bin");
  mkdirSync(bin, { recursive: true });
  const script = `#!/bin/sh
echo "$@" >> "$GH_LOG"
case "$*" in
  "pr view"*) echo "{\\"state\\":\\"\${GH_STATE:-OPEN}\\"}";;
  "pr create"*) echo "https://github.com/o/r/pull/7";;
  "pr merge"*) echo "scheduled";;
  "release create"*) echo "https://github.com/o/r/releases/tag/v9.9.9";;
  *) echo "ok";;
esac
`;
  writeFileSync(join(bin, "gh"), script, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.GH_LOG = join(scratch, "gh.log");
}

const ghLog = (): string => (existsSync(process.env.GH_LOG!) ? readFileSync(process.env.GH_LOG!, "utf8") : "");

async function writeCfg(ship?: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x", repository: "o/r",
    ...(ship ? { ship } : {}),
    worktree: { enabled: false },
  }));
}

const SPEC = "---\nstatus: confirmed\n---\n# Requirement\n## Objective\nShip the thing.\n## FR-001\nUser ships.\n## Affected surfaces\nN/A";

/** Drive an item to review with a PASS pair, then (optionally) into shipping. */
async function shipReadyItem(name = "demo"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), SPEC);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Ship it");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | ok |\n";
  const report = async (id: "testing-result" | "review-report") =>
    writeFile(join(feature(name).dir, ARTIFACTS[id].file),
      `---\nstatus: PASS\nexecution: ${feature(name).meta?.executionId}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
  await report("testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report("review-report");
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-ship-"));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "pipe" });
  writeFileSync(join(root, "package.json"), '{"name":"x","version":"9.9.9"}');
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "commit", "-qm", "init"], { stdio: "pipe" });
  execFileSync("git", ["init", "-q", "--bare", join(scratch, "remote.git")], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "remote", "add", "origin", join(scratch, "remote.git")], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "push", "-qu", "origin", "HEAD"], { stdio: "pipe" });
  ensureWorksStructure(root);
  fakeGh();
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_LOG;
  delete process.env.GH_STATE;
  await rm(scratch, { recursive: true, force: true });
});

describe("schema: shipping stage (TC-001)", () => {
  it("sits between review and dones with correct maps", () => {
    expect(STAGES).toEqual(["brainstorm", "planning", "backlog", "implementation", "testing", "review", "shipping", "dones", "cancelled"]);
    expect(TRANSITIONS.review).toContain("shipping");
    expect(TRANSITIONS.review).toContain("dones");
    expect(TRANSITIONS.shipping).toEqual(["dones"]);
    expect(STAGE_GATES.shipping).toEqual([]);
    expect(STAGE_INDEX.shipping).toBe(6);
    expect(STAGE_INDEX.dones).toBe(7);
  });
});

describe("stage gate into shipping (TC-002, TC-003)", () => {
  it("review + PASS enters shipping", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    const res = await cmdStage(args("stage", ["demo", "shipping"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("shipping");
  });

  it("creates a missing shipping directory before the move", async () => {
    await writeCfg({ enabled: false });
    await shipReadyItem();
    rmSync(join(root, ".works", "shipping"), { recursive: true, force: true });
    const res = await cmdStage(args("stage", ["demo", "shipping"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("shipping");
    expect(existsSync(join(root, ".works", "shipping", feature().folder))).toBe(true);
  });

  it("refuses without a PASS report and from other stages", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    // FAIL review blocks entry
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: FAIL\nexecution: ${feature().meta?.executionId}\n---\n# Review\nNo.`);
    const fail = await cmdStage(args("stage", ["demo", "shipping"]), root);
    expect(fail.code).toBe(1);
    expect(feature().stage).toBe("review");
    // non-review stages have no edge at all
    const early = await cmdNew(args("new", ["early"], { context: "app" }), root);
    expect(early.code).toBe(0);
    const res = await cmdStage(args("stage", ["early", "shipping"]), root);
    expect(res.code).toBe(1);
    expect(feature("early").stage).toBe("brainstorm");
  });
});

describe("ship config parse (TC-004)", () => {
  it("defaults absent block; validates fields", async () => {
    await writeCfg();
    expect(readProjectConfig(root).ship).toEqual({ enabled: false, merge: "manual", release: false, changelog: false });
    await writeCfg({ enabled: true, merge: "auto", release: true, changelog: true });
    expect(readProjectConfig(root).ship).toEqual({ enabled: true, merge: "auto", release: true, changelog: true });
    await writeCfg({ merge: "now" });
    expect(() => readProjectConfig(root)).toThrow(/ship/);
  });
});

describe("kf ship pipeline (TC-005..TC-007)", () => {
  it("refuses outside shipping and prints the manual checklist when disabled", async () => {
    await writeCfg(); // no ship block
    await shipReadyItem();
    const wrong = await cmdShip(args("ship", ["demo"]), root);
    expect(wrong.code).toBe(1);
    expect(wrong.stdout).toContain("shipping");
    await cmdStage(args("stage", ["demo", "shipping"]), root);
    const off = await cmdShip(args("ship", ["demo"]), root);
    expect(off.code).toBe(1);
    expect(off.stdout).toContain("Manual ship checklist");
    expect(feature().meta!.ship).toBeUndefined();
  });

  it("publishes once, waits on manual merge, resumes to release+changelog after merge", async () => {
    await writeCfg({ enabled: true, merge: "manual", release: true, changelog: true });
    await shipReadyItem();
    await cmdStage(args("stage", ["demo", "shipping"]), root);

    const first = await cmdShip(args("ship", ["demo"]), root);
    expect(first.code, first.stdout).toBe(0);
    expect(first.stdout).toContain("PR opened");
    expect(first.stdout).toContain("waiting");
    expect(feature().meta!.pr).toBe("https://github.com/o/r/pull/7");
    expect(ghLog()).toContain("pr create");
    expect(ghLog()).toContain("pr view");

    // second run: no duplicate publish; still waiting while OPEN
    const second = await cmdShip(args("ship", ["demo"]), root);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("already recorded");
    expect(ghLog().match(/pr create/g)).toHaveLength(1);

    // human merges → resume runs release + changelog
    process.env.GH_STATE = "MERGED";
    const third = await cmdShip(args("ship", ["demo"]), root);
    expect(third.code, third.stdout).toBe(0);
    expect(third.stdout).toContain("Ship complete");
    expect(ghLog()).toContain("release create");
    expect(feature().meta!.ship).toMatchObject({ release: "done", releaseTag: "v9.9.9", changelog: "done" });
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toContain("demo");
  });

  it("auto merge schedules once; flags skip release/changelog", async () => {
    await writeCfg({ enabled: true, merge: "auto", release: true, changelog: true });
    await shipReadyItem();
    await cmdStage(args("stage", ["demo", "shipping"]), root);
    const r1 = await cmdShip(args("ship", ["demo"]), root);
    expect(r1.code).toBe(0);
    expect(ghLog()).toContain("pr merge https://github.com/o/r/pull/7 -R o/r --auto --squash");
    const r2 = await cmdShip(args("ship", ["demo"]), root);
    expect(r2.stdout).toContain("already scheduled");
    expect(ghLog().match(/pr merge/g)).toHaveLength(1);
    process.env.GH_STATE = "MERGED";
    const r3 = await cmdShip(args("ship", ["demo"], { "skip-release": true, "skip-changelog": true }), root);
    expect(r3.code).toBe(0);
    expect(feature().meta!.ship).toMatchObject({ release: "skipped", changelog: "skipped" });
    expect(ghLog()).not.toContain("release create");
    expect(existsSync(join(root, "CHANGELOG.md"))).toBe(false);
  });
});

describe("archive + sync cover shipping (TC-008, TC-009)", () => {
  it("archive accepts shipping; unmerged recorded PR still refuses; review→dones direct works", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem("a");
    await shipReadyItem("b");
    await cmdStage(args("stage", ["a", "shipping"]), root);
    // recorded PR still open → refuse from shipping
    const { writeFeatureMeta } = await import("../workflow/features.js");
    await writeFeatureMeta(feature("a").dir, { ...feature("a").meta!, pr: "https://github.com/o/r/pull/7" });
    process.env.GH_STATE = "OPEN";
    const refuse = await cmdArchive(args("archive", ["a"]), root);
    expect(refuse.code).toBe(1);
    expect(feature("a").stage).toBe("shipping");
    // merged → archives from shipping
    process.env.GH_STATE = "MERGED";
    await writeFile(join(feature("a").dir, ARTIFACTS["feature-report"].file), "# Report\nShipped.");
    const ok = await cmdArchive(args("archive", ["a"]), root);
    expect(ok.code, ok.stdout).toBe(0);
    expect(feature("a").stage).toBe("dones");
    // review → dones direct still works (non-code path)
    await writeFile(join(feature("b").dir, ARTIFACTS["feature-report"].file), "# Report\nDone.");
    const direct = await cmdArchive(args("archive", ["b"]), root);
    expect(direct.code, direct.stdout).toBe(0);
    expect(feature("b").stage).toBe("dones");
  });

  it("kf sync sweeps shipping items with merged PRs", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    await cmdStage(args("stage", ["demo", "shipping"]), root);
    const { writeFeatureMeta } = await import("../workflow/features.js");
    await writeFeatureMeta(feature().dir, { ...feature().meta!, pr: "https://github.com/o/r/pull/7" });
    process.env.GH_STATE = "MERGED";
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Report\nDone.");
    const res = await cmdSync(args("sync"), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("archived");
    expect(feature().stage).toBe("dones");
  });

  it("cancel from shipping returns via its recorded stage", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    await cmdStage(args("stage", ["demo", "shipping"]), root);
    const res = await cmdCancel(args("cancel", ["demo"], { reason: "no longer needed" }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("cancelled");
    expect(feature().meta!.cancellation!.fromStage).toBe("shipping");
  });
});
