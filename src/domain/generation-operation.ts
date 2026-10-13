/**
 * Durable lifecycle for a billable generation intent. It is deliberately
 * separate from the provider job lifecycle: a local operation exists before
 * SYNTX has returned a job or message id.
 */
export const GENERATION_OPERATION_STATES = [
  "PREPARED",
  "CHAT_CREATING",
  "CHAT_READY",
  "GENERATION_DISPATCHING",
  "PROVIDER_ACCEPTED",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "REJECTED_NO_COMMIT",
  "CHAT_CREATE_OUTCOME_UNKNOWN",
  "CHAT_RECONCILING",
  "GENERATION_OUTCOME_UNKNOWN",
  "GENERATION_RECONCILING",
  "TERMINAL_UNRESOLVED"
] as const;

export type GenerationOperationState =
  (typeof GENERATION_OPERATION_STATES)[number];

export const TERMINAL_GENERATION_OPERATION_STATES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "REJECTED_NO_COMMIT",
  "TERMINAL_UNRESOLVED"
] as const satisfies readonly GenerationOperationState[];

export type CostCapEnforcement =
  | "UPSTREAM_QUOTE_BOUND"
  | "UPSTREAM_MAX_COST"
  | "PRE_DISPATCH_ONLY"
  | "UNENFORCEABLE";

/** Exact ledger marker for an owner-authorized dispatch with no numeric cap. */
export const OWNER_UNCAPPED_APPROVED_MAX_COST = "OWNER_UNCAPPED" as const;

/** Server-resolved identity. None of these fields may be accepted from a tool. */
export interface GenerationPrincipalRef {
  tenant_id: string;
  subject_id: string;
  connection_id: string;
}

export interface GenerationCostObservation {
  /** Decimal text prevents silent floating-point rounding of an unknown unit. */
  effective_cost: string | null;
  unit: string | null;
  observed_at: string;
  expires_at: string;
  cap_enforcement: CostCapEnforcement;
}

export interface ProviderGenerationReceipt {
  chat_uuid: string;
  provider_job_id: string | null;
  message_id: string | null;
  message_object_id: string | null;
}

/**
 * Persistence-safe metadata only. Prompt, parameter values, bearer material,
 * Telegram payloads, signed artifact URLs, and profile data are intentionally
 * absent from this contract.
 */
export interface GenerationOperationRecord {
  id: string;
  principal: GenerationPrincipalRef;
  idempotency_key: string;
  request_hash: string;
  model_id: string;
  operation_id: string;
  modality: "text" | "image" | "video" | "audio";
  catalog_version: string;
  schema_hash: string;
  parameter_keys: string[];
  estimate_id: string;
  /** Decimal text for generic requests, or OWNER_UNCAPPED with UNENFORCEABLE only. */
  approved_max_cost: string;
  cost: GenerationCostObservation;
  state: GenerationOperationState;
  receipt: ProviderGenerationReceipt | null;
  /** Exact bot result selected once from complete, uniquely attributable chat history. */
  result_message_id?: string | null;
  failure_code: string | null;
  dispatch_deadline: string;
  next_poll_at: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
}

const ALLOWED_TRANSITIONS: Readonly<
  Record<GenerationOperationState, ReadonlySet<GenerationOperationState>>
> = {
  PREPARED: new Set(["CHAT_CREATING", "REJECTED_NO_COMMIT"]),
  CHAT_CREATING: new Set([
    "CHAT_READY",
    "REJECTED_NO_COMMIT",
    "CHAT_CREATE_OUTCOME_UNKNOWN"
  ]),
  CHAT_READY: new Set(["GENERATION_DISPATCHING", "REJECTED_NO_COMMIT"]),
  GENERATION_DISPATCHING: new Set([
    "PROVIDER_ACCEPTED",
    "REJECTED_NO_COMMIT",
    "GENERATION_OUTCOME_UNKNOWN"
  ]),
  PROVIDER_ACCEPTED: new Set([
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED"
  ]),
  QUEUED: new Set(["RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]),
  RUNNING: new Set(["SUCCEEDED", "FAILED", "CANCELED"]),
  SUCCEEDED: new Set(),
  FAILED: new Set(),
  CANCELED: new Set(),
  REJECTED_NO_COMMIT: new Set(),
  CHAT_CREATE_OUTCOME_UNKNOWN: new Set([
    "CHAT_RECONCILING",
    "TERMINAL_UNRESOLVED"
  ]),
  CHAT_RECONCILING: new Set([
    "CHAT_READY",
    "CHAT_CREATE_OUTCOME_UNKNOWN",
    "TERMINAL_UNRESOLVED"
  ]),
  GENERATION_OUTCOME_UNKNOWN: new Set([
    // A dispatcher that still holds the provider receipt after recovery won
    // its first write can persist acceptance atomically. The store requires
    // provider correlation and an unchanged chat binding for this snapshot.
    "PROVIDER_ACCEPTED",
    "GENERATION_RECONCILING",
    "TERMINAL_UNRESOLVED"
  ]),
  GENERATION_RECONCILING: new Set([
    "PROVIDER_ACCEPTED",
    "GENERATION_OUTCOME_UNKNOWN",
    "TERMINAL_UNRESOLVED"
  ]),
  TERMINAL_UNRESOLVED: new Set()
};

export class GenerationStateTransitionError extends Error {
  constructor() {
    super("The durable generation operation transition is invalid.");
    this.name = "GenerationStateTransitionError";
  }
}

export function assertGenerationStateTransition(
  from: GenerationOperationState,
  to: GenerationOperationState
): void {
  const allowedTransitions = ALLOWED_TRANSITIONS[from];
  if (!allowedTransitions?.has(to)) {
    throw new GenerationStateTransitionError();
  }
}

export function isTerminalGenerationState(
  state: GenerationOperationState
): boolean {
  return (TERMINAL_GENERATION_OPERATION_STATES as readonly string[]).includes(
    state
  );
}

/**
 * On process restart, any state that proves a network action had started but
 * not durably finished becomes unknown. The caller must reconcile; it must not
 * repeat the write automatically.
 */
export function recoveredGenerationState(
  state: GenerationOperationState
): GenerationOperationState {
  switch (state) {
    case "CHAT_CREATING":
    case "CHAT_RECONCILING":
      return "CHAT_CREATE_OUTCOME_UNKNOWN";
    case "GENERATION_DISPATCHING":
    case "GENERATION_RECONCILING":
      return "GENERATION_OUTCOME_UNKNOWN";
    default:
      return state;
  }
}
