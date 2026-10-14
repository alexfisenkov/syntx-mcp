import { types } from "node:util";

/** Local service phases only; these values do not describe upstream terminal state. */
export const OWNER_REVIEWED_VIDEO_RECOVERY_PHASES = [
  "POST_CALL_STARTED", "POST_ACK_KNOWN", "RECEIPT_RESULT_GET", "HISTORY_GET", "HISTORY_BINDING",
  "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT", "RECOVERY_GET"
] as const;

export const OWNER_REVIEWED_VIDEO_POST_DISPOSITIONS = [
  "NOT_REACHED", "MAY_HAVE_BEEN_SENT", "VALID_ECHO_OBSERVED"
] as const;

export const OWNER_REVIEWED_VIDEO_ACK_OBSERVATIONS = [
  "NOT_OBSERVED", "VALID_ECHO_OBSERVED", "INVALID_OR_MISSING_ECHO"
] as const;

export const OWNER_REVIEWED_VIDEO_HISTORY_OBSERVATIONS = [
  "NOT_READ", "READ_NO_UNIQUE_BINDING", "READ_UNIQUE_BINDING", "READ_UNVERIFIED"
] as const;

export const OWNER_REVIEWED_VIDEO_RESULT_BINDING_OBSERVATIONS = [
  "NOT_READ", "READ_NO_VERIFIED_ARTIFACT", "READ_VERIFIED_ARTIFACT", "READ_UNVERIFIED"
] as const;

export const OWNER_REVIEWED_VIDEO_NO_ARTIFACT_REASONS = [
  "NOT_APPLICABLE", "NOT_CAPTURED", "KNOWN_RECEIPT_HAS_NO_VERIFIED_ARTIFACT",
  "HISTORY_HAS_NO_UNIQUE_BINDING", "NO_IN_PROGRESS_BOT_MATCH", "RESULT_POLL_BUDGET_EXHAUSTED"
] as const;

export const OWNER_REVIEWED_VIDEO_SAFE_ERROR_CODES = ["OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"] as const;

export type OwnerReviewedVideoRecoveryDiagnosticInput = Readonly<{
  phase: typeof OWNER_REVIEWED_VIDEO_RECOVERY_PHASES[number];
  post_disposition: typeof OWNER_REVIEWED_VIDEO_POST_DISPOSITIONS[number];
  ack_observation: typeof OWNER_REVIEWED_VIDEO_ACK_OBSERVATIONS[number];
  history_observation: typeof OWNER_REVIEWED_VIDEO_HISTORY_OBSERVATIONS[number];
  result_binding_observation: typeof OWNER_REVIEWED_VIDEO_RESULT_BINDING_OBSERVATIONS[number];
  last_safe_error_code: typeof OWNER_REVIEWED_VIDEO_SAFE_ERROR_CODES[number] | null;
  no_artifact_reason: typeof OWNER_REVIEWED_VIDEO_NO_ARTIFACT_REASONS[number];
  poll_usage: Readonly<{
    history_get_calls: number;
    in_progress_get_calls: number;
    result_get_calls: number;
  }>;
}>;

export interface OwnerReviewedVideoRecoveryDiagnostic {
  readonly phase: OwnerReviewedVideoRecoveryDiagnosticInput["phase"];
  readonly post_disposition: OwnerReviewedVideoRecoveryDiagnosticInput["post_disposition"];
  readonly ack_observation: OwnerReviewedVideoRecoveryDiagnosticInput["ack_observation"];
  readonly history_observation: OwnerReviewedVideoRecoveryDiagnosticInput["history_observation"];
  readonly result_binding_observation: OwnerReviewedVideoRecoveryDiagnosticInput["result_binding_observation"];
  readonly last_safe_error_code: OwnerReviewedVideoRecoveryDiagnosticInput["last_safe_error_code"];
  readonly no_artifact_reason: OwnerReviewedVideoRecoveryDiagnosticInput["no_artifact_reason"];
  readonly poll_usage: Readonly<{
    history_get_calls: Readonly<{ count: number; capped: boolean }>;
    in_progress_get_calls: Readonly<{ count: number; capped: boolean }>;
    result_get_calls: Readonly<{ count: number; capped: boolean }>;
  }>;
}

const MAX_REPORTED_POLL_CALLS = 256;
const INVALID_DIAGNOSTIC = "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID";
const TOP_LEVEL_KEYS = Object.freeze([
  "phase", "post_disposition", "ack_observation", "history_observation", "result_binding_observation",
  "last_safe_error_code", "no_artifact_reason", "poll_usage"
] as const);
const POLL_USAGE_KEYS = Object.freeze(["history_get_calls", "in_progress_get_calls", "result_get_calls"] as const);

/**
 * Builds a closed, data-only observation. Inputs are internal snapshots, never
 * native response/error objects; no identifier, prompt, URL, or free-form text
 * is accepted or copied into the returned DTO.
 */
export function buildOwnerReviewedVideoRecoveryDiagnostic(
  input: OwnerReviewedVideoRecoveryDiagnosticInput | unknown
): OwnerReviewedVideoRecoveryDiagnostic {
  const record = readClosedRecord(input, TOP_LEVEL_KEYS);
  const pollUsage = readClosedRecord(record.poll_usage, POLL_USAGE_KEYS);
  const phase = readEnum(record.phase, OWNER_REVIEWED_VIDEO_RECOVERY_PHASES);
  const postDisposition = readEnum(record.post_disposition, OWNER_REVIEWED_VIDEO_POST_DISPOSITIONS);
  const ackObservation = readEnum(record.ack_observation, OWNER_REVIEWED_VIDEO_ACK_OBSERVATIONS);
  const historyObservation = readEnum(record.history_observation, OWNER_REVIEWED_VIDEO_HISTORY_OBSERVATIONS);
  const resultBindingObservation = readEnum(record.result_binding_observation, OWNER_REVIEWED_VIDEO_RESULT_BINDING_OBSERVATIONS);
  const safeErrorCode = record.last_safe_error_code === null ? null : readEnum(record.last_safe_error_code, OWNER_REVIEWED_VIDEO_SAFE_ERROR_CODES);
  const noArtifactReason = readEnum(record.no_artifact_reason, OWNER_REVIEWED_VIDEO_NO_ARTIFACT_REASONS);
  if ((postDisposition === "VALID_ECHO_OBSERVED") !== (ackObservation === "VALID_ECHO_OBSERVED") ||
      (postDisposition === "NOT_REACHED" && ackObservation !== "NOT_OBSERVED")) {
    throw invalidDiagnostic();
  }

  return Object.freeze({
    phase,
    post_disposition: postDisposition,
    ack_observation: ackObservation,
    history_observation: historyObservation,
    result_binding_observation: resultBindingObservation,
    last_safe_error_code: safeErrorCode,
    no_artifact_reason: noArtifactReason,
    poll_usage: Object.freeze({
      history_get_calls: boundedCount(pollUsage.history_get_calls),
      in_progress_get_calls: boundedCount(pollUsage.in_progress_get_calls),
      result_get_calls: boundedCount(pollUsage.result_get_calls)
    })
  });
}

function readClosedRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw invalidDiagnostic();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalidDiagnostic();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))) {
      throw invalidDiagnostic();
    }
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw invalidDiagnostic();
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_DIAGNOSTIC) throw error;
    throw invalidDiagnostic();
  }
}

function readEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalidDiagnostic();
  return value as T[number];
}

function boundedCount(value: unknown): Readonly<{ count: number; capped: boolean }> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw invalidDiagnostic();
  return Object.freeze({ count: Math.min(value, MAX_REPORTED_POLL_CALLS), capped: value > MAX_REPORTED_POLL_CALLS });
}

function invalidDiagnostic(): Error {
  return new Error(INVALID_DIAGNOSTIC);
}
