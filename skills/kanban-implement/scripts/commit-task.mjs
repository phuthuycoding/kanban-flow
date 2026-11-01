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

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runGit(args) {
  const command = `git ${args.join(" ")}`;
  let result;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    process.stderr.write(`attempt ${attempt}: ${command}\n`);
    result = spawnSync("git", args, { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status === 0) return result;
    if (!result.stderr.includes("index.lock")) break;
    if (attempt <= RETRIES) sleep(RETRY_DELAY_MS);
  }
  if (result.stderr.includes("index.lock")) {
    process.stderr.write(`BLOCKED: index.lock held\n${result.stderr}`);
    process.exit(5);
  }
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const { message, allows, paths } = parseArgs(process.argv.slice(2));
const { pathAllowed } = await import(new URL("../../../dist/workflow/allowlist.js", import.meta.url).href);

for (const path of paths) {
  if (!pathAllowed(path, allows)) {
    process.stdout.write(`BLOCKED: ${path} is outside the allowlist\n`);
    process.exit(4);
  }
}

runGit(["add", "--", ...paths]);
runGit(["commit", "-m", message, "--", ...paths]);
const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (head.error) throw head.error;
if (head.status !== 0) {
  process.stderr.write(head.stderr);
  process.exit(head.status ?? 1);
}
process.stdout.write(head.stdout);
