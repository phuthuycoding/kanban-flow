import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  assertInventoryMatches,
  formatPruneDryRun,
  selectPruneSets,
  type Release,
} from "./helpers/release-prune.js";

const specReleases: Release[] = [
  { tagName: "v0.13.0", publishedAt: "2026-10-28T03:20:18Z" },
  { tagName: "v0.12.0", publishedAt: "2026-10-17T15:06:40Z" },
  { tagName: "v0.11.5", publishedAt: "2026-10-15T16:52:39Z" },
  { tagName: "v0.11.4", publishedAt: "2026-10-15T13:55:18Z" },
  { tagName: "v0.11.3", publishedAt: "2026-10-15T13:20:53Z" },
  { tagName: "v0.11.2", publishedAt: "2026-10-14T16:17:44Z" },
  { tagName: "v0.11.1", publishedAt: "2026-10-14T15:53:27Z" },
  { tagName: "v0.11.0", publishedAt: "2026-10-14T15:20:48Z" },
  { tagName: "v0.10.0", publishedAt: "2026-10-14T02:15:15Z" },
  { tagName: "v0.9.0", publishedAt: "2026-10-12T14:40:00Z" },
  { tagName: "v0.8.0", publishedAt: "2026-10-10T13:53:14Z" },
  { tagName: "v0.7.0", publishedAt: "2026-10-10T06:36:42Z" },
  { tagName: "v0.6.0", publishedAt: "2026-10-09T12:08:14Z" },
  { tagName: "v0.5.0", publishedAt: "2026-10-03T03:00:56Z" },
];

const leftoverOnly = ["v2.0.0", "v1.1.0", "v1.0.0", "v0.4.1", "v0.4.0"];
const remoteTags = [...specReleases.map((r) => r.tagName), ...leftoverOnly];

const KEEP = ["v0.13.0", "v0.12.0", "v0.11.5", "v0.11.4", "v0.11.3"];
const DELETE_RELEASES = [
  "v0.11.2",
  "v0.11.1",
  "v0.11.0",
  "v0.10.0",
  "v0.9.0",
  "v0.8.0",
  "v0.7.0",
  "v0.6.0",
  "v0.5.0",
];

describe("selectPruneSets", () => {
  it("TC-001 keeps the five newest by publishedAt, not semver", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    expect(plan.keep).toEqual(KEEP);
    expect(plan.keep).not.toContain("v2.0.0");
    expect(plan.reason).toBeUndefined();
  });

  it("TC-002 lists GitHub Releases outside the keep set", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    expect(plan.deleteReleases).toEqual(DELETE_RELEASES);
    expect(plan.deleteReleases.some((t) => KEEP.includes(t))).toBe(false);
  });

  it("TC-003 lists leftover remote tags including installer and pre-rewrite tags", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    for (const t of leftoverOnly) expect(plan.leftoverTags).toContain(t);
    for (const t of KEEP) expect(plan.leftoverTags).not.toContain(t);
  });

  it("TC-005 applying the plan leaves five releases and five tags", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    const remainingReleases = specReleases.filter((r) => !plan.deleteReleases.includes(r.tagName));
    const remainingTags = remoteTags.filter(
      (t) => !plan.deleteReleases.includes(t) && !plan.leftoverTags.includes(t),
    );
    expect(remainingReleases).toHaveLength(5);
    expect(remainingTags.sort()).toEqual([...KEEP].sort());
  });

  it("TC-008 fewer than five releases is a no-op", () => {
    const four = specReleases.slice(0, 4);
    const plan = selectPruneSets(four, [...four.map((r) => r.tagName), ...leftoverOnly], 5);
    expect(plan.keep).toEqual(four.map((r) => r.tagName));
    expect(plan.deleteReleases).toEqual([]);
    expect(plan.leftoverTags).toEqual([]);
    expect(plan.reason).toMatch(/fewer than 5/);
  });
});

describe("formatPruneDryRun", () => {
  it("TC-004 prints keep, delete-releases and leftover-tags without mutating the plan", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    const snapshot = structuredClone(plan);
    const text = formatPruneDryRun(plan);
    expect(text).toContain("keep:");
    for (const t of KEEP) expect(text).toContain(t);
    expect(text).toContain("delete-releases:");
    for (const t of DELETE_RELEASES) expect(text).toContain(`  ${t}`);
    expect(text).toContain("leftover-tags:");
    for (const t of leftoverOnly) expect(text).toContain(t);
    expect(formatPruneDryRun(plan)).toBe(text);
    expect(plan).toEqual(snapshot);
  });
});

describe("assertInventoryMatches", () => {
  it("TC-006 throws when live inventory differs and passes on the original fixture", () => {
    const plan = selectPruneSets(specReleases, remoteTags, 5);
    expect(() => assertInventoryMatches(plan, specReleases, remoteTags)).not.toThrow();
    const live = [
      { tagName: "v0.14.0", publishedAt: "2026-10-29T00:00:00Z" },
      ...specReleases,
    ];
    expect(() => assertInventoryMatches(plan, live, [...remoteTags, "v0.14.0"])).toThrow(/inventory mismatch/);
  });
});

describe("helper has no process runner", () => {
  it("TC-007 source does not spawn processes or name npm/gh/git runners", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "helpers/release-prune.ts"), "utf8");
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\b(execFileSync|execSync|spawnSync|spawn)\b/);
    expect(src).not.toMatch(/\bnpm\b/);
    expect(src).not.toMatch(/\bgh\b/);
    expect(src).not.toMatch(/\bgit\b/);
  });
});
