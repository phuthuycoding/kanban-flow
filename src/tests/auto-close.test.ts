import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdSync } from "../cli/commands/sync.js";
import { runDoctor } from "../project/doctor.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
let scratch: string;
let origin: string;
let prevPath: string | undefined;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name = "demo") => findFeature(root, name)!;
const PR = "https://github.com/o/r/pull/7";
const ghCalls = () => (existsSync(join(scratch, "gh-calls.log")) ? readFileSync(join(scratch, "gh-calls.log"), "utf8") : "");
const onOrigin = (branch: string) => git(origin, "branch", "--list", branch);
const status = (options: Record<string, unknown> = { change: "demo" }) => cmdStatus(args("status", [], options), root);

/** gh stub: logs argv; `pr view` answers $GH_PR_STATE (default MERGED); $GH_FAIL makes every call fail. */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
if [ -n "$GH_FAIL" ]; then echo "gh must not be called" >&2; exit 1; fi
case "$1" in
  pr) [ "$2" = view ] && printf '{"state":"%s"}\\n' "\${GH_PR_STATE:-MERGED}"; exit 0 ;;
esac
exit 0
`;

/** done hook: records the env it got and whether the item branch still existed when it ran. */
const DONE_HOOK = `#!/bin/sh
{
  echo "status_done=$KFW_PROJECT_STATUS_DONE"
  echo "branch_at_hook=$(git -C "$KFW_WORK_ROOT" branch --list t/demo | tr -d ' *+')"
} > "$KFW_WORK_ROOT/../hook.out"
exit \${DONE_HOOK_EXIT:-0}
`;

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 1 passed |\n";

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-autoclose-")));
  root = join(scratch, "repo");
  origin = join(scratch, "origin.git");
  await mkdir(root, { recursive: true });
  git(scratch, "init", "-q", root);
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".works/\n.kf/\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const branch = git(root, "symbolic-ref", "--short", "HEAD");
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "-u", "origin", branch);
  git(origin, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "remote", "set-head", "origin", branch);
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x", repository: "o/r",
    worktree: { enabled: true, baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") },
    project: { owner: "me", number: 3, acGate: false, statusMap: { done: "Done" } },
  }));
  await writeFile(join(root, ".kf", "hooks", "done.sh"), DONE_HOOK, { mode: 0o755 });
  const stubBin = join(scratch, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_CALLS = join(scratch, "gh-calls.log");
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of ["GH_CALLS", "GH_FAIL", "GH_PR_STATE", "DONE_HOOK_EXIT"]) delete process.env[v];
  await rm(scratch, { recursive: true, force: true });
});

async function writeReport(name: string, id: "testing-result" | "review-report", status: string, landing = "pr"): Promise<void> {
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: ${status}\nexecution: ${feature(name).meta?.executionId}\n${id === "review-report" ? `ci: green\nlanding: ${landing}\n` : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

async function approvedItem(name: string): Promise<void> {
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

/**
 * Item in review with a PASS pair and a worktree. `landing: "pr"` (default): one commit on the
 * branch, pushed to the bare origin, PR recorded. `landing: "none"`: `commits` commits, nothing pushed.
 */
async function reviewItem(name = "demo", opts: { landing?: "pr" | "none"; commits?: number } = {}): Promise<void> {
  const landing = opts.landing ?? "pr";
  await approvedItem(name);
  const cur = feature(name);
  if (cur.stage !== "implementation") expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  const wt = feature(name).meta!.worktree!;
  for (let i = 0; i < (opts.commits ?? (landing === "pr" ? 1 : 0)); i++) {
    writeFileSync(join(wt.path, `work-${i}.txt`), "work");
    git(wt.path, "add", ".");
    git(wt.path, "commit", "-qm", `work ${i}`);
  }
  if (landing === "pr") git(wt.path, "push", "-q", "-u", "origin", wt.branch);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  await writeReport(name, "testing-result", "PASS");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  if (landing === "pr") await writeFeatureMeta(feature(name).dir, { ...readFeatureMeta(feature(name).dir)!, pr: PR });
  await writeReport(name, "review-report", "PASS", landing);
  await writeFile(join(feature(name).dir, ARTIFACTS["feature-report"].file), "# Feature Report\nShipped.");
}

describe("auto-close on merge (FR-005, UC-003)", () => {
  it("kf status closes a merged item: done, worktree and branch gone locally and on origin, hook first (TC-013)", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    expect(onOrigin("t/demo")).toContain("t/demo");

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`✓ done demo (PR merged: ${PR})`);
    expect(res.stdout).toContain("Branch t/demo: deleted locally, deleted on origin");
    expect(feature().stage).toBe("done");
    expect(feature().dir).toContain(join(".works", "done"));
    const meta = readFeatureMeta(feature().dir)!;
    expect(meta.delivered).toBe(true);
    expect(meta.status).toBe("archived");
    expect(meta.docsBranch).toBeUndefined();
    expect(existsSync(wt.path)).toBe(false);
    expect(git(root, "branch", "--list", "t/demo")).toBe("");
    expect(onOrigin("t/demo")).toBe("");
    // The hook ran while the branch still existed, and got the board column.
    const hook = readFileSync(join(scratch, "hook.out"), "utf8");
    expect(hook).toContain("status_done=Done");
    expect(hook).toContain("branch_at_hook=t/demo");
    // Primary on the default branch, clean, not behind: docs land in the working tree.
    expect(existsSync(join(root, "docs", "requirement", "app", "demo.md"))).toBe(true);
  });

  it("refuses a dirty worktree from kf status and kf archive before the hook; nothing deleted (TC-014)", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    writeFileSync(join(wt.path, "dirty.txt"), "uncommitted");

    const res = await status();
    expect(res.stdout).toContain("Not closed: Cannot archive 'demo': Worktree for 'demo' has uncommitted changes");
    const archived = await cmdArchive(args("archive", ["demo"]), root);
    expect(archived.code).toBe(1);
    expect(archived.stdout).toContain("uncommitted changes");
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  });

  it("an open PR stays in review with the merge as Next and a Waiting to merge row (TC-016)", async () => {
    await reviewItem();
    process.env.GH_PR_STATE = "OPEN";

    const res = await status();
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`Next: merge ${PR} on GitHub, then kf status`);
    expect(feature().stage).toBe("review");
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");

    const all = await status({ all: true });
    expect(all.stdout).toMatch(/Waiting to merge\n {2}demo — https:\/\/github\.com\/o\/r\/pull\/7: gh pr merge 7 --squash\nRunning: 0$/);

    const synced = await cmdSync(args("sync"), root);
    expect(synced.code).toBe(0);
    expect(synced.stdout).toContain("demo: skipped (PR open)");
    expect(feature().stage).toBe("review");
  });

  it("a PR closed without merging is refused and named; nothing is deleted (TC-016)", async () => {
    await reviewItem();
    process.env.GH_PR_STATE = "CLOSED";
    const wt = feature().meta!.worktree!;

    const res = await status();
    expect(res.stdout).toContain(`PR closed without merging: ${PR}`);
    expect(res.stdout).toContain("Next: human decision");
    expect((await cmdArchive(args("archive", ["demo"]), root)).stdout).toContain("closed without merging");
    const synced = await cmdSync(args("sync"), root);
    expect(synced.code).toBe(0);
    expect(synced.stdout).toContain(`${PR} was closed without merging`);
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  });

  it("landing: none with 0 commits closes without calling gh (TC-017 A)", async () => {
    await reviewItem("demo", { landing: "none" });
    process.env.GH_FAIL = "1";
    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("✓ done demo (nothing to land)");
    expect(res.stdout).toContain("Branch t/demo: deleted locally, not on origin");
    expect(ghCalls()).not.toContain("pr view");
    expect(feature().stage).toBe("done");
    expect(git(root, "branch", "--list", "t/demo")).toBe("");
  });

  it("landing: none with commits is refused with the count (TC-017 B)", async () => {
    await reviewItem("demo", { landing: "none", commits: 2 });
    const res = await status();
    expect(res.stdout).toContain("landing: none but the branch has 2 commits — open a PR or cancel");
    expect(feature().stage).toBe("review");
    expect(existsSync(feature().meta!.worktree!.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  });

  it("a refusing done hook keeps worktree and branch, locally and on origin (TC-033)", async () => {
    await reviewItem();
    process.env.DONE_HOOK_EXIT = "1";
    const res = await status();
    expect(res.stdout).toContain("Not closed: Hook 'done' failed (exit 1)");
    expect(feature().stage).toBe("review");
    expect(existsSync(feature().meta!.worktree!.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
  });

  it("a remote that refuses the branch delete is reported, never forced, and the close goes on", async () => {
    await reviewItem();
    writeFileSync(join(origin, "hooks", "pre-receive"), "#!/bin/sh\necho protected >&2\nexit 1\n", { mode: 0o755 });
    const res = await status();
    expect(res.stdout).toContain("Branch t/demo: deleted locally, NOT deleted on origin");
    expect(res.stdout).toContain("origin kept t/demo (never forced)");
    expect(feature().stage).toBe("done");
    expect(onOrigin("t/demo")).toContain("t/demo");
  });

  it("kf archive stays the explicit, idempotent form of the same close", async () => {
    await reviewItem();
    const first = await cmdArchive(args("archive", ["demo"]), root);
    expect(first.code, first.stdout).toBe(0);
    expect(first.stdout).toContain("Branch t/demo: deleted locally, deleted on origin");
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).toContain("already in done");
  });
});

describe("canonical docs when the primary checkout is behind origin (FR-005, TC-015, TC-032)", () => {
  it("commits the docs on docs/<context>-<feature> from origin, leaves the primary untouched, doctor flags it until pushed", async () => {
    await reviewItem();
    const base = git(root, "symbolic-ref", "--short", "HEAD");
    for (const n of [1, 2]) {
      writeFileSync(join(root, `upstream-${n}.txt`), "x");
      git(root, "add", ".");
      git(root, "commit", "-qm", `upstream ${n}`);
    }
    git(root, "push", "-q", "origin", base);
    git(root, "reset", "-q", "--hard", "HEAD~2");

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("✓ done demo");
    expect(res.stdout).toContain("Canonical docs committed to docs/app-demo, not pushed (the checkout is 2 commit(s) behind origin/");
    expect(res.stdout).toContain("git push -u origin docs/app-demo");
    expect(feature().stage).toBe("done");
    expect(readFeatureMeta(feature().dir)!.docsBranch).toBe("docs/app-demo");

    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(join(root, "docs", "requirement", "app", "demo.md"))).toBe(false);
    expect(git(root, "log", "--format=%s", `origin/${base}..docs/app-demo`)).toBe("docs(app): sync canonical docs for demo");
    expect(git(root, "rev-parse", "docs/app-demo^")).toBe(git(root, "rev-parse", `origin/${base}`));
    expect(git(root, "show", "docs/app-demo:docs/requirement/app/demo.md")).toContain("status: archived");
    expect(onOrigin("docs/app-demo")).toBe("");
    expect(git(root, "worktree", "list")).not.toContain("kf-docs-");

    const unpushed = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].message).toContain("docs/app-demo");
    expect(unpushed[0].action).toContain("git push -u origin docs/app-demo");

    const all = await status({ all: true });
    expect(all.stdout).toContain("demo — docs/app-demo awaiting push: git push -u origin docs/app-demo");

    git(root, "push", "-q", "origin", "docs/app-demo");
    expect(runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"))).toHaveLength(0);
  });
});

describe("kf status --all ends with Needs you, Waiting to merge and Running (FR-014, TC-029)", () => {
  async function seed(stage: string, name: string, meta: Record<string, unknown>): Promise<void> {
    const dir = join(root, ".works", stage, `${name}_20260101_0000`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: name, context: "app", created: "x", ...meta }));
  }

  it("lists decisions and merges from kf state, with the same buckets in --json", async () => {
    process.env.GH_PR_STATE = "OPEN";
    expect((await cmdNew(args("new", ["a"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature("a").dir, ARTIFACTS["spec-requirement"].file), "---\nstatus: draft\n---\n# Requirement\n");
    expect((await cmdNew(args("new", ["b"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature("b").dir, ARTIFACTS["spec-requirement"].file), spec);
    expect((await cmdStage(args("stage", ["b", "planning"]), root)).code).toBe(0);
    await reviewItem("c");
    git(root, "branch", "docs/app-d");
    await seed("done", "d", { status: "archived", delivered: true, docsBranch: "docs/app-d" });
    const now = new Date().toISOString();
    await seed("implementation", "e", {
      drive: { id: "drv", status: "running", step: "implementation", loops: 0, runs: 1, configHash: "h", supervisorPid: process.pid, startedAt: now, updatedAt: now },
    });

    const res = await status({ all: true });
    expect(res.code, res.stdout).toBe(0);
    const tail = res.stdout.slice(res.stdout.lastIndexOf("Needs you"));
    expect(tail).toBe([
      "Needs you",
      "  a — confirm spec",
      "  b — approve plan (or --backlog)",
      "Waiting to merge",
      `  c — ${PR}: gh pr merge 7 --squash`,
      "  d — docs/app-d awaiting push: git push -u origin docs/app-d",
      "Running: 1",
    ].join("\n"));

    const json = JSON.parse((await status({ all: true, json: true })).stdout) as {
      needsYou: Array<{ feature: string }>; waitingToMerge: Array<{ feature: string; command: string }>; running: number;
    };
    expect(json.needsYou.map((n) => n.feature)).toEqual(["a", "b"]);
    expect(json.waitingToMerge.map((w) => [w.feature, w.command])).toEqual([["c", "gh pr merge 7 --squash"], ["d", "git push -u origin docs/app-d"]]);
    expect(json.running).toBe(1);
  });
});
