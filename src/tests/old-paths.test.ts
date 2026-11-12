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
  { file: "src/integrations/install.ts", reason: "upgrade recognition of installs made by older kf versions" },
  { file: "src/tests/migration.test.ts", reason: "legacy install fixtures that model kf 0.14 and older" },
  { file: "src/tests/doctor-plugin.test.ts", reason: "legacy install fixtures that model kf 0.14 and older" },
  { file: "src/tests/install-checkout-root.test.ts", reason: "fixtures that model older installs" },
  {
    file: "src/tests/install-ownership.test.ts",
    line: /git show v0\.13\.0:skills\/kanban-ship\/SKILL\.md/,
    reason: "points at the released skill body that older installs shipped",
  },
  {
    file: "src/tests/next-schedule.test.ts",
    line: /TASK-005 overlaps TASK-002/,
    reason: "recorded scheduler wording quoting a past plan, not a live path",
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
    const unused = ALLOWED.filter((a) => a.line && !hits.some((h) => h.split(":")[0] === a.file && a.line!.test(h)));
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
