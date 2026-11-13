import { describe, it, expect } from "vitest";

import { foldItemLog } from "../workflow/item-log.js";

// A replicated log is read by a program that did not write it (#184), so the fold applies only the
// shared metadata keys: a key the log should never hold changes nothing.
const BASE = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
const HEAD = '"v":1,"at":"2026-11-13T05:00:00.000Z","actor":"t","origin":{"machine":"m","via":"cli"}';
const created = `{${HEAD},"event":"created","stage":"planning","set":${JSON.stringify(BASE)}}`;
// Written as raw JSON: an object literal with a `__proto__` key sets the prototype instead of a key.
const record = (body: string): string => `{${HEAD},"event":"linked",${body}}`;

function foldMeta(...lines: string[]): Record<string, unknown> {
  const result = foldItemLog([created, ...lines].join("\n") + "\n");
  if (!result.ok || !result.state) throw new Error(`fold failed: ${JSON.stringify(result)}`);
  return result.state.meta as unknown as Record<string, unknown>;
}

describe("folding a log applies only the shared metadata keys", () => {
  it("ignores a __proto__ key in set, so the metadata keeps its prototype and no inherited value", () => {
    const meta = foldMeta(record('"set":{"__proto__":{"feature":"spoofed","id":"spoofed"}}'));
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(Object.hasOwn(meta, "__proto__")).toBe(false);
    expect(meta.feature).toBe("demo");
    expect(meta.id).toBeUndefined();
    expect(meta).toEqual(BASE);
  });

  it("ignores constructor, worktree and an unknown key in set", () => {
    const meta = foldMeta(record('"set":{"constructor":{"x":1},"worktree":{"path":"/tmp/x","branch":"b"},"extra":1,"pr":"https://github.com/acme/app/pull/7"}'));
    expect(Object.hasOwn(meta, "constructor")).toBe(false);
    expect(Object.hasOwn(meta, "worktree")).toBe(false);
    expect(Object.hasOwn(meta, "extra")).toBe(false);
    expect(meta).toEqual({ ...BASE, pr: "https://github.com/acme/app/pull/7" });
  });

  it("changes nothing on an unset of __proto__ or an unknown key, and still removes a shared key", () => {
    const meta = foldMeta(
      record('"set":{"pr":"https://github.com/acme/app/pull/7","goal":"g"}'),
      record('"unset":["__proto__","extra","pr"]'),
    );
    expect(Object.getPrototypeOf(meta)).toBe(Object.prototype);
    expect(meta).toEqual({ ...BASE, goal: "g" });
  });
});
