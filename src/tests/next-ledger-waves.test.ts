import { describe, it, expect } from "vitest";

import { readLedgerState } from "../workflow/next/ledger-state.js";
import type { LedgerEvent, LedgerState } from "../workflow/next/types.js";

const HEADER = "# Task loop ledger — test";
const T = "2026-11-01T10:00:00Z";
const ledger = (...lines: string[]): string => [HEADER, "", ...lines].join("\n") + "\n";
const stamp = (body: string): string => `${body} @ ${T}`;

function stateOf(text: string): LedgerState {
  const read = readLedgerState(text);
  if (!read.ok) throw new Error(`expected a readable ledger, got repair lines ${JSON.stringify(read.repair)}`);
  return read.state;
}

function eventOf(body: string): LedgerEvent {
  const events = stateOf(ledger(stamp(body))).events;
  expect(events).toHaveLength(1);
  return events[0];
}

describe("wave ledger lines", () => {
  it("reads a wave verify start as a typed event carrying the wave", () => {
    expect(eventOf("wave 1: verify started")).toMatchObject({ type: "waveVerifyStarted", wave: 1 });
  });

  it("reads a wave verify done as a typed event carrying the wave and the exit", () => {
    expect(eventOf("wave 2: verify done exit=0")).toMatchObject({ type: "waveVerifyDone", wave: 2, exit: 0 });
    expect(eventOf("wave 3: verify done exit=1")).toMatchObject({ type: "waveVerifyDone", wave: 3, exit: 1 });
  });

  it("reads a wave reopen note as a reopened event from the wave with no execution", () => {
    const e = eventOf("Note TASK-002: reopened — wave 1");
    expect(e).toMatchObject({ type: "reopened", task: "TASK-002", source: "wave", wave: 1, execution: "" });
  });

  it("still reads a reopen from testing, review or ci with its execution", () => {
    expect(eventOf("Note TASK-002: reopened — review abcdef12")).toMatchObject({ type: "reopened", task: "TASK-002", source: "review", execution: "abcdef12" });
  });

  it("reads a wave decision note as a typed event carrying the wave and the text", () => {
    expect(eventOf("Note wave 1: decided — flaky")).toMatchObject({ type: "waveDecided", wave: 1, text: "flaky" });
  });

  it("reads a ledger holding all four new lines without refusing it and without an other event", () => {
    const text = ledger(
      stamp("wave 1: verify started"),
      stamp("wave 1: verify done exit=0"),
      stamp("Note TASK-002: reopened — wave 1"),
      stamp("Note wave 1: decided — flaky"),
    );
    const read = readLedgerState(text);
    expect(read.ok).toBe(true);
    const events = stateOf(text).events;
    expect(events.map((e) => e.type)).toEqual(["waveVerifyStarted", "waveVerifyDone", "reopened", "waveDecided"]);
    expect(events.some((e) => e.type === "other")).toBe(false);
  });
});
