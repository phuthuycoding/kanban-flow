import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (options: Record<string, unknown> = {}): ParsedArgs => ({ command: "doctor", positionals: [], options });

let root: string;
let prevPath: string | undefined;

/** A `claude` first on PATH that reports the kf plugin current, so only the docs finding can show up. */
async function currentPluginStub(): Promise<void> {
  const bin = join(root, "..", `${basename(root)}-bin`);
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

async function project(contexts: string[]): Promise<void> {
  await currentPluginStub();
  expect((await cmdInit({ command: "init", positionals: [], options: { minimal: true, context: contexts[0] } }, root)).code).toBe(0);
  const cfgPath = join(root, ".kf", "config.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
  await writeFile(cfgPath, JSON.stringify({ ...cfg, contexts }, null, 2));
}

async function legacy(context: string, feature: string): Promise<void> {
  await mkdir(join(root, "docs", "requirement", context), { recursive: true });
  await writeFile(join(root, "docs", "requirement", context, `${feature}.md`), `# ${feature}\n`);
  await mkdir(join(root, "docs", "use-cases", context, feature), { recursive: true });
  await writeFile(join(root, "docs", "use-cases", context, feature, "uc-001.md"), "# uc\n");
}

async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, base));
    else out[full.slice(base.length)] = await readFile(full, "utf8");
  }
  return out;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-legacy-"));
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  prevPath = process.env.PATH;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(join(root, "..", `${basename(root)}-bin`), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("kf doctor with legacy docs", () => {
  beforeEach(async () => {
    await project(["cli", "harness"]);
    await legacy("cli", "alpha");
    await legacy("cli", "beta");
    await legacy("harness", "gamma");
  });

  it("warns once, naming the count per context and kf:docs, and still exits 0", async () => {
    const res = await cmdDoctor(args(), root);
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines.filter((l) => l.includes("Legacy docs not consolidated:"))).toHaveLength(1);
    const line = lines.find((l) => l.includes("Legacy docs not consolidated:"))!;
    expect(line).toContain("[WARNING] docs:");
    expect(line).toMatch(/cli[^,;]*\b2\b/);
    expect(line).toMatch(/harness[^,;]*\b1\b/);
    expect(res.stdout).toContain("kf:docs");
  });

  it("lists the feature names per context in --json", async () => {
    const res = await cmdDoctor(args({ json: true }), root);
    expect(res.code).toBe(0);
    const report = JSON.parse(res.stdout) as { legacyDocs: Record<string, string[]>; ok: boolean };
    expect(report.legacyDocs).toEqual({ cli: ["alpha", "beta"], harness: ["gamma"] });
    expect(report.ok).toBe(true);
  });

  it("leaves docs/ byte-identical under --fix", async () => {
    const before = await snapshot(join(root, "docs"));
    const res = await cmdDoctor(args({ fix: true }), root);
    expect(res.code).toBe(0);
    expect(await snapshot(join(root, "docs"))).toEqual(before);
    expect(res.stdout).toContain("Legacy docs not consolidated:");
  });
});

describe("kf doctor without legacy docs", () => {
  it("reports no legacy-docs finding on a project with none", async () => {
    await project(["cli"]);
    const res = await cmdDoctor(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("Legacy docs not consolidated");
    const report = JSON.parse((await cmdDoctor(args({ json: true }), root)).stdout) as { legacyDocs?: Record<string, string[]> };
    expect(report.legacyDocs ?? {}).toEqual({});
  });

  it("does not count files under an undeclared context", async () => {
    await project(["cli"]);
    await mkdir(join(root, "docs", "requirement", "notes"), { recursive: true });
    await writeFile(join(root, "docs", "requirement", "notes", "scratch.md"), "# scratch\n");
    const res = await cmdDoctor(args(), root);
    expect(res.stdout).not.toContain("Legacy docs not consolidated");
    const report = JSON.parse((await cmdDoctor(args({ json: true }), root)).stdout) as { legacyDocs?: Record<string, string[]> };
    expect(report.legacyDocs ?? {}).toEqual({});
  });
});
