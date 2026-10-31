import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
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
import { parseArgsCli, type ParsedArgs } from "../cli/args.js";
import { PKG_ROOT } from "../shared/paths.js";

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
  "pr view"*) echo "{\\"state\\":\\"\${GH_STATE:-OPEN}\\",\\"headRefName\\":\\"kf/stub\\",\\"headRefOid\\":\\"0123456789abcdef0123456789abcdef01234567\\"}";;
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

/** Drive an item to review with a PASS pair — the stage that now awaits the merge. */
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
      `---\nstatus: PASS\nexecution: ${feature(name).meta?.executionId}\n${id === "review-report" ? "ci: none\nlanding: none\n" : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
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

describe("schema: no shipping stage (TC-001)", () => {
  it("review hands straight to done with correct maps", () => {
    expect(STAGES).toEqual(["brainstorm", "planning", "backlog", "implementation", "testing", "review", "done", "cancelled"]);
    expect(TRANSITIONS.review).toEqual(["done", "implementation", "planning"]);
    expect(STAGE_GATES.done).toEqual([]);
    expect(STAGE_INDEX.review).toBe(5);
    expect(STAGE_INDEX.done).toBe(6);
  });
});

describe("legacy stage names refuse with a hint (TC-002, TC-003)", () => {
  it("kf stage <x> shipping exits 1 with the shipping hint and moves nothing", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    const res = await cmdStage(args("stage", ["demo", "shipping"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("shipping is gone: open the PR at review, merge on GitHub, kf status closes the item");
    expect(feature().stage).toBe("review");
    expect(existsSync(join(root, ".works", "shipping"))).toBe(false);
  });

  it("kf stage <x> dones exits 1 with the dones hint and moves nothing", async () => {
    await writeCfg({ enabled: false });
    await shipReadyItem();
    const res = await cmdStage(args("stage", ["demo", "dones"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("the stage is now done: a review PASS item closes on merge via kf status, kf sync or kf archive");
    expect(feature().stage).toBe("review");
    expect(existsSync(join(root, ".works", "dones"))).toBe(false);
  });

  it("kf stage <x> constructor is an unknown stage, not a legacy hint", async () => {
    await writeCfg({ enabled: false });
    await shipReadyItem();
    for (const name of ["constructor", "toString", "__proto__"]) {
      const res = await cmdStage(args("stage", ["demo", name]), root);
      expect(res.code).toBe(1);
      expect(res.stderr).toBe("unknown stage");
      expect(res.stdout).toBe(`Unknown stage '${name}'. Stages: ${STAGES.join(" → ")}`);
    }
    expect(feature().stage).toBe("review");
  });

  it("refuses done without a PASS report and from other stages", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    // FAIL review blocks entry
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: FAIL\nexecution: ${feature().meta?.executionId}\n---\n# Review\nNo.`);
    const fail = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(fail.code).toBe(1);
    expect(feature().stage).toBe("review");
    // non-review stages have no edge at all
    const early = await cmdNew(args("new", ["early"], { context: "app" }), root);
    expect(early.code).toBe(0);
    const res = await cmdStage(args("stage", ["early", "done"]), root);
    expect(res.code).toBe(1);
    expect(feature("early").stage).toBe("brainstorm");
  });
});

describe("a leftover ship config block is tolerated (TC-004)", () => {
  it("reads past any ship block shape without throwing and exposes nothing", async () => {
    for (const ship of [{ enabled: true, merge: "auto", release: true, changelog: true }, { merge: "now" }, { enabled: "yes" }]) {
      await writeCfg(ship);
      const cfg = readProjectConfig(root);
      expect(cfg.repository).toBe("o/r");
      expect(Object.hasOwn(cfg, "ship")).toBe(false);
    }
  });
});

describe("kf ship is a deprecated alias (TC-018)", () => {
  const DEPRECATED = "kf ship is deprecated: review opens the PR; merge on GitHub; kf status closes the item";

  it("exits 1 with the pointer for both spellings and old flags, and writes nothing", async () => {
    await writeCfg({ enabled: true, merge: "auto", release: true, changelog: true });
    await shipReadyItem();
    // A local commit the remote lacks, so a push would be visible on the remote ref.
    writeFileSync(join(root, "change.txt"), "x");
    execFileSync("git", ["-C", root, "add", "change.txt"], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "commit", "-qm", "change"], { stdio: "pipe" });
    const remoteHead = () => execFileSync("git", ["--git-dir", join(scratch, "remote.git"), "rev-parse", "HEAD"], { encoding: "utf8" });
    const before = remoteHead();
    const metaFile = join(feature().dir, ".kfw.json");
    const metaBefore = readFileSync(metaFile, "utf8");
    const configBefore = readFileSync(join(root, ".kf", "config.json"), "utf8");

    const invocations = [
      parseArgsCli(["ship", "demo"]),
      parseArgsCli(["feature", "ship", "demo"]),
      parseArgsCli(["ship", "demo", "--draft", "--skip-release", "--skip-changelog"]),
      parseArgsCli(["ship"]),
    ];
    for (const parsed of invocations) {
      expect(parsed.command).toBe("ship");
      const res = await cmdShip(parsed, root);
      expect(res.code).toBe(1);
      expect(res.stdout).toBe(DEPRECATED);
    }

    expect(ghLog()).toBe("");
    expect(remoteHead()).toBe(before);
    expect(readFileSync(metaFile, "utf8")).toBe(metaBefore);
    expect(readFileSync(join(root, ".kf", "config.json"), "utf8")).toBe(configBefore);
    expect(feature().stage).toBe("review");
    expect(existsSync(join(root, "CHANGELOG.md"))).toBe(false);
  });

  it("an item stamped by the old pipeline still loads with its meta.ship", async () => {
    await writeCfg();
    await shipReadyItem();
    const { writeFeatureMeta } = await import("../workflow/features.js");
    const stamp = { published: "2026-01-01T00:00:00Z", merged: "2026-01-02T00:00:00Z", release: "done" as const, releaseTag: "v1.0.0", changelog: "skipped" as const };
    await writeFeatureMeta(feature().dir, { ...feature().meta!, ship: stamp });
    expect(feature().meta!.ship).toEqual(stamp);
  });

  it("the shipping pipeline source is gone from the tree", () => {
    expect(existsSync(join(PKG_ROOT, "src", "ship"))).toBe(false);
  });
});

describe("archive + sync from review (TC-008, TC-009)", () => {
  it("unmerged recorded PR refuses at review; merged archives; review→done direct works", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem("a");
    await shipReadyItem("b");
    // recorded PR still open → refuse from review
    const { writeFeatureMeta } = await import("../workflow/features.js");
    await writeFeatureMeta(feature("a").dir, { ...feature("a").meta!, pr: "https://github.com/o/r/pull/7" });
    process.env.GH_STATE = "OPEN";
    const refuse = await cmdArchive(args("archive", ["a"]), root);
    expect(refuse.code).toBe(1);
    expect(feature("a").stage).toBe("review");
    // merged → archives from review
    process.env.GH_STATE = "MERGED";
    await writeFile(join(feature("a").dir, ARTIFACTS["feature-report"].file), "# Report\nShipped.");
    const ok = await cmdArchive(args("archive", ["a"]), root);
    expect(ok.code, ok.stdout).toBe(0);
    expect(feature("a").stage).toBe("done");
    // review → done direct still works (non-code path)
    await writeFile(join(feature("b").dir, ARTIFACTS["feature-report"].file), "# Report\nDone.");
    const direct = await cmdArchive(args("archive", ["b"]), root);
    expect(direct.code, direct.stdout).toBe(0);
    expect(feature("b").stage).toBe("done");
  });

  it("kf sync sweeps review items with merged PRs", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    const { writeFeatureMeta } = await import("../workflow/features.js");
    await writeFeatureMeta(feature().dir, { ...feature().meta!, pr: "https://github.com/o/r/pull/7" });
    process.env.GH_STATE = "MERGED";
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Report\nDone.");
    const res = await cmdSync(args("sync"), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("archived");
    expect(feature().stage).toBe("done");
  });

  it("cancel from review returns via its recorded stage", async () => {
    await writeCfg({ enabled: true });
    await shipReadyItem();
    const res = await cmdCancel(args("cancel", ["demo"], { reason: "no longer needed" }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("cancelled");
    expect(feature().meta!.cancellation!.fromStage).toBe("review");
  });
});
