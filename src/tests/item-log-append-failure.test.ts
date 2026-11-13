import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const failAppend = vi.hoisted(() => ({ on: false }));

// System boundary: the real appendFileSync is used unless a test turns the switch on.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    appendFileSync: ((...args: Parameters<typeof actual.appendFileSync>) => {
      if (failAppend.on) throw new Error("ENOSPC: no space left on device");
      return actual.appendFileSync(...args);
    }) as typeof actual.appendFileSync,
  };
});

import { itemLogPath, recordChange } from "../workflow/item-log.js";

const BASE = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
const PR = "https://github.com/acme/app/pull/9";

let scratch: string;
let root: string;
let dir: string;
let stderrWrites: string[];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-itemlog-append-")));
  root = join(scratch, "repo");
  dir = join(root, ".works", "implementation", "demo_20261113_0409");
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test Author"]);
  stderrWrites = [];
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});
afterEach(() => {
  failAppend.on = false;
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a log whose append fails", () => {
  it("does not throw, warns once naming the item and the file, and leaves the readable log untouched", () => {
    const first = JSON.stringify({
      v: 1, at: "2026-11-13T05:00:00.000Z", actor: "t", origin: { machine: "m", via: "cli" },
      event: "created", stage: "implementation", set: BASE,
    });
    writeFileSync(itemLogPath(dir), `${first}\n`);
    const bytes = readFileSync(itemLogPath(dir));
    const before = { stage: "implementation" as const, meta: BASE };
    const after = { stage: "implementation" as const, meta: { ...BASE, pr: PR } };

    failAppend.on = true;
    expect(() => recordChange(root, dir, "demo", "linked", before, after)).not.toThrow();
    failAppend.on = false;

    const printed = stderrWrites.join("").split("\n").filter((l) => l !== "");
    expect(printed).toHaveLength(1);
    expect(printed[0].startsWith("⚠ lifecycle log not written for")).toBe(true);
    expect(printed[0]).toContain("'demo'");
    expect(printed[0]).toContain(itemLogPath(dir));
    expect(readFileSync(itemLogPath(dir)).equals(bytes)).toBe(true);
  });
});
