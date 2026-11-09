import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commandHelp, parseArgsCli } from "../cli/args.js";
import { cmdRecord } from "../cli/commands/record.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import { readLedgerState } from "../workflow/next/ledger-state.js";

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

let root: string;
let ledger: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-record-waves-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261108_1000", defaultContext: "app" }));
  const itemDir = join(root, ".works", "implementation", "demo_20261108_1000");
  await mkdir(itemDir, { recursive: true });
  await writeFile(join(itemDir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "app", created: "20261108_1000" }));
  await writeFile(
    join(itemDir, ARTIFACTS["implementation-plan"].file),
    `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do it | Core | - | Done | FR-001 / UC-001 | coder | src/a.ts |\n`,
  );
  ledger = join(itemDir, "loop", "progress.md");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const kf = (...argv: string[]) => cmdRecord(parseArgsCli(["record", "demo", ...argv]), root);
const content = (): string => (existsSync(ledger) ? readFileSync(ledger, "utf8") : "");
const bodies = (): string[] => content().split("\n").filter((l) => /^wave |^Note /.test(l)).map((l) => l.replace(/ @ \S+$/, ""));

describe("kf record wave events", () => {
  it("writes a wave verify start and a wave verify done as ledger lines", async () => {
    expect((await kf("wave-verify-started", "1")).code).toBe(0);
    expect((await kf("wave-verify-done", "1", "--exit", "0")).code).toBe(0);
    expect(bodies()).toEqual(["wave 1: verify started", "wave 1: verify done exit=0"]);
  });

  it("writes the reopen and decision notes through the line event", async () => {
    expect((await kf("line", "--", "Note TASK-001: reopened — wave 1")).code).toBe(0);
    expect((await kf("line", "--", "Note wave 1: decided — flaky")).code).toBe(0);
    expect(bodies()).toEqual(["Note TASK-001: reopened — wave 1", "Note wave 1: decided — flaky"]);
  });

  it("produces a ledger the reader parses into typed wave events with no other", async () => {
    await kf("wave-verify-started", "1");
    await kf("wave-verify-done", "1", "--exit", "0");
    await kf("line", "--", "Note TASK-001: reopened — wave 1");
    await kf("line", "--", "Note wave 1: decided — flaky");
    const read = readLedgerState(content());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.state.events.map((e) => e.type)).toEqual(["waveVerifyStarted", "waveVerifyDone", "reopened", "waveDecided"]);
  });

  it("accepts a second start while one is open and writes it", async () => {
    await kf("wave-verify-started", "1");
    const second = await kf("wave-verify-started", "1");
    expect(second.code).toBe(0);
    expect(bodies()).toEqual(["wave 1: verify started", "wave 1: verify started"]);
  });

  it("refuses a done with no open start, exit 1, file unchanged", async () => {
    expect((await kf("wave-verify-started", "1")).code).toBe(0);
    expect((await kf("wave-verify-done", "1", "--exit", "0")).code).toBe(0);
    const before = content();
    const res = await kf("wave-verify-done", "1", "--exit", "0");
    expect(res.code).toBe(1);
    expect(content()).toBe(before);
  });

  it("refuses a done for a wave that has no open start while another wave has one", async () => {
    expect((await kf("wave-verify-started", "1")).code).toBe(0);
    const before = content();
    const res = await kf("wave-verify-done", "2", "--exit", "0");
    expect(res.code).toBe(1);
    expect(content()).toBe(before);
  });

  it("refuses a non-integer wave as bad input, file unchanged", async () => {
    expect((await kf("wave-verify-started", "1")).code).toBe(0);
    const before = content();
    expect((await kf("wave-verify-started", "x")).code).toBe(3);
    expect((await kf("wave-verify-started", "0")).code).toBe(3);
    expect(content()).toBe(before);
  });

  it("refuses free text shaped like a wave verify line, exit 1, file unchanged", async () => {
    expect((await kf("wave-verify-started", "1")).code).toBe(0);
    const before = content();
    const res = await kf("line", "--", "wave 1: verify done exit=0");
    expect(res.code).toBe(1);
    expect((await kf("line", "--", "wave 1: verify started")).code).toBe(1);
    expect(content()).toBe(before);
  });

  it("names the wave events in the usage and the help", () => {
    const help = commandHelp("record");
    expect(help).toContain("wave-verify-started");
    expect(help).toContain("wave-verify-done");
  });
});
