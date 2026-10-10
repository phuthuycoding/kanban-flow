import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only symlink is denied here — cp/mkdir/rm stay real so the fallback path runs for real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    symlink: vi.fn(async () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    }),
  };
});

import { linkOrCopySkillsTo, MANAGED_SKILLS } from "../integrations/install.js";

afterEach(() => vi.restoreAllMocks());

describe("global install when symlink() is denied (TC-002)", () => {
  it("falls back to copying and reports copy mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kfw-nolink-"));
    try {
      const res = await linkOrCopySkillsTo(dir);
      expect(res.code).toBe(0);
      expect(res.mode).toBe("copy");
      for (const name of MANAGED_SKILLS) {
        const entry = join(dir, name);
        expect(lstatSync(entry).isDirectory(), name).toBe(true);
        expect(lstatSync(entry).isSymbolicLink(), `${name} is not a link`).toBe(false);
        expect(existsSync(join(entry, "SKILL.md"))).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
