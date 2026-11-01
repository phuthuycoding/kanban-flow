import { describe, it, expect } from "vitest";

import { filesOverlap, pathAllowed, patternsOverlap } from "../workflow/allowlist.js";

describe("pathAllowed", () => {
  it("matches exact paths, directory prefixes and globs", () => {
    expect(pathAllowed("src/a.ts", ["src/a.ts"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["src"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["./src/"])).toBe(true);
    expect(pathAllowed("srcs/a.ts", ["src"])).toBe(false);
    expect(pathAllowed("src/x/a.ts", ["src/**/*.ts"])).toBe(true);
    expect(pathAllowed("src/a.ts", ["src/**/*.ts"])).toBe(true);
    expect(pathAllowed("src/x/a.ts", ["src/*.ts"])).toBe(false);
    expect(pathAllowed("src/a.ts", ["src/?.ts"])).toBe(true);
    expect(pathAllowed("src/ab.ts", ["src/?.ts"])).toBe(false);
    expect(pathAllowed("docs/a.md", ["src/**", "`docs/*.md`"])).toBe(true);
  });
});

describe("patternsOverlap", () => {
  it.each([
    ["src/a.ts", "src/", true],
    ["src", "src/a.ts", true],
    ["./src/a.ts", "`src/`", true],
    ["src/a/*.ts", "src/b/*.ts", false],
    ["*", "anything/at/all.ts", true],
    ["**", "src/a.ts", true],
    [".", "src/a.ts", true],
    ["src/a.ts", "src/b.ts", false],
    ["src/**", "src/x/y.ts", true],
    ["docs/a.md", "docs/a.md", true],
    ["src/a", "src/ab", false],
    ["src/a", "src/ab/c.ts", false],
    ["src/a*.ts", "src/b.ts", true],
    ["src/a/*.ts", "src/a/x.ts", true],
  ])("%s ~ %s = %s", (a, b, expected) => {
    expect(patternsOverlap(a, b)).toBe(expected);
    expect(patternsOverlap(b, a)).toBe(expected);
  });
});

describe("filesOverlap", () => {
  it("treats unknown files as overlapping everything", () => {
    expect(filesOverlap(null, ["src/a.ts"])).toBe(true);
    expect(filesOverlap(["src/a.ts"], null)).toBe(true);
    expect(filesOverlap(null, null)).toBe(true);
  });
  it("compares every pair of patterns", () => {
    expect(filesOverlap(["a/x.ts", "b/y.ts"], ["c/z.ts", "b/"])).toBe(true);
    expect(filesOverlap(["a/x.ts"], ["b/y.ts"])).toBe(false);
    expect(filesOverlap([], ["b/y.ts"])).toBe(false);
  });
});

describe("a bracket in a Files entry", () => {
  // Files names real paths such as src/[id].ts, so a bracket is a literal character, not a character class.
  it("allows exactly the literal path and not the class it would spell", () => {
    expect(pathAllowed("src/[id].ts", ["src/[id].ts"])).toBe(true);
    expect(pathAllowed("src/i.ts", ["src/[id].ts"])).toBe(false);
    expect(pathAllowed("src/d.ts", ["src/[id].ts"])).toBe(false);
  });

  it("still allows a directory prefix of the literal path", () => {
    expect(pathAllowed("src/[id]/page.ts", ["src/[id]"])).toBe(true);
  });

  it("overlaps by the same literal reading", () => {
    expect(patternsOverlap("src/[id].ts", "src/[id].ts")).toBe(true);
    expect(patternsOverlap("src/[id].ts", "src/i.ts")).toBe(false);
    expect(patternsOverlap("src/i.ts", "src/[id].ts")).toBe(false);
    expect(patternsOverlap("src/[id]/page.ts", "src/[id]")).toBe(true);
    expect(filesOverlap(["src/[id].ts"], ["src/i.ts"])).toBe(false);
  });
});
