import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectConfig } from "../project/config.js";
import { LEGACY_HARNESS_KEYS, validateHarness } from "../project/harness-config.js";

describe("the legacy harness keys", () => {
  it("are exactly the eight keys the drive runtime used", () => {
    expect([...LEGACY_HARNESS_KEYS]).toEqual(["main", "roles", "stages", "runners", "parallel", "retries", "maxLoops", "budget"]);
  });
});

describe("validateHarness reads verify only", () => {
  it("returns the verify task and stage argv lists", () => {
    const verify = { task: [["npm", "test"]], stage: [["npm", "run", "lint"]] };
    expect(validateHarness({ verify }, "f").verify).toEqual(verify);
  });

  it("accepts a harness block with no verify", () => {
    expect(validateHarness({}, "f").verify).toBeUndefined();
  });

  it("ignores legacy keys of any type without validating them", () => {
    const verify = { task: [["npm", "test"]] };
    const legacy = {
      main: 42, roles: "x", stages: ["not", "an", "object"], runners: null,
      parallel: 0, retries: -1, maxLoops: "2", budget: [],
    };
    expect(() => validateHarness({ ...legacy, verify }, "f")).not.toThrow();
    expect(validateHarness({ ...legacy, verify }, "f").verify).toEqual(verify);
  });

  it("rejects invalid verify values naming the field", () => {
    const cases: Array<[unknown, string]> = [
      [{ task: "npm test" }, "harness.verify.task"],
      [{ task: [[]] }, "harness.verify.task[0]"],
      [{ task: [["npm", "test"], [""]] }, "harness.verify.task[1]"],
      [{ stage: [["-rf"]] }, "harness.verify.stage[0]"],
      [{ task: [["npm", "{x}"]] }, "harness.verify.task[0]"],
    ];
    for (const [verify, field] of cases) {
      expect(() => validateHarness({ verify }, "f"), JSON.stringify(verify)).toThrow(field);
      expect(() => validateHarness({ verify }, "f"), JSON.stringify(verify)).toThrow("Invalid project config");
    }
  });

  it("rejects a harness value that is not an object", () => {
    for (const value of ["x", 5, null, []]) {
      expect(() => validateHarness(value, "f"), JSON.stringify(value)).toThrow("Invalid project config");
    }
  });
});

describe("readProjectConfig with a legacy harness block", () => {
  let dir: string;
  const write = async (harness: unknown) => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", harness }));
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kf-hcfg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a config holding every legacy key and keeps its verify", async () => {
    const verify = { task: [["npm", "test"]], stage: [["npm", "run", "lint"]] };
    await write({
      main: "architect",
      roles: { architect: "claude" },
      stages: { testing: ["architect"] },
      runners: { claude: { start: ["claude", "{prompt}"] } },
      parallel: 2, retries: 0, maxLoops: 4, budget: { maxRuns: 9 },
      verify,
    });
    expect(readProjectConfig(dir).harness?.verify).toEqual(verify);
  });

  it("loads a config whose legacy keys have the wrong type", async () => {
    await write({ roles: "x", budget: [], main: 1, stages: "nobody", runners: [], parallel: "3", verify: { task: [["true"]] } });
    expect(readProjectConfig(dir).harness?.verify).toEqual({ task: [["true"]] });
  });

  it("reads a config without harness unchanged", async () => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x" }));
    expect(readProjectConfig(dir).harness).toBeUndefined();
  });
});
