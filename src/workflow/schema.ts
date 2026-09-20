export const STAGES = [
  "brainstorm",
  "planning",
  "backlog",
  "implementation",
  "testing",
  "review",
  "dones",
  "cancelled",
] as const;
export type Stage = (typeof STAGES)[number];

export type WorkItemKind = "feature" | "bug";

export const ARTIFACT_IDS = [
  "spec-requirement",
  "implementation-plan",
  "use-case-specification",
  "use-case-diagram",
  "test-cases",
  "testing-result",
  "review-report",
  "feature-report",
] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

/** Artifacts that belong to the full feature planning/closure contract only. */
export const FEATURE_ONLY_ARTIFACTS: ArtifactId[] = [
  "implementation-plan",
  "use-case-specification",
  "use-case-diagram",
  "test-cases",
  "feature-report",
];

export type ArtifactPhase = "brainstorm" | "plan" | "test" | "review" | "artifact";

export interface ArtifactDef {
  id: ArtifactId;
  file: string;
  /** Flattened template basename used for `kf instruct` and resolution. */
  template: string;
  /** Pipeline step in which the artifact is normally authored. */
  phase: ArtifactPhase;
  /** Earliest stage index where this artifact is DUE (must exist & be filled). */
  dueFromStage: number;
  /** What completing this artifact unlocks. */
  unlocks: string;
}

export const ARTIFACTS: Record<ArtifactId, ArtifactDef> = {
  "spec-requirement": {
    id: "spec-requirement",
    file: "phase-1-spec-requirement.md",
    template: "phase-1-spec-requirement.md",
    phase: "brainstorm",
    dueFromStage: 0,
    unlocks: "Phase 1 done — precise requirement agreed with the human",
  },
  "implementation-plan": {
    id: "implementation-plan",
    file: "phase-2-implementation-plan.md",
    template: "phase-2-implementation-plan.md",
    phase: "plan",
    dueFromStage: 1,
    unlocks: "Execution contract — scope, tasks, impact, DoD",
  },
  "use-case-specification": {
    id: "use-case-specification",
    file: "phase-2-use-case-specification.md",
    template: "phase-2-use-case-specification.md",
    phase: "plan",
    dueFromStage: 1,
    unlocks: "Detailed use case contracts (UC-XXX) for tests and implementation",
  },
  "use-case-diagram": {
    id: "use-case-diagram",
    file: "phase-2-use-case-diagram.md",
    template: "phase-2-use-case-diagram.md",
    phase: "plan",
    dueFromStage: 1,
    unlocks: "Visual overview of actors and use cases",
  },
  "test-cases": {
    id: "test-cases",
    file: "phase-2-test-case.md",
    template: "phase-2-test-case.md",
    phase: "plan",
    dueFromStage: 1,
    unlocks: "Traceable tests (TC-XXX → FR-XXX/UC-XXX) driving implementation and testing",
  },
  "testing-result": {
    id: "testing-result",
    file: "phase-4-testing-result.md",
    template: "phase-4-testing-result.md",
    phase: "test",
    dueFromStage: 4,
    unlocks: "Phase 4 done — PASS gates testing → review; FAIL/REJECT loops back to implementation",
  },
  "review-report": {
    id: "review-report",
    file: "phase-5-review-report.md",
    template: "phase-5-review-report.md",
    phase: "review",
    dueFromStage: 5,
    unlocks: "Phase 5 done — review result gates review → dones",
  },
  "feature-report": {
    id: "feature-report",
    file: "phase-6-feature-report.md",
    template: "phase-6-feature-report.md",
    phase: "artifact",
    dueFromStage: 6,
    unlocks: "Phase 6 — overall Feature Report completes the feature",
  },
};

/**
 * Transition gate: artifacts that must exist & be filled to LEAVE the stage
 * (i.e. to advance to the next stage).
 */
export const STAGE_GATES: Record<Stage, ArtifactId[]> = {
  brainstorm: ["spec-requirement"],
  planning: ["implementation-plan", "use-case-specification", "use-case-diagram", "test-cases"],
  backlog: [],
  implementation: [],
  testing: ["testing-result"],
  review: ["review-report"],
  dones: [],
  cancelled: [],
};

/**
 * Allowed transitions between stages.
 * Forward: one step at a time. Backtrack (loop) edges per the workflow:
 * a FAIL/REJECT testing/review result sends the feature back to implementation.
 */
export const TRANSITIONS: Record<Stage, Stage[]> = {
  brainstorm: ["planning"],
  planning: ["implementation", "backlog"],
  backlog: ["implementation", "planning"],
  implementation: ["testing", "planning"],
  testing: ["review", "implementation", "planning"],
  review: ["dones", "implementation", "planning"],
  dones: [],
  // Entered through `kf cancel`, left only back to the stage it was cancelled from.
  cancelled: [],
};

export const STAGE_INDEX: Record<Stage, number> = {
  brainstorm: 0,
  planning: 1,
  backlog: 2,
  implementation: 3,
  testing: 4,
  review: 5,
  dones: 6,
  /** Off the linear track on purpose: a negative index turns every "is this artifact due yet"
   *  and "past planning" comparison false, so a cancelled item is never asked for anything. */
  cancelled: -1,
};

/** Name used by `kf status` for the current phase. */
export const PHASE_NAMES: Record<Stage, string> = {
  brainstorm: "Phase 1 — Brainstorming",
  planning: "Phase 2 — Planning",
  backlog: "Backlog — Awaiting a decision to start",
  implementation: "Phase 3 — Implement",
  testing: "Phase 4 — Testing",
  review: "Phase 5 — Review",
  dones: "Phase 6 — Artifact",
  cancelled: "Cancelled — stopped for good",
};

export const METADATA_FILE = ".kfw.json";

/** Approval status recorded in feature metadata (Human-in-the-Loop gate, Phase 2). */
export type ApprovalStatus = "pending" | "approved";
