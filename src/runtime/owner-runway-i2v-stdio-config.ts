/** Independent owner-stdio opt-in; no other Runway flag enables Gen4 I2V tools. */
export function readOwnerRunwayI2vFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_RUNWAY_I2V configuration.");
}
