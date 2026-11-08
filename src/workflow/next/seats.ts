import { firstOverlap } from "../allowlist.js";
import { completedTaskIds, openSeats, taskCommits } from "./ledger-state.js";
import { shellQuote } from "./record.js";
import type { Action, Cap, LedgerEvent, LedgerState, LoopInputs, LoopTask } from "./types.js";

// FR-003, FR-004, FR-005, FR-018: which seats open now, as `kf:implement` lays out the conflict scan,
// test-writers ahead, the developer release and the seats after a task's commit. Pure: no filesystem, git or clock.
// Holds by a `decide` or a `stop`, and `complete`, are `schedule()`'s.

type Write = Extract<Action, { kind: "write" }>;
type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Wait = Extract<Action, { kind: "wait" }>;
type Dispatched = Extract<LedgerEvent, { type: "dispatched" }>;
type Done = Extract<LedgerEvent, { type: "done" }>;

const UNKNOWN = "Files unknown";

const line = (feature: string, text: string, task?: string): Write => ({
  kind: "write",
  ...(task ? { task } : {}),
  line: text,
  record: `kf record ${feature} line -- ${shellQuote(text)}`,
});

const ownEvents = (state: LedgerState, task: string): LedgerEvent[] => state.events.filter((e) => "task" in e && e.task === task);

/** The task's events after its latest `reopened` note: a reopened task starts its seats over. */
function sinceReopen(state: LedgerState, task: string): LedgerEvent[] {
  const own = ownEvents(state, task);
  const at = own.map((e) => e.type).lastIndexOf("reopened");
  return own.slice(at + 1);
}

/** The dispatch a `done` answers: the latest dispatch of the same seat before it. */
function answeredDispatch(own: LedgerEvent[], done: Done): Dispatched | undefined {
  return own.filter((e): e is Dispatched => e.type === "dispatched" && e.seat === done.seat && e.line < done.line).at(-1);
}

const doneOf = (own: LedgerEvent[], seat: string): Done[] => own.filter((e): e is Done => e.type === "done" && e.seat === seat);

/**
 * A developer `done` counts as DONE when it says so, or when the session went on from a concerns/blocked status
 * by a decision, a commits note, or a `Ruling:` line naming the task.
 */
function countsAsDone(state: LedgerState, own: LedgerEvent[], done: Done): boolean {
  if (done.status === "DONE") return true;
  if (done.status !== "DONE_WITH_CONCERNS" && done.status !== "BLOCKED") return false;
  if (own.some((e) => (e.type === "decided" || e.type === "commits") && e.line > done.line)) return true;
  const named = new RegExp(`\\b${done.task}(?!\\d)`);
  return state.events.some((e) => e.type === "other" && e.line > done.line && e.text.startsWith("Ruling:") && named.test(e.text));
}

const overlapping = (a: LoopTask, b: LoopTask): boolean =>
  a.id !== b.id && (a.files === null || b.files === null || a.overlaps.includes(b.id) || b.overlaps.includes(a.id));

/** The first overlapping entry pair of two tasks; a side with unknown Files reads `Files unknown`. */
function entryPair(a: LoopTask, b: LoopTask): [string, string] {
  if (a.files === null || b.files === null) return [a.files?.[0] ?? UNKNOWN, b.files?.[0] ?? UNKNOWN];
  const pair = firstOverlap(a.files, b.files);
  if (pair === null) throw new Error(`${a.id} and ${b.id} are marked overlapping but no Files entry pair overlaps`);
  return pair;
}

export function seatActions(state: LedgerState, inputs: LoopInputs, cap: Cap, reserved = 0): Action[] {
  if (!state.events.some((e) => e.type === "scan")) {
    return [
      {
        kind: "decide",
        rule: "Conflict scan",
        reason: "no `Scan:` line yet: scan the plan's Files for conflicts before any seat (one planned task: Scan: clean)",
        closes: "Scan: …",
      },
    ];
  }

  const f = inputs.feature;
  const complete = completedTaskIds(state);
  const byId = new Map(inputs.tasks.map((t) => [t.id, t]));
  const planIndex = new Map(inputs.tasks.map((t, i) => [t.id, i]));
  const ordered = [...inputs.tasks].sort((a, b) => a.wave - b.wave || planIndex.get(a.id)! - planIndex.get(b.id)!);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  const own = new Map(inputs.tasks.map((t) => [t.id, ownEvents(state, t.id)]));
  const ev = (id: string): LedgerEvent[] => own.get(id) ?? [];
  const dispatchedSeat = (id: string, seat: string): boolean => ev(id).some((e) => e.type === "dispatched" && e.seat === seat);

  const seats = openSeats(state);
  const dispatchAt = new Map(state.events.filter((e): e is Dispatched => e.type === "dispatched").map((e) => [e.line, e]));

  const isOpen = (id: string): boolean =>
    !complete.has(id) &&
    sinceReopen(state, id).some((e) => e.type === "dispatched" && (e.seat === "test-writer" || e.seat === "developer"));

  /** The overlap that holds opening `t`: an open task first, else an earlier incomplete one. */
  function overlapHold(t: LoopTask): { kind: "open" | "earlier"; other: LoopTask } | null {
    const others = inputs.tasks.filter((o) => overlapping(t, o));
    const open = others.find((o) => isOpen(o.id));
    if (open) return { kind: "open", other: open };
    const earlier = others.find((o) => rank.get(o.id)! < rank.get(t.id)! && !complete.has(o.id));
    return earlier ? { kind: "earlier", other: earlier } : null;
  }

  const unitOrIntegration = (t: LoopTask): boolean => t.testTypes.includes("Unit") || t.testTypes.includes("Integration");
  const hasNoTestWriter = (id: string): boolean => ev(id).some((e) => e.type === "noTestWriter");
  const nonRoundDone = (id: string, seat: string): Done[] =>
    doneOf(ev(id), seat).filter((d) => answeredDispatch(ev(id), d)?.round === undefined);

  // Test-writers ahead (FR-004).
  const testWriterSeats: Dispatch[] = [];
  const window = ordered.filter(
    (t) => !complete.has(t.id) && !hasNoTestWriter(t.id) && unitOrIntegration(t) && nonRoundDone(t.id, "test-writer").length === 0,
  );
  const openTestWriter = (id: string): boolean =>
    seats.some((s) => s.task === id && s.seat === "test-writer" && dispatchAt.get(s.line)?.round === undefined);
  let testWriters = window.filter((t) => openTestWriter(t.id)).length;
  for (const t of window) {
    if (testWriters >= 4) break;
    if (openTestWriter(t.id) || dispatchedSeat(t.id, "test-writer") || overlapHold(t)) continue;
    testWriterSeats.push({ kind: "dispatch", task: t.id, seat: "test-writer", mode: "new" });
    testWriters++;
  }

  const writes: Write[] = [];
  for (const t of inputs.tasks) {
    if (complete.has(t.id) || unitOrIntegration(t) || hasNoTestWriter(t.id) || dispatchedSeat(t.id, "test-writer")) continue;
    writes.push(line(f, `${t.id}: no test-writer — <why>`, t.id));
  }

  const wavesNamed = new Set<number>();
  for (const seat of testWriterSeats) {
    const w = byId.get(seat.task)!.wave;
    const waveTasks = inputs.tasks.filter((t) => t.wave === w);
    if (wavesNamed.has(w) || waveTasks.length < 2) continue;
    wavesNamed.add(w);
    if (state.events.some((e) => e.type === "other" && e.text.startsWith(`wave ${w}:`))) continue;
    let pair: [LoopTask, LoopTask] | null = null;
    for (let i = 0; i < waveTasks.length && !pair; i++) {
      for (let j = i + 1; j < waveTasks.length && !pair; j++) {
        if (overlapping(waveTasks[i], waveTasks[j])) pair = [waveTasks[i], waveTasks[j]];
      }
    }
    if (pair === null) {
      writes.push(line(f, `wave ${w}: parallel test-writers ${waveTasks.map((t) => t.id).join(", ")} — disjoint Files`));
    } else {
      const [a, b] = pair;
      const why = a.files === null || b.files === null ? UNKNOWN : `Files overlap ${entryPair(a, b).join(" / ")}`;
      writes.push(line(f, `wave ${w}: sequential ${a.id}, ${b.id} — ${why}`));
    }
  }

  const hasHashes = (id: string): boolean => {
    if (hasNoTestWriter(id)) return true;
    const latest = nonRoundDone(id, "test-writer").at(-1);
    return latest !== undefined && ev(id).some((e) => e.type === "testHashes" && e.line > latest.line);
  };
  for (const t of inputs.tasks) {
    if (complete.has(t.id) || nonRoundDone(t.id, "test-writer").length === 0 || hasHashes(t.id)) continue;
    writes.push(line(f, `${t.id}: test hashes <file>=<sha> …`, t.id));
  }

  // Developer seats in flight: an inline seat is the controller's own and outside the cap (FR-018).
  const inlineSeat = (s: { task: string; line: number }): boolean =>
    dispatchAt.get(s.line)?.model === "inline" || ev(s.task).some((e) => e.type === "inline" && e.line > s.line);
  const inFlight = seats.filter((s) => s.seat === "developer" && !inlineSeat(s)).length;
  let free = cap.n - inFlight - reserved;
  const contentionHold = (): string | null =>
    cap.contention.blocksDevelopers ? `held re-run ${cap.contention.held[0]?.task ?? cap.contention.running}` : null;

  const waitsOut: Wait[] = [];
  const developerSeats: Dispatch[] = [];
  const afterCommit: Action[] = [];

  const waitsOwed = (id: string, reason: string): boolean => {
    const lastDone = doneOf(ev(id), "developer").at(-1)?.line ?? -1;
    const latest = ev(id).filter((e): e is Extract<LedgerEvent, { type: "developerWaits" }> => e.type === "developerWaits" && e.line > lastDone).at(-1);
    return latest?.reason !== reason;
  };
  const holdWithLine = (id: string, reason: string): void => {
    waitsOut.push({ kind: "wait", task: id, reason });
    if (waitsOwed(id, reason)) {
      const text = `${id}: developer waits — ${reason}`;
      writes.push({ kind: "write", task: id, line: text, record: `kf record ${f} waits ${id} -- ${shellQuote(reason)}` });
    }
  };

  // After-commit seats run first: a resume-commit developer takes a freed seat before new tasks (FR-003).
  for (const t of inputs.tasks) {
    const events = sinceReopen(state, t.id);
    const devDones = doneOf(events, "developer");
    const latest = devDones.at(-1);
    if (latest === undefined || !countsAsDone(state, events, latest)) continue;
    const round = answeredDispatch(events, latest)?.round;
    const commits = taskCommits(state, t.id, inputs.reportCommits[t.id], inputs.gitLog);
    const missing = (): void =>
      void afterCommit.push({
        kind: "decide",
        task: t.id,
        rule: "Commit missing",
        reason: `${t.id}'s developer is done but no commit is recorded in a note, a review package or its report`,
        closes: `Note ${t.id}: commits <sha7>`,
      });
    const verifyStarted = (after: number): boolean => events.some((e) => e.line > after && e.type === "verifyStarted");
    const reviewerDispatched = (after: number): boolean =>
      events.some((e) => e.line > after && e.type === "dispatched" && e.seat === "code-reviewer");
    // Each half is named on its own: a session that lost context after recording one still owes the other.
    const trio = (after: number, pkg: string[], r?: number): void => {
      const verify = !verifyStarted(after);
      const reviewer = !reviewerDispatched(after);
      if (!verify && !reviewer) return;
      if (!events.some((e) => e.type === "reviewPackage" && e.line > after)) {
        afterCommit.push(line(f, `${t.id}: review package ${pkg.join(",")}`, t.id));
      }
      if (verify) afterCommit.push({ kind: "verify", task: t.id, command: `kf verify ${f} --task ${t.id} --commits ${commits.join(",")}` });
      if (reviewer) {
        afterCommit.push({ kind: "dispatch", task: t.id, seat: "code-reviewer", mode: "new", ...(r !== undefined ? { round: r } : {}) });
      }
    };

    if (round !== undefined) {
      // The round is named only after its last developer done: a round test-writer or automation-writer
      // dispatched after the latest developer done still owes its resume-commit developer.
      const roundSeatPending = events.some(
        (e) =>
          e.type === "dispatched" &&
          (e.seat === "test-writer" || e.seat === "automation-writer") &&
          e.round === round &&
          e.line > latest.line,
      );
      if (roundSeatPending) continue;
      if (verifyStarted(latest.line) && reviewerDispatched(latest.line)) continue;
      // The previous review is the latest one dispatched before this round's done, not a re-review already under way.
      const reviewed =
        events.filter((e) => e.type === "dispatched" && e.seat === "code-reviewer" && e.line < latest.line).at(-1)?.line ?? -1;
      const since = events.filter((e) => e.line > reviewed);
      const notes = since.flatMap((e) => (e.type === "commits" ? e.shas : []));
      const packages = since.flatMap((e) => (e.type === "reviewPackage" ? e.shas : []));
      const before = taskCommits({ events: events.filter((e) => e.line < reviewed) }, t.id, undefined, inputs.gitLog);
      const fromReport = (inputs.reportCommits[t.id] ?? []).filter((sha) => !before.some((b) => b.startsWith(sha) || sha.startsWith(b)));
      const recorded = notes.length > 0 ? notes : packages.length > 0 ? packages : fromReport;
      const scoped = recorded.filter((sha, i) => !recorded.slice(0, i).some((r) => r.startsWith(sha) || sha.startsWith(r)));
      if (scoped.length === 0) missing();
      else trio(latest.line, scoped, round);
      continue;
    }

    if (commits.length === 0) {
      missing();
      continue;
    }
    const ui = inputs.level === "full" && (t.testTypes.includes("UI") || t.testTypes.includes("E2E"));
    if (!ui) {
      trio(latest.line, commits);
      continue;
    }
    if (!events.some((e) => e.type === "dispatched" && e.seat === "automation-writer")) {
      afterCommit.push({ kind: "dispatch", task: t.id, seat: "automation-writer", mode: "new" });
      continue;
    }
    const specsDone = doneOf(events, "automation-writer").filter((d) => answeredDispatch(events, d)?.round === undefined).at(-1);
    const firstDone = devDones.find((d) => answeredDispatch(events, d)?.round === undefined);
    if (specsDone === undefined || firstDone === undefined) continue;
    const after = Math.max(specsDone.line, firstDone.line);
    const resume = events.find((e): e is Dispatched => e.type === "dispatched" && e.seat === "developer" && e.line > after);
    if (resume === undefined) {
      const contention = t.inline ? null : contentionHold();
      if (contention !== null) {
        waitsOut.push({ kind: "wait", task: t.id, reason: contention });
        continue;
      }
      if (!t.inline && free <= 0) {
        holdWithLine(t.id, `${cap.n} developers in flight`);
        continue;
      }
      if (!t.inline) free--;
      afterCommit.push({ kind: "dispatch", task: t.id, seat: "developer", mode: "resume", ...(t.inline ? { inline: true } : {}) });
      continue;
    }
    const resumeDone = devDones.find((d) => d.line > resume.line);
    if (resumeDone !== undefined && resumeDone === latest) trio(latest.line, commits);
  }

  // Developer release for new tasks, plan order (FR-003).
  const finished = (dep: string): boolean =>
    doneOf(ev(dep), "developer").some((d) => countsAsDone(state, ev(dep), d)) &&
    taskCommits(state, dep, inputs.reportCommits[dep], inputs.gitLog).length > 0;

  for (const t of inputs.tasks) {
    if (complete.has(t.id) || dispatchedSeat(t.id, "developer")) continue;
    if (nonRoundDone(t.id, "test-writer").length === 0 && !hasNoTestWriter(t.id)) continue;
    const dep = t.dependencies.find((d) => !finished(d));
    if (dep !== undefined) {
      waitsOut.push({ kind: "wait", task: t.id, reason: `dependency ${dep} has no commit` });
      continue;
    }
    if (!hasHashes(t.id)) {
      waitsOut.push({ kind: "wait", task: t.id, reason: "no test hashes yet" });
      continue;
    }
    const overlap = overlapHold(t);
    if (overlap?.kind === "open") {
      const [mine, theirs] = entryPair(t, overlap.other);
      holdWithLine(t.id, `Files overlap ${mine} / ${theirs} (${overlap.other.id})`);
      continue;
    }
    if (overlap?.kind === "earlier") {
      waitsOut.push({ kind: "wait", task: t.id, reason: `earlier overlapping ${overlap.other.id} incomplete` });
      continue;
    }
    if (t.inline) {
      developerSeats.push({ kind: "dispatch", task: t.id, seat: "developer", mode: "new", inline: true });
      continue;
    }
    const contention = contentionHold();
    if (contention !== null) {
      waitsOut.push({ kind: "wait", task: t.id, reason: contention });
      continue;
    }
    if (free <= 0) {
      holdWithLine(t.id, `${cap.n} developers in flight`);
      continue;
    }
    developerSeats.push({ kind: "dispatch", task: t.id, seat: "developer", mode: "new" });
    free--;
  }

  return [...testWriterSeats, ...writes, ...developerSeats, ...waitsOut, ...afterCommit];
}
