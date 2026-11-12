import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { commandHelp } from "../cli/args.js";
import { relatedArgv } from "../workflow/verify.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const skill = (name: string) => read("assets", "skills", name, "SKILL.md");
const STATUS_RULE = "only when `kf status` does not show PASS at HEAD";

describe("this repository's verify tiers", () => {
  const config = JSON.parse(read(".kf", "config.json"));

  it("pins typecheck as the task command, a related-tests argv and build plus suite for the stage", () => {
    expect(config.harness.verify.task).toEqual([["npm", "run", "typecheck"]]);
    expect(config.harness.verify.related).toEqual(["npx", "vitest", "related", "--run"]);
    expect(config.harness.verify.stage).toEqual([["npm", "run", "build"], ["npm", "test"]]);
  });

  it("appends the changed files to the related argv", () => {
    expect(relatedArgv(config.harness.verify.related, ["src/a.ts"])).toEqual(["npx", "vitest", "related", "--run", "src/a.ts"]);
  });

  // The ordering and appended files of --task are run end to end in verify-related.test.ts with stub scripts;
  // this pins that the repository's own config yields typecheck first, then the related vitest argv.
  it("drives the task tier as typecheck, then vitest related on the changed source file", () => {
    const commands = [...config.harness.verify.task, relatedArgv(config.harness.verify.related, ["src/workflow/verify.ts"])];
    expect(commands).toEqual([["npm", "run", "typecheck"], ["npx", "vitest", "related", "--run", "src/workflow/verify.ts"]]);
  });
});

describe("the agent contract names the verify tiers", () => {
  it("implement names the related tier, the wave verify action, its ledger line, the Wave verify decide and the status rule", () => {
    const text = skill("implement");
    expect(text).toContain("harness.verify.related");
    expect(text).toContain("`kf verify <f> --wave <w>`");
    expect(text).toContain("wave <w>: verify started");
    expect(text).toContain("Wave verify");
    expect(text).toContain(STATUS_RULE);
  });

  it("the task loop reference names the wave done line and the wave reopen source", () => {
    const text = read("assets", "skills", "implement", "references", "task-loop.md");
    expect(text).toContain("wave <w>: verify done exit=<n>");
    expect(text).toContain("reopened — wave <w>");
  });

  it("the task loop reference names who writes the wave lines and why waves exist", () => {
    const text = read("assets", "skills", "implement", "references", "task-loop.md");
    expect(text).toContain("wave-verify-started");
    expect(text).toContain("Why waves");
  });

  it("flow names the wave verify command and implement names the wave verify exit 3 decide", () => {
    expect(skill("flow")).toContain("kf verify {feature} --wave <w>");
    expect(skill("implement")).toContain("Wave verify exit 3");
  });

  for (const name of ["flow"]) {
    it(`${name} runs the stage verify only when kf status does not show PASS at HEAD`, () => {
      expect(skill(name)).toContain(STATUS_RULE);
    });
  }

  it("kf verify help names --wave and harness.verify.related", () => {
    const help = commandHelp("verify");
    expect(help).toContain("--wave");
    expect(help).toContain("harness.verify.related");
  });

  it("kf record help names wave-verify-started", () => {
    expect(commandHelp("record")).toContain("wave-verify-started");
  });
});
