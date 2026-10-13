export type ApplicationErrorCode =
  | "COMPLIANCE_GATE_BLOCKED"
  | "MODEL_NOT_FOUND"
  | "OPERATION_NOT_FOUND"
  | "GENERATION_CONTRACT_UNAVAILABLE"
  | "INVALID_PARAMETERS"
  | "IDEMPOTENCY_CONFLICT"
  | "COST_CAP_EXCEEDED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_MISMATCH"
  | "CONFIRMATION_ALREADY_USED"
  | "UPSTREAM_START_FAILED"
  | "UPSTREAM_OUTCOME_UNKNOWN"
  | "UPSTREAM_CAPABILITY_NOT_RESEARCHED"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_READY"
  | "JOB_NOT_CANCELABLE"
  | "UNSAFE_ARTIFACT_URL";

export class ApplicationError extends Error {
  constructor(
    readonly code: ApplicationErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export class ComplianceBlockedError extends ApplicationError {
  constructor(operation: string) {
    super(
      "COMPLIANCE_GATE_BLOCKED",
      `The ${operation} operation is unavailable until an official API or written automation permission is recorded.`,
      { operation }
    );
    this.name = "ComplianceBlockedError";
  }
}
