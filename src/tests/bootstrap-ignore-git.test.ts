import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor } from "../project/doctor.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

/** git that refuses check-ignore the way an unsafe-ownership checkout does, and passes everything else through. */
const GIT_STUB = `#!/usr/bin/env bash
case " $* " in *" check-ignore "*) echo "fatal: detected dubious ownership in repository" >&2; exit 128 ;; esac
exec "$REAL_GIT" "$@"
`;

let root: string;
let prevPath: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-ignore-git-"));
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  const stubBin = await mkdtemp(join(tmpdir(), "kf-ignore-git-bin-"));
  await writeFile(join(stubBin, "git"), GIT_STUB, { mode: 0o755 });
  process.env.REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  const stubBin = process.env.PATH!.split(":")[0];
  process.env.PATH = prevPath;
  delete process.env.REAL_GIT;
  await rm(stubBin, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("a git check-ignore failure falls back to the .gitignore lines", () => {
  it("kf init succeeds, adds the entries and prints the git error as a note", async () => {
    const res = await cmdInit(args("init", [], { defaults: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(".gitignore: added .works/, .worktrees/, .kf/travel/");
    expect(res.stdout).toContain("note: git could not check .gitignore (git check-ignore failed (exit 128): fatal: detected dubious ownership in repository); only its lines were matched");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain(".kf/travel/\n");
  });

  it("kf doctor reports the git error as a warning and --fix still adds the travel entry", async () => {
    expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
    await writeFile(join(root, ".gitignore"), "node_modules/\n.works/\n.worktrees/\n");
    await mkdir(join(root, ".works"), { recursive: true });

    const findings = runDoctor(root).findings.filter((f) => f.area === ".gitignore");
    expect(findings.map((f) => f.level)).toEqual(["WARNING", "WARNING"]);
    expect(findings[0].message).toBe("git could not say whether .kf/travel/ is ignored (git check-ignore failed (exit 128): fatal: detected dubious ownership in repository); only .gitignore lines were matched.");
    expect(findings[1].message).toContain(".kf/travel/ is not ignored");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("added .kf/travel/ to .gitignore");
    const after = runDoctor(root).findings.filter((f) => f.area === ".gitignore");
    expect(after.map((f) => f.message)).toEqual([findings[0].message]);
  });
});
