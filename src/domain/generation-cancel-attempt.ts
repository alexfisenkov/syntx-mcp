/** Cancellation delivery evidence, never the provider generation outcome. */
export const GENERATION_CANCEL_ATTEMPT_STATES = [
  "DISPATCHING",
  "ACKNOWLEDGED",
  "OUTCOME_UNKNOWN",
] as const;

export type GenerationCancelAttemptState =
  (typeof GENERATION_CANCEL_ATTEMPT_STATES)[number];

/** Persistence-safe metadata only; no raw confirmation or provider payload. */
export interface GenerationCancelAttemptRecord {
  generation_operation_id: string;
  owner: { tenant_id: string; subject_id: string };
  idempotency_key: string;
  confirmation_hash: string;
  state: GenerationCancelAttemptState;
  created_at: string;
  updated_at: string;
  revision: number;
}

export interface GenerationCancelAttemptEventRecord {
  sequence: number;
  generation_operation_id: string;
  attempt_revision: number;
  event_type: "CLAIMED" | "SETTLED";
  from_state: GenerationCancelAttemptState | null;
  to_state: GenerationCancelAttemptState;
  recorded_at: string;
}
