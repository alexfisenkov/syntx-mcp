import type { OwnerHiggsfieldDopUploadDestination } from "../adapter/syntx/owner-higgsfield-dop-upload-context.js";

/** Independent owner-stdio opt-in; other video or media flags do not enable DOP tools. */
export function readOwnerHiggsfieldDopFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HIGGSFIELD_DOP configuration.");
}

/** Requires a trusted operator-selected upload destination only when the isolated feature is enabled. */
export function readOwnerHiggsfieldDopOperatorConfiguration(
  enabled: boolean,
  uploadDestination: unknown
): Readonly<{ uploadDestination: OwnerHiggsfieldDopUploadDestination }> | undefined {
  if (!enabled) return undefined;
  if (uploadDestination !== "uploaded" && uploadDestination !== "hidden") {
    throw new Error("Invalid SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION configuration.");
  }
  return Object.freeze({ uploadDestination });
}
