import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACTS, STAGE_GATES } from "../workflow/schema.js";
import { executionContractHash } from "../workflow/features.js";
import { FIXTURES, PACKAGE_NAME, PACKAGE_ROOT, createConsumer, type Consumer } from "./fixtures/lib/consumer-project.js";

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

// A planning item with every planning artifact filled: with one missing the contract hash is null and a
// comparison of hashes proves nothing.
function writePlanningItem(root: string, folder = "demo_20261113_0000", stage = "planning"): string {
  const itemDir = join(root, ".works", stage, folder);
  mkdirSync(itemDir, { recursive: true });
  writeFileSync(
    join(itemDir, ".kfw.json"),
    JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "cli", created: folder.slice("demo_".length) }),
  );
  for (const id of ["spec-requirement", ...STAGE_GATES.planning] as const) {
    writeFileSync(join(itemDir, ARTIFACTS[id].file), `# ${id}\n\nFilled content for ${id}.\n`);
  }
  mkdirSync(join(itemDir, "use-cases"), { recursive: true });
  writeFileSync(join(itemDir, "use-cases", "UC-001-demo.md"), "# UC-001\n\nFilled use case.\n");
  return itemDir;
}

describe("item folder through the library", () => {
  let root: string;
  let itemDir: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "kfw-lib-root-")));
    itemDir = writePlanningItem(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists and finds the item from the root it is given, and reads its meta, stage records and contract hash", () => {
    const reference = executionContractHash(itemDir, "feature");
    expect(reference).toMatch(/^[0-9a-f]{64}$/);

    const out = consumer.runJson<{
      listed: { name: string; stage: string }[];
      found: { name: string; stage: string; folder: string } | null;
      metaFeature: string | undefined;
      records: unknown[];
      hash: string | null;
    }>(
      `import { executionContractHash, findFeature, listFeatures, readFeatureMeta, readStageRecords } from "${LIB}";
const [root, dir] = process.argv.slice(2);
const found = findFeature(root, "demo");
console.log(JSON.stringify({
  listed: listFeatures(root).map((f) => ({ name: f.name, stage: f.stage })),
  found: found && { name: found.name, stage: found.stage, folder: found.folder },
  metaFeature: readFeatureMeta(dir)?.feature,
  records: readStageRecords(found),
  hash: executionContractHash(dir, "feature"),
}));
`,
      [root, itemDir],
    );

    expect(out.listed).toEqual([{ name: "demo", stage: "planning" }]);
    expect(out.found).toEqual({ name: "demo", stage: "planning", folder: "demo_20261113_0000" });
    expect(out.metaFeature).toBe("demo");
    expect(out.records).toEqual([]);
    expect(out.hash).toBe(reference);
  });

  it("throws an AmbiguousFeatureError naming both folders when a short name matches two items", () => {
    writePlanningItem(root, "demo_20261114_0000", "brainstorm");

    const out = consumer.runJson<{ threw: boolean; isAmbiguous: boolean; message: string }>(
      `import { AmbiguousFeatureError, findFeature } from "${LIB}";
let result = { threw: false, isAmbiguous: false, message: "" };
try {
  findFeature(process.argv[2], "demo");
} catch (err) {
  result = { threw: true, isAmbiguous: err instanceof AmbiguousFeatureError, message: String(err && err.message) };
}
console.log(JSON.stringify(result));
`,
      [root],
    );

    expect(out.threw).toBe(true);
    expect(out.isAmbiguous).toBe(true);
    expect(out.message).toContain("demo_20261113_0000");
    expect(out.message).toContain("demo_20261114_0000");
  });
});

// The functions the library no longer exports: they ran git or read the host's config layers.
const REMOVED = ["computeStatus", "statusToJson", "computeBuckets", "dashboardData", "findWorksRoot"];

// One call per runtime export, on fixtures that make it meaningful. The probe refuses to run when its
// table and the library's exports differ, so an export added later without a call here fails the test.
const NO_GIT_PROBE = `import { readFileSync } from "node:fs";
import * as lib from "${LIB}";
const [ledgerPath, lifecyclePath, fixturesDir, root, planningDir, reviewDir, inputsJson] = process.argv.slice(2);
const text = readFileSync(ledgerPath, "utf8");
const inputs = JSON.parse(inputsJson);
const state = () => { const r = lib.readLedgerState(text); if (!r.ok) throw new Error("ledger refused"); return r.state; };
const calls = {
  readLedgerState: () => lib.readLedgerState(text).ok,
  parseLedger: () => lib.parseLedger(text).lines.length,
  loopStats: () => lib.loopStats(lib.parseLedger(text)).tasks,
  liveCap: () => lib.liveCap(state(), inputs).n,
  foldWorld: () => lib.foldWorld(state(), inputs, lib.liveCap(state(), inputs)).tasks.size,
  ITEM_LOG_FILE: () => lib.ITEM_LOG_FILE,
  foldItemLog: () => lib.foldItemLog(readFileSync(lifecyclePath, "utf8")).ok,
  readItemLog: () => lib.readItemLog(fixturesDir).ok,
  sharedMeta: () => lib.sharedMeta({ feature: "demo", context: "cli", worktree: { path: "/x", branch: "b" } }),
  listFeatures: () => lib.listFeatures(root).map((f) => f.name + "@" + f.stage).sort(),
  findFeature: () => [lib.findFeature(root, "demo")?.stage, lib.findFeature(root, "beta")?.stage],
  readFeatureMeta: () => [lib.readFeatureMeta(planningDir)?.feature, lib.readFeatureMeta(reviewDir)?.feature],
  readStageRecords: () => lib.listFeatures(root).map((f) => f.name + ":" + lib.readStageRecords(f).length).sort(),
  executionContractHash: () => [lib.executionContractHash(planningDir, "feature"), lib.executionContractHash(reviewDir, "feature")].map((h) => h === null ? null : "hash"),
  AmbiguousFeatureError: () => new lib.AmbiguousFeatureError("x") instanceof Error,
};
const table = Object.keys(calls).sort();
const exported = Object.keys(lib).sort();
if (JSON.stringify(table) !== JSON.stringify(exported)) {
  throw new Error("call table differs from the exports: missing " + exported.filter((k) => !table.includes(k)).join(",") + "; extra " + table.filter((k) => !exported.includes(k)).join(","));
}
const results = {};
for (const name of table) results[name] = calls[name]();
process.stdout.write(JSON.stringify({ table, exported, results }) + "\\n");
`;

describe("no git and no host config through the library", () => {
  let parent: string;
  let root: string;
  let planningDir: string;
  let reviewDir: string;
  let home: string;
  let marker: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    // A fresh parent, never the OS temp dir itself: a workspace file there would reach every other test.
    parent = realpathSync(mkdtempSync(join(tmpdir(), "kfw-lib-nogit-")));
    root = join(parent, "project");
    planningDir = writePlanningItem(root);

    // The review item names a worktree that is a real repository, so a reader that ran git would have one to run in.
    const worktree = join(parent, "wt");
    mkdirSync(worktree);
    const init = spawnSync("git", ["init", "-q", worktree], { encoding: "utf8" });
    expect(init.status, init.stderr).toBe(0);
    reviewDir = join(root, ".works", "review", "beta_20261113_0001");
    mkdirSync(join(reviewDir, "loop"), { recursive: true });
    writeFileSync(
      join(reviewDir, ".kfw.json"),
      JSON.stringify({
        schema: "kanban-flow", feature: "beta", context: "cli", created: "20261113_0001",
        worktree: { path: worktree, branch: "claude/beta", domain: "beta.localhost", port: 4101, createdAt: "2026-11-13T00:00:00Z" },
      }),
    );
    writeFileSync(
      join(reviewDir, "loop", "stage-verify.jsonl"),
      `${JSON.stringify({
        at: "2026-11-13T00:00:00Z", sha: "a".repeat(40), clean: true,
        commands: [{ argv: ["npm", "test"], outcome: "exit", code: 0 }], outputSha256: "b".repeat(64), exit: 0,
      })}\n`,
    );
    writeFileSync(join(reviewDir, "phase-4-testing-result.md"), "# Testing result\n\nAll checks passed.\n");

    // Each config layer holds a key that does not apply at it, so reading the layer prints a warning.
    home = join(parent, "home");
    mkdirSync(join(home, ".kf"), { recursive: true });
    writeFileSync(join(home, ".kf", "config.json"), JSON.stringify({ repository: "acme/global" }));
    mkdirSync(join(parent, ".kf"));
    writeFileSync(join(parent, ".kf", "workspace.json"), JSON.stringify({ worktree: { domains: true } }));

    // A git first on PATH that leaves a marker, so any git a reader spawned is seen.
    const bin = join(parent, "bin");
    mkdirSync(bin);
    marker = join(parent, "git-called");
    writeFileSync(join(bin, "git"), `#!/bin/sh\necho "$*" >> "${marker}"\nexit 0\n`);
    chmodSync(join(bin, "git"), 0o755);
    env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}:${process.env.PATH ?? ""}` };
  });

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it("calls every runtime export on both items, the ledger and the lifecycle log without running git or warning about config", () => {
    // Controls: the same environment does catch a spawned git and a read of the config layers.
    const gitControl = spawnSync("git", ["--version"], { env, encoding: "utf8" });
    expect(gitControl.status, gitControl.stderr).toBe(0);
    expect(existsSync(marker)).toBe(true);
    const configControl = spawnSync(process.execPath, [join(PACKAGE_ROOT, "dist", "index.js"), "config", "show"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    expect(configControl.stderr).toContain("not applied");
    rmSync(marker, { force: true });

    const inputs = {
      feature: "demo", kind: "feature", level: null,
      tasks: [{ id: "TASK-001", dependencies: [], files: ["src/a.ts"], wave: 1, overlaps: [], inline: false, testTypes: ["Unit"] }],
      ceiling: { max: 4, source: "default" }, reportCommits: {}, verifyRuns: {}, gitLog: [],
    };
    writeFileSync(join(consumer.dir, "no-git.mjs"), NO_GIT_PROBE);
    // Every path under a directory with its size and mtime, so a reader that wrote, touched or created anything is seen.
    // The probe reads both the project root and the fixture folder, so both are snapshotted.
    const snapshot = (dir: string): string[] =>
      (readdirSync(dir, { recursive: true }) as string[])
        .map((rel) => {
          const st = lstatSync(join(dir, rel));
          return `${rel} ${String(st.size)} ${String(st.mtimeMs)}`;
        })
        .sort();
    const before = snapshot(root);
    expect(before.length).toBeGreaterThan(0);
    const fixturesBefore = snapshot(FIXTURES);
    expect(fixturesBefore.length).toBeGreaterThan(0);
    const res = spawnSync(
      process.execPath,
      [join(consumer.dir, "no-git.mjs"), LEDGER, join(FIXTURES, "lifecycle.jsonl"), FIXTURES, root, planningDir, reviewDir, JSON.stringify(inputs)],
      { cwd: root, env, encoding: "utf8" },
    );

    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(snapshot(root)).toEqual(before);
    expect(snapshot(FIXTURES)).toEqual(fixturesBefore);
    const out = JSON.parse(res.stdout) as { table: string[]; exported: string[]; results: Record<string, unknown> };
    expect(out.table).toEqual(out.exported);
    expect(out.results.listFeatures).toEqual(["beta@review", "demo@planning"]);
    expect(out.results.readStageRecords).toEqual(["beta:1", "demo:0"]);
    for (const name of REMOVED) expect(out.exported, `${name} is still exported`).not.toContain(name);
  });
});
