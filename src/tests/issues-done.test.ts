import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { cmdIssues } from "../cli/commands/issues.js";
import { readFeatureMeta, ensureWorksStructure } from "../workflow/features.js";
import { runDoctor } from "../project/doctor.js";
import { computeStatus, renderStatusText } from "../workflow/status.js";
import { findFeature } from "../workflow/features.js";
import { readProjectConfig } from "../project/config.js";
import { PKG_GITHUB_HOOKS_DIR } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (positionals: string[], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command: "issues", positionals, options });

let root: string;
let stubBin: string;
let prevPath: string | undefined;
const callsFile = () => join(root, "gh-calls.log");

/** A `gh` stub: logs argv to $GH_CALLS, answers the calls the pack/cmdDone actually make. */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" >> "${"${GH_CALLS}"}"
if [ -n "$GH_FAIL" ]; then echo "boom" >&2; exit 1; fi
case "$1" in
  auth) exit 0 ;;
  pr) if [ "$2" = view ]; then printf '{"state":"%s"}\\n' "\${GH_PR_STATE:-MERGED}"; fi; exit 0 ;;
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

/** dones-stage work item with .kf config wiring repo + board. */
async function project(meta: Record<string, unknown> = {}): Promise<string> {
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow",
    created: "x",
    repository: "o/r",
    project: { owner: "me", number: 3, statusMap: { dones: "In review", delivered: "Done" } },
  }));
  const dir = join(root, ".works", "dones", "shipit_20260101_0000");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".kfw.json"), JSON.stringify({
    schema: "kanban-flow", feature: "shipit", context: "app", created: "x", ...meta,
  }));
  return dir;
}

/** Real pack hooks (lib + named hook) copied into the project's .kf/hooks/. */
async function seedPackHooks(...names: string[]): Promise<void> {
  await mkdir(join(root, ".kf", "hooks"), { recursive: true });
  for (const n of ["lib-github.sh", ...names]) {
    await writeFile(join(root, ".kf", "hooks", n), readFileSync(join(PKG_GITHUB_HOOKS_DIR, n), "utf8"));
  }
}

const ghCalls = () => (existsSync(callsFile()) ? readFileSync(callsFile(), "utf8") : "");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-done-"));
  stubBin = join(root, "stubbin");
  await mkdir(stubBin, { recursive: true });
  await writeFile(join(stubBin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath}`;
  process.env.GH_CALLS = callsFile();
});

afterEach(async () => {
  process.env.PATH = prevPath;
  delete process.env.GH_CALLS;
  delete process.env.GH_PR_STATE;
  delete process.env.GH_FAIL;
  delete process.env.GH_CLOSE_FAIL;
  await rm(root, { recursive: true, force: true });
});

describe("FeatureMeta: pr + delivered (TC-001)", () => {
  it("accepts a pull URL + delivered and rejects malformed values", async () => {
    const dir = await project({ issue: ISSUE, pr: PR, delivered: true, deliveredAt: "2026-10-10T00:00:00Z" });
    const meta = readFeatureMeta(dir)!;
    expect(meta.pr).toBe(PR);
    expect(meta.delivered).toBe(true);

    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "f", context: "a", created: "x", pr: ISSUE }));
    expect(() => readFeatureMeta(dir)).toThrow();
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "f", context: "a", created: "x", delivered: "yes" }));
    expect(() => readFeatureMeta(dir)).toThrow();
  });
});

describe("kf issues link (TC-002)", () => {
  it("writes pr for /pull/ URLs and --pr; keeps bare numbers as issues; refuses overwrites", async () => {
    await project();
    let res = await cmdIssues(args(["link", "shipit", "https://github.com/o/r/pull/9"]), root);
    expect(res.code).toBe(0);
    const dir = join(root, ".works", "dones", "shipit_20260101_0000");
    expect(readFeatureMeta(dir)!.pr).toBe(PR);
    expect(readFeatureMeta(dir)!.issue).toBeUndefined();

    res = await cmdIssues(args(["link", "shipit", "7"]), root);
    expect(res.code).toBe(0);
    expect(readFeatureMeta(dir)!.issue).toBe(ISSUE);

    res = await cmdIssues(args(["link", "shipit", "https://github.com/o/r/pull/11"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("already links PR");

    const noPrItem = join(root, ".works", "dones", "other_20260101_0001");
    await mkdir(noPrItem, { recursive: true });
    await writeFile(join(noPrItem, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "other", context: "app", created: "x" }));
    res = await cmdIssues(args(["link", "other", "9", ], { pr: true }), root);
    expect(res.code).toBe(0);
    expect(readFeatureMeta(noPrItem)!.pr).toBe(PR);
  });
});

describe("statusMap delivered + hook env (TC-003, TC-004)", () => {
  it("accepts a delivered key and emits KFW_PROJECT_STATUS_DELIVERED", async () => {
    const dir = await project();
    expect(readProjectConfig(root).project?.statusMap?.delivered).toBe("Done");

    await writeFile(join(root, ".kf", "hooks", "delivered.sh"),
      "#!/usr/bin/env bash\necho \"${KFW_PROJECT_STATUS_DELIVERED}:${KFW_PROJECT_STATUS_DONES}:${KFW_EVENT}\" > \"$KFW_FEATURE_DIR/env.out\"\n");
    const { runHook } = await import("../integrations/hooks.js");
    const res = runHook(root, { feature: "shipit", context: "app", dir, root, from: "dones", to: "dones", approval: "approved" }, { hookName: "delivered" });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, "env.out"), "utf8")).toBe("Done:In review:delivered\n");

    // No delivered key in statusMap → the board still gets the "Done" default.
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", repository: "o/r",
      project: { owner: "me", number: 3, statusMap: { dones: "In review" } },
    }));
    const res2 = runHook(root, { feature: "shipit", context: "app", dir, root, from: "dones", to: "dones", approval: "approved" }, { hookName: "delivered" });
    expect(res2.ok).toBe(true);
    expect(readFileSync(join(dir, "env.out"), "utf8")).toBe("Done:In review:delivered\n");
  });

  it("still rejects bogus statusMap keys and non-string values", async () => {
    await project();
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", project: { owner: "me", number: 3, statusMap: { bogus: "x" } },
    }));
    expect(() => readProjectConfig(root)).toThrow();
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", project: { owner: "me", number: 3, statusMap: { delivered: 5 } },
    }));
    expect(() => readProjectConfig(root)).toThrow();
  });
});

describe("kf issues done (UC-003/UC-004)", () => {
  it("refuses items not in dones (TC-005)", async () => {
    ensureWorksStructure(root);
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "o/r" }));
    await mkdir(join(root, ".works", "testing", "wip_20260101_0000"), { recursive: true });
    await writeFile(join(root, ".works", "testing", "wip_20260101_0000", ".kfw.json"),
      JSON.stringify({ schema: "kanban-flow", feature: "wip", context: "app", created: "x", issue: ISSUE }));
    const res = await cmdIssues(args(["done", "wip"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("archive");
  });

  it("refuses when the linked PR is not merged (TC-006)", async () => {
    const dir = await project({ issue: ISSUE, pr: PR });
    for (const state of ["OPEN", "CLOSED"]) {
      process.env.GH_PR_STATE = state;
      const res = await cmdIssues(args(["done", "shipit"]), root);
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("not merged");
      expect(readFeatureMeta(dir)!.delivered).toBeUndefined();
      expect(ghCalls()).not.toContain("issue close");
    }
    process.env.GH_FAIL = "1";
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(1);
    expect(readFeatureMeta(dir)!.delivered).toBeUndefined();
  });

  it("verifies a merged PR, runs delivered.sh (close + board), and stamps delivered (TC-007)", async () => {
    const dir = await project({ issue: ISSUE, pr: PR });
    await seedPackHooks("delivered.sh");
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("delivered");
    const calls = ghCalls();
    expect(calls).toContain(`pr view ${PR}`);
    expect(calls).toContain(`issue close ${ISSUE}`);
    expect(calls).toContain("project item-edit");
    const meta = readFeatureMeta(dir)!;
    expect(meta.delivered).toBe(true);
    expect(meta.deliveredAt).toBeTruthy();
  });

  it("delivers without the merge check when no pr is linked (TC-008)", async () => {
    const dir = await project({ issue: ISSUE });
    await seedPackHooks("delivered.sh");
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(ghCalls()).not.toContain("pr view");
    expect(ghCalls()).toContain(`issue close ${ISSUE}`);
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
  });

  it("is idempotent — a re-run reconciles side effects (TC-009)", async () => {
    const dir = await project({ issue: ISSUE });
    await seedPackHooks("delivered.sh");
    await cmdIssues(args(["done", "shipit"]), root);
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already marked delivered");
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
  });

  it("records delivered with a warning when the item has no issue (TC-010)", async () => {
    const dir = await project();
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no linked issue");
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
  });

  it("warns and still records when no delivered.sh resolves (TC-011)", async () => {
    const dir = await project({ issue: ISSUE });
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("delivered.sh");
    expect(ghCalls()).not.toContain("issue close");
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
  });

  it("survives an issue that GitHub already closed — native Closes #N or manual (TC-014)", async () => {
    const dir = await project({ issue: ISSUE });
    await seedPackHooks("delivered.sh");
    process.env.GH_CLOSE_FAIL = "1";
    const res = await cmdIssues(args(["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(ghCalls()).toContain(`issue close ${ISSUE}`);
    expect(readFeatureMeta(dir)!.delivered).toBe(true);
  });
});

describe("dones.sh no longer closes issues (TC-013)", () => {
  it("runs the AC-free path and never calls `gh issue close`", async () => {
    const dir = await project({ issue: ISSUE });
    await seedPackHooks("dones.sh");
    const res = spawnSync("bash", [join(root, ".kf", "hooks", "dones.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        KFW_FEATURE: "shipit",
        KFW_FEATURE_DIR: dir,
        KFW_WORK_ROOT: root,
        KFW_REPOSITORY: "o/r",
        KFW_PROJECT_OWNER: "me",
        KFW_PROJECT_NUMBER: "3",
        KFW_PROJECT_AC_GATE: "0",
        KFW_PROJECT_STATUS_DONES: "In review",
      },
    });
    expect(res.status).toBe(0);
    const calls = ghCalls();
    expect(calls).not.toContain("issue close");
    expect(calls).toContain("project item-edit");
  });
});

describe("undelivered warning (UC-005, TC-012)", () => {
  it("doctor warns for dones + issue + !delivered, silent otherwise; status shows the hint", async () => {
    await project({ issue: ISSUE });
    const findings = runDoctor(root).findings;
    const f = findings.find((x) => x.area.includes("shipit"));
    expect(f?.level).toBe("WARNING");
    expect(f?.action).toContain("kf issues done");

    const statusText = renderStatusText(computeStatus(findFeature(root, "shipit")!));
    expect(statusText).toContain("Delivered: no");

    const dir = join(root, ".works", "dones", "shipit_20260101_0000");
    await writeFile(join(dir, ".kfw.json"), JSON.stringify({
      schema: "kanban-flow", feature: "shipit", context: "app", created: "x", issue: ISSUE, delivered: true,
    }));
    expect(runDoctor(root).findings.filter((x) => x.area.includes("shipit"))).toEqual([]);

    // no-issue dones item stays silent
    await mkdir(join(root, ".works", "dones", "quiet_20260101_0002"), { recursive: true });
    await writeFile(join(root, ".works", "dones", "quiet_20260101_0002", ".kfw.json"),
      JSON.stringify({ schema: "kanban-flow", feature: "quiet", context: "app", created: "x" }));
    expect(runDoctor(root).findings.filter((x) => x.area.includes("quiet"))).toEqual([]);
  });
});
