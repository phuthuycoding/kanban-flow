import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, stageDir, updateFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { FORCE_RETRY_HINT, stageRetryHint, transitionItem, type TransitionOutcome } from "../workflow/transition.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import type { ParsedArgs } from "../cli/args.js";

/** Per-test overrides; every mock delegates to the real module unless its override is set. */
const ctl = vi.hoisted(() => ({
  transition: null as null | ((root: string, name: string) => Promise<unknown>),
  failRestore: false,
  afterEnsure: null as null | ((root: string) => void),
  failRemove: false,
}));

vi.mock("../workflow/transition.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../workflow/transition.js")>();
  return {
    ...real,
    transitionItem: (...a: Parameters<typeof real.transitionItem>) => (ctl.transition ? ctl.transition(a[0], a[1]) : real.transitionItem(...a)),
  };
});

vi.mock("../workflow/features.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../workflow/features.js")>();
  let calls = 0;
  return {
    ...real,
    updateFeatureMeta: (...a: Parameters<typeof real.updateFeatureMeta>) => {
      calls += 1;
      // The first call writes the approval; the second is the restore after a failed move.
      if (ctl.failRestore && calls % 2 === 0) return Promise.reject(new Error("disk full"));
      return real.updateFeatureMeta(...a);
    },
  };
});

vi.mock("../worktree/lifecycle.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../worktree/lifecycle.js")>();
  return {
    ...real,
    ensureWorktree: async (...a: Parameters<typeof real.ensureWorktree>) => {
      const wt = await real.ensureWorktree(...a);
      ctl.afterEnsure?.(a[0]);
      return wt;
    },
    forceRemoveWorktree: (...a: Parameters<typeof real.forceRemoveWorktree>) =>
      ctl.failRemove ? Promise.reject(new Error("worktree is locked")) : real.forceRemoveWorktree(...a),
  };
});

let scratch: string;
let root: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = () => findFeature(root, "demo")!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";

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

const refused = (reason: string, stdout: string): TransitionOutcome => ({ kind: "refused", reason: reason as never, stdout, stderrTag: reason });

beforeEach(async () => {
  ctl.transition = null;
  ctl.failRestore = false;
  ctl.afterEnsure = null;
  ctl.failRemove = false;
  scratch = await mkdtemp(join(tmpdir(), "kf-approve-fail-"));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x",
    worktree: { enabled: true, baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") },
  }));
  await plannedItem();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("kf approve when the move fails", () => {
  it("a gate or direction refusal is retried with kf approve, never with --force", async () => {
    for (const reason of ["gate", "direction"]) {
      ctl.transition = async () => refused(reason, `Gate failed for 'demo' (planning). Fix validation before moving:\n\n  [ERROR] x.md: broken (x)\n\n${FORCE_RETRY_HINT}`);
      const res = await cmdApprove(args("approve", ["demo"]), root);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("[ERROR] x.md: broken (x)");
      expect(res.stdout).not.toContain("--force");
      expect(res.stdout.trimEnd().endsWith("Fix that, then re-run: kf approve demo")).toBe(true);
      expect(feature().meta!.approval).toEqual({ status: "pending" });
    }
  });

  it("a concurrent change is retried with kf approve, not kf stage", async () => {
    ctl.transition = async () => refused("changed-concurrently", `Cannot move 'demo': it changed while the transition was running. ${stageRetryHint("demo", "implementation")}`);
    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("it changed while the transition was running.");
    expect(res.stdout).not.toContain("kf stage demo");
    expect(res.stdout).toContain("Fix that, then re-run: kf approve demo");
  });

  it("an error outcome restores the approval and throws with the cause", async () => {
    const cause = new Error("rename failed");
    ctl.transition = async () => ({ kind: "error", error: cause });
    const err = await cmdApprove(args("approve", ["demo"]), root).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("Approval of 'demo' was not kept: the move to implementation failed: rename failed");
    expect((err as Error).cause).toBe(cause);
    expect(feature().stage).toBe("planning");
    expect(feature().meta!.approval).toEqual({ status: "pending" });
  });

  it("a failed restore throws an AggregateError carrying the move failure and the restore failure", async () => {
    ctl.failRestore = true;
    ctl.transition = async () => refused("gate", `Gate failed.\n\n${FORCE_RETRY_HINT}`);
    const err = await cmdApprove(args("approve", ["demo"]), root).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).message).toContain("previous approval could not be restored");
    expect((err as AggregateError).errors.map((e: Error) => e.message)).toEqual(["Gate failed.", "disk full"]);
  });

  it("leaves the metadata alone when the item was approved again meanwhile", async () => {
    ctl.transition = async (r, name) => {
      await updateFeatureMeta(r, name, (meta) => ({ ...meta, approval: { ...meta.approval!, by: "someone-else" } }));
      return refused("gate", `Gate failed.\n\n${FORCE_RETRY_HINT}`);
    };
    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("⚠ the previous approval was not restored: 'demo' was approved again meanwhile");
    expect(feature().meta!.approval).toMatchObject({ status: "approved", by: "someone-else" });
  });

  it("approve passes on the warning of a new worktree that could not be removed", async () => {
    const warning = "\n\n⚠ The new worktree /wt/demo could not be removed: worktree is locked. Remove it by hand: git worktree remove --force /wt/demo";
    ctl.transition = async () => ({ ...refused("target-exists", `Target already exists: /x${warning}`), cleanupError: new Error("worktree is locked") });
    const res = await cmdApprove(args("approve", ["demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(warning.trim());
  });
});

describe("transition rollback of a new worktree", () => {
  it("reports a worktree it could not remove after a refused move, instead of hiding it", async () => {
    expect((await cmdApprove(args("approve", ["demo"], { backlog: true }), root)).code).toBe(0);
    // Unreadable metadata after the worktree exists makes the move refuse as a concurrent change.
    const metaFile = join(feature().dir, ".kfw.json");
    ctl.afterEnsure = () => writeFileSync(metaFile, "{");
    ctl.failRemove = true;
    const outcome = await transitionItem(root, "demo", "implementation", { cwd: root });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.stdout).toContain("it changed while the transition was running");
    expect(outcome.stdout).toMatch(/⚠ The new worktree .* could not be removed: worktree is locked\. Remove it by hand: git worktree remove --force /);
    expect((outcome.cleanupError as Error).message).toBe("worktree is locked");
    expect(existsSync(join(scratch, "wts", "demo"))).toBe(true);
  });

  it("throws the move failure together with the cleanup failure when the move itself errors", async () => {
    expect((await cmdApprove(args("approve", ["demo"], { backlog: true }), root)).code).toBe(0);
    // A second folder of the same item makes the locked re-read throw after the worktree exists.
    ctl.afterEnsure = (r) => mkdirSync(join(stageDir(r, "implementation"), feature().folder), { recursive: true });
    ctl.failRemove = true;
    const outcome = await transitionItem(root, "demo", "implementation", { cwd: root });
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") return;
    expect(outcome.error).toBeInstanceOf(AggregateError);
    const errors = (outcome.error as AggregateError).errors as Error[];
    expect(errors[0].message).toContain("Ambiguous feature 'demo'");
    expect(errors[1].message).toBe("worktree is locked");
  });
});
