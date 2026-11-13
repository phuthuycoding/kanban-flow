import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { buildLine } from "../workflow/next/record.js";
import { readLedgerState } from "../workflow/next/ledger-state.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const flow = () => read("assets", "skills", "flow", "SKILL.md");
const implement = () => read("assets", "skills", "implement", "SKILL.md");
const taskLoop = () => read("assets", "skills", "implement", "references", "task-loop.md");
const travel = () => read("assets", "skills", "travel", "SKILL.md");
const ledgerFormat = () => read("assets", "skills", "travel", "references", "ledger-format.md");

const paragraphWith = (text: string, phrase: string) => {
  const found = text.split(/\n\s*\n/).find((p) => p.includes(phrase));
  expect(found, phrase).toBeDefined();
  return found as string;
};
const paragraphStarting = (text: string, prefix: string) => {
  const found = text.split(/\n\s*\n/).find((p) => p.startsWith(prefix));
  expect(found, prefix).toBeDefined();
  return found as string;
};

const LANGUAGE_NOTE = "Note reply language: <language>";

describe("reply language survives compaction", () => {
  it("flow tells the controller to reply in the human's language while artifacts, ledger lines and briefs stay English", () => {
    const p = paragraphStarting(flow(), "**Reply language.**");
    expect(p).toContain("the language the human writes in");
    expect(p).toContain("stay English");
    expect(p).toContain(LANGUAGE_NOTE);
  });

  it("flow names the full kf record command that writes the language note", () => {
    const p = paragraphStarting(flow(), "**Reply language.**");
    expect(p).toContain("kf record {feature_name} line -- 'Note reply language: <language>'");
  });

  it("implement's resume step recovers the reply language from the ledger", () => {
    expect(paragraphStarting(implement(), "**Resume.**")).toContain(LANGUAGE_NOTE);
  });

  it("implement tells the controller to write the reply language note beside the scan line", () => {
    const p = paragraphStarting(implement(), "**Pre-Task-1 conflict scan.**");
    expect(p).toContain("kf record {feature_name} line -- 'Note reply language: <language>'");
  });

  it("the task loop compaction paragraph points at the reply language ledger line", () => {
    const p = paragraphWith(taskLoop(), "Conversation memory does not survive compaction");
    expect(p).toContain(LANGUAGE_NOTE);
  });

  it("the task loop lists the reply language note among the free ledger lines", () => {
    const text = taskLoop();
    const from = text.indexOf("The other lines carry the same suffix");
    expect(from).toBeGreaterThanOrEqual(0);
    const fence = text.slice(from).match(/```(?:text)?\n([\s\S]*?)```/);
    expect(fence, "a fenced block after the free-lines sentence").not.toBeNull();
    expect((fence as RegExpMatchArray)[1].split("\n")).toContain(`${LANGUAGE_NOTE} @ <ts>`);
  });

  it("travel's resume after compaction reads the language from the travel ledger", () => {
    const p = paragraphStarting(travel(), "**Resume after compaction.**");
    expect(p).toContain("keep replying to the human in the `language:` line of its last section until the human writes in another");
  });

  it("travel's open-the-day section template carries the language line so a new day keeps it", () => {
    const text = travel();
    const at = text.indexOf("session: <ISO time from the clock>");
    expect(at, "session line in the day section template").toBeGreaterThanOrEqual(0);
    const open = text.lastIndexOf("```", at);
    const close = text.indexOf("```", at);
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(at);
    expect(text.slice(open, close).split("\n")).toContain("language: <language>");
  });

  it("the travel ledger format documents a language line", () => {
    const text = ledgerFormat();
    const start = text.indexOf("\n## Language");
    expect(start, "## Language section").toBeGreaterThanOrEqual(0);
    const next = text.indexOf("\n## ", start + 1);
    const body = next === -1 ? text.slice(start) : text.slice(start, next);
    expect(body).toContain("`language: <language>`");
  });
});

describe("the ledger accepts a reply language note", () => {
  const header = "# Task loop ledger";

  it("kf record accepts the free line and the ledger reader does not refuse it", () => {
    const built = buildLine(header, { event: "line", args: ["Note reply language: Vietnamese"] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.line).toContain("Note reply language: Vietnamese");

    const read = readLedgerState(`${header}\nNote reply language: Vietnamese @ 2026-11-13T10:00:00+07:00\n`);
    expect(read.ok).toBe(true);
  });
});
