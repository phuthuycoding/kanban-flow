import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { cmdInstall } from "../integrations/install.js";
import type { ParsedArgs } from "../cli/args.js";

let dir: string;
const parsed = { command: "autoconfig", options: {}, positionals: [] } as unknown as ParsedArgs;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-autoconfig-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("cmdAutoconfig", () => {
  it("prints context, checklist, rules and workflow guide for an unconfigured project", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    const res = await cmdAutoconfig(parsed, dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# kaban-flow agent setup briefing");
    expect(res.stdout).toContain("## Project context");
    expect(res.stdout).toContain("Detected stacks: node");
    expect(res.stdout).toContain("## Setup checklist");
    expect(res.stdout).toContain("[ ] Project config");
    expect(res.stdout).toContain("kf init --defaults");
    expect(res.stdout).toContain("## Review rules to enforce");
    expect(res.stdout).toContain("general.md");
    expect(res.stdout).toContain("## Workflow guide");
  });

  it("marks items done once the project is configured", async () => {
    await writeFile(join(dir, "package.json"), '{"name":"x"}', "utf8");
    await mkdir(join(dir, ".kf", "review", "rules"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), '{"schema":"kanban-flow","created":"x"}', "utf8");
    for (const f of ["general.md", "security.md", "performance.md", "node.md"]) {
      await writeFile(join(dir, ".kf", "review", "rules", f), "# rule", "utf8");
    }
    await cmdInstall([], { cwd: dir, project: true });

    const res = await cmdAutoconfig(parsed, dir);
    expect(res.stdout).toContain("[x] Project config");
    expect(res.stdout).toContain("[x] Project skills for Claude Code");
    expect(res.stdout).toContain("[x] Base review rules");
    expect(res.stdout).toContain("[x] Stack rule packs: node");
    expect(res.stdout).toContain("[ ] AGENTS.md");
  });
});
