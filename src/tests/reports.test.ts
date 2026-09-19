import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, writeFeatureMeta, executionContractHash } from "../workflow/features.js";
import { validateFeature } from "../workflow/validate.js";
import { commandExitCodes } from "../workflow/validate-reports.js";

let root: string;
let dir: string;

const table = (rows: string[]) =>
  `## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n${rows.map((r) => `${r}\n`).join("")}`;

async function testingBug(status: string, body: string): Promise<void> {
  await writeFile(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Bug\nReproduced.");
  await writeFeatureMeta(dir, {
    schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200", kind: "bug",
    approval: { status: "approved", contractHash: executionContractHash(dir, "bug")! }, executionId: "run-1",
  });
  await writeFile(join(dir, "phase-4-testing-result.md"), `---\nstatus: ${status}\nexecution: run-1\n---\n# Testing Result\n\n## Summary\nDone.\n\n${body}`);
}

const codes = () => validateFeature(findFeature(root, "demo")!).issues.filter((i) => i.code === "testing_exit_code");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-reports-"));
  ensureWorksStructure(root);
  dir = join(root, ".works", "testing", "demo_20260919_1200");
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("testing_exit_code", () => {
  it("accepts PASS with one command that exited 0", async () => {
    await testingBug("PASS", table(["| npm test | 0 | 136 passed |"]));
    expect(codes()).toEqual([]);
  });

  it("rejects PASS with a non-zero exit code", async () => {
    await testingBug("PASS", table(["| npm test | 1 | 2 failed |"]));
    expect(codes()).toHaveLength(1);
    expect(codes()[0].message).toContain("1 row");
  });

  it("rejects PASS without any command row", async () => {
    await testingBug("PASS", table([]));
    expect(codes()).toHaveLength(1);
    expect(codes()[0].message).toContain("at least one command");
  });

  it("rejects PASS when the section is missing entirely", async () => {
    await testingBug("PASS", "## Regression\nnone\n");
    expect(codes()).toHaveLength(1);
  });

  it("rejects PASS with an N/A exit code", async () => {
    await testingBug("PASS", table(["| npm test | N/A | not run |"]));
    expect(codes()).toHaveLength(1);
  });

  it("does not constrain a FAIL report", async () => {
    await testingBug("FAIL", table(["| npm test | 1 | 2 failed |"]));
    expect(codes()).toEqual([]);
  });

  it("reads only the table under the Commands and Evidence heading", async () => {
    const other = "## Failures and Blockers\n\n| Case | Error | Impact | Next |\n|---|---|---|---|\n| TC-9 | boom | high | fix |\n";
    await testingBug("PASS", `${table(["| npm test | 0 | ok |", "| npm run lint | 0 | clean |"])}\n${other}`);
    expect(codes()).toEqual([]);
    expect(commandExitCodes(`${table(["| a | 0 | x |"])}\n${other}`)).toEqual(["0"]);
    expect(commandExitCodes("# nothing")).toBeNull();
  });
});
