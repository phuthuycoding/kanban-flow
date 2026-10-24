import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lockPath, withLock } from "../shared/lock.js";
import { findFeature, updateFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";

vi.setConfig({ testTimeout: 60_000 });

type CountMeta = { count?: string[] };
let root: string;

async function seedItem(name: string): Promise<string> {
  const dir = join(root, ".works", "implementation", `${name}_20260101_0000`);
  mkdirSync(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "ctx", created: "2026-01-01T00:00:00Z" });
  return dir;
}

const appended = (name: string): string[] => ((findFeature(root, name)!.meta as CountMeta).count ?? []);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kf-lock-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("per-item lock", () => {
  it("TC-026: takes over a lock whose holder pid is dead", async () => {
    const path = lockPath(root, "demo");
    mkdirSync(join(root, ".works", ".locks"), { recursive: true });
    // Above macOS's pid ceiling (99998) and effectively never allocated on Linux.
    writeFileSync(path, "4194303");
    const result = await withLock(root, "demo", async () => readFileSync(path, "utf8"), { timeoutMs: 500 });
    expect(result).toBe(String(process.pid));
    expect(existsSync(path)).toBe(false);
  });

  it("TC-026: a live holder past the timeout fails naming its pid and the lock path", async () => {
    const path = lockPath(root, "demo");
    mkdirSync(join(root, ".works", ".locks"), { recursive: true });
    writeFileSync(path, String(process.ppid));
    const failure = await withLock(root, "demo", async () => "never", { timeoutMs: 150 }).catch((err: Error) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(`pid ${process.ppid}`);
    expect((failure as Error).message).toContain(path);
    expect(readFileSync(path, "utf8")).toBe(String(process.ppid));
  });

  it("releases the lock when the callback throws", async () => {
    await expect(withLock(root, "demo", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(existsSync(lockPath(root, "demo"))).toBe(false);
  });

  it("serializes many concurrent in-process updates without losing any", async () => {
    await seedItem("demo");
    await Promise.all(Array.from({ length: 40 }, (_, i) => updateFeatureMeta(root, "demo", (meta) => {
      const m = meta as CountMeta;
      return { ...meta, count: [...(m.count ?? []), `p${i}`] } as typeof meta;
    })));
    expect(new Set(appended("demo")).size).toBe(40);
  });

  it("loses nothing when two processes update the same item at once", async () => {
    await seedItem("demo");
    const features = join(PKG_ROOT, "dist", "workflow", "features.js");
    const script = `
      const { updateFeatureMeta } = await import(${JSON.stringify(features)});
      const [root, tag] = process.argv.slice(1);
      for (let i = 0; i < 50; i += 1) {
        await updateFeatureMeta(root, "demo", (meta) => ({ ...meta, count: [...(meta.count ?? []), tag + i] }));
      }
    `;
    const run = (tag: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, root, tag], { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err += String(d); });
      child.once("error", reject);
      child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`child ${tag} exited ${code}: ${err}`))));
    });
    await Promise.all([run("a"), run("b")]);
    const all = appended("demo");
    expect(all).toHaveLength(100);
    expect(new Set(all).size).toBe(100);
  });
});
