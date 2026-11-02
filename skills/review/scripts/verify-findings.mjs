#!/usr/bin/env node
// Refute findings whose `evidence` quote is not where the reviewer said it is.
//
// Usage: node verify-findings.mjs ROOT [FINDINGS_JSON]   (reads stdin when no file is given)
//   ROOT           the checkout the findings cite paths against (the item worktree)
//   FINDINGS_JSON  a JSON array in the shape of references/finding-schema.md
//
// Prints {"kept":[...],"refuted":[{...,"reason":"..."}],"counts":{"kept":N,"refuted":M}} to stdout.
//
// What refutes a finding (each reason is printed):
//   - a `file` with no `evidence`             — the schema requires the quote; a made-up location
//                                               must not pass the only mechanical gate by omitting it
//   - an `evidence` shorter than 6 characters  — "}" or "{" would match anywhere
//   - a `file` that resolves outside ROOT, or that is not a regular file
//   - the quote absent from the file, or present only far from the cited `line` (±WINDOW lines);
//     a generic quote such as "} catch {" must sit where the finding says it does
// A finding with no `file` cannot be checked and is kept as-is.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const WINDOW = 20;
const MIN_EVIDENCE = 6;

const [rootArg, source] = process.argv.slice(2);
if (!rootArg) {
  process.stderr.write("usage: node verify-findings.mjs ROOT [FINDINGS_JSON]\n");
  process.exit(2);
}
const root = resolve(rootArg);
const raw = source ? readFileSync(source, "utf8") : readFileSync(0, "utf8");
let findings;
try {
  findings = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`findings are not valid JSON: ${err.message}\n`);
  process.exit(2);
}
if (!Array.isArray(findings)) {
  process.stderr.write("findings must be a JSON array\n");
  process.exit(2);
}

/** The first integer in a `line` value such as "42", "42-48" or "42,67". */
function citedLine(value) {
  const m = /\d+/.exec(String(value ?? ""));
  return m ? Number(m[0]) : null;
}

const kept = [];
const refuted = [];
for (const f of findings) {
  if (!f || typeof f !== "object") {
    refuted.push({ finding: f, reason: "not an object" });
    continue;
  }
  const file = typeof f.file === "string" ? f.file.trim() : "";
  const evidence = typeof f.evidence === "string" ? f.evidence.trim() : "";
  if (!file) {
    kept.push(f);
    continue;
  }
  if (!evidence) {
    refuted.push({ ...f, reason: "evidence missing (required with file)" });
    continue;
  }
  if (evidence.length < MIN_EVIDENCE) {
    refuted.push({ ...f, reason: `evidence too short (${evidence.length} chars, minimum ${MIN_EVIDENCE})` });
    continue;
  }
  const path = resolve(root, file);
  if (path !== root && !path.startsWith(root + sep)) {
    refuted.push({ ...f, reason: `path outside root: ${file}` });
    continue;
  }
  if (!existsSync(path)) {
    refuted.push({ ...f, reason: `file not found: ${file}` });
    continue;
  }
  if (!statSync(path).isFile()) {
    refuted.push({ ...f, reason: `not a regular file: ${file}` });
    continue;
  }
  const lines = readFileSync(path, "utf8").split("\n");
  const matches = [];
  lines.forEach((line, i) => {
    if (line.trim().includes(evidence)) matches.push(i + 1);
  });
  if (matches.length === 0) {
    refuted.push({ ...f, reason: "evidence quote not found in file" });
    continue;
  }
  const cited = citedLine(f.line);
  if (cited === null) {
    kept.push({ ...f, verifiedLine: String(matches[0]) });
    continue;
  }
  const near = matches.find((n) => Math.abs(n - cited) <= WINDOW);
  if (near === undefined) {
    refuted.push({ ...f, reason: `evidence found at line ${matches.join(",")}, not within ${WINDOW} lines of cited line ${cited}` });
    continue;
  }
  kept.push({ ...f, verifiedLine: String(near) });
}

process.stdout.write(`${JSON.stringify({ kept, refuted, counts: { kept: kept.length, refuted: refuted.length } }, null, 2)}\n`);
process.stderr.write(`verify-findings: kept ${kept.length}, refuted ${refuted.length}\n`);
