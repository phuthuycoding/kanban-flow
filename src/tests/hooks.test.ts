import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readdirSync, readFileSync } from "node:fs";

import { resolveHook, runHook } from "../integrations/hooks.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { STAGES } from "../workflow/schema.js";
import { PKG_GITHUB_HOOKS_DIR, PKG_ROOT } from "../shared/paths.js";

let root: string;

async function setup(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "kfw-hook-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  return root;
}

beforeEach(async () => {
  await setup();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveHook", () => {
  it("resolves project hook over user/package", async () => {
    await writeFile(join(root, ".kf", "hooks", "planning.sh"), "#!/usr/bin/env bash\necho project\n");
    const h = resolveHook(root, "planning");
    expect(h).not.toBeNull();
    expect(h!.source).toBe("project");
    expect(h!.path).toContain(root);
  });

  it("returns null when no hook exists", () => {
    expect(resolveHook(root, "implementation")).toBeNull();
  });

  it("falls back to a project dones.sh for done with a warning, and prefers done.sh once it exists", async () => {
    await writeFile(join(root, ".kf", "hooks", "dones.sh"), "#!/usr/bin/env bash\n");
    const legacy = resolveHook(root, "done");
    expect(legacy?.path).toBe(join(root, ".kf", "hooks", "dones.sh"));
    expect(legacy?.source).toBe("project");
    expect(legacy?.warning).toContain("rename it to done.sh (kf doctor --fix renames it and keeps its content)");

    await writeFile(join(root, ".kf", "hooks", "done.sh"), "#!/usr/bin/env bash\n");
    const current = resolveHook(root, "done");
    expect(current?.path).toBe(join(root, ".kf", "hooks", "done.sh"));
    expect(current?.warning).toBeUndefined();
  });

  it("does not fall back to a legacy file for any other phase", async () => {
    await writeFile(join(root, ".kf", "hooks", "shipping.sh"), "#!/usr/bin/env bash\n");
    expect(resolveHook(root, "review")).toBeNull();
  });
});

describe("runHook", () => {
  it("runs a passing hook and sets env", async () => {
    await mkdir(join(root, ".works", "planning", "f_x"), { recursive: true });
    const script = "#!/usr/bin/env bash\necho \"${KFW_FEATURE}:${KFW_TO_STAGE}\" > hook.out\n";
    await writeFile(join(root, ".kf", "hooks", "planning.sh"), script);
    const res = runHook(root, {
      feature: "f",
      context: "app",
      dir: join(root, ".works", "planning", "f_x"),
      root,
      from: "brainstorm",
      to: "planning",
      approval: "pending",
    });
    expect(res.ran).toBe(true);
    expect(res.ok).toBe(true);
    await expect((await import("node:fs/promises")).readFile(join(root, ".works", "planning", "f_x", "hook.out"), "utf8")).resolves.toBe("f:planning\n");
  });

  it("exports KFW_PROJECT_* from the config project block", async () => {
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow",
      created: "x",
      repository: "o/r",
      project: { owner: "me", number: 3, acGate: false, statusMap: { done: "Done", implementation: "In progress" } },
    }));
    const dir = join(root, ".works", "done", "f_x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "done.sh"), "#!/usr/bin/env bash\necho \"${KFW_PROJECT_OWNER}:${KFW_PROJECT_NUMBER}:${KFW_PROJECT_AC_GATE}:${KFW_PROJECT_STATUS_DONE}:${KFW_PROJECT_STATUS_IMPLEMENTATION}:${KFW_PROJECT_STATUS_TESTING}\" > \"$KFW_FEATURE_DIR/env.out\"\n");
    const res = runHook(root, { feature: "f", context: "app", dir, root, from: "review", to: "done", approval: "pending" });
    expect(res.ok).toBe(true);
    await expect((await import("node:fs/promises")).readFile(join(dir, "env.out"), "utf8")).resolves.toBe("me:3:0:Done:In progress:\n");
  });

  it("exports a legacy dones/shipping statusMap under the done names a done.sh reads, never shipping", async () => {
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow",
      created: "x",
      repository: "o/r",
      project: { owner: "me", number: 3, statusMap: { dones: "Done", shipping: "Ship" } },
    }));
    const dir = join(root, ".works", "done", "f_x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "done.sh"), "#!/usr/bin/env bash\nenv | grep '^KFW_PROJECT_STATUS_' | sort > \"$KFW_FEATURE_DIR/env.out\"\n");
    const res = runHook(root, { feature: "f", context: "app", dir, root, from: "review", to: "done", approval: "pending" });
    expect(res.ok).toBe(true);
    // A dones.sh renamed to done.sh still calls sync_project_status … dones, so the alias stays.
    await expect((await import("node:fs/promises")).readFile(join(dir, "env.out"), "utf8")).resolves.toBe("KFW_PROJECT_STATUS_DONE=Done\nKFW_PROJECT_STATUS_DONES=Done\n");
  });

  it("runs a legacy dones.sh for done with the done status exported under the dones name it reads", async () => {
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow",
      created: "x",
      repository: "o/r",
      project: { owner: "me", number: 3, statusMap: { done: "Done" } },
    }));
    const dir = join(root, ".works", "done", "f_x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "dones.sh"), "#!/usr/bin/env bash\nenv | grep '^KFW_PROJECT_STATUS_' | sort > \"$KFW_FEATURE_DIR/env.out\"\nexit 4\n");
    const res = runHook(root, { feature: "f", context: "app", dir, root, from: "review", to: "done", approval: "pending" });
    // A failing legacy gate still refuses: the fallback keeps the AC gate fail-closed.
    expect(res.ran).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.code).toBe(4);
    await expect((await import("node:fs/promises")).readFile(join(dir, "env.out"), "utf8"))
      .resolves.toBe("KFW_PROJECT_STATUS_DONE=Done\nKFW_PROJECT_STATUS_DONES=Done\n");
  });

  it("reports failure when hook exits non-zero", async () => {
    await writeFile(join(root, ".kf", "hooks", "planning.sh"), "exit 3\n");
    const res = runHook(root, {
      feature: "f",
      context: null,
      dir: root,
      root,
      from: null,
      to: "planning",
      approval: "pending",
    });
    expect(res.ran).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.code).toBe(3);
  });
});

describe("GitHub hook pack follows the stage list (TC-019)", () => {
  for (const dir of [PKG_GITHUB_HOOKS_DIR, join(PKG_ROOT, ".kf", "hooks")]) {
    it(`${dir.slice(PKG_ROOT.length + 1)} has done.sh and no legacy stage hooks`, () => {
      const files = readdirSync(dir);
      for (const stage of STAGES) expect(files).toContain(`${stage}.sh`);
      expect(files).not.toContain("dones.sh");
      expect(files).not.toContain("shipping.sh");
      expect(readFileSync(join(dir, "done.sh"), "utf8")).toMatch(/sync_project_status "\$KFW_FEATURE_DIR" done\n/);
    });
  }
});

