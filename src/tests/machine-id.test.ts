import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { machineId, machineIdPath } from "../shared/machine.js";
import { ITEM_LOG_FILE, recordChange } from "../workflow/item-log.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-machine-")));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("machine id", () => {
  it("resolves its file from the home directory in force at call time", () => {
    expect(machineIdPath()).toBe(join(homedir(), ".kf", "machine-id"));
  });

  it("returns the same random uuid on every call and keeps it in the home directory", () => {
    const first = machineId();
    const second = machineId();
    expect(first).toMatch(UUID);
    expect(second).toBe(first);
    expect(readFileSync(join(homedir(), ".kf", "machine-id"), "utf8").trim()).toBe(first);
  });

  it("reuses an id that is already stored, trimmed", () => {
    const stored = "0b6f2a54-3c1d-4c63-9a0e-5d1f6f1f7a11";
    mkdirSync(join(homedir(), ".kf"), { recursive: true });
    writeFileSync(join(homedir(), ".kf", "machine-id"), `${stored}\n`);
    expect(machineId()).toBe(stored);
  });

  it("answers unknown, without throwing, when the .kf location is a file", () => {
    writeFileSync(join(homedir(), ".kf"), "not a directory");
    expect(() => machineId()).not.toThrow();
    expect(machineId()).toBe("unknown");
  });

  it("answers unknown when the stored content is not a uuid", () => {
    mkdirSync(join(homedir(), ".kf"), { recursive: true });
    writeFileSync(join(homedir(), ".kf", "machine-id"), "hello world\n");
    expect(machineId()).toBe("unknown");
  });

  it("writes nothing identifying into a record", () => {
    const root = join(scratch, "project-under-a-temporary-path");
    const dir = join(root, ".works", "implementation", "demo_20261113_0409");
    mkdirSync(dir, { recursive: true });
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "config", "user.name", "Test Author"]);
    const meta = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
    recordChange(root, dir, "demo", "created", null, { stage: "implementation", meta });

    const text = readFileSync(join(dir, ITEM_LOG_FILE), "utf8");
    expect(text.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(text).origin).toEqual({ machine: machineId(), via: "cli" });
    expect(text).not.toContain(hostname());
    expect(text).not.toContain(homedir());
    expect(text).not.toContain(root);
  });
});
