import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdWorktree } from "../cli/commands/worktree.js";
import { readRoutes } from "../worktree/routes.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
let scratch: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

async function writeCfg(worktree: Record<string, unknown>): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x",
    worktree: {
      enabled: true,
      baseDomain: "app.test",
      baseDir: join(scratch, "wts"),
      routesFile: join(scratch, "routes.json"),
      ...worktree,
    },
  }));
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-wtd-"));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "pipe" });
  writeFileSync(join(root, ".gitignore"), ".works/\n");
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "commit", "-qm", "init"], { stdio: "pipe" });
  ensureWorksStructure(root);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const feature = (name = "demo") => findFeature(root, name)!;

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";

/** Drive an item to approved backlog, ready for the implementation transition. */
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
  expect((await cmdApprove(args("approve", [name], { backlog: true }), root)).code).toBe(0);
}

const DOMAIN = "demo.app.test";
const PORT = 5100;

describe("worktree output with domains off", () => {
  it("the transition note shows the direct URL and no domain line", async () => {
    await writeCfg({ domains: false });
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`\n  Direct:   http://127.0.0.1:${PORT}`);
    expect(res.stdout).not.toContain("Domain:");
    expect(res.stdout).not.toContain(".test");
  });

  it("status shows the direct URL and no domain line", async () => {
    await writeCfg({ domains: false });
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const res = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toContain(`Direct:   http://127.0.0.1:${PORT}`);
    expect(res.stdout).not.toContain("Domain:");
    expect(res.stdout).not.toContain(".test");
  });

  it("worktree create prints direct only", async () => {
    await writeCfg({ domains: false });
    await approvedItem();
    const res = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout.split("\n")).toContain(`  direct: http://127.0.0.1:${PORT}`);
    expect(res.stdout).not.toContain("domain:");
    expect(res.stdout).not.toContain(".test");
  });

  it("worktree list prints direct only and keeps the route and the stored domain", async () => {
    await writeCfg({ domains: false });
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const res = await cmdWorktree(args("worktree", ["list"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`  direct: http://127.0.0.1:${PORT}`);
    expect(res.stdout).not.toContain("domain:");
    expect(res.stdout).not.toContain(".test");
    // registration and routing are unchanged by the switch
    expect(feature().meta!.worktree).toMatchObject({ port: PORT, domain: DOMAIN });
    expect(readRoutes(join(scratch, "routes.json")).routes[DOMAIN]).toMatchObject({ port: PORT });
  });

  it("json outputs still carry the domain", async () => {
    await writeCfg({ domains: false });
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    const list = JSON.parse((await cmdWorktree(args("worktree", ["list"], { json: true }), root)).stdout);
    expect(list.items[0]).toMatchObject({ item: "demo", domain: DOMAIN, port: PORT });
    expect(JSON.stringify((await cmdStatus(args("status", [], { change: "demo", json: true }), root)).stdout)).toContain(DOMAIN);
  });

  it("a registration made with domains on prints the direct URL only once the switch is off", async () => {
    await writeCfg({ domains: true });
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    await writeCfg({ domains: false });
    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.stdout.split("\n")).toContain(`Direct:   http://127.0.0.1:${PORT}`);
    expect(status.stdout).not.toContain("Domain:");
    expect(status.stdout).not.toContain(".test");
    const list = await cmdWorktree(args("worktree", ["list"]), root);
    expect(list.stdout).toContain(`  direct: http://127.0.0.1:${PORT}`);
    expect(list.stdout).not.toContain("domain:");
    expect(list.stdout).not.toContain(".test");
  });
});

describe("status with an invalid project config", () => {
  it("falls back to the domain line and reports the config problem", async () => {
    await writeCfg({ domains: true });
    await approvedItem();
    await cmdStage(args("stage", ["demo", "implementation"]), root);
    await writeCfg({ domains: "no" });
    const res = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Domain:   http://");
    const configLine = res.stdout.split("\n").find((l) => l.startsWith("Config:   invalid .kf/config.json — "));
    expect(configLine).toBeDefined();
    expect(configLine).toContain("worktree.domains must be boolean");
  });
});

describe("worktree output with domains on", () => {
  it.each([{}, { domains: true }])("keeps today's exact lines (%j)", async (extra) => {
    await writeCfg(extra);
    await approvedItem();
    const staged = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(staged.code, staged.stdout).toBe(0);
    expect(staged.stdout).toContain(`\n  Domain:   http://${DOMAIN}  (direct: http://127.0.0.1:${PORT})`);
    expect(staged.stdout).not.toContain("Direct:");

    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.stdout.split("\n")).toContain(`Domain:   http://${DOMAIN}  (direct: http://127.0.0.1:${PORT})`);
    expect(status.stdout).not.toContain("Direct:");

    const list = await cmdWorktree(args("worktree", ["list"]), root);
    expect(list.stdout.split("\n")).toContain(`  domain: http://${DOMAIN}  → 127.0.0.1:${PORT}`);
    expect(list.stdout).not.toContain("direct:");
  });

  it("worktree create prints domain then direct", async () => {
    await writeCfg({});
    await approvedItem();
    const res = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines).toContain(`  domain: http://${DOMAIN}`);
    expect(lines).toContain(`  direct: http://127.0.0.1:${PORT}`);
    expect(lines.indexOf(`  domain: http://${DOMAIN}`) + 1).toBe(lines.indexOf(`  direct: http://127.0.0.1:${PORT}`));
  });
});

describe("worktree hook env", () => {
  const dumpHook = '#!/bin/sh\nenv | grep "^KFW_WORKTREE_" | sort > "$KFW_WORK_ROOT/env.out"\n';

  async function runCreateHook(): Promise<string> {
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "worktree-create.sh"), dumpHook);
    await approvedItem();
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code, res.stdout).toBe(0);
    return readFileSync(join(root, "env.out"), "utf8");
  }

  it("omits the domain variable when domains are off", async () => {
    await writeCfg({ domains: false });
    const out = await runCreateHook();
    expect(out).toMatch(/^KFW_WORKTREE_PATH=.+/m);
    expect(out).toContain(`KFW_WORKTREE_PORT=${PORT}`);
    expect(out).toMatch(/^KFW_WORKTREE_BRANCH=.+/m);
    expect(out).not.toContain("KFW_WORKTREE_DOMAIN");
  });

  it("carries all four variables when domains are on", async () => {
    await writeCfg({ domains: true });
    const out = await runCreateHook();
    expect(out).toMatch(/^KFW_WORKTREE_PATH=.+/m);
    expect(out).toContain(`KFW_WORKTREE_PORT=${PORT}`);
    expect(out).toContain(`KFW_WORKTREE_DOMAIN=${DOMAIN}`);
    expect(out).toMatch(/^KFW_WORKTREE_BRANCH=.+/m);
  });
});
