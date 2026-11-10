import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta, withDocsLanded, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdSync } from "../cli/commands/sync.js";
import { archiveItem } from "../workflow/archive.js";
import { deleteRemoteBranch, landedProof } from "../shared/git.js";
import { deleteItemBranch } from "../worktree/lifecycle.js";
import { runDoctor } from "../project/doctor.js";
import { checkMergeGate, gh } from "../integrations/github.js";
import type { ParsedArgs } from "../cli/args.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

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
 * oid once it is gone there); `pr list` answers $GH_PR_LIST (default []);
 * $GH_FAIL makes every call fail with $GH_FAIL_TEXT on stderr; $GH_SLEEP delays every call.
 */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALLS"
if [ -n "$GH_SLEEP" ]; then sleep "$GH_SLEEP"; fi
if [ -n "$GH_FAIL" ]; then printf '%b\\n' "\${GH_FAIL_TEXT:-gh must not be called}" >&2; exit 1; fi
case "$1" in
  pr)
    if [ "$2" = view ]; then
      head="\${GH_PR_HEAD_NAME:-t/demo}"
      oid="\${GH_PR_HEAD_OID:-$(git -C "$GH_ORIGIN" rev-parse -q --verify "refs/heads/$head")}"
      oid="\${oid:-0123456789abcdef0123456789abcdef01234567}"
      printf '{"state":"%s","headRefName":"%s","headRefOid":"%s"}\\n' "\${GH_PR_STATE:-MERGED}" "$head" "$oid"
    fi
    if [ "$2" = list ]; then echo "\${GH_PR_LIST:-[]}"; fi
    exit 0 ;;
esac
exit 0
`;

/** done hook: appends the env it got and whether the item branch still existed when it ran, once per run. */
const DONE_HOOK = `#!/bin/sh
{
  echo "status_done=$KFW_PROJECT_STATUS_DONE"
  echo "branch_at_hook=$(git -C "$KFW_WORK_ROOT" branch --list t/demo | tr -d ' *+')"
} >> "$KFW_WORK_ROOT/../hook.out"
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
  for (const v of ["GH_CALLS", "GH_ORIGIN", "GH_FAIL", "GH_PR_STATE", "GH_PR_HEAD_NAME", "GH_PR_HEAD_OID", "GH_PR_LIST", "GH_FAIL_TEXT", "GH_SLEEP", "DONE_HOOK_EXIT", "REAL_GIT", "RACE_REPO", "RACE_SHA"]) delete process.env[v];
  await rm(scratch, { recursive: true, force: true });
});

async function writeReport(name: string, id: "testing-result" | "review-report", status: string, landing = "pr"): Promise<void> {
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: ${status}\nexecution: ${feature(name).meta?.executionId}\n${id === "review-report" ? `ci: green\nlanding: ${landing}\n${REVIEW_DOCS_NONE}` : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

async function approvedItem(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
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
  await grantStageWaiver(root, name);
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
    expect(all.stdout).toMatch(/Waiting to merge\n {2}demo — https:\/\/github\.com\/o\/r\/pull\/7: gh pr merge 7$/);

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
    const before = ghCalls();
    const res = await status();
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("✓ done demo (nothing to land)");
    expect(res.stdout).toContain("Branch t/demo: deleted locally, not on origin");
    expect(ghCalls()).toBe(before);
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
    await grantStageWaiver(root, "demo");
    expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file),
      `---\nstatus: PASS\nexecution: ${stale}\nci: green\nlanding: pr\n${REVIEW_DOCS_NONE}---\n# Evidence\nVerified.\n`);

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

  it("closes a merged item whose review passed another commit, and says so", async () => {
    await reviewItem();
    const report = join(feature().dir, "phase-5-review-report.md");
    writeFileSync(report, readFileSync(report, "utf8").replace("---\n", "---\ncommit: 1234567890abcdef\n"));
    const res = await status();
    expect(feature().stage).toBe("done");
    expect(res.stdout).toContain("the review passed 1234567 but");
    expect(res.stdout).toContain("the review did not see the last commits");
  }, 15_000);

  it("a branch with a commit past the merged head refuses the close before any side effect, naming both shas", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    const merged = git(origin, "rev-parse", "refs/heads/t/demo");
    process.env.GH_PR_HEAD_OID = merged;
    writeFileSync(join(wt.path, "late.txt"), "late");
    git(wt.path, "add", ".");
    git(wt.path, "commit", "-qm", "after merge");
    const tip = git(root, "rev-parse", "t/demo");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(`the item branch t/demo is at ${tip.slice(0, 12)}, 1 commits past ${merged.slice(0, 12)} that PR ${PR} merged`);
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
    expect(existsSync(wt.path)).toBe(true);
    expect(git(root, "rev-parse", "t/demo")).toBe(tip);
    expect(onOrigin("t/demo")).toContain("t/demo");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);

    // kf status runs the same close and reports the refusal instead of closing.
    const st = await status();
    expect(st.stdout).toContain("1 commits past");
    expect(feature().stage).toBe("review");
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
    expect(res.stdout).toContain(`origin kept t/demo: it is at ${moved.slice(0, 12)}, not the commit that landed`);
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

  it("a branch that moves on origin between the probe and the delete is refused by the lease and stays on origin", async () => {
    git(root, "push", "-q", "origin", "HEAD:refs/heads/t/lease");
    const probed = git(origin, "rev-parse", "refs/heads/t/lease");
    git(root, "commit", "-q", "--allow-empty", "-m", "pushed by someone else mid-delete");
    const moved = git(root, "rev-parse", "HEAD");
    // git wrapper: right after the ls-remote probe answers, another client moves the branch on origin.
    const raceBin = join(scratch, "racebin");
    await mkdir(raceBin, { recursive: true });
    await writeFile(join(raceBin, "git"), `#!/bin/sh
"$REAL_GIT" "$@"; rc=$?
case " $* " in *" ls-remote "*) "$REAL_GIT" -C "$RACE_REPO" push -q origin "$RACE_SHA:refs/heads/t/lease" ;; esac
exit $rc
`, { mode: 0o755 });
    process.env.REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    process.env.RACE_REPO = root;
    process.env.RACE_SHA = moved;
    process.env.PATH = `${raceBin}:${process.env.PATH}`;

    const res = deleteRemoteBranch(root, "origin", "t/lease", probed);
    expect(res.kind).toBe("refused");
    expect(git(origin, "rev-parse", "refs/heads/t/lease")).toBe(moved);
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

  it("kf sync skips an item another close is already closing", async () => {
    await reviewItem();
    await mkdir(join(root, ".works", ".locks"), { recursive: true });
    await writeFile(join(root, ".works", ".locks", "demo.closing.lock"), String(process.pid));

    const synced = await cmdSync(args("sync"), root);
    expect(synced.code, synced.stdout).toBe(0);
    expect(synced.stdout).toContain("- demo: skipped (another close of it is running)");
    expect(feature().stage).toBe("review");
    expect(existsSync(join(scratch, "hook.out"))).toBe(false);
  }, 15_000);

  it("a second close while one is running refuses before its hook", async () => {
    await reviewItem();
    const outcomes = await Promise.all([archiveItem(root, "demo"), archiveItem(root, "demo")]);
    expect(outcomes.map((o) => o.kind).sort()).toEqual(["archived", "refused"]);
    // The hook appends once per run: exactly one run means the refused close never reached it.
    expect(readFileSync(join(scratch, "hook.out"), "utf8").match(/^status_done=/gm)).toHaveLength(1);
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
    expect(ghCalls(), "a push without -u leaves no trace once pruned, so gh is still asked").toContain("gh pr list -R o/r --head docs/app-demo --state merged");

    git(root, "push", "-q", "origin", "docs/app-demo");
    expect(runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"))).toHaveLength(0);

    const docsUnpushed = () => runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    const awaiting = async () => (await status({ all: true })).stdout.includes("docs/app-demo not proven merged");

    // Deleted on origin without a merge (a PR closed unmerged): a pruned upstream proves nothing.
    git(root, "push", "-q", "-u", "origin", "docs/app-demo");
    git(root, "push", "-q", "origin", "--delete", "docs/app-demo");
    git(root, "fetch", "-q", "--prune", "origin");
    expect(docsUnpushed()).toHaveLength(1);
    expect(await awaiting()).toBe(true);

    // Merged into origin's default branch, then pruned: the tip is in origin/<default>.
    git(root, "push", "-q", "origin", `docs/app-demo:${base}`);
    git(root, "fetch", "-q", "--prune", "origin");
    expect(docsUnpushed()).toHaveLength(0);
    expect(await awaiting()).toBe(false);
  }, 15_000);

  it("a squash-merged and pruned docs branch is landed only on a merged PR for that head; gh failing proves nothing", async () => {
    await reviewItem();
    const base = git(root, "symbolic-ref", "--short", "HEAD");
    writeFileSync(join(root, "upstream.txt"), "x");
    git(root, "add", ".");
    git(root, "commit", "-qm", "upstream");
    git(root, "push", "-q", "origin", base);
    git(root, "reset", "-q", "--hard", "HEAD~1");
    expect((await status()).stdout).toContain("Canonical docs committed to docs/app-demo, not pushed");
    git(root, "push", "-q", "-u", "origin", "docs/app-demo");
    git(root, "push", "-q", "origin", "--delete", "docs/app-demo");
    git(root, "fetch", "-q", "--prune", "origin");
    const tip = git(root, "rev-parse", "docs/app-demo");
    // Only now point origin at GitHub, so the merged-PR check has a repository to ask; nothing fetches after this.
    git(root, "remote", "set-url", "origin", "https://github.com/o/r.git");
    const docsUnpushed = () => runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));

    expect(docsUnpushed()).toHaveLength(1);
    expect(ghCalls()).toContain("gh pr list -R o/r --head docs/app-demo --state merged --json number,headRefOid");

    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    expect(docsUnpushed()).toHaveLength(1);

    process.env.GH_FAIL = "1";
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: tip }]);
    expect(docsUnpushed()).toHaveLength(1);
    delete process.env.GH_FAIL;
    expect(docsUnpushed()).toHaveLength(0);
    expect(readFeatureMeta(feature().dir)!.docsBranch, "doctor only reports").toBe("docs/app-demo");

    expect((await status({ all: true })).stdout).not.toContain("docs/app-demo not proven merged");
    const meta = readFeatureMeta(feature().dir)!;
    expect(meta.docsBranch).toBeUndefined();
    expect(meta.docsCommit).toBeUndefined();
    expect(meta.docsLanded).toMatchObject({ branch: "docs/app-demo", by: "merged-pr" });

    const before = ghCalls();
    expect((await status({ all: true })).stdout).not.toContain("docs/app-demo");
    expect(ghCalls().slice(before.length), "a landed docs branch is not asked about again").not.toContain("--head docs/app-demo");
  }, 15_000);

  it("kf archive --skip-specs on a done item keeps the docs branch record", async () => {
    await reviewItem();
    const base = git(root, "symbolic-ref", "--short", "HEAD");
    writeFileSync(join(root, "upstream.txt"), "x");
    git(root, "add", ".");
    git(root, "commit", "-qm", "upstream");
    git(root, "push", "-q", "origin", base);
    git(root, "reset", "-q", "--hard", "HEAD~1");
    expect((await status()).stdout).toContain("Canonical docs committed to docs/app-demo, not pushed");
    const before = readFeatureMeta(feature().dir)!;
    expect((await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root)).code).toBe(0);
    expect(readFeatureMeta(feature().dir)!.docsBranch).toBe("docs/app-demo");
    expect(readFeatureMeta(feature().dir)!.docsCommit).toBe(before.docsCommit);
  }, 15_000);

  it("records the docs commit at close and proves a deleted docs branch landed only by a merged PR at that commit", async () => {
    await reviewItem();
    const base = git(root, "symbolic-ref", "--short", "HEAD");
    writeFileSync(join(root, "upstream.txt"), "x");
    git(root, "add", ".");
    git(root, "commit", "-qm", "upstream");
    git(root, "push", "-q", "origin", base);
    git(root, "reset", "-q", "--hard", "HEAD~1");
    expect((await status()).stdout).toContain("Canonical docs committed to docs/app-demo, not pushed");
    const sha = git(root, "rev-parse", "docs/app-demo");
    expect(readFeatureMeta(feature().dir)!.docsCommit).toBe(sha);
    git(root, "branch", "-D", "docs/app-demo");

    process.env.GH_PR_LIST = JSON.stringify([{ number: 4, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    expect(landedProof(root, "docs/app-demo", sha)).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      reason: "local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; "
        + `merged PR #4 for docs/app-demo does not carry the docs commit ${sha.slice(0, 12)}`,
    });
    process.env.GH_PR_LIST = JSON.stringify([{ number: 4, headRefOid: sha }]);
    expect(landedProof(root, "docs/app-demo", sha)).toEqual({ landed: true, by: "merged-pr" });
  }, 15_000);
});

describe("kf archive on a done item with a recorded docs branch", () => {
  const base = () => git(root, "symbolic-ref", "--short", "HEAD");
  const meta = () => readFeatureMeta(feature().dir)!;
  const requirement = () => join(root, "docs", "requirement", "app", "demo.md");

  /** Close with the primary one commit behind origin, so the docs go onto docs/app-demo. */
  async function closedOntoDocsBranch(): Promise<void> {
    await reviewItem();
    writeFileSync(join(root, "upstream.txt"), "x");
    git(root, "add", ".");
    git(root, "commit", "-qm", "upstream");
    git(root, "push", "-q", "origin", base());
    git(root, "reset", "-q", "--hard", "HEAD~1");
    expect((await status()).stdout).toContain("Canonical docs committed to docs/app-demo, not pushed");
  }

  /** An item closed before docsCommit was recorded. */
  async function dropDocsCommit(): Promise<void> {
    const { docsCommit: _commit, ...rest } = meta();
    await writeFeatureMeta(feature().dir, rest);
  }

  it("keeps a live unpushed docs branch and writes nothing to the working tree", async () => {
    await closedOntoDocsBranch();
    const before = meta();

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Canonical docs wait on docs/app-demo: git push -u origin docs/app-demo, then open a PR for it — nothing rewritten.");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(requirement())).toBe(false);
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(before.docsCommit);
  }, 15_000);

  it("re-lands a gone docs branch from a stale primary on a fresh docs branch cut from origin and records it again", async () => {
    await closedOntoDocsBranch();
    git(root, "branch", "-D", "docs/app-demo");
    expect((await status({ all: true })).stdout).toContain(
      "): re-land them on a fresh docs branch for a PR with kf archive demo, or leave them");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`Canonical docs never landed; committed again to docs/app-demo, not pushed (the checkout is 1 commit(s) behind origin/${base()}):`);
    expect(res.stdout).toContain("Push it: git push -u origin docs/app-demo, then open a PR for it.");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(requirement())).toBe(false);
    expect(git(root, "rev-parse", "docs/app-demo^")).toBe(git(root, "rev-parse", `origin/${base()}`));
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(git(root, "rev-parse", "docs/app-demo"));
    expect((await status({ all: true })).stdout).toContain("  demo — docs/app-demo awaiting push: git push -u origin docs/app-demo");
  }, 15_000);

  it("re-lands a gone docs branch from a clean, current primary on a fresh docs branch, never into the working tree", async () => {
    await closedOntoDocsBranch();
    git(root, "branch", "-D", "docs/app-demo");
    git(root, "reset", "-q", "--hard", `origin/${base()}`);

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Canonical docs never landed; committed again to docs/app-demo, not pushed (the docs branch docs/app-demo is gone and nothing proves its docs landed, so the rewrite must show in a PR diff):");
    expect(res.stdout).not.toContain("do not merge it");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(requirement())).toBe(false);
    expect(git(root, "rev-parse", "docs/app-demo^")).toBe(git(root, "rev-parse", `origin/${base()}`));
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(git(root, "rev-parse", "docs/app-demo"));
  }, 15_000);

  it("a second reconcile after a re-land waits on the new local branch: no switch, nothing written to the tree", async () => {
    await closedOntoDocsBranch();
    git(root, "branch", "-D", "docs/app-demo");
    git(root, "reset", "-q", "--hard", `origin/${base()}`);
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    const relanded = meta().docsCommit;

    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).toContain("Canonical docs wait on docs/app-demo: git push -u origin docs/app-demo, then open a PR for it — nothing rewritten.");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(requirement())).toBe(false);
    expect(git(root, "rev-parse", "docs/app-demo")).toBe(relanded);
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(relanded);
  }, 15_000);

  it("refuses to re-land a gone docs branch when origin/HEAD is unset and leaves an edited canonical doc as it is", async () => {
    await closedOntoDocsBranch();
    const before = meta();
    git(root, "branch", "-D", "docs/app-demo");
    git(root, "reset", "-q", "--hard", `origin/${base()}`);
    await mkdir(join(root, "docs", "requirement", "app"), { recursive: true });
    writeFileSync(requirement(), "# My draft\n");
    git(root, "add", "docs");
    git(root, "commit", "-qm", "draft");
    writeFileSync(requirement(), "# My draft\nUncommitted edit.\n");
    git(root, "remote", "set-head", "origin", "-d");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(1);
    expect(res.stdout).toContain("git remote set-head origin -a");
    expect(readFileSync(requirement(), "utf8")).toBe("# My draft\nUncommitted edit.\n");
    expect(git(root, "branch", "--list", "docs/app-demo")).toBe("");
    expect(meta().docsBranch).toBe(before.docsBranch);
    expect(meta().docsCommit).toBe(before.docsCommit);
  }, 15_000);

  it("re-lands a gone docs branch on a fresh branch when the merged-PR lookup cannot run", async () => {
    await closedOntoDocsBranch();
    git(root, "branch", "-D", "docs/app-demo");
    const { pr: _pr, ...rest } = meta();
    await writeFeatureMeta(feature().dir, rest);
    const config = JSON.parse(readFileSync(join(root, ".kf", "config.json"), "utf8"));
    delete config.repository;
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify(config));
    const before = ghCalls();

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(ghCalls().slice(before.length)).not.toContain("--head docs/app-demo");
    expect(res.stdout).toContain("Canonical docs not proven landed (local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; origin is not a GitHub repository, so a merged PR cannot be checked); committed again to docs/app-demo, not pushed");
    expect(res.stdout).not.toContain("never landed");
    expect(res.stdout).toContain("\n  ⚠ If the earlier PR did merge, this PR reverts later edits to these docs: do not merge it.\n");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(existsSync(requirement())).toBe(false);
    expect(git(root, "rev-parse", "docs/app-demo^")).toBe(git(root, "rev-parse", `origin/${base()}`));
    expect(meta().docsCommit).toBe(git(root, "rev-parse", "docs/app-demo"));
  }, 15_000);

  it("says why a local docs branch that was pushed and pruned is not proven merged", async () => {
    await closedOntoDocsBranch();
    git(root, "push", "-q", "-u", "origin", "docs/app-demo");
    git(root, "push", "-q", "origin", "--delete", "docs/app-demo");
    git(root, "fetch", "-q", "--prune", "origin");
    const tip = git(root, "rev-parse", "docs/app-demo");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`Canonical docs wait on docs/app-demo — not proven merged (no merged PR has docs/app-demo at ${tip.slice(0, 12)} as its head)`);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(meta().docsBranch).toBe("docs/app-demo");
  }, 15_000);

  it("proves an item closed before docsCommit landed by the docs on origin, without asking gh", async () => {
    await closedOntoDocsBranch();
    git(root, "push", "-q", "origin", `docs/app-demo:${base()}`);
    git(root, "branch", "-D", "docs/app-demo");
    await dropDocsCommit();
    const before = ghCalls();

    const res = await status({ all: true });
    expect(res.stdout).not.toContain("docs/app-demo");
    expect(meta().docsBranch).toBeUndefined();
    expect(meta().docsLanded).toMatchObject({ branch: "docs/app-demo", by: "content" });
    expect(ghCalls().slice(before.length)).not.toContain("--head docs/app-demo");
    expect(runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"))).toEqual([]);
  }, 15_000);

  it("re-lands an item closed before docsCommit whose docs were edited on origin since onto a docs branch, never into the tree", async () => {
    await closedOntoDocsBranch();
    git(root, "push", "-q", "origin", `docs/app-demo:${base()}`);
    git(root, "branch", "-D", "docs/app-demo");
    await dropDocsCommit();
    git(root, "reset", "-q", "--hard", `origin/${base()}`);
    writeFileSync(requirement(), `${readFileSync(requirement(), "utf8")}\nEdited after the merge.\n`);
    git(root, "commit", "-qam", "edit docs");
    git(root, "push", "-q", "origin", base());
    const before = ghCalls();

    const needs = (await status({ all: true })).stdout;
    expect(needs).toContain(`no docs commit was recorded and origin/${base()} does not hold these docs): re-land them on a fresh docs branch for a PR with kf archive demo`);
    expect(ghCalls().slice(before.length)).not.toContain("--head docs/app-demo");

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("committed again to docs/app-demo, not pushed (the docs branch docs/app-demo is gone and nothing proves its docs landed, so the rewrite must show in a PR diff):");
    expect(readFeatureMeta(feature().dir)!.bypasses ?? []).toEqual([]);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(readFileSync(requirement(), "utf8")).toContain("Edited after the merge.");
    expect(git(root, "diff", "--name-only", `origin/${base()}`, "docs/app-demo")).toBe("docs/requirement/app/demo.md");
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(git(root, "rev-parse", "docs/app-demo"));
  }, 15_000);

  it("kf status --all leaves the landing for a later run when the item is locked, and still exits normally", async () => {
    await closedOntoDocsBranch();
    git(root, "push", "-q", "origin", `docs/app-demo:${base()}`);
    await mkdir(join(root, ".works", ".locks"), { recursive: true });
    await writeFile(join(root, ".works", ".locks", "demo.lock"), String(process.pid));

    const res = await status({ all: true });
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("⚠ demo: docs branch docs/app-demo landed; the item is locked by another kf command, so the landing is recorded on a later run");
    expect(res.stdout.slice(res.stdout.lastIndexOf("Waiting to merge"))).not.toContain("docs/app-demo");
    expect(meta().docsBranch).toBe("docs/app-demo");

    await rm(join(root, ".works", ".locks", "demo.lock"));
    expect((await status({ all: true })).code).toBe(0);
    expect(meta().docsLanded).toMatchObject({ branch: "docs/app-demo", by: "ancestor" });
  }, 15_000);

  it("the item block agrees with the buckets on the run that proves the landing", async () => {
    await closedOntoDocsBranch();
    git(root, "push", "-q", "origin", `docs/app-demo:${base()}`);
    const res = await status({ all: true });
    expect(res.stdout).not.toContain("Docs branch: docs/app-demo");
    const json = JSON.parse((await status({ all: true, json: true })).stdout) as { features: Array<{ feature: string; docsBranch: string | null }> };
    expect(json.features.find((f) => f.feature === "demo")?.docsBranch).toBeNull();
  }, 15_000);

  it("the landing record ignores a docs branch that changed since it was proven", () => {
    const recorded = { schema: "kanban-flow" as const, feature: "demo", context: "app", created: "x", docsBranch: "docs/app-demo", docsCommit: "a".repeat(40) };
    expect(withDocsLanded(recorded, "docs/app-other", "ancestor")).toBe(recorded);
    expect(withDocsLanded(recorded, "docs/app-demo", "content")).toMatchObject({ docsLanded: { branch: "docs/app-demo", by: "content" } });
    expect(withDocsLanded(recorded, "docs/app-demo", "content").docsBranch).toBeUndefined();
  });

  it("rejects a docs branch that is not docs/<context>-<feature>", async () => {
    await reviewItem();
    const dir = feature().dir;
    const raw = JSON.parse(readFileSync(join(dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
    for (const bad of ["docs/app-demo;touch x", "docs/app-other", "docs/$(id)"]) {
      writeFileSync(join(dir, ".kfw.json"), JSON.stringify({ ...raw, docsBranch: bad }));
      expect(() => readFeatureMeta(dir), bad).toThrow("Invalid feature metadata");
    }
    writeFileSync(join(dir, ".kfw.json"), JSON.stringify({ ...raw, docsBranch: "docs/app-demo" }));
    expect(readFeatureMeta(dir)!.docsBranch).toBe("docs/app-demo");
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
    expect(res.stdout).toContain("Commit hooks were skipped for this kf-authored docs commit (--no-verify)");
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

describe("a close that fails after the done hook says what is already gone", () => {
  it("a teardown failure that is not a dirty worktree is reported as such, with what was removed", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    // The hook leaves the routes file unreadable, so teardown fails after git worktree remove.
    await writeFile(join(root, ".kf", "hooks", "done.sh"), `#!/bin/sh\nprintf '{' > "$KFW_WORK_ROOT/../routes.json"\n`, { mode: 0o755 });

    const outcome = await archiveItem(root, "demo");
    expect(outcome.kind === "refused" && outcome.reason).toBe("teardown-failed");
    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain("Cannot archive 'demo': worktree teardown failed:");
    expect(text).toContain(`The done hook already ran (${join(root, ".kf", "hooks", "done.sh")}).`);
    expect(text).toContain(`The worktree ${wt.path} was removed. The branch was not deleted.`);
    expect(feature().stage).toBe("review");
    expect(git(root, "branch", "--list", "t/demo")).toContain("t/demo");
    expect(onOrigin("t/demo")).toContain("t/demo");
  }, 15_000);

  it("an item that changed during the close names the worktree and branches already removed", async () => {
    await reviewItem();
    const wt = feature().meta!.worktree!;
    // The worktree-remove hook runs inside teardown, after every gate held: it moves the item.
    await writeFile(join(root, ".kf", "hooks", "worktree-remove.sh"), `#!/bin/sh\nmv "$KFW_FEATURE_DIR" "$KFW_WORK_ROOT/.works/implementation/"\n`, { mode: 0o755 });

    const outcome = await archiveItem(root, "demo");
    expect(outcome.kind === "refused" && outcome.reason).toBe("changed-concurrently");
    expect(outcome.kind === "refused" && outcome.stdout).toBe(
      `Cannot archive 'demo': it changed while the archive was running. Already removed and not restored: worktree ${wt.path}, branch t/demo (local), branch t/demo on origin. Re-run: kf archive demo`,
    );
    expect(feature().stage).toBe("implementation");
  }, 15_000);
});

describe("kf status --all ends with Needs you and Waiting to merge", () => {
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
    git(root, "branch", "docs/app-d", git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs"));
    await seed("done", "d", { status: "archived", delivered: true, docsBranch: "docs/app-d" });

    const res = await status({ all: true });
    expect(res.code, res.stdout).toBe(0);
    const tail = res.stdout.slice(res.stdout.lastIndexOf("Needs you"));
    expect(tail).toBe([
      "Needs you",
      "  a — confirm spec",
      "  b — approve plan (or --backlog)",
      "Waiting to merge",
      `  c — ${PR}: gh pr merge 7`,
      "  d — docs/app-d awaiting push: git push -u origin docs/app-d",
    ].join("\n"));

    const json = JSON.parse((await status({ all: true, json: true })).stdout) as {
      needsYou: Array<{ feature: string }>; waitingToMerge: Array<{ feature: string; command: string }>;
    };
    expect(json.needsYou.map((n) => n.feature)).toEqual(["a", "b"]);
    expect(json.waitingToMerge.map((w) => [w.feature, w.command])).toEqual([["c", "gh pr merge 7"], ["d", "git push -u origin docs/app-d"]]);
  }, 15_000);
});

describe("landedProof on a docs branch gone from origin", () => {
  /** docs/app-x one commit past the default branch, pushed with an upstream and then deleted on origin. */
  function prunedDocsBranch(): string {
    const tip = git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs");
    git(root, "branch", "docs/app-x", tip);
    git(root, "push", "-q", "-u", "origin", "docs/app-x");
    git(root, "push", "-q", "origin", "--delete", "docs/app-x");
    git(root, "fetch", "-q", "--prune", "origin");
    return tip;
  }

  it("asks the configured repository when origin is not a GitHub URL", () => {
    const tip = prunedDocsBranch();
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: tip }]);
    expect(landedProof(root, "docs/app-x")).toEqual({ landed: true, by: "merged-pr" });
    expect(ghCalls()).toContain("gh pr list -R o/r --head docs/app-x --state merged");
  });

  it("reports a branch with no trace of a push and no merged PR as not pushed", () => {
    const tip = git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs");
    git(root, "branch", "docs/app-x", tip);
    expect(landedProof(root, "docs/app-x")).toMatchObject({ landed: false, pushed: false });
  });

  it("finds the merged PR of a branch pushed without -u, then deleted on origin and pruned", () => {
    const tip = git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs");
    git(root, "branch", "docs/app-x", tip);
    git(root, "push", "-q", "origin", "docs/app-x");
    git(origin, "branch", "-D", "docs/app-x");
    git(root, "fetch", "-q", "--prune", "origin");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: tip }]);
    expect(landedProof(root, "docs/app-x")).toEqual({ landed: true, by: "merged-pr" });
  });

  it("counts a remote-tracking ref left by a push without -u as a push", () => {
    const tip = git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs");
    git(root, "branch", "docs/app-x", tip);
    git(root, "push", "-q", "origin", "docs/app-x");
    git(origin, "branch", "-D", "docs/app-x");
    expect(landedProof(root, "docs/app-x")).toEqual({
      landed: false, pushed: true, reason: `no merged PR has docs/app-x at ${tip.slice(0, 12)} as its head`,
    });
  });

  const goneText = "local branch docs/app-x is gone and there is no remote-tracking ref for it here, so there is nothing to push";

  it("does not ask gh about a deleted branch when no docs commit was recorded", () => {
    prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    expect(landedProof(root, "docs/app-x")).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      reason: `${goneText}; no docs commit was recorded to tie a merged PR to these docs`,
    });
    expect(ghCalls()).toBe("");
  });

  it("does not take a stale merged PR with the same name and another head as proof of the recorded docs commit", () => {
    const tip = prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    expect(landedProof(root, "docs/app-x", tip)).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      reason: `${goneText}; merged PR #9 for docs/app-x does not carry the docs commit ${tip.slice(0, 12)}`,
    });
  });

  it("proves a deleted branch landed by a merged PR at the recorded docs commit, or one that builds on it", () => {
    const tip = prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: tip }]);
    expect(landedProof(root, "docs/app-x", tip)).toEqual({ landed: true, by: "merged-pr" });
    const edited = git(root, "commit-tree", `${tip}^{tree}`, "-p", tip, "-m", "suggestion applied on GitHub");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: edited }]);
    expect(landedProof(root, "docs/app-x", tip)).toEqual({ landed: true, by: "merged-pr" });
  });

  it("proves a deleted branch landed when the recorded docs commit is in origin's default branch", () => {
    const tip = prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    git(root, "push", "-q", "origin", `${tip}:refs/heads/${git(root, "symbolic-ref", "--short", "HEAD")}`);
    git(root, "fetch", "-q", "origin");
    expect(landedProof(root, "docs/app-x", tip)).toEqual({ landed: true, by: "ancestor" });
    expect(ghCalls()).toBe("");
  });

  it("marks a branch deleted locally and on origin with no merged PR as gone, with nothing to push", () => {
    const tip = prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    expect(landedProof(root, "docs/app-x", tip)).toEqual({
      landed: false,
      pushed: true,
      gone: true,
      reason: `${goneText}; no merged PR has docs/app-x as its head`,
    });
  });

  it("does not mark a deleted branch gone when the merged-PR lookup failed", () => {
    const tip = prunedDocsBranch();
    git(root, "branch", "-D", "docs/app-x");
    process.env.GH_FAIL = "1";
    process.env.GH_FAIL_TEXT = "HTTP 502";
    expect(landedProof(root, "docs/app-x", tip)).toEqual({ landed: false, pushed: true, reason: `${goneText}; gh pr list failed: HTTP 502` });
  });

  it("names an invalid project config in one line instead of throwing", async () => {
    prunedDocsBranch();
    await writeFile(join(root, ".kf", "config.json"), "{ not json\n");
    const proof = landedProof(root, "docs/app-x");
    expect(proof).toMatchObject({ landed: false, pushed: true });
    const reason = proof.landed ? "" : proof.reason ?? "";
    expect(reason).toMatch(/^the project config is invalid \(.+\), so a merged PR cannot be checked$/);
    expect(reason).not.toContain("\n");
    expect(ghCalls()).toBe("");
  });

  it("keeps kf's own hint whole for a long branch name", () => {
    const branch = "docs/app-workflow-slim-with-a-long-name";
    const tip = git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs");
    git(root, "branch", branch, tip);
    git(root, "push", "-q", "-u", "origin", branch);
    git(root, "push", "-q", "origin", "--delete", branch);
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    const proof = landedProof(root, branch);
    const reason = proof.landed ? "" : proof.reason ?? "";
    expect(reason.endsWith("fetch it, or delete the local branch if that PR carried this work)")).toBe(true);
  });

  it("accepts a merged PR whose head, available locally, builds on the local tip", () => {
    const tip = prunedDocsBranch();
    const edited = git(root, "commit-tree", `${tip}^{tree}`, "-p", tip, "-m", "suggestion applied on GitHub");
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: edited }]);
    expect(landedProof(root, "docs/app-x")).toEqual({ landed: true, by: "merged-pr" });
  });

  it("names a merged PR at another head that is not available locally", () => {
    const tip = prunedDocsBranch();
    process.env.GH_PR_LIST = JSON.stringify([{ number: 9, headRefOid: "0123456789abcdef0123456789abcdef01234567" }]);
    const proof = landedProof(root, "docs/app-x");
    expect(proof).toEqual({
      landed: false,
      pushed: true,
      reason: `a merged PR for docs/app-x has head 0123456789ab, not the local tip ${tip.slice(0, 12)} `
        + "(that head is not available locally to compare; fetch it, or delete the local branch if that PR carried this work)",
    });
  });

  it("keeps a failing gh's reason on one line and short", () => {
    prunedDocsBranch();
    process.env.GH_FAIL = "1";
    process.env.GH_FAIL_TEXT = `GraphQL: Could not resolve\n  at line 1\n${"x".repeat(400)}`;
    const proof = landedProof(root, "docs/app-x");
    const reason = proof.landed ? "" : proof.reason ?? "";
    expect(reason.startsWith("gh pr list failed: GraphQL: Could not resolve at line 1 xxx")).toBe(true);
    expect(reason).not.toContain("\n");
    expect(reason.length).toBe("gh pr list failed: ".length + 200);
    expect(reason.endsWith("…")).toBe(true);
  });

  it("reports a gh call that outlives its timeout as a failure", () => {
    process.env.GH_SLEEP = "5";
    const res = gh(["pr", "list"], { timeoutMs: 300 });
    expect(res).toMatchObject({ ok: false, missing: false, timedOut: true, stderr: "gh pr list timed out after 300 ms" });
  });

  it("treats a merge gate gh call that outlives its timeout as unverifiable", () => {
    process.env.GH_SLEEP = "5";
    const started = Date.now();
    expect(checkMergeGate({ meta: { pr: PR } }, "o/r", 300)).toEqual({
      kind: "failed", failure: { reason: "unverifiable", pr: PR, detail: "gh pr view timed out after 300 ms" },
    });
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
