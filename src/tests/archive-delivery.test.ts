import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cmdNew } from "../cli/commands/new.js";
import { cmdStage } from "../cli/commands/stage.js";
import { cmdApprove } from "../cli/commands/approve.js";
import { cmdArchive } from "../cli/commands/archive.js";
import { cmdIssues } from "../cli/commands/issues.js";
import { ensureWorksStructure, findFeature, readFeatureMeta, writeFeatureMeta } from "../workflow/features.js";
import { runDoctor } from "../project/doctor.js";
import { computeStatus, renderStatusText } from "../workflow/status.js";
import { readProjectConfig } from "../project/config.js";
import { runHook } from "../integrations/hooks.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { PKG_GITHUB_HOOKS_DIR } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
let stubBin: string;
let prevPath: string | undefined;
const callsFile = () => join(root, "gh-calls.log");

/** A `gh` stub: logs argv to $GH_CALLS; per-PR state via GH_PR_STATE_<num>, global GH_PR_STATE/GH_PR_RAW. */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "${"${GH_CALLS}"}"
if [ -n "$GH_FAIL" ]; then echo "boom" >&2; exit 1; fi
case "$1" in
  auth) exit 0 ;;
  pr)
    if [ "$2" = view ]; then
      if [ -n "$GH_PR_RAW" ]; then printf '%s\\n' "$GH_PR_RAW"; else
        num="\${3##*/}"
        state=$(printenv "GH_PR_STATE_$num"); state="\${state:-\${GH_PR_STATE:-MERGED}}"
        printf '{"state":"%s"}\\n' "$state"
      fi
    fi; exit 0 ;;
  issue) if [ "$2" = close ] && [ -n "$GH_CLOSE_FAIL" ]; then echo "already closed" >&2; exit 1; fi; exit 0 ;;
  project)
    case "$2" in
      field-list) echo '{"fields":[{"name":"Status","id":"fld1","options":[{"name":"In progress","id":"o1"},{"name":"In review","id":"o2"},{"name":"Done","id":"o3"}]}]}' ;;
      view) echo '{"id":"pid1"}' ;;
      item-list) echo '{"items":[{"id":"item1","content":{"number":7,"repository":"o/r"}}]}' ;;
      item-add) echo '{"id":"item1"}' ;;
      item-edit) exit 0 ;;
    esac
    exit 0 ;;
esac
exit 0
`;

const ISSUE = "https://github.com/o/r/issues/7";
const PR = "https://github.com/o/r/pull/9";
const spec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can ship.\n## Affected surfaces\nN/A\n";
const bugSpec = "---\nkind: bug\nstatus: confirmed\nseverity: MEDIUM\n---\n# Bug Report\n\n## Bug Summary\nIt breaks.\n";
const evidence = "## Commands and Evidence\n\n| Command / tool | Exit code | Evidence / output |\n|---|---:|---|\n| npm test | 0 | 12 passed |\n";

const feature = (name = "shipit") => findFeature(root, name)!;

async function report(name: string, id: "testing-result" | "review-report", status = "PASS"): Promise<void> {
  const execution = readFeatureMeta(feature(name).dir)!.executionId;
  await writeFile(join(feature(name).dir, ARTIFACTS[id].file),
    `---\nstatus: ${status}\nexecution: ${execution}\n---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
}

/** Drive a feature work item to a review-stage PASS state, ready to archive. */
async function reviewStage(name = "shipit"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), spec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  for (const id of ["implementation-plan", "use-case-specification", "use-case-diagram"] as const) {
    await writeFile(join(feature(name).dir, ARTIFACTS[id].file), "# Contract\nUC-001: Ship it");
  }
  await mkdir(join(feature(name).dir, "use-cases"), { recursive: true });
  await writeFile(join(feature(name).dir, "use-cases", "UC-001.md"), "# UC-001 Ship it\nUser ships.");
  await writeFile(join(feature(name).dir, ARTIFACTS["test-cases"].file), "# Cases\n## TC-001\nFR-001 UC-001\nShip and verify.\n");
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  await report(name, "testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report(name, "review-report");
  await writeFile(join(feature(name).dir, ARTIFACTS["feature-report"].file), "# Feature report\nVerified");
}

/** Same for a bug — the lightweight contract: spec + two reports, no planning artifacts. */
async function reviewBug(name = "buggy"): Promise<void> {
  expect((await cmdNew(args("new", [name], { context: "app", type: "bug" }), root)).code).toBe(0);
  await writeFile(join(feature(name).dir, ARTIFACTS["spec-requirement"].file), bugSpec);
  expect((await cmdStage(args("stage", [name, "planning"]), root)).code).toBe(0);
  expect((await cmdApprove(args("approve", [name]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "implementation"]), root)).code).toBe(0);
  expect((await cmdStage(args("stage", [name, "testing"]), root)).code).toBe(0);
  await report(name, "testing-result");
  expect((await cmdStage(args("stage", [name, "review"]), root)).code).toBe(0);
  await report(name, "review-report");
}

/** Real pack hooks (lib + named hook) copied into the project's .kf/hooks/. */
async function seedPackHooks(...names: string[]): Promise<void> {
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  for (const n of ["lib-github.sh", ...names]) {
    await writeFile(join(root, ".kf", "hooks", n), readFileSync(join(PKG_GITHUB_HOOKS_DIR, n), "utf8"));
  }
}

async function link(name: string, meta: Record<string, unknown>): Promise<void> {
  const f = feature(name);
  await writeFeatureMeta(f.dir, { ...readFeatureMeta(f.dir)!, ...meta });
}

const ghCalls = () => (existsSync(callsFile()) ? readFileSync(callsFile(), "utf8") : "");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-delivery-"));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow",
    created: "x",
    repository: "o/r",
    worktree: { enabled: false },
    project: { owner: "me", number: 3, acGate: false, statusMap: { dones: "Done" } },
  }));
  stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_CALLS = callsFile();
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of Object.keys(process.env)) {
    if (v.startsWith("GH_")) delete process.env[v];
  }
  await rm(root, { recursive: true, force: true });
});

describe("merge gate — kf archive refuses unverifiable delivery (UC-001, TC-001…006)", () => {
  it.each(["OPEN", "CLOSED"])("refuses a %s PR with zero side effects (TC-001/TC-002)", async (state) => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    await seedPackHooks("dones.sh");
    process.env.GH_PR_STATE = state;

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
    expect(ghCalls()).toContain(`pr view ${PR}`);
    expect(ghCalls()).not.toContain("issue close");
    expect(existsSync(join(root, "docs", "requirement", "app", "shipit.md"))).toBe(false);
  });

  it("refuses when the PR state is unverifiable — gh failure, garbage output, missing repository (TC-003)", async () => {
    process.env.GH_FAIL = "1";
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    let res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("could not verify");
    delete process.env.GH_FAIL;

    process.env.GH_PR_RAW = "not-json";
    res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("unexpected output");
    delete process.env.GH_PR_RAW;

    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: false } }));
    res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain('no "repository"');
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
  });

  it("has no --force escape (TC-004)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["shipit"], { force: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature().stage).toBe("review");
  });

  it("refuses an already-dones item whose PR is unmerged (TC-005)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    expect(feature().stage).toBe("dones");

    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
  });

  it("applies to bug items too (TC-006)", async () => {
    await reviewBug();
    await link("buggy", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["buggy"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature("buggy").stage).toBe("review");
  });
});

describe("finalization — archive is the delivery gate (UC-002, TC-007…010)", () => {
  it("delivers a merged item: move, docs, dones hook close+board, flag last (TC-007)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    await seedPackHooks("dones.sh");

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(feature().stage).toBe("dones");
    const meta = readFeatureMeta(feature().dir)!;
    expect(meta.delivered).toBe(true);
    expect(meta.deliveredAt).toBeTruthy();
    expect(meta.status).toBe("archived");

    const calls = ghCalls();
    expect(calls).toContain(`pr view ${PR}`);
    expect(calls).toContain(`issue close ${ISSUE}`);
    expect(calls).toContain("project item-edit");
    expect(existsSync(join(root, "docs", "requirement", "app", "shipit.md"))).toBe(true);
  });

  it("packaged dones.sh closes the issue and moves the board; delivered.sh is gone (TC-008)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("dones.sh");

    const res = spawnSync("bash", [join(root, ".kf", "hooks", "dones.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        KFW_FEATURE: "shipit",
        KFW_FEATURE_DIR: feature().dir,
        KFW_WORK_ROOT: root,
        KFW_REPOSITORY: "o/r",
        KFW_PROJECT_OWNER: "me",
        KFW_PROJECT_NUMBER: "3",
        KFW_PROJECT_AC_GATE: "0",
        KFW_PROJECT_STATUS_DONES: "Done",
      },
    });
    expect(res.status).toBe(0);
    const calls = ghCalls();
    expect(calls).toContain(`issue close ${ISSUE}`);
    expect(calls).toContain("project item-edit");

    const packFiles = await readdir(PKG_GITHUB_HOOKS_DIR);
    expect(packFiles).not.toContain("delivered.sh");
  });

  it("rolls back a mid-pass failure — folder restored, flag never written (TC-009)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    // Canonical docs can't be written when the destination path is a directory.
    await mkdir(join(root, "docs", "requirement", "app", "shipit.md"), { recursive: true });

    await expect(cmdArchive(args("archive", ["shipit"]), root)).rejects.toThrow();
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
  });

  it("kf stage <f> dones hits the same merge gate (TC-010)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdStage(args("stage", ["shipit", "dones"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature().stage).toBe("review");
  });
});

describe("archive without PR evidence (UC-003, TC-011…013)", () => {
  it("proceeds on the human's run — the invocation is the confirmation (TC-011)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("dones.sh");
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(ghCalls()).not.toContain("pr view");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);
  });

  it("warns when no issue is linked (TC-012)", async () => {
    await reviewStage();
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no linked issue");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);
  });

  it("archives a bug the same way (TC-013)", async () => {
    await reviewBug();
    await link("buggy", { issue: ISSUE });
    const res = await cmdArchive(args("archive", ["buggy"]), root);
    expect(res.code).toBe(0);
    expect(feature("buggy").stage).toBe("dones");
    expect(readFeatureMeta(feature("buggy").dir)!.delivered).toBe(true);
  });
});

describe("reconcile — re-archive on dones items (UC-004, TC-014/TC-015)", () => {
  it("re-runs docs + hook and stamps delivered on a legacy item (TC-014)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("dones.sh");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);

    // Simulate a pre-feature archive: clear the flag, keep everything else.
    const dir = feature().dir;
    const meta = readFeatureMeta(dir)!;
    delete meta.delivered;
    delete meta.deliveredAt;
    await writeFeatureMeta(dir, meta);

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
    expect(ghCalls().split("\n").filter((l) => l.includes("issue close")).length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent on an already-delivered item (TC-015)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("dones.sh");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const firstAt = readFeatureMeta(feature().dir)!.deliveredAt;

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already marked delivered");
    expect(readFeatureMeta(feature().dir)!.deliveredAt).toBe(firstAt);
  });
});

describe("visibility — awaiting merge states surface (UC-005, TC-016/TC-017)", () => {
  it("status shows 'awaiting merge' only for review-PASS items with a linked issue (TC-016)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    const text = renderStatusText(computeStatus(feature()));
    expect(text).toContain("Awaiting merge");
    expect(text).toContain("kf archive shipit");

    // No PASS report → no hint.
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file), "---\nstatus: FAIL\n---\n# Evidence\n");
    const failing = renderStatusText(computeStatus(feature()));
    expect(failing).not.toContain("Awaiting merge");
  });

  it("doctor points undelivered dones items and inert statusMap.delivered at the right actions (TC-017)", async () => {
    // Legacy dones item: archived, linked, never delivered.
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("dones.sh");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const dir = feature().dir;
    const meta = readFeatureMeta(dir)!;
    delete meta.delivered;
    delete meta.deliveredAt;
    await writeFeatureMeta(dir, meta);

    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
      project: { owner: "me", number: 3, acGate: false, statusMap: { dones: "Done", delivered: "Done" } },
    }));

    const findings = runDoctor(root).findings;
    const undelivered = findings.find((f) => f.area.includes("shipit"));
    expect(undelivered?.level).toBe("WARNING");
    expect(undelivered?.action).toContain("kf archive shipit");
    const deadKey = findings.find((f) => f.area === ".kf/config.json" && f.message.includes("statusMap.delivered"));
    expect(deadKey?.level).toBe("WARNING");
  });
});

describe("deprecated alias + removed apparatus (FR-006, TC-021/TC-022)", () => {
  it("kf issues done forwards to archive with a deprecation warning (TC-021)", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    const res = await cmdIssues(args("issues", ["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("deprecated");
    expect(feature().stage).toBe("dones");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);

    // And on an unmerged PR it refuses exactly like archive.
    await reviewStage("other");
    await link("other", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const refused = await cmdIssues(args("issues", ["done", "other"]), root);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("not merged");
  });

  it("emits no KFW_PROJECT_STATUS_DELIVERED default; statusMap.delivered still parses (TC-022)", async () => {
    await reviewStage();
    const dir = feature().dir;
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "dones.sh"),
      "#!/usr/bin/env bash\necho \"${KFW_PROJECT_STATUS_DELIVERED:-unset}:${KFW_PROJECT_STATUS_DONES}\" > \"$KFW_FEATURE_DIR/env.out\"\n");
    const res = runHook(root, { feature: "shipit", context: "app", dir, root, from: "review", to: "dones", approval: "approved" });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, "env.out"), "utf8")).toBe("unset:Done\n");

    // A leftover delivered key stays parseable — inert, not a config error.
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
      project: { owner: "me", number: 3, statusMap: { dones: "Done", delivered: "Done" } },
    }));
    expect(() => readProjectConfig(root)).not.toThrow();
  });
});

describe("preserved primitives", () => {
  it("meta accepts pr/delivered fields and rejects malformed values", async () => {
    await reviewStage();
    const dir = feature().dir;
    await writeFeatureMeta(dir, { ...readFeatureMeta(dir)!, pr: PR, delivered: true, deliveredAt: "2026-10-11T00:00:00Z" });
    const meta = readFeatureMeta(dir)!;
    expect(meta.pr).toBe(PR);
    expect(meta.delivered).toBe(true);

    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "f", context: "a", created: "x", pr: ISSUE }));
    expect(() => readFeatureMeta(dir)).toThrow();
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "f", context: "a", created: "x", delivered: "yes" }));
    expect(() => readFeatureMeta(dir)).toThrow();
  });

  it("kf issues link records PR refs and refuses overwrites", async () => {
    await reviewStage();
    let res = await cmdIssues(args("issues", ["link", "shipit", "https://github.com/o/r/pull/9"]), root);
    expect(res.code).toBe(0);
    expect(readFeatureMeta(feature().dir)!.pr).toBe(PR);

    res = await cmdIssues(args("issues", ["link", "shipit", "https://github.com/o/r/pull/11"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("already links PR");
  });
});
