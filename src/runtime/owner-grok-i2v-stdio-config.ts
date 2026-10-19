import type { OwnerGrokI2vUploadDestination } from "../adapter/syntx/owner-grok-i2v-upload-context.js";

/** Independent owner-stdio opt-in; Grok T2V/V2V flags do not enable I2V tools. */
export function readOwnerGrokI2vFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_GROK_I2V configuration.");
}

/** Requires an explicit operator-selected destination when the feature is enabled. */
export function readOwnerGrokI2vOperatorConfiguration(
  enabled: boolean,
  uploadDestination: unknown
): Readonly<{ uploadDestination: OwnerGrokI2vUploadDestination }> | undefined {
  if (!enabled) return undefined;
  if (uploadDestination !== "uploaded" && uploadDestination !== "hidden") {
    throw new Error("Invalid SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION configuration.");
  }
  return Object.freeze({ uploadDestination });
}
