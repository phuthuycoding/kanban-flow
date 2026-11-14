import { emitKeypressEvents } from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export type Key = { name: string; ctrl?: boolean; sequence?: string };

/** Rejected by the prompts on Ctrl+C or EOF so callers can report "nothing was changed". */
export class PromptAbort extends Error {
  constructor(message = "Prompt aborted") {
    super(message);
    this.name = "PromptAbort";
  }
}

export type Choice = { label: string; unavailable?: string };
export type SelectState = { cursor: number; done: boolean; abort: boolean; hint?: string };
export type ManyState = {
  cursor: number;
  selected: ReadonlySet<number>;
  done: boolean;
  hint: boolean;
  abort: boolean;
};

const isAbortKey = (key: Key): boolean => !!key.ctrl && (key.name === "c" || key.name === "d");

const isDigitRow = (key: Key, count: number): boolean =>
  /^[1-9]$/.test(key.name) && Number(key.name) <= count;

export function selectReducer(state: SelectState, key: Key, choices: readonly Choice[]): SelectState {
  const n = choices.length;
  if (isAbortKey(key)) return { ...state, abort: true };
  if (key.name === "up") return { ...state, cursor: (state.cursor - 1 + n) % n, hint: undefined };
  if (key.name === "down") return { ...state, cursor: (state.cursor + 1) % n, hint: undefined };
  if (isDigitRow(key, n)) return { ...state, cursor: Number(key.name) - 1, hint: undefined };
  if (key.name === "return") {
    const choice = choices[state.cursor];
    if (choice?.unavailable) {
      return { ...state, done: false, hint: `${choice.label} is unavailable: ${choice.unavailable}` };
    }
    return { ...state, done: true };
  }
  return { ...state };
}

export function manyReducer(state: ManyState, key: Key, count: number): ManyState {
  if (isAbortKey(key)) return { ...state, selected: new Set(state.selected), abort: true };
  if (key.name === "up") return { ...state, selected: new Set(state.selected), cursor: (state.cursor - 1 + count) % count };
  if (key.name === "down") return { ...state, selected: new Set(state.selected), cursor: (state.cursor + 1) % count };
  if (isDigitRow(key, count)) return { ...state, selected: new Set(state.selected), cursor: Number(key.name) - 1 };
  if (key.name === "space") {
    const selected = new Set(state.selected);
    if (selected.has(state.cursor)) selected.delete(state.cursor);
    else selected.add(state.cursor);
    return { ...state, selected, hint: false };
  }
  if (key.name === "return") {
    const selected = new Set(state.selected);
    return selected.size > 0 ? { ...state, selected, done: true, hint: false } : { ...state, selected, done: false, hint: true };
  }
  return { ...state, selected: new Set(state.selected) };
}

/** Terminal rows the lines occupy: ANSI escapes are stripped and long lines wrap at `columns`. */
export function terminalRows(lines: readonly string[], columns: number | undefined): number {
  const wraps = typeof columns === "number" && columns > 0;
  return lines.reduce((sum, line) => {
    if (!wraps) return sum + 1;
    const width = [...line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")].length;
    return sum + Math.max(1, Math.ceil(width / columns));
  }, 0);
}

/**
 * Drives a raw-mode keypress loop: `step` folds each key into the state, `render` returns the
 * lines to draw. Raw mode, the listeners and the cursor are restored on every exit path.
 */
function runPrompt<S extends { done: boolean; abort: boolean }>(
  initial: S,
  step: (state: S, key: Key) => S,
  render: (state: S) => string[],
): Promise<S> {
  return new Promise<S>((resolveP, reject) => {
    let state = initial;
    let drawn = 0;
    const draw = () => {
      if (drawn > 0) output.write(`\x1b[${drawn}A\x1b[J`);
      const lines = render(state);
      output.write(`${lines.join("\n")}\n`);
      drawn = terminalRows(lines, output.columns);
    };
    const cleanup = () => {
      try {
        input.setRawMode(false);
      } finally {
        input.off("keypress", onKey);
        input.off("end", onEnd);
        input.pause();
        output.write("\x1b[?25h");
      }
    };
    const finish = (fn: () => void) => {
      try {
        cleanup();
      } catch (err) {
        reject(err);
        return;
      }
      fn();
    };
    const onEnd = () => finish(() => reject(new PromptAbort("Input closed")));
    const onKey = (_s: string, key: Key | undefined) => {
      if (!key) return;
      state = step(state, key);
      if (state.abort) return finish(() => reject(new PromptAbort("Ctrl+C")));
      if (state.done) return finish(() => resolveP(state));
      draw();
    };
    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      input.on("keypress", onKey);
      input.on("end", onEnd);
      output.write("\x1b[?25l");
      draw();
    } catch (err) {
      try {
        cleanup();
      } finally {
        reject(err);
      }
    }
  });
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Shows a spinner while `work` runs; keys typed meanwhile are discarded, Ctrl+C / Ctrl+D / closed input abort.
 * An abort also aborts the signal handed to `work`, so it can stop what keeps the process alive (a child process).
 */
export async function withLoading<T>(message: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolveP, reject) => {
    let frame = 0;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;
    const cleanup = () => {
      if (timer) clearInterval(timer);
      try {
        output.write("\r\x1b[K");
        input.setRawMode(false);
      } finally {
        input.off("keypress", onKey);
        input.off("end", onEnd);
        input.pause();
        output.write("\x1b[?25h");
      }
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        cleanup();
      } catch (err) {
        reject(err);
        return;
      }
      fn();
    };
    const abort = (reason: string) =>
      finish(() => {
        controller.abort();
        reject(new PromptAbort(reason));
      });
    const onEnd = () => abort("Input closed");
    const onKey = (_s: string, key: Key | undefined) => {
      if (key && isAbortKey(key)) abort("Ctrl+C");
    };
    // A wrapped spinner line could not be cleared with \r, so it is cut to the terminal width.
    const line = (i: number) => {
      const text = `${SPINNER_FRAMES[i]} ${message}`;
      const columns = output.columns;
      return columns > 1 ? [...text].slice(0, columns - 1).join("") : text;
    };
    try {
      emitKeypressEvents(input);
      input.setRawMode(true);
      input.resume();
      input.on("keypress", onKey);
      input.on("end", onEnd);
      output.write("\x1b[?25l");
      output.write(`\r\x1b[K${line(0)}`);
      timer = setInterval(() => {
        frame = (frame + 1) % SPINNER_FRAMES.length;
        output.write(`\r\x1b[K${line(frame)}`);
      }, 80);
    } catch (err) {
      settled = true;
      try {
        cleanup();
      } finally {
        reject(err);
      }
      return;
    }
    let running: Promise<T>;
    try {
      running = work(controller.signal);
    } catch (err) {
      finish(() => reject(err));
      return;
    }
    running.then(
      (value) => finish(() => resolveP(value)),
      (err) => finish(() => reject(err)),
    );
  });
}

/** Single select; unavailable rows are drawn dimmed with their reason and cannot be accepted. */
export async function selectChoice(
  question: string,
  choices: readonly Choice[],
  initial: number,
): Promise<number> {
  const final = await runPrompt<SelectState>(
    { cursor: initial, done: false, abort: false },
    (s, k) => selectReducer(s, k, choices),
    (s) => [
      question,
      ...choices.map((c, i) => {
        const text = c.unavailable ? `\x1b[2m${c.label} (${c.unavailable})\x1b[0m` : c.label;
        return ` ${i === s.cursor ? "❯" : " "} ${text}`;
      }),
      ...(s.hint ? [`\x1b[33m${s.hint}\x1b[0m`] : []),
    ],
  );
  return final.cursor;
}

/** Multi-select; returns the accepted indices in ascending order. */
export async function selectMany(
  question: string,
  options: readonly string[],
  initial: ReadonlySet<number>,
  emptyHint: string,
): Promise<number[]> {
  const final = await runPrompt<ManyState>(
    { cursor: 0, selected: new Set(initial), done: false, hint: false, abort: false },
    (s, k) => manyReducer(s, k, options.length),
    (s) => [
      question,
      ...options.map((o, i) => ` ${i === s.cursor ? "❯" : " "} [${s.selected.has(i) ? "x" : " "}] ${o}`),
      ...(s.hint ? [`\x1b[33m${emptyHint}\x1b[0m`] : []),
    ],
  );
  return [...final.selected].sort((a, b) => a - b);
}
