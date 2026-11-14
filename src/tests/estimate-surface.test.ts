import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const SKILLS = join(PKG_ROOT, "assets", "skills");
const TRAVEL = join(SKILLS, "travel");
const readSkill = (...parts: string[]) => readFileSync(join(SKILLS, ...parts), "utf8");

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** SKILL.md plus every travel reference: the text the travel skill ships. */
function travelText(): string {
  return walk(TRAVEL).filter((p) => p.endsWith(".md")).map((p) => readFileSync(p, "utf8")).join("\n");
}

describe("the travel skill reads harness estimates", () => {
  const skill = readSkill("travel", "SKILL.md");

  it.each(["size", "stats", "overlap", "show"])("calls kf estimate %s", (sub) => {
    expect(skill).toMatch(new RegExp(`kf estimate ${sub}\\b`));
  });

  it("no longer ships the estimates script", () => {
    expect(existsSync(join(TRAVEL, "scripts", "estimates"))).toBe(false);
  });

  it("has no measure step", () => {
    expect(travelText()).not.toMatch(/\bmeasure\b/i);
  });

  it("never appends to the travel estimates file", () => {
    expect(travelText()).not.toMatch(/\.kf\/travel\/estimates\.md/);
  });

  it("keeps only the plan in the day-section line", () => {
    const text = travelText();
    for (const field of ["est0=", "estmin=", "work=", "review="]) {
      expect(text, field).not.toContain(field);
    }
  });

  it("sizes an item without a recorded estimate for the day and says so on its line", () => {
    expect(skill).toMatch(/no item estimate/i);
  });
});

describe("no shipped text references the retired script", () => {
  it("has no scripts/estimates reference under assets/skills", () => {
    const hits = walk(SKILLS).filter((p) => readFileSync(p, "utf8").includes("scripts/estimates"));
    expect(hits).toEqual([]);
  });

  it("has no scripts/estimates reference under docs/workflow", () => {
    const dir = join(PKG_ROOT, "docs", "workflow");
    const hits = walk(dir).filter((p) => readFileSync(p, "utf8").includes("scripts/estimates"));
    expect(hits).toEqual([]);
  });
});

describe("the other skills describe estimation as harness data", () => {
  it("implement no longer records the loop row by hand", () => {
    expect(readSkill("implement", "SKILL.md")).not.toMatch(/kf loop-stats\s+\S+\s+--record/);
  });

  it("flow lists kf estimate and kf metrics", () => {
    const flow = readSkill("flow", "SKILL.md");
    expect(flow).toMatch(/kf estimate\b/);
    expect(flow).toMatch(/kf metrics\b/);
  });

  it.each(["plan", "bug"])("%s tells the agent to fill the Estimate section with agent minutes", (name) => {
    const text = readSkill(name, "SKILL.md");
    expect(text).toContain("## Estimate");
    expect(text).toMatch(/- Agent minutes:/);
  });
});
