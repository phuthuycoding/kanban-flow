import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { cmdValidate } from "../cli/commands/inspect.js";
import { writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

interface Entry {
  feature: string;
  stage: string;
  valid: boolean;
  issues: { severity: string; code: string; file: string; message: string }[];
}

const args = (options: Record<string, unknown>): ParsedArgs => ({ command: "validate", positionals: [], options });

let repo: string;

const sh = (...a: string[]) =>
  execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function write(rel: string, body: string): void {
  const path = join(repo, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function commit(message: string): void {
  sh("add", "-A");
  sh("commit", "-qm", message);
}

// Spelled out here so a wrong heading list in the implementation cannot make a fixture agree with it.
const FULL_DOC = [
  "# Capability", "", "## Purpose", "", "x", "", "## Current behaviour", "", "x", "", "## Use cases", "", "x", "",
  "## Surfaces", "", "x", "", "## History", "", "- Created (#1)", "",
].join("\n");
const withoutHistory = FULL_DOC.split("## History")[0];

beforeEach(async () => {
  repo = await realpath(await mkdtemp(join(tmpdir(), "kf-validate-docs-")));
  execFileSync("git", ["init", "-q", "-b", "main", repo], { stdio: "pipe" });
  sh("config", "user.email", "t@t");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
  write(".kf/config.json", JSON.stringify({ schema: "kanban-flow", created: "x", contexts: ["cli"], worktree: { enabled: false } }));
  write("README.md", "# repo\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

async function addWorkItem(): Promise<void> {
  const dir = join(repo, ".works", "brainstorm", "wip_20260101_0000");
  mkdirSync(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "wip", context: "cli", created: "20260101_0000" });
}

/** The `(project)` entry of a JSON run, plus the whole array. */
async function runJson(options: Record<string, unknown>): Promise<{ code: number; entries: Entry[]; project: Entry | undefined }> {
  const res = await cmdValidate(args({ all: true, json: true, ...options }), repo);
  const entries = JSON.parse(res.stdout) as Entry[];
  return { code: res.code, entries, project: entries.find((e) => e.feature === "(project)") };
}

describe("kf validate --all on the living-doc tree", () => {
  it("fails naming the missing heading, then passes once it is added", async () => {
    write("docs/specs/cli/README.md", "# cli\n\n- [x](x.md)\n");
    write("docs/specs/cli/x.md", withoutHistory);
    commit("docs");

    const failing = await cmdValidate(args({ all: true, base: "main" }), repo);
    expect(failing.code).toBe(1);
    expect(failing.stdout).toContain("## History");
    expect(failing.stdout).toContain("docs_heading_missing");

    write("docs/specs/cli/x.md", FULL_DOC);
    commit("fix");
    expect((await cmdValidate(args({ all: true, base: "main" }), repo)).code).toBe(0);
  });

  it("fails naming an index link to a file that is gone", async () => {
    write("docs/specs/cli/README.md", "# cli\n\n- [gone](gone.md)\n");
    commit("docs");

    const res = await cmdValidate(args({ all: true, base: "main" }), repo);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("gone.md");
    expect(res.stdout).toContain("docs_index_dangling");
  });

  it("does not report legacy features that were left untouched, even with --strict", async () => {
    write("docs/requirement/cli/old.md", "# old\n");
    write("docs/testplan/cli/old.md", "# old\n");
    commit("legacy");

    const { code, project } = await runJson({ strict: true, base: "main" });
    expect(code).toBe(0);
    expect(project?.valid).toBe(true);
    expect(project?.issues.filter((i) => i.code.startsWith("docs_"))).toEqual([]);
  });
});

describe("kf validate --all against a base", () => {
  function legacyFoo(): void {
    write("docs/requirement/cli/foo.md", "# foo\n");
    write("docs/testplan/cli/foo.md", "# foo\n");
    write("docs/specs/cli/README.md", "# cli\n\n## Retired\n\n");
    commit("base with legacy foo");
    sh("checkout", "-q", "-b", "feature");
  }

  it("fails a branch that deletes some files of a legacy feature and keeps others", async () => {
    legacyFoo();
    rmSync(join(repo, "docs/requirement/cli/foo.md"));
    commit("half removal");

    const { code, project } = await runJson({ base: "main" });
    expect(code).toBe(1);
    const half = project?.issues.find((i) => i.code === "docs_legacy_half_removed");
    expect(half?.message).toContain("cli/foo");
  });

  it("counts a requirement-only feature whose one file is deleted as fully removed", async () => {
    write("docs/requirement/cli/solo.md", "# solo\n");
    write("docs/specs/cli/README.md", "# cli\n\n## Retired\n\n- cli/solo\n");
    commit("base");
    sh("checkout", "-q", "-b", "feature");
    rmSync(join(repo, "docs/requirement/cli/solo.md"));
    commit("remove solo");

    const { code, project } = await runJson({ base: "main" });
    expect(project?.issues.map((i) => i.code)).not.toContain("docs_legacy_half_removed");
    expect(code).toBe(0);
  });

  it("requires a fully removed legacy feature to be named in the living docs", async () => {
    legacyFoo();
    rmSync(join(repo, "docs/requirement/cli/foo.md"));
    rmSync(join(repo, "docs/testplan/cli/foo.md"));
    commit("remove foo");

    const unnamed = await runJson({ base: "main" });
    expect(unnamed.code).toBe(1);
    expect(unnamed.project?.issues.map((i) => i.code)).toContain("docs_legacy_unnamed");

    write("docs/specs/cli/x.md", FULL_DOC.replace("- Created (#1)", "- Replaces cli/foo (#2)"));
    write("docs/specs/cli/README.md", "# cli\n\n- [x](x.md)\n\n## Retired\n\n");
    commit("name in history");
    expect((await runJson({ base: "main" })).code).toBe(0);
  });

  it("accepts the removed feature named in the index Retired list", async () => {
    legacyFoo();
    rmSync(join(repo, "docs/requirement/cli/foo.md"));
    rmSync(join(repo, "docs/testplan/cli/foo.md"));
    write("docs/specs/cli/README.md", "# cli\n\n## Retired\n\n- cli/foo\n");
    commit("remove foo, retire it");

    expect((await runJson({ base: "main" })).code).toBe(0);
  });
});

describe("kf validate --all when the base cannot be used", () => {
  beforeEach(() => {
    write("docs/specs/cli/README.md", "# cli\n");
    commit("docs");
  });

  it("degrades a repo without origin to a WARNING and still runs the structure rules", async () => {
    const { code, project } = await runJson({});
    expect(code).toBe(0);
    expect(project?.issues.map((i) => [i.severity, i.code])).toContainEqual(["WARNING", "docs_base_unresolved"]);

    const text = await cmdValidate(args({ all: true }), repo);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("docs_base_unresolved");

    write("docs/specs/cli/README.md", "# cli\n\n- [gone](gone.md)\n");
    commit("break index");
    expect((await runJson({})).code, "structure rules still run").toBe(1);
  });

  it("fails on that WARNING under --strict", async () => {
    expect((await runJson({ strict: true })).code).toBe(1);
  });

  it("fails a --base that does not exist and shows the git error", async () => {
    const { code, project } = await runJson({ base: "does-not-exist" });
    expect(code).toBe(1);
    const failure = project?.issues.find((i) => i.code === "docs_git_failed");
    expect(failure?.severity).toBe("ERROR");
    expect(failure?.message).toContain("does-not-exist");

    const text = await cmdValidate(args({ all: true, base: "does-not-exist" }), repo);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain("does-not-exist");
  });
});

describe("kf validate --all without .works/", () => {
  beforeEach(() => {
    write("docs/specs/cli/README.md", "# cli\n");
    commit("docs");
  });

  it("runs the docs check from the git top-level, from a subdirectory too, and prints only the (project) entry", async () => {
    write("docs/specs/cli/README.md", "# cli\n\n- [gone](gone.md)\n");
    commit("break index");
    mkdirSync(join(repo, "src", "deep"), { recursive: true });

    for (const cwd of [repo, join(repo, "src", "deep")]) {
      const res = await cmdValidate(args({ all: true, json: true, base: "main" }), cwd);
      const entries = JSON.parse(res.stdout) as Entry[];
      expect(entries.map((e) => e.feature)).toEqual(["(project)"]);
      expect(entries[0].stage).toBe("-");
      expect(entries[0].valid).toBe(false);
      expect(res.code).toBe(1);
    }
  });

  it("exits 0 with a valid (project) entry when the docs are clean", async () => {
    const { code, entries, project } = await runJson({ base: "main" });
    expect(code).toBe(0);
    expect(entries).toHaveLength(1);
    expect(project?.valid).toBe(true);
  });
});

describe("kf validate --all --json with work items", () => {
  it("returns every item entry plus one (project) entry carrying the docs finding", async () => {
    await addWorkItem();
    write("docs/specs/cli/README.md", "# cli\n\n- [gone](gone.md)\n");
    commit("docs");

    const { code, entries, project } = await runJson({ base: "main" });
    expect(code).toBe(1);
    expect(entries.filter((e) => e.feature === "(project)")).toHaveLength(1);
    expect(entries.some((e) => e.feature === "wip")).toBe(true);
    expect(project?.issues.map((i) => i.code)).toContain("docs_index_dangling");
  });
});

describe("kf validate --all when .works/ is below the git top-level", () => {
  it("runs the legacy-removal check at the git top-level from the project subdirectory", async () => {
    rmSync(join(repo, ".kf"), { recursive: true, force: true });
    write("pkg/.kf/config.json", JSON.stringify({ schema: "kanban-flow", created: "x", contexts: ["cli"], worktree: { enabled: false } }));
    mkdirSync(join(repo, "pkg", ".works", "brainstorm"), { recursive: true });
    write("docs/requirement/cli/foo.md", "# foo\n");
    write("docs/specs/cli/README.md", "# cli\n");
    commit("base with legacy foo");
    sh("checkout", "-q", "-b", "feature");
    rmSync(join(repo, "docs/requirement/cli/foo.md"));
    commit("remove foo");

    const res = await cmdValidate(args({ all: true, json: true, base: "main" }), join(repo, "pkg"));
    const entries = JSON.parse(res.stdout) as Entry[];
    const project = entries.find((e) => e.feature === "(project)");
    expect(res.code).toBe(1);
    expect(project?.issues.map((i) => i.code)).toContain("docs_legacy_unnamed");
  });
});

describe("kf validate --all in a project that is not a git repository", () => {
  let plain: string;

  beforeEach(async () => {
    plain = await realpath(await mkdtemp(join(tmpdir(), "kf-validate-nogit-")));
    mkdirSync(join(plain, ".kf"), { recursive: true });
    writeFileSync(join(plain, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", contexts: ["cli"], worktree: { enabled: false } }));
    mkdirSync(join(plain, ".works", "brainstorm"), { recursive: true });
  });

  afterEach(() => {
    rmSync(plain, { recursive: true, force: true });
  });

  it("warns that the base is unresolved instead of failing on a git error, and exits 0", async () => {
    const res = await cmdValidate(args({ all: true, json: true }), plain);
    const entries = JSON.parse(res.stdout) as Entry[];
    const codes = entries.flatMap((e) => e.issues.map((i) => i.code));
    expect(codes).not.toContain("docs_git_failed");
    expect(codes.filter((c) => c === "docs_base_unresolved")).toHaveLength(1);
    expect(res.code).toBe(0);
  });
});

describe("kf validate --change", () => {
  it("adds no project entry and no docs finding even when docs/specs has a broken index", async () => {
    await addWorkItem();
    write("docs/specs/cli/README.md", "# cli\n\n- [gone](gone.md)\n");
    commit("docs");

    const res = await cmdValidate(args({ change: "wip", json: true, base: "main" }), repo);
    const entries = JSON.parse(res.stdout) as Entry[];
    expect(entries.map((e) => e.feature)).toEqual(["wip"]);
    expect(entries.flatMap((e) => e.issues.map((i) => i.code)).filter((c) => c.startsWith("docs_"))).toEqual([]);
  });
});
