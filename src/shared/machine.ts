import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolved on every call: the per-test HOME must win over the HOME the process started with. */
export function machineIdPath(): string {
  return join(homedir(), ".kf", "machine-id");
}

function readId(path: string): string | null {
  const text = readFileSync(path, "utf8").trim();
  return UUID.test(text) ? text : null;
}

/**
 * A random id for this machine, created once and kept under ~/.kf. It tells records written here from
 * records written elsewhere without naming the host. "unknown" when it cannot be read or created.
 */
export function machineId(): string {
  const path = machineIdPath();
  try {
    try {
      return readId(path) ?? "unknown";
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "ENOENT")) return "unknown";
    }
    const id = randomUUID();
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, `${id}\n`, { flag: "wx", mode: 0o600 });
      return id;
    } catch (err) {
      // Another process created it between the read and the write: its id is the machine's.
      if (err instanceof Error && "code" in err && err.code === "EEXIST") return readId(path) ?? "unknown";
      return "unknown";
    }
  } catch {
    return "unknown";
  }
}
