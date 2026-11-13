import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { commandHelp } from "../cli/args.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const EVENTS = ["created", "opened", "reconciled", "stage", "approved", "approval-restored", "cancelled", "waiver", "linked", "delivered", "docs"];

describe("the lifecycle log is described on every declared surface", () => {
  it("artifacts.md names the file", () => {
    expect(read("docs", "workflow", "artifacts.md")).toContain("lifecycle.jsonl");
  });

  for (const event of EVENTS) {
    it(`artifacts.md names the ${event} event in backticks`, () => {
      expect(read("docs", "workflow", "artifacts.md")).toContain(`\`${event}\``);
    });
  }

  it("artifacts.md has a section for the log", () => {
    expect(read("docs", "workflow", "artifacts.md")).toMatch(/^## The lifecycle log/m);
  });

  for (const [label, parts] of [
    ["the cli reference", ["docs", "workflow", "cli-reference.md"]],
    ["the workflow README", ["docs", "workflow", "README.md"]],
    ["the README", ["README.md"]],
    ["the CHANGELOG", ["CHANGELOG.md"]],
  ] as const) {
    it(`${label} names the file`, () => {
      expect(read(...parts)).toContain("lifecycle.jsonl");
    });
  }

  it("kf doctor -h names the lifecycle log check and that --fix repairs it", () => {
    const help = commandHelp("doctor");
    expect(help).toContain("lifecycle");
    expect(help).toContain("--fix applies the repairs");
    expect(help).toContain("a missing or behind lifecycle log");
  });
});
