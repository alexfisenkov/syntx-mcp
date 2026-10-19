import { basename, isAbsolute } from "node:path";
import type { OwnerHappyHorseUploadDestination } from "../adapter/syntx/owner-happy-horse-image-context.js";

/** Independent opt-in for the HappyHorse family; disabled unless explicitly set to 1. */
export function readOwnerHappyHorseFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAPPY_HORSE configuration.");
}

/** Disabled mode requires no trusted settings; enabled mode needs destination and ffprobe for edit-video. */
export function readOwnerHappyHorseOperatorConfiguration(enabled: boolean, destination: unknown, ffprobePath: unknown):
  Readonly<{ uploadDestination: OwnerHappyHorseUploadDestination; ffprobePath: string }> | undefined {
  if (enabled !== true && enabled !== false) throw new Error("Invalid SYNTX_OWNER_HAPPY_HORSE configuration.");
  if (!enabled) return undefined;
  if (destination !== "uploaded" && destination !== "hidden") {
    throw new Error("Invalid SYNTX_OWNER_HAPPY_HORSE_UPLOAD_DESTINATION configuration.");
  }
  if (typeof ffprobePath !== "string" || !isAbsolute(ffprobePath) || ffprobePath !== ffprobePath.trim() ||
      ffprobePath.includes("\0") || basename(ffprobePath) === "") {
    throw new Error("Invalid SYNTX_OWNER_HAPPY_HORSE_FFPROBE_PATH configuration.");
  }
  return Object.freeze({ uploadDestination: destination, ffprobePath });
}
