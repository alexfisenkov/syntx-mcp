/** Strict default-off gate for owner Hailuo-02 I2V runtime. */
export function readOwnerHailuo02I2vFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAILUO02_I2V configuration.");
}
