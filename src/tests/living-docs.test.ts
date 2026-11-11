import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  LIVING_DOC_HEADINGS, addedSpecsFiles, checkLivingDocTree, docsSpecsChanged, removedLegacyFindings, resolveDocsBase,
  scanLegacyFeatures,
} from "../workflow/living-docs.js";

interface DocsFinding {
  severity: string;
  code: string;
  file: string;
  message: string;
}

let scratch: string;
let repo: string;

const sh = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "pipe" });
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
}

function write(rel: string, body: string): void {
  const path = join(repo, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function commit(message: string): string {
  sh(repo, "add", "-A");
  sh(repo, "commit", "-qm", message);
  return sh(repo, "rev-parse", "HEAD");
}

// Spelled out here rather than read from the module, so a wrong constant cannot make a fixture agree with it.
const FIVE_HEADINGS = ["## Purpose", "## Current behaviour", "## Use cases", "## Surfaces", "## History"];

function livingDoc(headings: string[], history = "- Created the capability (#1)"): string {
  const sections = headings.map((h) => (h === "## History" ? `${h}\n\n${history}\n` : `${h}\n\nSome text.\n`));
  return ["# Capability", "", ...sections].join("\n");
}

function index(links: string[], retired?: string): string {
  const lines = ["# cli", "", "## Capabilities", "", ...links.map((l) => `- [${l}](${l}) — one line`), ""];
  if (retired !== undefined) lines.push("## Retired", "", retired, "");
  return lines.join("\n");
}

function legacyFeature(ctx: string, feature: string): void {
  write(`docs/requirement/${ctx}/${feature}.md`, `# ${feature} requirement\n`);
  write(`docs/use-cases/${ctx}/${feature}/README.md`, `# ${feature} use cases\n`);
  write(`docs/testplan/${ctx}/${feature}.md`, `# ${feature} test plan\n`);
  write(`docs/testplan/${ctx}/${feature}-result.md`, `# ${feature} result\n`);
}

function removeLegacyFeature(ctx: string, feature: string): void {
  rmSync(join(repo, `docs/requirement/${ctx}/${feature}.md`));
  rmSync(join(repo, `docs/use-cases/${ctx}/${feature}`), { recursive: true });
  rmSync(join(repo, `docs/testplan/${ctx}/${feature}.md`));
  rmSync(join(repo, `docs/testplan/${ctx}/${feature}-result.md`));
}

/** A committed base on main and a `work` branch checked out on top of it; returns the merge-base sha. */
function baseThenBranch(setup: () => void): string {
  write("README.md", "# project\n");
  setup();
  const base = commit("base");
  sh(repo, "checkout", "-q", "-b", "work");
  return base;
}

const errors = (findings: DocsFinding[]) => findings.filter((f) => f.severity === "ERROR");
const withCode = (findings: DocsFinding[], code: string) => findings.filter((f) => f.code === code);

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-living-docs-"));
  repo = join(scratch, "repo");
  initRepo(repo);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("living-doc template headings", () => {
  it("are exactly the five level-2 sections, in template order", () => {
    expect([...LIVING_DOC_HEADINGS]).toEqual(FIVE_HEADINGS);
  });
});

describe("scanLegacyFeatures", () => {
  it("reports no legacy feature in a project without legacy docs", async () => {
    write("README.md", "# project\n");
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS));

    const found = await scanLegacyFeatures(repo, ["cli"]);

    expect(Object.values(found).flat()).toEqual([]);
  });

  it("does not count files under a folder that is not a declared context", async () => {
    legacyFeature("cli", "foo");
    write("docs/requirement/notes/meeting.md", "# notes\n");
    write("docs/testplan/notes/meeting.md", "# notes\n");

    const found = await scanLegacyFeatures(repo, ["cli"]);

    expect(found.notes ?? []).toEqual([]);
    expect(found.cli).toEqual(["foo"]);
  });

  it("does not count requirement content in another shape than the legacy layout", async () => {
    write("docs/requirement/cli/deeper/nested.md", "# nested\n");
    write("docs/requirement/overview.md", "# overview\n");

    const found = await scanLegacyFeatures(repo, ["cli"]);

    expect(Object.values(found).flat()).toEqual([]);
  });
});

describe("checkLivingDocTree", () => {
  it("reports a living doc missing a template heading, naming the heading", async () => {
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS.filter((h) => h !== "## History")));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    const missing = withCode(findings, "docs_heading_missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].severity).toBe("ERROR");
    expect(missing[0].file).toMatch(/docs\/specs\/cli\/x\.md$/);
    expect(missing[0].message).toContain("History");
  });

  it("passes the same tree once the missing heading is added", async () => {
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    expect(errors(findings)).toEqual([]);
  });

  it("reports an index link to a file that does not exist, naming the link", async () => {
    write("docs/specs/cli/README.md", index(["x.md", "gone.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    const dangling = withCode(findings, "docs_index_dangling");
    expect(dangling).toHaveLength(1);
    expect(dangling[0].severity).toBe("ERROR");
    expect(dangling[0].message).toContain("gone.md");
  });

  it("reports a living doc that its folder index does not link", async () => {
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS));
    write("docs/specs/cli/y.md", livingDoc(FIVE_HEADINGS));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    const unlisted = withCode(findings, "docs_index_missing_entry");
    expect(unlisted).toHaveLength(1);
    expect(unlisted[0].severity).toBe("ERROR");
    expect(`${unlisted[0].file} ${unlisted[0].message}`).toContain("y.md");
  });

  it("finds every template heading in a living doc saved with CRLF line endings", async () => {
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS).replace(/\n/g, "\r\n"));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    expect(withCode(findings, "docs_heading_missing")).toEqual([]);
  });

  it("refuses a capability named README in another letter case", async () => {
    // The index name is reserved; on a case-insensitive filesystem a Readme.md capability is the index.
    write("docs/specs/cli/Readme.md", livingDoc(FIVE_HEADINGS));

    const findings: DocsFinding[] = await checkLivingDocTree(repo);

    const reserved = withCode(findings, "docs_capability_reserved");
    expect(reserved).toHaveLength(1);
    expect(reserved[0].severity).toBe("ERROR");
    expect(reserved[0].file).toMatch(/Readme\.md$/);
    const otherForFile = findings.filter((f) => f.code !== "docs_capability_reserved" && f.file.endsWith("Readme.md"));
    expect(otherForFile).toEqual([]);
  });
});

describe("removedLegacyFindings", () => {
  it("reports a legacy feature whose files were only partly removed", async () => {
    const mergeBase = baseThenBranch(() => {
      write("docs/requirement/cli/foo.md", "# foo requirement\n");
      write("docs/testplan/cli/foo.md", "# foo test plan\n");
    });
    rmSync(join(repo, "docs/requirement/cli/foo.md"));
    commit("remove foo requirement only");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    const half = withCode(findings, "docs_legacy_half_removed");
    expect(half).toHaveLength(1);
    expect(half[0].severity).toBe("ERROR");
    expect(half[0].message).toContain("cli/foo");
  });

  it("treats a feature that only had a requirement file as fully removed once that file is deleted", async () => {
    const mergeBase = baseThenBranch(() => {
      write("docs/requirement/cli/bar.md", "# bar requirement\n");
    });
    rmSync(join(repo, "docs/requirement/cli/bar.md"));
    commit("remove bar");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(withCode(findings, "docs_legacy_half_removed")).toEqual([]);
    const unnamed = withCode(findings, "docs_legacy_unnamed");
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0].message).toContain("cli/bar");
  });

  it("reports a fully removed legacy feature that no living doc names", async () => {
    const mergeBase = baseThenBranch(() => legacyFeature("cli", "foo"));
    removeLegacyFeature("cli", "foo");
    commit("remove foo");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    const unnamed = withCode(findings, "docs_legacy_unnamed");
    expect(unnamed).toHaveLength(1);
    expect(unnamed[0].severity).toBe("ERROR");
    expect(unnamed[0].message).toContain("cli/foo");
  });

  it("accepts a fully removed legacy feature named in a living doc's History", async () => {
    const mergeBase = baseThenBranch(() => legacyFeature("cli", "foo"));
    removeLegacyFeature("cli", "foo");
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS, "- Consolidated cli/foo (#12)"));
    commit("consolidate foo");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(errors(findings)).toEqual([]);
  });

  it("accepts a removed legacy feature named in the History of a living doc saved with CRLF line endings", async () => {
    // Keep the CRLF bytes in the commit whatever the machine's global autocrlf says.
    sh(repo, "config", "core.autocrlf", "false");
    const mergeBase = baseThenBranch(() => legacyFeature("cli", "foo"));
    removeLegacyFeature("cli", "foo");
    write("docs/specs/cli/README.md", index(["x.md"]));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS, "- Consolidated cli/foo (#12)").replace(/\n/g, "\r\n"));
    commit("consolidate foo in a CRLF doc");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(withCode(findings, "docs_legacy_unnamed")).toEqual([]);
  });

  it("accepts a fully removed legacy feature listed under an index's Retired section", async () => {
    const mergeBase = baseThenBranch(() => legacyFeature("cli", "foo"));
    removeLegacyFeature("cli", "foo");
    write("docs/specs/cli/README.md", index(["x.md"], "- cli/foo — the command no longer exists"));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS));
    commit("retire foo");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(errors(findings)).toEqual([]);
  });

  it("does not accept the token outside a History or Retired section", async () => {
    const mergeBase = baseThenBranch(() => legacyFeature("cli", "foo"));
    removeLegacyFeature("cli", "foo");
    write("docs/specs/cli/README.md", index(["x.md"]));
    write(
      "docs/specs/cli/x.md",
      livingDoc(FIVE_HEADINGS).replace("## Purpose\n\nSome text.", "## Purpose\n\nReplaces cli/foo."),
    );
    commit("mention foo outside history");

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(withCode(findings, "docs_legacy_unnamed")).toHaveLength(1);
  });

  it("ignores a removal that is not committed", async () => {
    const mergeBase = baseThenBranch(() => {
      write("docs/requirement/cli/foo.md", "# foo requirement\n");
      write("docs/testplan/cli/foo.md", "# foo test plan\n");
    });
    rmSync(join(repo, "docs/requirement/cli/foo.md"));

    const findings: DocsFinding[] = await removedLegacyFindings(repo, mergeBase);

    expect(findings).toEqual([]);
  });

  it("throws with git's error when the merge-base is not a commit", async () => {
    baseThenBranch(() => legacyFeature("cli", "foo"));

    await expect((async () => removedLegacyFindings(repo, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))())
      .rejects.toThrow(/fatal/);
  });
});

describe("resolveDocsBase", () => {
  it("skips with a reason when there is no --base and no origin/HEAD", async () => {
    baseThenBranch(() => write("a.txt", "a\n"));

    const resolved = await resolveDocsBase(repo, undefined);

    expect(resolved).toHaveProperty("skipped");
    expect((resolved as { skipped: string }).skipped.trim()).not.toBe("");
    expect(resolved).not.toHaveProperty("mergeBase");
  });

  it("skips with a reason when the base shares no history with HEAD", async () => {
    baseThenBranch(() => write("a.txt", "a\n"));
    sh(repo, "checkout", "-q", "--orphan", "lonely");
    write("b.txt", "b\n");
    commit("unrelated root");

    const resolved = await resolveDocsBase(repo, "main");

    expect(resolved).toHaveProperty("skipped");
    expect((resolved as { skipped: string }).skipped.trim()).not.toBe("");
  });

  it("uses origin/HEAD when no --base is given", async () => {
    const base = baseThenBranch(() => write("a.txt", "a\n"));
    sh(repo, "update-ref", "refs/remotes/origin/main", base);
    sh(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    write("a.txt", "changed\n");
    commit("on work");

    const resolved = await resolveDocsBase(repo, undefined);

    expect(resolved).toEqual({ ref: "origin/main", mergeBase: base });
  });

  it("uses the --base ref and its merge-base with HEAD", async () => {
    const base = baseThenBranch(() => write("a.txt", "a\n"));
    write("a.txt", "changed\n");
    commit("on work");

    const resolved = await resolveDocsBase(repo, "main");

    expect(resolved).toEqual({ ref: "main", mergeBase: base });
  });

  it("throws with git's error text when --base does not resolve", async () => {
    baseThenBranch(() => write("a.txt", "a\n"));

    await expect((async () => resolveDocsBase(repo, "does-not-exist"))()).rejects.toThrow(/fatal/);
  });
});

describe("docsSpecsChanged", () => {
  it("is true when a commit since the merge-base changes a file under docs/specs", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS, "- Changed the capability (#2)"));
    commit("update living doc");

    expect(await docsSpecsChanged(repo, mergeBase)).toBe(true);
  });

  it("is false when the commits since the merge-base touch nothing under docs/specs", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));
    write("src.txt", "code\n");
    commit("code only");

    expect(await docsSpecsChanged(repo, mergeBase)).toBe(false);
  });

  it("ignores an uncommitted change under docs/specs", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS, "- Not committed (#3)"));

    expect(await docsSpecsChanged(repo, mergeBase)).toBe(false);
  });

  it("throws with git's error when the merge-base is not a commit", async () => {
    baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));

    await expect((async () => docsSpecsChanged(repo, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))())
      .rejects.toThrow(/fatal/);
  });
});

describe("addedSpecsFiles", () => {
  it("lists a file added under docs/specs since the merge-base", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));
    write("docs/specs/cli/new.md", livingDoc(FIVE_HEADINGS));
    write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS, "- Changed (#2)"));
    write("notes/outside.md", "# not a spec\n");
    commit("add a capability");

    const added = await addedSpecsFiles(repo, mergeBase);

    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/docs\/specs\/cli\/new\.md$/);
  });

  it("does not list a renamed file", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/old.md", livingDoc(FIVE_HEADINGS)));
    sh(repo, "mv", "docs/specs/cli/old.md", "docs/specs/cli/renamed.md");
    commit("rename a capability");

    expect(await addedSpecsFiles(repo, mergeBase)).toEqual([]);
  });

  it("ignores a file that is not committed", async () => {
    const mergeBase = baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));
    write("docs/specs/cli/new.md", livingDoc(FIVE_HEADINGS));
    sh(repo, "add", "-A");

    expect(await addedSpecsFiles(repo, mergeBase)).toEqual([]);
  });

  it("throws with git's error when the merge-base is not a commit", async () => {
    baseThenBranch(() => write("docs/specs/cli/x.md", livingDoc(FIVE_HEADINGS)));

    await expect((async () => addedSpecsFiles(repo, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))())
      .rejects.toThrow(/fatal/);
  });
});
