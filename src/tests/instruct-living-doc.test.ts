import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorksStructure } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdInstruct } from "../cli/commands/artifacts.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const template = (name: string) => readFileSync(join(repo, "assets", "templates", name), "utf8");
const headings = (text: string) => text.split("\n").filter((l) => /^## /.test(l)).map((l) => l.trim());
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-instruct-living-"));
  await ensureWorksStructure(root);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf instruct living-doc", () => {
  it("prints the target path with placeholders and the template when no change is given", async () => {
    const result = await cmdInstruct(args("instruct", ["living-doc"]), root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Write to: docs/specs/<context>/<capability>.md");
    expect(result.stdout).toContain("--- template ---");
    expect(result.stdout).toContain("## Current behaviour");
  });

  it("fills the context in the target path when a change is given", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const result = await cmdInstruct(args("instruct", ["living-doc"], { change: "demo" }), root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Write to: docs/specs/app/<capability>.md");
  });

  it("prints the index target path without a change and with the context filled given one", async () => {
    const bare = await cmdInstruct(args("instruct", ["living-doc-index"]), root);
    expect(bare.code).toBe(0);
    expect(bare.stdout).toContain("Write to: docs/specs/<context>/README.md");
    expect(bare.stdout).toContain("## Capabilities");
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const filled = await cmdInstruct(args("instruct", ["living-doc-index"], { change: "demo" }), root);
    expect(filled.code).toBe(0);
    expect(filled.stdout).toContain("Write to: docs/specs/app/README.md");
  });

  it("does not register living docs as work item artifacts", () => {
    const ids = Object.values(ARTIFACTS).map((a) => a.id as string);
    expect(ids).not.toContain("living-doc");
    expect(ids).not.toContain("living-doc-index");
  });
});

describe("living doc templates", () => {
  it("the living doc template headings equal the checked headings, in order", async () => {
    const { LIVING_DOC_HEADINGS } = await import("../workflow/living-docs.js");
    expect(headings(template("living-doc.md"))).toEqual([...LIVING_DOC_HEADINGS]);
    expect(headings(template("living-doc.md"))).toEqual(["## Purpose", "## Current behaviour", "## Use cases", "## Surfaces", "## History"]);
  });

  it("the index template has Capabilities and Retired sections", () => {
    const hs = headings(template("living-doc-index.md"));
    expect(hs).toContain("## Capabilities");
    expect(hs).toContain("## Retired");
  });
});

describe("feature report template", () => {
  it("lists living docs and consolidated legacy features under Docs Reconciled without the CLI-copy delivery", () => {
    const text = template("phase-6-feature-report.md");
    expect(text).not.toContain("CLI copies on archive");
    const section = text.split("## Docs Reconciled")[1]?.split(/\n## /)[0] ?? "";
    expect(section).toMatch(/living doc/i);
    expect(section).toMatch(/legacy/i);
    expect(section).toMatch(/consolidat/i);
  });
});

describe("plan, review and bug templates", () => {
  it("the plan template documents the three Documentation Impact line forms", () => {
    const section = template("phase-2-implementation-plan.md").split("## Documentation Impact")[1]?.split(/\n## /)[0] ?? "";
    expect(section).toContain("docs/specs/");
    expect(section).toContain("consolidates: {context}/{feature}");
    expect(section).toContain("none — <reason>");
  });

  it("the review template carries docs and docs_reason frontmatter keys", () => {
    const front = template("phase-5-review-report.md").split("\n---\n")[0] ?? "";
    expect(front).toContain('docs: "{docs}"');
    expect(front).toContain('docs_reason: "{docs_reason}"');
  });

  it("the bug report Documentation Impact speaks of living docs", () => {
    const section = template("phase-1-bug-report.md").split("## Documentation Impact")[1]?.split(/\n## /)[0] ?? "";
    expect(section).toMatch(/living doc/i);
    expect(section).toContain("docs/specs/");
  });
});
