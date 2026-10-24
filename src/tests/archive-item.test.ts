import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { archiveItem } from "../workflow/archive.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
let prevPath: string | undefined;

const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr) [ "$2" = view ] && printf '{"state":"%s"}\\n' "\${GH_PR_STATE:-MERGED}"; exit 0 ;;
esac
exit 0
`;

const ISSUE = "https://github.com/o/r/issues/7";
const PR = "https://github.com/o/r/pull/9";
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n## Affected surfaces\nN/A\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

const feature = (name = "shipit") => findFeature(root, name)!;

async function report(name: string, id: "testing-result" | "review-report"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

async function implementationStage(name = "shipit"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Ship it\nUser ships.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
}

async function reviewStage(name = "shipit"): Promise<void> {
  await implementationStage(name);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  await report(name, "testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report(name, "review-report");
  await writeFile(join(feature(name).dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
  await writeFeatureMeta(feature(name).dir, { ...readFeatureMeta(feature(name).dir)!, issue: ISSUE, pr: PR });
}

const normalize = (s: string) => s.split(root).join("<root>");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-archive-item-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false } }));
  const stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_PR_STATE;
  await rm(root, { recursive: true, force: true });
});

const DOCS = [
  "docs/requirement/app/shipit.md",
  "docs/use-cases/app/shipit/README.md",
  "docs/use-cases/app/shipit/diagram.md",
  "docs/testplan/app/shipit.md",
  "docs/testplan/app/shipit-result.md",
  "docs/use-cases/app/shipit/UC-001.md",
];

// Recorded from `kf archive` before archiveItem existed; <root> and <folder> stand in for the temp
// project root and the timestamped item folder.
const RECORDED = {
  success: {
    code: 0,
    stdout: `✓ Archived 'shipit'  review → dones\n  <root>/.works/dones/<folder>\n  Canonical docs synced:\n${DOCS.map((d) => `    <root>/${d}`).join("\n")}\n  Delivery finalized — \`delivered\` stamped in .kfw.json.`,
  },
  unmerged: {
    code: 1,
    stdout: "Cannot archive 'shipit': PR https://github.com/o/r/pull/9 is not merged (state: OPEN) — merge it first, then archive.",
    stderr: "pr not merged",
  },
  wrongStage: {
    code: 1,
    stdout: "Cannot archive 'shipit': feature is in stage \"implementation\". Archive only from review or shipping (run: kf stage shipit review first).",
    stderr: "wrong stage",
  },
  reconcile: {
    code: 0,
    stdout: `Feature 'shipit' is already in dones.\nCanonical docs synced:\n${DOCS.map((d) => `  <root>/${d}`).join("\n")}\n  Delivery finalized — item was already marked delivered; side effects re-checked.`,
  },
};

const render = (res: { code: number; stdout: string; stderr?: string }, folder: string) =>
  ({ ...res, stdout: normalize(res.stdout).split(folder).join("<folder>") });

describe("archiveItem — typed outcome", () => {
  it("archives a merged review item", async () => {
    await reviewStage();
    const folder = feature().folder;
    const outcome = await archiveItem(root, "shipit");
    expect(outcome.kind).toBe("archived");
    if (outcome.kind !== "archived") return;
    expect(outcome.from).toBe("review");
    expect(outcome.dir).toBe(join(root, ".works", "dones", folder));
    expect(outcome.docs.map((d) => normalize(d))).toEqual(DOCS.map((d) => `<root>/${d}`));
    expect(outcome.bypasses).toEqual([]);
    expect(outcome.teardown).toBeNull();
    expect(render({ code: 0, stdout: outcome.stdout }, folder)).toEqual(RECORDED.success);
    expect(feature().stage).toBe("dones");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);
  });

  it("refuses an unmerged PR with no side effect", async () => {
    await reviewStage();
    process.env.GH_PR_STATE = "OPEN";
    const outcome = await archiveItem(root, "shipit", { force: true });
    expect(outcome).toEqual({ kind: "refused", reason: "merge-gate", stderrTag: RECORDED.unmerged.stderr, stdout: RECORDED.unmerged.stdout });
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
  });

  it("refuses an item outside review/shipping", async () => {
    await implementationStage();
    const outcome = await archiveItem(root, "shipit");
    expect(outcome).toEqual({ kind: "refused", reason: "wrong-stage", stderrTag: RECORDED.wrongStage.stderr, stdout: RECORDED.wrongStage.stdout });
    expect(feature().stage).toBe("implementation");
  });

  it("reconciles an item already in dones", async () => {
    await reviewStage();
    expect((await archiveItem(root, "shipit")).kind).toBe("archived");
    const outcome = await archiveItem(root, "shipit");
    expect(outcome.kind).toBe("reconciled");
    expect(normalize(outcome.kind === "reconciled" ? outcome.stdout : "")).toBe(RECORDED.reconcile.stdout);
  });

  it("returns an unknown item as a refusal, not a throw", async () => {
    expect(await archiveItem(root, "nope")).toEqual({ kind: "refused", reason: "unknown-item", stderrTag: "unknown feature", stdout: "Unknown feature 'nope'. Run: kf list" });
  });
});

describe("kf archive renders byte-identically to the recorded output", () => {
  it("success", async () => {
    await reviewStage();
    const folder = feature().folder;
    expect(render(await cmdArchive(args("archive", ["shipit"]), root), folder)).toEqual(RECORDED.success);
  });

  it("unmerged-PR refusal", async () => {
    await reviewStage();
    process.env.GH_PR_STATE = "OPEN";
    expect(await cmdArchive(args("archive", ["shipit"]), root)).toEqual(RECORDED.unmerged);
  });

  it("wrong stage", async () => {
    await implementationStage();
    expect(await cmdArchive(args("archive", ["shipit"]), root)).toEqual(RECORDED.wrongStage);
  });

  it("reconcile of an already-dones item", async () => {
    await reviewStage();
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect({ ...res, stdout: normalize(res.stdout) }).toEqual(RECORDED.reconcile);
  });
});
