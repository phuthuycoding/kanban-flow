import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import type { RunnerConfig } from "./config.js";

export interface Provisioned {
  mode: "start" | "resume";
  session?: string;
  argv: string[];
}

const DEFAULT_RESUME_FAILURE = /session|not found|no such|unknown|does not exist/i;

function fill(template: string[], prompt: string, session: string | undefined): string[] {
  return template.map((arg) => arg.replaceAll("{prompt}", prompt).replaceAll("{session}", session ?? ""));
}

/** Pick start vs resume and build argv. Sessions are never guessed: only a stored id is resumed. */
export function provisionSession(runner: RunnerConfig, stored: string | undefined, prompt: string, fresh: boolean): Provisioned {
  if (!fresh && stored && runner.resume) {
    return { mode: "resume", session: stored, argv: fill(runner.resume, prompt, stored) };
  }
  const session = runner.session === "provided" ? randomUUID() : undefined;
  return { mode: "start", session, argv: fill(runner.start, prompt, session) };
}

export interface CaptureInput {
  stdout: string;
  marker: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Learn the session id produced by a `start` run; null when the runner gives no way to know it. */
export function captureSession(runner: RunnerConfig, provided: string | undefined, input: CaptureInput): string | null {
  const capture = runner.session;
  if (capture === undefined) return null;
  if (capture === "provided") return provided ?? null;
  if ("stdout" in capture) {
    const match = new RegExp(capture.stdout).exec(input.stdout);
    return match?.[1] ?? null;
  }
  const [cmd, ...args] = capture.command;
  const res = spawnSync(cmd, args, { cwd: input.cwd, env: input.env, encoding: "utf8", timeout: 30_000 });
  if (res.error) throw new Error(`Session lookup command failed (${capture.command.join(" ")}): ${res.error.message}`, { cause: res.error });
  if (res.status !== 0) throw new Error(`Session lookup command exited ${res.status} (${capture.command.join(" ")}): ${(res.stderr ?? "").trim()}`);
  let list: unknown;
  try {
    list = JSON.parse(res.stdout);
  } catch (err) {
    if (err instanceof SyntaxError) throw new Error(`Session lookup command did not return JSON (${capture.command.join(" ")})`, { cause: err });
    throw err;
  }
  if (!Array.isArray(list)) return null;
  const hit = list.find((item) => item && typeof item === "object"
    && String((item as Record<string, unknown>)[capture.matchField] ?? "").includes(input.marker));
  const id = hit ? (hit as Record<string, unknown>)[capture.idField] : undefined;
  return typeof id === "string" ? id : null;
}

export function isResumeFailure(runner: RunnerConfig, exitCode: number | null, output: string): boolean {
  if (exitCode === 0) return false;
  const re = runner.resumeFailure ? new RegExp(runner.resumeFailure, "i") : DEFAULT_RESUME_FAILURE;
  return re.test(output);
}

export interface Usage {
  input: number;
  output: number;
  costUsd?: number;
}

/** Usage from JSON on stdout: the last object (whole output or one JSONL line) carrying usage.input_tokens/output_tokens. */
export function parseUsage(stdout: string): Usage | null {
  const candidates = [stdout.trim(), ...stdout.split("\n").map((l) => l.trim()).reverse()];
  for (const text of candidates) {
    if (!text.startsWith("{")) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      if (err instanceof SyntaxError) continue;
      throw err;
    }
    if (!obj || typeof obj !== "object") continue;
    const usage = (obj as { usage?: Record<string, unknown> }).usage;
    if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") continue;
    const cost = (obj as { total_cost_usd?: unknown }).total_cost_usd;
    return { input: usage.input_tokens, output: usage.output_tokens, ...(typeof cost === "number" ? { costUsd: cost } : {}) };
  }
  return null;
}
