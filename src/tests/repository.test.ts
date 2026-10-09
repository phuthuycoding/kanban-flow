import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { normalizeRepository, detectRepository, issueUrl } from "../project/repository.js";
import { readProjectConfig } from "../project/config.js";
import { ensureWorksStructure, writeFeatureMeta, readFeatureMeta } from "../workflow/features.js";
import { bootstrapDefaults, saveConfig } from "../project/bootstrap.js";
import { cmdIssues } from "../cli/commands/issues.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-repo-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function project(config?: Record<string, unknown>): Promise<void> {
  ensureWorksStructure(dir);
  if (config) {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261008_1200", ...config }));
  }
}

describe("normalizeRepository", () => {
  it("accepts owner/name and strips a .git suffix or trailing slash", () => {
    expect(normalizeRepository("owner/repo")).toBe("owner/repo");
    expect(normalizeRepository("owner/repo.git")).toBe("owner/repo");
    expect(normalizeRepository("owner/repo/")).toBe("owner/repo");
    expect(normalizeRepository(" ZenifyAIContactCenter/monitoring ")).toBe("ZenifyAIContactCenter/monitoring");
  });

  it("accepts the remote URL shapes git returns", () => {
    expect(normalizeRepository("https://github.com/owner/repo")).toBe("owner/repo");
    expect(normalizeRepository("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(normalizeRepository("https://github.com/owner/repo/")).toBe("owner/repo");
    expect(normalizeRepository("git@github.com:owner/repo.git")).toBe("owner/repo");
    expect(normalizeRepository("ssh://git@github.com/owner/repo.git")).toBe("owner/repo");
  });

  it("rejects non-GitHub hosts and malformed input", () => {
    expect(normalizeRepository("https://gitlab.com/owner/repo")).toBeNull();
    expect(normalizeRepository("owner/repo/extra")).toBeNull();
    expect(normalizeRepository("owner")).toBeNull();
    expect(normalizeRepository("owner/")).toBeNull();
    expect(normalizeRepository("")).toBeNull();
  });

  it("builds the issue URL for a number", () => {
    expect(issueUrl("owner/repo", 42)).toBe("https://github.com/owner/repo/issues/42");
  });
});

describe("detectRepository", () => {
  it("reads the origin remote of a git repo", () => {
    execFileSync("git", ["init", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "git@github.com:ZenifyAIContactCenter/monitoring.git"]);
    expect(detectRepository(dir)).toBe("ZenifyAIContactCenter/monitoring");
  });

  it("returns null outside git and for non-GitHub remotes", () => {
    expect(detectRepository(dir)).toBeNull();
    execFileSync("git", ["init", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://gitlab.com/o/r.git"]);
    expect(detectRepository(dir)).toBeNull();
  });
});

describe("config repository", () => {
  it("normalizes a URL to owner/name on read", async () => {
    await project({ repository: "git@github.com:owner/repo.git" });
    expect(readProjectConfig(dir).repository).toBe("owner/repo");
  });

  it("refuses a value that is not a GitHub repo", async () => {
    await project({ repository: "https://gitlab.com/o/r" });
    expect(() => readProjectConfig(dir)).toThrow(/repository must be a GitHub repo/);
  });

  it("bootstrap defaults pick up the detected remote", async () => {
    ensureWorksStructure(dir);
    execFileSync("git", ["init", dir]);
    execFileSync("git", ["-C", dir, "remote", "add", "origin", "https://github.com/owner/repo.git"]);
    expect(bootstrapDefaults(dir).repository).toBe("owner/repo");
  });

  it("saveConfig writes repository only when answered", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    const base = {
      contexts: [] as string[], defaultContext: "app", defaultContextStated: false,
      stacks: [], reviewer: "x", ignoreWorks: false, seedFeature: false, agents: ["claude"] as never[],
    };
    saveConfig(dir, { ...base });
    expect(readProjectConfig(dir).repository).toBeUndefined();
    saveConfig(dir, { ...base, repository: "owner/repo" });
    expect(readProjectConfig(dir).repository).toBe("owner/repo");
  });
});

describe("work item issue link", () => {
  it("accepts an issue URL in .kfw.json and refuses other shapes", async () => {
    await project();
    const itemDir = join(dir, ".works", "brainstorm", "feat_20261008_1200");
    await mkdir(itemDir, { recursive: true });
    const meta = { schema: "kanban-flow", feature: "feat", context: "app", created: "20261008_1200" };
    await writeFeatureMeta(itemDir, { ...meta, issue: "https://github.com/owner/repo/issues/42" });
    expect(readFeatureMeta(itemDir)?.issue).toBe("https://github.com/owner/repo/issues/42");
    await writeFeatureMeta(itemDir, { ...meta, issue: "42" });
    expect(() => readFeatureMeta(itemDir)).toThrow(/Invalid feature metadata/);
  });
});

describe("kf issues", () => {
  it("refuses when no repository is configured", async () => {
    await project();
    const res = await cmdIssues(args("issues"), dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/No repository configured/);
  });

  it("validates --state and --limit before touching gh", async () => {
    await project({ repository: "owner/repo" });
    expect((await cmdIssues(args("issues", [], { state: "bogus" }), dir)).stdout).toMatch(/Unknown state/);
    expect((await cmdIssues(args("issues", [], { limit: "abc" }), dir)).stdout).toMatch(/Invalid --limit/);
  });

  it("link records an issue number or URL on the work item", async () => {
    await project({ repository: "owner/repo" });
    const itemDir = join(dir, ".works", "brainstorm", "feat_20261008_1200");
    await mkdir(itemDir, { recursive: true });
    await writeFeatureMeta(itemDir, { schema: "kanban-flow", feature: "feat", context: "app", created: "20261008_1200" });

    const res = await cmdIssues(args("issues", ["link", "feat", "42"]), dir);
    expect(res.code).toBe(0);
    expect(readFeatureMeta(itemDir)?.issue).toBe("https://github.com/owner/repo/issues/42");

    // A second link is refused instead of silently overwriting.
    const again = await cmdIssues(args("issues", ["link", "feat", "43"]), dir);
    expect(again.code).toBe(1);
    expect(readFeatureMeta(itemDir)?.issue).toBe("https://github.com/owner/repo/issues/42");
  });

  it("link refuses a malformed target", async () => {
    await project({ repository: "owner/repo" });
    const itemDir = join(dir, ".works", "brainstorm", "feat_20261008_1200");
    await mkdir(itemDir, { recursive: true });
    await writeFeatureMeta(itemDir, { schema: "kanban-flow", feature: "feat", context: "app", created: "20261008_1200" });
    const res = await cmdIssues(args("issues", ["link", "feat", "not-an-issue"]), dir);
    expect(res.code).toBe(1);
    expect(readFeatureMeta(itemDir)?.issue).toBeUndefined();
  });
});
