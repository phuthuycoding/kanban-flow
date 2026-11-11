import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta } from "../workflow/features.js";
import { cancelItem } from "../workflow/cancel.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import type { Stage } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "cancel", positionals, options });
let root: string;

async function addItem(name: string, stage: Stage, extra: Record<string, unknown> = {}): Promise<string> {
  const dir = join(root, ".works", stage, `${name}_20260919_1200`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nX");
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20260919_1200", ...extra });
  return dir;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-cancel-item-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("cancelItem returns a typed outcome", () => {
  it("cancels and reports what it did", async () => {
    await addItem("demo", "implementation");
    const outcome = await cancelItem(root, "demo", { reason: "  dropped  ", by: " Quyen " });
    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome).toMatchObject({
      reason: "dropped",
      by: "Quyen",
      target: join(root, ".works", "cancelled", "demo_20260919_1200"),
      teardown: null,
      bypasses: [],
    });
    expect(outcome.cancellation).toMatchObject({ by: "Quyen", reason: "dropped", fromStage: "implementation" });
    expect(findFeature(root, "demo")!.stage).toBe("cancelled");
  });

  it("refuses a missing reason without touching the item", async () => {
    await addItem("demo", "implementation");
    for (const reason of ["", "   "]) {
      expect(await cancelItem(root, "demo", { reason })).toEqual({
        kind: "refused",
        reason: "missing-reason",
        stderrTag: "missing reason",
        stdout: 'Cancelling needs a reason: kf cancel demo --reason "<why it is being dropped>"',
      });
    }
    expect(findFeature(root, "demo")!.stage).toBe("implementation");
  });

  it("reports a teardown failure that is not a dirty worktree as its own refusal", async () => {
    const routesFile = join(root, "routes.json");
    await writeFile(routesFile, "{");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true, routesFile } }));
    const path = join(root, "gone-worktree");
    await addItem("wt", "implementation", { worktree: { path, branch: "t/wt", domain: "wt.test", port: 4000, createdAt: "20260919_1200" } });

    const outcome = await cancelItem(root, "wt", { reason: "stop" });
    expect(outcome.kind === "refused" && outcome.reason).toBe("teardown-failed");
    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain("Cannot cancel 'wt': worktree teardown failed:");
    expect(text).toContain(`The worktree ${path} is not on disk. The item was not cancelled.`);
    expect(text).toContain("Fix the cause, then re-run: kf cancel wt --reason 'stop'");
    expect(text).not.toContain("hook already ran");
    expect(findFeature(root, "wt")!.stage).toBe("implementation");
  });

  it("a teardown failure after the cancelled hook names the hook and quotes the reason in the re-run", async () => {
    const routesFile = join(root, "routes.json");
    await writeFile(routesFile, "{");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true, routesFile } }));
    const hook = join(root, ".kf", "hooks", "cancelled.sh");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const path = join(root, "gone-worktree");
    await addItem("wt", "implementation", { worktree: { path, branch: "t/wt", domain: "wt.test", port: 4000, createdAt: "20260919_1200" } });

    const outcome = await cancelItem(root, "wt", { reason: " it's done " });

    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain(`The cancelled hook already ran (${hook}). The worktree ${path} is not on disk.`);
    expect(text).toContain(`re-run: kf cancel wt --reason 'it'\\''s done'`);
  });

  it("a dirty worktree after the cancelled hook names the hook and gives the re-run", async () => {
    const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const path = join(root, "wt-tree");
    git("worktree", "add", "-q", "-b", "t/wt", path);
    await writeFile(join(path, "wip.txt"), "uncommitted");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true, routesFile: join(root, "routes.json") } }));
    const hook = join(root, ".kf", "hooks", "cancelled.sh");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await addItem("wt", "implementation", { worktree: { path, branch: "t/wt", domain: "wt.test", port: 4000, createdAt: "20260919_1200" } });

    const outcome = await cancelItem(root, "wt", { reason: "stop", by: "Quyen" });

    expect(outcome.kind === "refused" && outcome.reason).toBe("worktree-dirty");
    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain("Cannot cancel 'wt': Worktree for 'wt' has uncommitted changes");
    expect(text).toContain(`The cancelled hook already ran (${hook}). The item was not cancelled.`);
    expect(text).toContain("re-run: kf cancel wt --reason 'stop' --by 'Quyen'");
    expect(text).not.toContain("--purge-docs");
    expect(existsSync(path)).toBe(true);
    expect(findFeature(root, "wt")!.stage).toBe("implementation");
  });

  it("the teardown re-run repeats the flags that change what cancel does", async () => {
    const routesFile = join(root, "routes.json");
    await writeFile(routesFile, "{");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true, routesFile } }));
    await addItem("wt", "implementation", { worktree: { path: join(root, "gone-worktree"), branch: "t/wt", domain: "wt.test", port: 4000, createdAt: "20260919_1200" } });

    const outcome = await cancelItem(root, "wt", { reason: "stop", by: " Quyen ", force: true, skipHooks: true });

    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain("re-run: kf cancel wt --reason 'stop' --by 'Quyen' --force --skip-hooks");
  });

  it("cancels an archived item without touching its docs", async () => {
    const doc = join(root, "docs", "requirement", "app", "arch.md");
    await mkdir(join(doc, ".."), { recursive: true });
    await writeFile(doc, "x");
    await addItem("arch", "done", { status: "archived" });

    const outcome = await cancelItem(root, "arch", { reason: "superseded" });
    expect(outcome.kind).toBe("cancelled");
    expect(findFeature(root, "arch")!.stage).toBe("cancelled");
    expect(await readFile(doc, "utf8")).toBe("x");
  });

  it("returns a failed move as an error instead of throwing", async () => {
    await addItem("demo", "done", { status: "archived" });
    await writeFile(join(root, ".works", "cancelled", "demo_20260919_1200"), "in the way");
    const outcome = await cancelItem(root, "demo", { reason: "superseded" });
    expect(outcome.kind).toBe("error");
    expect(findFeature(root, "demo")!.meta!.cancellation).toBeUndefined();
  });
});

/** Output of `kf cancel` recorded from the pre-refactor command; `<root>` stands for the temp project. */
describe("kf cancel output is unchanged", () => {
  const render = (s: string) => s.split(root).join("<root>");

  it("success", async () => {
    await addItem("demo", "implementation");
    const res = await cmdCancel(args(["demo"], { reason: "dropped\nsecond line", by: "Quyen" }), root);
    expect({ ...res, stdout: render(res.stdout) }).toEqual({
      code: 0,
      stdout: "✓ Cancelled 'demo' (was implementation) by Quyen\n  Reason: dropped\n  <root>/.works/cancelled/demo_20260919_1200\n  Reopen with: kf stage demo implementation",
    });
  });

  it("missing reason, checked before the project is looked for", async () => {
    await addItem("demo", "implementation");
    const expected = { code: 1, stdout: 'Cancelling needs a reason: kf cancel demo --reason "<why it is being dropped>"', stderr: "missing reason" };
    expect(await cmdCancel(args(["demo"]), root)).toEqual(expected);
    const outside = await mkdtemp(join(tmpdir(), "kf-no-works-"));
    try {
      expect(await cmdCancel(args(["demo"]), outside)).toEqual(expected);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("an archived item lists no docs, and the removed --purge-docs is refused", async () => {
    const docDir = join(root, "docs", "requirement", "app");
    await mkdir(docDir, { recursive: true });
    await writeFile(join(docDir, "arch.md"), "x");
    await writeFile(join(docDir, "gone.md"), "x");
    await addItem("arch", "done", { status: "archived" });
    await addItem("gone", "done", { status: "archived" });

    const kept = await cmdCancel(args(["arch"], { reason: "superseded" }), root);
    expect(render(kept.stdout)).toBe("✓ Cancelled 'arch' (was done) by human\n  Reason: superseded\n  <root>/.works/cancelled/arch_20260919_1200\n  Reopen with: kf stage arch done");
    const purged = await cmdCancel(args(["gone"], { reason: "superseded", "purge-docs": true, force: true }), root);
    expect(purged.code).not.toBe(0);
    expect(`${purged.stdout}\n${purged.stderr ?? ""}`).toContain("--purge-docs was removed: living docs are edited at review (docs/specs/); see kf instruct living-doc");
    expect(findFeature(root, "gone")!.stage).toBe("done");
    expect(existsSync(join(docDir, "gone.md"))).toBe(true);
  });
});
