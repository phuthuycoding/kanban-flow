import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readFileSync } from "node:fs";

import { runDoctorFixes } from "../project/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdNew } from "../cli/commands/new.js";
import { PKG_ROOT } from "../shared/paths.js";
import { findFeature } from "../workflow/features.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
let prevPath: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-itemlog-id-"));
  prevPath = process.env.PATH;
  const bin = join(root, "..", `${basename(root)}-bin`);
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
});
afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(join(root, "..", `${basename(root)}-bin`), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("kf doctor --fix and an item id lost from .kfw.json", () => {
  it("restores the id the log already holds instead of minting a new one", async () => {
    expect((await cmdNew(args("new", ["lostid"], { context: "app" }), root)).code).toBe(0);
    const dir = findFeature(root, "lostid")!.dir;
    const file = join(dir, ".kfw.json");
    const original = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const idX = original.id;
    expect(typeof idX).toBe("string");
    const recordsBefore = readFileSync(itemLogPath(dir), "utf8").split("\n").filter((l) => l !== "").length;

    // Hand edit: the id is gone and another shared field changed, so the log is behind.
    const { id: _id, ...rest } = original;
    await writeFile(file, JSON.stringify({ ...rest, goal: "edited by hand" }, null, 2));

    const res = await runDoctorFixes(root);

    expect(res.failures).toEqual([]);
    expect(res.fixed).toContain("lifecycle log of lostid reconciled");
    const text = readFileSync(file, "utf8");
    const meta = JSON.parse(text) as Record<string, unknown>;
    expect(meta.id).toBe(idX);
    expect(text).toBe(JSON.stringify(meta, null, 2));

    const appended = readFileSync(itemLogPath(dir), "utf8").split("\n").filter((l) => l !== "")
      .slice(recordsBefore).map((l) => JSON.parse(l) as { set?: Record<string, unknown>; unset?: string[] });
    expect(appended.length).toBeGreaterThan(0);
    for (const rec of appended) {
      expect(rec.set ?? {}).not.toHaveProperty("id");
      expect(rec.unset ?? []).not.toContain("id");
    }

    const folded = readItemLog(dir);
    expect(folded.ok).toBe(true);
    if (folded.ok) expect(folded.state).toEqual({ stage: findFeature(root, "lostid")!.stage, meta: sharedMeta(meta) });
  });
});
