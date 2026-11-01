import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { renderDashboardHtml, dashboardData } from "../dashboard/dashboard.js";
import { PHASE_NAMES, STAGES } from "../workflow/schema.js";
import { cmdStage } from "../cli/commands/stage.js";

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

  it("leaves no Vietnamese in the skills, their references, the agents or the templates, and keeps every skill and agent intact", () => {
    const skillFiles = walk(join(ROOT, "skills"), (p) => p.endsWith("SKILL.md"));
    const skillReferences = walk(join(ROOT, "skills"), (p) => p.endsWith(".md") && !p.endsWith("SKILL.md"));
    const agentFiles = walk(join(ROOT, "skills", "kanban-flow", "agents"), (p) => p.endsWith(".md"));
    const templates = walk(join(ROOT, "kanban-flow", "templates"), (p) => p.endsWith(".md"));
    expect(skillFiles).toHaveLength(9);
    expect(agentFiles).toHaveLength(6);
    expect(offenders([...skillFiles, ...skillReferences, ...agentFiles, ...templates])).toEqual([]);
    for (const file of [...skillFiles, ...agentFiles]) {
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
    expect(docs).toHaveLength(14);
    expect(offenders(docs)).toEqual([]);
  });

  it("names every phase in English", () => {
    for (const stage of STAGES) expect(PHASE_NAMES[stage], stage).not.toMatch(VIETNAMESE);
  });
});

describe("the phase skills follow the merge-closes flow", () => {
  const kanbanSkillDirs = readdirSync(join(ROOT, "skills")).filter((name) => name.startsWith("kanban-"));
  const kanbanTexts = kanbanSkillDirs.flatMap((name) =>
    walk(join(ROOT, "skills", name), (p) => p.endsWith(".md")).map((file) => ({ file: relative(ROOT, file), text: readFileSync(file, "utf8") })),
  );

  it("has no ship stage skill and never points at kf ship or a shipping stage", () => {
    expect(kanbanSkillDirs).not.toContain("kanban-ship");
    for (const { file, text } of kanbanTexts) {
      expect(text, file).not.toContain("kf ship");
      expect(text, file).not.toMatch(/\bshipping\b|\bdones\b|kanban-ship/);
    }
  });

  it("asks no start-or-backlog and no ship-or-archive question", () => {
    for (const { file, text } of kanbanTexts) {
      expect(text, file).not.toMatch(/start (implementation )?now/i);
      expect(text, file).not.toMatch(/ship (now )?or archive/i);
    }
  });

  it("opens the PR in review only after the independent reviewer, then watches CI before the report", () => {
    const review = readFileSync(join(ROOT, "skills", "kanban-review", "SKILL.md"), "utf8");
    const order = ["## 5. Dispatch the independent reviewer", "## 8. Push and open the PR", "## 9. Watch CI", "## 10. Write review-report"].map((h) => review.indexOf(h));
    expect(order.every((i) => i >= 0), String(order)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(review).toContain("kf issues link {feature_name} <PR URL> --pr");
    expect(existsSync(join(ROOT, "skills", "kanban-review", "references", "ci-watch.md"))).toBe(true);
  });
});

describe("the review skill keeps the close possible", () => {
  const review = readFileSync(join(ROOT, "skills", "kanban-review", "SKILL.md"), "utf8");

  it("logs the landing gate inside the ignored item folder, never in a tracked tree", () => {
    expect(review).toContain("Append one line per board to `<item>/reviews/review-gate.tsv`");
    expect(review).toContain("every `.works/*/*/reviews/review-gate.tsv`");
    expect(review).not.toContain("`.kf/review-gate.tsv`");
  });

  it("allows landing: none only with no commit ahead of the default branch, the reconcile commit included", () => {
    expect(review).toContain("`git rev-list --count origin/<default>..HEAD` in the item worktree is `0`");
    expect(review).toContain("the step 2b reconcile commit included — is something to land");
  });
});

describe("the CI watcher", () => {
  const watchDoc = readFileSync(join(ROOT, "skills", "kanban-review", "references", "ci-watch.md"), "utf8");
  const start = watchDoc.indexOf("REPO=<owner/repo>; SHA=<full sha>; WATCH=<seconds>;");
  const loop = watchDoc.slice(start, watchDoc.indexOf("\n```", start)).replace("REPO=<owner/repo>; SHA=<full sha>; WATCH=<seconds>;", "REPO=o/r; SHA=abc123; WATCH=30;")
    .replaceAll("sleep 20", "sleep 1")
    .replace("settle=$((SECONDS+60))", "settle=$((SECONDS+2))");

  /** Runs the documented loop against a stub `gh` that lists one run per conclusion. */
  async function watch(conclusions: string[]): Promise<number | null> {
    const dir = await mkdtemp(join(tmpdir(), "kf-ci-watch-"));
    try {
      await writeFile(join(dir, "runs.tsv"), conclusions.map((c, i) => `${i + 1}\tcompleted\t${c}\t100\tCI\thttps://example.test/${i + 1}\n`).join(""));
      await writeFile(join(dir, "gh"), `#!/bin/sh\ncat '${join(dir, "runs.tsv")}'\n`, { mode: 0o755 });
      const res = spawnSync("bash", ["-c", loop], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000 });
      return res.status;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("is extracted from the reference", () => {
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it("calls a failed run red", async () => {
    expect(await watch(["success", "failure"])).toBe(1);
    expect(await watch(["cancelled", "timed_out"])).toBe(1);
  });

  it("gives no CI result, not red, when the only non-success runs were cancelled", async () => {
    expect(await watch(["success", "cancelled"])).toBe(5);
    expect(watchDoc).toContain("| 2, 3, 4, 5 | — | no CI result: **write no report**, stop without `PASS` (below) |");
  });
});

describe("the workflow docs quote the CLI as it prints", () => {
  it("copies the legacy stage hints from kf stage", async () => {
    const reference = readFileSync(join(ROOT, "docs", "workflow", "cli-reference.md"), "utf8");
    for (const stage of ["shipping", "dones"]) {
      const res = await cmdStage({ command: "stage", positionals: ["<feature>", stage], options: {} }, ROOT);
      expect(reference, stage).toContain(`\`${res.stdout}\``);
    }
  });

  it("shows a harness.verify argv example and no runner config", () => {
    const harness = readFileSync(join(ROOT, "docs", "workflow", "harness.md"), "utf8");
    expect(harness).toMatch(/"verify"\s*:\s*\{/);
    expect(harness).toMatch(/"(task|stage)"\s*:\s*\[\s*\[/);
    expect(harness).not.toContain('"--output-format"');
    expect(harness).not.toContain('"runners"');
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
    expect(pkg.version).toBe("0.13.0");
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

describe("the docs describe only the in-session path", () => {
  const REMOVED_COMMAND = /\bkf (drive|run|runs|harness)\b/;
  const REMOVAL_NOTE = /\b(removed|retired|no longer|gone)\b/i;

  function docSurface(): string[] {
    return [
      join(ROOT, "README.md"),
      join(ROOT, "kanban-flow", "README.md"),
      join(ROOT, ".github", "pages", "index.html"),
      ...walk(join(ROOT, ".kf", "hooks"), () => true),
      ...walk(join(ROOT, "docs", "workflow"), (p) => p.endsWith(".md")),
    ];
  }

  it("names kf drive, kf run, kf runs and kf harness only on lines that say they were removed", () => {
    const files = docSurface();
    expect(files.length).toBeGreaterThan(10);
    const offending: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (REMOVED_COMMAND.test(line) && !REMOVAL_NOTE.test(line)) {
          offending.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
    expect(offending).toEqual([]);
  });

  it("documents kf verify and the kf doctor --fix migration in the harness guide", () => {
    const harness = readFileSync(join(ROOT, "docs", "workflow", "harness.md"), "utf8");
    expect(harness).toContain("kf verify");
    expect(harness).toContain("harness.verify");
    expect(harness).toContain("kf doctor --fix");
  });

  it("keeps only harness.verify in this repository's config", () => {
    const config = JSON.parse(readFileSync(join(ROOT, ".kf", "config.json"), "utf8")) as { harness?: Record<string, unknown> };
    expect(Object.keys(config.harness ?? {})).toEqual(["verify"]);
  });

  it("records the removal as a breaking change in the changelog", () => {
    const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const unreleased = changelog.split(/^## \[/m)[1] ?? "";
    const entry = unreleased.split("\n").find((line) => /breaking/i.test(line) && line.includes("kf doctor --fix"));
    expect(entry).toBeDefined();
    for (const needle of ["kf drive", "kf run", "kf runs", "kf harness", "harness.verify", "src/"]) {
      expect(entry).toContain(needle);
    }
  });
});
