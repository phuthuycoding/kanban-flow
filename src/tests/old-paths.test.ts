import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const OLD_PATH_PATTERN =
  "(^|[^a-z/])(skills|agents)/[a-z-]+(/|\\.md)|kanban-flow/(templates|review|github-hooks|hooks|README)";

// History and recorded snapshots are not live documentation; they keep the layout they described.
const PATHSPEC = [
  ".",
  ":!CHANGELOG.md",
  ":!BACKLOG.md",
  ":!docs/requirement",
  ":!docs/use-cases",
  ":!docs/testplan",
  ":!.works",
  ":!src/tests/fixtures/kf-next",
];

interface Allowed {
  file: string;
  /** Matches the hit text when only some lines of the file are allowed. */
  line?: RegExp;
  reason: string;
}

// Keep this list narrow: every entry names a file and why the old path is legitimate there.
const ALLOWED: Allowed[] = [
  {
    file: "src/tests/install-ownership.test.ts",
    line: /git show v0\.13\.0:skills\/kanban-ship\/SKILL\.md/,
    reason: "historical git tag reference used to model a pre-0.14 install (upgrade-recognition context)",
  },
  {
    file: "src/tests/next-schedule.test.ts",
    line: /TASK-005 overlaps TASK-002/,
    reason:
      "the why string annotates the recorded replay-adaptive-cap ledger under src/tests/fixtures/kf-next; that ledger is history the FR-008 pathspec excludes, and the string names the path that historical plan used",
  },
];

// Runtime install destinations are where kf writes copies; they are not package paths.
const RUNTIME_DESTINATION = /(\.agents\/skills\/|\.claude\/skills\/|~\/\.claude\/agents\/|\.<agent>\/skills)/;

function grepOldPaths(): string[] {
  try {
    const out = execFileSync("git", ["grep", "-nE", OLD_PATH_PATTERN, "--", ...PATHSPEC], { cwd: repo, encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch (e) {
    // git grep exits 1 when nothing matches; any other failure is a real error.
    if ((e as { status?: number }).status === 1) return [];
    throw e;
  }
}

function isAllowed(hit: string): boolean {
  const [file] = hit.split(":");
  const entry = ALLOWED.find((a) => a.file === file && (!a.line || a.line.test(hit)));
  if (entry) return true;
  const text = hit.slice(hit.indexOf(":", file.length + 1) + 1);
  const stripped = text.replace(RUNTIME_DESTINATION, "");
  return !new RegExp(OLD_PATH_PATTERN).test(stripped);
}

describe("old asset-layout paths", () => {
  it("appear in tracked files only as upgrade recognition, its fixtures or runtime install destinations", () => {
    const stale = grepOldPaths().filter((h) => !isAllowed(h));
    expect(stale, `stale old-layout paths:\n${stale.join("\n")}`).toEqual([]);
  });

  it("keeps every allowlist entry in use so the list cannot grow stale", () => {
    const hits = grepOldPaths();
    const unused = ALLOWED.filter((a) => !hits.some((h) => h.split(":")[0] === a.file && (!a.line || a.line.test(h))));
    expect(unused.map((a) => a.file)).toEqual([]);
  });
});

describe("workflow docs", () => {
  it.each(["harness.md"])("%s names the packaged agents under assets/", (name) => {
    const text = readFileSync(join(repo, "docs", "workflow", name), "utf8");
    expect(text).toContain("assets/agents");
  });

  it("the changelog records the layout move under Unreleased", () => {
    const text = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
    const unreleased = text.split(/^## \[/m).find((s) => s.startsWith("Unreleased")) ?? "";
    expect(unreleased).toMatch(/### Changed[\s\S]*assets\//);
  });
});
