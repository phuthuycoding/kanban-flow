import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACTS, STAGE_GATES } from "../workflow/schema.js";
import { executionContractHash } from "../workflow/features.js";
import { FIXTURES, PACKAGE_NAME, createConsumer, type Consumer } from "./fixtures/lib/consumer-project.js";

const LIB = `${PACKAGE_NAME}/lib`;
const LEDGER = join(FIXTURES, "progress.md");

let consumer: Consumer;

beforeEach(() => {
  consumer = createConsumer();
});

afterEach(() => {
  consumer.cleanup();
});

describe("task-loop ledger through the library", () => {
  it("reads the dispatched, done and complete events of the fixture ledger in order", () => {
    const out = consumer.runJson<{ ok: boolean; events: { type: string; seat?: string; status?: string }[] }>(
      `import { readFileSync } from "node:fs";
import { readLedgerState } from "${LIB}";
const read = readLedgerState(readFileSync(process.argv[2], "utf8"));
const events = read.ok ? read.state.events.filter((e) => e.task === "TASK-001" && ["dispatched", "done", "complete"].includes(e.type)) : [];
console.log(JSON.stringify({ ok: read.ok, events }));
`,
      [LEDGER],
    );

    expect(out.ok).toBe(true);
    expect(out.events.map((e) => [e.type, e.seat ?? null, e.status ?? null])).toEqual([
      ["dispatched", "test-writer", null],
      ["done", "test-writer", "DONE"],
      ["dispatched", "developer", null],
      ["done", "developer", "DONE"],
      ["dispatched", "code-reviewer", null],
      ["done", "code-reviewer", "clean"],
      ["complete", null, null],
    ]);
  });

  it("folds the ledger into a world where the task is complete, under the live cap of a hand-built input", () => {
    const inputs = {
      feature: "demo",
      kind: "feature",
      level: null,
      tasks: [{ id: "TASK-001", dependencies: [], files: ["src/a.ts"], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"] }],
      ceiling: { max: 4, source: "default" },
      reportCommits: {},
      verifyRuns: {},
      gitLog: [],
    };

    const out = consumer.runJson<{ capN: number; phase: string; taskIds: string[] }>(
      `import { readFileSync } from "node:fs";
import { foldWorld, liveCap, readLedgerState } from "${LIB}";
const read = readLedgerState(readFileSync(process.argv[2], "utf8"));
if (!read.ok) throw new Error("ledger refused: " + JSON.stringify(read.repair));
const inputs = JSON.parse(process.argv[3]);
const cap = liveCap(read.state, inputs);
const world = foldWorld(read.state, inputs, cap);
console.log(JSON.stringify({ capN: cap.n, phase: world.tasks.get("TASK-001").phase.kind, taskIds: [...world.tasks.keys()] }));
`,
      [LEDGER, JSON.stringify(inputs)],
    );

    expect(out.capN).toBeGreaterThanOrEqual(1);
    expect(out.taskIds).toEqual(["TASK-001"]);
    expect(out.phase).toBe("complete");
  });

  it("parses the fixture ledger with no unparsed line and counts one task", () => {
    const out = consumer.runJson<{ unparsed: number[]; kinds: string[]; tasks: number }>(
      `import { readFileSync } from "node:fs";
import { loopStats, parseLedger } from "${LIB}";
const parsed = parseLedger(readFileSync(process.argv[2], "utf8"));
const stats = loopStats(parsed);
console.log(JSON.stringify({ unparsed: stats.unparsed, kinds: parsed.lines.map((l) => l.kind), tasks: stats.tasks }));
`,
      [LEDGER],
    );

    expect(out.kinds).not.toContain("unparsed");
    expect(out.unparsed).toEqual([]);
    expect(out.tasks).toBe(1);
  });
});

describe("lifecycle log through the library", () => {
  it("folds the fixture log, reads the fixture folder to the same state and drops the worktree from shared metadata", () => {
    const expected = {
      stage: "planning",
      meta: {
        schema: "kanban-flow",
        feature: "demo",
        context: "cli",
        created: "20261113_0000",
        kind: "feature",
        issue: "https://github.com/acme/demo/issues/7",
      },
    };

    const out = consumer.runJson<{
      file: string;
      folded: { ok: boolean; state: unknown; records: number };
      fromDisk: { ok: boolean; state: unknown; records: number };
      shared: Record<string, unknown>;
    }>(
      `import { readFileSync } from "node:fs";
import { ITEM_LOG_FILE, foldItemLog, readItemLog, sharedMeta } from "${LIB}";
const folded = foldItemLog(readFileSync(process.argv[2], "utf8"));
const fromDisk = readItemLog(process.argv[3]);
const meta = { feature: "demo", context: "cli", worktree: { path: "/x", branch: "b" } };
console.log(JSON.stringify({ file: ITEM_LOG_FILE, folded, fromDisk, shared: sharedMeta(meta) }));
`,
      [join(FIXTURES, "lifecycle.jsonl"), FIXTURES],
    );

    expect(out.file).toBe("lifecycle.jsonl");
    expect(out.folded).toEqual({ ok: true, state: expected, records: 3 });
    expect(out.fromDisk).toEqual(out.folded);
    expect(out.shared).toEqual({ feature: "demo", context: "cli" });
  });
});

describe("item folder through the library", () => {
  let root: string;
  let itemDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kfw-lib-root-")));
    itemDir = join(root, ".works", "planning", "demo_20261113_0000");
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(
      join(itemDir, ".kfw.json"),
      JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "cli", created: "20261113_0000" }),
    );
    // The contract hash covers every planning artifact; with one missing it is null and the comparison proves nothing.
    for (const id of ["spec-requirement", ...STAGE_GATES.planning] as const) {
      writeFileSync(join(itemDir, ARTIFACTS[id].file), `# ${id}\n\nFilled content for ${id}.\n`);
    }
    mkdirSync(join(itemDir, "use-cases"), { recursive: true });
    writeFileSync(join(itemDir, "use-cases", "UC-001-demo.md"), "# UC-001\n\nFilled use case.\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds the root, lists and finds the item, and reads its meta, stage records and contract hash", () => {
    const reference = executionContractHash(itemDir, "feature");
    expect(reference).toMatch(/^[0-9a-f]{64}$/);

    const out = consumer.runJson<{
      foundRoot: string | null;
      listed: { name: string; stage: string }[];
      found: { name: string; stage: string; folder: string } | null;
      metaFeature: string | undefined;
      records: unknown[];
      hash: string | null;
    }>(
      `import { executionContractHash, findFeature, findWorksRoot, listFeatures, readFeatureMeta, readStageRecords } from "${LIB}";
const [root, dir] = process.argv.slice(2);
const found = findFeature(root, "demo");
console.log(JSON.stringify({
  foundRoot: findWorksRoot(dir),
  listed: listFeatures(root).map((f) => ({ name: f.name, stage: f.stage })),
  found: found && { name: found.name, stage: found.stage, folder: found.folder },
  metaFeature: readFeatureMeta(dir)?.feature,
  records: readStageRecords(found),
  hash: executionContractHash(dir, "feature"),
}));
`,
      [root, itemDir],
    );

    expect(out.foundRoot).toBe(root);
    expect(out.listed).toEqual([{ name: "demo", stage: "planning" }]);
    expect(out.found).toEqual({ name: "demo", stage: "planning", folder: "demo_20261113_0000" });
    expect(out.metaFeature).toBe("demo");
    expect(out.records).toEqual([]);
    expect(out.hash).toBe(reference);
  });

  it("computes status, needs-you buckets and dashboard data that place the item in planning", () => {
    const out = consumer.runJson<{
      json: { feature: string; stage: string };
      buckets: { needsYou: { feature: string; decision: string }[]; waitingToMerge: unknown[] };
      planning: string[];
    }>(
      `import { computeBuckets, computeStatus, dashboardData, findFeature, statusToJson } from "${LIB}";
const root = process.argv[2];
const status = computeStatus(findFeature(root, "demo"), root);
const board = dashboardData(root);
console.log(JSON.stringify({
  json: statusToJson(status),
  buckets: computeBuckets([status], []),
  planning: board.stages.find((s) => s.id === "planning").features.map((f) => f.name),
}));
`,
      [root],
    );

    expect(out.json.feature).toBe("demo");
    expect(out.json.stage).toBe("planning");
    expect(out.buckets.needsYou).toHaveLength(1);
    expect(out.buckets.needsYou[0].feature).toBe("demo");
    expect(out.buckets.needsYou[0].decision).toContain("approve plan");
    expect(out.buckets.waitingToMerge).toEqual([]);
    expect(out.planning).toEqual(["demo"]);
  });
});
