import { isAbsolute, resolve } from "node:path";

/** Independent owner stdio opt-in; no other Seedance flag enables Editor tools. */
export function readOwnerSeedanceEditorFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_SEEDANCE_EDITOR configuration.");
}

/** Operator-only local ffprobe and file-size settings, never accepted from MCP input. */
export function readOwnerSeedanceEditorOperatorConfiguration(enabled: boolean, ffprobePath: unknown,
  maxVideoFileBytes: unknown): Readonly<{ ffprobePath: string; maxVideoFileBytes: number }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || !ffprobePath || ffprobePath !== ffprobePath.trim() ||
      ffprobePath.includes("\0") || !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath) invalid();
  let cap = 64 * 1024 * 1024;
  if (maxVideoFileBytes !== undefined) {
    if (typeof maxVideoFileBytes !== "string" || !/^[1-9][0-9]*$/u.test(maxVideoFileBytes) || maxVideoFileBytes.length > 10) invalid();
    cap = Number(maxVideoFileBytes);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 100 * 1024 * 1024) invalid();
  }
  return Object.freeze({ ffprobePath, maxVideoFileBytes: cap });
}

function invalid(): never { throw new Error("Invalid SYNTX_OWNER_SEEDANCE_EDITOR operator configuration."); }
