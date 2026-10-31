import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { ensureWorksStructure } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

const TS = "20260101_0000";
const status = (options: Record<string, unknown>): ParsedArgs => ({ command: "status", positionals: [], options });

let root: string;

/** A `.works/dones` folder whose move fails every run: its target already exists in done. */
async function clashingDones(name: string): Promise<void> {
  const meta = JSON.stringify({ schema: "kanban-flow", feature: name, context: "app", created: TS });
  for (const stage of ["dones", "done"]) {
    const dir = join(root, ".works", stage, `${name}_${TS}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), meta);
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-status-legacy-"));
  ensureWorksStructure(root);
  expect((await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root)).code).toBe(0);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf status with a legacy folder that cannot migrate", () => {
  it("names the folder and the cause but exits 0 for an unrelated --change item", async () => {
    const dir = join(root, ".works", "dones", `broken_${TS}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), "{ not json");

    const res = await cmdStatus(status({ change: "demo" }), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(`✗ broken_${TS} left in .works/dones: Invalid JSON in feature metadata`);
    expect(res.stdout).toContain("demo");

    const json = await cmdStatus(status({ change: "demo", json: true }), root);
    expect(json.code).toBe(0);
    expect(json.stderr).toContain(`✗ broken_${TS} left in .works/dones`);
    expect(JSON.parse(json.stdout).feature).toBe("demo");
  });

  it("exits 1 for --all and for the failed item's own --change", async () => {
    await clashingDones("clash");

    const own = await cmdStatus(status({ change: "clash" }), root);
    expect(own.stdout).toContain(`✗ clash_${TS} left in .works/dones: target already exists`);
    expect(own.code).toBe(1);

    expect((await cmdStatus(status({ all: true }), root)).code).toBe(1);
    expect((await cmdStatus(status({ change: "demo" }), root)).code).toBe(0);
  });
});
