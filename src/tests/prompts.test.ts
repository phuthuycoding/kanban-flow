import { describe, it, expect, vi, afterEach } from "vitest";

import {
  manyReducer,
  PromptAbort,
  selectChoice,
  selectMany,
  selectReducer,
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

  afterEach(() => {
    vi.restoreAllMocks();
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
});
