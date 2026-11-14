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
const KINDS = ["function", "class", "constant", "type"];
const PACKAGE_NAME = "@phuthuycoding/kanban-flow";

// Escapes regex metacharacters so the package name can sit inside a RegExp built from a string.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface DocRow {
  name: string;
  kind: string;
  stability: string;
  what: string;
}

// Rows of the `| Export | Kind | Stability | What it does |` table; the export name sits in backticks.
function parseExportRows(markdown: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const name = /^`([^`]+)`$/.exec(cells[0] ?? "")?.[1];
    if (name === undefined) continue;
    rows.push({ name, kind: cells[1] ?? "", stability: cells[2] ?? "", what: cells[3] ?? "" });
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

// The text before the first `## ` heading: the purpose and readers paragraphs.
function introOf(markdown: string): string {
  const first = markdown.search(/^## /m);
  return first === -1 ? markdown : markdown.slice(0, first);
}

// The sentence that the library runs no git and reads no host config.
const NO_GIT_NO_HOST_CONFIG = /library\s+runs\s+no\s+git\s+and\s+reads\s+no\s+host\s+config/;

// The named types a stable export's declaration references; each must be exported and stable itself.
const REFERENCED_STABLE_TYPES = [
  "EventBase", "DecisionTarget", "DecisionRegion", "ShapeName", "WaveShapeName", "Approval", "Bypass",
  "Cancellation", "WorktreeRegistration", "VerifyWaiver", "ShipState", "StepOutcome", "ItemOrigin", "CapCause",
];

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

  it("marks AmbiguousFeatureError a stable class and says findFeature throws it", () => {
    expect(rows.find((r) => r.name === "AmbiguousFeatureError")).toMatchObject({ kind: "class", stability: "stable" });
    expect(rows.find((r) => r.name === "findFeature")?.what).toMatch(/`AmbiguousFeatureError`/);
  });

  it("marks every type a stable export references as a stable type", () => {
    const byName = new Map(rows.map((r) => [r.name, r]));
    const notStable = REFERENCED_STABLE_TYPES.filter((n) => {
      const row = byName.get(n);
      return row === undefined || row.kind !== "type" || row.stability !== "stable";
    });
    expect(notStable).toEqual([]);
  });

  it("says in the readers paragraphs that the library runs no git and reads no host config", () => {
    expect(introOf(readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8"))).toMatch(NO_GIT_NO_HOST_CONFIG);
  });

  it("says in the readFeatureMeta row that it throws on invalid metadata, returns null with no metadata file and rethrows fs errors", () => {
    const what = rows.find((r) => r.name === "readFeatureMeta")?.what;
    expect(what).toMatch(/throws/);
    expect(what).toMatch(/returns\s+`null`/);
    expect(what).toMatch(/rethrown/);
  });

  // The fold checks only that each event's keys are present, so a caller must not trust the values it returns.
  it("says in the foldItemLog and readItemLog rows that the values are not validated", () => {
    expect(rows.find((r) => r.name === "foldItemLog")?.what).toMatch(/not\s+validated/);
    expect(rows.find((r) => r.name === "readItemLog")?.what).toMatch(/not\s+validated/);
  });

  // Adding a member to an exported union breaks a consumer's exhaustive switch, so it is not a silent change.
  it("says in the Stability section that a new member of an exported union is listed under Changed", () => {
    const stability = sectionOf(readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8"), "Stability");
    expect(stability).not.toMatch(/event\s+added\s+to\s+a\s+union\s+is\s+not\s+breaking/);
    expect(stability).toMatch(/new\s+member\s+of\s+an\s+exported\s+union[^.]*listed\s+under\s+\*\*Changed\*\*/);
  });

  // The reader drops a malformed line silently, so a caller cannot treat the last element as the gate's view.
  it("says in the readStageRecords row that a bad line is skipped without notice and the last element is not the gate's latest record", () => {
    const what = rows.find((r) => r.name === "readStageRecords")?.what;
    expect(what).toMatch(/skipped\s+without\s+notice/);
    expect(what).toMatch(/not\s+the\s+gate's\s+latest\s+record/);
  });

  // The fold copies these fields as the log records them, so a caller must check them before use.
  it("says in the sharedMeta row that values are copied unchecked", () => {
    const what = rows.find((r) => r.name === "sharedMeta")?.what;
    expect(what).toMatch(/values\s+are\s+copied\s+unchecked/);
    expect(what).not.toMatch(/machine-local\s+and\s+legacy\s+keys/);
  });

  // Only the fold refuses a log missing a required key; sharedMeta copies what it is given, so a caller
  // must not read the fold's refusal into it.
  it("says in the sharedMeta row that it checks nothing", () => {
    expect(rows.find((r) => r.name === "sharedMeta")?.what).toMatch(/checks\s+nothing/);
  });

  // An invalid metadata file does not abort the scan; it surfaces on the item instead.
  it("names dir, context and metaError in the Feature row and says listFeatures lists an invalid metadata file with metaError, never thrown", () => {
    const feature = rows.find((r) => r.name === "Feature")?.what;
    expect(feature).toMatch(/`metaError`/);
    expect(feature).toMatch(/`dir`/);
    expect(feature).toMatch(/`context`/);
    const list = rows.find((r) => r.name === "listFeatures")?.what;
    expect(list).toMatch(/`metaError`/);
    expect(list).toMatch(/never\s+thrown/);
  });

  describe("trust and cost section", () => {
    const trustSection = (): string => sectionOf(readFileSync(join(PACKAGE_ROOT, LIBRARY_DOC), "utf8"), "Trust and cost");

    it("has a Trust and cost section with content", () => {
      expect(trustSection().trim()).not.toBe("");
    });

    it("says the library runs no git and reads no host config", () => {
      expect(trustSection()).toMatch(NO_GIT_NO_HOST_CONFIG);
    });

    it("says the readers are synchronous with no timeout and belong off a request path", () => {
      const section = trustSection();
      expect(section).toMatch(/Synchronous,\s+without\s+a\s+timeout/);
      expect(section).toMatch(/synchronous\s+`fs`\s+calls/);
      expect(section).toMatch(/Call\s+them\s+off\s+a\s+request\s+path/);
    });

    it("says no reader writes a file under .works", () => {
      expect(trustSection()).toMatch(/No\s+reader\s+writes\s+a\s+file\s+under\s+`\.works\/`/);
    });

    // Links are followed, so a claim that the readers touch only the folder's own files would be false.
    it("says the readers open only paths inside the given folder plus what a link there points to", () => {
      const section = trustSection();
      expect(section).not.toMatch(/reads\s+only\s+the\s+files\s+of\s+the\s+folder/);
      expect(section).toMatch(/plus\s+whatever\s+a\s+link/);
    });

    it("says the lifecycle fold checks only the keys, not the values, so a service checks the values before use", () => {
      const section = trustSection();
      expect(section).toMatch(/only\s+the\s+keys/);
      expect(section).toMatch(/not\s+the\s+values/);
    });

    // A stable ItemState.meta holds the four keys its type requires, so the fold bullet must say a log
    // without them is refused rather than folded.
    it("says in the fold bullet that the fold refuses a log that does not set created and the other required keys", () => {
      const bullet = trustSection().split("\n").find((line) => line.startsWith("- ") && line.includes("`foldItemLog`"));
      expect(bullet).toBeDefined();
      expect(bullet).toMatch(/refuses\s+a\s+log/);
      expect(bullet).toMatch(/\bcreated\b/);
    });

    it("names the TypeScript moduleResolution settings that resolve the exports map", () => {
      const section = trustSection();
      expect(section).toMatch(/`moduleResolution`\s+`node16`,\s+`nodenext`\s+or\s+`bundler`/);
    });

    it("says listFeatures is a full scan, findFeature runs one per call, and to call listFeatures once and index it", () => {
      const section = trustSection();
      expect(section).toMatch(/`listFeatures`/);
      expect(section).toMatch(/`findFeature`/);
      expect(section).toMatch(/full\s+scan/);
      expect(section).toMatch(/\bonce\b/);
    });

    it("says readItemLog and readStageRecords read the whole file into memory", () => {
      const section = trustSection();
      expect(section).toMatch(/`readItemLog`/);
      expect(section).toMatch(/`readStageRecords`/);
      expect(section).toMatch(/whole\s+file/);
    });

    it("warns that stage records skip bad lines without notice in readStageRecords", () => {
      const section = trustSection();
      expect(section).toMatch(/Stage\s+records\s+skip\s+bad\s+lines/);
      expect(section).toContain("readStageRecords");
    });

    it("says the readers follow symbolic links and do not bound file size, so a service materialises regular files only", () => {
      const section = trustSection();
      expect(section).toMatch(/symbolic\s+links?/);
      expect(section).toMatch(/regular\s+files\s+only/);
      expect(section).toMatch(/no\s+reader\s+bounds\s+file\s+size/);
      expect(section).toMatch(/FIFO/);
    });
  });

  it("links the document from the README", () => {
    const readme = readFileSync(join(PACKAGE_ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/\]\((?:\.\/)?docs\/workflow\/library\.md[^)]*\)/);
  });
});
