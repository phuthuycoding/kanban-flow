import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { runDoctor } from "../project/doctor.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import { readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;


/** A `claude` first on PATH that reports the kf plugin registered at this package: current, enabled. */
async function currentPluginStub(): Promise<void> {
  const bin = join(root, "..", `${basename(root)}-bin`);
  await mkdir(bin, { recursive: true });
  const list = JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
  await writeFile(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo '${list}'; fi\nexit 0\n`);
  await chmod(join(bin, "claude"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
}

/**
 * A project as `kf init --minimal` really leaves it, so the checks meet the shape they will meet.
 * Claude Code gets the kf plugin, not copies, so the claude CLI reports the plugin current.
 */
async function project(agent?: string): Promise<void> {
  await currentPluginStub();
  const options = { minimal: true, context: "app", ...(agent ? { agent } : {}) };
  expect((await cmdInit(args("init", [], options), root)).code).toBe(0);
  if (agent) {
    // --minimal does not record the agent, so the config is patched the way a user's choice would be.
    const cfgPath = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath, JSON.stringify({ ...cfg, agents: [agent] }, null, 2));
  }
}

/** Every file under a directory, path → contents, for proving nothing was written. */
async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, base));
    else out[full.slice(base.length)] = await readFile(full, "utf8");
  }
  return out;
}

let prevPath: string | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-"));
  prevPath = process.env.PATH;
});
afterEach(async () => {
  process.env.PATH = prevPath;
  await rm(join(root, "..", `${basename(root)}-bin`), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("kf doctor on a healthy project", () => {
  it("finds nothing and exits 0", async () => {
    await project();
    const report = runDoctor(root);
    expect(report.findings).toEqual([]);
    expect(report.ok).toBe(true);
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Healthy");
  });

  it("never probes worktree domain infra on an opted-out project", async () => {
    // worktrees are opt-in now: no worktree block → no probe, no setup suggestion
    await project();
    const res = await cmdDoctor(args("doctor"), root);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("worktree infra");
    expect(res.stdout).not.toContain("worktree setup");
  });

  it("does not call an invalid work item a broken project", async () => {
    // A pipeline in motion is full of items that are not valid yet. Failing on those would make
    // the verdict useless — it would be red almost always.
    await project();
    const dir = join(root, ".works", "brainstorm", "wip_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "wip", context: "app", created: "20260101_0000" });

    const report = runDoctor(root);
    expect(report.invalidItems, "the item really is invalid").toBeGreaterThan(0);
    expect(report.findings, "but that is not a finding").toEqual([]);
    expect(report.ok).toBe(true);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(0);
  });

  it("runs from a subdirectory and refuses politely outside a project", async () => {
    await project();
    const sub = join(root, "src", "deep");
    await mkdir(sub, { recursive: true });
    expect((await cmdDoctor(args("doctor"), sub)).code).toBe(0);

    const outside = await mkdtemp(join(tmpdir(), "kf-nowhere-"));
    try {
      const res = await cmdDoctor(args("doctor"), outside);
      expect(res.code).toBe(1);
      expect(res.stdout).not.toContain("Error:");
      expect(res.stdout.length).toBeGreaterThan(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("kf doctor on a broken project", () => {
  it("survives a config it cannot parse, which is the case it exists for", async () => {
    await project();
    await writeFile(join(root, ".kf", "config.json"), "{ this is not json");
    const report = runDoctor(root);
    const config = report.findings.find((f) => f.area === ".kf/config.json");
    expect(config?.level).toBe("ERROR");
    expect(config?.message).toContain("Cannot read the project config");
    expect(report.ok).toBe(false);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(1);
  });

  it("keeps checking after the first problem instead of stopping", async () => {
    // One diagnosis per run would mean fixing four things in four runs.
    await project();
    await writeFile(join(root, ".kf", "config.json"), "{ broken");
    await rm(join(root, ".works", "testing"), { recursive: true });
    // A leftover pre-plugin skill copy is the third, independent problem.
    await mkdir(join(process.env.HOME!, ".claude", "skills", "kanban-plan"), { recursive: true });
    const areas = runDoctor(root).findings.map((f) => f.area);
    expect(areas).toContain(".kf/config.json");
    expect(areas).toContain(".works/");
    expect(areas.some((a) => a.includes("skills"))).toBe(true);
  });

  it("names the stage directory that is missing", async () => {
    await project();
    await rm(join(root, ".works", "review"), { recursive: true });
    const f = runDoctor(root).findings.find((x) => x.area === ".works/");
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("review");
  });

  it("treats a file sitting where a stage directory belongs as missing", async () => {
    await project();
    await rm(join(root, ".works", "backlog"), { recursive: true });
    await writeFile(join(root, ".works", "backlog"), "not a directory");
    expect(runDoctor(root).findings.find((x) => x.area === ".works/")?.message).toContain("backlog");
  });

  it("names the work item whose metadata cannot be read", async () => {
    await project();
    const dir = join(root, ".works", "brainstorm", "junk_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), "not json either");
    const f = runDoctor(root).findings.find((x) => x.area.includes("junk_20260101_0000"));
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("Unreadable metadata");
    expect(f?.action).toContain(".kfw.json");
  });

  it("reports skill copies that were installed and then deleted", async () => {
    await project("codex");
    await rm(join(process.env.HOME!, ".agents", "skills", "kf-review"), { recursive: true });
    const f = runDoctor(root).findings.find((x) => x.area.includes("skills"));
    expect(f?.level).toBe("ERROR");
    expect(f?.message).toContain("kf-review");
    expect(f?.action).toContain("kf install --agent codex");
  });
});

describe("kf doctor on config that parses but misleads", () => {
  it("warns that defaultContext is ignored, without failing the verdict", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.contexts = ["billing", "auth"];
    cfg.defaultContext = "auth";
    await writeFile(path, JSON.stringify(cfg, null, 2));

    const report = runDoctor(root);
    const f = report.findings.find((x) => x.message.includes("defaultContext"));
    expect(f?.level).toBe("WARNING");
    expect(f?.message).toContain("billing");
    expect(report.ok, "a warning must not fail the verdict").toBe(true);
    expect((await cmdDoctor(args("doctor"), root)).code).toBe(0);
  });

  it("warns when the legacy singular stack sits beside stacks", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.stack = "node";
    cfg.stacks = ["node"];
    await writeFile(path, JSON.stringify(cfg, null, 2));
    const f = runDoctor(root).findings.find((x) => x.message.includes("legacy"));
    expect(f?.level).toBe("WARNING");
    expect(runDoctor(root).ok).toBe(true);
  });

  it("says nothing about defaultContext when no list is declared", async () => {
    // Without `contexts`, defaultContext is the field that decides — warning would be wrong.
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete cfg.contexts;
    cfg.defaultContext = "auth";
    await writeFile(path, JSON.stringify(cfg, null, 2));
    expect(runDoctor(root).findings.some((x) => x.message.includes("defaultContext"))).toBe(false);
  });
});

describe("kf doctor on a docs branch left at close", () => {
  const sh = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const unpushed = () => runDoctor(root).findings.filter((f) => f.message.includes("docs_branch_unpushed"));

  /** A project with an origin, a done item whose meta names docs/app-demo, and that branch one commit past main. */
  async function docsBranchProject(): Promise<void> {
    await project();
    const origin = join(root, "origin.git");
    sh(root, "init", "-q", "-b", "main");
    sh(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
    sh(root, "init", "-q", "--bare", origin);
    sh(root, "remote", "add", "origin", origin);
    sh(root, "push", "-q", "origin", "main");
    sh(root, "remote", "set-head", "origin", "main");
    sh(root, "branch", "--no-track", "docs/app-demo", "origin/main");
    sh(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "docs");
    // The docs commit went onto main locally; move it onto the docs branch and reset main.
    sh(root, "branch", "-f", "docs/app-demo", "HEAD");
    sh(root, "reset", "-q", "--hard", "origin/main");
    const dir = join(root, ".works", "done", "demo_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "demo", context: "app", created: "20260101_0000", docsBranch: "docs/app-demo" });
  }

  const unproven = "docs_branch_unpushed: canonical docs for demo sit on docs/app-demo, which is not on origin and not proven merged "
    + "(origin is not a GitHub repository, so a merged PR cannot be checked).";

  it("warns while the branch never reached origin, naming it without a merge reason", async () => {
    await docsBranchProject();
    expect(unpushed().map((f) => f.message)).toEqual(["docs_branch_unpushed: canonical docs for demo sit on docs/app-demo, which is not on origin."]);
  });

  it("keeps warning when the pushed branch was deleted from origin without being merged", async () => {
    await docsBranchProject();
    sh(root, "push", "-q", "-u", "origin", "docs/app-demo");
    sh(root, "push", "-q", "origin", "--delete", "docs/app-demo");
    expect(sh(root, "branch", "-r")).not.toContain("docs/app-demo");
    expect(unpushed().map((f) => f.message)).toEqual([unproven]);
  });

  it("does not call a branch gone locally the docs that never landed when no merged PR could be looked up", async () => {
    await docsBranchProject();
    const dir = join(root, ".works", "done", "demo_20260101_0000");
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, docsCommit: sh(root, "rev-parse", "docs/app-demo") });
    sh(root, "branch", "-D", "docs/app-demo");
    const found = unpushed();
    expect(found.map((f) => f.message)).toEqual([
      "docs_branch_unpushed: canonical docs for demo were committed to docs/app-demo, which is gone here and not proven merged "
        + "(local branch docs/app-demo is gone and there is no remote-tracking ref for it here, so there is nothing to push; origin is not a GitHub repository, so a merged PR cannot be checked).",
    ]);
    expect(found[0].action).toBe("nothing to push; re-run kf doctor once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive demo");
  });

  it("stays quiet once the branch merged into the default branch and was pruned from origin", async () => {
    await docsBranchProject();
    sh(root, "push", "-q", "-u", "origin", "docs/app-demo");
    sh(root, "push", "-q", "origin", "docs/app-demo:main");
    sh(root, "push", "-q", "origin", "--delete", "docs/app-demo");
    sh(root, "fetch", "-q", "--prune", "origin");
    expect(sh(root, "branch", "-r")).not.toContain("docs/app-demo");
    expect(unpushed()).toEqual([]);
  });

  it("stays quiet once the branch tip is in origin's default branch", async () => {
    await docsBranchProject();
    sh(root, "push", "-q", "origin", "docs/app-demo:main");
    sh(root, "fetch", "-q", "origin");
    expect(unpushed()).toEqual([]);
  });
});

describe("what kf doctor promises about itself", () => {
  it("changes nothing on disk", async () => {
    await project();
    await rm(join(root, ".works", "testing"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), "{ broken");
    const before = await snapshot(root);
    await cmdDoctor(args("doctor"), root);
    expect(await snapshot(root)).toEqual(before);
  });

  it("gives --json the same findings and the same verdict as the text", async () => {
    await project();
    await rm(join(root, ".works", "done"), { recursive: true });
    const text = await cmdDoctor(args("doctor"), root);
    const json = await cmdDoctor(args("doctor", [], { json: true }), root);
    const parsed = JSON.parse(json.stdout) as { ok: boolean; findings: Array<{ message: string }> };
    expect(json.code).toBe(text.code);
    expect(parsed.ok).toBe(false);
    for (const f of parsed.findings) expect(text.stdout).toContain(f.message);
  });
});

describe("kf doctor --fix", () => {
  it("recreates a missing stage directory and says so", async () => {
    await project();
    await rm(join(root, ".works", "testing"), { recursive: true });
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("created .works/testing/");
    expect(runDoctor(root).findings.filter((f) => f.area === ".works/")).toEqual([]);
  });

  it("repairs skill copies that were installed and then deleted", async () => {
    await project("codex");
    await rm(join(process.env.HOME!, ".agents", "skills", "kf-review"), { recursive: true });
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("installed kanban skills for codex");
    expect(existsSync(join(process.env.HOME!, ".agents", "skills", "kf-review", "SKILL.md"))).toBe(true);
    expect(runDoctor(root).findings.filter((f) => f.area.includes("skills"))).toEqual([]);
  });

  it("treats a user's own travel skill as theirs: not flagged, not stale, and --fix leaves it alone", async () => {
    await project("codex");
    const skills = join(process.env.HOME!, ".agents", "skills");
    await mkdir(join(skills, "travel"), { recursive: true });
    await writeFile(join(skills, "travel", "SKILL.md"), "# My own travel planner\n");

    expect(runDoctor(root).findings.filter((f) => f.area === skills)).toEqual([]);
    expect(runDoctor(root).ok).toBe(true);

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).not.toContain("installed kanban skills");
    expect(readFileSync(join(skills, "travel", "SKILL.md"), "utf8")).toBe("# My own travel planner\n");

    // A kf copy missing beside it is still an ERROR, and the user's skill is not listed in it.
    await rm(join(skills, "kf-plan"), { recursive: true, force: true });
    const broken = runDoctor(root).findings.find((f) => f.area === skills && f.level === "ERROR");
    expect(broken?.message).toContain("kf-plan");
    expect(broken?.message).not.toContain("travel");
  });

  it("reports a loose agent file kf wrote before the plugin as a leftover, and --fix removes it", async () => {
    await project();
    const agentsDir = join(process.env.HOME!, ".claude", "agents");
    await mkdir(agentsDir, { recursive: true });
    const agent = join(agentsDir, "code-reviewer.md");
    await symlink(join(PKG_ROOT, "agents", "code-reviewer.md"), agent);
    const before = runDoctor(root).findings.filter((f) => f.area === agentsDir || f.message.includes("code-reviewer"));
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((f) => f.message.includes("code-reviewer"))).toBe(true);
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(existsSync(agent)).toBe(false);
    expect(runDoctor(root).findings.filter((f) => f.area === agentsDir)).toEqual([]);
  });

  it("never replaces or removes a user's own file under a managed agent name, and does not flag it", async () => {
    await project();
    const agentsDir = join(process.env.HOME!, ".claude", "agents");
    const mine = "---\nname: scout\ndescription: mine\n---\nkeep\n";
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "scout.md"), mine);
    expect(runDoctor(root).findings.filter((f) => f.area === agentsDir)).toEqual([]);
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(await readFile(join(agentsDir, "scout.md"), "utf8")).toBe(mine);
  });

  it("a user's file under one agent name does not hide a kf leftover beside it", async () => {
    await project();
    const agentsDir = join(process.env.HOME!, ".claude", "agents");
    const mine = "---\nname: scout\ndescription: mine\n---\nkeep\n";
    await mkdir(agentsDir, { recursive: true });
    await writeFile(join(agentsDir, "scout.md"), mine);
    await symlink(join(PKG_ROOT, "agents", "code-reviewer.md"), join(agentsDir, "code-reviewer.md"));
    expect(runDoctor(root).findings.some((f) => f.message.includes("code-reviewer"))).toBe(true);
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(existsSync(join(agentsDir, "code-reviewer.md"))).toBe(false);
    expect(await readFile(join(agentsDir, "scout.md"), "utf8")).toBe(mine);
  });

  it("writes the repository link the origin remote implies", async () => {
    await project();
    execFileSync("git", ["init", root]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "git@github.com:owner/repo.git"]);

    const warned = runDoctor(root).findings.find((f) => f.message.includes("No repository link"));
    expect(warned?.level).toBe("WARNING");
    expect(warned?.message).toContain("owner/repo");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain('set "repository": "owner/repo"');
    const cfg = JSON.parse(await readFile(join(root, ".kf", "config.json"), "utf8")) as { repository?: string };
    expect(cfg.repository).toBe("owner/repo");
    expect(runDoctor(root).findings.some((f) => f.message.includes("repository"))).toBe(false);
  });

  it("says nothing about repository when the origin is not GitHub", async () => {
    await project();
    execFileSync("git", ["init", root]);
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://gitlab.com/owner/repo.git"]);
    expect(runDoctor(root).findings.some((f) => f.message.includes("repository"))).toBe(false);
  });

  it("restores missing hook-pack files only after the project opted in, and only reports divergence", async () => {
    await project();
    const hooks = join(root, ".kf", "hooks");
    await mkdir(hooks, { recursive: true });
    // Not opted in — no pack files: doctor stays silent.
    expect(runDoctor(root).findings.filter((f) => f.area === ".kf/hooks")).toEqual([]);

    // A stage-named hook of the project's own is not the pack: still silent.
    await writeFile(join(hooks, "done.sh"), "#!/usr/bin/env bash\n# our own gate\n");
    expect(runDoctor(root).findings.filter((f) => f.area === ".kf/hooks")).toEqual([]);

    // Opted in via one pack file that sources the lib — the rest are missing and the one present is stale.
    await writeFile(join(hooks, "done.sh"), "#!/usr/bin/env bash\nsource \"$(dirname \"$0\")/lib-github.sh\"\n# edited\n");
    const report = runDoctor(root);
    expect(report.findings.some((f) => f.message.includes("GitHub hook pack incomplete"))).toBe(true);
    expect(report.findings.some((f) => f.message.includes("done.sh differs"))).toBe(true);

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("restored .kf/hooks/lib-github.sh");
    expect(existsSync(join(hooks, "brainstorm.sh"))).toBe(true);
    // The project-edited file is never clobbered.
    await expect(readFile(join(hooks, "done.sh"), "utf8")).resolves.toBe("#!/usr/bin/env bash\nsource \"$(dirname \"$0\")/lib-github.sh\"\n# edited\n");
  });

  it("reports a legacy statusMap once and --fix rewrites it to the new stage keys", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.project = { owner: "me", number: 3, statusMap: { dones: "Done", shipping: "Shipping", review: "In review" } };
    await writeFile(path, JSON.stringify(cfg, null, 2));

    const legacy = runDoctor(root).findings.filter((f) => f.message.includes("statusmap_legacy"));
    expect(legacy).toHaveLength(1);
    expect(legacy[0].level).toBe("WARNING");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("rewrote project.statusMap legacy keys");
    const after = JSON.parse(await readFile(path, "utf8")) as { project: { statusMap: Record<string, string> } };
    expect(after.project.statusMap).toEqual({ review: "In review", done: "Done" });
    expect(runDoctor(root).findings.some((f) => f.message.includes("statusmap_legacy"))).toBe(false);
  });

  it("names both legacy statusMap keys and the --fix action, and --fix leaves only done", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.project = { owner: "me", number: 3, statusMap: { dones: "Done", shipping: "Ship" } };
    await writeFile(path, JSON.stringify(cfg, null, 2));

    const legacy = runDoctor(root).findings.filter((f) => f.message.includes("statusmap_legacy"));
    expect(legacy).toHaveLength(1);
    expect(legacy[0].message).toContain('"dones"');
    expect(legacy[0].message).toContain('"shipping"');
    expect(legacy[0].action).toContain("kf doctor --fix");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("rewrote project.statusMap legacy keys");
    const after = JSON.parse(await readFile(path, "utf8")) as { project: { statusMap: Record<string, string> } };
    expect(after.project.statusMap).toEqual({ done: "Done" });
    expect(runDoctor(root).findings.some((f) => f.message.includes("statusmap_legacy"))).toBe(false);
  });

  it("warns once that a leftover ship block is ignored, and the config still reads", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.ship = { enabled: true, merge: "now" };
    await writeFile(path, JSON.stringify(cfg, null, 2));

    const report = runDoctor(root);
    expect(report.findings.some((f) => f.message.startsWith("Cannot read the project config"))).toBe(false);
    const ship = report.findings.filter((f) => f.message.includes("ship block is ignored"));
    expect(ship).toHaveLength(1);
    expect(ship[0].level).toBe("WARNING");
    expect(ship[0].action).toContain('remove the "ship" block');
    expect(report.ok).toBe(true);

    delete cfg.ship;
    await writeFile(path, JSON.stringify(cfg, null, 2));
    expect(runDoctor(root).findings.some((f) => f.message.includes("ship block"))).toBe(false);
  });

  it("warns about orphaned legacy stage hooks, naming each file and its fix", async () => {
    await project();
    const hooks = join(root, ".kf", "hooks");
    await mkdir(hooks, { recursive: true });
    expect(runDoctor(root).findings.some((f) => f.message.includes("orphaned"))).toBe(false);

    await writeFile(join(hooks, "dones.sh"), "#!/usr/bin/env bash\n");
    await writeFile(join(hooks, "shipping.sh"), "#!/usr/bin/env bash\n");
    // Without done.sh, dones.sh still runs as the done hook — the message says so.
    expect(runDoctor(root).findings.find((f) => f.message.includes(".kf/hooks/dones.sh"))?.message)
      .toBe(".kf/hooks/dones.sh is a legacy hook: it runs for done only because done.sh is missing.");
    expect(runDoctor(root).findings.find((f) => f.message.includes(".kf/hooks/dones.sh"))?.action)
      .toBe("kf doctor --fix (renames dones.sh to done.sh, keeping its content), or rename it by hand");
    await writeFile(join(hooks, "done.sh"), "#!/usr/bin/env bash\n");
    const orphans = runDoctor(root).findings.filter((f) => f.message.includes("orphaned legacy hook"));
    expect(orphans).toHaveLength(2);
    const dones = orphans.find((f) => f.message.includes(".kf/hooks/dones.sh"));
    const shipping = orphans.find((f) => f.message.includes(".kf/hooks/shipping.sh"));
    expect(dones?.level).toBe("WARNING");
    expect(dones?.action).toBe("port any local edits from .kf/hooks/dones.sh into done.sh, then delete dones.sh");
    expect(shipping?.level).toBe("WARNING");
    expect(shipping?.action).toContain("delete .kf/hooks/shipping.sh");

    // Doctor is read-only: the orphans stay where they are until the user acts.
    expect(existsSync(join(hooks, "dones.sh"))).toBe(true);
    expect(existsSync(join(hooks, "shipping.sh"))).toBe(true);
  });

  it("drops legacy config fields but leaves judgment calls alone", async () => {
    await project();
    const path = join(root, ".kf", "config.json");
    const cfg = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    cfg.stack = "node";        // legacy beside stacks — removable
    cfg.stacks = ["node"];
    cfg.defaultContext = "app"; // ignored beside contexts — removable
    cfg.contexts = ["app"];
    await writeFile(path, JSON.stringify(cfg, null, 2));
    // A broken item meta is a judgment call — the fix must not touch it.
    const dir = join(root, ".works", "brainstorm", "junk_20260101_0000");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".kfw.json"), "not json either");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain('removed legacy "stack"');
    expect(res.stdout).toContain('removed "defaultContext"');
    const after = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(after.stack).toBeUndefined();
    expect(after.defaultContext).toBeUndefined();
    expect(after.contexts).toEqual(["app"]);
    // Still reported, still unfixed — and the verdict still fails on it.
    const report = runDoctor(root);
    expect(report.findings.some((f) => f.message.includes("Unreadable metadata"))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it("writes config defaults when the file is missing entirely", async () => {
    await project();
    await rm(join(root, ".kf", "config.json"));
    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("wrote .kf/config.json defaults");
    const cfg = JSON.parse(await readFile(join(root, ".kf", "config.json"), "utf8")) as { schema?: string };
    expect(cfg.schema).toBe("kanban-flow");
  });
});

describe("kf doctor harness checks", () => {
  it("reports a dead lock, no harness.verify.stage warning and no finding for a role the plan names", async () => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
      harness: { verify: { task: [["true"]] } },
    }));
    const item = join(root, ".works", "implementation", "demo_20260919_1200");
    await mkdir(item, { recursive: true });
    await writeFile(join(item, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200" }));
    await writeFile(join(item, "phase-2-implementation-plan.md"), "# Implementation Plan\n\n## Task Breakdown\n\n"
      + "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|\n"
      + "| TASK-001 | Do it | Core | - | Done | FR-001 / UC-001 | coder | src/a.ts |\n"
      + "| TASK-002 | Do it | Core | - | Done | FR-001 / UC-001 | designer | src/b.ts |\n");
    await mkdir(join(root, ".works", ".locks"), { recursive: true });
    const lock = join(root, ".works", ".locks", "demo.lock");
    await writeFile(lock, "999999");

    const findings = runDoctor(root).findings;
    expect(findings.some((f) => f.message.includes("designer"))).toBe(false);
    expect(findings.some((f) => f.message.includes("harness.roles"))).toBe(false);
    expect(findings.find((f) => f.area === lock)).toMatchObject({ level: "WARNING", action: `rm ${lock}` });
    expect(findings.some((f) => f.message.includes("harness.verify.stage"))).toBe(false);
  });

  it("reports a dead lock on a project with no harness block", async () => {
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20260919_1200", defaultContext: "app" }));
    await mkdir(join(root, ".works", ".locks"), { recursive: true });
    const lock = join(root, ".works", ".locks", "demo.lock");
    await writeFile(lock, "999999");

    expect(runDoctor(root).findings.find((f) => f.area === lock)).toMatchObject({ level: "WARNING", action: `rm ${lock}` });
  });
});

describe("kf doctor on unknown config keys", () => {
  const UNKNOWN = "unknown_config_key:";
  const cfgPath = () => join(root, ".kf", "config.json");

  /** Patches the config `kf init` wrote, keeping key order: existing keys first, then the extras in the order given. */
  async function withKeys(extra: Record<string, unknown>): Promise<void> {
    await project();
    const cfg = JSON.parse(await readFile(cfgPath(), "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath(), JSON.stringify({ ...cfg, ...extra }, null, 2));
  }
  const unknownFindings = (r: string) => runDoctor(r).findings.filter((f) => f.message.startsWith(UNKNOWN));

  it("hints the known key when an unknown key is its plural", async () => {
    await withKeys({ worktree: { enabled: false }, worktrees: { enabled: false } });
    const found = unknownFindings(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      level: "WARNING",
      area: ".kf/config.json",
      message: 'unknown_config_key: "worktrees" is not a kf config key and is ignored.',
      action: 'did you mean "worktree"? rename or remove it',
    });
  });

  it("offers the keep-as-a-note action when no known key is near", async () => {
    await withKeys({ notes: "scratch" });
    const found = unknownFindings(root);
    expect(found).toHaveLength(1);
    expect(found[0].level).toBe("WARNING");
    expect(found[0].message).toContain('"notes"');
    expect(found[0].action).toBe("remove it, or keep it as a note (kf ignores it)");
  });

  it("stays silent for a fresh config and for the legacy ship, stack and defaultContext keys", async () => {
    await project();
    expect(unknownFindings(root)).toEqual([]);

    const cfg = JSON.parse(await readFile(cfgPath(), "utf8")) as Record<string, unknown>;
    await writeFile(cfgPath(), JSON.stringify({
      ...cfg, ship: { enabled: true }, stack: "node", stacks: ["node"], defaultContext: "app",
    }, null, 2));
    expect(unknownFindings(root)).toEqual([]);
  });

  it("reports nothing when the config is invalid JSON, shape-refused or missing", async () => {
    await project();
    await writeFile(cfgPath(), "{ not json");
    let report = runDoctor(root);
    expect(report.findings.filter((f) => f.message.startsWith(UNKNOWN))).toEqual([]);
    expect(report.findings.some((f) => f.level === "ERROR" && f.message.startsWith("Cannot read the project config"))).toBe(true);

    await writeFile(cfgPath(), JSON.stringify({ schema: "other", notes: "x" }));
    report = runDoctor(root);
    expect(report.findings.filter((f) => f.message.startsWith(UNKNOWN))).toEqual([]);
    expect(report.findings.some((f) => f.area === ".kf/config.json" && f.level === "ERROR")).toBe(true);

    await rm(cfgPath());
    report = runDoctor(root);
    expect(report.findings.filter((f) => f.message.startsWith(UNKNOWN))).toEqual([]);
    expect(report.findings.some((f) => f.message === "No project config; defaults are in use.")).toBe(true);
  });

  it("warns per key in file order, hinting only near matches of non-legacy keys", async () => {
    await withKeys({ foos: 1, Worktree: 1, context: 1, ships: 1 });
    const found = unknownFindings(root);
    expect(found.map((f) => f.message)).toEqual([
      'unknown_config_key: "foos" is not a kf config key and is ignored.',
      'unknown_config_key: "Worktree" is not a kf config key and is ignored.',
      'unknown_config_key: "context" is not a kf config key and is ignored.',
      'unknown_config_key: "ships" is not a kf config key and is ignored.',
    ]);
    const noHint = "remove it, or keep it as a note (kf ignores it)";
    expect(found.map((f) => f.action)).toEqual([noHint, noHint, 'did you mean "contexts"? rename or remove it', noHint]);
    expect(found.every((f) => f.level === "WARNING" && f.area === ".kf/config.json")).toBe(true);
  });

  it("lists the warning in text and --json output and still exits 0", async () => {
    await withKeys({ worktrees: { enabled: false } });
    const message = 'unknown_config_key: "worktrees" is not a kf config key and is ignored.';
    const action = 'did you mean "worktree"? rename or remove it';

    const text = await cmdDoctor(args("doctor"), root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain(`[WARNING] .kf/config.json: ${message}`);
    expect(text.stdout).toContain(action);

    const json = await cmdDoctor(args("doctor", [], { json: true }), root);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout) as { findings: { level: string; area: string; message: string; action?: string }[] };
    expect(parsed.findings).toContainEqual({ level: "WARNING", area: ".kf/config.json", message, action });
  });

  it("leaves an unknown key in the file under --fix and still reports it afterwards", async () => {
    await withKeys({ worktrees: { enabled: false }, stack: "node", stacks: ["node"] });

    const res = await cmdDoctor(args("doctor", [], { fix: true, json: true }), root);
    expect(res.code).toBe(0);
    const after = JSON.parse(await readFile(cfgPath(), "utf8")) as Record<string, unknown>;
    expect(after, "the legacy stack was removed, so the file was rewritten").not.toHaveProperty("stack");
    expect(after).toHaveProperty("worktrees");
    const parsed = JSON.parse(res.stdout) as { findings: { message: string }[] };
    expect(parsed.findings.some((f) => f.message.startsWith(UNKNOWN) && f.message.includes('"worktrees"'))).toBe(true);
  });
});
