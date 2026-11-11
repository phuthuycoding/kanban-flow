import { describe, it, expect } from "vitest";
import { commandHelp, parseArgsCli } from "../cli/args.js";

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

describe("CLI arguments for living docs", () => {
  it("validate takes a --base ref and names it in its help", () => {
    expect(parseArgsCli(["validate", "--all", "--base", "main"]).options.base).toBe("main");
    expect(() => parseArgsCli(["validate", "--all", "--base"])).toThrow();
    expect(commandHelp("validate")).toContain("--base");
  });

  it("archive parses --skip-specs and cancel parses --purge-docs as booleans", () => {
    expect(parseArgsCli(["archive", "demo", "--skip-specs"]).options["skip-specs"]).toBe(true);
    expect(parseArgsCli(["cancel", "demo", "--reason", "x", "--purge-docs"]).options["purge-docs"]).toBe(true);
  });

  it("cancel and archive help no longer advertise the refused flags or the removed canonical-docs step", () => {
    expect(commandHelp("cancel")).not.toContain("[--purge-docs]");
    const archive = commandHelp("archive");
    expect(archive).not.toContain("canonical docs");
    expect(archive).not.toContain("[--skip-specs]");
  });

  it("instruct help lists the living-doc artifacts", () => {
    const help = commandHelp("instruct");
    expect(help).toContain("living-doc-index");
    expect(help.replace("living-doc-index", "")).toContain("living-doc");
  });
});
