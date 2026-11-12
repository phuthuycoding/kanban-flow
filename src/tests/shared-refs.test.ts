import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installSkills, skillEntryState } from "../integrations/install.js";
import { agentById, projectSkillsDir, userSkillsDir } from "../integrations/agents.js";
import { PKG_ROOT } from "../shared/paths.js";

const SHARED = ["researcher-brief.md", "harness-tools.md"];
const CITE_PREFIX = "${CLAUDE_PLUGIN_ROOT}/assets/shared/";

function mdFilesUnder(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) mdFilesUnder(p, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("shared references in the package", () => {
  it("holds the researcher brief and the harness tools once, under assets/shared", () => {
    for (const f of SHARED) {
      expect(existsSync(join(PKG_ROOT, "assets", "shared", f)), `assets/shared/${f}`).toBe(true);
      expect(existsSync(join(PKG_ROOT, "assets", "skills", "flow", "references", f)), `flow/references/${f}`).toBe(false);
    }
  });

  it("cites every mention of a shared reference as the plugin-root assets/shared path", () => {
    const files = [...mdFilesUnder(join(PKG_ROOT, "assets", "skills")), ...mdFilesUnder(join(PKG_ROOT, "assets", "agents"))];
    const mention = new RegExp(SHARED.map(escapeRe).join("|"), "g");
    let mentions = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(mention)) {
        mentions++;
        const before = text.slice(Math.max(0, m.index! - CITE_PREFIX.length), m.index!);
        expect(before, `${file} cites ${m[0]} outside ${CITE_PREFIX}`).toBe(CITE_PREFIX);
      }
    }
    expect(mentions).toBeGreaterThan(0);
  });
});

describe("shared references in codex copies", () => {
  let home: string;
  let project: string;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.KF_ALLOW_WORKTREE_LINK };

  beforeEach(async () => {
    const base = await mkdtemp(join(tmpdir(), "kf-shared-refs-"));
    home = join(base, "home");
    project = join(base, "project");
    await mkdir(home, { recursive: true });
    await mkdir(join(project, ".works"), { recursive: true });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    // The suite runs from an item worktree; the copies are written into a throwaway HOME.
    process.env.KF_ALLOW_WORKTREE_LINK = "1";
  });

  afterEach(async () => {
    for (const [k, v] of [["HOME", saved.HOME], ["USERPROFILE", saved.USERPROFILE], ["KF_ALLOW_WORKTREE_LINK", saved.ALLOW]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(join(home, ".."), { recursive: true, force: true });
  });

  function copyRoots(): { scope: string; root: string }[] {
    const codex = agentById("codex")!;
    return [
      { scope: "global", root: userSkillsDir(codex, home) },
      { scope: "project", root: projectSkillsDir(codex, project) },
    ];
  }

  async function install(scope: "global" | "project"): Promise<{ stdout: string }> {
    const res = await installSkills(project, ["codex"], scope);
    expect(res.code, res.stdout + (res.stderr ?? "")).toBe(0);
    return res;
  }

  for (const scope of ["global", "project"] as const) {
    describe(`${scope} scope`, () => {
      it("writes the shared files into kf-flow/shared", async () => {
        await install(scope);
        const root = copyRoots().find((r) => r.scope === scope)!.root;
        for (const f of SHARED) {
          const copy = join(root, "kf-flow", "shared", f);
          expect(existsSync(copy), copy).toBe(true);
          expect(readFileSync(copy, "utf8")).not.toContain("${CLAUDE_PLUGIN_ROOT}");
        }
      });

      it("leaves no plugin variable and no old-layout package path in any copy", async () => {
        await install(scope);
        const root = copyRoots().find((r) => r.scope === scope)!.root;
        const pkg = escapeRe(PKG_ROOT);
        const oldLayout = new RegExp(`${pkg}/(skills|agents|kanban-flow)/`);
        const copies = readdirSync(root).filter((n) => n.startsWith("kf-")).flatMap((n) => mdFilesUnder(join(root, n)));
        expect(copies.length).toBeGreaterThan(0);
        for (const file of copies) {
          const text = readFileSync(file, "utf8");
          expect(text, file).not.toContain("${CLAUDE_PLUGIN_ROOT}");
          expect(text, file).not.toMatch(oldLayout);
        }
      });

      it("only cites absolute paths that exist, the shared files included", async () => {
        await install(scope);
        const root = copyRoots().find((r) => r.scope === scope)!.root;
        const cited = new RegExp(`(?:${escapeRe(root)}|${escapeRe(PKG_ROOT)})/[^\\s)"'\`,;>\\]<*{}$]+`, "g");
        const copies = readdirSync(root).filter((n) => n.startsWith("kf-")).flatMap((n) => mdFilesUnder(join(root, n)));
        const paths = new Set<string>();
        for (const file of copies) for (const m of readFileSync(file, "utf8").matchAll(cited)) paths.add(m[0].replace(/[.:]+$/, ""));
        for (const f of SHARED) expect(paths, `a copy cites kf-flow/shared/${f}`).toContain(join(root, "kf-flow", "shared", f));
        for (const p of paths) expect(existsSync(p), `cited path ${p}`).toBe(true);
      });

      it("makes kf-brainstorm cite the researcher brief inside kf-flow/shared", async () => {
        await install(scope);
        const root = copyRoots().find((r) => r.scope === scope)!.root;
        const text = readFileSync(join(root, "kf-brainstorm", "SKILL.md"), "utf8");
        const brief = join(root, "kf-flow", "shared", "researcher-brief.md");
        expect(text).toContain(brief);
        expect(existsSync(brief)).toBe(true);
      });
    });
  }

  it("reports an edited shared file as stale and keeps the edit on re-install", async () => {
    await install("global");
    const root = copyRoots()[0]!.root;
    const file = join(root, "kf-flow", "shared", "harness-tools.md");
    const rendered = await readFile(file, "utf8");
    const edited = `${rendered}\nlocal edit\n`;
    await writeFile(file, edited);
    expect(skillEntryState(root, "flow")).toBe("stale");
    const res = await install("global");
    // An edited kf copy is the user's: the install leaves it untouched, as for any other kf copy.
    expect(res.stdout).toContain("left untouched");
    expect(await readFile(file, "utf8")).toBe(edited);
    expect(skillEntryState(root, "flow")).toBe("stale");
  });
});
