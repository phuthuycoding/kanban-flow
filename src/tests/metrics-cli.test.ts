import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdMetrics } from "../cli/commands/metrics.js";
import { commandHelp, parseArgsCli, type ParsedArgs } from "../cli/args.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { METADATA_FILE } from "../workflow/schema.js";

let root: string;

const MEASURED = {
  v: 1,
  closedAt: "2026-11-01T10:05:00.000Z",
  id: "0b6f6b1e-5a3c-4d7e-9a55-1c2d3e4f5a6b",
  feature: "measured",
  kind: "feature",
  estimate: { minutes: 10, files: null, filesMark: "unknown", size: "S", factor: 1, at: "2026-11-01T09:25:00.000Z" },
  actual: { size: "M", workMinutes: 20 },
  gap: 1,
  stages: [{ stage: "brainstorm", minutes: 10 }, { stage: "planning", minutes: 20 }, { stage: "review", missing: "no lifecycle record" }],
  path: ["brainstorm", "planning", "implementation", "review", "done"],
  gates: { requirement: { minutes: 10 }, plan: { minutes: 20 }, merge: { unreliable: "clock went backwards" } },
  ledger: { rounds: 2, seatMinutes: 13, models: ["opus", "sonnet"] },
  filesChanged: { count: 4 },
  tier: "standard — one module touched",
  loopMetricsRow: { written: true },
};

const NO_SEATS = {
  ...MEASURED,
  feature: "noseats",
  ledger: { rounds: 0, seatMinutes: { missing: "no seat time recorded" }, models: [] },
  filesChanged: { missing: "no default branch to count against" },
  gap: { missing: "no estimate" },
  estimate: { none: true, reason: "no estimate in the plan" },
};

async function seed(feature: string, stage: "done" | "review", metrics: object | null): Promise<void> {
  const dir = join(root, ".works", stage, `${feature}_20261101_0900`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature, context: "app", created: "20261101_0900" }));
  if (metrics !== null) await writeFile(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
}

const cliArgs = (positionals: string[], options: Record<string, unknown> = {}, parseError?: string): ParsedArgs =>
  ({ command: "metrics", positionals, options, ...(parseError === undefined ? {} : { parseError }) });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-metrics-cli-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261101_0900", defaultContext: "app" }));
  await seed("measured", "done", MEASURED);
  await seed("noseats", "done", NO_SEATS);
  await seed("unmeasured", "done", null);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf metrics <feature>", () => {
  it("prints every figure of the measurement as text, with the reason of each missing one", async () => {
    const res = await cmdMetrics(cliArgs(["measured"]), root);
    expect(res.code).toBe(0);
    for (const figure of ["measured", "S", "M", "20", "13", "opus", "sonnet", "standard", "brainstorm", "planning", "review", "4"]) {
      expect(res.stdout, figure).toContain(figure);
    }
    expect(res.stdout).toContain("missing: no lifecycle record");
    expect(res.stdout).toContain("clock went backwards");
  });

  it("prints the same figures as JSON with --json", async () => {
    const res = await cmdMetrics(cliArgs(["measured"], { json: true }), root);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(MEASURED);
  });

  it("says no seat time was recorded when the ledger had no seat lines, in text and in JSON", async () => {
    const text = await cmdMetrics(cliArgs(["noseats"]), root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("no seat time recorded");
    expect(text.stdout).toContain("missing: no default branch to count against");
    expect(text.stdout).toContain("missing: no estimate");

    const json = await cmdMetrics(cliArgs(["noseats"], { json: true }), root);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout).ledger.seatMinutes).toEqual({ missing: "no seat time recorded" });
  });

  it("exits 1 with a message when the item has no measurement yet", async () => {
    const res = await cmdMetrics(cliArgs(["unmeasured"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no measurement yet for unmeasured");
  });

  it("exits 1 for an item still in review that has no measurement", async () => {
    await seed("inflight", "review", null);
    const res = await cmdMetrics(cliArgs(["inflight"], { json: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no measurement yet for inflight");
  });

  it("exits 3 when the feature is missing, extra, or unknown", async () => {
    expect((await cmdMetrics(cliArgs([]), root)).code).toBe(3);
    expect((await cmdMetrics(cliArgs(["measured", "noseats"]), root)).code).toBe(3);
    expect((await cmdMetrics(cliArgs(["nosuchitem"]), root)).code).toBe(3);
  });

  it("exits 3 when the flags did not parse", async () => {
    const res = await cmdMetrics(cliArgs(["measured"], {}, "unknown option --bogus"), root);
    expect(res.code).toBe(3);
    expect(res.stdout).toContain("Usage: kf metrics");
  });
});

describe("kf metrics registration", () => {
  it("parses the feature and --json, and has a help line", () => {
    const parsed = parseArgsCli(["metrics", "measured", "--json"]);
    expect(parsed.command).toBe("metrics");
    expect(parsed.positionals).toEqual(["measured"]);
    expect(parsed.options.json).toBe(true);
    expect(commandHelp("metrics")).toContain("kf metrics");
  });

  it("reports an unknown flag as bad input instead of exiting 1, which means no measurement", () => {
    const parsed = parseArgsCli(["metrics", "measured", "--bogus"]);
    expect(parsed.parseError).toBeDefined();
  });
});
