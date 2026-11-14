import { describe, it, expect, vi, afterEach } from "vitest";

import {
  manyReducer,
  PromptAbort,
  selectChoice,
  selectMany,
  selectReducer,
  terminalRows,
  withLoading,
  type Choice,
  type ManyState,
  type SelectState,
} from "../project/prompts.js";

const key = (name: string, ctrl?: boolean) => (ctrl ? { name, ctrl } : { name });

describe("manyReducer", () => {
  const count = 5;
  const start = (selected: number[] = [0], cursor = 0): ManyState => ({
    cursor,
    selected: new Set(selected),
    done: false,
    hint: false,
    abort: false,
  });

  it("toggles the cursor row on space after moving down", () => {
    const moved = manyReducer(start(), key("down"), count);
    expect(moved.cursor).toBe(1);
    const toggled = manyReducer(moved, key("space"), count);
    expect([...toggled.selected].sort()).toEqual([0, 1]);
    expect(toggled.done).toBe(false);
  });

  it("toggles a selected row off on a second space", () => {
    const off = manyReducer(start([0], 0), key("space"), count);
    expect(off.selected.size).toBe(0);
  });

  it("moves the cursor on a digit key without toggling", () => {
    const before = start([0]);
    const after = manyReducer(before, key("3"), count);
    expect(after.cursor).toBe(2);
    expect([...after.selected]).toEqual([0]);
  });

  it("ignores a digit beyond the option count", () => {
    const after = manyReducer(start([0], 1), key("9"), count);
    expect(after.cursor).toBe(1);
    expect([...after.selected]).toEqual([0]);
  });

  it("wraps the cursor around at both ends", () => {
    expect(manyReducer(start([0], 0), key("up"), count).cursor).toBe(count - 1);
    expect(manyReducer(start([0], count - 1), key("down"), count).cursor).toBe(0);
  });

  it("stays and sets the hint when return is pressed with nothing selected", () => {
    const after = manyReducer(start([]), key("return"), count);
    expect(after.done).toBe(false);
    expect(after.hint).toBe(true);
  });

  it("clears the hint when a row is toggled afterwards", () => {
    const hinted = manyReducer(start([]), key("return"), count);
    const after = manyReducer(hinted, key("space"), count);
    expect(after.hint).toBe(false);
    expect([...after.selected]).toEqual([0]);
  });

  it("accepts on return when something is selected", () => {
    const after = manyReducer(start([2]), key("return"), count);
    expect(after.done).toBe(true);
    expect(after.hint).toBe(false);
  });

  it("aborts on ctrl+c", () => {
    expect(manyReducer(start(), key("c", true), count).abort).toBe(true);
  });

  it("aborts on ctrl+d (EOF in raw mode)", () => {
    expect(manyReducer(start(), key("d", true), count).abort).toBe(true);
  });

  it("never mutates the input state or its selection set", () => {
    const before = start([0], 0);
    const snapshot = [...before.selected];
    const after = manyReducer(before, key("space"), count);
    expect(after).not.toBe(before);
    expect(after.selected).not.toBe(before.selected);
    expect([...before.selected]).toEqual(snapshot);
    expect(before.cursor).toBe(0);
  });
});

describe("selectReducer", () => {
  const choices: Choice[] = [
    { label: "global" },
    { label: "project", unavailable: "no .works/ — run kf init" },
    { label: "workspace" },
  ];
  const start = (cursor = 0): SelectState => ({ cursor, done: false, abort: false });

  it("does not accept return on an unavailable choice", () => {
    const onProject = selectReducer(start(), key("down"), choices);
    expect(onProject.cursor).toBe(1);
    const after = selectReducer(onProject, key("return"), choices);
    expect(after.done).toBe(false);
    expect(after.cursor).toBe(1);
  });

  it("accepts return on an available choice", () => {
    const after = selectReducer(start(2), key("return"), choices);
    expect(after.done).toBe(true);
    expect(after.cursor).toBe(2);
  });

  it("moves the cursor onto an unavailable row by digit", () => {
    expect(selectReducer(start(), key("2"), choices).cursor).toBe(1);
  });

  it("ignores a digit beyond the choice count", () => {
    expect(selectReducer(start(1), key("4"), choices).cursor).toBe(1);
  });

  it("wraps the cursor around at both ends", () => {
    expect(selectReducer(start(0), key("up"), choices).cursor).toBe(2);
    expect(selectReducer(start(2), key("down"), choices).cursor).toBe(0);
  });

  it("aborts on ctrl+c", () => {
    expect(selectReducer(start(), key("c", true), choices).abort).toBe(true);
  });

  it("aborts on ctrl+d (EOF in raw mode)", () => {
    expect(selectReducer(start(), key("d", true), choices).abort).toBe(true);
  });

  it("leaves the state unchanged on an unrelated key", () => {
    const before = start(1);
    expect(selectReducer(before, key("x"), choices)).toEqual(before);
  });

  it("returns a new object without mutating the input", () => {
    const before = start(0);
    const after = selectReducer(before, key("down"), choices);
    expect(after).not.toBe(before);
    expect(before).toEqual({ cursor: 0, done: false, abort: false });
  });

  it("sets a hint with the reason on return over an unavailable choice", () => {
    const after = selectReducer(start(1), key("return"), choices);
    expect(after.done).toBe(false);
    expect(after.cursor).toBe(1);
    expect(after.hint).toBe("project is unavailable: no .works/ — run kf init");
  });

  it("clears the hint when the cursor moves with up, down or a digit", () => {
    const hinted: SelectState = { ...start(1), hint: "project is unavailable: no .works/ — run kf init" };
    expect(selectReducer(hinted, key("up"), choices).hint).toBeUndefined();
    expect(selectReducer(hinted, key("down"), choices).hint).toBeUndefined();
    expect(selectReducer(hinted, key("3"), choices).hint).toBeUndefined();
  });

  it("keeps the hint on an unrelated key", () => {
    const hinted: SelectState = { ...start(1), hint: "project is unavailable: no .works/ — run kf init" };
    expect(selectReducer(hinted, key("x"), choices)).toEqual(hinted);
  });

  it("does not mutate the input when it sets the hint", () => {
    const before = start(1);
    const after = selectReducer(before, key("return"), choices);
    expect(after).not.toBe(before);
    expect(before).toEqual({ cursor: 1, done: false, abort: false });
  });
});

describe("terminalRows", () => {
  it("counts a line wider than the terminal as two rows", () => {
    expect(terminalRows(["x".repeat(85)], 80)).toBe(2);
  });

  it("counts a line exactly as wide as the terminal as one row", () => {
    expect(terminalRows(["x".repeat(80)], 80)).toBe(1);
  });

  it("counts an empty line as one row", () => {
    expect(terminalRows([""], 80)).toBe(1);
  });

  it("ignores ANSI escapes when measuring width", () => {
    expect(terminalRows(["\x1b[2m" + "x".repeat(80) + "\x1b[0m"], 80)).toBe(1);
  });

  it("counts one row per line when the column count is unknown", () => {
    expect(terminalRows(["x".repeat(85), "y"], undefined)).toBe(2);
  });

  it("counts one row per line when the column count is zero", () => {
    expect(terminalRows(["x".repeat(85)], 0)).toBe(1);
  });

  it("measures width in code points, not UTF-16 units", () => {
    expect(terminalRows(["❯ —".repeat(30)], 80)).toBe(2);
  });

  it("sums the rows of every line", () => {
    expect(terminalRows(["x".repeat(85), "y", "z".repeat(160)], 80)).toBe(5);
  });
});

// The prompts read the real process.stdin/stdout, so the terminal is faked on those objects:
// a test run has no TTY, and resume() is stubbed so the real stdin never starts reading.
describe("interactive prompts on the terminal", () => {
  type Stubbed = "isTTY" | "setRawMode" | "resume" | "pause";
  const stubbedKeys: Stubbed[] = ["isTTY", "setRawMode", "resume", "pause"];
  const stdin = process.stdin as unknown as Record<Stubbed, unknown> & NodeJS.ReadStream;
  let saved: Map<Stubbed, PropertyDescriptor | undefined>;
  let rawModeCalls: boolean[];
  let written: string[];

  const fakeTerminal = () => {
    saved = new Map(stubbedKeys.map((k) => [k, Object.getOwnPropertyDescriptor(stdin, k)]));
    rawModeCalls = [];
    written = [];
    Object.defineProperty(stdin, "isTTY", { value: true, configurable: true, writable: true });
    Object.defineProperty(stdin, "setRawMode", {
      value: (mode: boolean) => {
        rawModeCalls.push(mode);
        return stdin;
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(stdin, "resume", { value: () => stdin, configurable: true, writable: true });
    Object.defineProperty(stdin, "pause", { value: () => stdin, configurable: true, writable: true });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  };

  let savedColumns: PropertyDescriptor | undefined;
  const stubColumns = (columns: number | undefined) => {
    savedColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true, writable: true });
  };

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedColumns) Object.defineProperty(process.stdout, "columns", savedColumns);
    else delete (process.stdout as { columns?: number }).columns;
    savedColumns = undefined;
    for (const [k, desc] of saved) {
      if (desc) Object.defineProperty(stdin, k, desc);
      else delete stdin[k];
    }
  });

  const press = (name: string, ctrl = false) => stdin.emit("keypress", "", ctrl ? { name, ctrl } : { name });
  const keypressListeners = () => stdin.listenerCount("keypress");
  const endListeners = () => stdin.listenerCount("end");

  const choices: Choice[] = [{ label: "global" }, { label: "project" }, { label: "workspace" }];

  it("resolves to the row chosen with down then return and restores the terminal", async () => {
    fakeTerminal();
    const before = { key: keypressListeners(), end: endListeners() };
    const answer = selectChoice("Where?", choices, 0);
    press("down");
    press("return");
    await expect(answer).resolves.toBe(1);
    expect(rawModeCalls).toEqual([true, false]);
    expect(written.at(-1)).toBe("\x1b[?25h");
    expect(written.join("")).toContain("Where?");
    expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
  });

  it("prints a yellow hint with the reason on return over an unavailable row and stays open", async () => {
    fakeTerminal();
    const scopes: Choice[] = [
      { label: "global" },
      { label: "project", unavailable: "no .works/ — run kf init" },
    ];
    const hint = "\x1b[33mproject is unavailable: no .works/ — run kf init\x1b[0m";
    const answer = selectChoice("Which scope?", scopes, 0);
    press("down");
    expect(written.join("")).not.toContain("is unavailable");
    press("return");
    expect(written.at(-1)).toContain(hint);
    expect(rawModeCalls).toEqual([true]);
    press("up");
    expect(written.at(-1)).not.toContain("is unavailable");
    press("return");
    await expect(answer).resolves.toBe(0);
    expect(rawModeCalls).toEqual([true, false]);
  });

  it("rejects with PromptAbort on ctrl+c and turns raw mode off", async () => {
    fakeTerminal();
    const answer = selectChoice("Where?", choices, 0);
    press("c", true);
    await expect(answer).rejects.toBeInstanceOf(PromptAbort);
    expect(rawModeCalls).toEqual([true, false]);
    expect(written.at(-1)).toBe("\x1b[?25h");
  });

  it("rejects with PromptAbort when the input stream ends and turns raw mode off", async () => {
    fakeTerminal();
    const answer = selectChoice("Where?", choices, 0);
    stdin.emit("end");
    await expect(answer).rejects.toBeInstanceOf(PromptAbort);
    expect(rawModeCalls).toEqual([true, false]);
    expect(written.at(-1)).toBe("\x1b[?25h");
  });

  it("shows the hint on an empty return, then resolves to the rows toggled with space", async () => {
    fakeTerminal();
    const answer = selectMany("Which?", ["alpha", "beta", "gamma"], new Set(), "Select at least one");
    press("return");
    expect(written.join("")).toContain("Select at least one");
    expect(rawModeCalls).toEqual([true]);
    press("down");
    press("space");
    press("down");
    press("space");
    press("return");
    await expect(answer).resolves.toEqual([1, 2]);
    expect(rawModeCalls).toEqual([true, false]);
    expect(written.at(-1)).toBe("\x1b[?25h");
  });

  it("rejects the multi-select with PromptAbort when the input stream ends and restores the terminal", async () => {
    fakeTerminal();
    const before = { key: keypressListeners(), end: endListeners() };
    const answer = selectMany("Which?", ["alpha", "beta"], new Set([0]), "Select at least one");
    stdin.emit("end");
    await expect(answer).rejects.toBeInstanceOf(PromptAbort);
    expect(rawModeCalls).toEqual([true, false]);
    expect(written.at(-1)).toBe("\x1b[?25h");
    expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
  });

  it("moves the cursor up by the wrapped row count when redrawing", async () => {
    fakeTerminal();
    stubColumns(80);
    const wide: Choice[] = [
      { label: "global" },
      { label: "project" },
      { label: "workspace — Claude Code, only when started in " + "/long/path".repeat(10) },
    ];
    const answer = selectChoice("Which scope?", wide, 0);
    press("down");
    // question + 2 short rows + 1 wrapped row = 5 terminal rows
    expect(written.join("")).toContain("\x1b[5A\x1b[J");
    expect(written.join("")).not.toContain("\x1b[4A");
    press("return");
    await expect(answer).resolves.toBe(1);
  });

  it("moves the cursor up by the line count when the column count is unknown", async () => {
    fakeTerminal();
    stubColumns(undefined);
    const wide: Choice[] = [{ label: "global" }, { label: "project" }, { label: "w".repeat(120) }];
    const answer = selectChoice("Which scope?", wide, 0);
    press("down");
    expect(written.join("")).toContain("\x1b[4A\x1b[J");
    press("return");
    await expect(answer).resolves.toBe(1);
  });

  describe("withLoading", () => {
    const MESSAGE = "Checking the Claude Code plugin install…";
    const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const deferred = <T,>() => {
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    it("hides the cursor and writes the message with the first spinner frame", async () => {
      fakeTerminal();
      const work = deferred<string>();
      const result = withLoading(MESSAGE, () => work.promise);
      expect(rawModeCalls).toEqual([true]);
      expect(written).toContain("\x1b[?25l");
      expect(written).toContain(`\r\x1b[K⠋ ${MESSAGE}`);
      work.resolve("done");
      await result;
    });

    it("advances the spinner frame every 80 ms and wraps after the last frame", async () => {
      fakeTerminal();
      vi.useFakeTimers();
      try {
        const work = deferred<string>();
        const result = withLoading(MESSAGE, () => work.promise);
        for (let i = 1; i <= 10; i++) {
          vi.advanceTimersByTime(80);
          expect(written.at(-1)).toBe(`\r\x1b[K${FRAMES[i % 10]} ${MESSAGE}`);
        }
        work.resolve("done");
        await result;
      } finally {
        vi.useRealTimers();
      }
    });

    it("discards a non-abort key without output or effect and keeps waiting", async () => {
      fakeTerminal();
      const work = deferred<string>();
      const result = withLoading(MESSAGE, () => work.promise);
      const writesBefore = written.length;
      press("down");
      press("return");
      press("space");
      expect(written.length).toBe(writesBefore);
      expect(rawModeCalls).toEqual([true]);
      work.resolve("done");
      await expect(result).resolves.toBe("done");
    });

    it("resolves with the value of the work and restores the terminal", async () => {
      fakeTerminal();
      const before = { key: keypressListeners(), end: endListeners() };
      const work = deferred<number>();
      const result = withLoading(MESSAGE, () => work.promise);
      work.resolve(42);
      await expect(result).resolves.toBe(42);
      expect(rawModeCalls).toEqual([true, false]);
      expect(written.slice(-2)).toEqual(["\r\x1b[K", "\x1b[?25h"]);
      expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
    });

    it("rejects with the same error the work rejects with and restores the terminal", async () => {
      fakeTerminal();
      const before = { key: keypressListeners(), end: endListeners() };
      const failure = new Error("claude exploded");
      const result = withLoading(MESSAGE, () => Promise.reject(failure));
      await expect(result).rejects.toBe(failure);
      expect(rawModeCalls).toEqual([true, false]);
      expect(written.slice(-2)).toEqual(["\r\x1b[K", "\x1b[?25h"]);
      expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
    });

    it("stops the spinner timer once the work settles", async () => {
      fakeTerminal();
      vi.useFakeTimers();
      try {
        const work = deferred<string>();
        const result = withLoading(MESSAGE, () => work.promise);
        work.resolve("done");
        await result;
        const writesAfter = written.length;
        vi.advanceTimersByTime(1000);
        expect(written.length).toBe(writesAfter);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects with PromptAbort on ctrl+c and restores the terminal", async () => {
      fakeTerminal();
      const before = { key: keypressListeners(), end: endListeners() };
      const work = deferred<string>();
      const result = withLoading(MESSAGE, () => work.promise);
      press("c", true);
      await expect(result).rejects.toBeInstanceOf(PromptAbort);
      expect(rawModeCalls).toEqual([true, false]);
      expect(written.slice(-2)).toEqual(["\r\x1b[K", "\x1b[?25h"]);
      expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
      work.resolve("late");
    });

    it("rejects with PromptAbort on ctrl+d", async () => {
      fakeTerminal();
      const work = deferred<string>();
      const result = withLoading(MESSAGE, () => work.promise);
      press("d", true);
      await expect(result).rejects.toBeInstanceOf(PromptAbort);
      expect(rawModeCalls).toEqual([true, false]);
      work.resolve("late");
    });

    it("rejects with PromptAbort when the input stream ends and restores the terminal", async () => {
      fakeTerminal();
      const before = { key: keypressListeners(), end: endListeners() };
      const work = deferred<string>();
      const result = withLoading(MESSAGE, () => work.promise);
      stdin.emit("end");
      await expect(result).rejects.toBeInstanceOf(PromptAbort);
      expect(rawModeCalls).toEqual([true, false]);
      expect(written.at(-1)).toBe("\x1b[?25h");
      expect({ key: keypressListeners(), end: endListeners() }).toEqual(before);
      work.resolve("late");
    });

    it("ignores a later rejection of the work after an abort", async () => {
      fakeTerminal();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const work = deferred<string>();
        const result = withLoading(MESSAGE, () => work.promise);
        press("c", true);
        await expect(result).rejects.toBeInstanceOf(PromptAbort);
        work.reject(new Error("late failure"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(unhandled).toEqual([]);
        expect(rawModeCalls).toEqual([true, false]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });
});
