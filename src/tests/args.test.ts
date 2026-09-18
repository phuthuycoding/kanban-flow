import { describe, it, expect } from "vitest";
import { parseArgsCli } from "../cli/args.js";

describe("CLI argument validation", () => {
  it("rejects misspelled flags instead of silently weakening gates", () => {
    expect(() => parseArgsCli(["validate", "--strcit", "--all"])).toThrow();
    expect(() => parseArgsCli(["stage", "demo", "review", "--skip-hook"])).toThrow();
  });

  it("rejects missing string values and supports command help", () => {
    expect(() => parseArgsCli(["new", "demo", "--context"])).toThrow();
    expect(parseArgsCli(["stage", "--help"]).options.help).toBe(true);
  });
});
