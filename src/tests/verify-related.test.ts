import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import { relatedArgv, taskChangedFiles } from "../workflow/verify.js";
import type { ParsedArgs } from "../cli/args.js";

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
  /** Appended to by the pinned task and related scripts, one line per run, in run order. */
  calls: string;
  /** A node script appending `task` to `calls`. */
  taskScript: string;
  /** A node script appending `related <json argv>` to `calls`, exiting with the given code. */
  relatedScript: (exit?: number) => Promise<string>;
  configure: (verify: { task?: string[][]; related?: string[] }) => Promise<void>;
  commit: (files: Record<string, string>) => Promise<string>;
  remove: (...files: string[]) => string;
  head: () => string;
  verify: (options: Record<string, unknown>) => Promise<{ code: number; out: string }>;
  itemDir: () => string;
  callLines: () => string[];
}

async function scripts(scratch: string): Promise<Pick<Item, "calls" | "taskScript" | "relatedScript">> {
  const calls = join(scratch, "calls.log");
  const taskScript = join(scratch, "task.js");
  await writeFile(taskScript, `require("fs").appendFileSync(${JSON.stringify(calls)}, "task\\n");\n`);
  let n = 0;
  const relatedScript = async (exit = 0): Promise<string> => {
    const path = join(scratch, `related-${n++}.js`);
    await writeFile(path, `require("fs").appendFileSync(${JSON.stringify(calls)}, "related " + JSON.stringify(process.argv.slice(2)) + "\\n");\nprocess.exit(${exit});\n`);
    return path;
  };
  return { calls, taskScript, relatedScript };
}

async function baseRepo(): Promise<{ scratch: string; root: string }> {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-related-")));
  const root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  gitIn(root, "init", "-q");
  gitIn(root, "config", "user.email", "t@t");
  gitIn(root, "config", "user.name", "t");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-qm", "init");
  ensureWorksStructure(root);
  return { scratch, root };
}

/** A real item `f` approved through the real commands (or a bug `f` with a tasks.md); its TASK-001 owns `files`. */
async function makeItem(opts: { files: string; kind: "feature" | "bug" }): Promise<Item> {
  const { scratch, root } = await baseRepo();
  const worktree = opts.kind === "feature";
  const feature = () => findFeature(root, "f")!;
  const configPaths = (): string[] => {
    const wt = feature()?.meta?.worktree?.path;
    return [join(root, ".kf", "config.json"), ...(wt ? [join(wt, ".kf", "config.json")] : [])];
  };
  const configure: Item["configure"] = async (verify) => {
    for (const path of configPaths()) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify({
        schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
        worktree: { enabled: true, baseDir: join(scratch, "wt"), routesFile: join(scratch, "routes.json") },
        harness: {
          main: "lead",
          roles: { lead: { runner: "claude" } },
          runners: { claude: { start: ["claude", "{prompt}"] } },
          verify,
        },
      }));
    }
  };
  const must = (res: { code: number; stdout: string; stderr?: string }, what: string): void => {
    if (res.code !== 0) throw new Error(`${what} failed: ${res.stdout}${res.stderr ?? ""}`);
  };
  await mkdir(join(root, ".kf"), { recursive: true });
  await configure({});
  if (worktree) {
    const write = (id: keyof typeof ARTIFACTS, body: string) => writeFile(join(feature().dir, ARTIFACTS[id].file), body);
    must(await cmdNew(args("new", ["f"], { context: "app" }), root), "kf new");
    await write("spec-requirement", spec);
    must(await cmdStage(args("stage", ["f", "planning"]), root), "kf stage planning");
    await write("implementation-plan", `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n| TASK-001 | Do it | Core | - | Change merged | FR-001 / UC-001 | - | ${opts.files} |\n`);
    for (const id of ["use-case-specification", "use-case-diagram"] as const) await write(id, "# Contract\nUC-001: Create a task");
    await mkdir(join(feature().dir, "use-cases"), { recursive: true });
    await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
    await write("test-cases", "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
    must(await cmdApprove(args("approve", ["f"], {}), root), "kf approve");
  } else {
    must(await cmdNew(args("new", ["f"], { context: "app", type: "bug" }), root), "kf new bug");
    await writeFile(join(feature().dir, "tasks.md"), "# Tasks\n\n- [ ] 1. TASK-001: fix the crash\n");
  }
  const dir = feature().meta?.worktree?.path ?? root;
  if (worktree && dir === root) throw new Error("fixture: approve did not create an item worktree");
  await configure({});

  const commit = async (files: Record<string, string>): Promise<string> => {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(join(dir, file, ".."), { recursive: true });
      await writeFile(join(dir, file), content);
      gitIn(dir, "add", file);
    }
    gitIn(dir, "commit", "-qm", `touch ${Object.keys(files).join(" ")}`);
    return gitIn(dir, "rev-parse", "HEAD");
  };
  const s = await scripts(scratch);
  return {
    scratch, root, dir, ...s, configure, commit,
    remove: (...files) => {
      gitIn(dir, "rm", "-q", ...files);
      gitIn(dir, "commit", "-qm", `remove ${files.join(" ")}`);
      return gitIn(dir, "rev-parse", "HEAD");
    },
    head: () => gitIn(dir, "rev-parse", "HEAD"),
    verify: async (options) => {
      const res = await cmdVerify(args("verify", ["f"], { task: "TASK-001", ...options }), root);
      return { code: res.code, out: `${res.stdout}\n${res.stderr ?? ""}` };
    },
    itemDir: () => feature().dir,
    callLines: () => (existsSync(s.calls) ? readFileSync(s.calls, "utf8").split("\n").filter(Boolean) : []),
  };
}

let item: Item;
afterEach(async () => {
  if (item) await rm(item.scratch, { recursive: true, force: true });
});

const taskLog = (): string => {
  const loop = join(item.itemDir(), "loop");
  const logs = readdirSync(loop).filter((f) => f.endsWith("task-001-verify.log"));
  expect(logs).toHaveLength(1);
  return readFileSync(join(loop, logs[0]), "utf8");
};

describe("relatedArgv", () => {
  it("appends the files to the related argv in the given order", () => {
    expect(relatedArgv(["npx", "vitest", "related"], ["a.ts", "b.ts"])).toEqual(["npx", "vitest", "related", "a.ts", "b.ts"]);
  });

  it("keeps a file name with spaces and shell characters as one argv element", () => {
    expect(relatedArgv(["t"], ["a b.ts", "$(x).ts"])).toEqual(["t", "a b.ts", "$(x).ts"]);
  });
});

describe("taskChangedFiles", () => {
  beforeEach(async () => {
    item = await makeItem({ files: "-", kind: "feature" });
  });

  it("lists the union of the commits' files, repo-relative and sorted", async () => {
    const first = await item.commit({ "src/z.ts": "z", "b.ts": "b" });
    const second = await item.commit({ "a.ts": "a" });
    expect(taskChangedFiles(item.dir, { commits: [first, second] })).toEqual(["a.ts", "b.ts", "src/z.ts"]);
  });

  it("lists the files changed since the base, sorted", async () => {
    const base = item.head();
    await item.commit({ "b.ts": "b", "a.ts": "a" });
    expect(taskChangedFiles(item.dir, { base })).toEqual(["a.ts", "b.ts"]);
  });

  it("drops a deleted file", async () => {
    await item.commit({ "x.ts": "x", "keep.ts": "k" });
    const base = item.head();
    item.remove("x.ts");
    expect(taskChangedFiles(item.dir, { base })).toEqual([]);
    const del = item.head();
    expect(taskChangedFiles(item.dir, { commits: [del] })).toEqual([]);
  });

  it("gives a renamed file under its new path only", async () => {
    await item.commit({ "old.ts": "content that is long enough for git to detect a rename\n".repeat(5) });
    const base = item.head();
    gitIn(item.dir, "mv", "old.ts", "new.ts");
    gitIn(item.dir, "commit", "-qm", "rename");
    expect(taskChangedFiles(item.dir, { base })).toEqual(["new.ts"]);
    expect(taskChangedFiles(item.dir, { commits: [item.head()] })).toEqual(["new.ts"]);
  });
});

describe("kf verify --task with harness.verify.related", () => {
  let related: string;

  beforeEach(async () => {
    item = await makeItem({ files: "a.ts, b.ts", kind: "feature" });
    related = await item.relatedScript();
  });

  it("runs the task command, then the related argv with the changed files sorted, for --commits", async () => {
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const sha = await item.commit({ "b.ts": "b", "a.ts": "a" });

    const res = await item.verify({ commits: sha });

    expect(res.code, res.out).toBe(0);
    expect(item.callLines()).toEqual(["task", `related ${JSON.stringify(["a.ts", "b.ts"])}`]);
    expect(res.out).toContain(`Ran: node ${item.taskScript}`);
    expect(res.out).toContain(`Ran: node ${related} a.ts b.ts`);
    expect(res.out.indexOf(`Ran: node ${item.taskScript}`)).toBeLessThan(res.out.indexOf(`Ran: node ${related} a.ts b.ts`));
  });

  it("names every argv it ran in the task log", async () => {
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const sha = await item.commit({ "b.ts": "b", "a.ts": "a" });

    expect((await item.verify({ commits: sha })).code).toBe(0);

    const log = taskLog();
    expect(log).toContain(`Ran: node ${item.taskScript}`);
    expect(log).toContain(`Ran: node ${related} a.ts b.ts`);
  });

  it("runs related with the same sorted files for --base", async () => {
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const base = item.head();
    await item.commit({ "b.ts": "b", "a.ts": "a" });

    const res = await item.verify({ base });

    expect(res.code, res.out).toBe(0);
    expect(item.callLines()).toEqual(["task", `related ${JSON.stringify(["a.ts", "b.ts"])}`]);
  });

  it("still runs related when no task command is configured", async () => {
    await item.configure({ related: ["node", related] });
    const sha = await item.commit({ "a.ts": "a" });

    const res = await item.verify({ commits: sha });

    expect(res.code, res.out).toBe(0);
    expect(item.callLines()).toEqual([`related ${JSON.stringify(["a.ts"])}`]);
  });

  it("does not run related after a failing task command", async () => {
    await item.configure({ task: [["node", "-e", "process.exit(4)"]], related: ["node", related] });
    const sha = await item.commit({ "a.ts": "a" });

    const res = await item.verify({ commits: sha });

    expect(res.code).toBe(1);
    expect(item.callLines()).toEqual([]);
  });

  it("runs no related command and says the task changed no existing file when the only change is a deletion", async () => {
    await item.configure({});
    await item.commit({ "a.ts": "a", "b.ts": "b" });
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const sha = item.remove("a.ts");

    const res = await item.verify({ commits: sha });

    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain(`No related tests: the task changed no file that exists at ${sha.slice(0, 7)}.`);
    expect(item.callLines()).toEqual(["task"]);
  });

  it("hands related the new path of a renamed file, not the old one", async () => {
    await item.configure({});
    await item.commit({ "a.ts": "content that is long enough for git to detect a rename\n".repeat(5) });
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    gitIn(item.dir, "mv", "a.ts", "b.ts");
    gitIn(item.dir, "commit", "-qm", "rename a to b");

    const res = await item.verify({ commits: item.head() });

    expect(res.code, res.out).toBe(0);
    expect(item.callLines()).toEqual(["task", `related ${JSON.stringify(["b.ts"])}`]);
  });

  it("exits 1 naming the related argv when the related command fails", async () => {
    const failing = await item.relatedScript(1);
    await item.configure({ task: [["node", item.taskScript]], related: ["node", failing] });
    const sha = await item.commit({ "b.ts": "b", "a.ts": "a" });

    const res = await item.verify({ commits: sha });

    expect(res.code).toBe(1);
    expect(res.out).toContain(`node ${failing} a.ts b.ts`);
  });

  it("exits 2 and runs no command when a commit touches a file outside the task's files", async () => {
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const sha = await item.commit({ "a.ts": "a", "c.ts": "c" });

    const res = await item.verify({ commits: sha });

    expect(res.code).toBe(2);
    expect(res.out).toContain("c.ts");
    expect(item.callLines()).toEqual([]);
  });
});

describe("kf verify --task without harness.verify.related", () => {
  it("runs only the task commands", async () => {
    item = await makeItem({ files: "a.ts, b.ts", kind: "feature" });
    await item.configure({ task: [["node", item.taskScript]] });
    const sha = await item.commit({ "b.ts": "b", "a.ts": "a" });

    const res = await item.verify({ commits: sha });

    expect(res.code, res.out).toBe(0);
    expect(item.callLines()).toEqual(["task"]);
    expect(res.out).not.toContain("No related tests");
    expect(res.out).toContain("All 1 task verify command(s) passed.");
  });
});

describe("kf verify --task on a bug with harness.verify.related", () => {
  it("hands related the changed files without a Files check", async () => {
    item = await makeItem({ files: "-", kind: "bug" });
    const related = await item.relatedScript();
    await item.configure({ task: [["node", item.taskScript]], related: ["node", related] });
    const sha = await item.commit({ "c.ts": "c" });

    const res = await item.verify({ commits: sha });

    expect(res.code, res.out).toBe(0);
    expect(res.out).not.toContain("outside");
    expect(item.callLines()).toEqual(["task", `related ${JSON.stringify(["c.ts"])}`]);
  });
});
