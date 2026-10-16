import { isAbsolute, resolve } from "node:path";

/** Default-off operator configuration, never MCP tool arguments. */
export function readOwnerTopazEnhanceFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_TOPAZ_ENHANCE configuration.");
}

/** The trusted binary is checked by the probe; this parser performs no I/O. */
export function readOwnerTopazEnhanceOperatorConfiguration(enabled: boolean, ffprobePath: string | undefined,
  destination: string | undefined): Readonly<{ ffprobePath: string; destination: "uploaded" | "hidden" }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || ffprobePath !== ffprobePath.trim() ||
      ffprobePath.includes("\0") || !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath ||
      (destination !== "uploaded" && destination !== "hidden")) {
    throw new Error("Invalid SYNTX_OWNER_TOPAZ_ENHANCE operator configuration.");
  }
  return Object.freeze({ ffprobePath, destination });
}
