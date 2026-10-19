import type { OwnerHailuoInitialUploadDestination } from "../application/owner-hailuo-initial-image-vault.js";

/** Independent, default-off flag; enabling another video family does not enable Hailuo. */
export function readOwnerHailuoInitialFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAILUO_INITIAL configuration.");
}
export function readOwnerHailuoInitialOperatorConfiguration(enabled: boolean, destination: unknown):
  Readonly<{ uploadDestination: OwnerHailuoInitialUploadDestination }> | undefined {
  if (!enabled) return undefined;
  if (destination !== "uploaded" && destination !== "hidden") throw new Error("Invalid SYNTX_OWNER_HAILUO_INITIAL_UPLOAD_DESTINATION configuration.");
  return Object.freeze({ uploadDestination: destination });
}
