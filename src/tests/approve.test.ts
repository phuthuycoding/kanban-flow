import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { computeStatus, renderStatusText } from "../workflow/status.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { commandHelp } from "../cli/args.js";
import { workflowGuide } from "../cli/commands/autoconfig.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = () => findFeature(root, "demo")!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";

async function writeConfig(extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x",
    worktree: { enabled: true, baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") },
    ...extra,
  }));
}

/** `demo` in planning with a complete contract: the only thing left is `kf approve`. */
async function plannedItem(): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature().dir, ARTIFACTS[id].file), "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

const NO_DECISION_TEXT = [/start now or/i, /start-now vs backlog/i, /ship or archive/i, /ship decision/i, /\(start\) or backlog/i];

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-approve-"));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await writeConfig();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("kf approve starts the item", () => {
  it("moves the item to implementation and provisions its worktree", async () => {
    await plannedItem();
    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    const f = feature();
    expect(f.stage).toBe("implementation");
    expect(f.meta!.approval).toMatchObject({ status: "approved", by: "human" });
    expect(f.meta!.approval!.contractHash).toBeTruthy();
    const wt = f.meta!.worktree!;
    expect(existsSync(wt.path)).toBe(true);
    expect(wt.branch).toBe("t/demo");
    expect(execFileSync("git", ["-C", wt.path, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("t/demo");
    expect(res.stdout).toContain("→ implementation");
    expect(res.stdout).toContain(`Worktree: ${wt.path}`);
    expect(res.stdout).toContain("Next: load the kanban-implement skill for 'demo'");
    for (const re of NO_DECISION_TEXT) expect(res.stdout).not.toMatch(re);
    expect(res.stdout).not.toMatch(/backlog/i);
  });

  it("--backlog parks the item with a valid approval and no worktree", async () => {
    await plannedItem();
    const res = await cmdApprove(args("approve", ["demo"], { backlog: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("backlog");
    expect(feature().meta!.approval!.status).toBe("approved");
    expect(feature().meta!.worktree).toBeUndefined();
    expect(res.stdout).toContain("Next: kf stage demo implementation");
    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.stdout).toContain('Next: kf stage "demo" implementation');
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect(feature().stage).toBe("implementation");
    expect(existsSync(feature().meta!.worktree!.path)).toBe(true);
  });

  it("a failing implementation hook keeps the item in planning and restores the approval", async () => {
    await plannedItem();
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    const hook = join(root, ".kf", "hooks", "implementation.sh");
    await writeFile(hook, "#!/bin/sh\necho 'lint gate is red'\nexit 1\n");
    await chmod(hook, 0o755);
    const before = structuredClone(feature().meta!);
    expect(before.approval).toEqual({ status: "pending" });

    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Approval of 'demo' was not kept");
    expect(res.stdout).toContain("Hook 'implementation' failed (exit 1)");
    expect(res.stdout).toContain("lint gate is red");
    expect(res.stdout).toContain("re-run: kf approve demo");
    expect(res.stdout).not.toContain("--skip-hooks");
    expect(feature().stage).toBe("planning");
    expect(feature().meta).toEqual(before);
    expect(existsSync(join(scratch, "wts"))).toBe(false);
    expect(git("branch", "--list", "t/demo")).toBe("");
  });

  it("a worktree provisioning failure keeps the item in planning and restores the previous approval", async () => {
    git("branch", "t/demo");
    await plannedItem();
    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Approval of 'demo' was not kept");
    expect(res.stdout).toContain("worktree setup failed");
    expect(res.stdout).toContain("not managed");
    expect(feature().stage).toBe("planning");
    expect(feature().meta!.approval).toEqual({ status: "pending" });
    expect(renderStatusText(computeStatus(feature()))).toContain('Next: human approval, then kf approve "demo"');
  });

  it("a refused --backlog move restores the approval; the next approve starts the item", async () => {
    await plannedItem();
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "backlog.sh"), "#!/bin/sh\nexit 1\n");
    await chmod(join(root, ".kf", "hooks", "backlog.sh"), 0o755);
    expect((await cmdApprove(args("approve", ["demo"], { backlog: true, by: "alice" }), root)).code).toBe(1);
    expect(feature().meta!.approval).toEqual({ status: "pending" });
    expect(feature().stage).toBe("planning");
    expect((await cmdApprove(args("approve", ["demo"], { by: "alice" }), root)).code).toBe(0);
    expect(feature().meta!.approval).toMatchObject({ status: "approved", by: "alice" });
    expect(feature().stage).toBe("implementation");
  });

});

describe("kf status Next after approve", () => {
  it("names the implement skill", async () => {
    await plannedItem();
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    const status = await cmdStatus(args("status", [], { change: "demo" }), root);
    expect(status.stdout).toContain('Next: load the kanban-implement skill for "demo"');
    for (const re of NO_DECISION_TEXT) expect(status.stdout).not.toMatch(re);
  });

  it("help lists --backlog and no CLI surface asks start-vs-backlog or ship-vs-archive", () => {
    expect(commandHelp("approve")).toContain("--backlog");
    for (const text of [commandHelp("approve"), workflowGuide()]) {
      for (const re of NO_DECISION_TEXT) expect(text).not.toMatch(re);
    }
  });

  it("no source file under src/ carries the start-vs-backlog or ship-vs-archive wording", () => {
    const self = join(PKG_ROOT, "src", "tests", "approve.test.ts");
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && p !== self) {
          const text = readFileSync(p, "utf8");
          for (const re of NO_DECISION_TEXT) if (re.test(text)) hits.push(`${p}: ${re}`);
        }
      }
    };
    walk(join(PKG_ROOT, "src"));
    expect(hits).toEqual([]);
  });
});
