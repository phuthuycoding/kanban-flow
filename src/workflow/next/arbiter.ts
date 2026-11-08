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

/** The first overlapping entry pair of two tasks; a side with unknown Files reads `Files unknown`. */
function entryPair(a: LoopTask, b: LoopTask): [string, string] {
  if (a.files === null || b.files === null) return [a.files?.[0] ?? UNKNOWN, b.files?.[0] ?? UNKNOWN];
  const pair = firstOverlap(a.files, b.files);
  if (pair === null) throw new Error(`${a.id} and ${b.id} are marked overlapping but no Files entry pair overlaps`);
  return pair;
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

  const out: { a: Action; resumed: boolean }[] = [];
  const inFlight: InFlight[] = [];
  const waits: Arbitration["waits"] = [];
  const seen = new Set<string>();
  const seenInFlight = new Set<string>();

  // A resumed item is exempt from dedupe; every other action is printed once per identical shape.
  const emit = (a: Action, resumed = false): void => {
    const key = JSON.stringify(a);
    if (!resumed && seen.has(key)) return;
    seen.add(key);
    out.push({ a, resumed });
  };
  const wait = (w: Wait, blockedBy: WaitBlocker): void => {
    const key = JSON.stringify(w);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ a: w, resumed: false });
    waits.push({ wait: w, blockedBy });
  };
  const developerWaits = (task: string, reason: string, blockedBy: WaitBlocker): void => {
    wait({ kind: "wait", task, reason }, blockedBy);
    emit({ kind: "write", task, line: `${task}: developer waits — ${reason}`, record: `kf record ${f} waits ${task} -- ${shellQuote(reason)}` });
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

  for (const i of intents) {
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
      if (a.kind === "dispatch" && a.seat === "developer") {
        const slot = world.tasks.get(a.task)?.seats.developer;
        const inline = a.inline === true || byId.get(a.task)?.inline === true || (slot?.kind === "running" && slot.inline);
        emit(inline ? { ...a, inline: true } : a, true);
      } else if (a.kind === "verify" && a.task === contention.running) {
        // A lost re-run is the one re-run: it runs again only while developers are below the cap.
        if (world.pool.length < n) emit({ ...a, rerun: true }, true);
        else wait({ kind: "wait", task: a.task, reason: `${n} developers in flight` }, { kind: "pool" });
      } else {
        emit(a, true);
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
      const { reason, blockedBy } = holdWait(itemHold);
      wait({ kind: "wait", task: a.task, reason }, blockedBy);
      continue;
    }
    if (a.seat === "developer") developers.push(a);
    else if (a.seat === "test-writer") testWriters.push(a);
    else if (a.seat === "code-reviewer") reviewers.push(a);
    else emit(a);
  }

  // Contention: one held re-run at a time, the earliest first, while nothing re-runs and developers are below N.
  const nextHeld = contention.held[0];
  if (contention.running === null && nextHeld !== undefined && world.pool.length < n && !heldTasks.has(nextHeld.task)) {
    emit({ kind: "verify", task: nextHeld.task, command: verifyCommand(nextHeld.task, nextHeld.atHead), rerun: true });
  }

  /** The overlap that holds opening `t`: an open task first, else an earlier incomplete one. */
  function overlapHold(t: LoopTask): { kind: "open" | "earlier"; other: LoopTask } | null {
    const others = plan.filter((o) => overlapping(t, o));
    const open = others.find((o) => isOpen(world.tasks.get(o.id)));
    if (open) return { kind: "open", other: open };
    const earlier = others.find((o) => rankPos(o.id) < rankPos(t.id) && !isComplete(o.id));
    return earlier ? { kind: "earlier", other: earlier } : null;
  }

  // The developer pool against the live cap: fix-round, resume-commit and minimal-fix developers first, then new
  // developers, each in plan order. Inline developers bypass N.
  const priority = (d: Dispatch): boolean => d.mode !== "new" || d.round !== undefined;
  developers.sort((a, b) => Number(priority(b)) - Number(priority(a)) || planPos(a.task) - planPos(b.task));
  let free = n - world.pool.length;
  const heldRerun = contention.held[0]?.task ?? contention.running;
  for (const d of developers) {
    const t = byId.get(d.task);
    const phase = world.tasks.get(d.task)?.phase.kind;
    const release = !priority(d) && phase !== "cycle" && phase !== "atCap";
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
        const [mine, theirs] = entryPair(t, overlap.other);
        developerWaits(d.task, `Files overlap ${mine} / ${theirs} (${overlap.other.id})`, { kind: "task", task: overlap.other.id });
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
    if (contention.blocksDevelopers && heldRerun !== null) {
      wait({ kind: "wait", task: d.task, reason: `held re-run ${heldRerun}` }, { kind: "verify", task: heldRerun });
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
  testWriters.sort((a, b) => rankPos(a.task) - rankPos(b.task) || planPos(a.task) - planPos(b.task));
  const writing = ordered
    .filter((t) => {
      const phase = world.tasks.get(t.id)?.phase;
      return phase?.kind === "tests" && phase.writer.kind === "running";
    })
    .map((t) => t.id);
  for (const d of testWriters) {
    const t = byId.get(d.task);
    const overlap = t !== undefined ? overlapHold(t) : null;
    if (overlap !== null && t !== undefined) {
      const reason =
        overlap.kind === "open"
          ? `Files overlap ${entryPair(t, overlap.other).join(" / ")} (${overlap.other.id})`
          : `earlier overlapping ${overlap.other.id} incomplete`;
      wait({ kind: "wait", task: d.task, reason }, { kind: "task", task: overlap.other.id });
      continue;
    }
    if (writing.length >= TEST_WRITER_WINDOW) {
      wait({ kind: "wait", task: d.task, reason: `${TEST_WRITER_WINDOW} test-writers ahead: ${writing.join(", ")}` }, { kind: "task", task: writing[0] });
      continue;
    }
    emit(d);
    writing.push(d.task);
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

  assertCompletesSettled(world, out.map((o) => o.a));

  const rankOf = (a: Action, resumed: boolean, i: number): number[] => {
    const kind = KIND_ORDER.indexOf(a.kind);
    if (a.kind !== "dispatch" || resumed) return [kind, 0, 0, 0, i];
    const group = a.seat === "developer" && priority(a) ? 1 : 2;
    return [kind, group, SEAT_ORDER.indexOf(a.seat), planPos(a.task), i];
  };
  const ranked = out.map((o, i) => ({ a: o.a, r: rankOf(o.a, o.resumed, i) }));
  ranked.sort((x, y) => {
    for (let k = 0; k < x.r.length; k++) if (x.r[k] !== y.r[k]) return x.r[k] - y.r[k];
    return 0;
  });
  return { actions: ranked.map((x) => x.a), inFlight, waits };
}

/**
 * Defensive checks kept from the old scheduler until the machine shows they never fire: a task is never completed
 * beside its own cascade re-review, nor while a dependency, direct or transitive, has a commit landing in this output.
 */
function assertCompletesSettled(world: World, actions: Action[]): void {
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
  for (const a of actions) {
    if (a.kind !== "complete") continue;
    if (cascadeDue.has(a.task)) throw new Error(`arbiter: ${a.task} is completed beside its own cascade re-review`);
    if (dependsOnLanding(a.task)) throw new Error(`arbiter: ${a.task} is completed while a dependency's commit lands`);
  }
}
