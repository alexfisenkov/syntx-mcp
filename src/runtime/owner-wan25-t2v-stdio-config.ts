/** Independent owner-stdio opt-in; disabled unless explicitly set to 1. */
export function readOwnerWan25T2vFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_WAN25_T2V_PREVIEW configuration.");
}
