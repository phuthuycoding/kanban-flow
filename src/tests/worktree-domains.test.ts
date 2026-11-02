import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { parseWorktreeConfig, worktreeConfig } from "../worktree/config.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdValidate } from "../cli/commands/inspect.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import type { ParsedArgs } from "../cli/args.js";

let dir: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-domains-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("worktree.domains config switch", () => {
  it("defaults to true when absent", () => {
    const parsed = parseWorktreeConfig({ enabled: true }, "cfg.json");
    expect(worktreeConfig(dir, parsed).domains).toBe(true);
    expect(worktreeConfig(dir, undefined).domains).toBe(true);
  });

  it("keeps an explicit true", () => {
    const parsed = parseWorktreeConfig({ domains: true }, "cfg.json");
    expect(worktreeConfig(dir, parsed).domains).toBe(true);
  });

  it("keeps an explicit false", () => {
    const parsed = parseWorktreeConfig({ domains: false }, "cfg.json");
    expect(worktreeConfig(dir, parsed).domains).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    expect(() => parseWorktreeConfig({ domains: "no" }, "cfg.json")).toThrow("worktree.domains must be boolean");
  });
});

describe("domain infra probes gated by worktree.domains", () => {
  // A corrupt routes file makes the routes probe fail on any machine, whatever DNS or proxy state it has.
  async function seededProject(worktree: Record<string, unknown>): Promise<string> {
    const root = join(dir, "proj");
    ensureWorksStructure(root);
    await mkdir(join(root, ".kf"), { recursive: true });
    const routesFile = join(dir, "routes.json");
    await writeFile(routesFile, "{not json");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", worktree: { ...worktree, routesFile },
    }));
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(
      join(findFeature(root, "demo")!.dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A",
    );
    return root;
  }

  it("validate emits no infra finding when domains is false", async () => {
    const root = await seededProject({ enabled: true, domains: false });
    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).not.toContain("worktree_infra_missing");
  });

  it("validate still emits the infra finding when domains is true", async () => {
    const root = await seededProject({ enabled: true, domains: true });
    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).toContain("worktree_infra_missing");
  });

  it("validate still emits the infra finding when domains is absent", async () => {
    const root = await seededProject({ enabled: true });
    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).toContain("worktree_infra_missing");
  });

  it("doctor reports no worktree infra line when domains is false", async () => {
    const root = await seededProject({ enabled: true, domains: false });
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.stdout).not.toContain("worktree infra");
  });

  it("doctor still reports the worktree infra line when domains is true", async () => {
    const root = await seededProject({ enabled: true, domains: true });
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.stdout).toContain("[WARNING] worktree infra (routes)");
  });
});
