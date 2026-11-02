import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readProjectConfig } from "../project/config.js";
import { DEFAULT_DEVELOPER_MAX, LEGACY_HARNESS_KEYS, validateHarness } from "../project/harness-config.js";

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

describe("validateHarness reads the developer ceiling", () => {
  it("exports a default ceiling of 6", () => {
    expect(DEFAULT_DEVELOPER_MAX).toBe(6);
  });

  it("accepts a valid ceiling and keeps developers as given", () => {
    for (const developers of [{ max: 1 }, { max: 16 }, {}]) {
      const harness = { developers, parallel: 3 };
      const out = validateHarness(harness, "f");
      expect(out.developers, JSON.stringify(developers)).toEqual(developers);
      expect((out as Record<string, unknown>).parallel).toBe(3);
    }
    expect(validateHarness({}, "f").developers).toBeUndefined();
  });

  it("rejects a max that is not an integer from 1 to 16", () => {
    for (const max of [0, 17, 2.5, "4", null]) {
      const call = () => validateHarness({ developers: { max } }, "cfg.json");
      expect(call, JSON.stringify(max)).toThrow("harness.developers.max must be an integer from 1 to 16");
      expect(call, JSON.stringify(max)).toThrow("cfg.json");
    }
  });

  it("rejects a developers value that is not an object", () => {
    for (const developers of [3, [], "x"]) {
      const call = () => validateHarness({ developers }, "cfg.json");
      expect(call, JSON.stringify(developers)).toThrow("harness.developers must be an object { max? }");
      expect(call, JSON.stringify(developers)).toThrow("cfg.json");
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
