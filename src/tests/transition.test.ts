import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { transitionItem, type Transition } from "../workflow/transition.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const stageArgs = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "stage", positionals, options });
const confirmed = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const norm = (s: string | undefined) => s?.split(root).join("<ROOT>").replace(/\d{8}_\d{4}/g, "<TS>");

async function fixture(spec: string): Promise<void> {
  root = await realpath(await mkdtemp(join(tmpdir(), "kf-transition-")));
  ensureWorksStructure(root);
  await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root);
  await writeFile(join(findFeature(root, "demo")!.dir, ARTIFACTS["spec-requirement"].file), spec);
}
const failingHook = () => mkdir(join(root, ".kf", "hooks"), { recursive: true }).then(() => writeFile(join(root, ".kf", "hooks", "planning.sh"), "echo boom\nexit 1\n"));
const lockPlanning = () => chmod(join(root, ".works", "planning"), 0o555);

afterEach(async () => {
  await chmod(join(root, ".works", "planning"), 0o755).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
});

describe("transitionItem outcomes (TC-036)", () => {
  it("returns refused/gate with the CLI stdout and tag, and moves nothing", async () => {
    await fixture(confirmed.replace("confirmed", "draft"));
    const out = await transitionItem(root, "demo", "planning", { cwd: root });
    expect(out).toMatchObject({ kind: "refused", reason: "gate", stderrTag: "gate failed" });
    expect(findFeature(root, "demo")!.stage).toBe("brainstorm");
  });

  it("returns hook-failed when the project hook exits 1", async () => {
    await fixture(confirmed);
    await failingHook();
    const out = await transitionItem(root, "demo", "planning", { cwd: root });
    expect(out.kind).toBe("hook-failed");
    if (out.kind !== "hook-failed") return;
    expect(out.stderrTag).toBe("hook failed");
    expect(out.hook).toMatchObject({ ran: true, ok: false, code: 1 });
    expect(out.hook.output).toContain("boom");
    expect(findFeature(root, "demo")!.stage).toBe("brainstorm");
  });

  it("returns moved with from, to, dir and bypasses on success", async () => {
    await fixture(confirmed);
    const out = await transitionItem(root, "demo", "planning", { cwd: root });
    expect(out.kind).toBe("moved");
    if (out.kind !== "moved") return;
    expect(out).toMatchObject({ from: "brainstorm", to: "planning", bypasses: [], reopened: false });
    expect(out.dir).toBe(findFeature(root, "demo")!.dir);
  });

  it("returns error (not a throw) when the rename fails", async () => {
    if (process.getuid?.() === 0) return;
    await fixture(confirmed);
    await lockPlanning();
    const out = await transitionItem(root, "demo", "planning", { cwd: root });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect((out.error as NodeJS.ErrnoException).code).toBe("EACCES");
  });

  it("maps the remaining refusals to their reasons", async () => {
    await fixture(confirmed);
    expect(await transitionItem(root, "nope", "planning", { cwd: root })).toMatchObject({ kind: "refused", reason: "unknown-item", stderrTag: "unknown feature" });
    expect(await transitionItem(root, "demo", "review", { cwd: root })).toMatchObject({ kind: "refused", reason: "invalid-transition", stderrTag: "not allowed transition" });
  });

  it("accepts an injected Transition in place of transitionItem", async () => {
    const calls: unknown[] = [];
    const spy: Transition = async (_root, name, to, opts) => {
      calls.push({ name, to, opts });
      return { kind: "error", error: new Error("stub") };
    };
    expect((await spy("r", "demo", "testing", { cwd: "c" })).kind).toBe("error");
    expect(calls).toEqual([{ name: "demo", to: "testing", opts: { cwd: "c" } }]);
  });
});

describe("cmdStage output is byte-identical to the pre-refactor CLI", () => {
  it("gate failure", async () => {
    await fixture(confirmed.replace("confirmed", "draft"));
    const res = await cmdStage(stageArgs(["demo", "planning"]), root);
    expect({ code: res.code, stdout: norm(res.stdout), stderr: res.stderr }).toEqual({
      code: 1,
      stdout: "Gate failed for 'demo' (brainstorm). Fix validation before moving:\n\n✗ demo (stage brainstorm) — invalid\n  [ERROR] phase-1-spec-requirement.md: Requirement must have status: confirmed before the contract is approved or leaves brainstorm. (requirement_unconfirmed)\n\nOr re-run with --force.",
      stderr: "gate failed",
    });
  });

  it("hook failure", async () => {
    await fixture(confirmed);
    await failingHook();
    const res = await cmdStage(stageArgs(["demo", "planning"]), root);
    expect({ code: res.code, stdout: norm(res.stdout), stderr: res.stderr }).toEqual({
      code: 1,
      stdout: "Hook 'planning' failed (exit 1) [<ROOT>/.kf/hooks/planning.sh].\nTransition refused.\n\nboom\n\nRe-run with --skip-hooks to bypass.",
      stderr: "hook failed",
    });
  });

  it("creates a missing destination stage directory", async () => {
    await fixture(confirmed);
    await rm(join(root, ".works", "planning"), { recursive: true });
    const res = await cmdStage(stageArgs(["demo", "planning"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(findFeature(root, "demo")!.stage).toBe("planning");
  });

  it("leaves the item in place when the destination path is a file", async () => {
    await fixture(confirmed);
    await rm(join(root, ".works", "planning"), { recursive: true });
    await writeFile(join(root, ".works", "planning"), "not a directory");
    let message = "";
    await cmdStage(stageArgs(["demo", "planning"]), root).catch((e: Error) => { message = e.message; });
    expect(message).toMatch(/EEXIST/);
    expect(findFeature(root, "demo")!.stage).toBe("brainstorm");
  });

  it("successful move", async () => {
    await fixture(confirmed);
    const res = await cmdStage(stageArgs(["demo", "planning"]), root);
    expect({ code: res.code, stdout: norm(res.stdout), stderr: res.stderr }).toEqual({
      code: 0,
      stdout: "✓ Moved 'demo' brainstorm → planning\n  <ROOT>/.works/planning/demo_<TS>",
      stderr: undefined,
    });
  });

  it("missing args names shipping between review and dones", async () => {
    await fixture(confirmed);
    const none = await cmdStage(stageArgs([]), root);
    expect(none.code).toBe(1);
    expect(none.stderr).toBe("missing args");
    expect(none.stdout).toContain("review → shipping → dones");
    expect(none.stdout).not.toContain("cancelled");
    const named = await cmdStage(stageArgs(["demo"]), root);
    expect(named.code).toBe(1);
    expect(named.stdout).toBe(none.stdout);
    const unknown = await cmdStage(stageArgs(["demo", "nosuch"]), root);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toBe("unknown stage");
    expect(unknown.stdout).toContain("shipping");
    expect(unknown.stdout).toContain("cancelled");
  });

  it("rename failure is re-thrown with the original error", async () => {
    if (process.getuid?.() === 0) return;
    await fixture(confirmed);
    await lockPlanning();
    let message = "";
    await cmdStage(stageArgs(["demo", "planning"]), root).catch((e: Error) => { message = norm(e.message)!; });
    expect(message).toBe("EACCES: permission denied, rename '<ROOT>/.works/brainstorm/demo_<TS>' -> '<ROOT>/.works/planning/demo_<TS>'");
  });
});
