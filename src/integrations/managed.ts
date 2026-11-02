/** Skills the package ships, by their bare name inside the kf plugin (`skills/<name>`). */
export const MANAGED_SKILLS = ["flow", "brainstorm", "plan", "implement", "test", "review", "archive", "bug", "travel"];

/** Subagent definitions the phase skills dispatch by name; installed only for runtimes with an agent registry. */
export const MANAGED_AGENTS = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer"];

/** The names earlier releases installed the skills under, before the kf plugin. */
export const LEGACY_SKILLS = [
  "kanban-flow",
  "kanban-brainstorm",
  "kanban-plan",
  "kanban-implement",
  "kanban-test",
  "kanban-review",
  "kanban-archive",
  "kanban-bug",
];

/**
 * The entry name a managed skill is copied or linked under in a runtime's skills dir. Still the
 * legacy kanban-* name: a bare name such as `test` or `plan` may well be the user's own skill.
 */
export function copyName(name: string): string {
  return name === "travel" ? "travel" : `kanban-${name}`;
}
