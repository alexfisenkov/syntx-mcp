import { basename, isAbsolute } from "node:path";
import type { OwnerActTwoUploadDestination } from "../adapter/syntx/owner-acttwo-image-context.js";

export function readOwnerActTwoFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_ACTTWO configuration.");
}

/** Disabled mode ignores unused values; enabled mode needs a trusted upload destination and ffprobe path. */
export function readOwnerActTwoOperatorConfiguration(enabled: boolean, destination: unknown, ffprobePath: unknown):
  Readonly<{ uploadDestination: OwnerActTwoUploadDestination; ffprobePath: string }> | undefined {
  if (enabled !== true && enabled !== false) throw new Error("Invalid SYNTX_OWNER_ACTTWO configuration.");
  if (!enabled) return undefined;
  if (destination !== "uploaded" && destination !== "hidden") throw new Error("Invalid SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION configuration.");
  if (typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath !== ffprobePath.trim() || ffprobePath.includes("\0") || basename(ffprobePath) === "") {
    throw new Error("Invalid SYNTX_OWNER_ACTTWO_FFPROBE_PATH configuration.");
  }
  return Object.freeze({ uploadDestination: destination, ffprobePath });
}
