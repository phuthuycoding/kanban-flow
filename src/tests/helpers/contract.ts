import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ARTIFACTS } from "../../workflow/schema.js";

/**
 * Contract fixtures that satisfy the living-doc rules without naming a living doc. Tests that only
 * need an item to pass approve, the stage gates or the close use these, so a change to the docs
 * rules is absorbed in one place instead of in every fixture.
 */

/** The reason every fixture gives for touching no living doc. */
export const DOCS_NONE_REASON = "test fixture";

/** A `## Documentation Impact` section that records no living-doc change. */
export const DOCS_IMPACT_NONE = `## Documentation Impact\n\n- none — ${DOCS_NONE_REASON}\n`;

/** `plan` followed by a `## Documentation Impact` section with one bullet per entry. */
export function withDocsImpact(plan: string, entries: string[] = [`none — ${DOCS_NONE_REASON}`]): string {
  return `${plan.trimEnd()}\n\n## Documentation Impact\n\n${entries.map((e) => `- ${e}`).join("\n")}\n`;
}

/** Writes the item's implementation plan: `body` plus a Documentation Impact section holding `entries`. */
export async function writePlan(
  featureDir: string,
  body = "# Contract\nUC-001: Create a task",
  entries?: string[],
): Promise<void> {
  await writeFile(join(featureDir, ARTIFACTS["implementation-plan"].file), withDocsImpact(body, entries));
}

/** Review-report frontmatter lines (each ending in a newline) that waive the living-doc update with a reason. */
export const REVIEW_DOCS_NONE = `docs: none\ndocs_reason: ${DOCS_NONE_REASON}\n`;
