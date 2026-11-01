import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
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
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-verify-")));
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
