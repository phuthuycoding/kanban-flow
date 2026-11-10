import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** The text of the `## [0.17.0]` section, up to the next release heading. */
function unreleased(changelog: string): string {
  const start = changelog.indexOf("## [0.17.0]");
  if (start < 0) return "";
  const rest = changelog.slice(start + "## [0.17.0]".length);
  const next = rest.search(/^## \[/m);
  return next < 0 ? rest : rest.slice(0, next);
}

const SURFACES = [
  "README.md",
  ".github/pages/index.html",
  "docs/workflow/harness.md",
  "docs/workflow/cli-reference.md",
];

describe("verify tiers in the user docs", () => {
  for (const file of SURFACES) {
    it(`${file} names the related-tests setting`, () => {
      expect(read(file)).toContain("harness.verify.related");
    });

    it(`${file} names the wave verify command`, () => {
      expect(read(file)).toMatch(/kf verify (&lt;|<)[a-z-]+(&gt;|>) --wave (&lt;|<)w(&gt;|>)|kf verify \S+ --wave/);
    });

    it(`${file} says the next wave waits for the wave suite`, () => {
      expect(read(file)).toMatch(/next wave[\s\S]{0,160}(wait|until|only after)[\s\S]{0,160}wave (suite|verify)/i);
    });

    it(`${file} says the gate reuses the last wave's record`, () => {
      expect(read(file)).toMatch(/(gate|review)[\s\S]{0,200}(reuse|accept)[\s\S]{0,120}last wave/i);
    });
  }

  it("the changelog has an Unreleased entry for the tiers", () => {
    const section = unreleased(read("CHANGELOG.md"));
    expect(section).toContain("harness.verify.related");
    expect(section).toContain("--wave");
  });
});
