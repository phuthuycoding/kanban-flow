import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendDriveEvent, driveConfigSource, driveLogPath } from "../harness/drive-log.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-drive-log-"));
  await mkdir(join(dir, "runs"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const event = (o: Record<string, unknown>) => `${JSON.stringify({ at: "2026-10-31T00:00:00.000Z", ...o })}\n`;

describe("driveConfigSource", () => {
  it("skips a resume event cut off by a killed supervisor and keeps the last complete source", async () => {
    const torn = event({ event: "resume", config_source: "origin" }).slice(0, 40);
    await writeFile(driveLogPath(dir, "d1"), event({ event: "start", config_source: "worktree" }) + event({ event: "task", task: "TASK-001" }) + torn);
    expect(driveConfigSource(dir, "d1")).toBe("worktree");
  });

  it("skips a torn event once a resumed drive appended after it, and reads the later lines", async () => {
    const torn = event({ event: "start", config_source: "worktree" }).slice(0, 70);
    await writeFile(driveLogPath(dir, "d1"), torn + "\n" + event({ event: "resume", config_source: "origin" }) + event({ event: "task", task: "TASK-001" }));
    expect(driveConfigSource(dir, "d1")).toBe("origin");
  });

  it("recovers a resume event glued onto a torn fragment", async () => {
    const torn = event({ event: "start", config_source: "worktree", nested: { at: "x" } }).slice(0, 70);
    await writeFile(driveLogPath(dir, "d1"), torn + event({ event: "resume", config_source: "primary" }) + event({ event: "task", task: "TASK-001" }));
    expect(driveConfigSource(dir, "d1")).toBe("primary");
  });

  it("still refuses a malformed line that is not the last one", async () => {
    await writeFile(driveLogPath(dir, "d1"), `{"event":"start","config_source":"wor\n${event({ event: "task", task: "TASK-001" })}`);
    expect(() => driveConfigSource(dir, "d1")).toThrow(/Malformed line in drive log/);
  });
});

describe("appendDriveEvent", () => {
  it("starts on a fresh line after a fragment left by a killed supervisor", async () => {
    const root = await mkdtemp(join(tmpdir(), "kf-drive-log-root-"));
    try {
      const item = join(root, ".works", "implementation", "demo_20261031_0000");
      await mkdir(join(item, "runs"), { recursive: true });
      const torn = event({ event: "start", config_source: "worktree" }).slice(0, 70);
      await writeFile(driveLogPath(item, "d1"), torn);
      appendDriveEvent(root, "demo", "d1", { event: "resume", config_source: "origin" });
      appendDriveEvent(root, "demo", "d1", { event: "task", task: "TASK-001" });
      const lines = (await readFile(driveLogPath(item, "d1"), "utf8")).split("\n");
      expect(lines[0]).toBe(torn);
      expect(JSON.parse(lines[1]!)).toMatchObject({ event: "resume", config_source: "origin" });
      expect(JSON.parse(lines[2]!)).toMatchObject({ event: "task" });
      expect(driveConfigSource(item, "d1")).toBe("origin");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
