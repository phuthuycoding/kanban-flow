import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeConfigPreserving, patchProjectConfig } from "../project/config.js";

type Obj = Record<string, unknown>;

/** Apply a change to the parsed text the way a repair does, then serialise it back. */
function rewrite(text: string, change: (o: Obj) => void): { out: string; next: Obj } {
  const next = JSON.parse(text) as Obj;
  change(next);
  return { out: serializeConfigPreserving(text, next), next };
}

describe("layout-preserving config serialiser", () => {
  it("keeps inline arrays on one line when another key is removed", () => {
    const text = '{\n  "schema": "kanban-flow",\n  "stacks": ["node", "php"],\n  "stack": "node",\n  "contexts": ["app", "web"]\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.stack; });
    expect(out).toBe('{\n  "schema": "kanban-flow",\n  "stacks": ["node", "php"],\n  "contexts": ["app", "web"]\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("keeps inline nested objects and multi-line objects byte-identical", () => {
    const text = '{\n  "worktree": {"enabled": true},\n  "project": {\n    "owner": "me",\n    "n": 1\n  },\n  "drop": 1\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.drop; });
    expect(out).toBe('{\n  "worktree": {"enabled": true},\n  "project": {\n    "owner": "me",\n    "n": 1\n  }\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("removes the first key", () => {
    const text = '{\n  "a": [1, 2],\n  "b": [3, 4],\n  "c": "x"\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.a; });
    expect(out).toBe('{\n  "b": [3, 4],\n  "c": "x"\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("removes a middle key", () => {
    const text = '{\n  "a": [1, 2],\n  "b": [3, 4],\n  "c": "x"\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.b; });
    expect(out).toBe('{\n  "a": [1, 2],\n  "c": "x"\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("removes the last key without leaving a trailing comma", () => {
    const text = '{\n  "a": [1, 2],\n  "b": [3, 4],\n  "c": "x"\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.c; });
    expect(out).toBe('{\n  "a": [1, 2],\n  "b": [3, 4]\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("re-serialises a changed key with the file indent and leaves the rest alone", () => {
    const text = '{\n  "a": ["x", "y"],\n  "project": {"owner": "me"},\n  "z": [9]\n}\n';
    const { out, next } = rewrite(text, (o) => { o.project = { owner: "me", number: 3 }; });
    expect(out).toBe('{\n  "a": ["x", "y"],\n  "project": {\n    "owner": "me",\n    "number": 3\n  },\n  "z": [9]\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("appends an added key at the end with the file indent", () => {
    const text = '{\n  "a": ["x", "y"],\n  "b": {"k": 1}\n}\n';
    const { out, next } = rewrite(text, (o) => { o.repository = { owner: "o", name: "n" }; });
    expect(out).toBe('{\n  "a": ["x", "y"],\n  "b": {"k": 1},\n  "repository": {\n    "owner": "o",\n    "name": "n"\n  }\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("appends a scalar key with a four-space indent when the file uses four spaces", () => {
    const text = '{\n    "a": ["x", "y"]\n}\n';
    const { out, next } = rewrite(text, (o) => { o.b = 1; });
    expect(out).toBe('{\n    "a": ["x", "y"],\n    "b": 1\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("keeps tab indent for changed and added keys", () => {
    const text = '{\n\t"a": ["x", "y"],\n\t"obj": {"k": 1},\n\t"gone": 1\n}\n';
    const { out, next } = rewrite(text, (o) => {
      delete o.gone;
      o.obj = { k: 1, j: 2 };
      o.added = { q: 1 };
    });
    expect(out).toBe('{\n\t"a": ["x", "y"],\n\t"obj": {\n\t\t"k": 1,\n\t\t"j": 2\n\t},\n\t"added": {\n\t\t"q": 1\n\t}\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("keeps a missing trailing newline missing", () => {
    const text = '{\n  "a": [1, 2],\n  "b": 1\n}';
    const { out, next } = rewrite(text, (o) => { delete o.b; });
    expect(out).toBe('{\n  "a": [1, 2]\n}');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("keeps the trailing newline", () => {
    const text = '{\n  "a": [1, 2],\n  "b": 1\n}\n';
    const { out } = rewrite(text, (o) => { delete o.b; });
    expect(out.endsWith("}\n")).toBe(true);
    expect(out.endsWith("}\n\n")).toBe(false);
  });

  it("keeps untouched strings that contain brackets, quotes, escapes and commas", () => {
    const text = '{\n  "tricky": ["a]", "{b", "c\\"d", "e,f", "g\\\\"],\n  "note": "} , { \\" [",\n  "gone": 1\n}\n';
    const { out, next } = rewrite(text, (o) => { delete o.gone; });
    expect(out).toBe('{\n  "tricky": ["a]", "{b", "c\\"d", "e,f", "g\\\\"],\n  "note": "} , { \\" ["\n}\n');
    expect(JSON.parse(out)).toEqual(next);
  });

  it("writes a fully expanded config exactly as JSON.stringify does", () => {
    const obj = { schema: "kanban-flow", stacks: ["node", "php"], project: { owner: "me", n: 1 }, flag: true };
    const text = `${JSON.stringify(obj, null, 2)}\n`;
    const { out, next } = rewrite(text, (o) => { delete o.flag; o.extra = [1]; });
    expect(out).toBe(`${JSON.stringify(next, null, 2)}\n`);
  });

  it("writes a fully expanded tab config exactly as JSON.stringify does", () => {
    const obj = { a: [1, 2], b: { c: 1 } };
    const text = `${JSON.stringify(obj, null, "\t")}\n`;
    const { out, next } = rewrite(text, (o) => { o.a = [1, 2, 3]; });
    expect(out).toBe(`${JSON.stringify(next, null, "\t")}\n`);
  });

  it("returns the original text when nothing changed", () => {
    const text = '{\n  "a": [1, 2],\n  "b": {"k": 1}\n}\n';
    const { out } = rewrite(text, () => undefined);
    expect(out).toBe(text);
  });
});

describe("patchProjectConfig layout", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "kf-config-layout-"));
    await mkdir(join(root, ".kf"), { recursive: true });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("adds one key and leaves every other key's text byte-identical", async () => {
    const text = '{\n  "schema": "kanban-flow",\n  "stacks": ["node", "php"],\n  "worktree": {"enabled": true},\n  "contexts": ["app", "web"]\n}\n';
    const f = join(root, ".kf", "config.json");
    await writeFile(f, text);
    await patchProjectConfig(root, { agents: ["claude"] });
    const after = await readFile(f, "utf8");
    expect(after).toBe(
      '{\n  "schema": "kanban-flow",\n  "stacks": ["node", "php"],\n  "worktree": {"enabled": true},\n  "contexts": ["app", "web"],\n  "agents": [\n    "claude"\n  ]\n}\n',
    );
  });

  it("replaces one key and leaves the others inline", async () => {
    const text = '{\n  "schema": "kanban-flow",\n  "stacks": ["node", "php"],\n  "contexts": ["app", "web"]\n}\n';
    const f = join(root, ".kf", "config.json");
    await writeFile(f, text);
    await patchProjectConfig(root, { schema: "other" });
    expect(await readFile(f, "utf8")).toBe('{\n  "schema": "other",\n  "stacks": ["node", "php"],\n  "contexts": ["app", "web"]\n}\n');
  });
});
