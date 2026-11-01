import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../skills/kanban-implement/scripts/commit-task.mjs");

let repo: string;

const git = (...argv: string[]) => {
  const r = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

const run = (argv: string[]) => spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: repo, encoding: "utf8" });

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "kf-commit-task-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  for (const f of ["mine.txt", "other.txt", "outside.txt"]) await writeFile(join(repo, f), "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterEach(async () => { await rm(repo, { recursive: true, force: true }); });

describe("commit-task.mjs", () => {
  it("commits only the listed path and leaves another staged path staged", async () => {
    await writeFile(join(repo, "other.txt"), "changed\n");
    git("add", "other.txt");
    await writeFile(join(repo, "mine.txt"), "changed\n");

    const r = run(["-m", "msg", "--allow", "mine.txt", "--", "mine.txt"]);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain(git("rev-parse", "HEAD"));
    expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toBe("mine.txt");
    expect(git("diff", "--cached", "--name-only")).toBe("other.txt");
  });

  it("refuses a path outside the allowlist and changes nothing", async () => {
    await writeFile(join(repo, "outside.txt"), "changed\n");
    const headBefore = git("rev-parse", "HEAD");
    const cachedBefore = git("diff", "--cached");

    const r = run(["-m", "msg", "--allow", "src", "--", "outside.txt"]);

    expect(r.status).toBe(4);
    expect(r.stdout + r.stderr).toContain("BLOCKED: outside.txt is outside the allowlist");
    expect(git("rev-parse", "HEAD")).toBe(headBefore);
    expect(git("diff", "--cached")).toBe(cachedBefore);
  });

  it("reports a held index.lock after 4 attempts, keeps the lock and changes nothing", async () => {
    await writeFile(join(repo, "mine.txt"), "changed\n");
    const lock = join(repo, ".git", "index.lock");
    await writeFile(lock, "");
    const headBefore = git("rev-parse", "HEAD");

    const r = run(["-m", "msg", "--allow", "mine.txt", "--", "mine.txt"]);

    expect(r.status).toBe(5);
    expect(r.stderr.split("\n").filter((l) => /^attempt \d+:/.test(l))).toHaveLength(4);
    expect(r.stdout + r.stderr).toContain("BLOCKED: index.lock held");
    await expect(access(lock)).resolves.toBeUndefined();
    await rm(lock);
    expect(git("rev-parse", "HEAD")).toBe(headBefore);
    expect(git("diff", "--cached", "--name-only")).toBe("");
  }, 40_000);

  it("adds and commits a new file under a bare directory entry", async () => {
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "src", "new.ts"), "export {};\n");

    const r = run(["-m", "msg", "--allow", "src", "--", "src/new.ts"]);

    expect(r.status).toBe(0);
    expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toBe("src/new.ts");
  });

  it("forwards git's own diagnostic on stderr and its exit status when there is nothing to commit", () => {
    const headBefore = git("rev-parse", "HEAD");
    const direct = spawnSync("git", ["commit", "-m", "msg", "--", "mine.txt"], { cwd: repo, encoding: "utf8" });

    const r = run(["-m", "msg", "--allow", "mine.txt", "--", "mine.txt"]);

    expect(direct.status).not.toBe(0);
    expect(r.status).toBe(direct.status);
    expect(r.stderr).toMatch(/nothing to commit|no changes added/);
    expect(git("rev-parse", "HEAD")).toBe(headBefore);
  });

  it("prints usage on stderr and exits 2 when -m is missing", () => {
    const r = run(["--allow", "x", "--", "x"]);

    expect(r.status).toBe(2);
    expect(r.stderr.toLowerCase()).toContain("usage");
  });
});
