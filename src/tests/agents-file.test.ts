import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";

let dir: string;
const init = (options: Record<string, unknown> = { defaults: true }): ParsedArgs => ({ command: "init", positionals: [], options });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-agents-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("kf init seeds AGENTS.md", () => {
  it("creates AGENTS.md with the node scripts and workflow conventions, and never overwrites it", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { build: "tsc", test: "vitest run", lint: "oxlint src" } }));
    await writeFile(join(dir, "package-lock.json"), "{}");
    const first = await cmdInit(init(), dir);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("AGENTS.md: created");
    const content = await readFile(join(dir, "AGENTS.md"), "utf8");
    for (const expected of ["`npm ci`", "`npm run build`", "`npm test`", "`npm run lint`", "kf autoconfig", "kanban <context> <feature>", "--force"]) {
      expect(content).toContain(expected);
    }
    expect(content).not.toContain("typecheck");

    await writeFile(join(dir, "AGENTS.md"), "# Mine\nkeep this");
    const second = await cmdInit(init(), dir);
    expect(second.stdout).toContain("AGENTS.md: kept existing");
    expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# Mine\nkeep this");
  });

  it("does not create AGENTS.md when CLAUDE.md already guides agents", async () => {
    await writeFile(join(dir, "CLAUDE.md"), "# Claude rules");
    const result = await cmdInit(init(), dir);
    expect(result.stdout).toContain("kept existing AGENTS.md/CLAUDE.md");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("seeds npm install when the project has no lockfile", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: "vitest run" } }));
    await cmdInit(init(), dir);
    const content = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(content).toContain("`npm install`");
    expect(content).not.toContain("npm ci");
  });

  it("seeds a fill-in table with --minimal when no stack is detected", async () => {
    const result = await cmdInit(init({ minimal: true }), dir);
    expect(result.stdout).toContain("AGENTS.md: created");
    const content = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(content).toContain("TODO: fill in");
    expect(content).toContain("kf stage");
  });

  it("reports an unreadable package.json instead of guessing", async () => {
    await writeFile(join(dir, "package.json"), "{");
    await expect(cmdInit(init(), dir)).rejects.toThrow("Invalid JSON");
  });
});
