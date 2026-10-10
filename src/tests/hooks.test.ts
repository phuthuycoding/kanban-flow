import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveHook, runHook } from "../integrations/hooks.js";
import { ensureWorksStructure } from "../workflow/features.js";

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
      project: { owner: "me", number: 3, acGate: false, statusMap: { dones: "Done", implementation: "In progress" } },
    }));
    const dir = join(root, ".works", "dones", "f_x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "dones.sh"), "#!/usr/bin/env bash\necho \"${KFW_PROJECT_OWNER}:${KFW_PROJECT_NUMBER}:${KFW_PROJECT_AC_GATE}:${KFW_PROJECT_STATUS_DONES}:${KFW_PROJECT_STATUS_IMPLEMENTATION}:${KFW_PROJECT_STATUS_TESTING}\" > \"$KFW_FEATURE_DIR/env.out\"\n");
    const res = runHook(root, { feature: "f", context: "app", dir, root, from: "review", to: "dones", approval: "pending" });
    expect(res.ok).toBe(true);
    await expect((await import("node:fs/promises")).readFile(join(dir, "env.out"), "utf8")).resolves.toBe("me:3:0:Done:In progress:\n");
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
