import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDashboardHtml, dashboardData } from "../dashboard/dashboard.js";
import { PHASE_NAMES, STAGES } from "../workflow/schema.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Vietnamese letters that carry a diacritic, plus đ. Plain ASCII words are not Vietnamese enough to flag. */
const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

function walk(dir: string, keep: (path: string) => boolean, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (skip(full)) continue;
    if (entry.isDirectory()) out.push(...walk(full, keep, skip));
    else if (keep(full)) out.push(full);
  }
  return out;
}

/** Report the file and the first offending line, so whoever fixes it knows where to go. */
function firstVietnameseLine(file: string): string | null {
  const lines = readFileSync(file, "utf8").split("\n");
  const index = lines.findIndex((line) => VIETNAMESE.test(line));
  return index === -1 ? null : `${relative(ROOT, file)}:${index + 1}: ${lines[index].trim()}`;
}

function offenders(files: string[]): string[] {
  return files.map(firstVietnameseLine).filter((hit): hit is string => hit !== null);
}

describe("the user-facing surface is English", () => {
  it("leaves no Vietnamese in the shipped source", () => {
    const files = walk(
      join(ROOT, "src"),
      (p) => p.endsWith(".ts"),
      (p) => p === join(ROOT, "src", "tests"),
    );
    expect(files.length).toBeGreaterThan(20);
    expect(offenders(files)).toEqual([]);
  });

  it("leaves no Vietnamese in the skills or the templates, and keeps every skill intact", () => {
    const skillFiles = walk(join(ROOT, "skills"), (p) => p.endsWith("SKILL.md"));
    const templates = walk(join(ROOT, "kanban-flow", "templates"), (p) => p.endsWith(".md"));
    expect(skillFiles).toHaveLength(8);
    expect(offenders([...skillFiles, ...templates])).toEqual([]);
    for (const file of skillFiles) {
      const head = readFileSync(file, "utf8").split("---")[1] ?? "";
      expect(head, file).toMatch(/\nname:\s*\S/);
      expect(head, file).toMatch(/\ndescription:\s*\S/);
    }
  });

  it("leaves no Vietnamese in the documentation a reader reaches", () => {
    const docs = [
      join(ROOT, "README.md"),
      join(ROOT, "docs", "README.md"),
      join(ROOT, "kanban-flow", "README.md"),
      ...walk(join(ROOT, "docs", "workflow"), (p) => p.endsWith(".md")),
    ];
    expect(docs).toHaveLength(13);
    expect(offenders(docs)).toEqual([]);
  });

  it("names every phase in English", () => {
    for (const stage of STAGES) expect(PHASE_NAMES[stage], stage).not.toMatch(VIETNAMESE);
  });
});

describe("the dashboard page", () => {
  it("declares English and carries the package name", () => {
    const html = renderDashboardHtml();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>kanban-flow dashboard</title>");
    expect(html).not.toMatch(VIETNAMESE);
  });

  it("labels an item with no context, and every approval state, in English", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kf-surface-"));
    try {
      const path = join(dir, ".works", "planning", "legacy_20260917_1200");
      await mkdir(path, { recursive: true });
      // No context on purpose: this is the row that used to read "Không xác định".
      await writeFile(join(path, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "legacy", created: "20260917_1200" }));

      const data = dashboardData(dir, {});
      const contextLabels = data.availableContexts.map((c) => c.label);
      expect(contextLabels).toContain("Unassigned");
      expect(data.charts.byContext.map((r) => r.label)).toContain("Unassigned");
      for (const label of [...contextLabels, ...data.charts.approvals.map((r) => r.label)]) {
        expect(label, label).not.toMatch(VIETNAMESE);
      }
      expect(data.charts.approvals.map((r) => r.label)).toEqual(["Awaiting approval", "Approved", "Contract changed"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the published package", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  it("is named and versioned for this release, and keeps the kf binary", () => {
    // Published under the author's scope. The bare name was taken for a first release
    // and then dropped, and the lockfile carries the name too — it drifts silently otherwise.
    expect(pkg.name).toBe("@phuthuycoding/kanban-flow");
    expect(pkg.version).toBe("0.3.0");
    expect(pkg.bin.kf).toBe("dist/index.js");
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    expect(lock.name).toBe("@phuthuycoding/kanban-flow");
    expect(lock.packages[""].name).toBe("@phuthuycoding/kanban-flow");
  });

  it("carries the metadata npm needs to publish", () => {
    expect(pkg.repository?.url).toMatch(/github\.com/);
    expect(pkg.homepage).toMatch(/^https:\/\//);
    expect(pkg.bugs?.url).toMatch(/^https:\/\//);
    expect(Array.isArray(pkg.keywords) && pkg.keywords.length).toBeTruthy();
    expect(pkg.publishConfig?.access).toBe("public");
  });

  it("ships an MIT licence naming a year and an owner", () => {
    const licence = readFileSync(join(ROOT, "LICENSE"), "utf8");
    expect(licence).toContain("MIT License");
    expect(licence).toMatch(/Copyright \(c\) \d{4} \S/);
  });

  it("leaves the internal canonical docs out of the tarball", () => {
    expect(pkg.files).toContain("docs/workflow");
    for (const internal of ["docs", "docs/requirement", "docs/use-cases", "docs/testplan"]) {
      expect(pkg.files, internal).not.toContain(internal);
    }
  });
});

describe("documentation links", () => {
  const headingSlug = (heading: string) =>
    heading.trim().toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");

  it("point at files that exist, at anchors that exist", () => {
    const docs = [
      join(ROOT, "README.md"),
      join(ROOT, "docs", "README.md"),
      join(ROOT, "kanban-flow", "README.md"),
      ...walk(join(ROOT, "docs", "workflow"), (p) => p.endsWith(".md")),
    ];
    const broken: string[] = [];
    let checked = 0;
    for (const file of docs) {
      for (const [, target] of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        checked += 1;
        const [path, anchor] = target.split("#");
        const full = resolve(dirname(file), path);
        if (!existsSync(full) || !statSync(full).isFile()) {
          broken.push(`${relative(ROOT, file)} -> ${target} (no such file)`);
          continue;
        }
        if (!anchor) continue;
        const headings = [...readFileSync(full, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => headingSlug(m[1]));
        if (!headings.includes(anchor)) broken.push(`${relative(ROOT, file)} -> ${target} (no such anchor)`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(broken).toEqual([]);
  });
});
