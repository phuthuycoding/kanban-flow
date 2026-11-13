import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Bypass } from "../workflow/features.js";
import { itemLogPath, readItemLog, recordChange, sharedMeta } from "../workflow/item-log.js";

const BASE = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
const AT = "2026-11-13T05:00:00.000Z";

let scratch: string;
let root: string;
let dir: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-hookpath-")));
  root = join(scratch, "repo");
  dir = join(root, ".works", "implementation", "demo_20261113_0409");
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test Author"]);
  vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

const bypassesOf = (meta: object): Array<{ at: string; from: string; to: string; flag: string; codes: string[] }> =>
  (sharedMeta(meta) as unknown as { bypasses: Array<{ at: string; from: string; to: string; flag: string; codes: string[] }> }).bypasses;

describe("hook paths in the shared metadata", () => {
  it("keeps only the file name of a skipped hook given as an absolute POSIX path, without touching the input", () => {
    const input = { ...BASE, bypasses: [{ at: AT, from: "review", to: "done", flag: "skip-hooks", codes: ["hook:/home/u/proj/.kf/hooks/review.sh"] }] };
    const out = bypassesOf(input);
    expect(out).toEqual([{ at: AT, from: "review", to: "done", flag: "skip-hooks", codes: ["hook:review.sh"] }]);
    expect(input.bypasses[0].codes).toEqual(["hook:/home/u/proj/.kf/hooks/review.sh"]);
  });

  it("keeps only the file name of a skipped hook given as a Windows path", () => {
    const input = { ...BASE, bypasses: [{ at: AT, from: "review", to: "done", flag: "skip-hooks", codes: ["hook:C:\\Users\\u\\.kf\\hooks\\done.sh"] }] };
    expect(bypassesOf(input)[0].codes).toEqual(["hook:done.sh"]);
    expect(input.bypasses[0].codes).toEqual(["hook:C:\\Users\\u\\.kf\\hooks\\done.sh"]);
  });

  it("leaves validation codes and an already bare hook name as they are", () => {
    const bypasses = [
      { at: AT, from: "review", to: "done", flag: "force", codes: ["gate_failed", "review_not_pass"] },
      { at: AT, from: "testing", to: "review", flag: "skip-hooks", codes: ["hook:review.sh"] },
    ];
    expect(bypassesOf({ ...BASE, bypasses })).toEqual(bypasses);
  });
});

describe("recording a skipped hook", () => {
  const hookPath = (): string => join(root, ".kf", "hooks", "review.sh");
  const before = () => ({ stage: "review" as const, meta: { ...BASE } });
  const after = () => {
    const bypasses: Bypass[] = [{ at: AT, from: "review", to: "done", flag: "skip-hooks", codes: [`hook:${hookPath()}`] }];
    return { stage: "done" as const, meta: { ...BASE, bypasses } };
  };

  it("writes the hook's file name, never its directory, into the log line", () => {
    recordChange(root, dir, "demo", "stage", before(), after());

    const text = readFileSync(itemLogPath(dir), "utf8");
    const all = text.split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { event: string; set?: { bypasses?: Array<{ codes: string[] }> } });
    const stage = all.find((r) => r.event === "stage")!;
    expect(stage.set?.bypasses?.[0].codes).toEqual(["hook:review.sh"]);
    expect(text).not.toContain(root);
    expect(text).not.toContain(homedir());
  });

  it("folds to the projected snapshot and appends nothing when the same change is recorded again", () => {
    recordChange(root, dir, "demo", "stage", before(), after());
    const folded = readItemLog(dir);
    expect(folded.ok).toBe(true);
    if (folded.ok) expect(folded.state).toEqual({ stage: "done", meta: sharedMeta(after().meta) });

    const bytes = readFileSync(itemLogPath(dir));
    recordChange(root, dir, "demo", "stage", after(), after());
    expect(readFileSync(itemLogPath(dir)).equals(bytes)).toBe(true);
  });
});
