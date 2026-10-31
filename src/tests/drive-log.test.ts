import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { driveConfigSource, driveLogPath } from "../harness/drive-log.js";

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

  it("still refuses a malformed line that is not the last one", async () => {
    await writeFile(driveLogPath(dir, "d1"), `{"event":"start","config_source":"wor\n${event({ event: "task", task: "TASK-001" })}`);
    expect(() => driveConfigSource(dir, "d1")).toThrow(/Malformed line in drive log/);
  });
});
