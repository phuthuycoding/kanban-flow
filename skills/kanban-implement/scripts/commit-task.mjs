#!/usr/bin/env node
// Path-limited, lock-safe task commit: node commit-task.mjs -m <message> --allow <entry>... -- <path>...
import { spawnSync } from "node:child_process";

const USAGE = "usage: commit-task.mjs -m <message> --allow <entry> [--allow <entry>...] -- <path>...";
const RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function usageError() {
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  let message;
  const allows = [];
  const paths = [];
  const sep = argv.indexOf("--");
  const options = sep === -1 ? argv : argv.slice(0, sep);
  if (sep !== -1) paths.push(...argv.slice(sep + 1));
  for (let i = 0; i < options.length; i++) {
    const arg = options[i];
    if (arg === "-m" || arg === "--allow") {
      const value = options[++i];
      if (value === undefined) usageError();
      if (arg === "-m") message = value;
      else allows.push(value);
    } else {
      usageError();
    }
  }
  if (message === undefined || message === "" || allows.length === 0 || paths.length === 0) usageError();
  return { message, allows, paths };
}

// Mirrors src/workflow/allowlist.ts pathAllowed; the parity test in src/tests/commit-task.test.ts guards drift.
const GLOB_CHARS = /[*?]/;

function normalise(pattern) {
  let p = pattern.replace(/`/g, "").trim();
  while (p.startsWith("./")) p = p.slice(2);
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function pathAllowed(path, patterns) {
  const segments = path.split("/");
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join("/"));
  return patterns.some((raw) => {
    const p = normalise(raw);
    if (p === "" || p === "." || p === "**") return true;
    if (!GLOB_CHARS.test(p)) return path === p || path.startsWith(`${p}/`);
    const re = globToRegExp(p);
    return prefixes.some((x) => re.test(x));
  });
}

function unsafeReason(path, allows) {
  if (allows.some((a) => normalise(a) === "")) return "cannot be checked: an --allow value is empty";
  if (path.includes("\\")) return "contains a backslash";
  if (path.startsWith("/")) return "is an absolute path";
  if (path.startsWith(":")) return "starts with a colon pathspec magic";
  if (path.split("/").includes("..")) return "contains a .. segment";
  return null;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runGit(args) {
  const gitArgs = ["--literal-pathspecs", ...args];
  const command = `git ${gitArgs.join(" ")}`;
  let result;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    process.stderr.write(`attempt ${attempt}: ${command}\n`);
    result = spawnSync("git", gitArgs, { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status === 0) return result;
    if (!result.stderr.includes("index.lock")) break;
    if (attempt <= RETRIES) sleep(RETRY_DELAY_MS);
  }
  if (result.stderr.includes("index.lock")) {
    process.stderr.write(`BLOCKED: index.lock held\n${result.stderr}`);
    process.exit(5);
  }
  process.stderr.write(result.stdout + result.stderr);
  process.exit(result.status ?? 1);
}

const { message, allows, paths } = parseArgs(process.argv.slice(2));

for (const path of paths) {
  const reason = unsafeReason(path, allows);
  if (reason) {
    process.stderr.write(`BLOCKED: ${path} ${reason}\n`);
    process.exit(4);
  }
  if (!pathAllowed(path, allows)) {
    process.stderr.write(`BLOCKED: ${path} is outside the allowlist\n`);
    process.exit(4);
  }
}

const top = spawnSync("git", ["rev-parse", "--show-prefix"], { encoding: "utf8" });
if (top.error) throw top.error;
if (top.status !== 0) {
  process.stderr.write(top.stderr);
  process.exit(top.status ?? 1);
}
const prefix = top.stdout.trim();
if (prefix !== "") {
  process.stderr.write(`BLOCKED: run from the repository root (cwd is ${prefix})\n`);
  process.exit(4);
}

runGit(["add", "--", ...paths]);
runGit(["commit", "-m", message, "--", ...paths]);
// HEAD may already have moved on (a hook, another seat), so read the commit this call made by its paths.
const [sha, subject] = runGit(["log", "-1", "--format=%H%n%s", "--", ...paths]).stdout.trim().split("\n");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
const expected = collapse(message.trim().split(/\n\s*\n/)[0]);
if (collapse(subject) !== expected) {
  process.stderr.write(`BLOCKED: commit ${sha} made but its sha could not be confirmed against the message; check git log\n`);
  process.exit(4);
}
process.stdout.write(`${sha}\n`);
