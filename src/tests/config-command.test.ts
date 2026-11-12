import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArgsCli } from "../cli/args.js";
import { cmdConfig } from "../cli/commands/config.js";
import type { CmdResult } from "../cli/result.js";

let scratch: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kfw-config-cmd-")));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A project root: `.works/` marks it, `.kf/config.json` carries the given text. */
function makeProject(root: string, configText: string): string {
  mkdirSync(join(root, ".works"), { recursive: true });
  write(join(root, ".kf", "config.json"), configText);
  return root;
}

async function kf(cwd: string, ...argv: string[]): Promise<CmdResult & { all: string }> {
  const res = await cmdConfig(parseArgsCli(["config", ...argv]), cwd);
  return { ...res, all: `${res.stdout}\n${res.stderr ?? ""}` };
}

const globalFile = (): string => join(homedir(), ".kf", "config.json");
const read = (p: string): string => readFileSync(p, "utf8");

describe("kf config show", () => {
  it("lists each leaf with its source layer and the layer file paths, and --json parses", async () => {
    const proj = makeProject(join(scratch, "ws", "proj"), '{"schema":"kanban-flow","agents":["claude"],"stacks":["node"]}\n');
    const wsFile = join(scratch, "ws", ".kf", "workspace.json");
    write(globalFile(), '{"reviewer":"A"}\n');
    write(wsFile, '{"skills":{"scope":"project"}}\n');

    const res = await kf(proj, "show");
    expect(res.code).toBe(0);
    const lines = res.stdout.split("\n");
    expect(lines.find((l) => /^\s*reviewer\b/.test(l))).toMatch(/global/);
    expect(lines.find((l) => /^\s*skills\.scope\b/.test(l))).toMatch(/workspace/);
    expect(lines.find((l) => /^\s*agents\b/.test(l))).toMatch(/project/);
    expect(lines.find((l) => /^\s*stacks\b/.test(l))).toMatch(/project/);
    expect(res.stdout).toContain(globalFile());
    expect(res.stdout).toContain(wsFile);
    expect(res.stdout).toContain(join(proj, ".kf", "config.json"));

    const json = await kf(proj, "show", "--json");
    expect(json.code).toBe(0);
    const parsed: unknown = JSON.parse(json.stdout);
    expect(parsed).toBeTypeOf("object");
    const sources = (parsed as { sources: Record<string, string> }).sources;
    expect(sources.reviewer).toBe("global");
    expect(sources["skills.scope"]).toBe("workspace");
    expect(sources.agents).toBe("project");
    expect(sources.stacks).toBe("project");
    expect(JSON.stringify(parsed)).toContain(wsFile);
  });

  it("prints only one layer's file and marks keys that layer does not apply as not applied", async () => {
    const proj = makeProject(join(scratch, "ws", "proj"), '{"schema":"kanban-flow"}\n');
    write(globalFile(), '{"reviewer":"A","contexts":["x"]}\n');
    write(join(scratch, "ws", ".kf", "workspace.json"), '{"skills":{"scope":"project"},"stacks":["node"]}\n');

    const g = await kf(proj, "show", "--global");
    expect(g.code).toBe(0);
    const gLines = g.stdout.split("\n");
    expect(gLines.find((l) => /\breviewer\b/.test(l))).not.toMatch(/not applied/);
    expect(gLines.find((l) => /\bcontexts\b/.test(l))).toMatch(/not applied/);
    expect(g.stdout).not.toContain("stacks");

    const w = await kf(proj, "show", "--workspace");
    expect(w.code).toBe(0);
    const wLines = w.stdout.split("\n");
    expect(wLines.find((l) => /skills\.scope|\bscope\b/.test(l))).not.toMatch(/not applied/);
    expect(wLines.find((l) => /\bstacks\b/.test(l))).toMatch(/not applied/);
    expect(w.stdout).not.toContain("reviewer");
  });
});

describe("kf config get", () => {
  it("prints a scalar raw, an object as JSON, refuses an unset key and reads one layer only", async () => {
    const proj = makeProject(join(scratch, "proj"), '{"schema":"kanban-flow","skills":{"scope":"project"}}\n');
    write(globalFile(), '{"reviewer":"A"}\n');

    const scalar = await kf(proj, "get", "reviewer");
    expect(scalar.code).toBe(0);
    expect(scalar.stdout.trim()).toBe("A");

    const obj = await kf(proj, "get", "skills");
    expect(obj.code).toBe(0);
    expect(JSON.parse(obj.stdout)).toEqual({ scope: "project" });

    const unset = await kf(proj, "get", "worktree.nope");
    expect(unset.code).not.toBe(0);
    expect(unset.all).toMatch(/not set/);

    const wsOnly = await kf(proj, "get", "reviewer", "--workspace");
    expect(wsOnly.code).not.toBe(0);
    expect(wsOnly.all).toMatch(/not set/);
  });
});

describe("kf config set", () => {
  it("writes one top-level member and keeps every other member's exact text", async () => {
    const original = '{\n    "schema": "kanban-flow",\n    "stacks": ["node",   "php"],\n    "reviewer": "old",\n    "contexts": [ "app" ]\n}\n';
    const proj = makeProject(join(scratch, "proj"), original);

    const res = await kf(proj, "set", "reviewer", "B");
    expect(res.code).toBe(0);
    expect(read(join(proj, ".kf", "config.json"))).toBe(original.replace('"old"', '"B"'));
  });

  it("creates the global file with a string and an array value and prints its path", async () => {
    const proj = makeProject(join(scratch, "proj"), '{"schema":"kanban-flow"}\n');
    expect(existsSync(globalFile())).toBe(false);

    const a = await kf(proj, "set", "--global", "skills.scope", "project");
    expect(a.code).toBe(0);
    expect(a.stdout).toContain(globalFile());
    const b = await kf(proj, "set", "--global", "agents", '["claude"]');
    expect(b.code).toBe(0);

    expect(JSON.parse(read(globalFile()))).toEqual({ skills: { scope: "project" }, agents: ["claude"] });
  });

  it("re-serialises only the top-level member that contains a nested path", async () => {
    const original = '{\n  "schema":   "kanban-flow",\n  "skills": {  "scope":"project" ,\n      "extra": 1 },\n  "stacks": ["node",\n "php"],\n  "reviewer":"x"\n}\n';
    const proj = makeProject(join(scratch, "proj"), original);

    const res = await kf(proj, "set", "skills.scope", "global");
    expect(res.code).toBe(0);
    const out = read(join(proj, ".kf", "config.json"));
    expect(out).toContain('  "schema": "kanban-flow",\n');
    expect(out).toContain('  "stacks": ["node",\n "php"],\n');
    expect(out).toContain('  "reviewer": "x"\n');
    expect(Object.keys(JSON.parse(out))).toEqual(["schema", "skills", "stacks", "reviewer"]);
    expect(JSON.parse(out).skills).toEqual({ scope: "global", extra: 1 });
    expect(out).not.toContain('{  "scope":"project" ,');
  });

  it("refuses keys not applied at the layer, invalid values and an invalid target file, leaving files unchanged", async () => {
    const proj = makeProject(join(scratch, "proj"), '{"schema":"kanban-flow"}\n');
    const g = '{"reviewer":"A"}\n';
    write(globalFile(), g);

    const repo = await kf(proj, "set", "--global", "repository", "x/y");
    expect(repo.code).not.toBe(0);
    expect(repo.all).toMatch(/applies at the project layer only/);

    const wt = await kf(proj, "set", "--workspace", "worktree.enabled", "true");
    expect(wt.code).not.toBe(0);
    expect(wt.all).toMatch(/applies at the project layer only/);

    const bad = await kf(proj, "set", "--global", "agents", '["nope"]');
    expect(bad.code).not.toBe(0);
    expect(read(globalFile())).toBe(g);
    expect(existsSync(join(scratch, ".kf", "workspace.json"))).toBe(false);

    write(globalFile(), "{ not json");
    const invalid = await kf(proj, "set", "--global", "reviewer", "A");
    expect(invalid.code).not.toBe(0);
    expect(invalid.all).toContain(globalFile());
    expect(read(globalFile())).toBe("{ not json");
  });
});

describe("kf config set --workspace", () => {
  it("creates .kf/workspace.json in the project's parent and prints the path", async () => {
    const ws = join(scratch, "ws");
    const proj = makeProject(join(ws, "proj"), '{"schema":"kanban-flow"}\n');

    const res = await kf(proj, "set", "--workspace", "reviewer", "A");
    expect(res.code).toBe(0);
    const target = join(ws, ".kf", "workspace.json");
    expect(JSON.parse(read(target))).toEqual({ reviewer: "A" });
    expect(res.stdout).toContain(target);
  });

  it("refuses a --workspace-dir farther than a nearer workspace file and writes nothing", async () => {
    const ws = join(scratch, "ws");
    const proj = makeProject(join(ws, "proj"), '{"schema":"kanban-flow"}\n');
    const near = '{"reviewer":"near"}\n';
    write(join(ws, ".kf", "workspace.json"), near);

    const res = await kf(proj, "set", "--workspace", "reviewer", "A", "--workspace-dir", scratch);
    expect(res.code).not.toBe(0);
    expect(res.all).toMatch(/nearer|shadow/i);
    expect(existsSync(join(scratch, ".kf", "workspace.json"))).toBe(false);
    expect(read(join(ws, ".kf", "workspace.json"))).toBe(near);
  });

  it("writes the --workspace-dir file even when a workspace file exists at a farther ancestor", async () => {
    const far = join(scratch, "far");
    const near = join(far, "near");
    const proj = makeProject(join(near, "proj"), '{"schema":"kanban-flow"}\n');
    const farText = '{"reviewer":"far"}\n';
    write(join(far, ".kf", "workspace.json"), farText);

    const res = await kf(proj, "set", "--workspace", "reviewer", "A", "--workspace-dir", near);
    expect(res.code).toBe(0);
    const target = join(near, ".kf", "workspace.json");
    expect(JSON.parse(read(target))).toEqual({ reviewer: "A" });
    expect(res.stdout).toContain(target);
    expect(read(join(far, ".kf", "workspace.json"))).toBe(farText);
  });

  it("refuses the home directory and a directory that is not an ancestor, creating no file", async () => {
    const proj = makeProject(join(homedir(), "proj"), '{"schema":"kanban-flow"}\n');

    const home = await kf(proj, "set", "--workspace", "reviewer", "A");
    expect(home.code).not.toBe(0);
    expect(home.all).toMatch(/home/i);
    expect(existsSync(join(homedir(), ".kf", "workspace.json"))).toBe(false);

    const unrelated = join(scratch, "unrelated");
    mkdirSync(unrelated);
    const far = await kf(proj, "set", "--workspace", "reviewer", "A", "--workspace-dir", unrelated);
    expect(far.code).not.toBe(0);
    expect(far.all).toMatch(/ancestor/i);
    expect(existsSync(join(unrelated, ".kf", "workspace.json"))).toBe(false);
  });
});

describe("kf config set at home and outside a project", () => {
  it("writes ~/.kf/config.json from a project rooted at home and says it is the project file", async () => {
    makeProject(homedir(), '{"schema":"kanban-flow"}\n');

    const res = await kf(homedir(), "set", "--global", "reviewer", "A");
    expect(res.code).toBe(0);
    expect(JSON.parse(read(globalFile())).reviewer).toBe("A");
    expect(res.all).toMatch(/project/i);
  });

  it("allows --global outside a project and refuses a project-layer set naming the alternatives", async () => {
    const outside = join(scratch, "nowhere");
    mkdirSync(outside);

    const g = await kf(outside, "set", "--global", "reviewer", "A");
    expect(g.code).toBe(0);
    expect(JSON.parse(read(globalFile())).reviewer).toBe("A");

    const p = await kf(outside, "set", "reviewer", "B");
    expect(p.code).not.toBe(0);
    expect(p.all).toMatch(/project/);
    expect(p.all).toContain("--global");
    expect(JSON.parse(read(globalFile())).reviewer).toBe("A");
  });
});

describe("kf config dispatch", () => {
  it("answers an unknown subcommand with help and exit 1", async () => {
    const proj = makeProject(join(scratch, "proj"), '{"schema":"kanban-flow"}\n');
    const res = await kf(proj, "bogus");
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/^Usage:/);
  });
});
