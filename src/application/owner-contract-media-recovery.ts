import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { OwnerContractMediaContractContext } from "./owner-contract-media.js";
import type { GenerationContractStatus } from "../domain/generation-contract.js";
import {
  buildOwnerReviewedVideoRecoveryDiagnostic,
  type OwnerReviewedVideoRecoveryDiagnostic,
  type OwnerReviewedVideoRecoveryDiagnosticInput
} from "./owner-reviewed-video-recovery-diagnostic.js";
import {
  ownerReviewedContractProbePolicyBindsRecovery,
  type OwnerReviewedContractMediaPolicy
} from "./owner-contract-probe-policy.js";

const RECOVERY_PREFIX = "recovery_";
const RECOVERY_ID_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const CHAT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const CONTRACT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 128;

export interface CreateOwnerContractMediaRecoveryInput {
  readonly attemptId: string;
  readonly chatUuid: string;
  readonly messageId: string | null;
  readonly contract: OwnerContractMediaContractContext;
  readonly probePolicy?: OwnerReviewedContractMediaPolicy;
  /** Marks a source-only candidate without claiming that its schema is live verified. */
  readonly imageReferenceCandidate?: Readonly<{
    readonly candidate_schema_hash: string;
    readonly status: "blocked";
    readonly dispatch_allowed: false;
    readonly backend_acceptance: "unproven";
  }>;
  readonly now?: number;
}

/** Contains only the exact attempt/model binding and the minimum GET recovery handles. */
export interface OwnerContractMediaRecoveryRecord {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly modality: "image" | "video";
  readonly ai_name: string;
  readonly model_type: string;
  readonly variant_id?: string;
  readonly schema_hash: string;
  readonly status: GenerationContractStatus;
  readonly registry_version?: string;
  readonly catalog_version?: string;
  readonly mime_types: readonly string[];
  readonly image_reference_candidate?: CreateOwnerContractMediaRecoveryInput["imageReferenceCandidate"];
  readonly message_id: string | null;
  readonly created_at: string;
}

export interface OwnerContractMediaRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly created_at: string;
  readonly variant_id?: string;
}

export interface OwnerContractMediaRecoveryStoreLike {
  create(input: CreateOwnerContractMediaRecoveryInput): OwnerContractMediaRecoveryRecord;
  get(recoveryId: string, attemptId: string): OwnerContractMediaRecoveryRecord | undefined;
  list(attemptId: string, limit?: number): readonly OwnerContractMediaRecoveryListItem[];
  updateMessageId(recoveryId: string, attemptId: string, messageId: string): void;
  updateDiagnostic?(recoveryId: string, attemptId: string, diagnostic: OwnerReviewedVideoRecoveryDiagnosticInput): void;
  getDiagnostic?(recoveryId: string, attemptId: string): OwnerReviewedVideoRecoveryDiagnostic | undefined;
  getDiagnosticInput?(recoveryId: string, attemptId: string): OwnerReviewedVideoRecoveryDiagnosticInput | undefined;
  remove(recoveryId: string, attemptId: string): void;
  close?(): void;
}

/**
 * Bounded process-local recovery index. It deliberately does not persist
 * prompts, settings, credentials, or artifact URLs; a restarted process loses
 * these handles and must not claim restart-safe recovery.
 */
export class OwnerContractMediaRecoveryStore implements OwnerContractMediaRecoveryStoreLike {
  readonly #records = new Map<string, OwnerContractMediaRecoveryRecord>();
  readonly #diagnostics = new Map<string, Readonly<{ attemptId: string; input: OwnerReviewedVideoRecoveryDiagnosticInput }>>();
  readonly #ttlMs: number;
  readonly #maxRecords: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; maxRecords?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1 ||
        !Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1) {
      throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_LIMITS_INVALID");
    }
  }

  create(input: CreateOwnerContractMediaRecoveryInput): OwnerContractMediaRecoveryRecord {
    if (!ATTEMPT_ID_PATTERN.test(input.attemptId) || !CHAT_ID_PATTERN.test(input.chatUuid) ||
        (input.messageId !== null && !CHAT_ID_PATTERN.test(input.messageId))) {
      throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_INPUT_INVALID");
    }
    const contract = snapshotContractContext(input.contract, input.attemptId, input.probePolicy);
    const now = input.now ?? this.#now();
    if (!Number.isFinite(now)) throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_CLOCK_INVALID");
    this.prune(now);

    while (this.#records.size >= this.#maxRecords) {
      const oldest = this.#records.keys().next().value;
      if (oldest === undefined) break;
      this.#records.delete(oldest);
      this.#diagnostics.delete(oldest);
    }

    const record = Object.freeze({
      recovery_id: `${RECOVERY_PREFIX}${randomUUID()}`,
      attempt_id: input.attemptId,
      chat_uuid: input.chatUuid,
      ...contract,
      ...(input.imageReferenceCandidate === undefined ? {} : {
        image_reference_candidate: snapshotImageReferenceCandidate(input.imageReferenceCandidate)
      }),
      message_id: input.messageId,
      created_at: new Date(now).toISOString()
    });
    this.#records.set(record.recovery_id, record);
    if (record.modality === "video") this.#diagnostics.set(record.recovery_id, Object.freeze({
      attemptId: input.attemptId,
      input: Object.freeze({
        phase: "POST_CALL_STARTED",
        post_disposition: "NOT_REACHED",
        ack_observation: "NOT_OBSERVED",
        history_observation: "NOT_READ",
        result_binding_observation: "NOT_READ",
        last_safe_error_code: null,
        no_artifact_reason: "NOT_CAPTURED",
        poll_usage: Object.freeze({ history_get_calls: 0, in_progress_get_calls: 0, result_get_calls: 0 })
      })
    }));
    return record;
  }

  get(recoveryId: string, attemptId: string): OwnerContractMediaRecoveryRecord | undefined {
    if (!RECOVERY_ID_PATTERN.test(recoveryId) || !ATTEMPT_ID_PATTERN.test(attemptId)) return undefined;
    const now = this.#now();
    if (!Number.isFinite(now)) return undefined;
    this.prune(now);
    const record = this.#records.get(recoveryId);
    return record?.attempt_id === attemptId ? record : undefined;
  }

  list(attemptId: string, limit = 20): readonly OwnerContractMediaRecoveryListItem[] {
    if (!ATTEMPT_ID_PATTERN.test(attemptId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) return Object.freeze([]);
    const now = this.#now();
    if (!Number.isFinite(now)) return Object.freeze([]);
    this.prune(now);
    return Object.freeze([...this.#records.values()]
      .filter((record) => record.attempt_id === attemptId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
      .map(({ recovery_id, model_id, operation_id, created_at, variant_id }) => Object.freeze({
        recovery_id, model_id, operation_id, created_at,
        ...(variant_id === undefined ? {} : { variant_id })
      })));
  }

  remove(recoveryId: string, attemptId: string): void {
    const record = this.#records.get(recoveryId);
    if (record?.attempt_id === attemptId) {
      this.#records.delete(recoveryId);
      this.#diagnostics.delete(recoveryId);
    }
  }

  updateDiagnostic(recoveryId: string, attemptId: string, input: OwnerReviewedVideoRecoveryDiagnosticInput): void {
    const record = this.get(recoveryId, attemptId);
    if (!record || record.attempt_id !== attemptId || record.modality !== "video") return;
    const diagnostic = buildOwnerReviewedVideoRecoveryDiagnostic(input);
    this.#diagnostics.set(recoveryId, Object.freeze({
      attemptId,
      input: Object.freeze({
        phase: diagnostic.phase,
        post_disposition: diagnostic.post_disposition,
        ack_observation: diagnostic.ack_observation,
        history_observation: diagnostic.history_observation,
        result_binding_observation: diagnostic.result_binding_observation,
        last_safe_error_code: diagnostic.last_safe_error_code,
        no_artifact_reason: diagnostic.no_artifact_reason,
        poll_usage: Object.freeze({
          history_get_calls: input.poll_usage.history_get_calls,
          in_progress_get_calls: input.poll_usage.in_progress_get_calls,
          result_get_calls: input.poll_usage.result_get_calls
        })
      })
    }));
  }

  getDiagnostic(recoveryId: string, attemptId: string): OwnerReviewedVideoRecoveryDiagnostic | undefined {
    const input = this.getDiagnosticInput(recoveryId, attemptId);
    return input === undefined ? undefined : buildOwnerReviewedVideoRecoveryDiagnostic(input);
  }

  getDiagnosticInput(recoveryId: string, attemptId: string): OwnerReviewedVideoRecoveryDiagnosticInput | undefined {
    if (!this.get(recoveryId, attemptId)) return undefined;
    const entry = this.#diagnostics.get(recoveryId);
    if (entry?.attemptId !== attemptId) return undefined;
    return entry.input;
  }

  updateMessageId(recoveryId: string, attemptId: string, messageId: string): void {
    if (!CHAT_ID_PATTERN.test(messageId)) throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_INPUT_INVALID");
    const record = this.#records.get(recoveryId);
    if (record?.attempt_id !== attemptId) return;
    this.#records.set(recoveryId, Object.freeze({ ...record, message_id: messageId }));
  }

  size(): number { return this.#records.size; }

  close(): void { this.#records.clear(); this.#diagnostics.clear(); }

  private prune(now: number): void {
    for (const [recoveryId, record] of this.#records) {
      if (now - Date.parse(record.created_at) >= this.#ttlMs) {
        this.#records.delete(recoveryId);
        this.#diagnostics.delete(recoveryId);
      }
    }
  }
}

function snapshotImageReferenceCandidate(
  value: CreateOwnerContractMediaRecoveryInput["imageReferenceCandidate"] | unknown
): NonNullable<CreateOwnerContractMediaRecoveryInput["imageReferenceCandidate"]> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) {
    throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_REFERENCE_CANDIDATE_INVALID");
  }
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const allowed = ["candidate_schema_hash", "status", "dispatch_allowed", "backend_acceptance"];
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== allowed.length ||
      keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      typeof descriptors.candidate_schema_hash?.value !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(descriptors.candidate_schema_hash.value) ||
      descriptors.status?.value !== "blocked" || descriptors.dispatch_allowed?.value !== false ||
      descriptors.backend_acceptance?.value !== "unproven") {
    throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_REFERENCE_CANDIDATE_INVALID");
  }
  return Object.freeze({
    candidate_schema_hash: descriptors.candidate_schema_hash!.value as string,
    status: "blocked",
    dispatch_allowed: false,
    backend_acceptance: "unproven"
  });
}

function snapshotContractContext(
  context: OwnerContractMediaContractContext,
  attemptId: string,
  probePolicy?: OwnerReviewedContractMediaPolicy
): Pick<OwnerContractMediaRecoveryRecord,
  "model_id" | "operation_id" | "modality" | "ai_name" | "model_type" | "variant_id" | "schema_hash" | "status" | "registry_version" | "catalog_version" | "mime_types"> {
  if ((context.status !== "live_verified" &&
      !(context.status === "reviewed" && ownerReviewedContractProbePolicyBindsRecovery(probePolicy, attemptId, context))) ||
      !CONTRACT_IDENTIFIER_PATTERN.test(context.model_id) ||
      !CONTRACT_IDENTIFIER_PATTERN.test(context.ai_name) ||
      !CONTRACT_IDENTIFIER_PATTERN.test(context.model_type) ||
      (context.variant_id !== undefined && !CONTRACT_IDENTIFIER_PATTERN.test(context.variant_id)) ||
      !/^sha256:[a-f0-9]{64}$/u.test(context.schema_hash) ||
      (context.registry_version !== undefined && !/^sha256-[a-f0-9]{64}\.json$/u.test(context.registry_version)) ||
      (context.catalog_version !== undefined && !/^\d{4}-\d{2}-\d{2}T[^\s]{1,40}\.[a-f0-9]{12}$/u.test(context.catalog_version)) ||
      (context.status === "reviewed" && (context.registry_version === undefined || context.catalog_version === undefined)) ||
      !Array.isArray(context.mime_types) || context.mime_types.length < 1 || context.mime_types.length > 32 ||
      context.mime_types.some((mimeType) => typeof mimeType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mimeType))) {
    throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_CONTRACT_INVALID");
  }
  const expectedOperation = context.modality === "image" ? "generate-image"
    : context.modality === "video" ? "generate-video" : null;
  if (expectedOperation === null || context.operation_id !== expectedOperation) {
    throw new Error("OWNER_CONTRACT_MEDIA_RECOVERY_CONTRACT_INVALID");
  }
  return {
    model_id: context.model_id,
    operation_id: context.operation_id,
    modality: context.modality,
    ai_name: context.ai_name,
    model_type: context.model_type,
    ...(context.variant_id === undefined ? {} : { variant_id: context.variant_id }),
    schema_hash: context.schema_hash,
    status: context.status,
    ...(context.registry_version === undefined ? {} : { registry_version: context.registry_version }),
    ...(context.catalog_version === undefined ? {} : { catalog_version: context.catalog_version }),
    mime_types: Object.freeze([...context.mime_types])
  };
}
