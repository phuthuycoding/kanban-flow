import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const KF = join(PKG_ROOT, "dist", "index.js");
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let scratch: string;
let root: string;
let marker: string;

const kf = (...argv: string[]): { code: number; out: string } => {
  const r = spawnSync(process.execPath, [KF, ...argv], { cwd: root, encoding: "utf8", env: process.env });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

const TASKS = [
  "# Tasks",
  "",
  "- [ ] 1. TASK-001: reproduce the crash",
  "- [ ] 2. TASK-002: regression test for the crash",
  "",
].join("\n");

async function configure(task: string[][]): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      verify: { task },
    },
  }));
}

beforeEach(async () => {
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-bugverify-")));
  root = join(scratch, "repo");
  marker = join(scratch, "marker");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  await configure([["sh", "-c", `touch ${marker}`]]);
  const created = await cmdNew({ command: "new", positionals: ["crash"], options: { context: "app", type: "bug" } } as ParsedArgs, root);
  if (created.code !== 0) throw new Error(`kf new failed: ${created.stdout}`);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const bugDir = (): string => findFeature(root, "crash")!.dir;

describe("kf verify --task on a bug", () => {
  it("accepts a task id from tasks.md with exit 0, no Files check, and runs the verify commands", async () => {
    await writeFile(join(bugDir(), "tasks.md"), TASKS);
    const base = gitIn(root, "rev-parse", "HEAD");
    await writeFile(join(root, "anything.ts"), "x");
    gitIn(root, "add", "anything.ts");
    gitIn(root, "commit", "-qm", "any file");

    const res = kf("verify", "crash", "--task", "TASK-002", "--base", base);

    expect(res.out).toContain("allowlist check skipped");
    expect(res.out).not.toContain("outside");
    expect(res.code).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it("exits 3 naming the unknown id and the item when the id is not in tasks.md", async () => {
    await writeFile(join(bugDir(), "tasks.md"), TASKS);
    const base = gitIn(root, "rev-parse", "HEAD");

    const res = kf("verify", "crash", "--task", "TASK-009", "--base", base);

    expect(res.code).toBe(3);
    expect(res.out).toContain("Unknown task 'TASK-009': it is not in tasks.md of 'crash'.");
    expect(existsSync(marker)).toBe(false);
  });

  it("exits 3 with the refusal naming the fix when tasks.md carries no TASK id", async () => {
    await writeFile(join(bugDir(), "tasks.md"), "# Tasks\n\n- [ ] reproduce\n- [ ] fix\n");
    const base = gitIn(root, "rev-parse", "HEAD");

    const res = kf("verify", "crash", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(3);
    expect(res.out).toContain("TASK-###");
    expect(existsSync(marker)).toBe(false);
  });

  it("exits 3 with the refusal when the bug has no tasks.md", async () => {
    const base = gitIn(root, "rev-parse", "HEAD");

    const res = kf("verify", "crash", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(3);
    expect(res.out).toContain("TASK-###");
    expect(existsSync(marker)).toBe(false);
  });

  it("exits 1 when a verify command fails for a known task", async () => {
    await writeFile(join(bugDir(), "tasks.md"), TASKS);
    await configure([["sh", "-c", "exit 7"]]);
    const base = gitIn(root, "rev-parse", "HEAD");

    const res = kf("verify", "crash", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(1);
    expect(res.out).toContain("exit 7");
  });
});
