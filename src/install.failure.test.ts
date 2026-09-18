import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { cmdInstall, installProjectSkills } from "./install.js";
import { cmdInit } from "./commands.js";
import { PKG_ROOT } from "./paths.js";

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, existsSync: vi.fn(original.existsSync) };
});

afterEach(() => vi.restoreAllMocks());

describe("installation errors", () => {
  it("propagates missing package skills through install and init", async () => {
    const root = await mkdtemp(join(tmpdir(), "kf-install-failure-"));
    try {
      const original = await vi.importActual<typeof import("node:fs")>("node:fs");
      vi.mocked(fs.existsSync).mockImplementation((path) => String(path) !== join(PKG_ROOT, "skills") && original.existsSync(path));
      expect((await cmdInstall(["claude"])).code).toBe(1);
      expect((await installProjectSkills(root, ["codex"])).code).toBe(1);
      expect((await cmdInit({ command: "init", positionals: [], options: {} }, root)).code).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });
});
