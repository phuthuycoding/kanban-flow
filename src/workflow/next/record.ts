import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Feature } from "../features.js";
import { LEDGER_SHAPES } from "../loop-stats.js";
import { LockTimeoutError, withLock } from "../../shared/lock.js";
import { ARTIFACTS } from "../schema.js";
import { completedTaskIds, openSeats, openVerifies, openWaveVerifies, readLedgerState } from "./ledger-state.js";

export type RecordEvent = { event: string; args: string[]; model?: string; round?: string; cascade?: string; status?: string; exit?: string };

type Built = { ok: true; line: string } | { ok: false; code: 1 | 3; reason: string };

const EVENTS = ["dispatched", "done", "verify-started", "verify-done", "commits", "waits", "fix-round", "cascade-owed", "complete", "wave-verify-started", "wave-verify-done", "line"];
const SEATS = ["test-writer", "developer", "automation-writer", "code-reviewer"];
const TASK_ID = /^TASK-\d+$/;
const SHA = /^[0-9a-f]{7,40}$/;
const STAMP_IN_TEXT = / @ \d{4}-\d{2}-\d{2}/;
const FREE_LINE = new RegExp(
  "^(?:Ruling: |Note |Scan: |wave \\d+: |TASK-\\d+: (?:test hashes |test dispute |no test-writer — |parked — |minor \\(deferred\\): |unverified — |brief written|review package |implemented, test-writer seat: none, review seat: none))",
);
/** A fixed valid stamp: `readLedgerState` needs a suffix to read the line; the real stamp is taken at the write. */
const PROBE_STAMP = "2026-01-01T00:00:00+00:00";

const bad = (reason: string): Built => ({ ok: false, code: 3, reason });
const refuse = (reason: string): Built => ({ ok: false, code: 1, reason });

/** Quote one shell word: wrap in single quotes, each ' written as '\'' — safe for bash/zsh, round-trips any text. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function stamp(now: Date): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function task(id: string | undefined, event: string): string | Built {
  if (id === undefined) return bad(`${event}: missing <TASK>.`);
  return TASK_ID.test(id) ? id : bad(`${event}: '${id}' is not a task id (TASK-NNN).`);
}

function seat(name: string | undefined, event: string): string | Built {
  if (name === undefined) return bad(`${event}: missing <seat> (${SEATS.join("|")}).`);
  return SEATS.includes(name) ? name : bad(`${event}: '${name}' is not a seat (${SEATS.join("|")}).`);
}

function sha(value: string | undefined, what: string): string | Built {
  if (value === undefined) return bad(`Missing ${what}.`);
  return SHA.test(value) ? value : bad(`${what} '${value}' is not 7–40 lowercase hex characters.`);
}

function integer(value: string, what: string, min: number, max = Infinity): string | Built {
  if (!/^\d+$/.test(value)) return bad(`${what} '${value}' is not a non-negative integer.`);
  const n = Number(value);
  return n >= min && n <= max ? String(n) : bad(`${what} ${value} is out of range (${min}–${max === Infinity ? "∞" : max}).`);
}

function waveNumber(value: string | undefined, event: string): string | Built {
  if (value === undefined) return bad(`${event}: missing <wave>.`);
  return integer(value, `${event}: wave`, 1);
}

function freeText(tokens: string[], event: string): string | Built {
  const joined = tokens.join(" ");
  if (joined.trim() === "") return bad(`${event}: the text is empty.`);
  if (/[\r\n]/.test(joined)) return bad(`${event}: the text holds a newline.`);
  if (STAMP_IN_TEXT.test(joined)) return bad(`${event}: the text holds a timestamp (' @ <date>').`);
  return joined;
}

const isBuilt = (v: object | string): v is Built => typeof v === "object" && "ok" in v;

function expectArgs(e: RecordEvent, n: number): Built | null {
  return e.args.length === n ? null : bad(`${e.event}: expected ${n} argument${n === 1 ? "" : "s"}, got ${e.args.length}.`);
}

/** The ledger body an event stands for (no stamp), or a bad-usage result. */
function body(e: RecordEvent): { body: string; task?: string; seat?: string; text?: string; wave?: number } | Built {
  const [a0, a1, a2] = e.args;
  switch (e.event) {
    case "dispatched": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const s = seat(a1, e.event); if (isBuilt(s)) return s;
      const extra = expectArgs(e, 2); if (extra) return extra;
      if (e.model === undefined || !/^\S+$/.test(e.model)) return bad("dispatched: missing --model <m>.");
      let tail = "";
      if (e.round !== undefined) {
        const r = integer(e.round, "--round", 1); if (isBuilt(r)) return r;
        tail += ` round=${r}`;
      }
      if (e.cascade !== undefined) {
        const c = sha(e.cascade, "--cascade"); if (isBuilt(c)) return c;
        tail += ` cascade=${c}`;
      }
      return { body: `${t}: ${s} dispatched model=${e.model}${tail}`, task: t, seat: s };
    }
    case "done": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const s = seat(a1, e.event); if (isBuilt(s)) return s;
      const extra = expectArgs(e, 2); if (extra) return extra;
      if (e.status === undefined || !/^\S+$/.test(e.status)) return bad("done: missing --status <S>.");
      return { body: `${t}: ${s} done status=${e.status}`, task: t, seat: s };
    }
    case "verify-started": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const extra = expectArgs(e, 1); if (extra) return extra;
      return { body: `${t}: verify started`, task: t };
    }
    case "verify-done": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const extra = expectArgs(e, 1); if (extra) return extra;
      if (e.exit === undefined) return bad("verify-done: missing --exit <n>.");
      const x = integer(e.exit, "--exit", 0); if (isBuilt(x)) return x;
      return { body: `${t}: verify done exit=${x}`, task: t };
    }
    case "wave-verify-started": {
      const w = waveNumber(a0, e.event); if (isBuilt(w)) return w;
      const extra = expectArgs(e, 1); if (extra) return extra;
      return { body: `wave ${w}: verify started`, wave: Number(w) };
    }
    case "wave-verify-done": {
      const w = waveNumber(a0, e.event); if (isBuilt(w)) return w;
      const extra = expectArgs(e, 1); if (extra) return extra;
      if (e.exit === undefined) return bad("wave-verify-done: missing --exit <n>.");
      const x = integer(e.exit, "--exit", 0); if (isBuilt(x)) return x;
      return { body: `wave ${w}: verify done exit=${x}`, wave: Number(w) };
    }
    case "commits": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      if (a1 === undefined) return bad("commits: missing <sha>[,<sha>…].");
      const extra = expectArgs(e, 2); if (extra) return extra;
      for (const part of a1.split(",")) {
        const s = sha(part, "commit sha"); if (isBuilt(s)) return s;
      }
      return { body: `Note ${t}: commits ${a1}`, task: t };
    }
    case "waits": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const text = freeText(e.args.slice(1), e.event); if (isBuilt(text)) return text;
      return { body: `${t}: developer waits — ${text}`, task: t, text };
    }
    case "fix-round": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      if (a1 === undefined) return bad("fix-round: missing <R>.");
      const r = integer(a1, "fix-round <R>", 1, 5); if (isBuilt(r)) return r;
      const text = freeText(e.args.slice(2), e.event); if (isBuilt(text)) return text;
      return { body: `${t}: fix round ${r}/5 (${text})`, task: t };
    }
    case "cascade-owed": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const s = sha(a1, "<sha>"); if (isBuilt(s)) return s;
      const h = task(a2, e.event); if (isBuilt(h)) return h;
      const extra = expectArgs(e, 3); if (extra) return extra;
      return { body: `${t}: cascade re-review owed — after ${s} of ${h}`, task: t };
    }
    case "complete": {
      const t = task(a0, e.event); if (isBuilt(t)) return t;
      const text = freeText(e.args.slice(1), e.event); if (isBuilt(text)) return text;
      return { body: `${t}: complete (${text})`, task: t };
    }
    default: {
      const text = freeText(e.args, e.event); if (isBuilt(text)) return text;
      return { body: text, text };
    }
  }
}

/** Validates the event against the current ledger text (`null` = no file) and returns the body to append. */
export function buildLine(ledgerText: string | null, e: RecordEvent): Built {
  if (!EVENTS.includes(e.event)) return refuse(`Unknown event '${e.event}'. Known events: ${EVENTS.join(", ")}.`);
  const built = body(e);
  if (isBuilt(built)) return built;

  const read = readLedgerState(ledgerText ?? "");
  if (!read.ok) {
    const lines = read.repair.map((r) => `line ${r.line}: ${r.text} — ${r.reason}`).join("\n");
    return refuse(`The ledger needs repair before anything is appended:\n${lines}`);
  }
  const state = read.state;

  if (e.event === "done" && !openSeats(state).some((s) => s.task === built.task && s.seat === built.seat)) {
    return refuse(`No open dispatch of ${built.seat} for ${built.task}: nothing to answer.`);
  }
  if (e.event === "verify-done" && !openVerifies(state).some((v) => v.task === built.task)) {
    return refuse(`No open 'verify started' of ${built.task}: nothing to answer.`);
  }
  if (e.event === "wave-verify-done" && !openWaveVerifies(state).has(built.wave!)) {
    return refuse(`No open 'wave ${built.wave}: verify started': nothing to answer.`);
  }
  if (e.event === "waits") {
    const own = state.events.filter((ev) => "task" in ev && ev.task === built.task);
    const last = own.filter((ev) => ev.type === "developerWaits").pop();
    if (last && last.type === "developerWaits" && last.reason === built.text) {
      const followed = own.some((ev) => ev.type === "dispatched" && ev.seat === "developer" && ev.line > last.line);
      if (!followed) return refuse(`${built.task} already waits for '${built.text}'; record a wait again only when the reason changes or a developer was dispatched.`);
    }
  }
  if (e.event === "complete" && completedTaskIds(state).has(built.task!)) {
    return refuse(`${built.task} is already complete and was not reopened.`);
  }
  if (e.event === "line") {
    if (Object.values(LEDGER_SHAPES).some((re) => re.test(built.body))) {
      return refuse("This line is one of the nine ledger shapes: use the dedicated event instead of 'line'.");
    }
    if (/^wave \d+: verify\b/.test(built.body)) {
      return refuse("This line is a wave verify line: use wave-verify-started or wave-verify-done instead of 'line'.");
    }
    if (!FREE_LINE.test(built.body)) {
      return refuse("This line is not one of the recordable kinds (Ruling:, Note, Scan:, wave <n>:, or TASK-NNN: test hashes | test dispute | no test-writer — | parked — | minor (deferred): | unverified — | brief written | review package | implemented, …).");
    }
  }

  const probe = readLedgerState(`# Task loop ledger\n${built.body} @ ${PROBE_STAMP}`);
  if (!probe.ok) return refuse(`The ledger reader would refuse this line: ${probe.repair.map((r) => r.reason).join("; ")}`);
  return { ok: true, line: built.body };
}

function readLedger(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
}

export async function recordEvent(root: string, feature: Feature, e: RecordEvent, now: () => Date = () => new Date()): Promise<{ code: 0 | 1 | 3; stdout: string }> {
  const dir = join(feature.dir, "loop");
  const path = join(dir, "progress.md");
  try {
    return await withLock(root, feature.name, async () => {
      const text = readLedger(path);
      const res = buildLine(text, e);
      if (!res.ok) return { code: res.code, stdout: res.reason };
      const full = `${res.line} @ ${stamp(now())}`;
      let prefix = "";
      if (text === null || text === "") {
        mkdirSync(dir, { recursive: true });
        const artifact = feature.meta?.kind === "bug" ? "spec-requirement" : "implementation-plan";
        prefix = `# Task loop ledger — ${feature.name} — plan: ${join(feature.dir, ARTIFACTS[artifact].file)}\n`;
      } else if (!text.endsWith("\n")) {
        prefix = "\n";
      }
      appendFileSync(path, `${prefix}${full}\n`);
      return { code: 0 as const, stdout: full };
    });
  } catch (err) {
    if (err instanceof LockTimeoutError) return { code: 1, stdout: err.message };
    throw err;
  }
}
