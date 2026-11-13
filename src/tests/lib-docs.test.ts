import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIBRARY_DOC = "docs/workflow/library.md";
const STABILITY_MARKS = ["stable", "experimental"];
const KINDS = ["function", "constant", "type"];

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

describe("library stability document", () => {
  let tmp: string;
  let builtNames: string[];
  let sourceNames: string[];
  let rows: DocRow[];

  beforeAll(async () => {
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
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    builtNames = JSON.parse(r.stdout) as string[];

    // The source entry is imported in-process; the specifier is a variable so typecheck does not need the file to exist yet.
    const sourceEntry = "../lib.js";
    const source = (await import(/* @vite-ignore */ sourceEntry)) as Record<string, unknown>;
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

  it("tells consumers to import the lib subpath and calls the bare package the CLI entry", () => {
    const doc = readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8");
    expect(doc).toContain("@phuthuycoding/kanban-flow/lib");
    expect(doc).toMatch(/CLI/);
  });

  it("states the versioning rule for stable exports", () => {
    const doc = readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8");
    expect(doc).toMatch(/major/i);
  });

  it("links the document from the README", () => {
    const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/\]\((?:\.\/)?docs\/workflow\/library\.md[^)]*\)/);
  });
});
