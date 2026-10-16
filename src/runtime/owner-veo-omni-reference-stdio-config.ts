import { isAbsolute, resolve } from "node:path";

/** A separate, exact default-off owner stdio group. */
export function readOwnerVeoOmniReferenceFlag(value: unknown): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_VEO_OMNI_REFERENCES configuration.");
}

/** Trusted operator data, never model-callable settings. Binary trust is checked by the validator. */
export function readOwnerVeoOmniReferenceOperatorConfiguration(enabled: boolean, ffprobePath: unknown, maxFileBytes: unknown):
  Readonly<{ ffprobePath: string; maxFileBytes: number }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || !ffprobePath || ffprobePath !== ffprobePath.trim() || ffprobePath.includes("\0") ||
      !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath) invalid();
  let cap = 67_108_864;
  if (maxFileBytes !== undefined) {
    if (typeof maxFileBytes !== "string" || !/^[1-9][0-9]*$/u.test(maxFileBytes) || maxFileBytes.length > 10) invalid();
    cap = Number(maxFileBytes);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1_048_576_000) invalid();
  }
  return Object.freeze({ ffprobePath, maxFileBytes: cap });
}

function invalid(): never { throw new Error("Invalid SYNTX_OWNER_VEO_OMNI_REFERENCES operator configuration."); }
