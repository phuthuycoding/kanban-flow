import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { isPidAlive } from "./process.js";

export const LOCK_TIMEOUT_MS = 30_000;
const POLL_MS = 25;
/** A lock file that never received its pid (holder died between create and write) is stale after this long. */
const EMPTY_LOCK_GRACE_MS = 2_000;

export interface LockOptions {
  timeoutMs?: number;
}

/** Same-process callers queue here so the file lock is never re-entered by one pid. */
const chains = new Map<string, Promise<unknown>>();

export function lockPath(root: string, key: string): string {
  return join(root, ".works", ".locks", `${key}.lock`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(err: unknown): string | undefined {
  return err instanceof Error && "code" in err ? String(err.code) : undefined;
}

/**
 * Lives outside the item folder because stage/cancel rename that folder. Returns once this
 * process owns the file; a dead holder is taken over, a live one is waited on until the timeout.
 */
async function acquire(path: string, timeoutMs: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await writeFile(path, String(process.pid), { flag: "wx" });
      return;
    } catch (err) {
      if (errorCode(err) !== "EEXIST") throw err;
    }
    let holder = "";
    try {
      holder = (await readFile(path, "utf8")).trim();
    } catch (err) {
      if (errorCode(err) === "ENOENT") continue;
      throw err;
    }
    const pid = /^\d+$/.test(holder) ? Number(holder) : undefined;
    let stale = pid !== undefined && !isPidAlive(pid);
    if (pid === undefined) {
      const info = await stat(path).catch((err: unknown) => {
        if (errorCode(err) === "ENOENT") return null;
        throw err;
      });
      stale = info !== null && Date.now() - info.mtimeMs > EMPTY_LOCK_GRACE_MS;
    }
    if (stale) {
      // Rename, not unlink: if another process already replaced the dead holder's file, we
      // notice below that we moved a live lock and put it back instead of deleting it.
      const claimed = `${path}.${randomUUID()}.stale`;
      try {
        await rename(path, claimed);
      } catch (err) {
        if (errorCode(err) === "ENOENT") continue;
        throw err;
      }
      const moved = (await readFile(claimed, "utf8")).trim();
      if (moved === holder) {
        await rm(claimed, { force: true });
      } else {
        await writeFile(path, moved, { flag: "wx" }).catch((err: unknown) => {
          if (errorCode(err) !== "EEXIST") throw err;
        });
        await rm(claimed, { force: true });
      }
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for lock ${path} held by pid ${holder || "unknown"}.`);
    }
    await sleep(POLL_MS);
  }
}

/** Run `fn` while holding the lock for `key` (a work item name). Hold it only around re-read + write. */
export async function withLock<T>(root: string, key: string, fn: () => Promise<T>, opts: LockOptions = {}): Promise<T> {
  const path = lockPath(root, key);
  const previous = chains.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    await acquire(path, opts.timeoutMs ?? LOCK_TIMEOUT_MS);
    try {
      return await fn();
    } finally {
      await rm(path, { force: true });
    }
  });
  const tail = run.catch(() => undefined);
  chains.set(path, tail);
  try {
    return await run;
  } finally {
    if (chains.get(path) === tail) chains.delete(path);
  }
}
