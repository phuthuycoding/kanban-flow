import { firstOverlap } from "../allowlist.js";
import { shellQuote } from "./record.js";
import type { Action, Arbitration, InFlight, Intent, LoopTask, NextOptions, Seat, TaskState, WaitBlocker, World } from "./types.js";

// Cross-task arbitration: resume, holds by origin, dependencies, overlaps and the test-writer window, the live cap
// over the developer pool, contention, the reviewer lane, then dedupe and rank. Each intent maps to exactly one
// action, In-flight entry or wait with its blocker.

type Dispatch = Extract<Action, { kind: "dispatch" }>;
type Wait = Extract<Action, { kind: "wait" }>;
type Judge = Extract<Intent, { kind: "judge" }>;

// Developers first, as `kf:implement` lists the ready seats: developers under the cap, test-writers, then reviewers.
const SEAT_ORDER: Seat[] = ["developer", "test-writer", "automation-writer", "code-reviewer"];
const KIND_ORDER: Action["kind"][] = ["stop", "decide", "write", "verify", "dispatch", "complete", "wait", "finished"];
const TEST_WRITER_WINDOW = 4;
const UNKNOWN = "Files unknown";

const sameSha = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

const overlapping = (a: LoopTask, b: LoopTask): boolean =>
  a.id !== b.id && (a.files === null || b.files === null || a.overlaps.includes(b.id) || b.overlaps.includes(a.id));

/**
 * The first overlapping entry pair of two tasks; a side with unknown Files reads `Files unknown`. Null when the plan
 * marks them overlapping but no entry pair overlaps: the arbiter has no rule for that seat.
 */
function entryPair(a: LoopTask, b: LoopTask): [string, string] | null {
  if (a.files === null || b.files === null) return [a.files?.[0] ?? UNKNOWN, b.files?.[0] ?? UNKNOWN];
  return firstOverlap(a.files, b.files);
}

/** An open task: its test-writer or developer has been dispatched and it is not complete. */
function isOpen(t: TaskState | undefined): boolean {
  if (t === undefined) return false;
  switch (t.phase.kind) {
    case "tests":
    case "cycle":
    case "atCap":
      return true;
    case "ready":
      return t.seats["test-writer"].kind !== "idle";
    default:
      return false;
  }
}

/**
 * `wave <w>: parallel test-writers …` or `wave <w>: sequential A, B — <why>` for a wave of two or more tasks; null for a
 * one-task wave; undefined when two tasks are marked overlapping but no Files entry pair overlaps.
 */
function waveLine(tasks: LoopTask[], w: number): string | null | undefined {
  if (tasks.length < 2) return null;
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const [a, b] = [tasks[i], tasks[j]];
      if (!overlapping(a, b)) continue;
      if (a.files === null || b.files === null) return `wave ${w}: sequential ${a.id}, ${b.id} — ${UNKNOWN}`;
      const pair = entryPair(a, b);
      return pair === null ? undefined : `wave ${w}: sequential ${a.id}, ${b.id} — Files overlap ${pair.join(" / ")}`;
    }
  }
  return `wave ${w}: parallel test-writers ${tasks.map((t) => t.id).join(", ")} — disjoint Files`;
}

/** The wait a held progress dispatch prints: it names the stop or decide that holds it. */
function holdWait(hold: Judge): { reason: string; blockedBy: WaitBlocker } {
  const task = hold.action.task;
  if (hold.action.kind === "stop") {
    return {
      reason: task !== undefined ? `stop ${task} holds every dispatch` : "an item stop holds every dispatch",
      blockedBy: { kind: "hold", judgement: "stop", ...(task !== undefined ? { task } : {}) },
    };
  }
  return { reason: `${hold.action.rule} decide holds every dispatch`, blockedBy: { kind: "hold", judgement: hold.judgement } };
}

export function arbitrate(world: World, intents: Intent[], opts: NextOptions): Arbitration {
  void opts;
  const f = world.inputs.feature;
  const n = world.cap.n;
  const contention = world.contention;
  const plan = world.inputs.tasks;
  const byId = new Map(plan.map((t) => [t.id, t]));
  const planIndex = new Map(plan.map((t, i) => [t.id, i]));
  const ordered = [...plan].sort((a, b) => a.wave - b.wave || planIndex.get(a.id)! - planIndex.get(b.id)!);
  const rank = new Map(ordered.map((t, i) => [t.id, i]));
  const planPos = (task: string): number => planIndex.get(task) ?? Infinity;
  const rankPos = (task: string): number => rank.get(task) ?? Infinity;
  const isComplete = (id: string): boolean => world.tasks.get(id)?.phase.kind === "complete";

  /** `at`: a resumed item's ledger line, so resumed items keep the ledger order of their seats and verifies. */
  const out: { a: Action; resumed: boolean; at: number }[] = [];
  const inFlight: InFlight[] = [];
  const waits: Arbitration["waits"] = [];
  const seen = new Set<string>();
  const seenInFlight = new Set<string>();
  const unplaced = new Set<string>();

  // A resumed item is exempt from dedupe; every other action is printed once per identical shape.
  const emit = (a: Action, resumed = false, at = 0): void => {
    const key = JSON.stringify(a);
    if (!resumed && seen.has(key)) return;
    seen.add(key);
    out.push({ a, resumed, at });
  };
  const wait = (w: Wait, blockedBy: WaitBlocker, quiet = false): void => {
    const key = JSON.stringify(w);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a: w, resumed: false, at: 0 });
    waits.push({ wait: w, blockedBy, ...(quiet ? { quiet: true as const } : {}) });
  };
  // The `developer waits` line is owed once: not again while the task's latest waits line has the same reason.
  const developerWaits = (task: string, reason: string, blockedBy: WaitBlocker): void => {
    wait({ kind: "wait", task, reason }, blockedBy);
    if (world.tasks.get(task)?.waitsWritten === reason) return;
    emit({ kind: "write", task, line: `${task}: developer waits — ${reason}`, record: `kf record ${f} waits ${task} -- ${shellQuote(reason)}` });
  };
  /** `Files overlap <mine> / <theirs> (<about>)`; null, with the task unplaced, when no entry pair overlaps. */
  const overlapReason = (t: LoopTask, other: LoopTask, about: string): string | null => {
    const pair = entryPair(t, other);
    if (pair === null) {
      unplaced.add(t.id);
      return null;
    }
    return `Files overlap ${pair[0]} / ${pair[1]} (${about})`;
  };
  const verifyCommand = (task: string, atHead: boolean): string =>
    `kf verify ${f} --task ${task} --commits ${(world.tasks.get(task)?.commits ?? []).join(",")}${atHead ? " --at-head" : ""}`;

  // Holds by origin: a stop, or a decide of no task, holds every progress dispatch item-wide; a task's judgement
  // holds that task's own progress intents, its judgement being the task's witness.
  const judged = intents.filter((i): i is Judge => i.kind === "judge");
  const itemHold =
    judged.find((i) => i.action.kind === "stop") ?? judged.find((i) => i.action.kind === "decide" && i.action.task === undefined);
  const heldTasks = new Set(judged.flatMap((i) => (i.action.task !== undefined ? [i.action.task] : [])));

  const resumedSeats = intents.flatMap((i) =>
    i.origin === "resume" && i.kind === "act" && i.action.kind === "dispatch" ? [i.action] : [],
  );
  const resumedKey = new Set(resumedSeats.map((d) => `${d.task} ${d.seat}`));

  const developers: Dispatch[] = [];
  const testWriters: Dispatch[] = [];
  const reviewers: Dispatch[] = [];

  /** The ledger line of the lost seat or verify a resumed action re-issues. */
  const lostAt = (a: Action): number => {
    if (a.kind === "verify") {
      const v = world.tasks.get(a.task)?.verify;
      return v?.kind === "running" ? v.line : 0;
    }
    if (a.kind !== "dispatch") return 0;
    const t = world.tasks.get(a.task);
    if (t === undefined) return 0;
    const slot = a.seat === "test-writer" && t.phase.kind === "tests" ? t.phase.writer : t.seats[a.seat];
    return slot.kind === "running" ? slot.line : 0;
  };

  // Contention: one re-run at a time, while developers are below N. A re-run lost under `--resume` goes first; with the
  // cap full its rerun note is written again, and a later call below the cap releases it. Otherwise the earliest held
  // re-run is released while nothing re-runs.
  const lost = intents.find(
    (i): i is Extract<Intent, { kind: "act" }> =>
      i.origin === "resume" && i.kind === "act" && i.action.kind === "verify" && i.action.task === contention.running,
  );
  const nextHeld = contention.held[0];
  if (lost !== undefined && lost.action.kind === "verify") {
    const task = lost.action.task;
    const signature = world.rerunSignature?.get(task);
    if (world.pool.length < n) emit({ ...lost.action, rerun: true }, true, -1);
    else if (signature !== undefined) {
      const line = `Note ${task}: verify rerun — contention ${signature}`;
      emit({ kind: "write", task, line, record: `kf record ${f} line -- ${shellQuote(line)}` });
    } else wait({ kind: "wait", task, reason: `${n} developers in flight` }, { kind: "pool" });
  } else if (contention.running === null && nextHeld !== undefined && !heldTasks.has(nextHeld.task)) {
    // A re-run the full cap holds waits on the pool: it is its task's witness until developers drop below N.
    if (world.pool.length < n) emit({ kind: "verify", task: nextHeld.task, command: verifyCommand(nextHeld.task, nextHeld.atHead), rerun: true }, true, -1);
    else wait({ kind: "wait", task: nextHeld.task, reason: `${n} developers in flight` }, { kind: "pool" });
  }

  for (const i of intents) {
    if (i === lost) continue;
    if (i.kind === "inFlight") {
      const key = JSON.stringify(i.entry);
      if (!seenInFlight.has(key)) {
        seenInFlight.add(key);
        inFlight.push(i.entry);
      }
      continue;
    }
    if (i.kind === "judge") {
      emit(i.action);
      continue;
    }
    if (i.kind === "wait") {
      wait(i.action, i.blockedBy);
      continue;
    }
    const a = i.action;
    if (i.origin === "resume") {
      if (a.kind === "dispatch") {
        // A lost spawned seat is spawned again; a lost inline developer seat is the controller's, resumed inline.
        const slot = world.tasks.get(a.task)?.seats.developer;
        const inline =
          a.seat === "developer" && (a.inline === true || byId.get(a.task)?.inline === true || (slot?.kind === "running" && slot.inline));
        const resumed: Dispatch = { ...a, mode: inline ? "resume" : "new" };
        if (inline) resumed.inline = true;
        else delete resumed.inline;
        emit(resumed, true, lostAt(a));
      } else {
        emit(a, true, lostAt(a));
      }
      continue;
    }
    if (a.task !== undefined && heldTasks.has(a.task)) continue;
    if (a.kind !== "dispatch") {
      emit(a);
      continue;
    }
    if (a.seat !== "code-reviewer" && resumedKey.has(`${a.task} ${a.seat}`)) continue;
    if (itemHold !== undefined) {
      // An item judgement witnesses every task by itself, so its hold is not printed; a task's stop names its hold.
      const { reason, blockedBy } = holdWait(itemHold);
      wait({ kind: "wait", task: a.task, reason }, blockedBy, itemHold.action.task === undefined);
      continue;
    }
    if (a.seat === "developer") developers.push(a);
    else if (a.seat === "test-writer") testWriters.push(a);
    else if (a.seat === "code-reviewer") reviewers.push(a);
    else emit(a);
  }

  /**
   * The overlap that holds opening `t`: an open task ranked before it first, else an earlier incomplete one. A later
   * open task never holds an earlier one, so a reopened earlier task cannot deadlock against it.
   */
  function overlapHold(t: LoopTask): { kind: "open" | "earlier"; other: LoopTask } | null {
    const others = plan.filter((o) => overlapping(t, o) && rankPos(o.id) < rankPos(t.id));
    const open = others.find((o) => isOpen(world.tasks.get(o.id)));
    if (open) return { kind: "open", other: open };
    const earlier = others.find((o) => !isComplete(o.id));
    return earlier ? { kind: "earlier", other: earlier } : null;
  }

  /**
   * A later overlapping task whose developer is in the pool holds an earlier task's seat: the wait is on an in-flight
   * seat that ends on its own, so it never closes a cycle with the open-task hold, which only points at earlier tasks.
   */
  const runningLater = (t: LoopTask): LoopTask | undefined =>
    plan.find((o) => overlapping(t, o) && rankPos(o.id) > rankPos(t.id) && world.pool.some((p) => p.task === o.id));

  // The developer pool against the live cap: fix-round, resume-commit and minimal-fix developers first, then new
  // developers, each in plan order. Inline developers bypass N.
  const priority = (d: Dispatch): boolean => d.mode !== "new" || d.round !== undefined;
  developers.sort((a, b) => Number(priority(b)) - Number(priority(a)) || planPos(a.task) - planPos(b.task));
  let free = n - world.pool.length;
  const rerunHold: { task: string; label: string } | null =
    contention.running !== null
      ? { task: contention.running, label: "running re-run" }
      : contention.held[0] !== undefined
        ? { task: contention.held[0].task, label: "held re-run" }
        : null;
  for (const d of developers) {
    const t = byId.get(d.task);
    const phase = world.tasks.get(d.task)?.phase.kind;
    const release = !priority(d) && phase !== "cycle" && phase !== "atCap";
    // One file-writing seat per overlapping Files: every developer waits on a running later one or an earlier open one.
    if (t !== undefined) {
      const later = runningLater(t);
      if (later !== undefined) {
        const reason = overlapReason(t, later, `${later.id} developer in flight`);
        if (reason !== null) developerWaits(d.task, reason, { kind: "task", task: later.id });
        continue;
      }
    }
    if (!release && t !== undefined) {
      const overlap = overlapHold(t);
      if (overlap?.kind === "open") {
        const reason = overlapReason(t, overlap.other, overlap.other.id);
        if (reason !== null) developerWaits(d.task, reason, { kind: "task", task: overlap.other.id });
        continue;
      }
    }
    if (release && t !== undefined) {
      const dep = t.dependencies.find((id) => {
        const s = world.tasks.get(id);
        return s === undefined || (s.commits.length === 0 && s.phase.kind !== "complete");
      });
      if (dep !== undefined) {
        wait({ kind: "wait", task: d.task, reason: `dependency ${dep} has no commit` }, { kind: "task", task: dep });
        continue;
      }
      const overlap = overlapHold(t);
      if (overlap?.kind === "open") {
        const reason = overlapReason(t, overlap.other, overlap.other.id);
        if (reason !== null) developerWaits(d.task, reason, { kind: "task", task: overlap.other.id });
        continue;
      }
      if (overlap?.kind === "earlier") {
        wait({ kind: "wait", task: d.task, reason: `earlier overlapping ${overlap.other.id} incomplete` }, { kind: "task", task: overlap.other.id });
        continue;
      }
    }
    if (d.inline === true) {
      emit(d);
      continue;
    }
    if (contention.blocksDevelopers && rerunHold !== null) {
      wait({ kind: "wait", task: d.task, reason: `${rerunHold.label} ${rerunHold.task}` }, { kind: "verify", task: rerunHold.task });
      continue;
    }
    if (free > 0) {
      emit(d);
      free--;
      continue;
    }
    developerWaits(d.task, `${n} developers in flight`, { kind: "pool" });
  }

  // Test-writers ahead: at most four open at once, earliest first, none inside an open or earlier overlapping task.
  const opened: string[] = [];
  testWriters.sort((a, b) => rankPos(a.task) - rankPos(b.task) || planPos(a.task) - planPos(b.task));
  const writing = ordered
    .filter((t) => {
      const phase = world.tasks.get(t.id)?.phase;
      return phase?.kind === "tests" && phase.writer.kind === "running";
    })
    .map((t) => t.id);
  for (const d of testWriters) {
    const t = byId.get(d.task);
    const later = t !== undefined ? runningLater(t) : undefined;
    if (later !== undefined && t !== undefined) {
      const reason = overlapReason(t, later, `${later.id} developer in flight`);
      if (reason !== null) wait({ kind: "wait", task: d.task, reason }, { kind: "task", task: later.id }, true);
      continue;
    }
    const overlap = t !== undefined ? overlapHold(t) : null;
    if (overlap !== null && t !== undefined) {
      const reason = overlap.kind === "open" ? overlapReason(t, overlap.other, overlap.other.id) : `earlier overlapping ${overlap.other.id} incomplete`;
      if (reason !== null) wait({ kind: "wait", task: d.task, reason }, { kind: "task", task: overlap.other.id }, true);
      continue;
    }
    if (writing.length >= TEST_WRITER_WINDOW) {
      wait({ kind: "wait", task: d.task, reason: `${TEST_WRITER_WINDOW} test-writers ahead: ${writing.join(", ")}` }, { kind: "task", task: writing[0] }, true);
      continue;
    }
    emit(d);
    writing.push(d.task);
    opened.push(d.task);
  }

  // The wave line of each wave a test-writer opens now, once per wave of two or more tasks (FR-004).
  const waveNamed = new Set(world.wavesNamed ?? []);
  for (const task of opened) {
    const w = byId.get(task)?.wave;
    if (w === undefined || waveNamed.has(w)) continue;
    waveNamed.add(w);
    const line = waveLine(plan.filter((t) => t.wave === w), w);
    if (line === null) continue;
    if (line === undefined) {
      unplaced.add(task);
      continue;
    }
    emit({ kind: "write", line, record: `kf record ${f} line -- ${shellQuote(line)}` });
  }

  // The reviewer lane (FR-025): one code-reviewer per task in flight, the oldest demand first.
  const reviewTasks = [...new Set(reviewers.map((d) => d.task))];
  for (const task of reviewTasks) {
    const state = world.tasks.get(task);
    const demands = state?.review.demands ?? [];
    const age = (d: Dispatch): number => {
      const at =
        d.cascade !== undefined
          ? demands.findIndex((x) => x.kind === "cascade" && sameSha(x.sha7, d.cascade!))
          : demands.findIndex((x) => x.kind === "own");
      return at === -1 ? Infinity : at;
    };
    const resumed = resumedSeats.filter((r) => r.task === task && r.seat === "code-reviewer");
    const own = reviewers
      .filter((d) => d.task === task && !resumed.some((r) => r.cascade === d.cascade))
      .sort((a, b) => age(a) - age(b));
    const busy = state?.review.lane.kind === "busy" || resumed.length > 0;
    own.forEach((d, k) => {
      if (!busy && k === 0) emit(d);
      else wait({ kind: "wait", task, reason: `code-reviewer of ${task} in flight` }, { kind: "reviewer", task });
    });
  }

  // A complete the defensive checks reject is the arbiter's anomaly: dropped, its task unplaced.
  const unsettled = unsettledCompletes(world, out.map((o) => o.a));
  for (const task of unsettled) unplaced.add(task);
  const settled = out.filter((o) => !(o.a.kind === "complete" && unsettled.has(o.a.task)));

  const rankOf = (a: Action, resumed: boolean, at: number, i: number): number[] => {
    const kind = KIND_ORDER.indexOf(a.kind);
    if (resumed) return [kind, 0, at, 0, i];
    // Waits in plan order, as the developer release lists them.
    if (a.kind === "wait") return [kind, 1, planPos(a.task), 0, i];
    if (a.kind !== "dispatch") return [kind, 1, 0, 0, i];
    const group = a.seat === "developer" && priority(a) ? 1 : 2;
    return [kind, group, SEAT_ORDER.indexOf(a.seat), planPos(a.task), i];
  };
  const ranked = settled.map((o, i) => ({ a: o.a, r: rankOf(o.a, o.resumed, o.at, i) }));
  ranked.sort((x, y) => {
    for (let k = 0; k < x.r.length; k++) if (x.r[k] !== y.r[k]) return x.r[k] - y.r[k];
    return 0;
  });
  return { actions: ranked.map((x) => x.a), inFlight, waits, unplaced: [...unplaced] };
}

/**
 * Defensive checks kept from the old scheduler until the machine shows they never fire: a task is never completed
 * beside its own cascade re-review, nor while a dependency, direct or transitive, has a commit landing in this output.
 * Returns the tasks whose complete breaks one.
 */
function unsettledCompletes(world: World, actions: Action[]): Set<string> {
  const cascadeDue = new Set<string>();
  const landing = new Set<string>();
  for (const a of actions) {
    if (a.kind === "dispatch" && a.cascade !== undefined) cascadeDue.add(a.task);
    if (a.kind === "write" && a.task !== undefined && a.line.startsWith(`${a.task}: cascade re-review owed`)) cascadeDue.add(a.task);
    if (a.kind === "write" && a.task !== undefined && a.line.startsWith(`Note ${a.task}: commits `)) landing.add(a.task);
    if (a.kind === "decide" && a.task !== undefined && a.closes === `Note ${a.task}: commits <sha7>`) landing.add(a.task);
  }
  for (const t of cascadeDue) landing.add(t);
  const dependencies = new Map(world.inputs.tasks.map((t) => [t.id, t.dependencies]));
  const dependsOnLanding = (task: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(dependencies.get(task) ?? [])];
    while (stack.length > 0) {
      const d = stack.pop()!;
      if (seen.has(d)) continue;
      seen.add(d);
      if (landing.has(d)) return true;
      stack.push(...(dependencies.get(d) ?? []));
    }
    return false;
  };
  const unsettled = new Set<string>();
  for (const a of actions) {
    if (a.kind === "complete" && (cascadeDue.has(a.task) || dependsOnLanding(a.task))) unsettled.add(a.task);
  }
  return unsettled;
}
