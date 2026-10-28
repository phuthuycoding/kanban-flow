import { rm } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ARTIFACTS, UC_FILE_NAME, UC_FILE_PATTERN } from "./schema.js";
import { assertPathName, type Feature } from "./features.js";
import { splitFrontmatter, applyFrontmatter, getFmValue } from "../shared/frontmatter.js";
import { writeFileAtomic } from "../shared/paths.js";

export interface CanonicalCopy {
  destination: string;
  content: string;
  original: string | null;
  kind: CanonicalKind;
}

function archivedDocument(raw: string): string {
  const { fm, body } = splitFrontmatter(raw);
  if (Object.keys(fm).length === 0) return raw;
  fm.status = "archived";
  return applyFrontmatter(fm, body);
}

/** Only the Status column of the "Use Case Files" table flips; coverage tables keep their text. */
function implementedUseCaseRows(raw: string): string {
  let inFiles = false;
  return raw
    .split("\n")
    .map((line) => {
      if (line.startsWith("## ")) inFiles = line.trim() === "## Use Case Files";
      return inFiles && line.startsWith("|") ? line.replace(/\|\s*planned\s*\|\s*$/, "| implemented |") : line;
    })
    .join("\n");
}

/**
 * How a source artifact becomes its canonical doc. `result` keeps its own status (PASS);
 * everything else describes delivered behavior and is stamped archived.
 */
export type CanonicalKind = "requirement" | "use-case-index" | "use-case" | "diagram" | "testplan" | "result";

export function canonicalContent(kind: CanonicalKind, raw: string): string {
  if (kind === "result") return raw;
  if (kind === "use-case-index") {
    const linked = raw.replace(new RegExp(`use-cases/(${UC_FILE_NAME})`, "gi"), "$1");
    return archivedDocument(implementedUseCaseRows(linked));
  }
  return archivedDocument(raw);
}

/** Canonical doc paths a feature owns, whether or not they exist on disk. */
export function canonicalDocPaths(root: string, feature: Feature): string[] {
  if (!feature.context || feature.meta?.kind === "bug") return [];
  const base = join(root, "docs");
  const { context, name } = { context: feature.context, name: feature.name };
  const useCaseDir = join(base, "use-cases", context, name);
  const files = [
    join(base, "requirement", context, `${name}.md`),
    join(base, "testplan", context, `${name}.md`),
    join(base, "testplan", context, `${name}-result.md`),
  ];
  if (existsSync(useCaseDir)) files.push(useCaseDir);
  return files.filter((p) => existsSync(p));
}

export function prepareCanonicalCopies(root: string, feature: Feature): CanonicalCopy[] {
  if (!feature.context) return [];
  if (feature.meta?.kind === "bug") return [];
  assertPathName(feature.context, "context");
  assertPathName(feature.name, "feature");

  const context = feature.context;
  const base = join(root, "docs");
  const mappings: [string, string, CanonicalKind][] = [
    [ARTIFACTS["spec-requirement"].file, join(base, "requirement", context, `${feature.name}.md`), "requirement"],
    [ARTIFACTS["use-case-specification"].file, join(base, "use-cases", context, feature.name, "README.md"), "use-case-index"],
    [ARTIFACTS["use-case-diagram"].file, join(base, "use-cases", context, feature.name, "diagram.md"), "diagram"],
    [ARTIFACTS["test-cases"].file, join(base, "testplan", context, `${feature.name}.md`), "testplan"],
    [ARTIFACTS["testing-result"].file, join(base, "testplan", context, `${feature.name}-result.md`), "result"],
  ];

  const copies: CanonicalCopy[] = mappings.map(([sourceFile, destination, kind]) => {
    const source = join(feature.dir, sourceFile);
    if (!existsSync(source)) throw new Error(`Cannot sync canonical docs: missing source artifact ${source}`);
    return {
      destination,
      content: canonicalContent(kind, readFileSync(source, "utf8")),
      original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
      kind,
    };
  });

  const useCaseSourceDir = join(feature.dir, "use-cases");
  if (existsSync(useCaseSourceDir)) {
    for (const file of readdirSync(useCaseSourceDir).filter((entry) => UC_FILE_PATTERN.test(entry))) {
      const source = join(useCaseSourceDir, file);
      const destination = join(base, "use-cases", context, feature.name, file);
      copies.push({
        destination,
        content: canonicalContent("use-case", readFileSync(source, "utf8")),
        original: existsSync(destination) ? readFileSync(destination, "utf8") : null,
        kind: "use-case",
      });
    }
  }

  const legacy = join(base, "use-cases", context, `${feature.name}.md`);
  // Older versions stored requirement mirrors under docs/use-cases.
  if (existsSync(legacy) && !copies.some((copy) => copy.destination === legacy)) {
    const raw = readFileSync(legacy, "utf8");
    copies.push({ destination: legacy, content: archivedDocument(raw), original: raw, kind: "requirement" });
  }
  return copies;
}

/**
 * Older versions copied these docs without the archived stamp. Such a doc is not an edit when
 * stamping it yields the new copy. Only the pre-stamp statuses qualify, so a hand-set status
 * (e.g. superseded) is still reported as changed instead of being normalized away.
 */
export function isUnstampedSnapshot(copy: CanonicalCopy): boolean {
  if (copy.original === null) return false;
  const status = getFmValue(copy.original, "status");
  if (status !== null && status !== "planning") return false;
  return canonicalContent(copy.kind, copy.original) === copy.content;
}

export async function writeCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) await writeFileAtomic(copy.destination, copy.content);
}

export async function rollbackCanonicalCopies(copies: CanonicalCopy[]): Promise<void> {
  for (const copy of copies) {
    if (copy.original === null) await rm(copy.destination, { force: true });
    else await writeFileAtomic(copy.destination, copy.original);
  }
}
