import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as source from "../lib.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY_DOC = "docs/workflow/library.md";
const STABILITY_MARKS = ["stable", "experimental"];
const KINDS = ["function", "constant", "type"];
const PACKAGE_NAME = "@phuthuycoding/kanban-flow";

// Escapes regex metacharacters so the package name can sit inside a RegExp built from a string.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface DocRow {
  name: string;
  kind: string;
  stability: string;
}

// Rows of the `| Export | Kind | Stability | What it does |` table; the export name sits in backticks.
function parseExportRows(markdown: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const name = /^`([^`]+)`$/.exec(cells[0] ?? "")?.[1];
    if (name === undefined) continue;
    rows.push({ name, kind: cells[1] ?? "", stability: cells[2] ?? "" });
  }
  return rows;
}

// Names in every `export type { ... } from` statement of the source entry (exported name after `as`).
function parseTypeExportNames(entrySource: string): string[] {
  const names: string[] = [];
  for (const m of entrySource.matchAll(/export\s+type\s*\{([^}]*)\}\s*from/g)) {
    for (const part of (m[1] ?? "").split(",")) {
      const spec = part.trim().replace(/^type\s+/, "");
      if (spec === "") continue;
      names.push(spec.split(/\s+as\s+/).pop() ?? spec);
    }
  }
  return names.sort();
}

// Body of a `## <heading>` section, up to the next `## ` heading.
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.search(new RegExp(`^## ${heading}\\s*$`, "m"));
  if (start === -1) return "";
  const rest = markdown.slice(start).split("\n").slice(1).join("\n");
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("library stability document", () => {
  let tmp: string;
  let builtNames: string[];
  let sourceNames: string[];
  let rows: DocRow[];

  beforeAll(() => {
    // The built library is imported the way an installed package would be: through the exports map.
    tmp = mkdtempSync(join(tmpdir(), "kf-lib-docs-"));
    const scope = join(tmp, "node_modules", "@phuthuycoding");
    mkdirSync(scope, { recursive: true });
    symlinkSync(PACKAGE_ROOT, join(scope, "kanban-flow"), "dir");
    const home = join(tmp, "home");
    mkdirSync(home);
    const script = join(tmp, "names.mjs");
    writeFileSync(
      script,
      'import * as lib from "@phuthuycoding/kanban-flow/lib";\nprocess.stdout.write(JSON.stringify(Object.keys(lib).sort()));\n',
    );
    const r = spawnSync(process.execPath, [script], { cwd: tmp, env: { ...process.env, HOME: home }, encoding: "utf8" });
    expect(r.status, `names.mjs exited with ${String(r.status)}; stderr: ${r.stderr}`).toBe(0);
    builtNames = JSON.parse(r.stdout) as string[];

    sourceNames = Object.keys(source).sort();

    rows = parseExportRows(readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("exposes a non-empty list of runtime export names", () => {
    expect(builtNames.length).toBeGreaterThan(0);
  });

  it("exports the same runtime names from the built library and from the source entry", () => {
    expect(sourceNames).toEqual(builtNames);
  });

  it("lists every runtime export in the document", () => {
    const documented = new Set(rows.map((r) => r.name));
    const missing = builtNames.filter((n) => !documented.has(n));
    expect(missing).toEqual([]);
  });

  it("marks every documented export as stable or experimental with a known kind", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(STABILITY_MARKS, `stability of ${row.name}`).toContain(row.stability);
      expect(KINDS, `kind of ${row.name}`).toContain(row.kind);
    }
  });

  it("documents no function or constant the library does not export", () => {
    const runtime = new Set(builtNames);
    const phantom = rows.filter((r) => r.kind !== "type" && !runtime.has(r.name)).map((r) => r.name);
    expect(phantom).toEqual([]);
  });

  it("documents a type row for exactly the types src/lib.ts exports", () => {
    const typeNames = parseTypeExportNames(readFileSync(join(PACKAGE_ROOT, "src", "lib.ts"), "utf8"));
    expect(typeNames.length).toBeGreaterThan(0);
    const documentedTypes = rows.filter((r) => r.kind === "type").map((r) => r.name).sort();
    expect(documentedTypes).toEqual(typeNames);
  });

  it("calls the bare package the CLI entry that runs a kf command from process.argv", () => {
    const doc = readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8");
    expect(doc).toMatch(new RegExp(`bare\\s+\`${escapeRegExp(PACKAGE_NAME)}\`\\s+is\\s+the\\s+CLI\\s+entry`));
    expect(doc).toMatch(/importing\s+it\s+runs\s+a\s+`kf`\s+command\s+from\s+`process\.argv`/);
  });

  it("tells consumers to import the lib subpath and never the bare package", () => {
    const doc = readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8");
    expect(doc).toMatch(
      new RegExp(`Import\\s+\`${escapeRegExp(PACKAGE_NAME)}/lib\`,\\s+never\\s+the\\s+bare\\s+package,\\s+to\\s+use\\s+the\\s+library`),
    );
  });

  it("states in the Stability section that breaking a stable export is a major version", () => {
    const doc = readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8");
    const stability = sectionOf(doc, "Stability");
    expect(stability).not.toBe("");
    expect(stability).toMatch(
      /^- \*\*stable\*\* — removing or renaming the export, or changing a parameter or the shape it returns in a way existing callers notice, is a breaking change: a major version\./m,
    );
  });

  describe("trust and cost section", () => {
    const trustSection = (): string => sectionOf(readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8"), "Trust and cost");

    it("has a Trust and cost section with content", () => {
      expect(trustSection().trim()).not.toBe("");
    });

    it("tells callers to pass only trees they trust because git runs where .kfw.json points", () => {
      const section = trustSection();
      expect(section).toMatch(/\*\*Only\s+trusted\s+trees\.\*\*/);
      expect(section).toMatch(/`computeStatus`/);
      expect(section).toMatch(/`worktree\.path`/);
      expect(section).toMatch(/`\.kfw\.json`/);
      expect(section).toMatch(/Pass\s+these\s+readers\s+only\s+trees\s+the\s+caller\s+trusts/);
    });

    it("says the readers depend on the host's global and workspace config and warn on stderr", () => {
      const section = trustSection();
      expect(section).toMatch(/`~\/\.kf\/config\.json`/);
      expect(section).toMatch(/`\.kf\/workspace\.json`/);
      expect(section).toMatch(/`kf:\s+<path>:\s+not\s+applied[^`]*`\s+warning\s+on\s+stderr/);
    });

    it("says the readers are synchronous with no timeout and belong off a request path", () => {
      const section = trustSection();
      expect(section).toMatch(/Synchronous,\s+without\s+a\s+timeout/);
      expect(section).toMatch(/synchronous\s+`fs`\s+calls/);
      expect(section).toMatch(/git\s+as\s+a\s+child\s+process\s+that\s+has\s+no\s+timeout/);
      expect(section).toMatch(/Call\s+them\s+off\s+a\s+request\s+path/);
    });

    it("says dashboardData keeps a per-process cache whose entries are never evicted", () => {
      const section = trustSection();
      expect(section).toMatch(/A\s+per-process\s+cache/);
      expect(section).toMatch(/`dashboardData`,\s+through\s+the\s+status\s+text\s+it\s+renders\s+for\s+each\s+item\s+that\s+has\s+a\s+worktree,\s+caches\s+the\s+project's\s+`worktree\.domains`\s+flag\s+per\s+root\s+and\s+config\s+version/);
      expect(section).toMatch(/for\s+the\s+life\s+of\s+the\s+process/);
      expect(section).toMatch(/Entries\s+are\s+never\s+evicted/);
    });

    it("says dashboardData runs git for each item in implementation, testing or review", () => {
      expect(trustSection()).toMatch(/`dashboardData`\s+runs\s+git\s+for\s+each\s+item\s+in\s+implementation,\s+testing\s+or\s+review/);
    });

    it("says the excluded git is the kind that changes state, not the read-only git the readers run", () => {
      expect(trustSection()).toMatch(/requirement\s+#184\s+excludes\s+git\s+that\s+changes\s+state,\s+not\s+this\s+read-only\s+git/);
    });

    it("says computeStatus reads the config only with a root and an item in implementation, testing or review, and no reader writes under .works", () => {
      const section = trustSection();
      expect(section).toMatch(/`computeStatus`\s+when\s+it\s+is\s+given\s+a\s+root\s+and\s+the\s+item\s+is\s+in\s+implementation,\s+testing\s+or\s+review/);
      expect(section).toMatch(/No\s+reader\s+writes\s+a\s+file\s+under\s+`\.works\/`/);
    });

    it("names the TypeScript moduleResolution settings that resolve the exports map", () => {
      const section = trustSection();
      expect(section).toMatch(/`moduleResolution`\s+`node16`,\s+`nodenext`\s+or\s+`bundler`/);
    });
  });

  it("links the document from the README", () => {
    const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/\]\((?:\.\/)?docs\/workflow\/library\.md[^)]*\)/);
  });
});
