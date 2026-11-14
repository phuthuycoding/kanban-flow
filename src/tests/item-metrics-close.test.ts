import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdIssues } from "../cli/commands/issues.js";
import { cmdSync } from "../cli/commands/sync.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { readEstimateHistory } from "../workflow/estimate.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { REVIEW_DOCS_NONE, withDocsImpact } from "./helpers/contract.js";
import type { ParsedArgs } from "../cli/args.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

/*
 * The measurement is written by the close itself, whichever command closes the item. Items are walked from
 * `kf new` to a review PASS, their lifecycle times are moved an hour into the past so the review report's
 * `created` stamp (local time, 30 minutes ago) falls between the implementation entry and the close.
 */

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
let prevPath: string | undefined;

const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr) [ "$2" = view ] && printf '{"state":"%s","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n' "\${GH_PR_STATE:-MERGED}"; exit 0 ;;
esac
exit 0
`;

const ISSUE = "https://github.com/o/r/issues/7";
const PR = "https://github.com/o/r/pull/9";
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n## Affected surfaces\nN/A\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";
const PLAN = "# Contract\nUC-001: Ship it\n\n## Estimate\n\n- Agent minutes: 12\n";

const feature = (name: string) => findFeature(root, name)!;
const metricsPath = (name: string): string => join(feature(name).dir, "metrics.json");
const readMetrics = (name: string): Record<string, any> => JSON.parse(readFileSync(metricsPath(name), "utf8"));

function localStamp(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function testingReport(name: string): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS["testing-result"].file), `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${evidence}`);
}

async function reviewReport(name: string): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  const created = localStamp(new Date(Date.now() - 30 * 60_000));
  await writeFile(join(feature(name).dir, ARTIFACTS["review-report"].file),
    `---\nstatus: PASS\nexecution: ${execution}\ncreated: "${created}"\nci: none\nlanding: none\n${REVIEW_DOCS_NONE}---\n# Review Report\n\n## Reviewer\n\n| Field | Result |\n|---|---|\n| Tier and reason | standard — one module touched |\n`);
}

async function reviewStage(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact(PLAN) : "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Ship it\nUser ships.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  await testingReport(name);
  await grantStageWaiver(root, name);
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await reviewReport(name);
  await writeFile(join(feature(name).dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
  await writeFeatureMeta(feature(name).dir, {
    ...readFeatureMeta(feature(name).dir)!, issue: ISSUE, pr: PR,
    filesChanged: { count: 4, at: new Date().toISOString() },
  });
  shiftLifecycle(name, -60);
}

/** Moves every lifecycle record of the item `minutes` minutes. */
function shiftLifecycle(name: string, minutes: number): void {
  const file = join(feature(name).dir, "lifecycle.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => {
    const rec = JSON.parse(l) as { at: string };
    return JSON.stringify({ ...rec, at: new Date(Date.parse(rec.at) + minutes * 60_000).toISOString() });
  });
  writeFileSync(file, `${lines.join("\n")}\n`);
}

const stamp = (m: number): string => new Date(Date.now() - m * 60_000).toISOString().replace(/\.\d+Z$/, "Z");

function ledger(opts: { broken?: boolean } = {}): string {
  const lines = [
    "# Task loop ledger",
    `TASK-001: test-writer dispatched model=opus @ ${stamp(58)}`,
    `TASK-001: test-writer done status=DONE @ ${stamp(55)}`,
    `TASK-001: developer dispatched model=sonnet @ ${stamp(55)}`,
    `TASK-001: developer done status=DONE @ ${stamp(49)}`,
    `TASK-001: code-reviewer dispatched model=opus @ ${stamp(49)}`,
    `TASK-001: code-reviewer done status=DONE @ ${stamp(45)}`,
    `TASK-001: fix round 1/5 (review finding) @ ${stamp(45)}`,
    ...(opts.broken ? [`TASK-001: developer dispatchd model=opus @ ${stamp(44)}`] : []),
    `TASK-001: complete (all green) @ ${stamp(44)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** The ledger as the loop writes it; its mtime is moved ahead so no stamp counts as written after the file. */
async function writeLedger(name: string, opts: { broken?: boolean } = {}): Promise<void> {
  const dir = join(feature(name).dir, "loop");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "progress.md");
  await writeFile(file, ledger(opts));
  const later = new Date(Date.now() + 3600_000);
  utimesSync(file, later, later);
}

const loopMetrics = (): string => (existsSync(join(root, ".works", "loop-metrics.md")) ? readFileSync(join(root, ".works", "loop-metrics.md"), "utf8") : "");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-item-metrics-close-"));
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

describe("closing an item measures it", () => {
  it("writes metrics.json with every figure when kf archive closes the item", async () => {
    await reviewStage("shipit");
    await writeLedger("shipit");
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature("shipit").stage).toBe("done");

    const m = readMetrics("shipit");
    expect(m).toMatchObject({ v: 1, feature: "shipit", kind: "feature" });
    expect(typeof m.id).toBe("string");
    expect(m.closedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(m.estimate).toMatchObject({ minutes: 12, size: "M" });
    expect(m.actual.size).toBe("L");
    expect(m.actual.workMinutes).toBeGreaterThanOrEqual(28);
    expect(m.actual.workMinutes).toBeLessThanOrEqual(31);
    expect(m.gap).toBe(1);
    expect(m.filesChanged).toEqual({ count: 4 });
    expect(m.tier).toContain("standard");
    expect(m.ledger).toMatchObject({ rounds: 1 });
    expect(JSON.stringify(m.ledger.models)).toContain("opus");
    expect(JSON.stringify(m.ledger.models)).toContain("sonnet");
    expect(m.ledger.seatMinutes).toBeGreaterThan(0);
    expect(m.stages.map((s: { stage: string }) => s.stage)).toEqual(expect.arrayContaining(["brainstorm", "planning", "implementation", "testing", "review"]));
    expect(m.path.filter((s: string, i: number) => i === 0 || s !== m.path[i - 1])).toEqual(["brainstorm", "planning", "implementation", "testing", "review", "done"]);
    expect(m.gates.requirement).toHaveProperty("minutes");
    expect(m.gates.plan).toHaveProperty("minutes");
    expect(m.gates.merge.approximate).toBe(true);
    expect(m.gates.merge.minutes).toBeGreaterThanOrEqual(29);
    expect(m.gates.merge.minutes).toBeLessThanOrEqual(33);
  });

  it("keeps nothing machine-local in metrics.json", async () => {
    await reviewStage("shipit");
    await writeLedger("shipit");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const text = readFileSync(metricsPath("shipit"), "utf8");
    expect(text).not.toContain(root);
    expect(text).not.toContain(hostname());
    expect(text).not.toContain("worktree");
  });

  it("is read back by the estimate history as a measured row", async () => {
    await reviewStage("shipit");
    await writeLedger("shipit");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const row = readEstimateHistory(root).find((r) => r.feature === "shipit");
    expect(row).toMatchObject({ est: "M", actual: "L", files: 4, estMinutes: 12, kind: "feature" });
  });

  it("measures an item closed by kf stage done and one closed by kf issues done", async () => {
    await reviewStage("viastage");
    await reviewStage("viaissues");
    const stage = await cmdStage(args("stage", ["viastage", "done"]), root);
    expect(stage.code, stage.stdout).toBe(0);
    const issues = await cmdIssues(args("issues", ["done", "viaissues"]), root);
    expect(issues.code, issues.stdout).toBe(0);
    expect(feature("viastage").stage).toBe("done");
    expect(feature("viaissues").stage).toBe("done");
    expect(existsSync(metricsPath("viastage"))).toBe(true);
    expect(existsSync(metricsPath("viaissues"))).toBe(true);
    expect(readMetrics("viastage").feature).toBe("viastage");
    expect(readMetrics("viaissues").feature).toBe("viaissues");
  });
});

describe("closing an item records its loop row only for a sound ledger", () => {
  it("writes the loop-metrics row for a ledger kf loop-stats --record accepts", async () => {
    await reviewStage("goodled");
    await writeLedger("goodled");
    expect((await cmdArchive(args("archive", ["goodled"]), root)).code).toBe(0);
    expect(loopMetrics()).toContain(" · goodled · ");
    expect(readMetrics("goodled").loopMetricsRow).toEqual({ written: true });
  });

  it("writes no row for a ledger with a broken line and says why in metrics.json", async () => {
    await reviewStage("goodled");
    await writeLedger("goodled");
    expect((await cmdArchive(args("archive", ["goodled"]), root)).code).toBe(0);

    await reviewStage("badled");
    await writeLedger("badled", { broken: true });
    const res = await cmdArchive(args("archive", ["badled"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(feature("badled").stage).toBe("done");

    expect(loopMetrics()).toContain(" · goodled · ");
    expect(loopMetrics()).not.toContain(" · badled · ");
    const row = readMetrics("badled").loopMetricsRow;
    expect(row).toHaveProperty("missing");
    // The broken line is line 9 of the ledger file.
    expect(row.missing).toContain("unparsed");
    expect(row.missing).toMatch(/\b9\b/);
    // The good lines still give the measurement its rounds.
    expect(readMetrics("badled").ledger).toMatchObject({ rounds: 1 });
  });

  it("names a missing ledger in metrics.json and writes no row", async () => {
    await reviewStage("noledger");
    expect((await cmdArchive(args("archive", ["noledger"]), root)).code).toBe(0);
    expect(loopMetrics()).not.toContain(" · noledger · ");
    expect(readMetrics("noledger").loopMetricsRow).toHaveProperty("missing");
    expect(readMetrics("noledger").ledger).toHaveProperty("missing");
  });
});

describe("a measurement that fails never changes the close", () => {
  it("closes both items in a sync sweep, warns once, and measures the other item", async () => {
    await reviewStage("alpha");
    await reviewStage("beta");
    // A directory where metrics.json goes makes writing it fail; the folder carries it through the move to done.
    await mkdir(join(feature("alpha").dir, "metrics.json"));

    const res = await cmdSync(args("sync"), root);
    const out = `${res.stdout}\n${res.stderr ?? ""}`;
    expect(res.code, out).toBe(0);
    expect(feature("alpha").stage).toBe("done");
    expect(feature("beta").stage).toBe("done");
    expect(readFeatureMeta(feature("alpha").dir)!.delivered).toBe(true);
    expect(readFeatureMeta(feature("beta").dir)!.delivered).toBe(true);

    expect(statSync(metricsPath("alpha")).isDirectory()).toBe(true);
    expect(statSync(metricsPath("beta")).isFile()).toBe(true);
    expect(readMetrics("beta").feature).toBe("beta");

    const warnings = out.split("\n").filter((l) => /measurement/i.test(l));
    expect(warnings, out).toHaveLength(1);
    expect(warnings[0]).toContain("⚠ the measurement of 'alpha' was not written: ");
    expect(warnings[0]).not.toContain("beta");
    expect(warnings[0]).not.toMatch(/warning:/i);
  });

  it("leaves no temporary file in the item folder when writing metrics.json fails", async () => {
    await reviewStage("alpha");
    // A directory where metrics.json goes makes the rename of the temporary file over it fail.
    await mkdir(join(feature("alpha").dir, "metrics.json"));

    const res = await cmdSync(args("sync"), root);
    expect(res.code, `${res.stdout}\n${res.stderr ?? ""}`).toBe(0);
    expect(feature("alpha").stage).toBe("done");

    const names = readdirSync(feature("alpha").dir);
    expect(names).toContain("metrics.json");
    expect(names.filter((n) => n.startsWith("metrics.json.") && n !== "metrics.json")).toEqual([]);
  });
});
