import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { cmdRun, cmdRuns } from "../cli/commands/run.js";
import { gitDriveProject, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

// Task runs cut a real git worktree and spawn real fake-CLI processes.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const run = (p: GitDriveProject, options: Record<string, unknown>) => cmdRun(args("run", ["demo"], options), p.root);

let p: GitDriveProject;
afterEach(async () => {
  await p.cleanup();
});

const worktrees = (proj: GitDriveProject): string => proj.git(proj.root, "worktree", "list");
const metaText = (proj: GitDriveProject): Promise<string> => readFile(join(proj.itemDir(), ".kfw.json"), "utf8");

async function editConfig(proj: GitDriveProject, edit: (cfg: Record<string, any>) => void): Promise<void> {
  const file = join(proj.root, ".kf", "config.json");
  const cfg = JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
  edit(cfg);
  await writeFile(file, JSON.stringify(cfg, null, 2));
}

describe("kf run --task refusals create nothing (TC-008)", () => {
  it("refuses an unfinished dependency, an unknown id and flag combinations", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }, { id: "TASK-002", deps: ["TASK-001"] }] });
    const before = [worktrees(p), await metaText(p)];

    const dep = await run(p, { task: "TASK-002" });
    expect(dep.code).toBe(1);
    expect(dep.stdout).toContain("TASK-001");
    expect(dep.stdout).toContain("not done");

    const unknown = await run(p, { task: "TASK-404" });
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("Unknown task 'TASK-404'");

    for (const flag of [{ role: "coder" }, { stage: "testing" }, { detach: true }]) {
      const res = await run(p, { task: "TASK-001", ...flag });
      expect(res.code).toBe(1);
      expect(res.stdout).toContain(`cannot be combined with --${Object.keys(flag)[0]}`);
    }

    expect([worktrees(p), await metaText(p)]).toEqual(before);
    expect(p.readMeta()!.runs).toBeUndefined();
    expect(p.calls("claude")).toHaveLength(0);
  });

  it("refuses an item that is not in implementation", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }], implementation: false });
    const before = [worktrees(p), await metaText(p)];
    const res = await run(p, { task: "TASK-001" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("needs the item in implementation");
    expect([worktrees(p), await metaText(p)]).toEqual(before);
  });

  it("refuses when the approved contract changed", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }] });
    await p.writePlan([{ id: "TASK-001" }, { id: "TASK-002" }]);
    const res = await run(p, { task: "TASK-001" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("changed since approval");
    expect(p.readMeta()!.runs).toBeUndefined();
  });
});

describe("kf run --task needs worktree.enabled (TC-010)", () => {
  it("refuses naming the key and changes nothing", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }] });
    await editConfig(p, (cfg) => { cfg.worktree.enabled = false; });
    const before = [worktrees(p), await metaText(p)];
    const res = await run(p, { task: "TASK-001" });
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("worktree.enabled");
    expect(res.stdout).toContain(".kf/config.json");
    expect([worktrees(p), await metaText(p)]).toEqual(before);
  });
});

describe("kf run --task runs one task in its worktree (TC-009)", () => {
  async function withFakeb(): Promise<void> {
    p = await gitDriveProject({
      agents: ["claude", "gemini", "fakeb"],
      tasks: [{ id: "TASK-001", role: "tester", files: ["src/a.ts", "src/b.ts"], refs: "FR-001 / UC-001", expected: "Unit test merged" }],
    });
    await editConfig(p, (cfg) => { 
      cfg.harness.runners.fakeb = { start: ["fakeb", "{prompt}"], skillsDir: ".fakeb/skills" };
      cfg.harness.roles.tester.runner = "fakeb";
    });
    const skill = join(p.root, ".fakeb", "skills", "kanban-implement");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# kanban-implement");
  }

  it("runs the role's runner in the task worktree with the task prompt and records the run", async () => {
    await withFakeb();
    const res = await run(p, { task: "TASK-001" });
    expect(res.code, res.stdout).toBe(0);

    const call = p.calls("fakeb");
    expect(call).toHaveLength(1);
    expect(call[0].task).toBe("TASK-001");
    expect(call[0].cwd).toBe(join(p.scratch, "wt", "demo.tasks", "task-001"));

    const prompt = p.cli.prompt("fakeb");
    expect(prompt.split("\n")[0]).toMatch(/^kf-run:[0-9a-f]{8} TASK-001$/);
    for (const text of ["Do TASK-001", "FR-001 / UC-001", "Unit test merged", "src/a.ts, src/b.ts", "Only change files in the allowlist", p.itemDir(),
      "Never run `kf stage`", "Do not commit", "STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT", "Summary: <one or two sentences>"]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain("repair loop");

    const meta = p.readMeta()!;
    expect(meta.runs).toHaveLength(1);
    expect(meta.runs![0]).toMatchObject({ role: "tester", runner: "fakeb", stage: "implementation", task: "TASK-001", status: "done" });
    expect(meta.tasks!["TASK-001"]).toMatchObject({ state: "verifying", attempts: 1, branch: expect.stringContaining("--task-001"), base: expect.any(String) });

    const text = await cmdRuns(args("runs", ["demo"]), p.root);
    expect(text.stdout).toContain("TASK-001");
    const json = JSON.parse((await cmdRuns(args("runs", ["demo"], { json: true }), p.root)).stdout) as Array<{ task?: string }>;
    expect(json[0].task).toBe("TASK-001");

    const tasksMd = await readFile(join(p.itemDir(), "tasks.md"), "utf8");
    expect(tasksMd).toContain("## Baseline");
    expect(tasksMd).toContain(`Branch HEAD: ${p.git(p.worktreePath()!, "rev-parse", "HEAD")}`);
  });

  it("treats DONE_WITH_CONCERNS like DONE", async () => {
    await withFakeb();
    p.cli.scenario("fakeb", { stdout: "STATUS: DONE_WITH_CONCERNS\nSummary: works, one nit" });
    const res = await run(p, { task: "TASK-001" });
    expect(res.code, res.stdout).toBe(0);
    expect(p.readMeta()!.tasks!["TASK-001"].state).toBe("verifying");
  });

  it("records BLOCKED with the worker summary and a failed worker as failed", async () => {
    await withFakeb();
    p.cli.scenario("fakeb", { stdout: "STATUS: BLOCKED\nSummary: needs the API key" });
    const blocked = await run(p, { task: "TASK-001" });
    expect(blocked.code).toBe(1);
    expect(p.readMeta()!.tasks!["TASK-001"]).toMatchObject({ state: "blocked", reason: "needs the API key" });
    expect(await readFile(join(p.itemDir(), "tasks.md"), "utf8")).toContain("(blocked: needs the API key)");

    p.cli.scenario("fakeb", { stdout: "no status here", exit: 2 });
    const failed = await run(p, { task: "TASK-001" });
    expect(failed.code).toBe(1);
    expect(p.readMeta()!.tasks!["TASK-001"]).toMatchObject({ state: "failed", attempts: 2 });
    expect(p.readMeta()!.tasks!["TASK-001"].reason).toContain("exited 2");
  });

  it("counts a re-run as the next attempt and resumes the task session", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001" }] });
    p.cli.scenario("claude", { exit: 1 });
    expect((await run(p, { task: "TASK-001" })).code).toBe(1);
    const session = p.readMeta()!.sessions?.["task:TASK-001"];
    expect(session).toBeTruthy();

    p.cli.scenario("claude", {});
    expect((await run(p, { task: "TASK-001" })).code).toBe(0);
    const meta = p.readMeta()!;
    expect(meta.runs!.map((r) => r.mode)).toEqual(["start", "resume"]);
    expect(meta.tasks!["TASK-001"].attempts).toBe(2);
    expect(meta.sessions!["task:TASK-001"]).toBe(session);
  });
});

describe("kf run --task --dry-run", () => {
  it("prints the plan and prompt and creates nothing", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001", files: ["src/a.ts"] }] });
    const before = [worktrees(p), await metaText(p)];
    const res = await run(p, { task: "TASK-001", "dry-run": true });
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("role coder (claude)");
    expect(res.stdout).toContain(join(p.scratch, "wt", "demo.tasks", "task-001"));
    expect(res.stdout).toContain("kf-run:<run-id> TASK-001");
    expect(res.stdout).toContain("src/a.ts");
    expect([worktrees(p), await metaText(p)]).toEqual(before);
    expect(existsSync(join(p.itemDir(), "tasks.md"))).toBe(false);
    expect(p.calls("claude")).toHaveLength(0);
  });
});

describe("concurrency rules (TC-033)", () => {
  it("allows another task, refuses the same task and a stage-level run while a task run is live", async () => {
    p = await gitDriveProject({ tasks: [{ id: "TASK-001", files: ["a.txt"] }, { id: "TASK-002", files: ["b.txt"] }] });
    p.cli.scenario("claude", { sleep: 3 }, "TASK-001");
    const first = run(p, { task: "TASK-001" });
    const deadline = Date.now() + 15_000;
    while (!p.readMeta()?.runs?.some((r) => r.task === "TASK-001" && r.status === "running") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const live = p.readMeta()!.runs!.find((r) => r.task === "TASK-001")!;

    const other = await run(p, { task: "TASK-002" });
    expect(other.code, other.stdout).toBe(0);

    const same = await run(p, { task: "TASK-001" });
    expect(same.code).toBe(1);
    expect(same.stdout).toContain(live.id);
    expect(same.stdout).toContain("TASK-001");

    const stage = await run(p, {});
    expect(stage.code).toBe(1);
    expect(stage.stdout).toContain("TASK-001");
    expect(stage.stdout).toContain(live.id);

    expect((await first).code).toBe(0);
    expect(p.readMeta()!.runs!.filter((r) => r.task === "TASK-001")).toHaveLength(1);
  });
});
