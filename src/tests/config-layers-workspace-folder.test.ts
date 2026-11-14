import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { createWorkspaceFile, resolveWorkspaceFolder } from "../project/config-layers.js";

const UNAVAILABLE = "no .kf/workspace.json above this project — run kf install from the workspace folder";

let base: string;

function writeWorkspace(dir: string): void {
  mkdirSync(join(dir, ".kf"), { recursive: true });
  writeFileSync(join(dir, ".kf", "workspace.json"), "{}");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kf-wsfolder-"));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("resolveWorkspaceFolder with an existing workspace file", () => {
  it("resolves to the folder holding the file from that folder, its project and a sub-folder", () => {
    const ws = join(base, "ws");
    const repo = join(ws, "repo");
    const sub = join(repo, "sub");
    writeWorkspace(ws);
    mkdirSync(join(repo, ".works"), { recursive: true });
    mkdirSync(sub, { recursive: true });

    expect(resolveWorkspaceFolder(ws, null)).toEqual({ folder: ws, create: false });
    expect(resolveWorkspaceFolder(repo, repo)).toEqual({ folder: ws, create: false });
    expect(resolveWorkspaceFolder(sub, repo)).toEqual({ folder: ws, create: false });
  });

  it("prefers the nearest workspace file", () => {
    const outer = join(base, "outer");
    const inner = join(outer, "inner");
    writeWorkspace(outer);
    writeWorkspace(inner);
    mkdirSync(join(inner, "deep"), { recursive: true });
    expect(resolveWorkspaceFolder(join(inner, "deep"), null)).toEqual({ folder: inner, create: false });
  });

  it("skips a workspace file in the home directory", () => {
    writeWorkspace(homedir());
    const proj = join(homedir(), "proj");
    mkdirSync(join(proj, ".works"), { recursive: true });
    expect(resolveWorkspaceFolder(proj, proj)).toEqual({ unavailable: UNAVAILABLE });
  });
});

describe("resolveWorkspaceFolder without a workspace file", () => {
  it("uses a plain folder outside any project as the folder to create", () => {
    const plain = join(base, "plain");
    mkdirSync(plain, { recursive: true });
    expect(resolveWorkspaceFolder(plain, null)).toEqual({ folder: plain, create: true });
  });

  it("is unavailable from inside a project with the documented reason", () => {
    const project = join(base, "project");
    mkdirSync(join(project, ".works"), { recursive: true });
    expect(resolveWorkspaceFolder(project, project)).toEqual({ unavailable: UNAVAILABLE });
  });

  it("is unavailable from the home directory", () => {
    mkdirSync(homedir(), { recursive: true });
    expect(resolveWorkspaceFolder(homedir(), null)).toEqual({ unavailable: UNAVAILABLE });
  });
});

describe("createWorkspaceFile", () => {
  it("writes an empty JSON object to .kf/workspace.json, creating .kf", async () => {
    const folder = join(base, "fresh");
    mkdirSync(folder, { recursive: true });
    await createWorkspaceFile(folder);
    const file = join(folder, ".kf", "workspace.json");
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
  });
});
