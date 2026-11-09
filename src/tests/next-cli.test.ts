import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(REPO_ROOT, "dist", "index.js");

const NEXT_USAGE = "Usage: kf next <feature> [--resume] [--json]";
const RECORD_USAGE =
  "Usage: kf record <feature> <event> [args…] [--model <m>] [--round <R>] [--cascade <sha>] [--status <S>] [--exit <n>] [-- <text>]";

function kf(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const cwd = mkdtempSync(join(tmpdir(), "kf-next-cli-"));
  try {
    const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("kf next argument parsing", () => {
  it("exits 3 with the missing-feature reason and the usage line when no feature is given", () => {
    const res = kf(["next"]);
    expect(res.status).toBe(3);
    expect(res.stdout.startsWith("Missing <feature>.")).toBe(true);
    expect(res.stdout).toContain(NEXT_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("exits 3 naming the extra positionals when more than one feature is given", () => {
    const res = kf(["next", "alpha", "beta"]);
    expect(res.status).toBe(3);
    expect(res.stdout.startsWith("Expected one feature, got: alpha beta")).toBe(true);
    expect(res.stdout).toContain(NEXT_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("exits 3 with the usage line on an unknown flag", () => {
    const res = kf(["next", "alpha", "--bogus"]);
    expect(res.status).toBe(3);
    expect(res.stdout).toContain("--bogus");
    expect(res.stdout).toContain(NEXT_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("exits 3 when a boolean flag is given a value", () => {
    const res = kf(["next", "alpha", "--json=yes"]);
    expect(res.status).toBe(3);
    expect(res.stdout).toContain(NEXT_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("accepts --resume and --json with a feature without a usage error", () => {
    const res = kf(["next", "alpha", "--resume", "--json"]);
    expect(res.status).not.toBe(3);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/unknown command/i);
    expect(res.stderr).not.toContain("bad input");
    expect(res.stdout).not.toContain(NEXT_USAGE);
  });
});

describe("kf record argument parsing", () => {
  it("exits 3 with the missing-feature reason and the usage line when no feature is given", () => {
    const res = kf(["record"]);
    expect(res.status).toBe(3);
    expect(res.stdout.startsWith("Missing <feature>.")).toBe(true);
    expect(res.stdout).toContain(RECORD_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("exits 3 with the missing-event reason when only a feature is given", () => {
    const res = kf(["record", "alpha"]);
    expect(res.status).toBe(3);
    expect(res.stdout.startsWith("Missing <event>.")).toBe(true);
    expect(res.stdout).toContain(RECORD_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("exits 3 with the usage line on an unknown flag", () => {
    const res = kf(["record", "alpha", "dispatched", "--bogus"]);
    expect(res.status).toBe(3);
    expect(res.stdout).toContain("--bogus");
    expect(res.stdout).toContain(RECORD_USAGE);
    expect(res.stderr).toContain("bad input");
  });

  it("parses every value flag and text after -- without a usage error", () => {
    const res = kf([
      "record", "alpha", "done", "TASK-001",
      "--model", "opus", "--round", "2", "--cascade", "abc1234", "--status", "DONE", "--exit", "0",
      "--", "free text here",
    ]);
    expect(res.status).not.toBe(3);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/unknown command/i);
    expect(res.stderr).not.toContain("bad input");
    expect(res.stdout).not.toContain(RECORD_USAGE);
  });
});

describe("kf help for the new commands", () => {
  it("prints the next help and exits 0", () => {
    const res = kf(["help", "next"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("kf next");
  });

  it("prints the record help and exits 0", () => {
    const res = kf(["help", "record"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("kf record");
  });

  it("lists both commands in the general help", () => {
    const res = kf(["help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^\s*next\b/m);
    expect(res.stdout).toMatch(/^\s*record\b/m);
  });
});
