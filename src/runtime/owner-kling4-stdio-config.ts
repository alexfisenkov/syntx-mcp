import { isAbsolute, resolve } from "node:path";

/** Independent owner stdio group; no opt-in is inferred from other Kling flags. */
export function readOwnerKling4Flag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_KLING4 configuration.");
}

/** Operator-only probe/cap configuration, never accepted from an MCP call. */
export function readOwnerKling4OperatorConfiguration(enabled: boolean, ffprobePath: unknown, maxVideoFileBytes: unknown):
  Readonly<{ ffprobePath: string; maxVideoFileBytes: number }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || !ffprobePath || ffprobePath !== ffprobePath.trim() || ffprobePath.includes("\0") ||
      !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath) invalid();
  let cap = 64 * 1024 * 1024;
  if (maxVideoFileBytes !== undefined) {
    if (typeof maxVideoFileBytes !== "string" || !/^[1-9][0-9]*$/u.test(maxVideoFileBytes) || maxVideoFileBytes.length > 10) invalid();
    cap = Number(maxVideoFileBytes);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 300 * 1024 * 1024) invalid();
  }
  return Object.freeze({ ffprobePath, maxVideoFileBytes: cap });
}
function invalid(): never { throw new Error("Invalid SYNTX_OWNER_KLING4 operator configuration."); }
