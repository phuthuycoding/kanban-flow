import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, updateFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { withDocsImpact } from "./helpers/contract.js";
import { computeStatus, statusToJson } from "../workflow/status.js";
import { itemLogPath, readItemLog, sharedMeta } from "../workflow/item-log.js";
import { FORCE_RETRY_HINT, type TransitionOutcome } from "../workflow/transition.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdVerify } from "../cli/commands/verify.js";
import { cmdIssues } from "../cli/commands/issues.js";
import { cmdStatus } from "../cli/commands/inspect.js";
import { parseArgsCli } from "../cli/args.js";
import type { ParsedArgs } from "../cli/args.js";

/** Per-test override of the move, so a refused move can be shaped without touching the real gates. */
const ctl = vi.hoisted(() => ({
  transition: null as null | ((root: string, name: string) => Promise<unknown>),
}));

vi.mock("../workflow/transition.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../workflow/transition.js")>();
  return {
    ...real,
    transitionItem: (...a: Parameters<typeof real.transitionItem>) => (ctl.transition ? ctl.transition(a[0], a[1]) : real.transitionItem(...a)),
  };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISSUE = (n: number): string => `https://github.com/o/r/issues/${n}`;
const PR = (n: number): string => `https://github.com/o/r/pull/${n}`;

/**
 * A `gh` stand-in on PATH: `pr view` answers the state in GH_PR_STATE_<number> (the merge gate and the
 * replacement check both read it), `issue create` prints GH_ISSUE_URL.
 */
const GH_STUB = `#!/usr/bin/env bash
case "$1" in
  pr)
    if [ "$2" = view ]; then
      num="\${3##*/}"
      state=$(printenv "GH_PR_STATE_$num"); state="\${state:-OPEN}"
      printf '{"state":"%s","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n' "$state"
    fi; exit 0 ;;
  issue)
    if [ "$2" = create ]; then echo "$GH_ISSUE_URL"; fi; exit 0 ;;
esac
exit 0
`;

let scratch: string;
let root: string;
let prevPath: string | undefined;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });
const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const feature = (name = "demo") => findFeature(root, name)!;
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A";

type Rec = Record<string, unknown> & { event: string; set?: Record<string, unknown>; derived?: true };
const logLines = (name = "demo"): Rec[] => {
  const path = itemLogPath(feature(name).dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Rec);
};
/** The records a command appended, skipping the derived catch-up records (`opened`, `reconciled`). */
const appendedBy = (before: number, name = "demo"): Rec[] => logLines(name).slice(before).filter((r) => r.derived !== true);
const snapshot = (name = "demo"): Record<string, unknown> => JSON.parse(readFileSync(join(feature(name).dir, ".kfw.json"), "utf8")) as Record<string, unknown>;
const expectFoldEqualsSnapshot = (name = "demo"): void => {
  const folded = readItemLog(feature(name).dir);
  expect(folded.ok).toBe(true);
  if (!folded.ok) return;
  expect(folded.state).toEqual({ stage: feature(name).stage, meta: sharedMeta(snapshot(name)) });
};

async function configure(extra: Record<string, unknown> = {}): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", created: "20261113_0409", defaultContext: "cli",
    worktree: { enabled: false },
    harness: {
      main: "lead",
      roles: { lead: { runner: "claude" } },
      runners: { claude: { start: ["claude", "{prompt}"] } },
    },
    ...extra,
  }));
}

/** `name` in planning with a complete contract: the only thing left is `kf approve`. */
async function plannedItem(name: string): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), id === "implementation-plan" ? withDocsImpact("# Contract\nUC-001: Create a task") : "# Contract\nUC-001: Create a task");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Create a task\nUser can create a task.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nCreate a task and verify it exists.\n");
}

beforeEach(async () => {
  ctl.transition = null;
  scratch = realpathSync(await mkdtemp(join(tmpdir(), "kf-itemlog-cmds-")));
  root = join(scratch, "repo");
  await mkdir(root, { recursive: true });
  execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
  git("config", "user.email", "t@t");
  git("config", "user.name", "Rita Reviewer");
  await writeFile(join(root, ".gitignore"), ".works/\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  ensureWorksStructure(root);
  await configure();
  const stubBin = join(scratch, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of Object.keys(process.env)) if (v.startsWith("GH_")) delete process.env[v];
  await rm(scratch, { recursive: true, force: true });
});

describe("kf new", () => {
  it("starts the item's log with one created record in brainstorm that carries the new id", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "cli" }), root)).code).toBe(0);

    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].event).toBe("created");
    expect(lines[0].stage).toBe("brainstorm");
    expect(String(lines[0].set?.id)).toMatch(UUID);
    expect(lines[0].set?.id).toBe(snapshot().id);
    expectFoldEqualsSnapshot();
  });

  it("reports the same id in the status JSON", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "cli" }), root)).code).toBe(0);

    const res = await cmdStatus(args("status", [], { change: "demo", json: true }), root);
    expect(res.code).toBe(0);
    expect((JSON.parse(res.stdout) as { id: unknown }).id).toBe(logLines()[0].set?.id);
  });

  it("status JSON carries a null id for an item whose metadata has none", async () => {
    expect((await cmdNew(args("new", ["demo"], { context: "cli" }), root)).code).toBe(0);
    const { id: _dropped, ...withoutId } = snapshot();
    writeFileSync(join(feature().dir, ".kfw.json"), JSON.stringify(withoutId));

    expect(statusToJson(computeStatus(feature())).id).toBeNull();
  });
});

describe("kf approve", () => {
  it("appends approved before any later record, with the approval it granted", async () => {
    await plannedItem("demo");
    const before = logLines().length;

    expect((await cmdApprove(args("approve", ["demo"]), root)).code).toBe(0);

    const appended = appendedBy(before);
    expect(appended[0].event).toBe("approved");
    expect(appended[0].set?.approval).toEqual(snapshot().approval);
    expect(appended[0].set?.approval).toMatchObject({ status: "approved", by: "human" });
    const approval = appended[0].set?.approval as { at?: unknown; contractHash?: unknown };
    expect(typeof approval.at).toBe("string");
    expect(typeof approval.contractHash).toBe("string");
    expect(approval.contractHash).not.toBe("");
  });

  it("appends approved first when --backlog parks the item", async () => {
    await plannedItem("demo2");
    const before = logLines("demo2").length;

    expect((await cmdApprove(args("approve", ["demo2"], { backlog: true }), root)).code).toBe(0);

    expect(feature("demo2").stage).toBe("backlog");
    const appended = appendedBy(before, "demo2");
    expect(appended[0].event).toBe("approved");
    expect(appended[0].set?.approval).toEqual(snapshot("demo2").approval);
  });

  it("logs approved then approval-restored when a failing hook refuses the move, and the log folds to the snapshot", async () => {
    await plannedItem("demo");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    const hook = join(root, ".kf", "hooks", "implementation.sh");
    await writeFile(hook, "#!/bin/sh\necho 'lint gate is red'\nexit 1\n");
    await chmod(hook, 0o755);
    const before = logLines().length;

    const res = await cmdApprove(args("approve", ["demo"]), root);

    expect(res.code).toBe(1);
    expect(feature().stage).toBe("planning");
    const appended = appendedBy(before);
    expect(appended.map((r) => r.event)).toEqual(["approved", "approval-restored"]);
    expect(appended[0].set?.approval).toMatchObject({ status: "approved" });
    expect(appended[1].set?.approval).toEqual({ status: "pending" });
    expect(snapshot().approval).toEqual({ status: "pending" });
    expectFoldEqualsSnapshot();
  });

  it("writes no approval-restored record when the item was approved again meanwhile, and the log still folds to the snapshot", async () => {
    await plannedItem("demo");
    const before = logLines().length;
    ctl.transition = async (r, name) => {
      await updateFeatureMeta(r, name, (meta) => ({ ...meta, approval: { ...meta.approval!, by: "someone-else" } }), {}, "approved");
      return { kind: "refused", reason: "gate", stdout: `Gate failed.\n\n${FORCE_RETRY_HINT}`, stderrTag: "gate" } as TransitionOutcome;
    };

    const res = await cmdApprove(args("approve", ["demo"]), root);

    expect(res.code).toBe(1);
    expect(snapshot().approval).toMatchObject({ status: "approved", by: "someone-else" });
    expect(appendedBy(before).map((r) => r.event)).toEqual(["approved", "approved"]);
    expectFoldEqualsSnapshot();
  });
});

describe("the waiver and the links", () => {
  beforeEach(async () => {
    await configure({ repository: "o/r" });
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
  });

  it("kf verify --waive appends one waiver record carrying the waiver", async () => {
    const before = logLines().length;

    const res = await cmdVerify(parseArgsCli(["verify", "demo", "--stage", "--waive", "r"]), root);

    expect(res.code, res.stdout).toBe(0);
    const appended = logLines().slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("waiver");
    expect(appended[0].set?.verifyWaiver).toMatchObject({ reason: "r", by: "Rita Reviewer" });
    expect(appended[0].set?.verifyWaiver).toEqual(snapshot().verifyWaiver);
  });

  it("kf issues link appends one linked record for an issue", async () => {
    const before = logLines().length;

    expect((await cmdIssues(args("issues", ["link", "demo", "12"]), root)).code).toBe(0);

    const appended = logLines().slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("linked");
    expect(appended[0].set).toEqual({ issue: ISSUE(12) });
  });

  it("kf issues link --pr appends one linked record for the PR", async () => {
    const before = logLines().length;

    expect((await cmdIssues(args("issues", ["link", "demo", "34"], { pr: true }), root)).code).toBe(0);

    const appended = logLines().slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("linked");
    expect(appended[0].set).toEqual({ pr: PR(34) });
  });

  it("kf issues link --pr --replace appends one linked record with the new PR", async () => {
    expect((await cmdIssues(args("issues", ["link", "demo", "34"], { pr: true }), root)).code).toBe(0);
    process.env.GH_PR_STATE_34 = "CLOSED";
    process.env.GH_PR_STATE_56 = "OPEN";
    const before = logLines().length;

    const res = await cmdIssues(args("issues", ["link", "demo", "56"], { pr: true, replace: true }), root);

    expect(res.code, res.stdout).toBe(0);
    const appended = logLines().slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("linked");
    expect(appended[0].set).toEqual({ pr: PR(56) });
  });

  it("kf issues create on a second item appends one linked record for the created issue", async () => {
    expect((await cmdNew(args("new", ["demo2"], { context: "app" }), root)).code).toBe(0);
    process.env.GH_ISSUE_URL = ISSUE(77);
    const before = logLines("demo2").length;

    const res = await cmdIssues(args("issues", ["create", "demo2"]), root);

    expect(res.code, res.stdout).toBe(0);
    const appended = logLines("demo2").slice(before);
    expect(appended).toHaveLength(1);
    expect(appended[0].event).toBe("linked");
    expect(appended[0].set).toEqual({ issue: ISSUE(77) });
  });
});
