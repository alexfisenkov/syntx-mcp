import { randomUUID } from "node:crypto";
import type {
  RedactedMessageEnvelope,
  SafeArtifactMetadata
} from "../adapter/syntx/chat-http-client.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import type { OwnerImageChatClient } from "./owner-generate-image.js";

const RECOVERY_PREFIX = "recovery_";
const RECOVERY_ID_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const ATTEMPT_ID_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_MIME = /^image\/(?:jpeg|png|webp)$/u;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 128;
const MAX_CANDIDATES = 8;
const RECOVERY_READ_TIMEOUT_MS = 30_000;

export interface CreateOwnerImageRecoveryInput {
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: string;
  readonly model_type: string;
  readonly mime_types: readonly string[];
  readonly message_id?: string | null;
  readonly now?: number;
}

/** Minimal process-local pointers for exact-attempt, GET-only recovery. */
export interface OwnerImageRecoveryRecord {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: string;
  readonly model_type: string;
  readonly mime_types: readonly string[];
  readonly message_id: string | null;
  readonly created_at: string;
}

export interface OwnerImageRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: string;
  readonly created_at: string;
}

export interface OwnerImageRecoveryStoreLike {
  create(input: CreateOwnerImageRecoveryInput): OwnerImageRecoveryRecord;
  get(recoveryId: string, attemptId: string, now?: number): OwnerImageRecoveryRecord | undefined;
  list(attemptId: string, limit?: number, now?: number): readonly OwnerImageRecoveryListItem[];
  updateMessageId(recoveryId: string, attemptId: string, messageId: string): void;
  remove?(recoveryId: string, attemptId: string): void;
  close?(): void;
}

export class OwnerImageRecoveryStore implements OwnerImageRecoveryStoreLike {
  readonly #records = new Map<string, OwnerImageRecoveryRecord>();
  readonly #ttlMs: number;
  readonly #maxRecords: number;
  readonly #now: () => number;

  constructor(options: { ttlMs?: number; maxRecords?: number; now?: () => number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1 ||
        !Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1) {
      throw new Error("OWNER_IMAGE_RECOVERY_LIMITS_INVALID");
    }
  }

  create(input: CreateOwnerImageRecoveryInput): OwnerImageRecoveryRecord {
    if (!ATTEMPT_ID_PATTERN.test(input.attempt_id) || !SAFE_IDENTIFIER.test(input.chat_uuid) ||
        !SAFE_MODEL_IDENTIFIER.test(input.model_id) || !SAFE_MODEL_IDENTIFIER.test(input.model_type) ||
        (input.message_id != null && !SAFE_IDENTIFIER.test(input.message_id)) ||
        !Array.isArray(input.mime_types) || input.mime_types.length < 1 || input.mime_types.length > 8 ||
        input.mime_types.some((mime) => typeof mime !== "string" || !SAFE_MIME.test(mime))) {
      throw new Error("OWNER_IMAGE_RECOVERY_INPUT_INVALID");
    }
    const now = input.now ?? this.#now();
    if (!Number.isFinite(now)) throw new Error("OWNER_IMAGE_RECOVERY_CLOCK_INVALID");
    this.prune(now);
    while (this.#records.size >= this.#maxRecords) {
      const oldestId = this.#records.keys().next().value;
      if (oldestId === undefined) break;
      this.#records.delete(oldestId);
    }
    const record: OwnerImageRecoveryRecord = Object.freeze({
      recovery_id: `${RECOVERY_PREFIX}${randomUUID()}`,
      attempt_id: input.attempt_id,
      chat_uuid: input.chat_uuid,
      model_id: input.model_id,
      model_type: input.model_type,
      mime_types: Object.freeze([...new Set(input.mime_types)]),
      message_id: input.message_id ?? null,
      created_at: new Date(now).toISOString()
    });
    this.#records.set(record.recovery_id, record);
    return record;
  }

  get(recoveryId: string, attemptId: string, now = this.#now()): OwnerImageRecoveryRecord | undefined {
    if (!RECOVERY_ID_PATTERN.test(recoveryId) || !ATTEMPT_ID_PATTERN.test(attemptId) || !Number.isFinite(now)) return undefined;
    this.prune(now);
    const record = this.#records.get(recoveryId);
    return record?.attempt_id === attemptId ? record : undefined;
  }

  list(attemptId: string, limit = 20, now = this.#now()): readonly OwnerImageRecoveryListItem[] {
    if (!ATTEMPT_ID_PATTERN.test(attemptId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(now)) return Object.freeze([]);
    this.prune(now);
    return Object.freeze([...this.#records.values()]
      .filter((record) => record.attempt_id === attemptId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit)
      .map(({ recovery_id, model_id, created_at }) => Object.freeze({ recovery_id, model_id, created_at })));
  }

  updateMessageId(recoveryId: string, attemptId: string, messageId: string): void {
    if (!SAFE_IDENTIFIER.test(messageId)) throw new Error("OWNER_IMAGE_RECOVERY_INPUT_INVALID");
    const record = this.#records.get(recoveryId);
    if (record?.attempt_id === attemptId) this.#records.set(recoveryId, Object.freeze({ ...record, message_id: messageId }));
  }

  remove(recoveryId: string, attemptId: string): void {
    if (this.#records.get(recoveryId)?.attempt_id === attemptId) this.#records.delete(recoveryId);
  }

  size(): number { return this.#records.size; }
  close(): void { this.#records.clear(); }

  private prune(now: number): void {
    for (const [id, record] of this.#records) {
      if (now - Date.parse(record.created_at) >= this.#ttlMs) this.#records.delete(id);
    }
  }
}

export class OwnerImageGenerationOutcomeUnknownError extends Error {
  readonly code = "OUTCOME_UNKNOWN" as const;
  readonly recovery_id: string | undefined;

  constructor(recoveryId?: string) {
    super("The image generation may have been dispatched; do not retry. Reconcile with the exact linked attempt if a recovery id is available.");
    this.name = "OwnerImageGenerationOutcomeUnknownError";
    this.recovery_id = recoveryId;
  }
}

export class OwnerImageRecoveryNotFoundError extends Error {
  readonly code = "RECOVERY_NOT_FOUND" as const;

  constructor() {
    super("No matching owner image recovery record is available for this attempt.");
    this.name = "OwnerImageRecoveryNotFoundError";
  }
}

/** GET-only bounded reconciliation; secrets, prompts, settings and URLs are not stored in recovery records. */
export async function reconcileOwnerImageRecovery(
  client: Pick<OwnerImageChatClient, "listInProgress" | "getMessage">,
  record: OwnerImageRecoveryRecord,
  signal?: AbortSignal
): Promise<SafeArtifactMetadata[]> {
  if (!isValidRecoveryRecord(record)) throw new OwnerImageRecoveryNotFoundError();
  const deadline = new AbsoluteRequestDeadline(RECOVERY_READ_TIMEOUT_MS, signal, () => new OwnerImageGenerationOutcomeUnknownError(record.recovery_id));
  try {
    if (record.message_id !== null) {
      try {
        const message = await callWithinDeadline(deadline, (requestSignal) => client.getMessage(record.chat_uuid, record.message_id!, requestSignal));
        const artifacts = exactArtifacts(message, record, record.message_id);
        if (artifacts.length > 0) return artifacts;
      } catch (error) {
        deadline.throwIfAborted();
        if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") throw error;
      }
    }
    const entries = await callWithinDeadline(deadline, (requestSignal) => client.listInProgress(record.chat_uuid, requestSignal));
    const candidates = entries.filter((entry) =>
      entry.object_type === "image" && entry.model_type === record.model_type && SAFE_IDENTIFIER.test(entry.message_id)
    ).slice(0, MAX_CANDIDATES);
    for (const candidate of candidates) {
      deadline.throwIfAborted();
      const message = await callWithinDeadline(deadline, (requestSignal) => client.getMessage(record.chat_uuid, candidate.message_id, requestSignal));
      const artifacts = exactArtifacts(message, record, candidate.message_id);
      if (artifacts.length > 0) {
        // Store update is performed by the caller after the verified bot id is selected.
        return artifacts;
      }
    }
    throw new OwnerImageGenerationOutcomeUnknownError(record.recovery_id);
  } catch (error) {
    if (error instanceof OwnerImageRecoveryNotFoundError) throw error;
    if (error instanceof OwnerImageGenerationOutcomeUnknownError) throw error;
    if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") throw error;
    throw new OwnerImageGenerationOutcomeUnknownError(record.recovery_id);
  } finally {
    deadline.close();
  }
}

function callWithinDeadline<T>(deadline: AbsoluteRequestDeadline, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  deadline.throwIfAborted();
  return deadline.waitFor(operation(deadline.signal));
}

function isValidRecoveryRecord(record: OwnerImageRecoveryRecord): boolean {
  return record !== null && typeof record === "object" &&
    RECOVERY_ID_PATTERN.test(record.recovery_id) && ATTEMPT_ID_PATTERN.test(record.attempt_id) &&
    SAFE_IDENTIFIER.test(record.chat_uuid) && SAFE_MODEL_IDENTIFIER.test(record.model_id) &&
    SAFE_MODEL_IDENTIFIER.test(record.model_type) &&
    (record.message_id === null || SAFE_IDENTIFIER.test(record.message_id)) &&
    Array.isArray(record.mime_types) && record.mime_types.length > 0 && record.mime_types.length <= 8 &&
    record.mime_types.every((mime) => typeof mime === "string" && SAFE_MIME.test(mime)) &&
    typeof record.created_at === "string" && Number.isFinite(Date.parse(record.created_at));
}

function exactArtifacts(message: RedactedMessageEnvelope, record: OwnerImageRecoveryRecord, expectedMessageId: string): SafeArtifactMetadata[] {
  if (message.chat_uuid !== record.chat_uuid ||
      message.message_id !== expectedMessageId ||
      message.object_type !== "image" ||
      message.model_type !== record.model_type) return [];
  return message.artifacts.filter((artifact) => artifact.mime_type !== undefined && record.mime_types.includes(artifact.mime_type));
}
