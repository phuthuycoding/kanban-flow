export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") return false;
    if (err instanceof Error && "code" in err && err.code === "EPERM") return true;
    throw err;
  }
}
