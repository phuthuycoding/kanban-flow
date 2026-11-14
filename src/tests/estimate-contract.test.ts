import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { readContractEstimate } from "../workflow/estimate-contract.js";
import { sizeOf } from "../workflow/estimate.js";
import { ARTIFACTS } from "../workflow/schema.js";
import type { Feature } from "../workflow/features.js";

/*
 * The contract estimate is read from the item's own artifacts: the plan's `## Estimate` section and the
 * distinct entries of its Task Breakdown `Files` cells, or a bug report's `## Estimate` section.
 */

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "kf-estimate-contract-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A planning item whose folder holds `file` with `text`. */
function itemWith(kind: "feature" | "bug", file: string, text: string): Feature {
  writeFileSync(join(dir, file), text);
  return {
    name: "demo",
    context: "app",
    stage: "planning",
    dir,
    folder: basename(dir),
    meta: { schema: "kanban-flow", feature: "demo", context: "app", created: "20261114_0300", kind },
  };
}

/** A plan with an optional `## Estimate` body and one Task Breakdown row per Files cell. */
function plan(estimate: string | null, filesCells: string[]): string {
  const rows = filesCells.map((cell, i) => `| TASK-00${i + 1} | Step ${i + 1} | - | Done | FR-001 / UC-001 | ${cell} |`);
  return [
    "# Implementation Plan",
    "",
    ...(estimate === null ? [] : ["## Estimate", "", estimate, ""]),
    "## Task Breakdown",
    "",
    "| Task | Description | Dependencies | Expected output | FR / UC references | Files |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

const planItem = (estimate: string | null, filesCells: string[]): Feature =>
  itemWith("feature", ARTIFACTS["implementation-plan"].file, plan(estimate, filesCells));

describe("the contract estimate of a plan", () => {
  it("reads the agent minutes and counts each distinct Files entry once", () => {
    const f = planItem("- Agent minutes: 30", [
      "`src/a.ts`, `src/b.ts`",
      "`src/c.ts`, src/a.ts",
      "`src/d.ts`, `docs/e.md`",
    ]);

    expect(readContractEstimate(f)).toEqual({ minutes: 30, files: 5, filesMark: "exact" });
  });

  it("marks the count partial when one Files cell is empty, and the size is the higher of minutes and files", () => {
    const f = planItem("- Agent minutes: 3", [
      "`src/a.ts`, `src/b.ts`",
      "",
      "`src/c.ts`, `src/d.ts`",
    ]);

    const estimate = readContractEstimate(f);
    expect(estimate).toEqual({ minutes: 3, files: 4, filesMark: "partial" });
    if (!("minutes" in estimate)) throw new Error("expected an estimate, got a problem");
    // 3 minutes alone sizes S; 4 files sizes M, and the higher wins.
    expect(sizeOf(estimate.minutes, estimate.files)).toBe("M");
  });

  it("gives an unknown file count when every Files cell is empty, and sizes from the minutes alone", () => {
    const f = planItem("- Agent minutes: 30", ["", ""]);

    const estimate = readContractEstimate(f);
    expect(estimate).toEqual({ minutes: 30, files: null, filesMark: "unknown" });
    if (!("minutes" in estimate)) throw new Error("expected an estimate, got a problem");
    expect(sizeOf(estimate.minutes, estimate.files)).toBe("L");
  });

  it("counts a glob and a directory once each and marks the count partial", () => {
    const f = planItem("- Agent minutes: 10", [
      "`src/a.ts`, `src/*.ts`",
      "`docs/`, src/a.ts",
      "`src/workflow`, `src/*.ts`",
    ]);

    expect(readContractEstimate(f)).toEqual({ minutes: 10, files: 4, filesMark: "partial" });
  });

  it("reports a problem when the plan has no Estimate section", () => {
    const estimate = readContractEstimate(planItem(null, ["`src/a.ts`"]));
    expect(estimate).toEqual({ problem: expect.any(String) });
    if (!("problem" in estimate)) throw new Error("expected a problem");
    expect(estimate.problem.trim()).not.toBe("");
  });

  it("reports a problem when the Estimate section holds no number", () => {
    const estimate = readContractEstimate(planItem("- Agent minutes: soon", ["`src/a.ts`"]));
    expect(estimate).toEqual({ problem: expect.any(String) });
  });

  it("reports a problem when the agent minutes are not above zero", () => {
    const estimate = readContractEstimate(planItem("- Agent minutes: 0", ["`src/a.ts`"]));
    expect(estimate).toEqual({ problem: expect.any(String) });
  });

  it("names a different problem for a missing section, a missing number and a number not above zero", () => {
    const problems = [null, "- Agent minutes: soon", "- Agent minutes: 0"].map((estimate) => {
      rmSync(dir, { recursive: true, force: true });
      dir = realpathSync(mkdtempSync(join(tmpdir(), "kf-estimate-contract-")));
      const r = readContractEstimate(planItem(estimate, ["`src/a.ts`"]));
      if (!("problem" in r)) throw new Error(`expected a problem for ${String(estimate)}`);
      return r.problem;
    });
    expect(new Set(problems).size).toBe(3);
  });
});

describe("the contract estimate of a bug report", () => {
  const bugReport = (estimate: string | null): string => [
    "---", "kind: bug", "status: confirmed", "severity: MEDIUM", "---", "# Bug Report", "", "## Bug Summary", "It breaks.", "",
    ...(estimate === null ? [] : ["## Estimate", "", estimate, ""]),
  ].join("\n");

  it("reads the agent minutes from the bug report, with the file count unknown", () => {
    const f = itemWith("bug", ARTIFACTS["spec-requirement"].file, bugReport("- Agent minutes: 15"));

    expect(readContractEstimate(f)).toEqual({ minutes: 15, files: null, filesMark: "unknown" });
  });

  it("reports a problem when the bug report has no Estimate section", () => {
    const f = itemWith("bug", ARTIFACTS["spec-requirement"].file, bugReport(null));

    expect(readContractEstimate(f)).toEqual({ problem: expect.any(String) });
  });
});
