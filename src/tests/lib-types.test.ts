import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(PACKAGE_ROOT, "dist");
const LIB_DTS = join(DIST, "lib.d.ts");
const LIBRARY_DOC = join(PACKAGE_ROOT, "docs", "workflow", "library.md");

// Stability of each row of the `| Export | Kind | Stability | What it does |` table, by export name.
function documentedStability(markdown: string): Map<string, string> {
  const marks = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const name = /^`([^`]+)`$/.exec(cells[0] ?? "")?.[1];
    if (name !== undefined) marks.set(name, cells[2] ?? "");
  }
  return marks;
}

function isInPackage(decl: ts.Declaration): boolean {
  return decl.getSourceFile().fileName.split("/").join(sep).startsWith(DIST + sep);
}

function resolveAlias(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * The named types the declarations of `symbol` reference, followed transitively through types declared
 * in the package. A `typeof <value>` query names a value, not a type, and is not followed; type
 * parameters and types from outside the package (Error, Map, node types) are not collected.
 */
function referencedTypes(checker: ts.TypeChecker, symbol: ts.Symbol): Set<string> {
  const found = new Set<string>();
  const visited = new Set<ts.Symbol>();

  const follow = (target: ts.Symbol): void => {
    if (visited.has(target)) return;
    visited.add(target);
    for (const decl of target.declarations ?? []) {
      if (isInPackage(decl)) walk(decl);
    }
  };

  const reference = (nameNode: ts.Node): void => {
    const raw = checker.getSymbolAtLocation(nameNode);
    if (raw === undefined) return;
    const target = resolveAlias(checker, raw);
    if (target.flags & ts.SymbolFlags.TypeParameter) return;
    const declarations = target.declarations ?? [];
    if (declarations.length === 0 || !declarations.some(isInPackage)) return;
    found.add(target.getName());
    follow(target);
  };

  const walk = (node: ts.Node): void => {
    if (ts.isTypeQueryNode(node)) return;
    if (ts.isTypeReferenceNode(node)) reference(node.typeName);
    else if (ts.isExpressionWithTypeArguments(node)) reference(node.expression);
    ts.forEachChild(node, walk);
  };

  visited.add(symbol);
  for (const decl of symbol.declarations ?? []) walk(decl);
  return found;
}

describe("types referenced by the stable library exports", () => {
  let exportNames: Set<string>;
  let stability: Map<string, string>;
  let referencedByExport: Map<string, Set<string>>;

  beforeAll(() => {
    const program = ts.createProgram([LIB_DTS], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      noEmit: true,
      types: ["node"],
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(LIB_DTS);
    if (source === undefined) throw new Error(`no program source for ${LIB_DTS}`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) throw new Error(`${LIB_DTS} has no module symbol`);
    const exported = checker.getExportsOfModule(moduleSymbol);
    exportNames = new Set(exported.map((s) => s.getName()));

    stability = documentedStability(readFileSync(LIBRARY_DOC, "utf8"));

    referencedByExport = new Map();
    for (const symbol of exported) {
      if (stability.get(symbol.getName()) !== "stable") continue;
      referencedByExport.set(symbol.getName(), referencedTypes(checker, resolveAlias(checker, symbol)));
    }
  });

  it("resolves the library's exports from the built declarations", () => {
    expect(exportNames.size).toBeGreaterThan(0);
    expect(exportNames.has("LedgerEvent")).toBe(true);
    expect(exportNames.has("LedgerLine")).toBe(true);
  });

  it("collects the base and the decision target of a ledger event and the shape of a ledger line", () => {
    // Known positives: a walker that collects nothing would let every check below pass vacuously.
    expect([...(referencedByExport.get("LedgerEvent") ?? [])]).toEqual(expect.arrayContaining(["EventBase", "DecisionTarget"]));
    expect([...(referencedByExport.get("LedgerLine") ?? [])]).toContain("ShapeName");
  });

  it("does not follow a typeof query into the value it names", () => {
    expect([...(referencedByExport.get("LedgerLine") ?? [])]).not.toContain("LEDGER_SHAPES");
  });

  it("exports by name and marks stable every type a stable export references", () => {
    const violations: string[] = [];
    for (const [name, referenced] of referencedByExport) {
      for (const type of [...referenced].sort()) {
        if (!exportNames.has(type)) violations.push(`${name} references ${type}, which the library does not export`);
        else if (stability.get(type) !== "stable") violations.push(`${name} references ${type}, which the document does not mark stable`);
      }
    }
    expect(violations).toEqual([]);
  });
});
