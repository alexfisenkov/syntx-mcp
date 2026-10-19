import { isAbsolute } from "node:path";

export function readOwnerKlingMediaFlag(value: unknown): boolean { return value === "1"; }

/** Explicit trusted local configuration; model uploads never infer this destination from MCP input. */
export function readOwnerKlingMediaOperatorConfiguration(enabled: boolean, destination: unknown, ffprobePath: unknown):
  Readonly<{ uploadDestination: "uploaded" | "hidden"; ffprobePath: string }> | undefined {
  if (!enabled) return undefined;
  if ((destination !== "uploaded" && destination !== "hidden") || typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) ||
      ffprobePath.length > 1_024 || /[\u0000-\u001f\u007f]/u.test(ffprobePath)) {
    throw new Error("OWNER_KLING_MEDIA_OPERATOR_CONFIGURATION_INVALID");
  }
  return Object.freeze({ uploadDestination: destination, ffprobePath });
}
