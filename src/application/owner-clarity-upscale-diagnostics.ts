import { types } from "node:util";
import type { ClarityUpscaleResultUnverifiedReason } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxHttpErrorCode } from "../adapter/syntx/http-client.js";

const MAX_DIAGNOSTIC_GETS = 255;

export const OWNER_CLARITY_UNKNOWN_DIAGNOSTIC_PHASES = [
  "POST_CALL_STARTED", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_WAIT", "HISTORY_BINDING",
  "IN_PROGRESS_GET", "RESULT_GET", "RESULT_WAIT", "RESULT_BINDING"
] as const;
export const OWNER_CLARITY_UNKNOWN_HISTORY_BINDINGS = ["NOT_RUN", "PENDING", "VALID", "INVALID"] as const;
export const OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS = [
  "SNAPSHOT_PARSE_FAILED", "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID", "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID",
  "PAGE_INCOMPLETE", "REQUESTED_CHAT_MISMATCH", "PROVIDER_CHAT_ID_INVALID",
  "TOTAL_COUNT_MISMATCH", "TOTAL_PAGES_MISMATCH", "MESSAGE_ID_INVALID", "PROVIDER_CHAT_MISMATCH",
  "AUTHOR_ROLE_INVALID", "OWNER_ECHO_MISSING", "OWNER_ECHO_AMBIGUOUS", "OWNER_ECHO_AUTHOR_MISMATCH",
  "OWNER_ECHO_OBJECT_INVALID", "MESSAGE_CARDINALITY_INVALID", "BOT_CANDIDATE_CARDINALITY_INVALID",
  "BOT_OBJECT_INVALID"
] as const;
export const OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS = [
  "OUTER_MESSAGE_MISMATCH", "NOT_BOT_MESSAGE", "NO_IMAGE_OBJECTS", "RESULT_COUNT_OUT_OF_RANGE",
  "RESULT_OBJECT_INCOMPLETE", "RESULT_OBJECT_MISMATCH", "RESULT_URL_UNSAFE", "RESULT_MIME_UNKNOWN"
] as const satisfies readonly ClarityUpscaleResultUnverifiedReason[];
export const OWNER_CLARITY_UNKNOWN_UPSTREAM_ERROR_CODES = [
  "INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
] as const satisfies readonly SyntxHttpErrorCode[];

export interface OwnerClarityUpscaleUnknownDiagnostic {
  readonly phase: typeof OWNER_CLARITY_UNKNOWN_DIAGNOSTIC_PHASES[number];
  readonly echo_ack_known: boolean;
  readonly history_get_eligible: boolean;
  readonly history_get_performed: boolean;
  readonly history_get_count: number;
  readonly history_get_count_capped: boolean;
  readonly history_binding: typeof OWNER_CLARITY_UNKNOWN_HISTORY_BINDINGS[number];
  readonly history_binding_reason: typeof OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS[number] | null;
  readonly result_get_performed: boolean;
  readonly result_get_count: number;
  readonly result_get_count_capped: boolean;
  readonly unverified_reason: ClarityUpscaleResultUnverifiedReason | null;
  readonly upstream_error_code: SyntxHttpErrorCode | null;
}

export interface MutableOwnerClarityUpscaleUnknownDiagnostic {
  phase: OwnerClarityUpscaleUnknownDiagnostic["phase"];
  echo_ack_known: boolean;
  history_get_eligible: boolean;
  history_get_performed: boolean;
  history_get_count: number;
  history_get_count_capped: boolean;
  history_binding: OwnerClarityUpscaleUnknownDiagnostic["history_binding"];
  history_binding_reason: OwnerClarityUpscaleUnknownDiagnostic["history_binding_reason"];
  result_get_performed: boolean;
  result_get_count: number;
  result_get_count_capped: boolean;
  unverified_reason: OwnerClarityUpscaleUnknownDiagnostic["unverified_reason"];
  upstream_error_code: SyntxHttpErrorCode | null;
}

export function initialClarityUnknownDiagnostic(): MutableOwnerClarityUpscaleUnknownDiagnostic {
  return {
    phase: "POST_CALL_STARTED", echo_ack_known: false, history_get_eligible: false,
    history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
    history_binding: "NOT_RUN", history_binding_reason: null, result_get_performed: false, result_get_count: 0,
    result_get_count_capped: false, unverified_reason: null, upstream_error_code: null
  };
}

export function snapshotClarityUnknownDiagnostic(input: unknown): OwnerClarityUpscaleUnknownDiagnostic {
  const fields = readExactDiagnosticRecord(input);
  const countValid = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DIAGNOSTIC_GETS;
  if (!(OWNER_CLARITY_UNKNOWN_DIAGNOSTIC_PHASES as readonly unknown[]).includes(fields.phase) ||
      !(OWNER_CLARITY_UNKNOWN_HISTORY_BINDINGS as readonly unknown[]).includes(fields.history_binding) ||
      !(fields.history_binding_reason === null || (typeof fields.history_binding_reason === "string" &&
        (OWNER_CLARITY_UNKNOWN_HISTORY_BINDING_REASONS as readonly string[]).includes(fields.history_binding_reason))) ||
      !(fields.unverified_reason === null || (typeof fields.unverified_reason === "string" &&
        (OWNER_CLARITY_UNKNOWN_UNVERIFIED_REASONS as readonly string[]).includes(fields.unverified_reason))) ||
      !(fields.upstream_error_code === null || (typeof fields.upstream_error_code === "string" &&
        (OWNER_CLARITY_UNKNOWN_UPSTREAM_ERROR_CODES as readonly string[]).includes(fields.upstream_error_code))) ||
      typeof fields.echo_ack_known !== "boolean" || typeof fields.history_get_eligible !== "boolean" ||
      typeof fields.history_get_performed !== "boolean" || !countValid(fields.history_get_count) ||
      typeof fields.history_get_count_capped !== "boolean" || typeof fields.result_get_performed !== "boolean" ||
      !countValid(fields.result_get_count) || typeof fields.result_get_count_capped !== "boolean") {
    throw new TypeError("Invalid Clarity unknown diagnostic.");
  }
  return Object.freeze({
    phase: fields.phase as OwnerClarityUpscaleUnknownDiagnostic["phase"],
    echo_ack_known: fields.echo_ack_known as boolean,
    history_get_eligible: fields.history_get_eligible as boolean,
    history_get_performed: fields.history_get_performed as boolean,
    history_get_count: fields.history_get_count as number,
    history_get_count_capped: fields.history_get_count_capped as boolean,
    history_binding: fields.history_binding as OwnerClarityUpscaleUnknownDiagnostic["history_binding"],
    history_binding_reason: fields.history_binding_reason as OwnerClarityUpscaleUnknownDiagnostic["history_binding_reason"],
    result_get_performed: fields.result_get_performed as boolean,
    result_get_count: fields.result_get_count as number,
    result_get_count_capped: fields.result_get_count_capped as boolean,
    unverified_reason: fields.unverified_reason as OwnerClarityUpscaleUnknownDiagnostic["unverified_reason"],
    upstream_error_code: fields.upstream_error_code as SyntxHttpErrorCode | null
  });
}

export function safeClarityUpstreamErrorCode(error: unknown): SyntxHttpErrorCode | null {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof SyntxHttpError)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
      !(OWNER_CLARITY_UNKNOWN_UPSTREAM_ERROR_CODES as readonly string[]).includes(descriptor.value)) return null;
  return descriptor.value as SyntxHttpErrorCode;
}

export function incrementClarityDiagnosticGet(
  diagnostic: MutableOwnerClarityUpscaleUnknownDiagnostic,
  kind: "history" | "result"
): void {
  const countKey = kind === "history" ? "history_get_count" : "result_get_count";
  const cappedKey = kind === "history" ? "history_get_count_capped" : "result_get_count_capped";
  const performedKey = kind === "history" ? "history_get_performed" : "result_get_performed";
  diagnostic[performedKey] = true;
  if (diagnostic[countKey] >= MAX_DIAGNOSTIC_GETS) diagnostic[cappedKey] = true;
  else diagnostic[countKey] += 1;
}

function readExactDiagnosticRecord(value: unknown): Record<string, unknown> {
  const keys = ["phase", "echo_ack_known", "history_get_eligible", "history_get_performed", "history_get_count",
    "history_get_count_capped", "history_binding", "history_binding_reason", "result_get_performed", "result_get_count",
    "result_get_count_capped", "unverified_reason", "upstream_error_code"] as const;
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError("Invalid diagnostic record.");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length ||
      ownKeys.some((key) => typeof key !== "string" || !keys.includes(key as typeof keys[number]) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) throw new TypeError("Invalid diagnostic record.");
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) throw new TypeError("Invalid diagnostic record.");
    output[key] = descriptor.value;
  }
  return output;
}
