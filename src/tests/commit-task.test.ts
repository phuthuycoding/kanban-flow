import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, access, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathAllowed } from "../workflow/allowlist.js";

const SCRIPT = resolve(__dirname, "../../skills/kanban-implement/scripts/commit-task.mjs");

let repo: string;

const git = (...argv: string[]) => {
  const r = spawnSync("git", argv, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

const run = (argv: string[], script = SCRIPT) => spawnSync(process.execPath, [script, ...argv], { cwd: repo, encoding: "utf8" });

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

  it("works from a copied skill install with no dist above it", async () => {
    const install = await mkdtemp(join(tmpdir(), "kf-skill-copy-"));
    try {
      const dir = join(install, ".claude", "skills", "kanban-implement", "scripts");
      await mkdir(dir, { recursive: true });
      const copy = join(dir, "commit-task.mjs");
      await copyFile(SCRIPT, copy);
      await writeFile(join(repo, "mine.txt"), "changed\n");

      const r = run(["-m", "msg", "--allow", "mine.txt", "--", "mine.txt"], copy);

      expect(r.stderr).not.toContain("allowlist.js");
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(git("rev-parse", "HEAD"));
      expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toBe("mine.txt");
    } finally {
      await rm(install, { recursive: true, force: true });
    }
  });

  describe("allowlist decision matches the shared matcher", () => {
    const cases: Array<[string, string, string[]]> = [
      ["exact file match", "src/a.ts", ["src/a.ts"]],
      ["exact file not listed", "src/b.ts", ["src/a.ts"]],
      ["directory entry without trailing slash", "src/a/x.ts", ["src/a"]],
      ["directory entry with trailing slash", "src/a/x.ts", ["src/a/"]],
      ["sibling prefix is not inside the directory", "src/ab", ["src/a"]],
      ["sibling prefix file under it is not inside", "src/ab/x.ts", ["src/a/"]],
      ["single star stays in one segment", "src/x/a.ts", ["src/*.ts"]],
      ["single star matches within a segment", "src/a.ts", ["src/*.ts"]],
      ["double star crosses segments", "src/x/y/a.ts", ["src/**/*.ts"]],
      ["double star with a different extension", "src/x/a.md", ["src/**/*.ts"]],
      ["question mark matches one character", "src/a1.ts", ["src/a?.ts"]],
      ["glob matching a parent directory allows its children", "src/a/deep/x.ts", ["src/*"]],
      ["second entry matches", "docs/x.md", ["src/a", "docs"]],
      ["backtick-wrapped entry", "src/a.ts", ["`src/a.ts`"]],
      ["backtick-wrapped entry that does not match", "src/b.ts", ["`src/a.ts`"]],
      ["dot-slash prefixed entry", "src/a.ts", ["./src/a.ts"]],
      ["dot-slash prefixed entry that does not match", "src/b.ts", ["./src/a.ts"]],
      ["double star alone", "src/x/y/a.ts", ["**"]],
      ["single dot", "src/a.ts", ["."]],
    ];

    for (const [name, path, allow] of cases) {
      it(name, () => {
        const r = run(["-m", "msg", ...allow.flatMap((a) => ["--allow", a]), "--", path]);

        expect(r.status === 4).toBe(!pathAllowed(path, allow));
      });
    }
  });

  describe("refuses paths that escape or confuse the allowlist", () => {
    const cases: Array<[string, string[], string]> = [
      ["a dot-dot traversal out of the allowed directory", ["--allow", "src/a", "--", "src/a/../../other.txt"], "src/a/../../other.txt"],
      ["an absolute path", ["--allow", ".", "--", "/etc/hosts"], "/etc/hosts"],
      ["a path starting with a colon", ["--allow", ".", "--", ":/other.txt"], ":/other.txt"],
      ["an empty allow entry", ["--allow", "", "--", "other.txt"], "other.txt"],
    ];

    for (const [name, argv, path] of cases) {
      it(`blocks ${name} without committing`, async () => {
        await writeFile(join(repo, "other.txt"), "changed\n");
        const headBefore = git("rev-parse", "HEAD");

        const r = run(["-m", "msg", ...argv]);

        expect(r.status).toBe(4);
        expect(r.stderr).toContain("BLOCKED");
        expect(r.stderr).toContain(path);
        expect(git("rev-parse", "HEAD")).toBe(headBefore);
        expect(git("rev-list", "--count", "HEAD")).toBe("1");
        expect(git("diff", "--cached", "--name-only")).toBe("");
      });
    }
  });

  describe("refuses further escaping paths and degenerate allow entries", () => {
    const pathCases: Array<[string, string]> = [
      ["a dot-slash path that climbs out", "./../x"],
      ["a path ending in a parent segment", "src/a/.."],
      ["a path containing a backslash", "src\\..\\x"],
      ["a path with a glob pathspec magic prefix", ":(glob)*"],
    ];

    for (const [name, path] of pathCases) {
      it(`blocks ${name} without committing`, async () => {
        await writeFile(join(repo, "other.txt"), "changed\n");
        const headBefore = git("rev-parse", "HEAD");

        const r = run(["-m", "msg", "--allow", ".", "--", path]);

        expect(r.status).toBe(4);
        expect(r.stderr).toContain("BLOCKED");
        expect(git("rev-parse", "HEAD")).toBe(headBefore);
        expect(git("rev-list", "--count", "HEAD")).toBe("1");
        expect(git("diff", "--cached", "--name-only")).toBe("");
      });
    }

    const allowCases: Array<[string, string]> = [
      ["a whitespace-only allow entry", " "],
      ["a backtick-only allow entry", "`"],
      ["a dot-slash-only allow entry", "./"],
    ];

    for (const [name, allow] of allowCases) {
      it(`blocks ${name} as an empty allow without committing`, async () => {
        await writeFile(join(repo, "other.txt"), "changed\n");
        const headBefore = git("rev-parse", "HEAD");

        const r = run(["-m", "msg", "--allow", allow, "--", "other.txt"]);

        expect(r.status).toBe(4);
        expect(r.stderr).toContain("BLOCKED");
        expect(git("rev-parse", "HEAD")).toBe(headBefore);
        expect(git("rev-list", "--count", "HEAD")).toBe("1");
        expect(git("diff", "--cached", "--name-only")).toBe("");
      });
    }

    for (const allow of [".", "**"]) {
      it(`still allows everything with the entry ${allow} and commits`, async () => {
        await writeFile(join(repo, "other.txt"), "changed\n");

        const r = run(["-m", "msg", "--allow", allow, "--", "other.txt"]);

        expect(r.status).toBe(0);
        expect(git("rev-list", "--count", "HEAD")).toBe("2");
        expect(git("show", "--name-only", "--pretty=format:", "HEAD")).toBe("other.txt");
      });
    }
  });
});
