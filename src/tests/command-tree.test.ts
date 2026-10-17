import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgsCli, commandHelp, allCommands } from "../cli/args.js";
import { nounKindGate } from "../cli/noun-gate.js";
import { writeFeatureMeta } from "../workflow/features.js";
import type { ParsedArgs } from "../cli/args.js";

let root: string;

async function item(name: string, kind?: "feature" | "bug"): Promise<void> {
  const dir = join(root, ".works", "review", `${name}_20261017_1800`);
  await mkdir(dir, { recursive: true });
  await writeFeatureMeta(dir, { schema: "kanban-flow", feature: name, context: "app", created: "20261017_1800", kind });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-tree-"));
  await mkdir(join(root, ".works"), { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("canonical noun verbs resolve to flat handlers", () => {
  it("maps every verb for both nouns (UC-001)", () => {
    const verbs: [string, string][] = [
      ["start", "new"], ["list", "list"], ["show", "show"], ["move", "stage"],
      ["approve", "approve"], ["ship", "ship"], ["finish", "archive"], ["drop", "cancel"], ["run", "run"],
    ];
    for (const noun of ["feature", "bug"]) {
      for (const [verb, dispatch] of verbs) {
        const positionals = verb === "list" ? [] : ["demo", "testing"];
        const parsed = parseArgsCli([noun, verb, ...positionals]);
        expect(parsed.command, `${noun} ${verb}`).toBe(dispatch);
        expect(parsed.noun).toBe(noun);
        expect(parsed.positionals).toEqual(positionals);
      }
    }
  });

  it("bug start implies --type bug; feature start implies --type feature", () => {
    const bug = parseArgsCli(["bug", "start", "leak"]);
    expect(bug.command).toBe("new");
    expect(bug.options.type).toBe("bug");
    const feat = parseArgsCli(["feature", "start", "idea", "--context", "app"]);
    expect(feat.command).toBe("new");
    expect(feat.options.type).toBe("feature");
    expect(feat.options.context).toBe("app");
    expect(feat.positionals).toEqual(["idea"]);
  });
});

describe("legacy flat commands stay identical aliases (UC-002)", () => {
  it("produces the same ParsedArgs as the canonical spelling, noun aside", () => {
    const legacy = parseArgsCli(["stage", "demo", "testing"]);
    const canon = parseArgsCli(["feature", "move", "demo", "testing"]);
    expect(canon.command).toBe(legacy.command);
    expect(canon.positionals).toEqual(legacy.positionals);
    expect(canon.options).toEqual(legacy.options);
    expect(legacy.noun).toBeUndefined();
  });

  it("flat commands still parse options strictly", () => {
    expect(() => parseArgsCli(["stage", "demo", "review", "--skip-hook"])).toThrow();
    expect(() => parseArgsCli(["feature", "move", "demo", "review", "--skip-hook"])).toThrow();
    expect(allCommands()).toContain("new");
  });
});

describe("help resolves nested paths (UC-003)", () => {
  it("kf help <noun> lists the group's verbs", () => {
    const h = commandHelp("feature");
    expect(h).toContain("kf feature <verb>");
    expect(h).toContain("finish");
  });
  it("kf help <noun> <verb> shows the leaf usage", () => {
    expect(commandHelp("feature start")).toContain("Usage: kf feature start");
    expect(commandHelp("bug ship")).toContain("Usage: kf bug ship");
  });
  it("flat help unchanged", () => {
    expect(commandHelp("stage")).toContain("Usage: kf stage");
  });
});

describe("kind mismatch refuses clearly (UC-004)", () => {
  const gate = (argv: string[]): ParsedArgs => parseArgsCli(argv);

  it("bug verbs refuse feature items; feature verbs refuse bug items", async () => {
    await item("ui", "feature");
    await item("leak", "bug");
    const wrongBug = nounKindGate(gate(["bug", "move", "ui", "dones"]), root);
    expect(wrongBug?.code).toBe(1);
    expect(wrongBug?.stdout).toContain("is a feature");
    const wrongFeat = nounKindGate(gate(["feature", "ship", "leak"]), root);
    expect(wrongFeat?.code).toBe(1);
    expect(wrongFeat?.stdout).toContain("is a bug");
    // matching kinds pass the gate
    expect(nounKindGate(gate(["feature", "ship", "ui"]), root)).toBeNull();
    expect(nounKindGate(gate(["bug", "move", "leak", "dones"]), root)).toBeNull();
  });

  it("start with a conflicting --type refuses; unknown items pass through", async () => {
    const conflict = nounKindGate(gate(["bug", "start", "x", "--type", "feature"]), root);
    expect(conflict?.code).toBe(1);
    expect(conflict?.stdout).toContain("implies --type bug");
    expect(nounKindGate(gate(["feature", "start", "x", "--type", "bug"]), root)?.code).toBe(1);
    expect(nounKindGate(gate(["feature", "show", "missing"]), root)).toBeNull();
  });
});

describe("unknown/partial paths", () => {
  it("a group verb that doesn't exist resolves to the group (parent help + error)", () => {
    const parsed = parseArgsCli(["feature", "frobnicate", "demo"]);
    expect(parsed.command).toBe("feature");
    expect(parsed.noun).toBeUndefined();
    expect(commandHelp("feature")).toContain("<verb>");
  });
});
