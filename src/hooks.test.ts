import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveHook, runHook } from "./hooks.js";
import { ensureWorksStructure } from "./features.js";

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