import { updateFeatureMeta } from "../../workflow/features.js";

/**
 * Record a stage-verify waiver on item `name`, so a fixture without `harness.verify.stage` can move testing → review.
 * Written straight to the item's metadata: fixtures that only need to pass the review gate do not run `kf verify`.
 */
export async function grantStageWaiver(root: string, name: string): Promise<void> {
  await updateFeatureMeta(root, name, (meta) => ({
    ...meta,
    verifyWaiver: { reason: "fixture without a stage suite", at: new Date().toISOString(), by: "test" },
  }));
}
