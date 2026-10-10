import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { cmdInstall, copySkillsTo, installSkills } from "../integrations/install.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";

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
      await mkdir(join(root, ".works"), { recursive: true });
      expect((await cmdInstall(["claude"], { cwd: root })).code).toBe(1);
      expect((await installSkills(root, ["codex"], "project")).code).toBe(1);
      expect((await cmdInit({ command: "init", positionals: [], options: {} }, root)).code).toBe(1);
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps project copies when a global install fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "kf-install-failure-"));
    try {
      await mkdir(join(root, ".works"), { recursive: true });
      const original = await vi.importActual<typeof import("node:fs")>("node:fs");
      vi.mocked(fs.existsSync).mockImplementation((path) => String(path) !== join(PKG_ROOT, "skills") && original.existsSync(path));
      const skillsDir = join(root, ".claude", "skills");
      // Real copies first — the failing install must not take them down with it.
      vi.mocked(fs.existsSync).mockImplementation(original.existsSync);
      await copySkillsTo(skillsDir);
      vi.mocked(fs.existsSync).mockImplementation((path) => String(path) !== join(PKG_ROOT, "skills") && original.existsSync(path));

      expect((await cmdInstall([], { cwd: root })).code).toBe(1);
      expect(original.existsSync(join(skillsDir, "kanban-flow", "SKILL.md"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });
});
