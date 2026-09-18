import { describe, it, expect } from "vitest";

import {
  STAGES,
  ARTIFACTS,
  STAGE_GATES,
  STAGE_INDEX,
  TRANSITIONS,
  type Stage,
} from "../workflow/schema.js";
import { splitFrontmatter, applyFrontmatter, hasUnresolvedPlaceholders, isFilledFile } from "../shared/frontmatter.js";
import { parseFolderName, featureFolderName } from "../workflow/features.js";
import { countTasks } from "../workflow/status.js";

describe("schema", () => {
  it("has workflow stages in pipeline order", () => {
    expect(STAGES).toEqual([
      "brainstorm",
      "planning",
      "backlog",
      "implementation",
      "testing",
      "review",
      "dones",
    ]);
  });

  it("has the 8 v2 artifacts", () => {
    expect(Object.keys(ARTIFACTS).sort()).toEqual([
      "feature-report",
      "implementation-plan",
      "review-report",
      "spec-requirement",
      "test-cases",
      "testing-result",
      "use-case-diagram",
      "use-case-specification",
    ]);
  });

  it("artifact files follow the phase-{x}- naming convention", () => {
    for (const def of Object.values(ARTIFACTS)) {
      expect(def.file).toMatch(/^phase-\d+-.+\.md$/);
      expect(def.template).toBe(def.file);
    }
  });

  it("phase gates require planning artifacts before autonomous phases", () => {
    expect(STAGE_GATES.brainstorm).toEqual(["spec-requirement"]);
    expect(STAGE_GATES.planning).toEqual([
      "implementation-plan",
      "use-case-specification",
      "use-case-diagram",
      "test-cases",
    ]);
    expect(STAGE_GATES.testing).toContain("testing-result");
    expect(STAGE_GATES.review).toContain("review-report");
  });

  it("transitions allow forward flow plus FAIL loops back to implementation", () => {
    expect(TRANSITIONS.brainstorm).toEqual(["planning"]);
    expect(TRANSITIONS.planning).toEqual(["implementation", "backlog"]);
    expect(TRANSITIONS.backlog).toEqual(["implementation", "planning"]);
    expect(TRANSITIONS.testing).toEqual(["review", "implementation", "planning"]);
    expect(TRANSITIONS.review).toEqual(["dones", "implementation", "planning"]);
    expect(TRANSITIONS.dones).toEqual([]);
  });

  it("stage indexes are monotonic", () => {
    const vals = STAGES.map((s) => STAGE_INDEX[s as Stage]);
    for (let i = 1; i < vals.length; i += 1) {
      expect(vals[i]).toBe(vals[i - 1] + 1);
    }
  });
});

describe("frontmatter", () => {
  it("parses a standard block", () => {
    const content = "---\nfeature: \"todo-list\"\ncontext: app\nstatus: brainstorm\n---\n# Body";
    const { fm, body } = splitFrontmatter(content);
    expect(fm).toEqual({ feature: "todo-list", context: "app", status: "brainstorm" });
    expect(body.trim()).toBe("# Body");
  });

  it("handles missing frontmatter", () => {
    const { fm, body } = splitFrontmatter("# No frontmatter");
    expect(fm).toEqual({});
    expect(body).toBe("# No frontmatter");
  });

  it("round-trips update of a status key", () => {
    const content = "---\nfeature: x\nstatus: brainstorm\n---\nbody";
    const { fm, body } = splitFrontmatter(content);
    fm.status = "archived";
    const out = applyFrontmatter(fm, body);
    expect(out).toContain("status: archived");
    expect(splitFrontmatter(out).fm.status).toBe("archived");
  });
});

describe("placeholders", () => {
  it("detects unresolved template tokens", () => {
    expect(hasUnresolvedPlaceholders("## User Story\nAs a {user_type}...")).toBe(true);
    expect(hasUnresolvedPlaceholders("## Goals\nReal content")).toBe(false);
  });

  it("isFilledFile rejects placeholder-only files", () => {
    expect(isFilledFile("---\nfm: yes\n---\nAs a {user_type} I want {goal}", "As a {user_type} I want {goal}")).toBe(false);
    expect(isFilledFile("---\nfm: yes\n---\nAs a user, I want milk", "As a user, I want milk")).toBe(true);
  });

  it("rejects frontmatter-only content and unresolved frontmatter values", () => {
    const raw = "---\nstatus: PASS\n---\n";
    expect(isFilledFile(raw, splitFrontmatter(raw).body)).toBe(false);
    expect(isFilledFile("---\nfeature: {feature_name}\n---\nReal body", "Real body")).toBe(false);
  });
});

describe("feature folders", () => {
  it("parses {feature}_{timestamp} folder names", () => {
    expect(parseFolderName("todo-list_20260916_1800")).toEqual({ name: "todo-list", ts: "20260916_1800" });
    expect(parseFolderName("plainname")).toEqual({ name: "plainname", ts: null });
  });

  it("builds folder names deterministically", () => {
    expect(featureFolderName("auth", "20260101_0900")).toBe("auth_20260101_0900");
  });
});

describe("tasks", () => {
  it("counts checked/unchecked boxes", () => {
    const md = "# Tasks\n- [ ] 1. a\n- [x] 2. b\n- [ ] 3. c";
    expect(countTasks(md)).toEqual({ done: 1, total: 3 });
  });

  it("ignores non-task bullets", () => {
    const md = "- just a note\n- [x] done";
    expect(countTasks(md)).toEqual({ done: 1, total: 1 });
  });
});
