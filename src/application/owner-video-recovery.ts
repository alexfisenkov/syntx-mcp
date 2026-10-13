import { randomUUID } from "node:crypto";
import type {
  RedactedMessageEnvelope,
  SafeArtifactMetadata
} from "../adapter/syntx/chat-http-client.js";
import {
  getOwnerVideoProfile,
  type OwnerVideoModelId,
  type OwnerVideoChatClient
} from "./owner-generate-video.js";

const RECOVERY_PREFIX = "recovery_";
const RECOVERY_ID_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RECORDS = 128;

/** The only data retained after a dispatched owner video has an unknown outcome. */
export interface OwnerVideoRecoveryRecord {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerVideoModelId;
  /** Provider echo/dispatch id when the start response was received. */
  readonly message_id: string | null;
  readonly created_at: string;
}

export interface CreateOwnerVideoRecoveryInput {
  readonly attempt_id: string;
  readonly chat_uuid: string;
  readonly model_id: OwnerVideoModelId;
  readonly message_id?: string | null;
  readonly now?: number;
}

/**
 * Storage seam for owner recovery. Implementations must keep the opaque
 * recovery handle bound to the linked attempt and never persist credentials or
 * artifact URLs. The default implementation remains process-local until the
 * auth/link store is durable as well.
 */
export interface OwnerVideoRecoveryStoreLike {
  create(input: CreateOwnerVideoRecoveryInput): OwnerVideoRecoveryRecord;
  get(recoveryId: string, attemptId: string, now?: number): OwnerVideoRecoveryRecord | undefined;
  updateMessageId?(recoveryId: string, attemptId: string, messageId: string): void;
  remove?(recoveryId: string, attemptId: string): void;
  close?(): void;
}

/**
 * Bounded process-local recovery store. Chat UUIDs never leave this module;
 * records are intentionally not persisted because persistence would expand the
 * owner-only credential/recovery boundary.
 */
export class OwnerVideoRecoveryStore implements OwnerVideoRecoveryStoreLike {
  readonly #records = new Map<string, OwnerVideoRecoveryRecord>();
  readonly #ttlMs: number;
  readonly #maxRecords: number;

  constructor(options: { ttlMs?: number; maxRecords?: number } = {}) {
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    if (!Number.isInteger(this.#ttlMs) || this.#ttlMs < 1 || !Number.isInteger(this.#maxRecords) || this.#maxRecords < 1) {
      throw new Error("Invalid owner video recovery store limits.");
    }
  }

  create(input: CreateOwnerVideoRecoveryInput): OwnerVideoRecoveryRecord {
    const now = input.now ?? Date.now();
    this.prune(now);
    const record: OwnerVideoRecoveryRecord = Object.freeze({
      recovery_id: `${RECOVERY_PREFIX}${randomUUID()}`,
      attempt_id: input.attempt_id,
      chat_uuid: input.chat_uuid,
      model_id: input.model_id,
      message_id: input.message_id ?? null,
      created_at: new Date(now).toISOString()
    });
    this.#records.set(record.recovery_id, record);
    while (this.#records.size > this.#maxRecords) {
      const oldest = this.#records.keys().next().value;
      if (oldest === undefined) break;
      this.#records.delete(oldest);
    }
    return record;
  }

  get(recoveryId: string, attemptId: string, now = Date.now()): OwnerVideoRecoveryRecord | undefined {
    if (!RECOVERY_ID_PATTERN.test(recoveryId)) return undefined;
    this.prune(now);
    const record = this.#records.get(recoveryId);
    return record?.attempt_id === attemptId ? record : undefined;
  }

  updateMessageId(recoveryId: string, attemptId: string, messageId: string): void {
    const record = this.#records.get(recoveryId);
    if (record?.attempt_id === attemptId) {
      this.#records.set(recoveryId, Object.freeze({ ...record, message_id: messageId }));
    }
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

export class OwnerVideoRecoveryUnknownError extends Error {
  readonly recovery_id: string;

  constructor(recoveryId: string) {
    super("The video generation outcome remains unknown; use the recovery tool before retrying.");
    this.name = "OwnerVideoRecoveryUnknownError";
    this.recovery_id = recoveryId;
  }
}

export async function reconcileOwnerVideoRecovery(
  client: OwnerVideoChatClient,
  record: OwnerVideoRecoveryRecord,
  signal?: AbortSignal
): Promise<SafeArtifactMetadata[]> {
  const model = getOwnerVideoProfile(record.model_id);
  if (!model) return [];

  // A terminal message can disappear from listInProgress before the caller
  // gets a chance to reconcile it. New records retain the provider message id
  // from dispatch, so prefer this bounded direct read and never rediscover by
  // position or by a broad chat scan.
  if (record.message_id !== null) {
    const message = await client.getMessage(record.chat_uuid, record.message_id, signal);
    return verifiedRecoveryArtifacts(message, model.settings.model_type);
  }

  // Legacy records were created before dispatch message ids were retained.
  // Keep their bounded list/get path for backwards compatibility only.
  const entries = await client.listInProgress(record.chat_uuid, signal);
  const candidates = entries.filter((entry) =>
    entry.object_type === "video" && entry.model_type === model.settings.model_type
  );
  for (const candidate of candidates) {
    const message = await client.getMessage(record.chat_uuid, candidate.message_id, signal);
    const artifacts = verifiedRecoveryArtifacts(message, model.settings.model_type);
    if (artifacts.length > 0) return artifacts;
  }
  return [];
}

function verifiedRecoveryArtifacts(message: RedactedMessageEnvelope, expectedModelType: unknown): SafeArtifactMetadata[] {
  if (message.object_type !== "video" || message.model_type !== expectedModelType) return [];
  return message.artifacts.filter((artifact) => artifact.mime_type === "video/mp4");
}

export function isOwnerVideoRecoveryId(value: string): boolean {
  return RECOVERY_ID_PATTERN.test(value);
}
