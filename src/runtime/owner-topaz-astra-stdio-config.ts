import { isAbsolute } from "node:path";

/** Strict default-off gate for local owner Topaz Astra tools. */
export function readOwnerTopazAstraFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_TOPAZ_ASTRA configuration.");
}

/** Trusted local Topaz upload settings; both values are mandatory when enabled. */
export function readOwnerTopazAstraOperatorConfiguration(enabled: boolean, ffprobePath: string | undefined,
  destination: string | undefined): Readonly<{ ffprobePath: string; destination: "uploaded" | "hidden" }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || !isAbsolute(ffprobePath) ||
      (destination !== "uploaded" && destination !== "hidden")) {
    throw new Error("Invalid SYNTX_OWNER_TOPAZ_ASTRA operator configuration.");
  }
  return Object.freeze({ ffprobePath, destination });
}
