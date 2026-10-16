import { isAbsolute, resolve } from "node:path";

/** Strict default-off gate for the owner Grok V2V tools. */
export function readOwnerGrokV2vFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_GROK_V2V configuration.");
}

/** Trusted operator configuration; the ffprobe path and destination are never tool inputs. */
export function readOwnerGrokV2vOperatorConfiguration(
  enabled: boolean, ffprobePath: unknown, destination: unknown
): Readonly<{ ffprobePath: string; destination: "uploaded" | "hidden" }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || ffprobePath !== ffprobePath.trim() ||
      ffprobePath.includes("\0") || !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath ||
      (destination !== "uploaded" && destination !== "hidden")) {
    throw new Error("Invalid SYNTX_OWNER_GROK_V2V operator configuration.");
  }
  return Object.freeze({ ffprobePath, destination });
}
