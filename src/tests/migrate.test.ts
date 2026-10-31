import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, mkdir, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdSync } from "../cli/commands/sync.js";
import { ensureWorksStructure, findFeature, listFeatures, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const statusAll = (options: Record<string, unknown> = {}): ParsedArgs => ({ command: "status", positionals: [], options: { all: true, ...options } });
const syncArgs: ParsedArgs = { command: "sync", positionals: [], options: {} };

let root: string;
let prevPath: string | undefined;

/** gh stub — per-PR state via GH_PR_STATE_<num> (falling back to GH_PR_STATE, default MERGED). */
const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr)
    if [ "$2" = view ]; then
      num="\${3##*/}"
      state=$(printenv "GH_PR_STATE_$num"); state="\${state:-\${GH_PR_STATE:-MERGED}}"
      printf '{"state":"%s","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n' "$state"
    fi; exit 0 ;;
esac
exit 0
`;

const TS = "20260101_0000";
const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
const feature = (name: string) => findFeature(root, name)!;
const works = (...p: string[]) => join(root, ".works", ...p);
const folders = (stage: string) => (existsSync(works(stage)) ? readdirSync(works(stage)).sort() : []);
const migrationLines = (out: string) => out.split("\n").filter((l) => l.includes("migrated") || l.includes("left in"));

/** A PASS report as the previous release wrote it: status and execution only, no ci or landing. */
async function report(name: string, id: "testing-result" | "review-report"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/** A bug driven to a review PASS with a recorded PR, then parked in `.works/shipping` as an earlier release left it. */
async function shippingBug(name: string, pr: string): Promise<string> {
  expect((await cmdNew({ command: "new", positionals: [name], options: { context: "app", type: "bug" } }, root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), bugSpec);
  for (const to of ["planning", "approve", "testing", "review"]) {
    if (to === "approve") expect((await cmdApprove({ command: "approve", positionals: [name], options: {} }, root)).code).toBe(0);
    else expect((await cmdStage({ command: "stage", positionals: [name, to], options: {} }, root)).code).toBe(0);
    if (to === "testing") await report(name, "testing-result");
  }
  await writeFeatureMeta(feature(name).dir, { ...readFeatureMeta(feature(name).dir)!, pr });
  await report(name, "review-report");
  const { dir, folder } = feature(name);
  await mkdir(works("shipping"), { recursive: true });
  await rename(dir, works("shipping", folder));
  return folder;
}

/** A bare legacy folder with a `.kfw.json`, as an earlier release wrote it. */
async function seedLegacy(stage: string, name: string, meta: Record<string, unknown> = {}): Promise<string> {
  const dir = works(stage, `${name}_${TS}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".kfw.json"), JSON.stringify({
    schema: "kanban-flow", feature: name, context: "app", created: TS, kind: "bug", ...meta,
  }, null, 2));
  return dir;
}

/** History that names both legacy stages, the way items archived by earlier releases carry it. */
const legacyHistory = {
  bypasses: [{ at: TS, from: "review", to: "dones", flag: "force", codes: ["review_not_pass"] }],
  runs: [{ id: "r1", role: "shipper", runner: "claude", stage: "shipping", mode: "start", at: TS, log: "runs/r1.log", status: "done" }],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-migrate-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
  }));
  const stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of Object.keys(process.env)) if (v.startsWith("GH_")) delete process.env[v];
  await rm(root, { recursive: true, force: true });
});

describe("migrateLegacyStages — one-time move of dones/shipping folders", () => {
  it("kf status --all moves dones/a and shipping/{merged,unmerged}, then a second run prints nothing", async () => {
    const aDir = await seedLegacy("dones", "a", { ...legacyHistory, delivered: true, status: "archived" });
    const aMeta = readFileSync(join(aDir, ".kfw.json"), "utf8");
    const merged = await shippingBug("merged", "https://github.com/o/r/pull/1");
    const unmerged = await shippingBug("unmerged", "https://github.com/o/r/pull/2");
    process.env.GH_PR_STATE_2 = "OPEN";

    const first = await cmdStatus(statusAll(), root);
    expect(first.code).toBe(0);
    expect(migrationLines(first.stdout)).toEqual([
      `migrated a_${TS}: .works/dones → .works/done`,
      `migrated ${merged}: .works/shipping → .works/done (PR merged)`,
      `migrated ${unmerged}: .works/shipping → .works/review (PR open)`,
    ]);
    expect(folders("done")).toEqual([`a_${TS}`, merged].sort());
    expect(folders("review")).toEqual([unmerged]);
    expect(existsSync(works("dones"))).toBe(false);
    expect(existsSync(works("shipping"))).toBe(false);
    // The stage is the folder: a dones item's metadata, history included, is carried over byte for byte.
    expect(readFileSync(works("done", `a_${TS}`, ".kfw.json"), "utf8")).toBe(aMeta);
    // The merged item closed through archiveItem, so it carries the delivery stamp.
    expect(readFeatureMeta(feature("merged").dir)).toMatchObject({ delivered: true, status: "archived" });
    expect(feature("unmerged").meta?.delivered).toBeUndefined();

    const before = { done: folders("done"), review: folders("review") };
    const second = await cmdStatus(statusAll(), root);
    expect(second.code).toBe(0);
    expect(migrationLines(second.stdout)).toEqual([]);
    expect({ done: folders("done"), review: folders("review") }).toEqual(before);
  });

  it("a legacy dones item whose history lists dones and shipping loads, before and after the move", async () => {
    await seedLegacy("dones", "legacy", legacyHistory);
    // Before migration the legacy folder is not a stage listFeatures walks: invisible, not a throw.
    expect(() => listFeatures(root)).not.toThrow();
    expect(findFeature(root, "legacy")).toBeNull();

    const res = await cmdStatus({ command: "status", positionals: [], options: { change: "legacy" } }, root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`migrated legacy_${TS}: .works/dones → .works/done`);
    const f = feature("legacy");
    expect(f.stage).toBe("done");
    expect(f.metaError).toBeUndefined();
    expect(f.meta?.bypasses).toEqual(legacyHistory.bypasses);
    expect(f.meta?.runs).toEqual(legacyHistory.runs);
  });

  it("removes a legacy dir left with only a stray .DS_Store, after moving its items or with none to move", async () => {
    await seedLegacy("dones", "finder");
    await writeFile(works("dones", ".DS_Store"), "x");
    await mkdir(works("shipping"), { recursive: true });
    await writeFile(works("shipping", ".DS_Store"), "x");

    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(0);
    expect(migrationLines(res.stdout)).toEqual([`migrated finder_${TS}: .works/dones → .works/done`]);
    expect(existsSync(works("dones"))).toBe(false);
    expect(existsSync(works("shipping"))).toBe(false);
  });

  it("keeps a legacy dir that still holds a non-dotfile or a folder", async () => {
    await mkdir(works("dones", ".keep-me"), { recursive: true });
    await mkdir(works("shipping"), { recursive: true });
    await writeFile(works("shipping", "notes.txt"), "mine");

    expect((await cmdStatus(statusAll(), root)).code).toBe(0);
    expect(readdirSync(works("dones"))).toEqual([".keep-me"]);
    expect(readFileSync(works("shipping", "notes.txt"), "utf8")).toBe("mine");
  });

  it("deletes only OS litter: a dir holding a user dotfile is kept whole, one holding .DS_Store and ._ files is removed", async () => {
    await mkdir(works("dones"), { recursive: true });
    await writeFile(works("dones", ".notes.md"), "mine");
    await writeFile(works("dones", ".DS_Store"), "x");
    await mkdir(works("shipping"), { recursive: true });
    await writeFile(works("shipping", ".DS_Store"), "x");
    await writeFile(works("shipping", "._.DS_Store"), "x");

    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(0);
    expect(readFileSync(works("dones", ".notes.md"), "utf8")).toBe("mine");
    expect(readdirSync(works("dones")).sort()).toEqual([".DS_Store", ".notes.md"]);
    expect(existsSync(works("shipping"))).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)("a cleanup the fs refuses is a ⚠ line, not a failed status", async () => {
    await mkdir(works("shipping"), { recursive: true });
    await writeFile(works("shipping", ".DS_Store"), "x");
    await chmod(works("shipping"), 0o555);
    try {
      const res = await cmdStatus(statusAll(), root);
      expect(res.code).toBe(0);
      expect(res.stdout).toMatch(/^⚠ could not remove \.works\/shipping\/: EACCES.* — remove it by hand$/m);
      expect(readdirSync(works("shipping"))).toEqual([".DS_Store"]);
    } finally {
      await chmod(works("shipping"), 0o755);
    }
  });

  it("leaves an item with a live worker run or a live drive in place and reports it", async () => {
    const now = new Date().toISOString();
    await seedLegacy("dones", "busy", {
      runs: [{ id: "r9", role: "developer", runner: "claude", stage: "implementation", mode: "start", at: TS, log: "runs/r9.log", status: "running", pid: process.pid }],
    });
    await seedLegacy("shipping", "driven", {
      pr: "https://github.com/o/r/pull/6",
      drive: { id: "drv", status: "running", step: "review", loops: 0, runs: 1, configHash: "h", supervisorPid: process.pid, startedAt: now, updatedAt: now },
    });

    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(0);
    expect(migrationLines(res.stdout)).toEqual([
      `⚠ busy_${TS} left in .works/dones: worker run r9 is still running — wait for it to end, then re-run kf status --change busy`,
      `⚠ driven_${TS} left in .works/shipping: drive drv is live (supervisor pid ${process.pid}) — wait for it to end, then re-run kf status --change driven`,
    ]);
    expect(folders("dones")).toEqual([`busy_${TS}`]);
    expect(folders("shipping")).toEqual([`driven_${TS}`]);
    expect(folders("done")).toEqual([]);
    expect(folders("review")).toEqual([]);
  });

  it("leaves an item with a dirty worktree in place and reports it", async () => {
    const wt = join(root, "wt-dirty");
    await mkdir(wt, { recursive: true });
    execFileSync("git", ["init", "-q", wt]);
    await writeFile(join(wt, "uncommitted.txt"), "work in progress\n");
    const worktree = { path: wt, branch: "kf/dirty", domain: "dirty.test", port: 5100, createdAt: TS };
    await seedLegacy("shipping", "dirty", { pr: "https://github.com/o/r/pull/3", worktree });

    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(0);
    expect(migrationLines(res.stdout)).toEqual([
      `⚠ dirty_${TS} left in .works/shipping: worktree has uncommitted changes (${wt}) — commit or discard them, then re-run kf status --change dirty`,
    ]);
    expect(folders("shipping")).toEqual([`dirty_${TS}`]);
    expect(folders("review")).toEqual([]);
    expect(folders("done")).toEqual([]);
  });

  it("reports a folder it cannot read with the cause, leaves it in place and exits 1", async () => {
    const dir = works("dones", `broken_${TS}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), "{ not json");

    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(`✗ broken_${TS} left in .works/dones: Invalid JSON in feature metadata`);
    expect(res.stdout).toContain(`— repair or remove .works/dones/broken_${TS}`);
    expect(folders("dones")).toEqual([`broken_${TS}`]);
  });

  it("keeps --json stdout parseable and puts the migration lines on stderr", async () => {
    await seedLegacy("dones", "a");
    const res = await cmdStatus(statusAll({ json: true }), root);
    expect(res.code).toBe(0);
    expect(() => JSON.parse(res.stdout)).not.toThrow();
    expect(res.stderr).toBe(`migrated a_${TS}: .works/dones → .works/done`);
  });

  it("a previous-release PASS report already in review closes on kf status only once its PR is merged", async () => {
    const folder = await shippingBug("legacy", "https://github.com/o/r/pull/5");
    await rename(works("shipping", folder), works("review", folder));
    process.env.GH_PR_STATE_5 = "OPEN";

    expect((await cmdStatus(statusAll(), root)).code).toBe(0);
    expect(feature("legacy").stage).toBe("review");

    delete process.env.GH_PR_STATE_5;
    const res = await cmdStatus(statusAll(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("✓ done legacy (PR merged: https://github.com/o/r/pull/5)");
    expect(feature("legacy").stage).toBe("done");
  });

  it("kf sync runs the migration first; an unverifiable PR lands in review", async () => {
    await seedLegacy("dones", "a");
    await seedLegacy("shipping", "noverify", { pr: "https://github.com/o/r/pull/4" });
    await writeFile(join(root, "stubbin", "gh"), "#!/usr/bin/env bash\necho boom >&2\nexit 1\n", { mode: 0o755 });

    const res = await cmdSync(syncArgs, root);
    expect(migrationLines(res.stdout)).toEqual([
      `migrated a_${TS}: .works/dones → .works/done`,
      `migrated noverify_${TS}: .works/shipping → .works/review (PR https://github.com/o/r/pull/4 unverifiable: boom)`,
    ]);
    expect(feature("noverify").stage).toBe("review");
    expect(feature("a").stage).toBe("done");
  });
});
