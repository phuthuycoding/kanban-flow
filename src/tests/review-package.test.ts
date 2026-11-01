import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../../skills/kanban-review/scripts/review-package");
const baseScript = resolve(here, "fixtures/review-package/review-package.base");

let scratch: string;
let repo: string;
let home: string;

const gitEnv = () => ({
  ...process.env,
  HOME: home,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
});

function git(...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: gitEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function run(scriptPath: string, args: string[]) {
  const r = spawnSync("bash", [scriptPath, ...args], { cwd: repo, encoding: "utf8", env: gitEnv() });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function commitFile(rel: string, body: string, msg: string): string {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
}

const short = (sha: string) => git("rev-parse", "--short=7", sha);

let root: string;
let a: string;
let m: string;
let b: string;
let out: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-review-package-"));
  repo = join(scratch, "repo");
  home = join(scratch, "home");
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  out = join(scratch, "out", "pkg.diff");
  git("init", "-q", "-b", "main");
  root = commitFile("seed.txt", "seed\n", "seed");
  a = commitFile("src/a-file.txt", "alpha\n", "add a");
  m = commitFile("other/m-file.txt", "middle\n", "add m");
  b = commitFile("src/b-file.txt", "bravo\n", "add b");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("review-package --commits", () => {
  it("packages exactly the listed commits and leaves out the commit between them", () => {
    const r = run(script, ["--commits", `${a},${b}`, out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^wrote .*pkg\.diff: 2 commit\(s\), 0 untracked file\(s\) \(0 skipped\), \d+ bytes\n$/);
    const text = readFileSync(out, "utf8");
    expect(text.split("\n")[0]).toBe(`# Review package: commits ${short(a)},${short(b)}`);
    expect(text).toContain("## Commits");
    expect(text).toContain("add a");
    expect(text).toContain("add b");
    expect(text).toContain("alpha");
    expect(text).toContain("bravo");
    expect(text).not.toContain("m-file.txt");
    expect(text).not.toContain("middle");
    expect(text).not.toContain("add m");
  });

  it("lists the union of changed files sorted and diffs commits in the given order", () => {
    const r = run(script, ["--commits", `${b},${a}`, out]);
    expect(r.status).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text.split("\n")[0]).toBe(`# Review package: commits ${short(b)},${short(a)}`);
    const files = text.slice(text.indexOf("## Files changed"), text.indexOf("## Diff"));
    expect(files).toBe("## Files changed\nsrc/a-file.txt\nsrc/b-file.txt\n\n");
    const diff = text.slice(text.indexOf("## Diff"));
    expect(diff.indexOf("bravo")).toBeGreaterThan(-1);
    expect(diff.indexOf("bravo")).toBeLessThan(diff.indexOf("alpha"));
  });

  it("limits the package to the pathspec after --", () => {
    const r = run(script, ["--commits", `${a},${m}`, out, "--", "other/"]);
    expect(r.status).toBe(0);
    const text = readFileSync(out, "utf8");
    expect(text).toContain("Pathspec: other/");
    expect(text).toContain("middle");
    expect(text).not.toContain("alpha");
  });

  it("exits 2 on a sha that is not a commit", () => {
    const r = run(script, ["--commits", "deadbeef", out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad commit: deadbeef");
    expect(existsSync(out)).toBe(false);
  });

  it("exits 2 on a merge commit", () => {
    git("checkout", "-q", "-b", "side", a);
    commitFile("side.txt", "side\n", "side work");
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge side", "side");
    const merge = git("rev-parse", "HEAD");
    const r = run(script, ["--commits", merge, out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`merge commit: ${merge}`);
  });

  it("exits 2 on a root commit", () => {
    const r = run(script, ["--commits", root, out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`root commit: ${root}`);
  });

  it("exits 2 on a repeated sha", () => {
    const r = run(script, ["--commits", `${a},${a}`, out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`repeated commit: ${a}`);
  });

  it("exits 2 on an empty list element", () => {
    const r = run(script, ["--commits", `${a},,${b}`, out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("bad commit: ");
  });

  it("exits 2 when --untracked is combined with --commits", () => {
    const r = run(script, ["--commits", a, out, "--untracked"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--untracked cannot be used with --commits");
  });

  it("exits 2 with the usage line when the output file is missing", () => {
    const r = run(script, ["--commits", a]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
    expect(r.stderr).toContain("--commits");
  });

  it("exits 3 with empty commit list diff when the commit changes nothing", () => {
    git("commit", "-q", "--allow-empty", "-m", "nothing");
    const empty = git("rev-parse", "HEAD");
    const r = run(script, ["--commits", empty, out]);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("empty commit list diff");
    expect(existsSync(out)).toBe(false);
  });
});

describe("review-package range mode", () => {
  function sameAsBase(args: (outPath: string) => string[]) {
    const oldOut = join(scratch, "old", "pkg.diff");
    const newOut = join(scratch, "new", "pkg.diff");
    const oldRun = run(baseScript, args(oldOut));
    const newRun = run(script, args(newOut));
    return { oldRun, newRun, oldOut, newOut };
  }

  it("writes output byte-identical to the previous script with --untracked and a pathspec", () => {
    writeFileSync(join(repo, "src", "loose.txt"), "untracked body\n");
    const { oldRun, newRun, oldOut, newOut } = sameAsBase((o) => [root, "HEAD", o, "--untracked", "--", "src/"]);
    expect(oldRun.status).toBe(0);
    expect(newRun.status).toBe(0);
    expect(readFileSync(newOut, "utf8")).toBe(readFileSync(oldOut, "utf8"));
    expect(newRun.stdout.replace(newOut, "OUT")).toBe(oldRun.stdout.replace(oldOut, "OUT"));
    expect(readFileSync(newOut, "utf8")).toContain("untracked body");
  });

  it("keeps exit 3 for a head that is not a descendant of base", () => {
    const { oldRun, newRun } = sameAsBase((o) => [b, a, o]);
    expect(oldRun.status).toBe(3);
    expect(newRun.status).toBe(3);
    expect(newRun.stderr.replaceAll(scratch, "")).toBe(oldRun.stderr.replaceAll(scratch, ""));
  });

  it("keeps exit 2 for a bad BASE", () => {
    const { oldRun, newRun } = sameAsBase((o) => ["nosuchref", "HEAD", o]);
    expect(oldRun.status).toBe(2);
    expect(newRun.status).toBe(2);
    expect(newRun.stderr).toBe(oldRun.stderr);
  });
});
