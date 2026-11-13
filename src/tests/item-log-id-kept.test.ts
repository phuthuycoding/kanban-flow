import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { foldItemLog, itemLogPath, sharedMeta, withItemId } from "../workflow/item-log.js";
import { ensureWorksStructure, findFeature, updateFeatureMeta } from "../workflow/features.js";
import type { FeatureMeta } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import type { ParsedArgs } from "../cli/args.js";

vi.setConfig({ testTimeout: 60_000 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = "0b6f2a54-3c1d-4c63-9a0e-5d1f6f1f7a11";
const OTHER = "9f1e2d3c-4b5a-4968-8776-655443322110";
const BASE: FeatureMeta = { schema: "kanban-flow", feature: "demo", context: "app", created: "2026-11-13T04:09:00.000Z" };
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

// `withItemId` takes the item folder as a second argument from this round on; call it through a
// wider signature so the file also loads against the one-parameter version.
const withId = withItemId as unknown as <T extends FeatureMeta>(meta: T, dir?: string) => T;

let scratch: string;
let dir: string;

const logLine = (rec: Record<string, unknown>): string => JSON.stringify({
  v: 1, at: "2026-11-13T05:00:00.000Z", actor: "t", origin: { machine: "m", via: "cli" }, ...rec,
});
const writeLog = (...recs: Array<Record<string, unknown>>): void => {
  writeFileSync(itemLogPath(dir), recs.map(logLine).join("\n") + "\n");
};

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "kf-idkept-")));
  dir = join(scratch, "item");
  mkdirSync(dir, { recursive: true });
  vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("an item's id is generated once", () => {
  it("mints a uuid for metadata with no id when no folder is given", () => {
    const stamped = withId(BASE);
    expect(stamped.id).toMatch(UUID);
    expect(BASE).not.toHaveProperty("id");
  });

  it("returns the id the item's log folds to when the metadata lost its own, without changing the input", () => {
    writeLog({ event: "created", stage: "implementation", set: { ...BASE, id: KNOWN } });
    const input = { ...BASE };
    const stamped = withId(input, dir);
    expect(stamped.id).toBe(KNOWN);
    expect(input).not.toHaveProperty("id");
    expect(stamped).toEqual({ ...BASE, id: KNOWN });
  });

  it("mints a uuid when the folder has no log", () => {
    expect(withId(BASE, dir).id).toMatch(UUID);
  });

  it("mints a uuid, without throwing, when the log is unreadable", () => {
    writeFileSync(itemLogPath(dir), "this is not json\n");
    let stamped: FeatureMeta | undefined;
    expect(() => { stamped = withId(BASE, dir); }).not.toThrow();
    expect(stamped?.id).toMatch(UUID);
  });

  it("mints a uuid when the log folds to a state with no id", () => {
    writeLog({ event: "created", stage: "implementation", set: { ...BASE } });
    expect(withId(BASE, dir).id).toMatch(UUID);
  });

  it("keeps the id the metadata has even when the log holds another", () => {
    writeLog({ event: "created", stage: "implementation", set: { ...BASE, id: KNOWN } });
    const own = { ...BASE, id: OTHER };
    const stamped = withId(own, dir);
    expect(stamped.id).toBe(OTHER);
    expect(stamped).toBe(own);
  });
});

describe("an event write on an item whose metadata lost its id", () => {
  it("restores the id from the log and appends no record that sets an id", async () => {
    const root = join(scratch, "repo");
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["-C", root, "init", "-q"]);
    execFileSync("git", ["-C", root, "config", "user.email", "t@t"]);
    execFileSync("git", ["-C", root, "config", "user.name", "t"]);
    writeFileSync(join(root, ".gitignore"), ".works/\n");
    execFileSync("git", ["-C", root, "add", "-A"]);
    execFileSync("git", ["-C", root, "commit", "-qm", "init"]);
    ensureWorksStructure(root);
    mkdirSync(join(root, ".kf"), { recursive: true });
    writeFileSync(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
    }));
    const made = await cmdNew(args("new", ["demo"], { context: "app" }), root);
    if (made.code !== 0) throw new Error(`fixture: kf new failed: ${made.stdout}${made.stderr ?? ""}`);

    const item = findFeature(root, "demo")!;
    const logPath = itemLogPath(item.dir);
    const created = foldItemLog(readFileSync(logPath, "utf8"));
    if (!created.ok || typeof created.state?.meta.id !== "string") throw new Error("fixture: kf new left no id in the log");
    const id = created.state.meta.id;
    const linesBefore = readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "").length;

    // A hand edit that drops the id from the snapshot while the log still holds it.
    const metaFile = join(item.dir, ".kfw.json");
    const raw = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    delete raw.id;
    writeFileSync(metaFile, JSON.stringify(raw, null, 2));
    expect(findFeature(root, "demo")!.meta).not.toHaveProperty("id");

    await updateFeatureMeta(root, "demo", (meta) => ({ ...meta, pr: "https://github.com/acme/app/pull/4" }), {}, "linked");

    const after = findFeature(root, "demo")!;
    expect(after.meta?.id).toBe(id);
    const records = readFileSync(logPath, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as { event: string; set?: Record<string, unknown>; unset?: string[] });
    const added = records.slice(linesBefore);
    for (const rec of added) {
      expect(rec.set ?? {}).not.toHaveProperty("id");
      expect(rec.unset ?? []).not.toContain("id");
    }
    expect(added.some((r) => r.event === "linked")).toBe(true);
    const folded = foldItemLog(readFileSync(logPath, "utf8"));
    expect(folded).toMatchObject({ ok: true, state: { stage: after.stage, meta: sharedMeta(after.meta!) } });
  });
});
