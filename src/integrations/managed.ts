/** Skills the package ships, by their bare name inside the kf plugin (`skills/<name>`). */
export const MANAGED_SKILLS = ["flow", "brainstorm", "plan", "implement", "test", "review", "archive", "bug", "spike", "travel"];

/** Subagent definitions the phase skills dispatch by name; installed only for runtimes with an agent registry. */
export const MANAGED_AGENTS = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer", "researcher"];

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
 * The entry name a managed skill is copied under in a runtime's skills dir. Never the bare name:
 * a skill such as `test` or `plan` may well be the user's own.
 */
export function copyName(name: string): string {
  return `kf-${name}`;
}
