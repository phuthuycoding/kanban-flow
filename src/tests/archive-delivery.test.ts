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
import { archiveItem } from "../workflow/archive.js";
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
        printf '{"state":"%s","headRefName":"kf/stub","headRefOid":"0123456789abcdef0123456789abcdef01234567"}\\n' "$state"
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
    `---\nstatus: ${status}\nexecution: ${execution}\n${id === "review-report" ? "ci: none\nlanding: none\n" : ""}---\n# Evidence\nVerified.\n${id === "testing-result" ? evidence : ""}`);
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
    project: { owner: "me", number: 3, acGate: false, statusMap: { done: "Done" } },
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

describe("merge gate — kf archive refuses unverifiable delivery", () => {
  it.each(["OPEN", "CLOSED"])("refuses a %s PR with zero side effects", async (state) => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    await seedPackHooks("done.sh");
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

  it("refuses when the PR state is unverifiable — gh failure, garbage output, missing repository", async () => {
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

  it("has no --force escape", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["shipit"], { force: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature().stage).toBe("review");
  });

  it("refuses an already-done item whose PR is unmerged", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    expect(feature().stage).toBe("done");

    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
  });

  it("applies to bug items too", async () => {
    await reviewBug();
    await link("buggy", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdArchive(args("archive", ["buggy"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature("buggy").stage).toBe("review");
  });
});

describe("finalization — archive is the delivery gate", () => {
  it("delivers a merged item: move, docs, done hook close+board, flag last", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    await seedPackHooks("done.sh");

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(feature().stage).toBe("done");
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

  it("packaged done.sh closes the issue and moves the board; delivered.sh is gone", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("done.sh");

    const res = spawnSync("bash", [join(root, ".kf", "hooks", "done.sh")], {
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
        KFW_PROJECT_STATUS_DONE: "Done",
      },
    });
    expect(res.status).toBe(0);
    const calls = ghCalls();
    expect(calls).toContain(`issue close ${ISSUE}`);
    expect(calls).toContain("project item-edit");

    const packFiles = await readdir(PKG_GITHUB_HOOKS_DIR);
    expect(packFiles).not.toContain("delivered.sh");
    // The hook is resolved by stage name, so a pack still shipping the old names is silently skipped.
    expect(packFiles).toContain("done.sh");
    expect(packFiles).not.toContain("dones.sh");
    expect(packFiles).not.toContain("shipping.sh");
  });

  it("rolls back a mid-pass failure — folder restored, flag never written", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    // Canonical docs can't be written when the destination path is a directory.
    await mkdir(join(root, "docs", "requirement", "app", "shipit.md"), { recursive: true });

    await expect(cmdArchive(args("archive", ["shipit"]), root)).rejects.toThrow();
    expect(feature().stage).toBe("review");
    expect(readFeatureMeta(feature().dir)!.delivered).toBeUndefined();
  });

  it("kf stage <f> done hits the same merge gate", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const res = await cmdStage(args("stage", ["shipit", "done"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not merged");
    expect(feature().stage).toBe("review");
  });
});

describe("archive without PR evidence", () => {
  it("proceeds on the human's run — the invocation is the confirmation", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("done.sh");
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(ghCalls()).not.toContain("pr view");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);
  });

  it("warns when no issue is linked", async () => {
    await reviewStage();
    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no linked issue");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);
  });

  it("archives a bug the same way", async () => {
    await reviewBug();
    await link("buggy", { issue: ISSUE });
    const res = await cmdArchive(args("archive", ["buggy"]), root);
    expect(res.code).toBe(0);
    expect(feature("buggy").stage).toBe("done");
    expect(readFeatureMeta(feature("buggy").dir)!.delivered).toBe(true);
  });
});

describe("a review report written before ci/landing existed", () => {
  it("closes on its merged PR with a single gh lookup", async () => {
    await reviewStage();
    const execution = readFeatureMeta(feature().dir)!.executionId;
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file), `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n`);
    await link("shipit", { pr: PR });

    const res = await cmdArchive(args("archive", ["shipit"]), root);

    expect(res.code, res.stdout).toBe(0);
    expect(feature().stage).toBe("done");
    expect(ghCalls().split("\n").filter((line) => line.startsWith("gh pr view"))).toHaveLength(1);
  });

  it("still refuses when its PR is not merged", async () => {
    await reviewStage();
    const execution = readFeatureMeta(feature().dir)!.executionId;
    await writeFile(join(feature().dir, ARTIFACTS["review-report"].file), `---\nstatus: PASS\nexecution: ${execution}\n---\n# Evidence\nVerified.\n`);
    await link("shipit", { pr: PR });
    process.env.GH_PR_STATE = "OPEN";

    const res = await cmdArchive(args("archive", ["shipit"]), root);

    expect(res.code).toBe(1);
    expect(feature().stage).toBe("review");
  });
});

describe("a teardown failure names only what actually happened", () => {
  /** A worktree that is registered in metadata but was never on disk, and a routes file teardown cannot parse. */
  async function brokenTeardown(): Promise<string> {
    spawnSync("git", ["init", "-q", root]);
    const routesFile = join(root, "routes.json");
    await writeFile(routesFile, "{");
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", worktree: { enabled: true, routesFile } }));
    const path = join(root, "never-created");
    await link("shipit", { worktree: { path, branch: "t/shipit", domain: "shipit.test", port: 4000, createdAt: "20260919_1200" } });
    return path;
  }

  it("does not claim the done hook ran when there is no done hook", async () => {
    await reviewStage();
    const path = await brokenTeardown();

    const outcome = await archiveItem(root, "shipit");

    expect(outcome.kind === "refused" && outcome.reason).toBe("teardown-failed");
    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).not.toContain("done hook");
    expect(text).toContain(`The worktree ${path} is not on disk. The branch was not deleted.`);
    expect(feature().stage).toBe("review");
  });

  it("names the done hook that ran, by its path", async () => {
    await reviewStage();
    const path = await brokenTeardown();
    const hook = join(root, ".kf", "hooks", "done.sh");
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    const outcome = await archiveItem(root, "shipit");

    expect(outcome.kind === "refused" && outcome.reason).toBe("teardown-failed");
    const text = outcome.kind === "refused" ? outcome.stdout : "";
    expect(text).toContain(`The done hook already ran (${hook}). The worktree ${path} is not on disk.`);
    expect(text).not.toContain("issue closed");
  });
});

describe("reconcile — re-archive on done items", () => {
  it("re-runs docs + hook and stamps delivered on a legacy item", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("done.sh");
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

  it("is idempotent on an already-delivered item", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("done.sh");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const firstAt = readFeatureMeta(feature().dir)!.deliveredAt;

    const res = await cmdArchive(args("archive", ["shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already marked delivered");
    expect(readFeatureMeta(feature().dir)!.deliveredAt).toBe(firstAt);
  });
});

describe("visibility — awaiting merge states surface", () => {
  it("status names the merge as the next step only when the close attempt found the PR unmerged", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE, pr: PR });
    const text = renderStatusText({ ...computeStatus(feature()), close: { kind: "awaiting-merge", pr: PR } });
    expect(text).toContain(`Awaiting merge: ${PR}`);
    expect(text).toContain(`Next: merge ${PR} on GitHub, then kf status`);
    expect(text).not.toContain("kf archive");

    // Rendering is pure: without a close attempt there is no merge hint.
    const plain = renderStatusText(computeStatus(feature()));
    expect(plain).not.toContain("Awaiting merge");
  });

  it("doctor reports awaiting merge for a review PASS item keyed on its recorded PR, not on the issue", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    expect(runDoctor(root).findings.some((f) => f.message.includes("awaiting merge"))).toBe(false);

    await link("shipit", { pr: PR });
    const awaiting = runDoctor(root).findings.find((f) => f.message.includes("awaiting merge"));
    expect(awaiting?.message).toContain(PR);
    expect(awaiting?.action).toBe(`merge ${PR} on GitHub, then run: kf status --change shipit`);
  });

  it("doctor points undelivered done items and inert statusMap.delivered at the right actions", async () => {
    // Legacy done item: archived, linked, never delivered.
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    await seedPackHooks("done.sh");
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    const dir = feature().dir;
    const meta = readFeatureMeta(dir)!;
    delete meta.delivered;
    delete meta.deliveredAt;
    await writeFeatureMeta(dir, meta);

    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
      project: { owner: "me", number: 3, acGate: false, statusMap: { done: "Done", delivered: "Done" } },
    }));

    const findings = runDoctor(root).findings;
    const undelivered = findings.find((f) => f.area.includes("shipit"));
    expect(undelivered?.level).toBe("WARNING");
    expect(undelivered?.action).toContain("kf archive shipit");
    const deadKey = findings.find((f) => f.area === ".kf/config.json" && f.message.includes("statusMap.delivered"));
    expect(deadKey?.level).toBe("WARNING");
  });
});

describe("deprecated alias + removed apparatus", () => {
  it("kf issues done forwards to archive with a deprecation warning", async () => {
    await reviewStage();
    await link("shipit", { issue: ISSUE });
    const res = await cmdIssues(args("issues", ["done", "shipit"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("deprecated");
    expect(feature().stage).toBe("done");
    expect(readFeatureMeta(feature().dir)!.delivered).toBe(true);

    // And on an unmerged PR it refuses exactly like archive.
    await reviewStage("other");
    await link("other", { issue: ISSUE, pr: PR });
    process.env.GH_PR_STATE = "OPEN";
    const refused = await cmdIssues(args("issues", ["done", "other"]), root);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("not merged");
  });

  it("emits no KFW_PROJECT_STATUS_DELIVERED default; statusMap.delivered still parses", async () => {
    await reviewStage();
    const dir = feature().dir;
    await mkdir(join(root, ".kf", "hooks"), { recursive: true });
    await writeFile(join(root, ".kf", "hooks", "done.sh"),
      "#!/usr/bin/env bash\necho \"${KFW_PROJECT_STATUS_DELIVERED:-unset}:${KFW_PROJECT_STATUS_DONE}\" > \"$KFW_FEATURE_DIR/env.out\"\n");
    const res = runHook(root, { feature: "shipit", context: "app", dir, root, from: "review", to: "done", approval: "approved" });
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, "env.out"), "utf8")).toBe("unset:Done\n");

    // A leftover delivered key stays parseable — inert, not a config error.
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", repository: "o/r", worktree: { enabled: false },
      project: { owner: "me", number: 3, statusMap: { done: "Done", delivered: "Done" } },
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

  it("kf issues link --pr --replace swaps a PR closed without merging, and the item then closes on the new one", async () => {
    await reviewStage();
    await link("shipit", { pr: PR });
    process.env.GH_PR_STATE_9 = "CLOSED";
    process.env.GH_PR_STATE_11 = "OPEN";
    expect((await cmdArchive(args("archive", ["shipit"]), root)).stdout).toContain("kf issues link shipit <url> --pr --replace");

    const res = await cmdIssues(args("issues", ["link", "shipit", "11"], { pr: true, replace: true }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain(`replaced ${PR}`);
    expect(readFeatureMeta(feature().dir)!.pr).toBe("https://github.com/o/r/pull/11");
    expect(ghCalls()).toContain(`gh pr view ${PR} -R o/r --json state,headRefName,headRefOid`);

    process.env.GH_PR_STATE_11 = "MERGED";
    expect((await cmdArchive(args("archive", ["shipit"]), root)).code).toBe(0);
    expect(feature().stage).toBe("done");
  });

  it("kf issues link --replace refuses a new PR that is not open on this repository", async () => {
    await reviewStage();
    await link("shipit", { pr: PR });
    process.env.GH_PR_STATE_9 = "CLOSED";
    process.env.GH_PR_STATE_11 = "MERGED";
    const merged = await cmdIssues(args("issues", ["link", "shipit", "11"], { pr: true, replace: true }), root);
    expect(merged.code).toBe(1);
    expect(merged.stdout).toContain("not open");
    const foreign = await cmdIssues(args("issues", ["link", "shipit", "https://github.com/x/y/pull/11"], { replace: true }), root);
    expect(foreign.code).toBe(1);
    expect(foreign.stdout).toContain("is not a pull request of o/r");
    expect(readFeatureMeta(feature().dir)!.pr).toBe(PR);
  });

  it("kf issues link --replace refuses a merged, open or unverifiable recorded PR and keeps the link", async () => {
    await reviewStage();
    await link("shipit", { pr: PR });
    const replace = () => cmdIssues(args("issues", ["link", "shipit", "https://github.com/o/r/pull/11"], { replace: true }), root);

    for (const [state, why] of [["MERGED", "it is merged"], ["OPEN", "it is open, not closed"]] as const) {
      process.env.GH_PR_STATE_9 = state;
      const res = await replace();
      expect(res.code).toBe(1);
      expect(res.stdout).toContain(`Cannot replace ${PR} on 'shipit'`);
      expect(res.stdout).toContain(why);
    }
    process.env.GH_FAIL = "1";
    const res = await replace();
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("could not be verified");
    delete process.env.GH_FAIL;
    expect(readFeatureMeta(feature().dir)!.pr).toBe(PR);

    const issue = await cmdIssues(args("issues", ["link", "shipit", "12"], { replace: true }), root);
    expect(issue.code).toBe(1);
    expect(issue.stdout).toContain("--replace applies to a pull request link only");
  });
});
