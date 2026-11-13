import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature, readFeatureMeta } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdIssues } from "../cli/commands/issues.js";
import type { ParsedArgs } from "../cli/args.js";

/**
 * A `gh` stand-in on PATH. It appends its argv to $GH_CALLS and answers per subcommand:
 * `issue list` prints $GH_LIST, `issue view` prints $GH_VIEW, `issue create` prints $GH_ISSUE_URL,
 * and any call fails with "boom" when $GH_FAIL is set.
 */
const GH_STUB = `#!/usr/bin/env bash
echo "gh $*" | tr "\\n" " " | sed "s/ $//" >> "\${GH_CALLS}"; echo >> "\${GH_CALLS}"
if [ -n "$GH_FAIL" ]; then echo "boom: $GH_FAIL" >&2; exit 1; fi
case "$1 $2" in
  "issue list") printf '%s\\n' "$GH_LIST" ;;
  "issue view") printf '%s\\n' "$GH_VIEW" ;;
  "issue create") printf '%s\\n' "$GH_ISSUE_URL" ;;
esac
exit 0
`;

const args = (positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command: "issues", positionals, options });
const filledSpec = "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.\n## Affected surfaces\nN/A\n";

let root: string;
let prevPath: string | undefined;
const calls = (): string[] => (existsSync(join(root, "gh-calls.log")) ? readFileSync(join(root, "gh-calls.log"), "utf8").split("\n").filter((l) => l !== "") : []);
const feature = () => findFeature(root, "demo")!;

async function configure(config: Record<string, unknown> = { repository: "o/r" }): Promise<void> {
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261113_0409", worktree: { enabled: false }, ...config }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-issues-cmds-"));
  ensureWorksStructure(root);
  await configure();
  const bin = join(root, "stubbin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), GH_STUB, { mode: 0o755 });
  prevPath = process.env.PATH;
  process.env.PATH = `${bin}:${prevPath}`;
  process.env.GH_CALLS = join(root, "gh-calls.log");
});

afterEach(async () => {
  process.env.PATH = prevPath;
  for (const v of Object.keys(process.env)) if (v.startsWith("GH_")) delete process.env[v];
  await rm(root, { recursive: true, force: true });
});

describe("kf issues list", () => {
  const rows = JSON.stringify([
    { number: 7, title: "Fix login", state: "OPEN", labels: [{ name: "bug" }, { name: "p1" }], url: "https://github.com/o/r/issues/7" },
    { number: 12, title: "Add export", state: "CLOSED", labels: [], url: "https://github.com/o/r/issues/12" },
  ]);

  it("prints one line per issue with its labels and asks gh for open issues, 30 at most, by default", async () => {
    process.env.GH_LIST = rows;
    const res = await cmdIssues(args(), root);
    expect(res.code).toBe(0);
    expect(res.stdout.split("\n")).toEqual([
      "#7    OPEN    Fix login  [bug, p1]",
      "#12   CLOSED  Add export",
    ]);
    expect(calls()).toEqual(["gh issue list -R o/r --state open --limit 30 --json number,title,state,labels,url"]);
  });

  it("passes --state and --limit on to gh", async () => {
    process.env.GH_LIST = rows;
    const res = await cmdIssues(args([], { state: "closed", limit: "5" }), root);
    expect(res.code).toBe(0);
    expect(calls()).toEqual(["gh issue list -R o/r --state closed --limit 5 --json number,title,state,labels,url"]);
  });

  it("--json prints the issues gh returned as JSON", async () => {
    process.env.GH_LIST = rows;
    const res = await cmdIssues(args([], { json: true }), root);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(JSON.parse(rows));
  });

  it("says there are no issues of that state when gh returns none", async () => {
    process.env.GH_LIST = "[]";
    const res = await cmdIssues(args([], { state: "all" }), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("No all issues on o/r.");
  });

  it("refuses an unknown state and an out-of-range limit without calling gh", async () => {
    const state = await cmdIssues(args([], { state: "bogus" }), root);
    expect(state.code).toBe(1);
    expect(state.stdout).toBe("Unknown state 'bogus'. Expected open, closed or all.");
    for (const limit of ["0", "1001", "abc", "-3"]) {
      const res = await cmdIssues(args([], { limit }), root);
      expect(res.code).toBe(1);
      expect(res.stdout).toBe(`Invalid --limit '${limit}': expected 1..1000.`);
    }
    expect(calls()).toEqual([]);
  });

  it("reports a gh failure with its message and exit 1", async () => {
    process.env.GH_FAIL = "not logged in";
    const res = await cmdIssues(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh failed to list issues:\nboom: not logged in");
  });

  it("reports a missing gh CLI", async () => {
    process.env.PATH = join(root, "empty");
    const res = await cmdIssues(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh CLI not found — install it and run gh auth login to list issues.");
  });

  it("refuses when no repository is configured", async () => {
    await configure({});
    const res = await cmdIssues(args(), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("No repository configured.");
    expect(calls()).toEqual([]);
  });
});

describe("kf issues view", () => {
  it("prints the issue gh returns, for view <n> and for a bare number", async () => {
    process.env.GH_VIEW = "title: Fix login\nstate: OPEN\n";
    for (const positionals of [["view", "7"], ["7"]]) {
      const res = await cmdIssues(args(positionals), root);
      expect(res.code).toBe(0);
      expect(res.stdout).toBe("title: Fix login\nstate: OPEN");
    }
    expect(calls()).toEqual(["gh issue view 7 -R o/r", "gh issue view 7 -R o/r"]);
  });

  it("refuses a missing or malformed number with the usage line", async () => {
    for (const positionals of [["view"], ["view", "abc"], ["view", "0"]]) {
      const res = await cmdIssues(args(positionals), root);
      expect(res.code).toBe(1);
      expect(res.stdout).toBe("Missing issue number. Usage: kf issues view <n>");
    }
    expect(calls()).toEqual([]);
  });

  it("reports a gh failure with its message", async () => {
    process.env.GH_FAIL = "no such issue";
    const res = await cmdIssues(args(["view", "9"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh failed to view issue #9:\nboom: no such issue");
  });
});

describe("kf issues sync", () => {
  beforeEach(async () => {
    expect((await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root)).code).toBe(0);
  });

  it("refuses without a feature name and for an unknown feature", async () => {
    const missing = await cmdIssues(args(["sync"]), root);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("Missing feature name. Usage: kf issues sync <feature>");
    const unknown = await cmdIssues(args(["sync", "nope"]), root);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("Unknown feature 'nope'. Run: kf list");
  });

  it("refuses an item with no linked issue", async () => {
    const res = await cmdIssues(args(["sync", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("'demo' has no linked issue — run kf issues create or kf issues link first.");
    expect(calls()).toEqual([]);
  });

  it("refuses a linked item whose requirement is not filled", async () => {
    expect((await cmdIssues(args(["link", "demo", "7"]), root)).code).toBe(0);
    const res = await cmdIssues(args(["sync", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("'demo' has no filled requirement to sync");
    expect(calls()).toEqual([]);
  });

  it("pushes the filled requirement into the linked issue", async () => {
    expect((await cmdIssues(args(["link", "demo", "7"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), filledSpec);
    const res = await cmdIssues(args(["sync", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toBe("Synced requirement → https://github.com/o/r/issues/7");
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatch(/^gh issue edit https:\/\/github\.com\/o\/r\/issues\/7 -R o\/r --body-file .+body\.md$/);
  });

  it("reports a gh failure while syncing", async () => {
    expect((await cmdIssues(args(["link", "demo", "7"]), root)).code).toBe(0);
    await writeFile(join(feature().dir, ARTIFACTS["spec-requirement"].file), filledSpec);
    process.env.GH_FAIL = "rate limited";
    const res = await cmdIssues(args(["sync", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh failed to sync 'demo' into its issue:\nboom: rate limited");
  });
});

describe("kf issues create", () => {
  beforeEach(async () => {
    expect((await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app", goal: "Readable goal" } }, root)).code).toBe(0);
  });

  it("refuses without a name and for an unknown feature", async () => {
    const missing = await cmdIssues(args(["create"]), root);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toContain("Usage: kf issues create <feature>");
    const unknown = await cmdIssues(args(["create", "nope"]), root);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("Unknown feature 'nope'. Run: kf list");
  });

  it("creates the issue with the goal as title and the kind as label, and records it", async () => {
    process.env.GH_ISSUE_URL = "https://github.com/o/r/issues/21";
    const res = await cmdIssues(args(["create", "demo"]), root);
    expect(res.code, res.stdout).toBe(0);
    expect(res.stdout).toContain("Created https://github.com/o/r/issues/21");
    expect(calls()[0]).toMatch(/^gh issue create -R o\/r --title Readable goal --body .* --label enhancement$/s);
    expect(readFeatureMeta(feature().dir)!.issue).toBe("https://github.com/o/r/issues/21");
  });

  it("uses --title and --label when given", async () => {
    process.env.GH_ISSUE_URL = "https://github.com/o/r/issues/22";
    const res = await cmdIssues(args(["create", "demo"], { title: "Custom", label: ["a", "b"] }), root);
    expect(res.code, res.stdout).toBe(0);
    expect(calls()[0]).toMatch(/^gh issue create -R o\/r --title Custom --body .* --label a --label b$/s);
  });

  it("refuses an item that already links an issue", async () => {
    process.env.GH_ISSUE_URL = "https://github.com/o/r/issues/21";
    expect((await cmdIssues(args(["create", "demo"]), root)).code).toBe(0);
    const res = await cmdIssues(args(["create", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("'demo' already links to https://github.com/o/r/issues/21.");
  });

  it("refuses when gh does not return an issue URL, and records nothing", async () => {
    process.env.GH_ISSUE_URL = "created!";
    const res = await cmdIssues(args(["create", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh did not return an issue URL:\ncreated!");
    expect(readFeatureMeta(feature().dir)!.issue).toBeUndefined();
  });

  it("reports a gh failure", async () => {
    process.env.GH_FAIL = "forbidden";
    const res = await cmdIssues(args(["create", "demo"]), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toBe("gh failed to create issue for 'demo':\nboom: forbidden");
  });
});

describe("kf issues link and the usage errors", () => {
  beforeEach(async () => {
    expect((await cmdNew({ command: "new", positionals: ["demo"], options: { context: "app" } }, root)).code).toBe(0);
  });

  it("refuses link without a target or for an unknown feature", async () => {
    const usage = await cmdIssues(args(["link", "demo"]), root);
    expect(usage.code).toBe(1);
    expect(usage.stdout).toContain("Usage: kf issues link <feature>");
    const unknown = await cmdIssues(args(["link", "nope", "3"]), root);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toBe("Unknown feature 'nope'. Run: kf list");
  });

  it("refuses --replace on an issue link and a PR link that is already recorded without --replace", async () => {
    const replace = await cmdIssues(args(["link", "demo", "3"], { replace: true }), root);
    expect(replace.code).toBe(1);
    expect(replace.stdout).toContain("--replace applies to a pull request link only");
    expect((await cmdIssues(args(["link", "demo", "4"], { pr: true }), root)).code).toBe(0);
    const again = await cmdIssues(args(["link", "demo", "5"], { pr: true }), root);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain("already links PR https://github.com/o/r/pull/4");
  });

  it("refuses a target that is neither a number nor a matching URL", async () => {
    const pr = await cmdIssues(args(["link", "demo", "nope"], { pr: true }), root);
    expect(pr.stdout).toBe("'nope' is neither a PR number nor a GitHub pull request URL.");
    const issue = await cmdIssues(args(["link", "demo", "nope"]), root);
    expect(issue.stdout).toBe("'nope' is neither an issue number nor a GitHub issue URL.");
  });

  it("links an issue given as a URL", async () => {
    const res = await cmdIssues(args(["link", "demo", "https://github.com/o/r/issues/8"]), root);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("Linked 'demo' → https://github.com/o/r/issues/8");
  });

  it("refuses --replace when the same PR is already recorded", async () => {
    expect((await cmdIssues(args(["link", "demo", "4"], { pr: true }), root)).code).toBe(0);
    const res = await cmdIssues(args(["link", "demo", "4"], { pr: true, replace: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("already links https://github.com/o/r/pull/4 — nothing to replace.");
  });

  it("refuses --replace with no recorded PR and with an unverifiable one", async () => {
    const none = await cmdIssues(args(["link", "demo", "4"], { pr: true, replace: true }), root);
    expect(none.code).toBe(0);
    process.env.GH_FAIL = "offline";
    const unverifiable = await cmdIssues(args(["link", "demo", "5"], { pr: true, replace: true }), root);
    expect(unverifiable.code).toBe(1);
    expect(unverifiable.stdout).toContain("unverifiable is not closed");
  });

  it("refuses --replace on a repository-less project", async () => {
    expect((await cmdIssues(args(["link", "demo", "4"], { pr: true }), root)).code).toBe(0);
    await configure({});
    const res = await cmdIssues(args(["link", "demo", "5"], { pr: true, replace: true }), root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("No repository configured.");
  });

  it("refuses an unknown subcommand and a done without a name", async () => {
    const unknown = await cmdIssues(args(["frobnicate"]), root);
    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("Unknown issues subcommand 'frobnicate'. Usage: kf issues [");
    const done = await cmdIssues(args(["done"]), root);
    expect(done.code).toBe(1);
    expect(done.stdout).toBe("Missing feature name. Usage: kf issues done <feature> (deprecated — use kf archive <feature>)");
  });
});
