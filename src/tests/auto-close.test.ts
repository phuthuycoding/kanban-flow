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
import { archiveItem } from "../workflow/archive.js";
import { deleteRemoteBranch } from "../shared/git.js";
import { deleteItemBranch } from "../worktree/lifecycle.js";
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

/**
 * gh stub: logs argv; `pr view` answers $GH_PR_STATE (default MERGED) with head $GH_PR_HEAD_NAME
 * (default t/demo) at $GH_PR_HEAD_OID (default: that branch's tip on the bare origin, a fixed
 * oid once it is gone there);
 * $GH_FAIL makes every call fail.
 */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
if [ -n "$GH_FAIL" ]; then echo "gh must not be called" >&2; exit 1; fi
case "$1" in
  pr)
    if [ "$2" = view ]; then
      head="\${GH_PR_HEAD_NAME:-t/demo}"
      oid="\${GH_PR_HEAD_OID:-$(git -C "$GH_ORIGIN" rev-parse -q --verify "refs/heads/$head")}"
      oid="\${oid:-0123456789abcdef0123456789abcdef01234567}"
      printf '{"state":"%s","headRefName":"%s","headRefOid":"%s"}\\n' "\${GH_PR_STATE:-MERGED}" "$head" "$oid"
    fi; exit 0 ;;
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
  process.env.GH_ORIGIN = origin;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of ["GH_CALLS", "GH_ORIGIN", "GH_FAIL", "GH_PR_STATE", "GH_PR_HEAD_NAME", "GH_PR_HEAD_OID", "DONE_HOOK_EXIT"]) delete process.env[v];
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

describe("auto-close on merge", () => {
  it("kf status closes a merged item: done, worktree and branch gone locally and on origin, hook first", async () => {
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
  }, 15_000);

  it("refuses a dirty worktree from kf status and kf archive before the hook; nothing deleted", async () => {
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
  }, 15_000);

  it("an open PR stays in review with the merge as Next and a Waiting to merge row", async () => {
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
  }, 15_000);

  it("a PR closed without merging is refused and named; nothing is deleted", async () => {
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
  }, 15_000);

  it("landing: none with 0 commits closes without calling gh", async () => {
    await reviewItem("demo", { landing: "none" });
    const wt = feature().meta!.worktree!;
    process.env.GH_FAIL = "1";
    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("✓ done demo (nothing to land)");
    expect(res.stdout).toContain("Branch t/demo: deleted locally, not on origin");
    expect(ghCalls()).not.toContain("pr view");
    expect(feature().stage).toBe("done");
    expect(existsSync(wt.path)).toBe(false);
    expect(git(root, "branch", "--list", "t/demo")).toBe("");
  }, 15_000);

  it("a PASS review report from an earlier execution does not close a merged item until reports for the current one exist", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    const stale = feature().meta!.executionId!;
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: FAIL\nexecution: ${stale}\nci: green\nlanding: pr\n---\n# Evidence\nA finding to fix.\n`);
    expect((await cmdStage(args("stage", ["demo", "implementation"]), root)).code).toBe(0);
    expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
    expect(feature().meta!.executionId).not.toBe(stale);
    await writeReport("demo", "testing-result", "PASS");
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: PASS\nexecution: ${stale}\nci: green\nlanding: pr\n---\n# Evidence\nVerified.\n`);

    const staged = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(staged.code).toBe(1);
    expect(staged.stdout).toContain("review_stale");
    const res = await status();
    expect(res.stdout).not.toContain("✓ done demo");
    expect(res.stdout).toContain("review_stale");
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);

    await writeReport("demo", "review-report", "PASS");
    const closed = await status();
    expect(closed.code, closed.stdout).toBe(0);
    expect(closed.stdout).toContain(`✓ done demo (PR merged: ${PR})`);
    expect(feature().stage).toBe("done");
  }, 15_000);

  it("landing: none with commits is refused with the count", async () => {
    await reviewItem("demo", { landing: "none", commits: 2 });
    const res = await status();
    expect(res.stdout).toContain("landing: none but the branch has 2 commits — open a PR or cancel");
    expect(feature().stage).toBe("review");
    expect(existsSync(feature().meta!.worktree!.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  }, 15_000);

  it("a refusing done hook keeps worktree and branch, locally and on origin", async () => {
    await reviewItem();
    process.env.DONE_HOOK_EXIT = "1";
    const res = await status();
    expect(res.stdout).toContain("Not closed: Hook 'done' failed (exit 1)");
    expect(feature().stage).toBe("review");
    expect(existsSync(feature().meta!.worktree!.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
  }, 15_000);

  it("a remote that refuses the branch delete is reported, never forced, and the close goes on", async () => {
    await reviewItem();
    writeFileSync(join(origin, "hooks", "pre-receive"), "#!/bin/sh\necho protected >&2\nexit 1\n", { mode: 0o755 });
    const res = await status();
    expect(res.stdout).toContain("Branch t/demo: deleted locally, NOT deleted on origin");
    expect(res.stdout).toContain("origin kept t/demo (never forced)");
    expect(feature().stage).toBe("done");
    expect(onOrigin("t/demo")).toContain("t/demo");
  }, 15_000);

  it("a branch with a commit past the merged head closes the item and keeps the branch locally", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    process.env.GH_PR_HEAD_OID = git(origin, "rev-parse", "refs/heads/t/demo");
    writeFileSync(join(wt.path, "late.txt"), "late");
    git(wt.path, "add", ".");
    git(wt.path, "commit", "-qm", "after merge");

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`✓ done demo (PR merged: ${PR})`);
    expect(res.stdout).toContain("Branch t/demo: kept locally, deleted on origin");
    expect(res.stdout).toContain("kept t/demo: 1 commits after the merged head");
    expect(feature().stage).toBe("done");
    expect(git(root, "log", "-1", "--format=%s", "t/demo")).toBe("after merge");
    expect(onOrigin("t/demo")).toBe("");
  }, 15_000);

  it("a remote branch that moved past the merged head is kept on origin", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    const merged = git(wt.path, "rev-parse", "HEAD");
    process.env.GH_PR_HEAD_OID = merged;
    writeFileSync(join(wt.path, "pushed-later.txt"), "later");
    git(wt.path, "add", ".");
    git(wt.path, "commit", "-qm", "pushed after merge");
    git(wt.path, "push", "-q", "origin", "t/demo");
    git(wt.path, "reset", "-q", "--hard", merged);
    const moved = git(origin, "rev-parse", "refs/heads/t/demo");

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Branch t/demo: deleted locally, kept on origin");
    expect(res.stdout).toContain(`origin kept t/demo: it moved to ${moved.slice(0, 12)}, past the commit that landed`);
    expect(feature().stage).toBe("done");
    expect(git(root, "branch", "--list", "t/demo")).toBe("");
    expect(git(origin, "rev-parse", "refs/heads/t/demo")).toBe(moved);
  }, 15_000);

  it("a merged PR of another branch refuses the close before the hook; nothing is deleted", async () => {
    await reviewItem();
    process.env.GH_PR_HEAD_NAME = "t/other";
    const wt = feature().meta!.worktree!;

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(`PR ${PR} merged t/other, not the item branch t/demo`);
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  }, 15_000);

  it("a forced close with no PR keeps a branch that carries commits", async () => {
    await reviewItem("demo", { landing: "none", commits: 2 });
    await writeReport("demo", "review-report", "PASS", "pr");
    const tip = git(root, "rev-parse", "t/demo");

    // landing: pr with no PR recorded fails the review gate; --force closes past it.
    const res = await cmdArchive(args("archive", ["demo"], { force: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(res.stdout).toContain("Branch t/demo: kept locally, not on origin");
    expect(res.stdout).toContain("kept t/demo: 2 commits and no merged PR to prove they landed — never deleted, even with --force");
    expect(git(root, "rev-parse", "t/demo")).toBe(tip);
  }, 15_000);

  it("counts landing: none commits against origin's default branch, not the primary's checkout", async () => {
    await reviewItem("demo", { landing: "none", commits: 2 });
    git(root, "checkout", "-q", "-b", "holder", "t/demo");

    const res = await status();
    expect(res.stdout).toContain("landing: none but the branch has 2 commits — open a PR or cancel");
    expect(feature().stage).toBe("review");
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  }, 15_000);

  it("keeps the branch locally and on origin when origin/HEAD is unset, even at 0 commits ahead of the checkout's HEAD", async () => {
    await reviewItem("demo", { landing: "none", commits: 2 });
    git(root, "push", "-q", "origin", "t/demo");
    git(root, "checkout", "-q", "-b", "holder", "t/demo");
    git(root, "remote", "set-head", "origin", "-d");

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(res.stdout).toContain("Branch t/demo: kept locally, kept on origin");
    expect(res.stdout).toContain("origin/HEAD is not set");
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
  }, 15_000);

  it("a stale lease makes the remote refuse the branch delete and leaves the branch on origin", () => {
    git(root, "push", "-q", "origin", "HEAD:refs/heads/t/lease");
    const stale = git(origin, "rev-parse", "refs/heads/t/lease");
    git(root, "commit", "-q", "--allow-empty", "-m", "moved after the check");
    git(root, "push", "-q", "origin", "HEAD:refs/heads/t/lease");

    expect(() => git(root, "push", "--quiet", `--force-with-lease=refs/heads/t/lease:${stale}`, "origin", "--delete", "t/lease")).toThrow();
    expect(onOrigin("t/lease")).toContain("t/lease");
    expect(deleteRemoteBranch(root, "origin", "t/lease", stale)).toEqual({ kind: "moved", sha: git(origin, "rev-parse", "refs/heads/t/lease") });
    expect(onOrigin("t/lease")).toContain("t/lease");
  });

  it("a branch behind the merged head is reported as safe to delete by hand", async () => {
    await reviewItem("demo");
    const behind = git(root, "rev-parse", "t/demo~1");
    process.env.GH_PR_HEAD_OID = git(root, "rev-parse", "t/demo");
    git(root, "branch", "t/behind", behind);
    expect(deleteItemBranch(root, "t/behind", { kind: "merged-head", sha: process.env.GH_PR_HEAD_OID }).local).toEqual({
      kind: "kept",
      detail: "it is behind the merged head, so deleting it by hand is safe",
    });
  }, 15_000);

  it("kf sync and kf archive leave an item with a live drive alone", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    const now = new Date().toISOString();
    await writeFeatureMeta(feature().dir, {
      ...readFeatureMeta(feature().dir)!,
      drive: { id: "drv", status: "running", step: "review", loops: 0, runs: 1, configHash: "h", supervisorPid: process.pid, startedAt: now, updatedAt: now },
    });

    const synced = await cmdSync(args("sync"), root);
    expect(synced.code, synced.stdout).toBe(0);
    expect(synced.stdout).toContain("- demo: skipped (a drive is running)");
    const archived = await cmdArchive(args("archive", ["demo"]), root);
    expect(archived.code).toBe(1);
    expect(archived.stdout).toContain("drive drv is live");
    expect(feature().stage).toBe("review");
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  }, 15_000);

  it("a second close while one is running refuses before its hook", async () => {
    await reviewItem();
    const outcomes = await Promise.all([archiveItem(root, "demo"), archiveItem(root, "demo")]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["archived", "refused"]);
    const refused = outcomes.find((o) => o.kind === "refused");
    expect(refused?.kind === "refused" && refused.reason).toBe("close-in-progress");
    expect(feature().stage).toBe("done");
    expect(existsSync(join(root, ".works", ".locks", "demo.closing.lock"))).toBe(false);
  }, 15_000);

  it("kf archive stays the explicit, idempotent form of the same close", async () => {
    await reviewItem();
    const first = await cmdArchive(args("archive", ["demo"]), root);
    expect(first.code, first.stdout).toBe(0);
    expect(first.stdout).toContain("Branch t/demo: deleted locally, deleted on origin");
    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).toContain("already in done");
  }, 15_000);
});

describe("canonical docs when the primary checkout is behind origin", () => {
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
  }, 15_000);
});

describe("the canonical docs commit after the irreversible steps", () => {
  /** Leave the primary 2 commits behind origin, so the docs go to a branch in a temp worktree. */
  function putPrimaryBehind(): void {
    const base = git(root, "symbolic-ref", "--short", "HEAD");
    for (const n of [1, 2]) {
      writeFileSync(join(root, `upstream-${n}.txt`), "x");
      git(root, "add", ".");
      git(root, "commit", "-qm", `upstream ${n}`);
    }
    git(root, "push", "-q", "origin", base);
    git(root, "reset", "-q", "--hard", "HEAD~2");
  }

  it("does not run the repository's commit hooks", async () => {
    await reviewItem();
    putPrimaryBehind();
    const hooks = join(scratch, "git-hooks");
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "pre-commit"), "#!/bin/sh\necho 'lint needs node_modules' >&2\nexit 1\n", { mode: 0o755 });
    git(root, "config", "core.hooksPath", hooks);

    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Canonical docs committed to docs/app-demo, not pushed");
    expect(feature().stage).toBe("done");
  }, 15_000);

  it("a failing commit rolls back docs, move and metadata and says what was already removed", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    const originalMeta = readFileSync(join(feature().dir, ".kfw.json"), "utf8");
    putPrimaryBehind();
    // Signing with a program that always fails makes `git commit` fail even with --no-verify.
    git(root, "config", "commit.gpgSign", "true");
    git(root, "config", "gpg.program", "false");

    const res = await status();
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("✗ demo: close failed: Archive failed for 'demo' (committing the canonical docs on docs/app-demo failed:");
    expect(res.stdout).toContain(`feature restored to review (docs, move and metadata rolled back). Already removed and not restored: worktree ${wt.path}, branch t/demo (local), branch t/demo on origin. Fix the cause, then finish with: kf status --change demo`);
    expect(feature().stage).toBe("review");
    expect(readFileSync(join(feature().dir, ".kfw.json"), "utf8")).toBe(originalMeta);
    expect(git(root, "branch", "--list", "docs/app-demo")).toBe("");
    expect(git(root, "worktree", "list")).not.toContain("kf-docs-");
    expect(git(root, "status", "--porcelain")).toBe("");

    git(root, "config", "--unset", "commit.gpgSign");
    const finished = await status();
    expect(finished.code, finished.stdout).toBe(0);
    expect(finished.stdout).toContain("✓ done demo");
    expect(feature().stage).toBe("done");
  }, 15_000);
});

describe("kf status --all ends with Needs you, Waiting to merge and Running", () => {
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
  }, 15_000);
});
