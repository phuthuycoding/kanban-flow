import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { ProjectConfigError, readProjectConfig, readProjectFileConfig } from "../project/config.js";
import {
  findWorkspaceConfigPath,
  globalConfigPath,
  keyAppliesAt,
  mergeConfigLayers,
  readConfigLayers,
  resetLayerWarnings,
} from "../project/config-layers.js";
import { ensureWorksStructure, writeFeatureMeta } from "../workflow/features.js";
import { cancelItem } from "../workflow/cancel.js";

let base: string;
let root: string;
let stderr: MockInstance<typeof process.stderr.write>;

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
}
const writeGlobal = (value: unknown) => writeJson(globalConfigPath(), value);
const writeProject = (dir: string, value: unknown) => writeJson(join(dir, ".kf", "config.json"), { schema: "kanban-flow", created: "x", ...(value as object) });
const writeWorkspace = (dir: string, value: unknown) => writeJson(join(dir, ".kf", "workspace.json"), value);
const warnings = () => stderr.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("not applied"));

beforeEach(() => {
  resetLayerWarnings();
  base = mkdtempSync(join(tmpdir(), "kf-layers-"));
  root = join(base, "ws", "a", "b", "proj");
  mkdirSync(root, { recursive: true });
  writeProject(root, {});
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  stderr.mockRestore();
  rmSync(base, { recursive: true, force: true });
});

describe("global layer", () => {
  it("inherits a value from the global file and reads undefined once the file is gone", () => {
    writeGlobal({ reviewer: "A" });
    expect(readProjectConfig(root).reviewer).toBe("A");
    rmSync(globalConfigPath());
    expect(readProjectConfig(root).reviewer).toBeUndefined();
  });

  it("resolves the home directory at call time on every read", () => {
    const first = process.env.HOME;
    const h1 = mkdtempSync(join(tmpdir(), "kf-h1-"));
    const h2 = mkdtempSync(join(tmpdir(), "kf-h2-"));
    try {
      process.env.HOME = h1;
      process.env.USERPROFILE = h1;
      writeGlobal({ reviewer: "A" });
      expect(readProjectConfig(root).reviewer).toBe("A");
      process.env.HOME = h2;
      process.env.USERPROFILE = h2;
      writeGlobal({ reviewer: "B" });
      expect(readProjectConfig(root).reviewer).toBe("B");
    } finally {
      process.env.HOME = first;
      process.env.USERPROFILE = first;
      rmSync(h1, { recursive: true, force: true });
      rmSync(h2, { recursive: true, force: true });
    }
  });

  it("points globalConfigPath at .kf/config.json under the current home", () => {
    expect(globalConfigPath()).toBe(join(homedir(), ".kf", "config.json"));
  });

  it("reads the home config once as the project layer when the project root is the home directory", () => {
    writeGlobal({ reviewer: "A" });
    const resolved = readConfigLayers(homedir());
    expect(resolved.layers.map((l) => ({ layer: l.layer, path: l.path }))).toEqual([{ layer: "project", path: globalConfigPath() }]);
    expect(resolved.effective.reviewer).toBe("A");
    expect(resolved.sources["reviewer"]).toBe("project");
  });
});

describe("merging layers", () => {
  it("lets the nearest layer win for scalars and arrays and merges objects key by key", () => {
    writeGlobal({ reviewer: "A", agents: ["claude", "codex"], skills: { scope: "project" } });
    writeProject(root, { reviewer: "B", agents: ["claude"] });
    const cfg = readProjectConfig(root);
    expect(cfg.reviewer).toBe("B");
    expect(cfg.agents).toEqual(["claude"]);
    expect(cfg.skills?.scope).toBe("project");
  });

  it("combines keys from different layers", () => {
    writeGlobal({ skills: { scope: "global" } });
    writeWorkspace(join(base, "ws"), { reviewer: "A" });
    const cfg = readProjectConfig(root);
    expect(cfg.reviewer).toBe("A");
    expect(cfg.skills).toEqual({ scope: "global" });
  });

  it("mergeConfigLayers: later wins, plain objects recurse, arrays replace, undefined is not set", () => {
    const merged = mergeConfigLayers(
      { reviewer: "A", agents: ["claude", "codex"], worktree: { enabled: true, base: "x" } } as never,
      { reviewer: undefined, agents: ["claude"], worktree: { enabled: false } } as never,
    );
    expect(merged.reviewer).toBe("A");
    expect(merged.agents).toEqual(["claude"]);
    expect(merged.worktree).toEqual({ enabled: false, base: "x" });
  });

  it("reports which layer each dotted leaf came from, arrays as leaves", () => {
    writeGlobal({ reviewer: "A", agents: ["claude", "codex"], skills: { scope: "project" } });
    writeProject(root, { reviewer: "B", agents: ["claude"] });
    const { sources } = readConfigLayers(root);
    expect(sources["reviewer"]).toBe("project");
    expect(sources["agents"]).toBe("project");
    expect(sources["skills.scope"]).toBe("global");
  });

  it("lists only existing layer files, in global, workspace, project order", () => {
    writeGlobal({ reviewer: "A" });
    writeWorkspace(join(base, "ws"), { reviewer: "W" });
    const layers = readConfigLayers(root).layers;
    expect(layers.map((l) => l.layer)).toEqual(["global", "workspace", "project"]);
    expect(layers[0]!.path).toBe(globalConfigPath());
    expect(layers[1]!.path).toBe(join(base, "ws", ".kf", "workspace.json"));
  });

  it("readProjectFileConfig ignores global and workspace files", () => {
    writeGlobal({ reviewer: "A" });
    expect(readProjectFileConfig(root).reviewer).toBeUndefined();
  });
});

describe("key applicability", () => {
  it("applies reviewer, agents and skills at every layer and everything else at the project layer only", () => {
    for (const key of ["reviewer", "agents", "skills"]) {
      for (const layer of ["global", "workspace", "project"] as const) expect(keyAppliesAt(key, layer)).toBe(true);
    }
    for (const key of ["schema", "created", "repository", "project", "contexts", "defaultContext", "stacks", "harness", "worktree", "stack", "ship"]) {
      expect(keyAppliesAt(key, "global")).toBe(false);
      expect(keyAppliesAt(key, "workspace")).toBe(false);
      expect(keyAppliesAt(key, "project")).toBe(true);
    }
  });

  it("does not apply an unknown key at the global or workspace layer", () => {
    expect(keyAppliesAt("bogus", "global")).toBe(false);
    expect(keyAppliesAt("bogus", "workspace")).toBe(false);
  });

  it("leaves keys that do not apply out of the effective config and warns once per file", () => {
    writeGlobal({ repository: "x/y", worktree: { enabled: true }, bogus: 1, reviewer: "A" });
    const first = readProjectConfig(root);
    const second = readProjectConfig(root);
    expect(first.reviewer).toBe("A");
    expect(second.reviewer).toBe("A");
    expect(first.repository).toBeUndefined();
    expect(first.worktree).toBeUndefined();
    const lines = warnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(globalConfigPath());
    for (const key of ["repository", "worktree", "bogus"]) expect(lines[0]).toContain(key);
    expect(lines[0]).not.toContain("reviewer");
  });

  it("records the keys not applied on the layer entry", () => {
    writeGlobal({ repository: "x/y", reviewer: "A" });
    const layer = readConfigLayers(root).layers.find((l) => l.layer === "global")!;
    expect(layer.notApplied).toEqual(["repository"]);
    expect(layer.values).toEqual({ reviewer: "A" });
  });

  it("warns again for the same file after the warning set is reset", () => {
    writeGlobal({ bogus: 1 });
    readProjectConfig(root);
    resetLayerWarnings();
    readProjectConfig(root);
    expect(warnings()).toHaveLength(2);
  });

  it("does not apply a workspace worktree setting and names the workspace file in the warning", () => {
    const wsDir = join(base, "ws");
    writeWorkspace(wsDir, { worktree: { enabled: true }, reviewer: "A" });
    const cfg = readProjectConfig(root);
    expect(cfg.reviewer).toBe("A");
    expect(cfg.worktree?.enabled).toBeUndefined();
    const lines = warnings();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(join(wsDir, ".kf", "workspace.json"));
    expect(lines[0]).toContain("worktree");
  });
});

describe("invalid layer files", () => {
  const invalid: [string, unknown][] = [
    ["agents as a string", { agents: "claude" }],
    ["an unknown agent id", { agents: ["nope"] }],
    ["skills null", { skills: null }],
    ["reviewer not a string", { reviewer: 1 }],
    ["invalid JSON", "{not json"],
    ["a null document", "null"],
    ["an array document", "[]"],
  ];
  for (const [label, content] of invalid) {
    it(`throws a ProjectConfigError naming the global file for ${label}`, () => {
      writeGlobal(content);
      let thrown: unknown;
      try { readProjectConfig(root); } catch (err) { thrown = err; }
      expect(thrown).toBeInstanceOf(ProjectConfigError);
      expect((thrown as Error).message).toContain(globalConfigPath());
    });
  }

  it("keeps the fs error code on the error for an unreadable global file so guards can report it", () => {
    mkdirSync(globalConfigPath(), { recursive: true });
    let thrown: unknown;
    try { readProjectConfig(root); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(globalConfigPath());
    expect((thrown as NodeJS.ErrnoException).code).toBe("EISDIR");
  });

  it("throws naming the workspace file when the workspace file is invalid", () => {
    const wsDir = join(base, "ws");
    writeWorkspace(wsDir, { agents: "claude" });
    expect(() => readProjectConfig(root)).toThrow(join(wsDir, ".kf", "workspace.json"));
  });

  it("does not validate a key that does not apply", () => {
    writeGlobal({ harness: 5 });
    expect(() => readProjectConfig(root)).not.toThrow();
    expect(readProjectConfig(root).harness).toBeUndefined();
  });
});

describe("workspace discovery", () => {
  it("finds the workspace file above the project and prefers the nearest one", () => {
    const far = join(base, "ws", ".kf", "workspace.json");
    writeWorkspace(join(base, "ws"), { reviewer: "W" });
    expect(readProjectConfig(root).reviewer).toBe("W");
    const near = join(base, "ws", "a", ".kf", "workspace.json");
    writeWorkspace(join(base, "ws", "a"), { reviewer: "N" });
    expect(readProjectConfig(root).reviewer).toBe("N");
    expect(findWorkspaceConfigPath(root)).toBe(near);
    expect(findWorkspaceConfigPath(root)).not.toBe(far);
  });

  it("returns null when no workspace file exists up to the filesystem root", () => {
    expect(findWorkspaceConfigPath(root)).toBeNull();
  });

  it("does not search the project root itself", () => {
    writeWorkspace(root, { reviewer: "Self" });
    expect(findWorkspaceConfigPath(root)).toBeNull();
    expect(readProjectConfig(root).reviewer).toBeUndefined();
  });

  it("does not search the home directory", () => {
    const proj = join(homedir(), "proj");
    mkdirSync(proj, { recursive: true });
    writeWorkspace(homedir(), { reviewer: "H" });
    expect(findWorkspaceConfigPath(proj)).toBeNull();
    expect(readProjectConfig(proj).reviewer).toBeUndefined();
  });

  it("does not inherit from a parent that is itself a kf project", () => {
    const parent = join(base, "ws", "a", "b");
    ensureWorksStructure(parent);
    writeProject(parent, { reviewer: "P" });
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    expect(readProjectConfig(child).reviewer).toBeUndefined();
  });

  it("starts the walk from the root it is given, not from the working directory", () => {
    writeWorkspace(join(base, "ws"), { reviewer: "W" });
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(tmpdir());
    try {
      expect(readProjectConfig(root).reviewer).toBe("W");
    } finally {
      cwd.mockRestore();
    }
  });
});

describe("no layer files", () => {
  it("returns exactly the project file config", () => {
    writeProject(root, { reviewer: "B", agents: ["claude"] });
    expect(readProjectConfig(root)).toEqual(readProjectFileConfig(root));
    expect(readConfigLayers(root).layers.map((l) => l.layer)).toEqual(["project"]);
  });
});

describe("commands see the effective config", () => {
  it("records a cancel as done by the inherited reviewer when no --by is given", async () => {
    ensureWorksStructure(root);
    writeProject(root, { worktree: { enabled: false } });
    writeGlobal({ reviewer: "A" });
    const dir = join(root, ".works", "implementation", "demo_20260919_1200");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\n# Spec\n## FR-001\nX");
    await writeFeatureMeta(dir, { schema: "kanban-flow", feature: "demo", context: "app", created: "20260919_1200" });
    const outcome = await cancelItem(root, "demo", { reason: "x" });
    expect(outcome.kind).toBe("cancelled");
    if (outcome.kind !== "cancelled") return;
    expect(outcome.by).toBe("A");
    expect(outcome.cancellation).toMatchObject({ by: "A" });
  });
});
