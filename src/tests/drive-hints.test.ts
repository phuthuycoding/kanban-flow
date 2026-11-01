import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === "tests" ? [] : sources(path);
    return e.name.endsWith(".ts") ? [path] : [];
  });
}

describe("re-approve hints", () => {
  it("never tell the human to run kf stage <f> implementation after kf approve, which already starts the item", () => {
    const offenders = sources(join(PKG_ROOT, "src")).flatMap((file) =>
      readFileSync(file, "utf8").split("\n").map((line, i) => ({ file, line: i + 1, text: line }))
        .filter((l) => /kf approve \$\{[^}]+\}[^`]*kf stage \$\{[^}]+\} implementation/.test(l.text)));
    expect(offenders).toEqual([]);
  });
});
