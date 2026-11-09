import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import type { Stage } from "../workflow/schema.js";
import { evaluateStageEvidence, stageEvidenceFindings } from "../workflow/stage-evidence.js";
import { grantStageWaiver } from "./support/stage-waiver.js";

const gitIn = (dir: string, ...a: string[]): string =>
  execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const STAGE_CMD = [["npm", "test"]];

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

interface Fixture {
  root: string;
  head: string;
  dir: string;
  configure: (stage?: string[][]) => Promise<void>;
  record: (overrides?: Record<string, unknown>) => Promise<void>;
  rawLine: (line: string) => Promise<void>;
  evidence: () => ReturnType<typeof evaluateStageEvidence>;
}

async function makeFixture(stageConfig: string[][] | null = STAGE_CMD, stage: Stage = "testing"): Promise<Fixture> {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-evidence-")));
  const r = root;
  gitIn(r, "init", "-q");
  gitIn(r, "config", "user.email", "t@t");
  gitIn(r, "config", "user.name", "t");
  await writeFile(join(r, ".gitignore"), ".works/\n");
  await writeFile(join(r, "tracked.txt"), "one");
  gitIn(r, "add", "-A");
  gitIn(r, "commit", "-qm", "init");
  ensureWorksStructure(r);
  const head = gitIn(r, "rev-parse", "HEAD");
  const dir = join(r, ".works", stage, "f_20260919_1200");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "f", context: "app", created: "20260919_1200" }));

  const configure = async (s?: string[][]): Promise<void> => {
    await mkdir(join(r, ".kf"), { recursive: true });
    await writeFile(join(r, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "20260919_1200", defaultContext: "app",
      harness: {
        main: "lead",
        roles: { lead: { runner: "claude" } },
        runners: { claude: { start: ["claude", "{prompt}"] } },
        ...(s ? { verify: { stage: s } } : {}),
      },
    }));
  };
  await configure(stageConfig ?? undefined);
  const feature = () => findFeature(r, "f")!;
  return {
    root: r, head, dir, configure,
    record: async (overrides = {}) => {
      await mkdir(join(dir, "loop"), { recursive: true });
      const rec = {
        at: new Date().toISOString(), sha: head, clean: true,
        commands: [{ argv: ["npm", "test"], outcome: "exit", code: 0 }],
        outputSha256: "0".repeat(64), exit: 0, ...overrides,
      };
      await appendFile(join(dir, "loop", "stage-verify.jsonl"), `${JSON.stringify(rec)}\n`);
    },
    rawLine: async (line) => {
      await mkdir(join(dir, "loop"), { recursive: true });
      await appendFile(join(dir, "loop", "stage-verify.jsonl"), `${line}\n`);
    },
    evidence: () => evaluateStageEvidence(r, feature()),
  };
}

describe("evaluateStageEvidence", () => {
  it("passes for a clean record at HEAD of the configured commands and reports HEAD", async () => {
    const fx = await makeFixture();
    await fx.record();

    const ev = fx.evidence();

    expect(ev.state).toBe("pass");
    expect(ev.head).toBe(fx.head);
    expect(ev.record?.sha).toBe(fx.head);
  });

  it("reports none when no record file exists", async () => {
    const fx = await makeFixture();
    expect(fx.evidence().state).toBe("none");
  });

  it("reports invalid when the last line is not JSON", async () => {
    const fx = await makeFixture();
    await fx.rawLine("{bad");
    expect(fx.evidence().state).toBe("invalid");
  });

  it("reports invalid, never the earlier pass, when a valid pass is followed by an unparsable last line", async () => {
    const fx = await makeFixture();
    await fx.record();
    await fx.rawLine("{bad");

    const ev = fx.evidence();

    expect(ev.state).toBe("invalid");
    expect(ev.record).toBeUndefined();
  });

  it("decides on the last record when a pass is followed by a fail at HEAD", async () => {
    const fx = await makeFixture();
    await fx.record();
    await fx.record({ exit: 1, commands: [{ argv: ["npm", "test"], outcome: "exit", code: 1 }] });
    expect(fx.evidence().state).toBe("fail");
  });

  it("reports stale when the record sha differs from HEAD", async () => {
    const fx = await makeFixture();
    await fx.record({ sha: "a".repeat(40) });
    const ev = fx.evidence();
    expect(ev.state).toBe("stale");
    expect(ev.head).toBe(fx.head);
  });

  it("reports dirty-at-record when the record was taken on a dirty tree", async () => {
    const fx = await makeFixture();
    await fx.record({ clean: false });
    expect(fx.evidence().state).toBe("dirty-at-record");
  });

  it("reports dirty-now when a tracked file is modified after a clean record", async () => {
    const fx = await makeFixture();
    await fx.record();
    await writeFile(join(fx.root, "tracked.txt"), "two");
    expect(fx.evidence().state).toBe("dirty-now");
  });

  it("ignores an untracked file", async () => {
    const fx = await makeFixture();
    await fx.record();
    await writeFile(join(fx.root, "untracked.txt"), "x");
    expect(fx.evidence().state).toBe("pass");
  });

  it.each([
    ["reordered", [["npm", "test"], ["npm", "run", "lint"]], [["npm", "run", "lint"], ["npm", "test"]]],
    ["with a command added", [["npm", "test"]], [["npm", "test"], ["npm", "run", "lint"]]],
    ["with a command removed", [["npm", "test"], ["npm", "run", "lint"]], [["npm", "test"]]],
    ["with an argv reordered", [["npm", "run", "lint"]], [["run", "npm", "lint"]]],
  ])("reports config-changed when harness.verify.stage is %s since the record", async (_n, recorded, configured) => {
    const fx = await makeFixture(configured);
    await fx.record({ commands: recorded.map((argv) => ({ argv, outcome: "exit", code: 0 })) });
    expect(fx.evidence().state).toBe("config-changed");
  });

  it("puts config-changed before stale", async () => {
    const fx = await makeFixture([["npm", "run", "lint"]]);
    await fx.record({ sha: "a".repeat(40) });
    expect(fx.evidence().state).toBe("config-changed");
  });

  it("puts stale before fail", async () => {
    const fx = await makeFixture();
    await fx.record({ sha: "a".repeat(40), exit: 1, commands: [{ argv: ["npm", "test"], outcome: "exit", code: 1 }] });
    expect(fx.evidence().state).toBe("stale");
  });

  it("puts fail before dirty-at-record", async () => {
    const fx = await makeFixture();
    await fx.record({ clean: false, exit: 1, commands: [{ argv: ["npm", "test"], outcome: "exit", code: 1 }] });
    expect(fx.evidence().state).toBe("fail");
  });

  it("reports dir-missing when the item worktree path no longer exists", async () => {
    const fx = await makeFixture();
    await fx.record();
    const { updateFeatureMeta } = await import("../workflow/features.js");
    await updateFeatureMeta(fx.root, "f", (m) => ({
      ...m,
      worktree: { path: join(fx.root, "gone"), branch: "b", domain: "d", port: 1, createdAt: new Date().toISOString() },
    }));
    expect(fx.evidence().state).toBe("dir-missing");
  });

  it("reports not-configured when harness.verify.stage is absent", async () => {
    const fx = await makeFixture(null);
    expect(fx.evidence().state).toBe("not-configured");
  });

  it("reports not-configured when harness.verify.stage is empty", async () => {
    const fx = await makeFixture([]);
    expect(fx.evidence().state).toBe("not-configured");
  });

  it("reports waived with the waiver when nothing is pinned and a waiver exists", async () => {
    const fx = await makeFixture(null);
    await grantStageWaiver(fx.root, "f");

    const ev = fx.evidence();

    expect(ev.state).toBe("waived");
    expect(ev.waiver?.reason).toBe("fixture without a stage suite");
  });

  it("ignores a waiver once harness.verify.stage is pinned", async () => {
    const fx = await makeFixture(null);
    await grantStageWaiver(fx.root, "f");
    await fx.configure(STAGE_CMD);
    expect(fx.evidence().state).toBe("none");
  });
});

describe("stageEvidenceFindings", () => {
  const cases: Array<[string, string, (fx: Fixture) => Promise<void>]> = [
    ["none", "verify_record_missing", async () => {}],
    ["fail", "verify_record_failed", async (fx) => fx.record({ exit: 1, commands: [{ argv: ["npm", "test"], outcome: "exit", code: 1 }] })],
    ["stale", "verify_record_stale", async (fx) => fx.record({ sha: "a".repeat(40) })],
    ["dirty-at-record", "verify_tree_dirty", async (fx) => fx.record({ clean: false })],
    ["dirty-now", "verify_tree_dirty", async (fx) => { await fx.record(); await writeFile(join(fx.root, "tracked.txt"), "two"); }],
    ["config-changed", "verify_config_changed", async (fx) => fx.record({ commands: [{ argv: ["other"], outcome: "exit", code: 0 }] })],
    ["invalid", "verify_record_invalid", async (fx) => fx.rawLine("{bad")],
  ];

  it.each(cases)("maps %s to one ERROR %s naming the item and the command to run", async (_state, code, setup) => {
    const fx = await makeFixture();
    await setup(fx);
    const feature = findFeature(fx.root, "f")!;

    const findings = stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature));

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe(code);
    expect(findings[0].severity).toBe("ERROR");
    expect(findings[0].message).toContain("f");
    expect(findings[0].message).toContain("kf verify f --stage");
  });

  it("names the record sha and HEAD in the stale message", async () => {
    const fx = await makeFixture();
    await fx.record({ sha: "a".repeat(40) });
    const feature = findFeature(fx.root, "f")!;

    const [finding] = stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature));

    expect(finding.message).toContain("a".repeat(40).slice(0, 7));
    expect(finding.message).toContain(fx.head.slice(0, 7));
  });

  it("says the record was dirty for dirty-at-record and the tree for dirty-now", async () => {
    const fx = await makeFixture();
    await fx.record({ clean: false });
    const feature = findFeature(fx.root, "f")!;
    const [atRecord] = stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature));
    expect(atRecord.message).toMatch(/record/i);

    const fy = await makeFixture();
    await fy.record();
    await writeFile(join(fy.root, "tracked.txt"), "two");
    const f2 = findFeature(fy.root, "f")!;
    const [now] = stageEvidenceFindings(f2, evaluateStageEvidence(fy.root, f2));
    expect(now.message).toMatch(/uncommitted|now/i);
    expect(now.message).not.toBe(atRecord.message);
  });

  it("maps not-configured to verify_not_configured naming harness.verify.stage and --waive", async () => {
    const fx = await makeFixture(null);
    const feature = findFeature(fx.root, "f")!;

    const findings = stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature));

    expect(findings.map((f) => f.code)).toEqual(["verify_not_configured"]);
    expect(findings[0].message).toContain("harness.verify.stage");
    expect(findings[0].message).toContain("--waive");
  });

  it("maps dir-missing to verify_dir_missing", async () => {
    const fx = await makeFixture();
    const { updateFeatureMeta } = await import("../workflow/features.js");
    await updateFeatureMeta(fx.root, "f", (m) => ({
      ...m,
      worktree: { path: join(fx.root, "gone"), branch: "b", domain: "d", port: 1, createdAt: new Date().toISOString() },
    }));
    const feature = findFeature(fx.root, "f")!;

    expect(stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature)).map((f) => f.code)).toEqual(["verify_dir_missing"]);
  });

  it("returns no finding for pass and for waived", async () => {
    const fx = await makeFixture();
    await fx.record();
    let feature = findFeature(fx.root, "f")!;
    expect(stageEvidenceFindings(feature, evaluateStageEvidence(fx.root, feature))).toEqual([]);

    const fw = await makeFixture(null);
    await grantStageWaiver(fw.root, "f");
    feature = findFeature(fw.root, "f")!;
    expect(stageEvidenceFindings(feature, evaluateStageEvidence(fw.root, feature))).toEqual([]);
  });
});
