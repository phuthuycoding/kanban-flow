import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { commandHelp } from "../cli/args.js";

const read = (file: string) => readFileSync(join(PKG_ROOT, file), "utf8");
const plain = (file: string) =>
  read(file)
    .replace(/<[^>]*>/g, (tag) => (file.endsWith(".html") ? "" : tag))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/`/g, "")
    .replace(/\s+/g, " ");

const SWITCH_RULE =
  "When worktree.domains is false in .kf/config.json, use http://127.0.0.1:<port> (the JSON outputs still carry domain; do not use it then)";

describe("the worktree.domains switch in the docs, skills and config", () => {
  it("tells every skill and the automation-writer to use the direct URL when domains are off", () => {
    for (const file of [
      "skills/test/SKILL.md",
      "skills/review/SKILL.md",
      "skills/implement/SKILL.md",
      "skills/implement/references/automation-writer-brief.md",
      "agents/automation-writer.md",
    ]) {
      const text = plain(file);
      expect(text, file).toContain("When worktree.domains is false in .kf/config.json, use http://127.0.0.1:<port>");
    }
  });

  it("says the JSON outputs still carry domain but must not be used, in the status-reading skills", () => {
    for (const file of ["skills/test/SKILL.md", "skills/review/SKILL.md", "skills/implement/SKILL.md", "agents/automation-writer.md"]) {
      expect(plain(file), file).toContain(SWITCH_RULE);
    }
  });

  it("says KFW_WORKTREE_DOMAIN is set only when domains are on, in the autoconfig guide and the CLI reference", () => {
    for (const file of ["docs/workflow/autoconfig.md", "docs/workflow/cli-reference.md"]) {
      expect(plain(file), file).toContain("KFW_WORKTREE_DOMAIN is set only when worktree.domains is on");
    }
  });

  it("mentions worktree.domains in the kf worktree help", () => {
    expect(commandHelp("worktree")).toContain("worktree.domains");
  });

  it("documents worktree.domains as a boolean defaulting to true in the README, the autoconfig guide and the Pages site", () => {
    for (const file of ["README.md", "docs/workflow/autoconfig.md", ".github/pages/index.html"]) {
      expect(plain(file), file).toContain("worktree.domains (boolean, default true)");
    }
  });

  it("describes what the switch turns off in the README, the autoconfig guide and the Pages site", () => {
    for (const file of ["README.md", "docs/workflow/autoconfig.md", ".github/pages/index.html"]) {
      const text = plain(file);
      for (const needle of [
        "no .test DNS or proxy probes",
        "kf status prints only http://127.0.0.1:<port>",
        "hooks get no KFW_WORKTREE_DOMAIN",
        "JSON outputs still carry domain",
      ]) {
        expect(text, `${file}: ${needle}`).toContain(needle);
      }
    }
  });

  it("turns the domain off in this repository's own config", () => {
    const config = JSON.parse(read(".kf/config.json")) as { worktree?: { enabled?: boolean; domains?: boolean } };
    expect(config.worktree?.domains).toBe(false);
    expect(config.worktree?.enabled).toBe(true);
  });
});
