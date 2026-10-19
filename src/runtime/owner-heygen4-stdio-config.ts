import { isAbsolute, resolve } from "node:path";
/** Returns no configuration while disabled; enabled mode requires one clean absolute ffprobe path. */
export function readOwnerHeygen4OperatorConfiguration(enabled: boolean, ffprobePath: unknown): Readonly<{ ffprobePath: string }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || !ffprobePath || ffprobePath !== ffprobePath.trim() || ffprobePath.length > 1_024 ||
      /[\u0000-\u001f\u007f]/u.test(ffprobePath) || !isAbsolute(ffprobePath) || resolve(ffprobePath) !== ffprobePath) {
    throw new Error("OWNER_HEYGEN4_OPERATOR_CONFIGURATION_INVALID");
  }
  return Object.freeze({ ffprobePath });
}
