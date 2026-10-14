import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdWorktree } from "../cli/commands/worktree.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { worktreeConfig, isManagedBranch, readMachineConfig } from "../worktree/config.js";
import { listWorktrees } from "../worktree/manager.js";
import {
  attachWorktreeToAdes,
  detachWorktreeFromAdes,
  renderAdeResults,
  adeSyncEnabled,
  type AdeAdapter,
  type AdeContext,
} from "../integrations/ade/index.js";
import { orcaAdapter } from "../integrations/ade/orca.js";
import { herdrAdapter } from "../integrations/ade/herdr.js";
import type { ParsedArgs } from "../cli/args.js";

/**
 * Fake `orca`/`herdr` binaries: every call appends its argv (NUL-joined) to
 * <fakeDir>/<name>.argv and answers from a response file named
 * <fakeDir>/<name>.<key> where key = "$1_$2" sanitized to [A-Za-z0-9_].
 * A sibling "<key>.exit" file makes the call print the response to stderr and
 * exit with that code. Missing response file → empty stdout, exit 0.
 */
const SCRIPT = `#!/usr/bin/env bash
printf '%s\\0' "$@" >> "$KF_FAKE_DIR/\${0##*/}.argv"
printf '\\n' >> "$KF_FAKE_DIR/\${0##*/}.argv"
# Real CLI contract: 'herdr worktree open' takes --path XOR --branch — a caller
# passing both gets a usage error, so tests must not send them together.
if [ "\${0##*/}" = "herdr" ] && [ "\${1-}" = "worktree" ] && [ "\${2-}" = "open" ]; then
  case " $* " in
    *" --path "*" --branch "*) echo "usage: herdr worktree open (--path PATH | --branch NAME) ..." >&2; exit 2;;
  esac
fi
key=$(printf '%s_%s' "\${1-}" "\${2-}" | sed 's/[^A-Za-z0-9]/_/g')
base="$KF_FAKE_DIR/\${0##*/}.$key"
# Sequential responses: herdr.seqN consumed in call order, so tests can
# model state changing between two invocations of the same command.
n=$(( $(cat "$KF_FAKE_DIR/.seq.$key" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$KF_FAKE_DIR/.seq.$key"
if [ -f "$base.seq$n" ]; then cat "$base.seq$n"; exit 0; fi
if [ -f "$base.exit" ]; then
  [ -f "$base" ] && cat "$base" >&2
  exit "$(cat "$base.exit")"
fi
[ -f "$base" ] && cat "$base"
exit 0
`;

const keyOf = (a: string, b = "") => `${a}_${b}`.replace(/[^A-Za-z0-9]/g, "_");

let root: string;
let scratch: string;
let fakeDir: string;
let prevPath: string | undefined;
let prevAdeSync: string | undefined;

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (dir: string, ...a: string[]) =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);

function respond(bin: string, a: string, b: string, body: string, exit?: number): void {
  const base = join(fakeDir, `${bin}.${keyOf(a, b)}`);
  writeFileSync(base, body);
  if (exit !== undefined) writeFileSync(`${base}.exit`, String(exit));
}

/** Response for the Nth invocation of `<bin> a b` (1-based, per key). */
function respondSeq(bin: string, a: string, b: string, n: number, body: string): void {
  writeFileSync(join(fakeDir, `${bin}.${keyOf(a, b)}.seq${n}`), body);
}

function argvLog(bin: string): string[][] {
  const file = join(fakeDir, `${bin}.argv`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => line.split("\0").slice(0, -1));
}

const ORCA_UP = JSON.stringify({ ok: true, result: { runtime: { reachable: true, state: "ready" } } });
const HERDR_UP = "client:\n  version: 0.9.3\nserver:\n  status: running\n";

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "kf-ade-"));
  root = join(scratch, "repo");
  fakeDir = join(scratch, "fake-bin");
  mkdirSync(fakeDir, { recursive: true });
  for (const bin of ["orca", "herdr"]) {
    writeFileSync(join(fakeDir, bin), SCRIPT);
    chmodSync(join(fakeDir, bin), 0o755);
  }
  prevPath = process.env.PATH;
  process.env.PATH = `${fakeDir}:${prevPath}`;
  process.env.KF_FAKE_DIR = fakeDir;
  prevAdeSync = process.env.KF_ADE_SYNC;
  delete process.env.KF_ADE_SYNC;

  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.email", "t@t"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "config", "user.name", "t"], { stdio: "pipe" });
  writeFileSync(join(root, ".gitignore"), ".works/\n");
  execFileSync("git", ["-C", root, "add", "-A"], { stdio: "pipe" });
  execFileSync("git", ["-C", root, "commit", "-qm", "init"], { stdio: "pipe" });
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "x",
    worktree: { baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") },
  }));
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.KF_FAKE_DIR;
  if (prevAdeSync === undefined) delete process.env.KF_ADE_SYNC;
  else process.env.KF_ADE_SYNC = prevAdeSync;
  await rm(scratch, { recursive: true, force: true });
});

const feature = (name = "demo") => findFeature(root, name)!;
const ctx = (path: string, label = "demo", branch: string | null = "t/demo"): AdeContext => ({ root, target: { path, branch, label } });

function orcaUp(worktreePaths: string[] = []): void {
  respond("orca", "status", "--json", ORCA_UP);
  respond("orca", "repo", "add", JSON.stringify({ ok: true, result: { repo: { id: "r1", displayName: "repo", externalWorktreeVisibility: "show" } } }));
  respond("orca", "worktree", "list", JSON.stringify({
    result: { worktrees: worktreePaths.map((p) => ({ id: `r1::${real(p)}`, path: real(p) })) },
  }));
}

function herdrUp(opened = false): void {
  respond("herdr", "status", "", HERDR_UP);
  respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: opened, workspace: { workspace_id: "wX" } } }));
  // `attach` lists worktrees before/after open to detect the repo anchor ws.
  respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [] } }));
}

async function itemWithWorktree(name = "demo"): Promise<string> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  const res = await cmdWorktree(args("worktree", ["create", name]), root);
  expect(res.code, res.stdout).toBe(0);
  return feature(name).meta!.worktree!.path;
}

describe("adapter registry + orchestration", () => {
  it("attaches only adapters that pass detection", () => {
    const calls: string[] = [];
    const stub = (id: string, up: boolean): AdeAdapter => ({
      id, label: id,
      isAvailable: () => up,
      attach: (c) => { calls.push(id); return { ade: id, ok: true, detail: c.target.label }; },
    });
    const results = attachWorktreeToAdes(ctx("/x"), { adapters: [stub("up", true), stub("down", false)] });
    expect(calls).toEqual(["up"]);
    expect(results).toHaveLength(1);
    expect(attachWorktreeToAdes(ctx("/x"), { adapters: [stub("down", false)] })).toEqual([]);
  });

  it("a throwing adapter becomes a warning; siblings still run", () => {
    const boom: AdeAdapter = {
      id: "boom", label: "Boom",
      isAvailable: () => true,
      attach: () => { throw new Error("cli exploded\nsecond line\nthird\nfourth"); },
    };
    const ok: AdeAdapter = { id: "ok", label: "Ok", isAvailable: () => true, attach: () => ({ ade: "Ok", ok: true, detail: "done" }) };
    const results = attachWorktreeToAdes(ctx("/x"), { adapters: [boom, ok] });
    expect(results[0]).toMatchObject({ ade: "Boom", ok: false });
    expect(results[0].warning).toContain("cli exploded");
    expect(results[1]).toMatchObject({ ade: "Ok", ok: true });
    expect(renderAdeResults(results)).toContain("⚠ Boom:");
    expect(renderAdeResults(results)).toContain("Ok: done");
  });

  it("stub adapter reaches attach/detach through the real call sites", async () => {
    // Registry-level proof of FR-002: a third ADE needs no lifecycle edits.
    const calls: string[] = [];
    const stub: AdeAdapter = {
      id: "third", label: "Third", isAvailable: () => true,
      attach: (c) => { calls.push(`attach:${c.target.label}`); return { ade: "Third", ok: true, detail: "ok" }; },
      detach: (c) => { calls.push(`detach:${c.target.label}`); return null; },
    };
    expect(attachWorktreeToAdes(ctx("/wt", "feat-x"), { adapters: [stub] })).toHaveLength(1);
    detachWorktreeFromAdes(ctx("/wt", "feat-x"), { adapters: [stub] });
    expect(calls).toEqual(["attach:feat-x", "detach:feat-x"]);
  });

  it("adeSync off short-circuits before any adapter call", async () => {
    const machineFile = join(scratch, "machine.json");
    await writeFile(machineFile, JSON.stringify({ adeSync: false }));
    const spy: AdeAdapter = { id: "s", label: "S", isAvailable: () => { throw new Error("must not be called"); }, attach: () => { throw new Error("no"); } };
    expect(attachWorktreeToAdes(ctx("/x"), { adapters: [spy], machineFile })).toEqual([]);
    expect(adeSyncEnabled(machineFile)).toBe(false);
    process.env.KF_ADE_SYNC = "off";
    expect(adeSyncEnabled()).toBe(false);
    expect(readMachineConfig(machineFile).adeSync).toBe(false);
  });
});

describe("herdr adapter", () => {
  it("opens the worktree as a workspace; --path only, focus hint on", () => {
    respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [{ path: root, open_workspace_id: "wR" }] } }));
    respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: false, workspace: { workspace_id: "wT" } } }));
    const res = herdrAdapter.attach({ root, target: { path: "/tmp/some-wt", branch: "t/demo", label: "demo", focus: true } });
    expect(res.ok).toBe(true);
    const open = argvLog("herdr").find((c) => c[1] === "open")!;
    expect(open).toEqual(["worktree", "open", "--cwd", root, "--path", "/tmp/some-wt", "--label", "demo", "--focus"]);
    expect(res.detail).toContain("demo");
  });

  it("defaults to --no-focus and never sends --branch", () => {
    respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [{ path: root, open_workspace_id: "wR" }] } }));
    respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: false, workspace: { workspace_id: "wT" } } }));
    herdrAdapter.attach(ctx("/tmp/some-wt", "demo", "t/demo"));
    const open = argvLog("herdr").find((c) => c[1] === "open")!;
    expect(open).toContain("--no-focus");
    expect(open).not.toContain("--branch");
    expect(open).not.toContain("--focus");
  });

  it("migrates the invoking pane into the new workspace on focused attach inside Herdr", () => {
    respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [{ path: root, open_workspace_id: "wR" }] } }));
    respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: false, workspace: { workspace_id: "wT" } } }));
    respond("herdr", "pane", "move", JSON.stringify({ result: { move_result: { changed: true } } }));
    process.env.HERDR_PANE_ID = "wR:p1";
    process.env.HERDR_WORKSPACE_ID = "wR";
    try {
      herdrAdapter.attach({ root, target: { path: "/tmp/some-wt", branch: null, label: "demo", focus: true } });
    } finally {
      delete process.env.HERDR_PANE_ID;
      delete process.env.HERDR_WORKSPACE_ID;
    }
    const move = argvLog("herdr").find((c) => c[0] === "pane" && c[1] === "move");
    expect(move).toEqual(["pane", "move", "wR:p1", "--new-tab", "--workspace", "wT", "--label", "demo", "--focus"]);
  });

  it("does not move panes without focus hint or Herdr env", () => {
    respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [{ path: root, open_workspace_id: "wR" }] } }));
    respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: false, workspace: { workspace_id: "wT" } } }));
    process.env.HERDR_PANE_ID = "wR:p1";
    try {
      herdrAdapter.attach(ctx("/tmp/some-wt", "demo", "t/demo")); // no focus
    } finally {
      delete process.env.HERDR_PANE_ID;
    }
    expect(argvLog("herdr").some((c) => c[0] === "pane")).toBe(false);
  });

  it("reports the repo anchor workspace the open implicitly created", () => {
    // first list call (pre-open): repo has no ws; second (post-open): it does
    respondSeq("herdr", "worktree", "list", 1, JSON.stringify({ result: { worktrees: [{ path: root }] } }));
    respondSeq("herdr", "worktree", "list", 2, JSON.stringify({ result: { worktrees: [{ path: root, open_workspace_id: "wR-auto" }] } }));
    respond("herdr", "worktree", "open", JSON.stringify({ result: { type: "worktree_opened", already_open: false, workspace: { workspace_id: "wT" } } }));
    const res = herdrAdapter.attach(ctx("/tmp/some-wt", "demo", "t/demo"));
    expect(res.autoWorkspaceId).toBe("wR-auto");
  });

  it("already_open counts as success", () => {
    herdrUp(true);
    const res = herdrAdapter.attach(ctx("/tmp/some-wt"));
    expect(res).toMatchObject({ ok: true });
    expect(res.detail).toContain("already open");
  });

  it("closes the workspace bound to the path on detach", () => {
    respond("herdr", "worktree", "list", JSON.stringify({
      result: { worktrees: [
        { path: "/other", open_workspace_id: null },
        { path: real("/tmp/some-wt"), open_workspace_id: "w9" },
      ] },
    }));
    respond("herdr", "workspace", "close", JSON.stringify({ result: { type: "workspace_closed" } }));
    const res = herdrAdapter.detach!(ctx("/tmp/some-wt"));
    expect(res?.ok).toBe(true);
    expect(argvLog("herdr").pop()).toEqual(["workspace", "close", "w9"]);
  });

  it("detach is a no-op when nothing is open", () => {
    respond("herdr", "worktree", "list", JSON.stringify({ result: { worktrees: [{ path: "/other" }] } }));
    expect(herdrAdapter.detach!(ctx("/tmp/some-wt"))).toBeNull();
  });

  it("detach group-closes the repo anchor the attach auto-created", () => {
    respond("herdr", "worktree", "list", JSON.stringify({
      result: { worktrees: [
        { path: root, open_workspace_id: "wR-auto" },
        { path: real("/tmp/some-wt"), open_workspace_id: "w9" },
      ] },
    }));
    respond("herdr", "workspace", "close", JSON.stringify({ result: { type: "workspace_closed" } }));
    const res = herdrAdapter.detach!({ root, target: { path: "/tmp/some-wt", branch: null, label: "demo", adeRepoWorkspaceId: "wR-auto" } });
    expect(res?.ok).toBe(true);
    const closes = argvLog("herdr").filter((c) => c[0] === "workspace" && c[1] === "close");
    expect(closes).toContainEqual(["workspace", "close", "w9"]);
    expect(closes).toContainEqual(["workspace", "close", "wR-auto", "--group"]);
  });

  it("detach leaves a user-owned repo workspace alone", () => {
    respond("herdr", "worktree", "list", JSON.stringify({
      result: { worktrees: [
        { path: root, open_workspace_id: "wR-user" },
        { path: real("/tmp/some-wt"), open_workspace_id: "w9" },
      ] },
    }));
    respond("herdr", "workspace", "close", JSON.stringify({ result: { type: "workspace_closed" } }));
    herdrAdapter.detach!({ root, target: { path: "/tmp/some-wt", branch: null, label: "demo", adeRepoWorkspaceId: "wR-stale" } });
    const closes = argvLog("herdr").filter((c) => c[0] === "workspace" && c[1] === "close");
    expect(closes).toEqual([["workspace", "close", "w9"]]); // id mismatch → never closed
  });

  it("detach migrates the calling pane out before closing its workspace", () => {
    respond("herdr", "worktree", "list", JSON.stringify({
      result: { worktrees: [
        { path: root, open_workspace_id: "wR" },
        { path: real("/tmp/some-wt"), open_workspace_id: "w9" },
      ] },
    }));
    respond("herdr", "workspace", "close", JSON.stringify({ result: { type: "workspace_closed" } }));
    respond("herdr", "pane", "move", JSON.stringify({ result: { move_result: { changed: true } } }));
    process.env.HERDR_WORKSPACE_ID = "w9";
    process.env.HERDR_PANE_ID = "w9:p1";
    try {
      herdrAdapter.detach!(ctx("/tmp/some-wt"));
    } finally {
      delete process.env.HERDR_WORKSPACE_ID;
      delete process.env.HERDR_PANE_ID;
    }
    const calls = argvLog("herdr");
    const moveIdx = calls.findIndex((c) => c[0] === "pane" && c[1] === "move");
    const closeIdx = calls.findIndex((c) => c[0] === "workspace" && c[1] === "close");
    expect(calls[moveIdx]).toEqual(["pane", "move", "w9:p1", "--new-tab", "--workspace", "wR", "--no-focus"]);
    expect(moveIdx).toBeLessThan(closeIdx);
  });

  it("detects availability from `herdr status`, not bare binary presence", () => {
    expect(herdrAdapter.isAvailable()).toBe(false); // no status response yet
    respond("herdr", "status", "", HERDR_UP);
    expect(herdrAdapter.isAvailable()).toBe(true);
  });
});

describe("orca adapter", () => {
  it("registers the repo and confirms the worktree is listed", () => {
    orcaUp(["/tmp/some-wt"]);
    const res = orcaAdapter.attach(ctx("/tmp/some-wt"));
    expect(res).toMatchObject({ ok: true });
    expect(res.detail).toContain("visible");
    const calls = argvLog("orca");
    expect(calls[0]).toEqual(["repo", "add", "--path", root, "--json"]);
    expect(calls[1][0]).toBe("worktree");
    expect(calls[1][1]).toBe("list");
  });

  it("warns when the worktree stays hidden", () => {
    orcaUp([]);
    const res = orcaAdapter.attach(ctx("/tmp/some-wt"));
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/external worktree/i);
  });

  it("requires a reachable runtime, not just a binary", () => {
    expect(orcaAdapter.isAvailable()).toBe(false); // no response file
    respond("orca", "status", "--json", ORCA_UP);
    expect(orcaAdapter.isAvailable()).toBe(true);
    // garbage output (e.g. the GNOME screen reader) is not Orca
    respond("orca", "status", "--json", "SPEECH DISPATCHER", 0);
    expect(orcaAdapter.isAvailable()).toBe(false);
  });
});

describe("branch prefix chain", () => {
  it("resolves branchPrefix > gitconfigName > git user.name > kf/", () => {
    expect(worktreeConfig(root, { branchPrefix: "x/" }).branchPrefix).toBe("x/");
    expect(worktreeConfig(root, { gitconfigName: "Phu Thuy" }).branchPrefix).toBe("phu-thuy/");
    expect(worktreeConfig(root, { branchPrefix: "x/", gitconfigName: "Phu Thuy" }).branchPrefix).toBe("x/");
    expect(worktreeConfig(root, {}).branchPrefix).toBe("t/"); // fixture user.name=t
  });

  it("falls back to kf/ when no git name resolves", () => {
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
    const prevSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    try {
      git(root, "config", "--unset", "user.name");
      expect(worktreeConfig(root, {}).branchPrefix).toBe("kf/");
      // names that cannot slugify also fall through
      expect(worktreeConfig(root, { gitconfigName: "!!!" }).branchPrefix).toBe("kf/");
    } finally {
      if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
      if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = prevSystem;
    }
  });
});

describe("orphan detection keeps the legacy prefix", () => {
  it("flags unmanaged worktrees on both <user>/ and kf/ branches", async () => {
    await itemWithWorktree();
    git(root, "worktree", "add", "-b", "t/loose", join(scratch, "wts", "loose-t"));
    git(root, "worktree", "add", "-b", "kf/loose", join(scratch, "wts", "loose-kf"));
    git(root, "worktree", "add", "-b", "other/loose", join(scratch, "wts", "loose-other"));
    const cfg = worktreeConfig(root, { baseDir: join(scratch, "wts"), routesFile: join(scratch, "routes.json") });
    const { orphans } = listWorktrees(root, cfg);
    const unmanaged = orphans.filter((o) => o.kind === "unmanaged-worktree").map((o) => o.detail).join("\n");
    expect(unmanaged).toContain("t/loose");
    expect(unmanaged).toContain("kf/loose");
    expect(unmanaged).not.toContain("other/loose");
    expect(isManagedBranch("kf/x", cfg)).toBe(true);
    expect(isManagedBranch("t/x", cfg)).toBe(true);
    expect(isManagedBranch("other/x", cfg)).toBe(false);
  });
});

describe("create + sync through the command layer", () => {
  it("worktree create attaches into reachable ADEs", async () => {
    orcaUp([]);
    herdrUp();
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const res = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Herdr:");
    expect(res.stdout).toContain("Orca:");
    const wtPath = feature().meta!.worktree!.path;
    // creation attaches WITH focus — the ADE switches its terminal to the new checkout
    expect(argvLog("herdr").some((c) => c.includes("open") && c.includes(wtPath) && c.includes("--focus"))).toBe(true);
    expect(argvLog("orca").some((c) => c[0] === "repo" && c[1] === "add" && c.includes(root))).toBe(true);
  });

  it("a failing adapter becomes a warning and create still exits 0", async () => {
    herdrUp();
    respond("herdr", "worktree", "open", "boom", 2);
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    const res = await cmdWorktree(args("worktree", ["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("⚠ Herdr:");
  });

  it("stage → implementation also attaches", async () => {
    herdrUp();
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\n---\n# Req\n## FR-001\nx\n## Affected surfaces\nN/A");
    expect((await cmdStage(args("stage", ["demo", "planning"]), root)).code).toBe(0);
    for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
      await writeFile(join(feature().dir, ARTIFACTS[id].file), "# Contract\nUC-001: x");
    }
    await mkdir(join(feature().dir, "use-cases"), { recursive: true });
    await writeFile(join(feature().dir, "use-cases", "UC-001.md"), "# UC-001 x");
    await writeFile(join(feature().dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nx\n");
    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);
    const res = await cmdStage(args("stage", ["demo", "implementation"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Herdr:");
  });

  it("worktree remove closes the Herdr workspace via detach", async () => {
    herdrUp();
    const wtPath = await itemWithWorktree();
    respond("herdr", "worktree", "list", JSON.stringify({
      result: { worktrees: [{ path: real(wtPath), open_workspace_id: "w9" }] },
    }));
    respond("herdr", "workspace", "close", JSON.stringify({ result: { type: "workspace_closed" } }));
    const res = await cmdWorktree(args("worktree", ["remove", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(argvLog("herdr").some((c) => c.join(" ") === "workspace close w9")).toBe(true);
  });
});

describe("kf worktree sync", () => {
  it("inside a foreign worktree, syncs that checkout without touching .works", async () => {
    orcaUp([]);
    herdrUp();
    const foreign = join(scratch, "foreign-wt");
    git(root, "worktree", "add", "--detach", foreign);
    const res = await cmdWorktree(args("worktree", ["sync"]), foreign);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`${basename(real(foreign))}:`);
    expect(res.stdout).toContain("Herdr:");
    expect(argvLog("herdr").some((c) => c.includes("open") && c.includes(real(foreign)))).toBe(true);
    expect(argvLog("herdr").some((c) => c.includes(basename(real(foreign))))).toBe(true);
  });

  it("sync <feature> re-attaches one worktree; bare sync at root covers all", async () => {
    herdrUp();
    orcaUp([]);
    const aPath = await itemWithWorktree("alpha");
    const bPath = await itemWithWorktree("beta");

    const before = argvLog("herdr").length;
    const one = await cmdWorktree(args("worktree", ["sync", "alpha"]), root);
    expect(one.code, one.stdout).toBe(0);
    const herdrCalls = argvLog("herdr").slice(before).filter((c) => c.includes("open"));
    expect(herdrCalls.length).toBeGreaterThan(0);
    expect(herdrCalls.every((c) => c.includes(real(aPath)) && !c.includes(real(bPath)))).toBe(true);

    const all = await cmdWorktree(args("worktree", ["sync"]), root);
    expect(all.code, all.stdout).toBe(0);
    expect(all.stdout).toContain("alpha:");
    expect(all.stdout).toContain("beta:");
    // sync never steals focus
    expect(argvLog("herdr").slice(before).filter((c) => c.includes("open")).every((c) => c.includes("--no-focus"))).toBe(true);
  });

  it("bare sync at root also covers foreign (non-registered) worktrees", async () => {
    herdrUp();
    const aPath = await itemWithWorktree("alpha");
    const foreign = join(scratch, "foreign-wt");
    git(root, "worktree", "add", "-b", "side/exp", foreign);

    const res = await cmdWorktree(args("worktree", ["sync"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("alpha:");   // registered keeps its feature title
    expect(res.stdout).toContain("exp:");     // foreign labelled by branch basename
    const opens = argvLog("herdr").filter((c) => c.includes("open"));
    expect(opens.some((c) => c.includes(real(foreign)))).toBe(true);
    expect(opens.some((c) => c.includes(real(aPath)))).toBe(true);
  });

  it("bare sync on a repo whose only worktrees are foreign is not silent", async () => {
    herdrUp();
    const foreign = join(scratch, "foreign-wt");
    git(root, "worktree", "add", "--detach", foreign);
    const res = await cmdWorktree(args("worktree", ["sync"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`${basename(real(foreign))}:`);
    expect(res.stdout).not.toContain("No worktrees registered");
  });

  it("sync with no reachable ADEs reports it and exits 0", async () => {
    const res = await cmdWorktree(args("worktree", ["sync", "nope"]), root);
    expect(res.code).toBe(1);
    await itemWithWorktree();
    const res2 = await cmdWorktree(args("worktree", ["sync", "demo"]), root);
    expect(res2.code).toBe(0);
    expect(res2.stdout).toContain("no ADEs reachable");
  });

  it("sync honours the KF_ADE_SYNC kill-switch", async () => {
    herdrUp();
    await itemWithWorktree();
    const before = argvLog("herdr").length;
    process.env.KF_ADE_SYNC = "off";
    const res = await cmdWorktree(args("worktree", ["sync", "demo"]), root);
    expect(res.code).toBe(0);
    expect(argvLog("herdr").length).toBe(before); // no new calls
  });
});
