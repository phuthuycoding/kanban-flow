import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, realpathSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, findWorksRoot } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdWorktree } from "../cli/commands/worktree.js";
import { worktreeConfig, parseWorktreeConfig, slugify } from "../worktree/config.js";
import { addRoute, readRoutes, removeRoute } from "../worktree/routes.js";
import { allocatePort, listWorktrees } from "../worktree/manager.js";
import { writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
let scratch: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const wtCfg = () => worktreeConfig(root, {
  enabled: true,
  baseDir: join(scratch, "wts"),
  routesFile: join(scratch, "routes.json"),
});

async function writeCfg(worktree: Record<string, unknown> = { enabled: true }): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x",
    worktree: { baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json"), ...worktree },
  }));
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-wt-"));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "pipe" });
  writeFileSync(join(root, ".gitignore"), ".works/\n");
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "commit", "-qm", "init"], { stdio: "pipe" });
  ensureWorksStructure(root);
  await writeCfg();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const feature = (name = "demo") => findFeature(root, name)!;

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.";

/** Drive an item to approved planning, ready for the implementation transition. */
async function approvedItem(name = "demo"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
}

/** A full lifecycle fixture: item in review with a PASS pair, worktree present. */
async function reviewReadyItem(name = "demo"): Promise<void> {
  await approvedItem(name);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 1 passed |\n";
  const report = async (id: "testing-result" | "review-report") =>
    writeFile(join(feature(name).dir, ARTIFACTS[id].file),
      `---\nstatus: PASS\nexecution: ${feature(name).meta?.executionId}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
  await report("testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report("review-report");
}

describe("worktree config", () => {
  it("defaults and validates the worktree block", () => {
    expect(worktreeConfig("/r/my-repo", undefined)).toMatchObject({
      enabled: true, branchPrefix: "kf/", portBase: 5100, baseDomain: "my-repo.test",
    });
    expect(worktreeConfig("/r/my-repo", { enabled: false, portBase: 6000 }).enabled).toBe(false);
    expect(() => parseWorktreeConfig({ portBase: "abc" }, "f")).toThrow(/portBase/);
    expect(() => parseWorktreeConfig({ enabled: "yes" }, "f")).toThrow(/enabled/);
    expect(() => parseWorktreeConfig("nope", "f")).toThrow(/worktree must be an object/);
  });

  it("slugifies into DNS-safe domains", () => {
    expect(slugify("My Feature_X")).toBe("my-feature-x");
    const cfg = worktreeConfig(root, { baseDomain: "repo.test" });
    expect(`${slugify("Demo Feat")}.${cfg.baseDomain}`).toBe("demo-feat.repo.test");
    expect(() => slugify("!!!")).toThrow(/DNS-safe/);
  });
});

describe("routes file + port allocation", () => {
  it("writes atomically and reports used ports", async () => {
    const file = join(scratch, "routes.json");
    await addRoute(file, "a.b.test", { port: 5100, repo: root, item: "a", createdAt: "t" });
    await addRoute(file, "c.d.test", { port: 5102, repo: root, item: "c", createdAt: "t" });
    expect(readRoutes(file).routes["a.b.test"].port).toBe(5100);
    expect(await removeRoute(file, "a.b.test")).toBe(true);
    expect(readRoutes(file).routes["a.b.test"]).toBeUndefined();
    expect(await removeRoute(file, "a.b.test")).toBe(false);
    expect(() => { writeFileSync(file, "{"); readRoutes(file); }).toThrow(/Invalid JSON.*routes/);
  });

  it("skips ports claimed by registries and the routes file", async () => {
    const routesFile = join(scratch, "routes.json");
    await addRoute(routesFile, "x.test", { port: 5101, repo: "other", item: "x", createdAt: "t" });
    await cmdNew(args("new", ["demo"], { context: "app" }), root);
    await writeFeatureMeta(feature().dir, {
      ...feature().meta!, worktree: { path: "/p", branch: "kf/demo", domain: "d.test", port: 5100, createdAt: "t" },
    });
    const cfg = worktreeConfig(root, { portBase: 5100, routesFile });
    expect(allocatePort(root, cfg)).toBe(5102);
  });
});

describe("stage → implementation provisions the worktree (FR-001, FR-002)", () => {
  it("creates worktree + branch + route + registry on the transition", async () => {
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code, res.stdout).toBe(0);
    const wt = feature().meta!.worktree!;
    expect(wt.branch).toBe("kf/demo");
    expect(wt.domain).toBe("demo.repo.test");
    expect(wt.port).toBe(5100);
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "worktree", "list", "--porcelain")).toContain(wt.path);
    expect(readRoutes(join(scratch, "routes.json")).routes["demo.repo.test"].port).toBe(5100);
    expect(res.stdout).toContain(wt.path);

    // idempotent re-run
    const again = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(again.code).toBe(0);
    expect(readRoutes(join(scratch, "routes.json")).routes["demo.repo.test"].port).toBe(5100);
  });

  it("fails closed when the repo is not git", async () => {
    const plain = join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    ensureWorksStructure(plain);
    await mkdir(join(plain, ".kf"), { recursive: true });
    await writeFile(join(plain, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true } }));
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), plain)).code).toBe(0);
    await writeFile(join(findFeature(plain, "demo")!.dir, ARTIFACTS["spec-requirement"].file), spec);
    await cmdStage(args("stage", ["demo", "planning"]), plain);
    for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
      await writeFile(join(findFeature(plain, "demo")!.dir, ARTIFACTS[id].file), "# Contract\nUC-001: x");
    }
    await mkdir(join(findFeature(plain, "demo")!.dir, "use-cases"), { recursive: true });
    await writeFile(join(findFeature(plain, "demo")!.dir, "use-cases", "UC-001.md"), "# UC-001 x");
    await writeFile(join(findFeature(plain, "demo")!.dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nx\n");
    await cmdApprove(args("approve", ["demo"]), plain);
    const res = await cmdStage(args("stage", ["demo", "implementation"]), plain);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("worktree.enabled");
    expect(findFeature(plain, "demo")!.stage).toBe("planning");
  });

  it("opt-out config leaves the transition untouched", async () => {
    await writeCfg({ enabled: false });
    await approvedItem();
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect(feature().meta!.worktree).toBeUndefined();
  });
});

describe("reuse on re-entry (FR-001, FR-002, UC-006)", () => {
  it("keeps path/port/domain on re-enter; rebuilds a deleted worktree from its branch", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const first = feature().meta!.worktree!;

    // loop back and forward again — same registration survives
    await cmdStage(args("stage", ["demo", "planning"], { force: true }), root);
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(feature().meta!.worktree).toMatchObject({ path: first.path, port: first.port, domain: first.domain });

    // delete the worktree by hand → next create rebuilds it from kf/demo
    git(root, "worktree", "remove", "--force", first.path);
    expect(existsSync(first.path)).toBe(false);
    const res = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(first.path)).toBe(true);
  });

  it("refuses a branch that exists but is not managed", async () => {
    git(root, "branch", "kf/demo");
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not managed");
    expect(feature().stage).toBe("planning");
  });
});

describe("kf works from inside the worktree (FR-003)", () => {
  it("findWorksRoot resolves the main checkout via git common dir", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const wt = feature().meta!.worktree!.path;
    await mkdir(join(wt, "src", "deep"), { recursive: true });
    // git canonicalizes paths — compare against the real path of the main checkout
    expect(findWorksRoot(join(wt, "src", "deep"))).toBe(realpathSync(root));
    expect(findWorksRoot("/")).toBeNull();
  });

  it("status runs from the worktree cwd and shows the environment", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const wt = feature().meta!.worktree!.path;
    await mkdir(join(wt, "sub", "dir"), { recursive: true });
    const res = await cmdStatus(args("status", [], { change: "demo" }), join(wt, "sub", "dir"));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("demo.repo.test");
    expect(res.stdout).toContain("127.0.0.1:5100");
    // artifacts still belong to the main checkout
    expect(existsSync(join(wt, ".works"))).toBe(false);
  });
});

describe("worktree lifecycle hooks", () => {
  it("worktree-create runs inside the fresh worktree with KFW_WORKTREE_* env", async () => {
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "worktree-create.sh"),
      '#!/bin/sh\necho "$KFW_WORKTREE_DOMAIN:$KFW_WORKTREE_PORT:$KFW_WORKTREE_BRANCH" > "$KFW_WORK_ROOT/create.out"\npwd >> "$KFW_WORK_ROOT/create.out"\n');
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code, res.stdout).toBe(0);
    const out = readFileSync(join(root, "create.out"), "utf8");
    expect(out).toContain("demo.repo.test:5100:kf/demo");
    expect(out).toContain(feature().meta!.worktree!.path);
    // re-entry reuses the worktree — the hook does not re-fire
    await rm(join(root, "create.out"));
    await cmdStage(args("stage", ["demo", "planning"], { force: true }), root);
    await cmdApprove(args("approve", ["demo"]), root);
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(existsSync(join(root, "create.out"))).toBe(false);
  });

  it("a failing worktree-create hook blocks the transition and cleans up fully", async () => {
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "worktree-create.sh"), "exit 3\n");
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("worktree-create");
    expect(feature().stage).toBe("planning");
    expect(existsSync(join(scratch, "wts", "demo"))).toBe(false);
    // branch must be rolled back too — a retry must not trip the unmanaged-branch refusal
    expect(git(root, "branch", "--list", "kf/demo")).toBe("");
    await rm(join(root, ".kf", "hooks", "worktree-create.sh"));
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
  });

  it("worktree-remove runs before teardown; its failure is a warning, not a blocker", async () => {
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "worktree-remove.sh"),
      '#!/bin/sh\necho removed > "$KFW_WORK_ROOT/removed.out"\nexit 2\n');
    await reviewReadyItem();
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature Report\nShipped.");
    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(readFileSync(join(root, "removed.out"), "utf8")).toContain("removed");
    expect(res.stdout).toContain("worktree-remove hook failed");
  });
});

describe("teardown (FR-007, FR-008)", () => {
  it("archive removes worktree + route, keeps branch, warns on unmerged commits", async () => {
    await reviewReadyItem();
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature Report\nShipped.");
    const wt = feature().meta!.worktree!;
    git(wt.path, "config", "user.email", "t@t");
    git(wt.path, "config", "user.name", "t");
    writeFileSync(join(wt.path, "new-file.txt"), "work");
    git(wt.path, "add", ".");
    git(wt.path, "commit", "-qm", "wip");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(existsSync(wt.path)).toBe(false);
    expect(readRoutes(join(scratch, "routes.json")).routes["demo.repo.test"]).toBeUndefined();
    expect(git(root, "branch", "--list", "kf/demo")).toContain("kf/demo");
    expect(res.stdout).toMatch(/unmerged|not merged/);
    expect(feature().stage).toBe("dones");
    expect(feature().meta!.worktree).toBeUndefined();
  });

  it("archive refuses a dirty worktree; worktree remove --force cleans it", async () => {
    await reviewReadyItem();
    await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature Report\nShipped.");
    const wt = feature().meta!.worktree!;
    writeFileSync(join(wt.path, "dirty.txt"), "uncommitted");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("uncommitted");
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);

    const rm = await cmdWorktree(args("worktree", ["remove", "demo"], { force: true }), root);
    expect(rm.code, rm.stdout).toBe(0);
    expect(existsSync(wt.path)).toBe(false);
    expect(git(root, "branch", "--list", "kf/demo")).toContain("kf/demo");
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
  });

  it("cancel tears down a clean worktree and refuses a dirty one", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const wt = feature().meta!.worktree!;

    const dirty = await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root);
    expect(dirty.code).toBe(0); // clean → ok
    expect(existsSync(wt.path)).toBe(false);
    expect(readRoutes(join(scratch, "routes.json")).routes["demo.repo.test"]).toBeUndefined();
    expect(git(root, "branch", "--list", "kf/demo")).toContain("kf/demo");
    expect(feature().stage).toBe("cancelled");
    expect(feature().meta!.worktree).toBeUndefined();
  });

  it("cancel refuses while dirty", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    writeFileSync(join(feature().meta!.worktree!.path, "dirty.txt"), "x");
    const res = await cmdCancel(args("cancel", ["demo"], { reason: "x" }), root);
    expect(res.code).toBe(1);
    expect(feature().stage).toBe("implementation");
  });

  it("worktree list reports items and all three orphan kinds", async () => {
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const wt = feature().meta!.worktree!;

    // orphan kind 1: registry → missing worktree dir
    git(root, "worktree", "remove", "--force", wt.path);
    // orphan kind 2: git worktree with kf/ branch but no registry
    git(root, "worktree", "add", "-b", "kf/loose", join(scratch, "wts", "loose"));
    // orphan kind 3: route pointing at an item with no registry
    await addRoute(join(scratch, "routes.json"), "ghost.repo.test", { port: 5999, repo: root, item: "ghost", createdAt: "t" });

    const res = await cmdWorktree(args("worktree", ["list"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("missing");
    expect(res.stdout).toContain("unmanaged-worktree");
    expect(res.stdout).toContain("stale-route");
    const json = await cmdWorktree(args("worktree", ["list"], { json: true }), root);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.orphans).toHaveLength(3);
    const { items, orphans } = listWorktrees(root, wtCfg());
    expect(items).toHaveLength(1);
    expect(orphans.map((o) => o.kind).sort()).toEqual(["missing-worktree", "stale-route", "unmanaged-worktree"]);
  });
});
