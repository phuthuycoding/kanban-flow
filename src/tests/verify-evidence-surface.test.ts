import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { commandHelp } from "../cli/args.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const skill = (name: string) => read("skills", name, "SKILL.md");

describe("the stage record is the gate into review in the agent-facing contract", () => {
  for (const name of ["implement", "test", "flow"]) {
    it(`${name} names the stage record as the gate and kf verify --stage`, () => {
      const text = skill(name);
      expect(text).toContain("the stage record is the gate into review");
      expect(text).toContain("`kf verify <f> --stage`");
    });
  }

  it("implement names --waive and allows it only on the human's word", () => {
    const text = skill("implement");
    expect(text).toContain("`--waive`");
    expect(text).toContain("only on the human's word");
  });

  it("flow names --waive", () => {
    expect(skill("flow")).toContain("`--waive`");
  });

  it("review names the Stage verify line and kf status --change", () => {
    const text = skill("review");
    expect(text).toContain("Stage verify");
    expect(text).toContain("`kf status --change`");
  });

  it("the review report template has a verify row in the Delivery table", () => {
    const template = read("kanban-flow", "templates", "phase-5-review-report.md");
    const start = template.indexOf("## Delivery");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = template.indexOf("\n## ", start + 1);
    const delivery = template.slice(start, next === -1 ? undefined : next);
    expect(delivery).toMatch(/^\| `verify` \|/m);
  });
});

describe("command help names the record and the waiver", () => {
  it("kf verify -h names --waive", () => {
    expect(commandHelp("verify")).toContain("--waive");
  });

  it("kf stage -h names the stage verify record", () => {
    expect(commandHelp("stage")).toContain("stage verify record");
  });
});
