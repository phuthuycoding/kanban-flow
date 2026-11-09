import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdVerify } from "../cli/commands/verify.js";
import { commandHelp, parseArgsCli } from "../cli/args.js";
import type { ParsedArgs } from "../cli/args.js";

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

let scratch: string;
let root: string;

const metaPath = (): string => join(findFeature(root, "f")!.dir, ".kfw.json");
const rawMeta = (): string => readFileSync(metaPath(), "utf8");
const waiver = (): Record<string, unknown> | undefined => (JSON.parse(rawMeta()) as { verifyWaiver?: Record<string, unknown> }).verifyWaiver;

async function configure(stage?: string[][]): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...(stage ? { verify: { stage } } : {}),
    },
  }));
}

/** Parse like the real CLI so the option registration is part of what is proved. */
const verify = (...argv: string[]) => cmdVerify(parseArgsCli(["verify", "f", ...argv]), root);
/** Hand-built options reach the command's own refusals, whatever the parser accepts. */
const verifyOpts = (options: Record<string, unknown>) => cmdVerify(args("verify", ["f"], options), root);

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-waive-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "Rita Reviewer");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  const made = await cmdNew(args("new", ["f"], { context: "app" }), root);
  if (made.code !== 0) throw new Error(`kf new failed: ${made.stdout}`);
  await configure();
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("kf verify --stage --waive", () => {
  it("records the reason, an ISO time and the configured reviewer in .kfw.json", async () => {
    const res = await verify("--stage", "--waive", "no runner in CI");

    expect(res.code).toBe(0);
    const w = waiver();
    expect(w?.reason).toBe("no runner in CI");
    expect(w?.by).toBe("Rita Reviewer");
    expect(new Date(String(w?.at)).toISOString()).toBe(w?.at);
  });

  it("replaces the first waiver with the second", async () => {
    expect((await verify("--stage", "--waive", "a")).code).toBe(0);
    expect((await verify("--stage", "--waive", "b")).code).toBe(0);

    expect(waiver()?.reason).toBe("b");
  });

  it("accepts a waiver when harness.verify.stage is configured but empty", async () => {
    await configure([]);

    expect((await verify("--stage", "--waive", "nothing to run")).code).toBe(0);
    expect(waiver()?.reason).toBe("nothing to run");
  });

  it("refuses a blank reason with exit 3 and leaves .kfw.json unchanged", async () => {
    const before = rawMeta();

    const res = await verifyOpts({ stage: true, waive: "  " });

    expect(res.code).toBe(3);
    expect(rawMeta()).toBe(before);
  });

  it("refuses an empty reason with exit 3 and leaves .kfw.json unchanged", async () => {
    const before = rawMeta();

    const res = await verifyOpts({ stage: true, waive: "" });

    expect(res.code).toBe(3);
    expect(rawMeta()).toBe(before);
  });

  it("refuses --waive without --stage with exit 3 and leaves .kfw.json unchanged", async () => {
    const before = rawMeta();

    const res = await verifyOpts({ waive: "x" });

    expect(res.code).toBe(3);
    expect(res.stdout).toContain("--waive");
    expect(rawMeta()).toBe(before);
  });

  it("refuses a waiver when stage commands are configured, runs nothing and writes no record", async () => {
    const marker = join(scratch, "marker");
    await configure([["sh", "-c", `touch ${marker}`]]);
    const before = rawMeta();

    const res = await verifyOpts({ stage: true, waive: "x" });

    expect(res.code).toBe(3);
    expect(rawMeta()).toBe(before);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(findFeature(root, "f")!.dir, "loop", "stage-verify.jsonl"))).toBe(false);
  });
});

describe("--waive is documented", () => {
  it("kf verify -h names --waive", () => {
    expect(commandHelp("verify")).toContain("--waive");
  });

  it("the usage line of a refusal names --waive", async () => {
    const res = await verifyOpts({ stage: true, waive: " " });
    expect(res.code).toBe(3);
    expect(res.stdout).toContain("--waive");
  });
});
