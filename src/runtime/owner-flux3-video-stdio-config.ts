import { isAbsolute, resolve } from "node:path";

/** Strict default-off gate for the owner Flux3 I2V/V2V tools. */
export function readOwnerFlux3VideoFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_FLUX3_VIDEOS configuration.");
}

/** Trusted local operator configuration; the path and destination are never tool inputs. */
export function readOwnerFlux3VideoOperatorConfiguration(
  enabled: boolean,
  ffprobePath: string | undefined,
  destination: string | undefined
): Readonly<{ ffprobePath: string; destination: "uploaded" | "hidden" }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || ffprobePath !== ffprobePath.trim() ||
      ffprobePath.includes("\0") || !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath ||
      (destination !== "uploaded" && destination !== "hidden")) {
    throw new Error("Invalid SYNTX_OWNER_FLUX3 operator configuration.");
  }
  return Object.freeze({ ffprobePath, destination });
}
