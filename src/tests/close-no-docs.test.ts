import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdCancel } from "../cli/commands/cancel.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { cmdSync } from "../cli/commands/sync.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { runDoctor } from "../project/doctor.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import type { ParsedArgs } from "../cli/args.js";
import type { CmdResult } from "../cli/result.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr)
    [ "$2" = view ] && printf '{"state":"MERGED","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n'
    [ "$2" = list ] && echo '[]'
    exit 0 ;;
esac
exit 0
`;

const PR = "https://github.com/o/r/pull/9";
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n## Affected surfaces\nN/A\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
const LEGACY_WARNING = "⚠ demo: no living doc recorded (approved before living docs)";
const removedFlag = (flag: string) => `--${flag} was removed: living docs are edited at review (docs/specs/); see kf instruct living-doc`;

/** Docs an earlier release wrote at close, plus a living doc: a close must leave every byte of them alone. */
const LEGACY_DOCS: Record<string, string> = {
  "docs/requirement/app/demo.md": "# Requirement snapshot\nWritten by an earlier close.\n",
  "docs/use-cases/app/demo/README.md": "# Use cases\n[UC-001](UC-001.md)\n",
  "docs/use-cases/app/demo/UC-001.md": "# UC-001 Ship it\nHand-edited after the snapshot.\n",
  "docs/testplan/app/demo.md": "# Test plan snapshot\n",
  "docs/testplan/app/demo-result.md": "---\nstatus: PASS\n---\n# Result snapshot\n",
  "docs/specs/app/shipping.md": "# Shipping\nThe living doc for this capability.\n",
};

let scratch: string;
let root: string;
let origin: string;
let prevPath: string | undefined;

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = () => findFeature(root, "demo")!;
const meta = () => readFeatureMeta(feature().dir)!;
const base = () => git(root, "symbolic-ref", "--short", "HEAD");
const output = (res: CmdResult) => `${res.stdout}\n${res.stderr ?? ""}`;

/** Every file under docs/, by repository-relative path, with its exact content. */
function docsTree(): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else tree[relative(root, p)] = readFileSync(p, "utf8");
    }
  };
  walk(join(root, "docs"));
  return tree;
}

const docsBranches = () => git(root, "branch", "--list", "docs/*");

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-close-no-docs-")));
  root = join(scratch, "repo");
  origin = join(scratch, "origin.git");
  await mkdir(root, { recursive: true });
  git(scratch, "init", "-q", root);
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), ".works/\n.kf/\n");
  for (const [path, content] of Object.entries(LEGACY_DOCS)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  execFileSync("git", ["init", "-q", "--bare", origin]);
  const branch = base();
  git(root, "remote", "add", "origin", origin);
  git(root, "push", "-q", "-u", "origin", branch);
  git(origin, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "remote", "set-head", "origin", branch);
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
  const stubBin = join(scratch, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(scratch, { recursive: true, force: true });
});

async function writeReport(id: "testing-result" | "review-report", docs: string): Promise<void> {
  await writeFile(join(feature().dir, ARTIFACTS[id].file),
    `---\nstatus: PASS\nexecution: ${meta().executionId}\n${id === "review-report" ? `ci: none\nlanding: pr\n${docs}` : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/** An item in review with a PASS pair and a merged PR, approved by `kf approve` (so it carries the living-docs marker). */
async function reviewItem(): Promise<void> {
  expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature().dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Ship it") : "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Ship it\nUser ships.");
  await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", ["demo", "testing"]), root)).code).toBe(0);
  await writeReport("testing-result", "");
  await grantStageWaiver(root, "demo");
  expect((await cmdStage(args("stage", ["demo", "review"]), root)).code).toBe(0);
  await writeReport("review-report", REVIEW_DOCS_NONE);
  await writeFile(join(feature().dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
  await writeFeatureMeta(feature().dir, { ...meta(), pr: PR });
}

/** The same item as an earlier release approved it: no living-docs marker, and a PASS report without `docs:`. */
async function legacyReviewItem(): Promise<void> {
  await reviewItem();
  const { livingDocs: _marker, ...approval } = meta().approval!;
  await writeFeatureMeta(feature().dir, { ...meta(), approval });
  expect(meta().approval?.livingDocs).toBeUndefined();
  await writeReport("review-report", "");
}

/** Leave the primary checkout behind origin: the case where an earlier release committed the docs to docs/<context>-<feature>. */
function putPrimaryBehind(): void {
  writeFileSync(join(root, "upstream.txt"), "x");
  git(root, "add", "upstream.txt");
  git(root, "commit", "-qm", "upstream");
  git(root, "push", "-q", "origin", base());
  git(root, "reset", "-q", "--hard", "HEAD~1");
}

describe("closing an item writes nothing under docs/", () => {
  const closes: Array<[string, () => Promise<CmdResult>]> = [
    ["kf archive", () => cmdArchive(args("archive", ["demo"]), root)],
    ["kf status auto-close", () => cmdStatus(args("status", [], { change: "demo" }), root)],
    ["kf sync", () => cmdSync(args("sync"), root)],
  ];

  it.each(closes)("%s leaves docs/ byte-identical and records no docs branch", async (_how, close) => {
    await reviewItem();
    const before = docsTree();

    const res = await close();
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(docsTree()).toEqual(before);
    expect(docsBranches()).toBe("");
    expect(meta().docsBranch).toBeUndefined();
    expect(meta().docsCommit).toBeUndefined();
  }, 15_000);

  it.each(closes)("%s with the primary behind origin cuts no docs/<context>-<feature> branch", async (_how, close) => {
    await reviewItem();
    putPrimaryBehind();
    const before = docsTree();

    const res = await close();
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(docsTree()).toEqual(before);
    expect(docsBranches()).toBe("");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(meta().docsBranch).toBeUndefined();
  }, 15_000);

  it("a second kf archive on the done item leaves a doc edited after the close as it is", async () => {
    await reviewItem();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    writeFileSync(join(root, "docs", "requirement", "app", "demo.md"), "# Requirement\nEdited after the close.\n");
    const before = docsTree();

    const again = await cmdArchive(args("archive", ["demo"]), root);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).toContain("already in done");
    expect(docsTree()).toEqual(before);
    expect(docsBranches()).toBe("");
  }, 15_000);
});

describe("closing an item approved before living docs", () => {
  it("closes with one legacy warning line and leaves docs/ as it was", async () => {
    await legacyReviewItem();
    const before = docsTree();

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(res.stdout.split("\n").filter((line) => line.trim() === LEGACY_WARNING)).toHaveLength(1);
    expect(docsTree()).toEqual(before);
  }, 15_000);

  it("prints no legacy warning for an item that carries the living-docs marker", async () => {
    await reviewItem();
    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).not.toContain("no living doc recorded");
  }, 15_000);
});

describe("kf stage hand-off into done copies nothing", () => {
  it("kf stage review → done leaves docs/ byte-identical and prints no re-sync", async () => {
    await reviewItem();
    const before = docsTree();

    const res = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(docsTree()).toEqual(before);
    expect(docsBranches()).toBe("");
    expect(res.stdout).not.toContain("Canonical docs");
    expect(res.stdout).not.toMatch(/re-sync/i);
  }, 15_000);

  it("reopening a cancelled done item into done leaves docs/ byte-identical and prints no re-sync", async () => {
    await reviewItem();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    expect((await cmdCancel(args("cancel", ["demo"], { reason: "superseded" }), root)).code).toBe(0);
    const before = docsTree();

    const res = await cmdStage(args("stage", ["demo", "done"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(docsTree()).toEqual(before);
    expect(docsBranches()).toBe("");
    expect(res.stdout).not.toContain("Canonical docs");
    expect(res.stdout).not.toMatch(/re-sync/i);
    expect(res.stdout).not.toContain("kf archive demo");
  }, 15_000);
});

describe("the removed docs flags are refused", () => {
  it("kf archive --skip-specs exits non-zero, names the flag as removed and leaves the item in review", async () => {
    await reviewItem();
    const before = docsTree();

    const res = await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root);
    expect(res.code).not.toBe(0);
    expect(output(res)).toContain(removedFlag("skip-specs"));
    expect(feature().stage).toBe("review");
    expect(meta().delivered).toBeUndefined();
    expect(docsTree()).toEqual(before);
  }, 15_000);

  it("kf archive --skip-specs is refused on a done item too", async () => {
    await reviewItem();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);

    const res = await cmdArchive(args("archive", ["demo"], { "skip-specs": true }), root);
    expect(res.code).not.toBe(0);
    expect(output(res)).toContain(removedFlag("skip-specs"));
  }, 15_000);

  it("kf cancel --purge-docs exits non-zero, names the flag as removed and cancels nothing", async () => {
    await reviewItem();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    const before = docsTree();

    const res = await cmdCancel(args("cancel", ["demo"], { reason: "r", "purge-docs": true }), root);
    expect(res.code).not.toBe(0);
    expect(output(res)).toContain(removedFlag("purge-docs"));
    expect(feature().stage).toBe("done");
    expect(meta().cancellation).toBeUndefined();
    expect(docsTree()).toEqual(before);
  }, 15_000);
});

describe("a done item with an unlanded docs branch from an earlier release", () => {
  /** A done item whose metadata records a docs branch that exists only locally, as an earlier close left it. */
  async function doneWithUnpushedDocsBranch(): Promise<void> {
    await reviewItem();
    expect((await cmdArchive(args("archive", ["demo"]), root)).code).toBe(0);
    git(root, "branch", "docs/app-demo", git(root, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-m", "docs(app): sync canonical docs for demo"));
    await writeFeatureMeta(feature().dir, { ...meta(), docsBranch: "docs/app-demo" });
  }

  it("kf doctor lists docs_branch_unpushed for it", async () => {
    await doneWithUnpushedDocsBranch();
    const unpushed = runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));
    expect(unpushed).toHaveLength(1);
    expect(unpushed[0].message).toContain("docs/app-demo");
    expect(unpushed[0].action).toContain("git push -u origin docs/app-demo");
  }, 15_000);

  it("kf status --all lists it under Waiting to merge", async () => {
    await doneWithUnpushedDocsBranch();
    const res = await cmdStatus(args("status", [], { all: true }), root);
    const waiting = res.stdout.slice(res.stdout.lastIndexOf("Waiting to merge"));
    expect(waiting).toContain("demo — docs/app-demo awaiting push: git push -u origin docs/app-demo");
  }, 15_000);

  it("kf archive re-lands a deleted docs branch on a fresh docs branch and records it", async () => {
    await doneWithUnpushedDocsBranch();
    git(root, "branch", "-D", "docs/app-demo");
    const before = docsTree();

    const res = await cmdArchive(args("archive", ["demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("committed again to docs/app-demo, not pushed");
    expect(git(root, "rev-parse", "docs/app-demo^")).toBe(git(root, "rev-parse", `origin/${base()}`));
    expect(meta().docsBranch).toBe("docs/app-demo");
    expect(meta().docsCommit).toBe(git(root, "rev-parse", "docs/app-demo"));
    expect(docsTree()).toEqual(before);
  }, 15_000);
});
