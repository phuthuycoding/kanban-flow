import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdRules } from "../cli/commands/rules.js";
import { detectStack, detectStacks } from "../project/config.js";
import { PKG_STACK_RULES_DIR } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;
const args = (positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({
  command: "rules",
  positionals,
  options,
});
const dest = (stack: string) => join(root, ".kf", "review", "rules", `${stack}.md`);

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-rules-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("detectStack", () => {
  it("detects node from package.json", async () => {
    await writeFile(join(root, "package.json"), "{}");
    expect(detectStack(root)).toBe("node");
  });

  it("detects each supported manifest", async () => {
    const cases: [string, string][] = [
      ["go.mod", "go"],
      ["Cargo.toml", "rust"],
      ["pyproject.toml", "python"],
      ["requirements.txt", "python"],
      ["composer.json", "php"],
      ["Gemfile", "ruby"],
      ["pom.xml", "java"],
    ];
    for (const [file, stack] of cases) {
      const dir = await mkdtemp(join(tmpdir(), "kf-detect-"));
      await writeFile(join(dir, file), "");
      expect(detectStack(dir)).toBe(stack);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns null when nothing matches", () => {
    expect(detectStack(root)).toBeNull();
  });
});

describe("detectStacks", () => {
  it("finds multiple stacks in a monorepo layout", async () => {
    await writeFile(join(root, "package.json"), "{}");
    await mkdir(join(root, "services", "api"), { recursive: true });
    await writeFile(join(root, "services", "api", "go.mod"), "module x\n");
    await mkdir(join(root, "crates"), { recursive: true });
    await writeFile(join(root, "crates", "Cargo.toml"), "");
    expect(detectStacks(root).sort()).toEqual(["go", "node", "rust"]);
  });

  it("skips dependency and build dirs", async () => {
    await writeFile(join(root, "package.json"), "{}");
    for (const d of ["node_modules/dep", ".git", "dist"]) {
      await mkdir(join(root, d), { recursive: true });
      await writeFile(join(root, d, "go.mod"), "");
    }
    expect(detectStacks(root)).toEqual(["node"]);
  });

  it("detectStacks with maxDepth 0 behaves like detectStack", async () => {
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "go.mod"), "");
    expect(detectStacks(root, 0)).toEqual([]);
    expect(detectStacks(root, 1)).toEqual(["go"]);
  });
});

describe("cmdRules", () => {
  it("installs the detected stack pack into .kf/review/rules", async () => {
    await writeFile(join(root, "package.json"), "{}");
    const r = await cmdRules(args(), root);
    expect(r.code).toBe(0);
    const pack = await readFile(join(PKG_STACK_RULES_DIR, "node.md"), "utf8");
    expect(await readFile(dest("node"), "utf8")).toBe(pack);
  });

  it("installs every detected pack in a monorepo", async () => {
    await writeFile(join(root, "package.json"), "{}");
    await mkdir(join(root, "services"), { recursive: true });
    await writeFile(join(root, "services", "go.mod"), "module x\n");
    const r = await cmdRules(args(), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("node: installed");
    expect(r.stdout).toContain("go: installed");
    expect(await readFile(dest("node"), "utf8")).toContain("Node.js");
    expect(await readFile(dest("go"), "utf8")).toContain("Go Review Rules");
  });

  it("works before kf init by creating .kf/review/rules", async () => {
    await writeFile(join(root, "go.mod"), "module example.com/x\n");
    const r = await cmdRules(args(), root);
    expect(r.code).toBe(0);
    expect(await readFile(dest("go"), "utf8")).toContain("Go Review Rules");
  });

  it("installs explicit --stack packs without detection", async () => {
    const r = await cmdRules(args([], { stack: ["go", "python"] }), root);
    expect(r.code).toBe(0);
    expect(await readFile(dest("go"), "utf8")).toContain("Go Review Rules");
    expect(await readFile(dest("python"), "utf8")).toContain("Python Review Rules");
  });

  it("is idempotent on identical files", async () => {
    await writeFile(join(root, "package.json"), "{}");
    await cmdRules(args(), root);
    const r = await cmdRules(args(), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("already installed");
  });

  it("skips a locally modified file without --force", async () => {
    await mkdir(join(root, ".kf", "review", "rules"), { recursive: true });
    await writeFile(dest("node"), "# my custom rules");
    const r = await cmdRules(args([], { stack: "node" }), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("skipped");
    expect(await readFile(dest("node"), "utf8")).toBe("# my custom rules");
  });

  it("overwrites a modified file with --force", async () => {
    await mkdir(join(root, ".kf", "review", "rules"), { recursive: true });
    await writeFile(dest("node"), "# my custom rules");
    const r = await cmdRules(args([], { stack: "node", force: true }), root);
    expect(r.code).toBe(0);
    const pack = await readFile(join(PKG_STACK_RULES_DIR, "node.md"), "utf8");
    expect(await readFile(dest("node"), "utf8")).toBe(pack);
  });

  it("rejects an unknown stack", async () => {
    const r = await cmdRules(args([], { stack: "cobol" }), root);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Unknown stack");
  });

  it("fails clearly when no stack can be detected", async () => {
    const r = await cmdRules(args(), root);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Cannot detect project stack");
  });

  it("--list reports packs and detection without copying", async () => {
    await writeFile(join(root, "Cargo.toml"), "");
    const r = await cmdRules(args([], { list: true }), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("rust");
    expect(r.stdout).toContain("node");
    await expect(readFile(dest("rust"), "utf8")).rejects.toThrow();
  });
});
