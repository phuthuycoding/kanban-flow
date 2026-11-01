import { describe, it, expect } from "vitest";

import { validateFeature } from "../workflow/validate.js";

describe("validateFeature", () => {
  it("declares only the feature, strict and requireApproval parameters", () => {
    // Function.length stops at the first defaulted parameter, so the declared list is read from the source text.
    const source = validateFeature.toString();
    const list = source.slice(source.indexOf("(") + 1, source.indexOf(")"));
    const names = list.split(",").map((p) => p.split("=")[0].replace(/[?\s]/g, "")).filter((p) => p !== "");
    expect(names).toEqual(["feature", "strict", "requireApproval"]);
  });
});
