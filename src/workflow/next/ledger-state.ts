import { LEDGER_SHAPES, LOOSE_KEYWORD, TS_SUFFIX, classify } from "../loop-stats.js";
import type { LedgerLine } from "../loop-stats.js";
import type { CapCause, LedgerEvent, LedgerRead, LedgerState, RepairLine, Seat } from "./types.js";

const SHA_LIST = "[0-9a-f]{7,40}(?:,[0-9a-f]{7,40})*";
const SIGNATURES = ["EADDRINUSE", "index.lock", "database is locked", "SQLITE_BUSY", "Lock wait timeout exceeded", "ETIMEDOUT", "ECONNREFUSED", "Test timed out", "Hook timed out"];
const SIGNATURE_ALT = SIGNATURES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

const IMPLEMENTED = /^(TASK-\d+): implemented, test-writer seat: none, review seat: none$/;
const NO_TEST_WRITER = /^(TASK-\d+): no test-writer — (.+)$/;
const TEST_HASHES = /^(TASK-\d+): test hashes (\S+=[0-9a-f]{40}(?: \S+=[0-9a-f]{40})*)$/;
const REVIEW_PACKAGE = new RegExp(`^(TASK-\\d+): review package (${SHA_LIST})$`);
const PARKED = /^(TASK-\d+): parked — (.+) — Ruling: (.+)$/;
const COMMITS = new RegExp(`^Note (TASK-\\d+): commits (${SHA_LIST})$`);
const DECIDED = /^Note (TASK-\d+): decided — (.+)$/;
const VERIFY_ROUTED = /^Note (TASK-\d+): verify routed — (TASK-\d+)$/;
const VERIFY_WAITS = /^Note (TASK-\d+): verify waits — (.+) \((TASK-\d+)\)$/;
const VERIFY_RERUN = /^Note (TASK-\d+): verify rerun — contention (.+)$/;
const REOPENED = /^Note (TASK-\d+): reopened — (testing|review|ci) (\S{8})$/;
const CAP_REACHED = /^Note (TASK-\d+): cap reached — (.+)$/;
const INLINE = /^Note (TASK-\d+): developer seat inline$/;
const CAP_START = /^Ruling: developer cap (\d+) — start — .+$/;
const CAP_CHANGE = /^Ruling: developer cap (\d+) → (\d+) — (.+?) — cost if wrong: .+$/;
const NO_STEP_UP = /^Note wave (\d+): no step-up — (not clean|inline|ceiling|last wave|widest incomplete wave)$/;
const CAUSE_WAVE = /^wave (\d+) clean$/;
const CAUSE_CONTENTION = new RegExp(`^(${SIGNATURE_ALT}) in (TASK-\\d+) verify$`);
const CAUSE_CEILING = /^ceiling lowered to (\d+)$/;

/** A body that starts a claim the scheduler reads (behind an optional bullet): when it fails its grammar the ledger needs repair. */
const CLAIM =
  /^\s*(?:[-*+]\s+)?(?:Ruling: developer cap|Note wave [^:]*: no step-up|Note TASK-\d+: (?:verify rerun|verify waits|verify routed|commits|decided|reopened|cap reached|developer seat inline)|TASK-\d+: (?:implemented|review package|no test-writer|test hashes|parked))/;

const TASK_OF = /^(?:Note )?(TASK-\d+):/;

const signatureOf = (text: string): string | undefined => SIGNATURES.find((s) => text.startsWith(s));

function capCause(text: string): CapCause | undefined {
  const wave = CAUSE_WAVE.exec(text);
  if (wave) return { kind: "wave", wave: Number(wave[1]) };
  const contention = CAUSE_CONTENTION.exec(text);
  if (contention) return { kind: "contention", signature: contention[1], task: contention[2] };
  const ceiling = CAUSE_CEILING.exec(text);
  if (ceiling) return { kind: "ceiling", max: Number(ceiling[1]) };
  return undefined;
}

type Fields = LedgerEvent extends infer E ? (E extends unknown ? Omit<E, "line" | "ts"> : never) : never;

function shapeEvent(c: LedgerLine, body: string): Fields {
  const task = c.task!;
  switch (c.shape!) {
    case "dispatched":
      return {
        type: "dispatched", task, seat: c.seat!, model: c.model!,
        ...(c.round !== undefined ? { round: c.round } : {}),
        ...(c.cascade !== undefined ? { cascade: c.cascade } : {}),
      };
    case "done":
      return { type: "done", task, seat: c.seat!, status: c.status! };
    case "verifyStarted":
      return { type: "verifyStarted", task };
    case "verifyDone":
      return { type: "verifyDone", task, exit: c.exit! };
    case "developerWaits":
      return { type: "developerWaits", task, reason: c.reason! };
    case "fixQueued":
      return { type: "fixQueued", task, otherTask: c.otherTask! };
    case "fixRound":
      return { type: "fixRound", task, round: c.round! };
    case "cascadeOwed":
      return { type: "cascadeOwed", task, sha: c.sha!, otherTask: c.otherTask! };
    case "complete":
      return { type: "complete", task, text: body.slice(body.indexOf("(") + 1, -1) };
  }
}

/** The event a scheduler line stands for, `null` when the body is none of them. */
function schedulerEvent(body: string): Fields | null {
  let m: RegExpExecArray | null;
  if ((m = IMPLEMENTED.exec(body))) return { type: "implemented", task: m[1] };
  if ((m = NO_TEST_WRITER.exec(body))) return { type: "noTestWriter", task: m[1], reason: m[2] };
  if ((m = TEST_HASHES.exec(body))) {
    const files: Record<string, string> = {};
    for (const token of m[2].split(" ")) {
      const eq = token.lastIndexOf("=");
      files[token.slice(0, eq)] = token.slice(eq + 1);
    }
    return { type: "testHashes", task: m[1], files };
  }
  if ((m = REVIEW_PACKAGE.exec(body))) return { type: "reviewPackage", task: m[1], shas: m[2].split(",") };
  if ((m = PARKED.exec(body))) return { type: "parked", task: m[1], finding: m[2] };
  if ((m = COMMITS.exec(body))) return { type: "commits", task: m[1], shas: m[2].split(",") };
  if ((m = DECIDED.exec(body))) return { type: "decided", task: m[1], what: m[2] };
  if ((m = VERIFY_ROUTED.exec(body))) return { type: "verifyRouted", task: m[1], otherTask: m[2] };
  if ((m = VERIFY_WAITS.exec(body))) return { type: "verifyWaits", task: m[1], file: m[2], otherTask: m[3] };
  if ((m = VERIFY_RERUN.exec(body))) {
    const signature = signatureOf(m[2]);
    return signature ? { type: "verifyRerun", task: m[1], signature } : null;
  }
  if ((m = REOPENED.exec(body))) return { type: "reopened", task: m[1], source: m[2], execution: m[3] };
  if ((m = CAP_REACHED.exec(body))) return { type: "capReached", task: m[1], failure: m[2] };
  if ((m = INLINE.exec(body))) return { type: "inline", task: m[1] };
  if ((m = CAP_START.exec(body))) return { type: "capRuling", from: null, to: Number(m[1]), cause: { kind: "start" } };
  if ((m = CAP_CHANGE.exec(body))) {
    const cause = capCause(m[3]);
    return cause ? { type: "capRuling", from: Number(m[1]), to: Number(m[2]), cause } : null;
  }
  if ((m = NO_STEP_UP.exec(body))) return { type: "noStepUp", wave: Number(m[1]), reason: m[2] };
  if (body.startsWith("Scan: ")) return { type: "scan", clean: body === "Scan: clean" };
  return null;
}

/**
 * Read the ledger the scheduler decides on. Any line it cannot read refuses the whole ledger (FR-016):
 * a wrong schedule costs more than a stop, so an old ledger with such a line is repaired, not accepted.
 */
export function readLedgerState(text: string): LedgerRead {
  const events: LedgerEvent[] = [];
  const repair: RepairLine[] = [];
  text.split("\n").forEach((raw, i) => {
    const content = raw.trimEnd();
    if (i === 0 || content.trim() === "") return;
    const line = i + 1;
    const refuse = (reason: string): void => void repair.push({ line, text: content, reason });
    const c = classify(content, line);
    if (c.kind === "unparsed") return refuse("a line that claims a ledger shape but fails its grammar");

    const suffix = TS_SUFFIX.exec(content);
    if (!suffix) {
      const claimsShape = Object.values(LEDGER_SHAPES).some((re) => re.test(content));
      if (claimsShape || LOOSE_KEYWORD.test(content)) {
        return refuse("a ledger shape line without its ` @ <timestamp>` suffix");
      }
      if (CLAIM.test(content)) return refuse("a scheduler line without its ` @ <timestamp>` suffix");
      return;
    }

    const body = content.slice(0, suffix.index);
    const ts = c.ts!;
    if (c.kind === "shape") {
      events.push({ ...shapeEvent(c, body), line, ts } as LedgerEvent);
      return;
    }
    const fields = schedulerEvent(body);
    if (fields) {
      events.push({ ...fields, line, ts } as LedgerEvent);
      return;
    }
    if (CLAIM.test(body)) return refuse("a scheduler line that fails its grammar");
    const task = TASK_OF.exec(body)?.[1];
    events.push({ type: "other", ...(task ? { task } : {}), text: body, line, ts });
  });
  return repair.length > 0 ? { ok: false, repair } : { ok: true, state: { events } };
}

/** Dispatches no `done` and no later dispatch of the same task and seat answers; a re-dispatched orphan stays closed. */
export function openSeats(state: LedgerState): { task: string; seat: Seat; line: number }[] {
  const open = new Map<string, { task: string; seat: Seat; line: number }>();
  for (const e of state.events) {
    if (e.type === "dispatched") open.set(`${e.task} ${e.seat}`, { task: e.task, seat: e.seat, line: e.line });
    else if (e.type === "done") open.delete(`${e.task} ${e.seat}`);
  }
  return [...open.values()].sort((a, b) => a.line - b.line);
}

/** A `verify started` no `verify done` and no later `verify started` of the task answers. */
export function openVerifies(state: LedgerState): { task: string; line: number }[] {
  const open = new Map<string, { task: string; line: number }>();
  for (const e of state.events) {
    if (e.type === "verifyStarted") open.set(e.task, { task: e.task, line: e.line });
    else if (e.type === "verifyDone") open.delete(e.task);
  }
  return [...open.values()].sort((a, b) => a.line - b.line);
}

/** Tasks whose latest `complete` or `implemented` event no later `reopened` event of the same task cancels. */
export function completedTaskIds(state: LedgerState): Set<string> {
  const done = new Set<string>();
  for (const e of state.events) {
    if (e.type === "complete" || e.type === "implemented") done.add(e.task);
    else if (e.type === "reopened") done.delete(e.task);
  }
  return done;
}

/** FR-005: the task's commits from the first non-empty source (notes, review packages, report), deduplicated and in history order. */
export function taskCommits(state: LedgerState, task: string, reportCommits: string[] | undefined, gitLog: { sha: string; ts: number }[]): string[] {
  const own = state.events.filter((e) => "task" in e && e.task === task);
  const notes = own.flatMap((e) => (e.type === "commits" ? e.shas : []));
  const packages = own.flatMap((e) => (e.type === "reviewPackage" ? e.shas : []));
  const source = notes.length > 0 ? notes : packages.length > 0 ? packages : (reportCommits ?? []);
  const shas: string[] = [];
  for (const sha of source) if (!shas.some((kept) => kept.startsWith(sha) || sha.startsWith(kept))) shas.push(sha);
  const rank = (sha: string): number => {
    const i = gitLog.findIndex((g) => g.sha.startsWith(sha) || sha.startsWith(g.sha));
    return i === -1 ? Infinity : i;
  };
  return shas.map((sha, i) => ({ sha, i, r: rank(sha) })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r < b.r ? -1 : 1)).map((x) => x.sha);
}
