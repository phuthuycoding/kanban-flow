import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../../skills/review/scripts/verify-findings.mjs");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-verify-findings-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export function load() {\n  return readConfig(path);\n}\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function verify(findings: unknown) {
  const r = spawnSync("node", [script, root], { input: JSON.stringify(findings), encoding: "utf8" });
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

const finding = (title: string, severity: string, evidence: string) => ({
  title,
  severity,
  file: "src/a.ts",
  line: 2,
  evidence,
});

describe("verify-findings", () => {
  it("dedups kept findings by title and file, keeping the highest severity", () => {
    const { status, out } = verify([finding("dup", "LOW", "return readConfig(path);"), finding("dup", "HIGH", "return readConfig(path);")]);
    expect(status).toBe(0);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].severity).toBe("HIGH");
    expect(out.counts).toMatchObject({ kept: 1, refuted: 0, duplicates: 1 });
  });

  it("verifies before it dedups, so a refuted HIGH never hides a valid LOW of the same title", () => {
    const { out } = verify([finding("dup", "HIGH", "this line is not in the file"), finding("dup", "LOW", "return readConfig(path);")]);
    expect(out.kept.map((f: { severity: string }) => f.severity)).toEqual(["LOW"]);
    expect(out.refuted).toHaveLength(1);
  });

  it("refutes a finding that cites a file outside the root, such as a user rule file", () => {
    const { out } = verify([{ ...finding("rule", "MEDIUM", "never swallow errors"), file: "/etc/hosts" }]);
    expect(out.refuted[0].reason).toContain("outside root");
  });

  it("exits 2 on input that is not one JSON array, such as two arrays concatenated", () => {
    const r = spawnSync("node", [script, root], { input: "[][]", encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});
