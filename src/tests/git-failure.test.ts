import { describe, expect, it } from "vitest";
import { isGitFailure } from "../shared/git.js";

describe("isGitFailure", () => {
  it("accepts the errors the git helpers throw", () => {
    expect(isGitFailure(new Error("git rev-parse failed (exit 128) in /tmp/x: fatal: not a git repository"))).toBe(true);
    expect(isGitFailure(new Error("Refusing unsafe ref: \"-x\""))).toBe(true);
  });

  it("rejects programming errors and other messages so they are rethrown", () => {
    expect(isGitFailure(new TypeError("git x is not a function"))).toBe(false);
    expect(isGitFailure(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isGitFailure("git failed")).toBe(false);
  });
});
