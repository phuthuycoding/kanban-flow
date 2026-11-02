import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensurePlugin, removePlugin, pluginState, claudeRunner } from "../integrations/claude-plugin.js";
import { cmdInit } from "../cli/commands/init.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

type Result = { code: number; stdout: string; stderr: string };
type Run = (args: string[]) => Promise<Result>;

const ok = (stdout = ""): Result => ({ code: 0, stdout, stderr: "" });

/** A stub runner: `list` answers with the given output, every call is recorded. */
function stub(listOut: string, overrides: Record<string, Result | Error> = {}): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const hit = overrides[key];
    if (hit instanceof Error) throw hit;
    if (hit) return hit;
    return args[1] === "list" ? ok(listOut) : ok();
  };
  return { run, calls };
}

const entry = (extra: Record<string, unknown>) =>
  JSON.stringify([{ id: "kf@kanban-flow", scope: "user", enabled: true, readFromFolder: PKG_ROOT, ...extra }]);

const enoent = () => Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });

describe("ensurePlugin", () => {
  it("adds the marketplace then installs a missing plugin at user scope for global", async () => {
    const { run, calls } = stub("[]");
    const res = await ensurePlugin("global", run);
    expect(res.code).toBe(0);
    expect(calls).toEqual([
      ["plugin", "list", "--json"],
      ["plugin", "marketplace", "add", PKG_ROOT],
      ["plugin", "install", "kf@kanban-flow", "--scope", "user"],
    ]);
  });

  it("installs a missing plugin at project scope for project", async () => {
    const { run, calls } = stub("[]");
    const res = await ensurePlugin("project", run);
    expect(res.code).toBe(0);
    expect(calls.slice(1)).toEqual([
      ["plugin", "marketplace", "add", PKG_ROOT],
      ["plugin", "install", "kf@kanban-flow", "--scope", "project"],
    ]);
  });

  it("only lists when the plugin is present and current", async () => {
    const { run, calls } = stub(entry({}));
    const res = await ensurePlugin("global", run);
    expect(res.code).toBe(0);
    expect(calls).toEqual([["plugin", "list", "--json"]]);
  });

  it("re-adds only the marketplace when the plugin reads from another folder", async () => {
    const { run, calls } = stub(entry({ readFromFolder: "/somewhere/else/kanban-flow" }));
    const res = await ensurePlugin("global", run);
    expect(res.code).toBe(0);
    expect(calls).toEqual([
      ["plugin", "list", "--json"],
      ["plugin", "marketplace", "add", PKG_ROOT],
    ]);
  });

  it("enables a disabled plugin at the mapped scope", async () => {
    const user = stub(entry({ enabled: false }));
    expect((await ensurePlugin("global", user.run)).code).toBe(0);
    expect(user.calls).toEqual([
      ["plugin", "list", "--json"],
      ["plugin", "enable", "kf", "--scope", "user"],
    ]);

    const project = stub(entry({ enabled: false, scope: "project" }));
    expect((await ensurePlugin("project", project.run)).code).toBe(0);
    expect(project.calls).toEqual([
      ["plugin", "list", "--json"],
      ["plugin", "enable", "kf", "--scope", "project"],
    ]);
  });

  it("ignores other plugins in the list", async () => {
    const other = JSON.stringify([{ id: "other@market", enabled: true, readFromFolder: "/x" }]);
    const { run, calls } = stub(other);
    await ensurePlugin("global", run);
    expect(calls[1]).toEqual(["plugin", "marketplace", "add", PKG_ROOT]);
  });
});

describe("ensurePlugin failures", () => {
  const manual = (text: string) => {
    expect(text).toContain("/plugin marketplace add");
    expect(text).toContain("/plugin install");
  };

  it("reports claude missing from PATH with the manual commands", async () => {
    const run: Run = async () => {
      throw enoent();
    };
    const res = await ensurePlugin("global", run);
    expect(res.code).not.toBe(0);
    manual(res.stdout);
    expect(res.stdout).not.toMatch(/installed/i);
  });

  it("quotes the output of a non-zero exit and lists the manual commands", async () => {
    const { run } = stub("[]", { "plugin marketplace": { code: 2, stdout: "", stderr: "marketplace exploded: boom-42" } });
    const res = await ensurePlugin("global", run);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("marketplace exploded: boom-42");
    manual(res.stdout);
  });

  it("does not install after the marketplace add failed", async () => {
    const { run, calls } = stub("[]", { "plugin marketplace": { code: 1, stdout: "", stderr: "nope" } });
    await ensurePlugin("global", run);
    expect(calls.some((c) => c[1] === "install")).toBe(false);
  });

  it("reports non-JSON list output as an error, never as installed", async () => {
    const { run, calls } = stub("this is not json");
    const res = await ensurePlugin("global", run);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("this is not json");
    manual(res.stdout);
    expect(calls).toEqual([["plugin", "list", "--json"]]);
  });

  it("reports a JSON list that is not an array as an error", async () => {
    const { run } = stub('{"plugins": []}');
    const res = await ensurePlugin("global", run);
    expect(res.code).not.toBe(0);
    manual(res.stdout);
  });
});

describe("pluginState", () => {
  it("is missing for an empty list", async () => {
    expect(await pluginState(stub("[]").run)).toEqual({ status: "missing" });
  });

  it("is current when the plugin reads from the package root", async () => {
    expect(await pluginState(stub(entry({})).run)).toEqual({ status: "current" });
  });

  it("is stale and names the folder it reads from", async () => {
    expect(await pluginState(stub(entry({ readFromFolder: "/old/kf" })).run)).toEqual({
      status: "stale",
      readFromFolder: "/old/kf",
    });
  });

  it("is disabled and carries the scope", async () => {
    expect(await pluginState(stub(entry({ enabled: false, scope: "project" })).run)).toEqual({
      status: "disabled",
      scope: "project",
    });
  });

  it("falls back to installPath when readFromFolder is absent", async () => {
    const list = JSON.stringify([{ id: "kf@kanban-flow", enabled: true, installPath: "/cache/kf/1.0.0" }]);
    expect((await pluginState(stub(list).run)).status).toBe("stale");
  });

  it("throws quoting the output when it is not JSON", async () => {
    await expect(pluginState(stub("garbage-out").run)).rejects.toThrow(/garbage-out/);
  });
});

describe("removePlugin", () => {
  it("uninstalls the plugin then removes the marketplace", async () => {
    const { run, calls } = stub("[]");
    const res = await removePlugin("global", run);
    expect(res.code).toBe(0);
    expect(calls).toEqual([
      ["plugin", "uninstall", "kf", "--scope", "user"],
      ["plugin", "marketplace", "remove", "kanban-flow"],
    ]);
  });

  it("maps project scope to project", async () => {
    const { run, calls } = stub("[]");
    await removePlugin("project", run);
    expect(calls[0]).toEqual(["plugin", "uninstall", "kf", "--scope", "project"]);
  });
});

describe("removePlugin when claude says the plugin is gone", () => {
  it.each(['Plugin "kf" not found', 'Plugin "kf" not found in installed plugins'])(
    "reports not installed for claude's own wording (%s) and succeeds",
    async (text) => {
      const { run } = stub("[]", { "plugin uninstall": { code: 1, stdout: "", stderr: text } });
      const res = await removePlugin("global", run);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("not installed");
    },
  );

  it("still removes the marketplace after a plugin that was not installed", async () => {
    const { run, calls } = stub("[]", { "plugin uninstall": { code: 1, stdout: "", stderr: 'Plugin "kf" not found' } });
    await removePlugin("global", run);
    expect(calls[1]).toEqual(["plugin", "marketplace", "remove", "kanban-flow"]);
  });

  it.each(["bash: claude: command not found", "settings file not found"])(
    "treats an unrelated failure (%s) as a failure, not as not installed",
    async (text) => {
      const { run } = stub("[]", { "plugin uninstall": { code: 1, stdout: "", stderr: text } });
      const res = await removePlugin("global", run);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain(text);
      expect(res.stdout).not.toContain("not installed");
    },
  );

  it("fails with the manual /plugin commands when claude is missing from PATH", async () => {
    const run: Run = async () => {
      throw enoent();
    };
    const res = await removePlugin("global", run);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("/plugin");
  });
});

describe("only kf@kanban-flow counts as the installed plugin", () => {
  it("runs the project install when the plugin is only installed at user scope", async () => {
    const { run, calls } = stub(entry({ scope: "user" }));
    const res = await ensurePlugin("project", run);
    expect(res.code).toBe(0);
    expect(calls).toContainEqual(["plugin", "install", "kf@kanban-flow", "--scope", "project"]);
  });

  it("ignores a kf entry from another marketplace", async () => {
    const other = JSON.stringify([{ id: "kf@other-marketplace", scope: "user", enabled: true, readFromFolder: PKG_ROOT }]);
    expect(await pluginState(stub(other).run)).toEqual({ status: "missing" });
    const { run, calls } = stub(other);
    await ensurePlugin("global", run);
    expect(calls).toContainEqual(["plugin", "install", "kf@kanban-flow", "--scope", "user"]);
  });
});

describe("claudeRunner timeout", () => {
  let bin: string;
  let prevPath: string | undefined;
  beforeEach(async () => {
    bin = await mkdtemp(join(tmpdir(), "kf-claude-hang-"));
    await writeFile(join(bin, "claude"), "#!/bin/sh\nexec sleep 30\n");
    await chmod(join(bin, "claude"), 0o755);
    prevPath = process.env.PATH;
    process.env.PATH = `${bin}:${prevPath}`;
  });
  afterEach(async () => {
    process.env.PATH = prevPath;
    await rm(bin, { recursive: true, force: true });
  });

  it("rejects a claude that never answers with an error naming the command", async () => {
    const run = claudeRunner(undefined, 300);
    await expect(run(["plugin", "list", "--json"])).rejects.toThrow(/plugin list --json/);
  });
});

describe("kf init with an unusable claude", () => {
  let dir: string;
  let prevPath: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-init-claude-"));
    prevPath = process.env.PATH;
    process.env.PATH = dir; // an empty directory: no claude on PATH
  });
  afterEach(async () => {
    process.env.PATH = prevPath;
    await rm(dir, { recursive: true, force: true });
  });

  it("prints the error as a warning and still finishes the bootstrap", async () => {
    const args: ParsedArgs = { command: "init", positionals: [], options: { defaults: true, agent: "claude" } };
    const res = await cmdInit(args, dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("⚠");
    expect(res.stdout).toContain("/plugin marketplace add");
    expect(res.stdout).toContain("/plugin install");
    expect(existsSync(join(dir, ".works"))).toBe(true);
    expect(existsSync(join(dir, ".kf", "config.json"))).toBe(true);
    expect(existsSync(join(dir, "docs", "requirement"))).toBe(true);
  });
});
