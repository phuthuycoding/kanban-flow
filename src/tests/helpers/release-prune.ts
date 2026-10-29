/** One-shot keep/delete selection for GitHub Releases + remote tags. Pure data; no process calls. */

export type Release = { tagName: string; publishedAt: string };

export type PrunePlan = {
  keep: string[];
  deleteReleases: string[];
  leftoverTags: string[];
  reason?: string;
};

const DEFAULT_KEEP = 5;

export function normalizeTag(raw: string): string {
  return raw.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function byNewest(a: Release, b: Release): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.tagName < b.tagName ? 1 : a.tagName > b.tagName ? -1 : 0;
}

export function selectPruneSets(
  releases: Release[],
  remoteTags: string[],
  keepCount = DEFAULT_KEEP,
): PrunePlan {
  const ranked = [...releases].map((r) => ({ ...r, tagName: normalizeTag(r.tagName) })).sort(byNewest);
  const tags = uniqueTags(remoteTags);

  if (ranked.length < keepCount) {
    return {
      keep: ranked.map((r) => r.tagName),
      deleteReleases: [],
      leftoverTags: [],
      reason: `fewer than ${keepCount} releases (${ranked.length}); no-op`,
    };
  }

  const keep = ranked.slice(0, keepCount).map((r) => r.tagName);
  const keepSet = new Set(keep);
  const deleteReleases = ranked.slice(keepCount).map((r) => r.tagName);
  const leftoverTags = tags.filter((t) => !keepSet.has(t));
  return { keep, deleteReleases, leftoverTags };
}

export function formatPruneDryRun(plan: PrunePlan): string {
  const lines = [
    "keep:",
    ...plan.keep.map((t) => `  ${t}`),
    "delete-releases:",
    ...(plan.deleteReleases.length ? plan.deleteReleases.map((t) => `  ${t}`) : ["  (none)"]),
    "leftover-tags:",
    ...(plan.leftoverTags.length ? plan.leftoverTags.map((t) => `  ${t}`) : ["  (none)"]),
  ];
  if (plan.reason) lines.push(`reason: ${plan.reason}`);
  return lines.join("\n");
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export function assertInventoryMatches(plan: PrunePlan, liveReleases: Release[], liveTags: string[]): void {
  const live = selectPruneSets(liveReleases, liveTags);
  if (
    sameSet(plan.keep, live.keep) &&
    sameSet(plan.deleteReleases, live.deleteReleases) &&
    sameSet(plan.leftoverTags, live.leftoverTags)
  ) {
    return;
  }
  throw new Error(
    `inventory mismatch: live keep=[${live.keep.join(",")}] vs plan keep=[${plan.keep.join(",")}]`,
  );
}
