import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { runVerify } from "../workflow/verify.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const KF = join(PKG_ROOT, "dist", "index.js");
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";
const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";

interface Item {
  scratch: string;
  root: string;
  /** Where the item's commits live: the item worktree, or the project root when the item has none. */
  dir: string;
  marker: string;
  /** Rewrite the project config with these `harness.verify` lists (and none when omitted). */
  configure: (verify?: { task?: string[][]; stage?: string[][] }) => Promise<void>;
  /** Commit the given files (path -> content) in `dir`. */
  commit: (files: Record<string, string>) => Promise<void>;
  head: () => string;
  /** Run the real built CLI from the project root. */
  kf: (...argv: string[]) => { code: number; out: string };
}

/** A real item `f` approved through the real commands; its single task TASK-001 owns `files` ("-" for none). */
async function makeItem(opts: { files: string; worktree: boolean }): Promise<Item> {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-vtest-")));
  const root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);

  const marker = join(scratch, "marker");
  const configPaths = (): string[] => {
    const wt = findFeature(root, "f")?.meta?.worktree?.path;
    return [join(root, ".kf", "config.json"), ...(wt ? [join(wt, ".kf", "config.json")] : [])];
  };
  const configure: Item["configure"] = async (verify) => {
    // The runner and role are the minimum the current harness validation demands next to `verify`.
    const harness = {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      ...(verify ? { verify } : {}),
    };
    for (const path of configPaths()) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify({
        schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
        worktree: { enabled: true, baseDir: join(scratch, "wt"), routesFile: join(scratch, "routes.json") },
        harness,
      }));
    }
  };
  await configure();

  const feature = () => findFeature(root, "f")!;
  const write = (id: keyof typeof ARTIFACTS, body: string) => writeFile(join(feature().dir, ARTIFACTS[id].file), body);
  const must = (res: { code: number; stdout: string; stderr?: string }, what: string): void => {
    if (res.code !== 0) throw new Error(`${what} failed: ${res.stdout}${res.stderr ?? ""}`);
  };
  must(await cmdNew(args("new", ["f"], { context: "app" }), root), "kf new");
  await write("spec-requirement", spec);
  must(await cmdStage(args("stage", ["f", "planning"]), root), "kf stage planning");
  await write("implementation-plan", `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do it | Core | - | Change merged | FR-001 / UC-001 | - | ${opts.files} |\n`);
  for (const id of ["use-case-specification", "use-case-diagram"] as const) await write(id, "# Contract\nUC-001: Create a task");
  await mkdir(join(feature().dir, "use-cases"), { recursive: true });
  await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await write("test-cases", "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
  must(await cmdApprove(args("approve", ["f"], opts.worktree ? {} : { backlog: true }), root), "kf approve");

  const dir = feature().meta?.worktree?.path ?? root;
  if (opts.worktree && dir === root) throw new Error("fixture: approve did not create an item worktree");
  if (!opts.worktree && dir !== root) throw new Error("fixture: a backlog item must have no worktree");
  await configure();

  return {
    scratch, root, dir, marker, configure,
    commit: async (files) => {
      for (const [file, content] of Object.entries(files)) {
        await mkdir(join(dir, file, ".."), { recursive: true });
        await writeFile(join(dir, file), content);
        gitIn(dir, "add", file);
      }
      gitIn(dir, "commit", "-qm", `touch ${Object.keys(files).join(" ")}`);
    },
    head: () => gitIn(dir, "rev-parse", "HEAD"),
    kf: (...argv) => {
      const r = spawnSync(process.execPath, [KF, ...argv], { cwd: root, encoding: "utf8", env: process.env });
      if (r.error) throw r.error;
      return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
    },
  };
}

/** A verify argv that leaves a file behind, to prove the command ran (or did not). */
const touch = (marker: string): string[] => ["sh", "-c", `touch ${marker}`];

let item: Item;
afterEach(async () => {
  if (item) await rm(item.scratch, { recursive: true, force: true });
});

describe("kf verify --task", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "src/a.ts", worktree: true });
  });

  it("exits 2 naming each file outside the task's files and runs no verify command", async () => {
    const base = item.head();
    await item.commit({ "src/a.ts": "a", "src/b.ts": "b" });
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(2);
    expect(res.out).toContain("src/b.ts");
    expect(res.out).not.toContain("src/a.ts");
    expect(existsSync(item.marker)).toBe(false);
  });

  it("exits 2 naming the old path when a file is renamed from outside the task's files into them", async () => {
    await item.commit({ "src/outside.ts": "moved" });
    const base = item.head();
    gitIn(item.dir, "mv", "src/outside.ts", "src/a.ts");
    gitIn(item.dir, "commit", "-qm", "rename into the allowlist");
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(2);
    expect(res.out).toContain("src/outside.ts");
    expect(existsSync(item.marker)).toBe(false);
  });

  it("exits 1 naming the first failing command and its exit code, then 0 once it is removed", async () => {
    const base = item.head();
    await item.commit({ "src/a.ts": "a" });
    await item.configure({ task: [["true"], ["false"]] });

    const failing = item.kf("verify", "f", "--task", "TASK-001", "--base", base);
    expect(failing.code).toBe(1);
    expect(failing.out).toContain("false");
    expect(failing.out).toContain("exit 1");

    await item.configure({ task: [["true"]] });
    expect(item.kf("verify", "f", "--task", "TASK-001", "--base", base).code).toBe(0);
  });

  it("stops at the first failing command", async () => {
    const base = item.head();
    await item.commit({ "src/a.ts": "a" });
    await item.configure({ task: [["false"], touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);
    expect(res.code).toBe(1);
    expect(res.out).toContain("exit 1");
    expect(existsSync(item.marker)).toBe(false);
  });

  it("runs the verify commands when HEAD equals the base", async () => {
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", "HEAD");

    expect(res.code).toBe(0);
    expect(existsSync(item.marker)).toBe(true);
  });

  describe("bad input exits 3 and runs nothing", () => {
    let base: string;
    beforeEach(async () => {
      base = item.head();
      await item.commit({ "src/a.ts": "a" });
      await item.configure({ task: [touch(item.marker)] });
    });

    it("for an unknown task id", () => {
      const res = item.kf("verify", "f", "--task", "TASK-999", "--base", base);
      expect(res.code).toBe(3);
      expect(res.out).toContain("TASK-999");
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a base that does not resolve", () => {
      const res = item.kf("verify", "f", "--task", "TASK-001", "--base", "nosuchref");
      expect(res.code).toBe(3);
      expect(res.out).toContain("nosuchref");
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a base that is not an ancestor of HEAD", () => {
      // A child of the base that HEAD does not contain.
      const sibling = gitIn(item.dir, "commit-tree", "HEAD^{tree}", "-p", base, "-m", "side");
      const res = item.kf("verify", "f", "--task", "TASK-001", "--base", sibling);
      expect(res.code).toBe(3);
      expect(res.out).toMatch(/ancestor/i);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a task without a base", () => {
      const res = item.kf("verify", "f", "--task", "TASK-001");
      expect(res.code).toBe(3);
      expect(res.out).toContain("--base");
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for neither --task nor --stage", () => {
      const res = item.kf("verify", "f");
      expect(res.code).toBe(3);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for both --task and --stage", () => {
      const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base, "--stage");
      expect(res.code).toBe(3);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for --base given without a value", () => {
      const res = item.kf("verify", "f", "--task", "TASK-001", "--base");
      expect(res.code).toBe(3);
      expect(res.out).toContain("--base");
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a project config that is not valid JSON", async () => {
      for (const dir of new Set([item.root, item.dir])) await writeFile(join(dir, ".kf", "config.json"), "{ not json");

      const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

      expect(res.code).toBe(3);
      expect(res.out).toMatch(/config/i);
      expect(existsSync(item.marker)).toBe(false);
    });
  });
});

describe("kf verify --task without a worktree", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "src/a.ts", worktree: false });
  });

  it("runs in the project root and reports that no task verify is configured", () => {
    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", "HEAD");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/project root/i);
    expect(res.out).toMatch(/not configured|none configured|no (task )?verify/i);
  });
});

describe("kf verify --task with non-ASCII and spaced paths", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "src/", worktree: true });
  });

  it("passes files inside the allowlist whose names are non-ASCII or contain a space", async () => {
    const base = item.head();
    await item.commit({ "src/ä.ts": "a", "src/with space.ts": "b" });
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(0);
    expect(existsSync(item.marker)).toBe(true);
  });

  it("prints the real, unquoted name of an outside file", async () => {
    const base = item.head();
    await item.commit({ "src/ok.ts": "a", "other/ü x.ts": "b" });
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(2);
    expect(res.out).toContain("other/ü x.ts");
    expect(res.out).not.toContain('"');
    expect(res.out).not.toContain("\\303");
    expect(existsSync(item.marker)).toBe(false);
  });
});

describe("kf verify --task with unknown files", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "-", worktree: true });
  });

  it("skips the allowlist check, says so, and still runs the verify commands", async () => {
    const base = item.head();
    await item.commit({ "anywhere/x.ts": "x" });
    await item.configure({ task: [touch(item.marker)] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/skipp/i);
    expect(existsSync(item.marker)).toBe(true);
  });
});

describe("kf verify --stage", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "src/a.ts", worktree: true });
  });

  it("exits 0 when every stage command passes", async () => {
    await item.configure({ stage: [["true"]] });
    expect(item.kf("verify", "f", "--stage").code).toBe(0);
  });

  it("exits 1 naming the failing command and its exit code", async () => {
    await item.configure({ stage: [["sh", "-c", "exit 4"]] });

    const res = item.kf("verify", "f", "--stage");

    expect(res.code).toBe(1);
    expect(res.out).toContain("sh -c exit 4");
    expect(res.out).toContain("exit 4");
  });

  it("exits 0 and says nothing is configured when there is no stage verify", async () => {
    await item.configure({ task: [["false"]] });

    const res = item.kf("verify", "f", "--stage");

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/not configured|none configured|no (stage )?verify/i);
  });
});

describe("runVerify", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = realpathSync(await mkdtemp(join(tmpdir(), "kf-runverify-")));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns null when every command passes", () => {
    expect(runVerify([["true"], ["true"]], cwd)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(runVerify([], cwd)).toBeNull();
  });

  it("names the first failing command and its exit code", () => {
    const failure = runVerify([["true"], ["sh", "-c", "exit 3"], ["false"]], cwd);
    expect(failure).toContain("sh -c exit 3");
    expect(failure).toContain("exit 3");
    expect(failure).not.toContain("false");
  });

  it("follows the failing command with the tail of its output", () => {
    const failure = runVerify([["sh", "-c", "echo broken-assertion; exit 2"]], cwd);
    expect(failure).toContain("exit 2");
    expect(failure).toContain("broken-assertion");
  });

  it("names a missing binary instead of a signal or exit code", () => {
    expect(runVerify([["kf-no-such-binary-xyz", "--flag"]], cwd)).toBe("verify command not found: kf-no-such-binary-xyz");
  });

  it("runs the commands in the given directory", async () => {
    expect(runVerify([["sh", "-c", "touch ran-here"]], cwd)).toBeNull();
    expect(existsSync(join(cwd, "ran-here"))).toBe(true);
  });
});

describe("kf verify when preparation fails unexpectedly", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "src/a.ts", worktree: true });
  });

  it("exits 3 saying kf verify could not run, and runs no verify command", async () => {
    const base = item.head();
    await item.configure({ task: [touch(item.marker)] });
    // A directory where the plan file belongs: it exists, but reading it throws.
    const plan = join(findFeature(item.root, "f")!.dir, ARTIFACTS["implementation-plan"].file);
    await rm(plan);
    await mkdir(plan);

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(3);
    expect(res.out).toContain("kf verify could not run:");
    // The failure keeps its cause and stack for diagnosis, not just a one-line message.
    expect(res.out).toContain("EISDIR");
    expect(res.out).toMatch(/\n\s+at /);
    expect(existsSync(item.marker)).toBe(false);
  });

  it("still exits 1, not 3, when a verify command fails", async () => {
    const base = item.head();
    await item.commit({ "src/a.ts": "a" });
    await item.configure({ task: [["false"]] });

    const res = item.kf("verify", "f", "--task", "TASK-001", "--base", base);

    expect(res.code).toBe(1);
    expect(res.out).not.toContain("kf verify could not run:");
  });
});

describe("kf verify --task --commits", () => {
  /** A per-test tmp dir the CLI is pointed at, so "nothing left behind" is an exact check. */
  let tmp: string;
  let c0: string;
  let c2: string;
  let c1: string;

  const kfTmp = (tmpDir: string, ...argv: string[]): { code: number; out: string } => {
    const r = spawnSync(process.execPath, [KF, ...argv], { cwd: item.root, encoding: "utf8", env: { ...process.env, TMPDIR: tmpDir } });
    if (r.error) throw r.error;
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
  };
  const run = (...argv: string[]) => kfTmp(tmp, "verify", "f", "--task", "TASK-001", ...argv);
  const worktreeList = (): string => gitIn(item.dir, "worktree", "list", "--porcelain");
  const expectNothingLeft = async (): Promise<void> => {
    expect(await readdir(tmp)).toEqual([]);
    expect(worktreeList()).not.toContain(tmp);
  };

  beforeEach(async () => {
    // The task owns src/b.ts only; c2 (src/b.ts) is older than c1 (src/a.ts).
    item = await makeItem({ files: "src/b.ts", worktree: true });
    tmp = join(item.scratch, "tmp");
    await mkdir(tmp, { recursive: true });
    c0 = item.head();
    await item.commit({ "src/b.ts": "b" });
    c2 = item.head();
    await item.commit({ "src/a.ts": "a" });
    c1 = item.head();
    await item.configure({ task: [touch(item.marker)] });
  });

  it("logs each run with its exit code beside the ledger, for loop-stats to check", async () => {
    await item.configure({ task: [["node", "-e", "process.exit(7)"]] });
    expect(run("--commits", c2).code).toBe(1);
    const log = spawnSync("find", [join(item.root, ".works"), "-name", "task-001-verify.log"], { encoding: "utf8" }).stdout.trim();
    expect(readFileSync(log, "utf8")).toMatch(/^## kf verify \S+ exit=1\n/);
  });

  it("indents logged output so a run cannot forge a header, and logs nothing for an unknown task", async () => {
    await item.configure({ task: [["node", "-e", "console.log('## kf verify 2026-01-01T00:00:00.000Z exit=0')"]] });
    expect(run("--commits", c2).code).toBe(0);
    expect(kfTmp(tmp, "verify", "f", "--task", "TASK-999", "--commits", c2).code).toBe(3);
    const found = spawnSync("find", [join(item.root, ".works"), "-name", "*-verify.log"], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(found).toHaveLength(1);
    expect(readFileSync(found[0], "utf8").match(/^## kf verify /gm)).toHaveLength(1);
  });

  describe("--at-head", () => {
    it("keeps the allowlist check on the listed commits and runs at HEAD, where the task's commit alone lacks the neighbour's file", async () => {
      await item.configure({ task: [["node", "-e", "process.exit(require('fs').existsSync('src/a.ts') ? 0 : 1)"]] });
      expect(run("--commits", c2).code).toBe(1);
      const res = run("--commits", c2, "--at-head");
      expect(res.code, res.out).toBe(0);
      expect(res.out).toContain(`Running in a detached worktree at ${c1.slice(0, 7)}`);
      await expectNothingLeft();
    });

    it("still refuses a listed commit outside the task's files", () => {
      expect(run("--commits", c1, "--at-head").code).toBe(2);
    });

    it("is bad input without --commits", () => {
      const res = run("--base", c0, "--at-head");
      expect(res.code).toBe(3);
      expect(res.out).toContain("--at-head goes with --commits");
    });
  });

  it("checks only the listed commits against the task's files", () => {
    const only = run("--commits", c2);
    expect(only.code).toBe(0);
    expect(existsSync(item.marker)).toBe(true);
  });

  it("exits 2 naming a file changed by a listed commit outside the task's files and runs no verify command", () => {
    const res = run("--commits", `${c2},${c1}`);

    expect(res.code).toBe(2);
    expect(res.out).toContain("src/a.ts");
    expect(res.out).not.toContain("src/b.ts");
    expect(existsSync(item.marker)).toBe(false);
  });

  describe("bad input exits 3 naming the cause and runs nothing", () => {
    const cases: Array<[string, () => string[], RegExp]> = [
      ["--commits together with --base", () => ["--commits", c2, "--base", c0], /not both/i],
      ["an empty list", () => ["--commits", ""], /empty/i],
      ["an empty element", () => ["--commits", `${c2},`], /empty/i],
      ["a sha that does not resolve", () => ["--commits", "nope"], /nope.*does not resolve to a commit/i],
      ["a list not in history order", () => ["--commits", `${c1},${c2}`], /not in history order/i],
      ["the same commit twice", () => ["--commits", `${c2},${c2}`], /twice/i],
      ["--commits together with --stage", () => ["--commits", c2, "--stage"], /--commits goes with --task, not --stage/i],
    ];
    it.each(cases)("for %s", (_name, argv, cause) => {
      const res = run(...argv());
      expect(res.code).toBe(3);
      expect(res.out).toMatch(cause);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a merge commit", () => {
      const side = gitIn(item.dir, "commit-tree", `${c0}^{tree}`, "-p", c0, "-m", "side");
      const merge = gitIn(item.dir, "commit-tree", "HEAD^{tree}", "-p", "HEAD", "-p", side, "-m", "merge");
      gitIn(item.dir, "reset", "-q", "--hard", merge);

      const res = run("--commits", merge);

      expect(res.code).toBe(3);
      expect(res.out).toMatch(/is a merge commit/i);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a commit on another branch", () => {
      const other = gitIn(item.dir, "commit-tree", `${c0}^{tree}`, "-p", c0, "-m", "other branch");

      const res = run("--commits", other);

      expect(res.code).toBe(3);
      expect(res.out).toMatch(/is not an ancestor of HEAD/i);
      expect(existsSync(item.marker)).toBe(false);
    });

    it("for a task with neither --base nor --commits, naming both options", () => {
      const res = run();
      expect(res.code).toBe(3);
      expect(res.out).toContain("--base");
      expect(res.out).toContain("--commits");
      expect(existsSync(item.marker)).toBe(false);
    });
  });

  it("runs the verify commands in a clean checkout of the newest commit, not in the item worktree, and --base still runs in the item worktree", async () => {
    // c is the task's own green commit at HEAD, so the --base range holds only files inside the task's files.
    await item.commit({ "src/b.ts": "b again" });
    const c = item.head();
    await writeFile(join(item.dir, "t.fail"), "uncommitted");
    await item.configure({ task: [["node", "-e", "process.exit(require('fs').existsSync('t.fail')?1:0)"]] });

    expect(run("--commits", c).code).toBe(0);
    expect(run("--base", `${c}^`).code).toBe(1);
  });

  describe("removes the detached worktree on every exit path", () => {
    it.each([
      ["a passing command", [["true"]], 0],
      ["a failing command", [["false"]], 1],
      ["a command that is not found", [["kf-no-such-binary-xyz"]], 1],
    ] as Array<[string, string[][], number]>)("after %s", async (_name, task, code) => {
      await item.configure({ task });

      const res = run("--commits", c2);

      expect(res.code).toBe(code);
      await expectNothingLeft();
    });
  });

  it("exits 3 saying kf verify could not run and runs no command when the temp dir cannot be created", async () => {
    const missing = join(item.scratch, "no-such-tmp");

    const res = kfTmp(missing, "verify", "f", "--task", "TASK-001", "--commits", c2);

    expect(res.code).toBe(3);
    expect(res.out).toContain("kf verify could not run:");
    expect(existsSync(item.marker)).toBe(false);
    expect(worktreeList()).not.toContain(missing);
    expect(existsSync(missing)).toBe(false);
  });

  it("exits 3 saying kf verify could not run, runs no command and removes the worktree and temp dir when a step after the worktree is added fails", async () => {
    // The newest commit tracks node_modules, so the checkout already has one and linking the item's node_modules there fails.
    await item.commit({ "src/b.ts": "b2" });
    await mkdir(join(item.dir, "node_modules"), { recursive: true });
    await writeFile(join(item.dir, "node_modules", "tracked.js"), "x");
    gitIn(item.dir, "add", "-f", "node_modules/tracked.js");
    gitIn(item.dir, "commit", "-qm", "track node_modules");
    const tracked = item.head();
    await item.configure({ task: [touch(item.marker)] });
    // Unknown files skip the allowlist check, so the failure under test is the one after the worktree is added.
    const plan = join(findFeature(item.root, "f")!.dir, ARTIFACTS["implementation-plan"].file);
    await writeFile(plan, readFileSync(plan, "utf8").replace("| src/b.ts |", "| - |"));

    const res = run("--commits", `${c2},${tracked}`);

    expect(res.code).toBe(3);
    expect(res.out).toContain("kf verify could not run:");
    expect(existsSync(item.marker)).toBe(false);
    await expectNothingLeft();
    expect(existsSync(join(item.dir, "node_modules", "tracked.js"))).toBe(true);
  });

  describe("node_modules", () => {
    beforeEach(async () => {
      await mkdir(join(item.dir, "node_modules", "dep"), { recursive: true });
      await writeFile(join(item.dir, "node_modules", "dep", "index.js"), "module.exports = 1;");
      await item.configure({ task: [["node", "-e", "require('dep')"]] });
    });

    it("links the item's node_modules into the detached worktree and leaves it intact afterwards", async () => {
      const res = run("--commits", c2);

      expect(res.code).toBe(0);
      expect(existsSync(join(item.dir, "node_modules", "dep", "index.js"))).toBe(true);
      await expectNothingLeft();
    });

    it("makes no link when the item has no node_modules, and reports the command's own result", async () => {
      await rm(join(item.dir, "node_modules"), { recursive: true });

      expect(run("--commits", c2).code).toBe(1);

      await item.configure({ task: [["node", "-e", "process.exit(require('fs').existsSync('node_modules')?1:0)"]] });
      expect(run("--commits", c2).code).toBe(0);
    });
  });
});

describe("kf verify --commits documentation", () => {
  const LINE = "--commits <sha>[,<sha>\u2026]";

  it("names --commits in the usage printed by kf verify", async () => {
    item = await makeItem({ files: "src/a.ts", worktree: true });
    const res = item.kf("verify");
    expect(res.out).toContain(LINE);
  });

  it("names --commits in kf -h while keeping the verify line", async () => {
    item = await makeItem({ files: "src/a.ts", worktree: true });
    const res = item.kf("-h");
    expect(res.out).toContain(LINE);
    expect(res.out).toMatch(/^\s+verify\s+Usage: kf verify/m);
  });
});

describe("this repository's verify configuration", () => {
  it("runs typecheck then the test suite for a task", () => {
    const config = JSON.parse(readFileSync(join(PKG_ROOT, ".kf", "config.json"), "utf8"));
    expect(config.harness.verify.task).toEqual([["npm", "run", "typecheck"], ["npm", "test"]]);
  });
});
