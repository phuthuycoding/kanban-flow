import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readFileSync } from "node:fs";

// The log reads fine but the append fails: only doctor's check after the sync can tell, so a silent
// failure inside syncItemLog must surface as an ERROR, never as "reconciled".
const failAppend = vi.hoisted(() => ({ pathPart: null as string | null }));

// System boundary: the real appendFileSync, except for the one item a test names.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    appendFileSync: ((...a: Parameters<typeof actual.appendFileSync>) => {
      if (failAppend.pathPart !== null && String(a[0]).includes(failAppend.pathPart)) throw new Error("ENOSPC: no space left on device");
      return actual.appendFileSync(...a);
    }) as typeof actual.appendFileSync,
  };
});

import { runDoctorFixes } from "../project/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { cmdNew } from "../cli/commands/new.js";
import { PKG_ROOT } from "../shared/paths.js";
import { findFeature } from "../workflow/features.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let root: string;
let prevPath: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-syncfail-"));
  prevPath = process.env.PATH;
  // A `claude` first on PATH that reports the kf plugin current, so the project itself has no findings.
  const bin = join(root, "..", `${basename(root)}-bin`);
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
});
afterEach(async () => {
  failAppend.pathPart = null;
  vi.restoreAllMocks();
  process.env.PATH = prevPath;
  await rm(join(root, "..", `${basename(root)}-bin`), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

async function behindItem(name: string): Promise<string> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  const f = findFeature(root, name);
  if (!f) throw new Error(`item ${name} not found`);
  const file = join(f.dir, ".kfw.json");
  const meta = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; // untyped JSON read back from disk
  await writeFile(file, JSON.stringify({ ...meta, goal: "edited by hand" }, null, 2));
  return f.dir;
}

describe("kf doctor --fix when the append of a readable log fails", () => {
  it("reports the item as an error, not as reconciled, leaves its log unchanged and still repairs the others", async () => {
    const stuck = await behindItem("stuck");
    const other = await behindItem("other");
    const stuckLog = readFileSync(itemLogPath(stuck), "utf8");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    failAppend.pathPart = `${join(".works", "brainstorm")}/stuck_`;

    const res = await runDoctorFixes(root);

    expect(res.fixed.some((l) => l.includes("stuck"))).toBe(false);
    const stuckFailures = res.failures.filter((f) => f.area.includes("stuck_"));
    expect(stuckFailures).toHaveLength(1);
    expect(stuckFailures[0].level).toBe("ERROR");
    expect(stuckFailures[0].area.endsWith("lifecycle.jsonl")).toBe(true);
    expect(stuckFailures[0].message).toBe("Lifecycle log of 'stuck' could not be written.");
    expect(readFileSync(itemLogPath(stuck), "utf8")).toBe(stuckLog);

    expect(res.fixed).toContain("lifecycle log of other reconciled");
    const folded = readItemLog(other);
    const otherMeta = JSON.parse(readFileSync(join(other, ".kfw.json"), "utf8")) as object; // untyped JSON read back from disk
    expect(folded.ok && folded.state?.meta).toEqual(sharedMeta(otherMeta));
  });
});
