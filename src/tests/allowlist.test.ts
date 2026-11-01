import { describe, it, expect } from "vitest";

import { pathAllowed } from "../workflow/allowlist.js";

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
