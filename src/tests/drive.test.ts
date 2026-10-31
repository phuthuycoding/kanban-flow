import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";

import { claimDrive, followDrive, superviseDrive, type DriveOutcome } from "../harness/drive.js";
import { cmdDrive } from "../cli/commands/drive.js";
import { transitionItem, type Transition } from "../workflow/transition.js";
import { findFeature, updateFeatureMeta } from "../workflow/features.js";
import { createTaskWorktree } from "../worktree/tasks.js";
import { worktreeConfig } from "../worktree/config.js";
import { readProjectConfig, resolveDriveConfig } from "../project/config.js";
import { driveBoundary } from "../harness/drive/claim.js";
import { gitDriveProject, type DriveTask, type GitDriveOptions, type GitDriveProject } from "./helpers/git-fixture.js";
import type { ParsedArgs } from "../cli/args.js";

// Every case spawns fake workers and real git; a drive runs several of them in sequence.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 30_000 });

const args = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "drive", positionals, options });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const STAGES = { implementation: ["coder"], testing: ["tester"], review: ["reviewer"] };
const EVIDENCE = "## Commands and Evidence\\n\\n| Command / tool | Exit code | Evidence / output |\\n|---|---:|---|\\n| npm test | 0 | 1 passed |\\n";

let p: GitDriveProject | null = null;
afterEach(async () => {
  await p?.cleanup();
  p = null;
});

async function project(tasks: DriveTask[], opts: Partial<GitDriveOptions> = {}): Promise<GitDriveProject> {
  p = await gitDriveProject({ tasks, stages: STAGES, ...opts });
  return p;
}

/**
 * Bash for a fake tester/reviewer: writes the stage report with the current execution id. `statuses` are used in
 * order, one per call; the last one repeats.
 */
function reportScript(root: string, stage: "testing" | "review", statuses: string[]): string {
  const file = stage === "testing" ? "phase-4-testing-result.md" : "phase-5-review-report.md";
  const counter = join(root, `.${stage}-count`);
  return [
    "n=$(cat '" + counter + "' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '" + counter + "'",
    "arr=(" + statuses.join(" ") + "); i=$((n-1)); [ $i -ge ${#arr[@]} ] && i=$((${#arr[@]}-1)); s=${arr[$i]}",
    "d=$(ls -d '" + root + "/.works/" + stage + "'/demo_*)",
    "id=$(sed -n 's/.*\"executionId\": *\"\\([^\"]*\\)\".*/\\1/p' \"$d/.kfw.json\")",
    "printf -- '---\\nstatus: %s\\nexecution: %s\\n" + (stage === "review" ? "ci: none\\nlanding: none\\n" : "") + "---\\n# Evidence\\nVerified.\\n" + (stage === "testing" ? EVIDENCE : "") + "' \"$s\" \"$id\" > \"$d/" + file + "\"",
  ].join("\n");
}

/** Testers and reviewers that pass (or follow the given status sequences). */
function reports(pr: GitDriveProject, testing: string[] = ["PASS"], review: string[] = ["PASS"]): void {
  pr.cli.scenario("gemini", { script: reportScript(pr.root, "testing", testing) });
  pr.cli.scenario("codex", { script: reportScript(pr.root, "review", review) });
}

async function drive(pr: GitDriveProject, transition?: Transition): Promise<DriveOutcome> {
  const claim = await claimDrive(pr.root, "demo");
  if (!claim.ok) throw new Error(claim.reason);
  return superviseDrive(pr.root, "demo", claim.drive.id, { transition, timeoutMs: 60_000 });
}

const taskCalls = (pr: GitDriveProject, id: string) => pr.calls("claude").filter((c) => c.task === id);
const events = (pr: GitDriveProject): Record<string, unknown>[] => {
  const id = pr.readMeta()!.drive!.id;
  return readFileSync(join(pr.itemDir(), "runs", `drive-${id}.jsonl`), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const editConfig = (pr: GitDriveProject, fn: (cfg: Record<string, any>) => void) => {
  const file = join(pr.root, ".kf", "config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  fn(cfg);
  writeFileSync(file, JSON.stringify(cfg, null, 2));
};

describe("kf drive preconditions (TC-013, TC-004, TC-010, TC-029)", () => {
  it("refuses a backlog item, naming the start command, and a changed approval naming kf approve (TC-013)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["a.txt"] }], { implementation: false });
    const backlog = await cmdDrive(args(["demo"]), pr.root);
    expect(backlog.code).toBe(1);
    expect(backlog.stdout).toContain("kf stage demo implementation");
    expect(pr.readMeta()!.drive).toBeUndefined();

    await pr.writePlan([{ id: "TASK-001", files: ["b.txt"] }]);
    const pending = await cmdDrive(args(["demo"]), pr.root);
    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain("kf approve demo");
    expect(pr.readMeta()!.drive).toBeUndefined();
  });

  it("refuses an approved item still in planning, naming kf approve as the start", async () => {
    const pr = await project([{ id: "TASK-001", files: ["a.txt"] }], { implementation: false });
    const approval = pr.readMeta()!.approval!;
    await pr.stage("planning");
    await updateFeatureMeta(pr.root, "demo", (meta) => ({ ...meta, approval }));
    const res = await cmdDrive(args(["demo"]), pr.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Start it first: kf approve demo");
    expect(pr.readMeta()!.drive).toBeUndefined();
  });

  it("refuses after the approved plan is edited (TC-004)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["a.txt"] }]);
    await pr.writePlan([{ id: "TASK-001", role: "tester", files: ["a.txt"] }]);
    const res = await cmdDrive(args(["demo"]), pr.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("kf approve demo");
  });

  it("refuses without worktrees or without verify.stage, writing nothing (TC-010, TC-029 A)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["a.txt"] }]);
    editConfig(pr, (c) => { c.worktree.enabled = false; });
    const off = await cmdDrive(args(["demo"]), pr.root);
    expect(off.code).toBe(1);
    expect(off.stdout).toContain("worktree.enabled");

    editConfig(pr, (c) => { c.worktree.enabled = true; delete c.harness.verify; });
    const noVerify = await cmdDrive(args(["demo"]), pr.root);
    expect(noVerify.code).toBe(1);
    expect(noVerify.stdout).toContain("harness.verify.stage");
    expect(pr.readMeta()!.drive).toBeUndefined();
  });
});

describe("kf drive to review PASS (TC-014, TC-015, TC-012)", () => {
  it("runs the DAG, testing and review, and stops ready without shipping (TC-014)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ]);
    pr.cli.scenario("claude", { write: { "src/a.txt": "a" } }, "TASK-001");
    pr.cli.scenario("claude", { write: { "src/b.txt": "b" } }, "TASK-002");
    reports(pr);

    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    expect(out.reason).toBe("ready — review PASS: merge the PR, kf status --change <feature> closes the item");
    const meta = pr.readMeta()!;
    expect(pr.feature().stage).toBe("review");
    expect(meta.ship).toBeUndefined();
    expect(meta.tasks!["TASK-001"].state).toBe("done");
    expect(meta.tasks!["TASK-002"].state).toBe("done");
    const wt = pr.worktreePath()!;
    expect(readFileSync(join(wt, "src/a.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(wt, "src/b.txt"), "utf8")).toBe("b");

    const kinds = new Set(events(pr).map((e) => e.event));
    for (const k of ["start", "run_start", "task", "merge", "verify", "stage", "stop"]) expect(kinds.has(k), k).toBe(true);
    const started = events(pr).filter((e) => e.event === "run_start");
    expect(started.length).toBeGreaterThan(0);
    expect(started.every((e) => typeof e.run === "string" && typeof e.role === "string" && typeof e.runner === "string" && typeof e.log === "string")).toBe(true);
    const tasksMd = readFileSync(join(pr.itemDir(), "tasks.md"), "utf8");
    expect(tasksMd).toContain("## Baseline");
    expect(tasksMd).toMatch(/- \[x\] TASK-002/);
  });

  it("drives a bug with one implementation run and no task records (TC-015)", async () => {
    const pr = await project([], { kind: "bug" });
    reports(pr);
    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    const runs = pr.readMeta()!.runs ?? [];
    expect(runs.filter((r) => r.stage === "implementation")).toHaveLength(1);
    expect(runs.some((r) => r.task)).toBe(false);
  });

  it("never runs more than `parallel` workers and never overlaps tasks sharing files (TC-012)", async () => {
    // TASK-005 shares src/f1.txt with TASK-001; each task also writes its own marker, declared so the allowlist passes.
    const tasks: DriveTask[] = ["1", "2", "3", "4"].map((n) => ({ id: `TASK-00${n}`, files: [`src/f${n}.txt`, `src/TASK-00${n}.done`] }));
    tasks.push({ id: "TASK-005", files: ["src/f1.txt", "src/TASK-005.done"] });
    const pr = await project(tasks, { limits: { parallel: 3 } });
    for (const t of tasks) pr.cli.scenario("claude", { sleep: 1, write: { [`src/${t.id}.done`]: "x" } }, t.id);
    reports(pr);

    const sampled = new Set<string>();
    const sampler = setInterval(() => {
      for (const line of pr.git(pr.root, "worktree", "list", "--porcelain").split("\n")) if (line.startsWith("worktree ") && line.includes(".tasks")) sampled.add(line.slice(9));
    }, 200);
    const out = await drive(pr);
    clearInterval(sampler);
    expect(out.status, out.reason).toBe("ready");

    const calls = pr.calls("claude").filter((c) => c.task);
    let max = 0;
    for (const c of calls) max = Math.max(max, calls.filter((o) => o.start < c.end && c.start < o.end).length);
    expect(max).toBe(3);
    const [one] = calls.filter((c) => c.task === "TASK-001");
    const [five] = calls.filter((c) => c.task === "TASK-005");
    expect(one.end <= five.start || five.end <= one.start).toBe(true);

    expect([...sampled].some((s) => s.endsWith("demo.tasks/task-001"))).toBe(true);
    const routes = existsSync(join(pr.scratch, "routes.json")) ? readFileSync(join(pr.scratch, "routes.json"), "utf8") : "";
    expect(routes).not.toContain("task-0");
  });
});

describe("kf drive stops (TC-017, TC-018, TC-021, TC-022, TC-023, TC-034)", () => {
  it("stops plan_change_needed on an allowlist violation; the running task still merges (TC-017)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", files: ["src/b.txt"] },
      { id: "TASK-003", deps: ["TASK-001"], files: ["src/c.txt"] },
    ], { limits: { retries: 1 } });
    pr.cli.scenario("claude", { write: { "src/a.txt": "a", "src/evil.txt": "x" } }, "TASK-001");
    pr.cli.scenario("claude", { sleep: 2, write: { "src/b.txt": "b" } }, "TASK-002");
    reports(pr);

    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("plan_change_needed");
    expect(out.reason).toContain("src/evil.txt");
    expect(out.nextCommand).toBe("kf stage demo planning");
    expect(taskCalls(pr, "TASK-001")).toHaveLength(1);
    expect(taskCalls(pr, "TASK-003")).toHaveLength(0);
    const meta = pr.readMeta()!;
    expect(meta.tasks!["TASK-001"].state).toBe("blocked");
    expect(meta.tasks!["TASK-002"].state).toBe("done");
    expect(pr.feature().stage).toBe("implementation");
  });

  it("retries a failed verify once in the same session, then blocks and stops tasks_blocked (TC-018)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ], { limits: { retries: 1 }, verify: { stage: [["true"]], task: [["sh", "-c", "echo verify-said-no; exit 1"]] } });
    pr.cli.scenario("claude", { write: { "src/a.txt": "a" } }, "TASK-001");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("tasks_blocked");
    expect(out.reason).toContain("TASK-002 is blocked by TASK-001");
    const runs = taskCalls(pr, "TASK-001");
    expect(runs).toHaveLength(2);
    expect(runs[1].argv).toContain("-r");
    expect(runs[1].argv.join(" ")).toContain("verify-said-no");
    expect(taskCalls(pr, "TASK-002")).toHaveLength(0);
    expect(pr.readMeta()!.tasks!["TASK-001"].state).toBe("blocked");
    // The failed merge was undone: the item branch does not carry src/a.txt.
    expect(existsSync(join(pr.worktreePath()!, "src/a.txt"))).toBe(false);
  });

  it("runs a repair loop after FAIL and passes; loops REJECT back through testing (TC-021)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }]);
    pr.cli.scenario("claude", { write: { "src/a.txt": "a" } }, "TASK-001");
    reports(pr, ["FAIL", "PASS", "PASS"], ["REJECT", "PASS"]);
    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    expect(out.loops).toBe(2);
    const repairs = (pr.readMeta()!.runs ?? []).filter((r) => r.stage === "implementation" && !r.task);
    expect(repairs).toHaveLength(2);
    const repairPrompts = pr.calls("claude").filter((c) => !c.task).map((c) => c.argv.join(" "));
    expect(repairPrompts.some((a) => a.includes("phase-4-testing-result.md"))).toBe(true);
    expect(repairPrompts.some((a) => a.includes("phase-5-review-report.md"))).toBe(true);
  });

  it("stops loop_limit when testing keeps failing (TC-021)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { limits: { maxLoops: 1 } });
    pr.cli.scenario("claude", { write: { "src/a.txt": "a" } }, "TASK-001");
    reports(pr, ["FAIL"]);
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("loop_limit");
    expect(out.loops).toBe(1);
  });

  it("stops on the run budget (TC-022)", async () => {
    const tasks: DriveTask[] = ["1", "2", "3"].map((n) => ({ id: `TASK-00${n}`, files: [`src/f${n}.txt`] }));
    const pr = await project(tasks, { limits: { parallel: 1, budget: { maxRuns: 2 } } });
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("budget");
    expect(out.reason).toContain("2/2");
    expect(pr.calls("claude").filter((c) => c.task)).toHaveLength(2);
  });

  it("stops config_changed when a worker edits harness.verify, and worker_blocked on BLOCKED (TC-023)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ]);
    // The fixture commits no config and has no origin, so the drive resolves the primary copy; edit what it resolves.
    const resolved = resolveDriveConfig(pr.root, pr.feature());
    expect(resolved.source).toBe("primary");
    pr.cli.scenario("claude", { script: `perl -0pi -e 's/"true"/"true", "x"/' '${resolved.file}'` }, "TASK-001");
    const changed = await drive(pr);
    expect(changed.stopCode, changed.reason).toBe("config_changed");
    expect(changed.reason).toContain("harness.verify");
    expect(taskCalls(pr, "TASK-002")).toHaveLength(0);
    expect(events(pr).find((e) => e.event === "start")?.config_source).toBe("primary");
  });

  it("stops worker_blocked without retrying a BLOCKED task (TC-023)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { limits: { retries: 2 } });
    pr.cli.scenario("claude", { stdout: "STATUS: BLOCKED\nSummary: needs a decision on the schema" }, "TASK-001");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("worker_blocked");
    expect(out.reason).toContain("needs a decision on the schema");
    expect(taskCalls(pr, "TASK-001")).toHaveLength(1);
  });

  it("names every stop, never bypasses a gate (TC-034)", async () => {
    const seen: { force?: boolean; skipHooks?: boolean }[] = [];
    const spy: Transition = (root, name, to, opts) => {
      seen.push({ force: opts.force, skipHooks: opts.skipHooks });
      return transitionItem(root, name, to, opts);
    };
    const one: DriveTask[] = [{ id: "TASK-001", files: ["src/a.txt"] }];
    const cases: { code: string; setup: (pr: GitDriveProject) => void }[] = [
      { code: "requirement_bug", setup: (pr) => reports(pr, ["PASS"], ["REQUIREMENT_BUG"]) },
      {
        code: "transition_refused",
        setup: (pr) => {
          reports(pr);
          mkdirSync(join(pr.root, ".kf", "hooks"), { recursive: true });
          writeFileSync(join(pr.root, ".kf", "hooks", "testing.sh"), "#!/usr/bin/env bash\necho nope\nexit 1\n");
          chmodSync(join(pr.root, ".kf", "hooks", "testing.sh"), 0o755);
        },
      },
      {
        code: "config_changed",
        setup: (pr) => pr.cli.scenario("claude", { script: `perl -0pi -e 's/"Implements the plan."/"Changed."/' '${join(pr.root, ".kf", "config.json")}'` }, "TASK-001"),
      },
      {
        code: "approval_changed",
        setup: (pr) => pr.cli.scenario("claude", { script: `printf '\\nedited\\n' >> "$(ls -d '${pr.root}'/.works/implementation/demo_*)/phase-2-implementation-plan.md"` }, "TASK-001"),
      },
      { code: "verify_failed", setup: (pr) => editConfig(pr, (c) => { c.harness.verify.stage = [["sh", "-c", "exit 3"]]; }) },
    ];
    for (const c of cases) {
      const pr = await project(one);
      c.setup(pr);
      const out = await drive(pr, spy);
      expect(out.stopCode, `${c.code}: ${out.reason}`).toBe(c.code);
      expect(out.reason.length).toBeGreaterThan(0);
      expect(out.nextCommand).toMatch(/^kf /);
      await pr.cleanup();
      p = null;
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => !s.force && !s.skipHooks)).toBe(true);
  });
});

describe("drive-stop hook (TC-030)", () => {
  const hook = (pr: GitDriveProject, exit = 0) => {
    mkdirSync(join(pr.root, ".kf", "hooks"), { recursive: true });
    const out = join(pr.scratch, "hook-env.txt");
    writeFileSync(join(pr.root, ".kf", "hooks", "drive-stop.sh"), `#!/usr/bin/env bash\nprintf '%s|%s\\n' "$KFW_DRIVE_RESULT" "$KFW_DRIVE_REASON" >> '${out}'\nexit ${exit}\n`);
    chmodSync(join(pr.root, ".kf", "hooks", "drive-stop.sh"), 0o755);
    return out;
  };

  it("receives the result and reason for ready and for a budget stop", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }]);
    reports(pr);
    const out = hook(pr);
    expect((await drive(pr)).status).toBe("ready");
    expect(readFileSync(out, "utf8")).toContain("ready|ready — review PASS: merge the PR, kf status --change <feature> closes the item");
    await pr.cleanup();

    const pb = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { limits: { budget: { maxRuns: 1 } } });
    reports(pb);
    const out2 = hook(pb);
    const res = await drive(pb);
    expect(res.stopCode).toBe("budget");
    expect(readFileSync(out2, "utf8")).toMatch(/^stopped\|run budget exhausted/m);
  });

  it("a failing hook is a warning; the result stands", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }]);
    reports(pr);
    hook(pr, 1);
    const res = await drive(pr);
    expect(res.status).toBe("ready");
    const d = pr.readMeta()!.drive!;
    expect(d.status).toBe("ready");
    expect(d.warnings?.[0]).toContain("drive-stop hook failed");
  });
});

describe("detached drive (TC-024, TC-025)", () => {
  const status = async (pr: GitDriveProject) => JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);
  const until = async (pr: GitDriveProject, ok: (s: any) => boolean, ms = 60_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const s = await status(pr);
      if (ok(s)) return s;
      if (Date.now() > end) throw new Error(`timed out; last status ${JSON.stringify(s)}`);
      await wait(250);
    }
  };

  it("one of two concurrent drives starts; --stop ends it and keeps worktrees (TC-025)", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }]);
    pr.cli.scenario("claude", { sleep: 20 }, "TASK-001");
    const [a, b] = await Promise.all([cmdDrive(args(["demo"]), pr.root), cmdDrive(args(["demo"]), pr.root)]);
    expect([a.code, b.code].sort()).toEqual([0, 1]);
    expect((a.code === 1 ? a : b).stdout).toContain("already live");

    await until(pr, (s) => s.runningTasks.includes("TASK-001"));
    const stopped = await cmdDrive(args(["demo"], { stop: true }), pr.root);
    expect(stopped.code, stopped.stdout).toBe(0);
    const s = await status(pr);
    expect(s.state).toBe("stopped");
    expect(s.stopCode).toBe("stopped_by_user");
    expect(pr.git(pr.root, "worktree", "list")).toContain("demo.tasks/task-001");
  });

  it("reports a killed supervisor as crashed and resumes without re-running done tasks (TC-024)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ]);
    pr.cli.scenario("claude", { write: { "src/a.txt": "a" } }, "TASK-001");
    pr.cli.scenario("claude", { sleep: 20 }, "TASK-002");
    reports(pr);
    expect((await cmdDrive(args(["demo"]), pr.root)).code).toBe(0);
    await until(pr, (s) => s.runningTasks.includes("TASK-002"));
    const pid = findFeature(pr.root, "demo")!.meta!.drive!.supervisorPid!;
    process.kill(pid, "SIGKILL");
    const crashed = await until(pr, (s) => s.state === "crashed");
    expect(crashed.nextCommand).toBe("kf drive demo");

    pr.cli.scenario("claude", { sleep: 0, write: { "src/b.txt": "b" } }, "TASK-002");
    const resumed = await cmdDrive(args(["demo"]), pr.root);
    expect(resumed.code, resumed.stdout).toBe(0);
    expect(resumed.stdout).toContain("Resumed");
    const done = await until(pr, (s) => s.state !== "running");
    expect(done.state, done.reason).toBe("ready");
    expect(taskCalls(pr, "TASK-001")).toHaveLength(1);
  });

  it("resumes after a crash mid-merge: aborts the half merge, merges again, does not re-run the task (TC-025)", async () => {
    const pr = await project([
      { id: "TASK-001", files: ["src/a.txt"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ]);
    pr.cli.scenario("claude", { write: { "src/b.txt": "b" } }, "TASK-002");
    reports(pr);

    // State a supervisor leaves when it dies between `git merge` and its commit: the task's work is committed on
    // its branch, the item worktree holds MERGE_HEAD, the task is `merging` and the drive still says running.
    const item = pr.worktreePath()!;
    const preMergeSha = pr.git(item, "rev-parse", "HEAD");
    const wt = await createTaskWorktree(pr.root, pr.feature(), "TASK-001", worktreeConfig(pr.root, readProjectConfig(pr.root).worktree));
    mkdirSync(join(wt.path, "src"), { recursive: true });
    writeFileSync(join(wt.path, "src", "a.txt"), "a");
    pr.git(wt.path, "add", "-A");
    pr.git(wt.path, "commit", "-qm", "task(TASK-001): Do TASK-001");
    pr.git(item, "merge", "--no-ff", "--no-commit", wt.branch);
    expect(existsSync(join(pr.git(item, "rev-parse", "--absolute-git-dir"), "MERGE_HEAD"))).toBe(true);
    const now = new Date().toISOString();
    await updateFeatureMeta(pr.root, "demo", (meta) => ({
      ...meta,
      tasks: { "TASK-001": { state: "merging", branch: wt.branch, base: wt.base, preMergeSha, attempts: 1, updatedAt: now } },
      drive: { id: "deadbeef", status: "running", step: "implementation", loops: 0, runs: 1, configHash: "stale", supervisorPid: 999999, startedAt: now, updatedAt: now },
    }));

    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    const meta = pr.readMeta()!;
    expect(meta.drive!.id).toBe("deadbeef");
    expect(meta.tasks!["TASK-001"].state).toBe("done");
    expect(meta.tasks!["TASK-002"].state).toBe("done");
    expect(taskCalls(pr, "TASK-001")).toHaveLength(0);
    expect(existsSync(join(pr.git(item, "rev-parse", "--absolute-git-dir"), "MERGE_HEAD"))).toBe(false);
    expect(readFileSync(join(item, "src", "a.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(item, "src", "b.txt"), "utf8")).toBe("b");
    expect(events(pr).some((e) => e.event === "merge" && e.task === "TASK-001" && e.resumed === true && e.merged === true)).toBe(true);
  });
});

describe("transition errors keep their stack (review FINDING-002)", () => {
  it("logs the stack of an error outcome to the drive log", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }]);
    const failing: Transition = async () => ({ kind: "error", error: new Error("rename exploded") });
    const out = await drive(pr, failing);
    expect(out.stopCode).toBe("transition_refused");
    expect(out.reason).toContain("rename exploded");
    const stage = events(pr).find((e) => e.event === "stage" && e.refused);
    expect(String(stage?.stack)).toContain("rename exploded");
    expect(String(stage?.stack)).toMatch(/\n\s+at /);
  });
});

describe("drive config resolution: worktree → origin → primary", () => {
  const twoTasks: DriveTask[] = [
    { id: "TASK-001", files: ["src/a.txt"] },
    { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
  ];
  const stripPrimaryHarness = (pr: GitDriveProject) => editConfig(pr, (c) => { delete c.harness; });
  const status = async (pr: GitDriveProject) => cmdDrive(args(["demo"], { status: true }), pr.root);

  it("drives from the worktree copy when the primary has no harness; the log and --status name the source", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    stripPrimaryHarness(pr);
    expect(readProjectConfig(pr.root).harness).toBeUndefined();
    reports(pr);

    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    expect(events(pr).find((e) => e.event === "start")?.config_source).toBe("worktree");
    const text = await status(pr);
    expect(text.stdout).toContain("Config: worktree");
    const json = JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);
    expect(json.configSource).toBe("worktree");
  });

  it("stops config_changed when the worktree copy is edited mid-drive", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    expect(resolveDriveConfig(pr.root, pr.feature()).file).toBe(copy);
    pr.cli.scenario("claude", { script: `perl -0pi -e 's/"true"/"true", "x"/' '${copy}'` }, "TASK-001");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("config_changed");
    expect(out.reason).toContain("harness.verify");
    expect(taskCalls(pr, "TASK-002")).toHaveLength(0);
  });

  it("stops config_changed naming harness.budget when a task merge raises budget.maxRuns in the worktree copy", async () => {
    const tasks: DriveTask[] = [
      { id: "TASK-001", files: [".kf/config.json"] },
      { id: "TASK-002", deps: ["TASK-001"], files: ["src/b.txt"] },
    ];
    const pr = await project(tasks, { commitConfig: true, limits: { budget: { maxRuns: 30 } } });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    // The worker runs in its task worktree; the edit reaches the item worktree only through the task merge.
    pr.cli.scenario("claude", { script: `perl -0pi -e 's/"maxRuns": 30/"maxRuns": 99/' .kf/config.json` }, "TASK-001");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("config_changed");
    expect(readProjectConfig(pr.worktreePath()!).harness?.budget?.maxRuns).toBe(99);
    expect(out.reason).toContain("harness.budget");
    expect(out.reason).not.toContain("harness.verify");
    expect(out.reason).toContain(`${copy} (config source: worktree)`);
    expect(taskCalls(pr, "TASK-002")).toHaveLength(0);
  });

  it("moves implementation → testing on the worktree harness when the primary lacks the task's role", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    editConfig(pr, (c) => {
      delete c.harness.roles.coder;
      c.harness.stages.implementation = ["architect"];
    });
    expect(readProjectConfig(pr.root).harness?.roles.coder).toBeUndefined();
    reports(pr);
    const seen: (string | undefined)[] = [];
    const spy: Transition = (root, name, to, opts) => {
      seen.push(opts.harness?.roles.coder?.runner);
      return transitionItem(root, name, to, opts);
    };
    const out = await drive(pr, spy);
    expect(out.status, out.reason).toBe("ready");
    expect(events(pr).some((e) => e.event === "stage" && e.from === "implementation" && e.to === "testing" && !e.refused)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((runner) => runner === "claude")).toBe(true);
  });

  it("names the resolved file and its source in a loop_limit stop", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.txt"] }], { commitConfig: true, limits: { maxLoops: 0 } });
    reports(pr, ["FAIL"]);
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("loop_limit");
    expect(out.reason).toContain(`raise harness.maxLoops in ${join(pr.worktreePath()!, ".kf", "config.json")} (config source: worktree)`);
  });

  it("names the resolved file and its source in a budget stop", async () => {
    const pr = await project(twoTasks, { commitConfig: true, limits: { parallel: 1, budget: { maxRuns: 1 } } });
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("budget");
    expect(out.reason).toContain(`raise it in ${join(pr.worktreePath()!, ".kf", "config.json")} (config source: worktree)`);
  });

  it("maps a copy that no longer parses to config_changed at the boundary, and lets a read failure propagate", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    const claim = await claimDrive(pr.root, "demo");
    if (!claim.ok) throw new Error(claim.reason);
    expect(driveBoundary(pr.root, pr.feature(), claim.drive.id)).toBeNull();

    writeFileSync(copy, "{ nope");
    const stop = driveBoundary(pr.root, pr.feature(), claim.drive.id);
    expect(stop?.code).toBe("config_changed");
    expect(stop?.reason).toContain("no longer parses");
    expect(stop?.reason).toContain(`Invalid JSON in project config: ${copy}`);

    // Not a config the human changed: the file cannot be read at all (it is a directory now).
    rmSync(copy);
    mkdirSync(copy);
    expect(() => driveBoundary(pr.root, pr.feature(), claim.drive.id)).toThrow(/EISDIR/);
  });

  it("--status, --watch and followDrive show a stop on a copy that no longer parses instead of throwing", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    pr.cli.scenario("claude", { script: `printf '{ nope' > '${copy}'` }, "TASK-001");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("config_changed");

    const text = (await status(pr)).stdout;
    expect(text).toContain("Stop: config_changed — the drive config no longer parses");
    expect(text).toMatch(/Loops: \d+\/\? {3}Runs: \d+\/\?/);
    expect(text).toContain(`Limits unavailable: Invalid JSON in project config: ${copy}`);
    const json = JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);
    expect(json).toMatchObject({ stopCode: "config_changed", maxLoops: null, maxRuns: null, configError: `Invalid JSON in project config: ${copy}` });

    const watched: string[] = [];
    const followed = await followDrive({ root: pr.root, name: "demo", json: false, tail: false, replay: true, signal: new AbortController().signal, write: (l) => watched.push(l) });
    expect(followed).toEqual({ code: 1, detached: false });
    expect(watched.at(-1)).toContain("stopped: config_changed — the drive config no longer parses");

    // --watch resumes a stopped drive; the claim refuses with the parse error instead of throwing.
    const watch = await cmdDrive(args(["demo"], { watch: true }), pr.root);
    expect(watch.code).toBe(1);
    expect(watch.stdout).toContain(`does not parse: Invalid JSON in project config: ${copy}`);
    expect(pr.readMeta()!.drive).toMatchObject({ status: "stopped", stopCode: "config_changed" });
  });

  it("stops config_changed when a task merge breaks the worktree copy, after the task still running records its outcome", async () => {
    const tasks: DriveTask[] = [
      { id: "TASK-001", files: [".kf/config.json"] },
      { id: "TASK-002", files: ["src/b.txt"] },
      { id: "TASK-003", deps: ["TASK-001"], files: ["src/c.txt"] },
    ];
    const pr = await project(tasks, { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    // The worker writes its task worktree; the broken file reaches the item worktree only through the task merge.
    pr.cli.scenario("claude", { write: { ".kf/config.json": "{ nope" } }, "TASK-001");
    pr.cli.scenario("claude", { write: { "src/b.txt": "b" }, sleep: 3 }, "TASK-002");
    const out = await drive(pr);
    expect(out.stopCode, out.reason).toBe("config_changed");
    expect(out.reason).toContain(`no longer parses: Invalid JSON in project config: ${copy}`);
    const meta = pr.readMeta()!;
    expect(meta.tasks!["TASK-001"].state).toBe("done");
    expect(meta.tasks!["TASK-002"].state).toBe("done");
    expect(Object.entries(meta.tasks!).filter(([, t]) => t.state === "running")).toEqual([]);
    expect((meta.runs ?? []).filter((r) => r.status === "running")).toEqual([]);
    expect(taskCalls(pr, "TASK-003")).toHaveLength(0);
  });

  it("names the worktree copy when it turns worktrees off", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    const copy = join(pr.worktreePath()!, ".kf", "config.json");
    const cfg = JSON.parse(readFileSync(copy, "utf8"));
    cfg.worktree = { ...cfg.worktree, enabled: false };
    writeFileSync(copy, JSON.stringify(cfg, null, 2));
    const res = await cmdDrive(args(["demo"]), pr.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("worktree.enabled");
    expect(res.stdout).toContain(`Read from ${copy} (config source: worktree).`);
    expect(pr.readMeta()!.drive).toBeUndefined();
  });

  it("shows the limits of the resolved copy in --status", async () => {
    const pr = await project(twoTasks, { commitConfig: true, limits: { maxLoops: 5, budget: { maxRuns: 7 } } });
    editConfig(pr, (c) => { c.harness.maxLoops = 1; c.harness.budget = { maxRuns: 2 }; });
    reports(pr);
    await drive(pr);
    const json = JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);
    expect(json.maxLoops).toBe(5);
    expect(json.maxRuns).toBe(7);
  });

  it("does not stop when only the primary copy is edited while the worktree copy exists", async () => {
    const pr = await project(twoTasks, { commitConfig: true });
    const primary = join(pr.root, ".kf", "config.json");
    pr.cli.scenario("claude", { script: `perl -0pi -e 's/"true"/"true", "x"/' '${primary}'` }, "TASK-001");
    reports(pr);
    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    expect(readFileSync(primary, "utf8")).toContain(`"true", "x"`);
    expect(taskCalls(pr, "TASK-002")).toHaveLength(1);
  });

  it("uses origin's default branch when the worktree has no copy", async () => {
    const pr = await project(twoTasks, { origin: true });
    // Publish the full config on origin only: the item worktree was cut before it existed.
    const clone = join(pr.scratch, "clone");
    pr.git(pr.scratch, "clone", "-q", pr.originDir!, clone);
    mkdirSync(join(clone, ".kf"), { recursive: true });
    writeFileSync(join(clone, ".kf", "config.json"), readFileSync(join(pr.root, ".kf", "config.json"), "utf8"));
    pr.git(clone, "-c", "user.email=t@t", "-c", "user.name=t", "add", ".kf/config.json");
    pr.git(clone, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "config");
    pr.git(clone, "push", "-q", "origin", "HEAD");
    pr.git(pr.root, "fetch", "-q", "origin");
    stripPrimaryHarness(pr);
    expect(existsSync(join(pr.worktreePath()!, ".kf", "config.json"))).toBe(false);
    reports(pr);

    const out = await drive(pr);
    expect(out.status, out.reason).toBe("ready");
    expect(events(pr).find((e) => e.event === "start")?.config_source).toBe("origin");
    expect((await status(pr)).stdout).toContain("Config: origin");
  });

  it("refuses naming the three places it looked when none has a harness", async () => {
    const pr = await project(twoTasks);
    stripPrimaryHarness(pr);
    const res = await cmdDrive(args(["demo"]), pr.root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("No harness configured");
    expect(res.stdout).toContain(join(pr.worktreePath()!, ".kf", "config.json"));
    expect(res.stdout).toContain("origin/<default>:.kf/config.json");
    expect(res.stdout).toContain(join(pr.root, ".kf", "config.json"));
    expect(pr.readMeta()!.drive).toBeUndefined();
  });
});

describe("kf drive shows its workers", () => {
  const until = async <T>(what: string, probe: () => Promise<T | null> | T | null, ms = 30_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const hit = await probe();
      if (hit !== null) return hit;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await wait(100);
    }
  };
  const line = (o: unknown) => JSON.stringify(o).replace(/'/g, "'\\''");
  const SESSION = "s-1";
  const editLine = line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/a.ts", old_string: "a", new_string: "b" } }] }, session_id: SESSION });
  const result = (o: Record<string, unknown>) => JSON.stringify({ type: "result", session_id: SESSION, ...o });

  it("streams the worker log; --status, the heartbeat and --tail show readable activity", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.ts"] }]);
    // The fake's script output goes to the run log as it is written; the result line comes last, at exit.
    pr.cli.scenario("claude", {
      write: { "src/a.ts": "a" },
      script: `echo '${line({ type: "system", subtype: "init", session_id: SESSION })}'; sleep 1; echo '${editLine}'; sleep 4`,
      stdout: result({ is_error: false, result: "Edited.\nSTATUS: DONE\nSummary: edited a" }),
    }, "TASK-001");
    reports(pr);

    const watched: string[] = [];
    const ac = new AbortController();
    const running = drive(pr);
    await until("the drive record", () => pr.readMeta()?.drive?.status === "running" || null);
    const followed = followDrive({ root: pr.root, name: "demo", json: false, tail: true, replay: true, signal: ac.signal, heartbeatMs: 200, pollMs: 50, write: (l) => watched.push(l) });

    const live = await until("the Edit activity in --status", async () => {
      const text = (await cmdDrive(args(["demo"], { status: true }), pr.root)).stdout;
      return /Edit src\/a\.ts \(\d+s ago\)/.test(text) ? text : null;
    });
    expect(live).toMatch(/Live: TASK-001 coder claude \d+s {2}\S+\.log — Edit src\/a\.ts \(\d+s ago\)/);
    const view = JSON.parse((await cmdDrive(args(["demo"], { status: true, json: true }), pr.root)).stdout);
    expect(view.liveRuns[0]).toMatchObject({ task: "TASK-001", activity: "Edit src/a.ts", activityAgo: expect.stringMatching(/^\d+s$/) });
    // The worker is still running, and its log already holds the streamed lines.
    expect(pr.calls("claude")).toHaveLength(0);
    expect(readFileSync(view.liveRuns[0].log, "utf8")).toContain('"tool_use"');

    const out = await running;
    expect(out.status, out.reason).toBe("ready");
    await followed;
    expect(watched.some((l) => l.startsWith("♥ TASK-001 coder claude") && l.endsWith(")") && l.includes(" — Edit src/a.ts ("))).toBe(true);
    const tail = watched.filter((l) => l.startsWith("    "));
    expect(tail).toContain("    Edit src/a.ts");
    expect(tail.some((l) => l.trimStart().startsWith("{"))).toBe(false);
    expect(events(pr).some((e) => e.event === "task" && e.task === "TASK-001" && e.state === "done")).toBe(true);
  });

  it("puts the worker's own error text in the task and stop reasons", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.ts"] }], { limits: { retries: 1 } });
    pr.cli.scenario("claude", { stdout: result({ is_error: true, result: "boom: tool denied" }), exit: 1 }, "TASK-001");

    const out = await drive(pr);
    expect(out.stopCode).toBe("tasks_blocked");
    expect(out.reason).toContain("worker exited 1: boom: tool denied");
    const meta = pr.readMeta()!;
    expect(meta.tasks!["TASK-001"]).toMatchObject({ state: "blocked", reason: "worker exited 1: boom: tool denied (after 2 attempts)" });
    expect(meta.drive!.runs).toBe(2);
    const runs = meta.runs!.filter((r) => r.task === "TASK-001");
    expect(runs.map((r) => [r.mode, r.error])).toEqual([["start", "worker exited 1: boom: tool denied"], ["resume", "worker exited 1: boom: tool denied"]]);
    // The retry resumed the first worker's session instead of resetting it.
    expect(meta.sessions!["task:TASK-001"]).toBe(runs[0].session);
    expect((await cmdDrive(args(["demo"], { status: true }), pr.root)).stdout).toMatch(/Stop: tasks_blocked — .*worker exited 1: boom: tool denied/);
  });

  it("stops on the usage limit without spending a run, then resumes the same session", async () => {
    const pr = await project([{ id: "TASK-001", files: ["src/a.ts"] }]);
    const limit = "You've hit your 5-hour limit · resets 1:30pm";
    pr.cli.scenario("claude", {
      script: "mkdir -p src; if [ -f src/a.ts ]; then printf full > src/a.ts; else printf partial > src/a.ts; fi",
      stdout: result({ is_error: true, api_error_status: 429, api_error: "usage_limit_reached", result: limit }),
      exit: 1,
      resumeStdout: "STATUS: DONE\nSummary: finished after the reset",
      resumeExit: 0,
    }, "TASK-001");
    reports(pr);

    const first = await drive(pr);
    expect(first.stopCode).toBe("usage_limit");
    expect(first.reason).toContain(limit);
    expect(first.nextCommand).toBe("kf drive demo");
    expect(first.runs).toBe(0);
    let meta = pr.readMeta()!;
    expect(meta.drive!.runs).toBe(0);
    expect(meta.tasks!["TASK-001"]).toMatchObject({ state: "pending", reason: `usage limit: ${limit}`, attempts: 0 });
    const calls = taskCalls(pr, "TASK-001");
    expect(calls).toHaveLength(1);
    const session = calls[0].argv[calls[0].argv.indexOf("--session-id") + 1];
    expect(meta.sessions!["task:TASK-001"]).toBe(session);
    expect(readFileSync(join(calls[0].cwd, "src/a.ts"), "utf8")).toBe("partial");
    expect((await cmdDrive(args(["demo"], { status: true }), pr.root)).stdout).toContain(`Stop: usage_limit — TASK-001 hit the API usage limit: ${limit}`);

    const second = await drive(pr);
    expect(second.status, second.reason).toBe("ready");
    const again = taskCalls(pr, "TASK-001");
    expect(again).toHaveLength(2);
    expect(again[1].argv).toContain("-r");
    expect(again[1].argv[again[1].argv.indexOf("-r") + 1]).toBe(session);
    meta = pr.readMeta()!;
    expect(meta.tasks!["TASK-001"].state).toBe("done");
    expect(readFileSync(join(pr.worktreePath()!, "src/a.ts"), "utf8")).toBe("full");
  });
});
