import { randomUUID } from "node:crypto";
import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import type {
  ChatMessageHistorySnapshot,
  CreateChatReceipt,
  InternalGrokImageBatchEnvelope,
  MediaGenerationReceipt,
  StartImageRequest
} from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxHttpErrorCode } from "../adapter/syntx/http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import {
  getOwnerGrokImageReferenceProfile,
  type OwnerGrokImageReferenceProfileId,
  type OwnerGrokImageReferenceProfileSet
} from "../catalog/owner-grok-image-reference-profiles.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  consumeOwnerGrokImageReferenceOneShotPermit,
  OwnerGrokImageReferenceOneShotPolicyError,
  type OwnerGrokImageReferenceOneShotPermit
} from "./owner-grok-image-reference-one-shot-policy.js";
import {
  getOwnerGrokImageReferenceCandidateBinding,
  getOwnerGrokReferenceStoreBinding,
  OwnerGrokImageReferencePrepareError,
  type OwnerGrokImageReferencePreparedCandidate
} from "./owner-grok-image-reference-request-preparer.js";
import {
  OwnerMediaReferenceStore,
  OwnerMediaReferenceStoreError
} from "./owner-media-reference-store.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const RECOVERY_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const TTL_MS = 15 * 60_000;
const MAX_RECOVERIES = 128;
const MAX_PENDING = 8;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_DELAY_MS = 3_000;
const MAX_POLL_ATTEMPTS = 60;
const OUTPUT_MIME_ALLOWLIST = new Set(["image/jpeg", "image/png"]);
const MAX_UNKNOWN_DIAGNOSTIC_GETS = 255;

export const OWNER_GROK_UNKNOWN_DIAGNOSTIC_PHASES = [
  "PRE_DISPATCH", "POST_CALL_STARTED", "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_WAIT", "HISTORY_BINDING",
  "RESULT_GET", "RESULT_WAIT", "RESULT_BINDING"
] as const;
export const OWNER_GROK_UNKNOWN_HISTORY_MATCHES = ["NOT_RUN", "NONE", "UNIQUE", "INVALID"] as const;
export const OWNER_GROK_UNKNOWN_UPSTREAM_ERROR_CODES = [
  "INVALID_REQUEST", "AUTH_REQUIRED", "AUTH_OR_ACCESS_DENIED", "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_UNAVAILABLE", "UPSTREAM_TIMEOUT", "UPSTREAM_REQUEST_ABORTED", "UPSTREAM_PROTOCOL_ERROR"
] as const satisfies readonly SyntxHttpErrorCode[];

export interface OwnerGrokImageReferenceUnknownDiagnostic {
  readonly phase: typeof OWNER_GROK_UNKNOWN_DIAGNOSTIC_PHASES[number];
  readonly echo_ack_known: boolean;
  readonly history_get_eligible: boolean;
  readonly history_get_performed: boolean;
  readonly history_get_count: number;
  readonly history_get_count_capped: boolean;
  readonly history_match: typeof OWNER_GROK_UNKNOWN_HISTORY_MATCHES[number];
  readonly result_get_performed: boolean;
  readonly result_get_count: number;
  readonly result_get_count_capped: boolean;
  readonly result_binding_known: boolean;
  readonly upstream_error_code: SyntxHttpErrorCode | null;
}

interface MutableOwnerGrokImageReferenceUnknownDiagnostic {
  phase: OwnerGrokImageReferenceUnknownDiagnostic["phase"];
  echo_ack_known: boolean;
  history_get_eligible: boolean;
  history_get_performed: boolean;
  history_get_count: number;
  history_get_count_capped: boolean;
  history_match: OwnerGrokImageReferenceUnknownDiagnostic["history_match"];
  result_get_performed: boolean;
  result_get_count: number;
  result_get_count_capped: boolean;
  result_binding_known: boolean;
  upstream_error_code: SyntxHttpErrorCode | null;
}

export interface OwnerGrokImageReferenceReadClient {
  listMessageCandidates(chatUuid: string, ownerEchoMessageId: string, signal?: AbortSignal): Promise<ChatMessageHistorySnapshot>;
  getGrokImageBatchMessage(
    chatUuid: string,
    messageId: string,
    modelType: "grok_i2i" | "grok_i2i_pro",
    signal?: AbortSignal
  ): Promise<InternalGrokImageBatchEnvelope>;
}

export interface OwnerGrokImageReferenceDispatchClient extends OwnerGrokImageReferenceReadClient {
  createChat(scope: "image", title: string, signal?: AbortSignal): Promise<CreateChatReceipt>;
  startGrokImageWithInternalReferences(
    request: StartImageRequest,
    references: readonly InternalUploadReference[],
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
}

export interface OwnerGrokImageReferenceLifecyclePreflight {
  verifyFreshSubscription(attemptId: string, principal: GenerationPrincipalRef, modelId: string, signal: AbortSignal): Promise<void>;
  verifyModelAccess(attemptId: string, principal: GenerationPrincipalRef, modelId: string, signal: AbortSignal): Promise<void>;
  authorizeCost(attemptId: string, principal: GenerationPrincipalRef, candidate: OwnerGrokImageReferencePreparedCandidate, signal: AbortSignal): Promise<void>;
}

export interface OwnerGrokImageReferenceLifecycleOptions {
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollDelayMs?: number;
  readonly maxPollAttempts?: number;
  /** Deterministic test seam; production leaves this unset. */
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export interface GenerateOwnerGrokImageReferenceInput {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly candidate: OwnerGrokImageReferencePreparedCandidate;
  readonly permit: OwnerGrokImageReferenceOneShotPermit;
  readonly reference_handles: readonly string[];
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly referenceStore: OwnerMediaReferenceStore;
  readonly resolveAuthPrincipal: (attemptId: string, signal: AbortSignal) => Promise<GenerationPrincipalRef>;
  readonly preflight: OwnerGrokImageReferenceLifecyclePreflight;
  readonly client: OwnerGrokImageReferenceDispatchClient;
  readonly signal?: AbortSignal;
}

export interface ReconcileOwnerGrokImageReferenceInput {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly recovery_id: string;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveAuthPrincipal: (attemptId: string, signal: AbortSignal) => Promise<GenerationPrincipalRef>;
  readonly client: OwnerGrokImageReferenceReadClient;
  readonly signal?: AbortSignal;
}

export interface ListOwnerGrokImageReferenceRecoveriesInput {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly attemptId: string;
  readonly principal: GenerationPrincipalRef;
  readonly limit: number;
}

function snapshotGenerateInput(value: unknown) {
  const fields = readExactRecord(value, [
    "profile_set", "profile_id", "candidate", "permit", "reference_handles", "binding", "attemptId",
    "linkService", "referenceStore", "resolveAuthPrincipal", "preflight", "client", "signal"
  ], [
    "profile_set", "profile_id", "candidate", "permit", "reference_handles", "binding", "attemptId",
    "linkService", "referenceStore", "resolveAuthPrincipal", "preflight", "client"
  ]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.profile_id !== "string" || typeof fields.resolveAuthPrincipal !== "function" ||
      !(fields.referenceStore instanceof OwnerMediaReferenceStore) || types.isProxy(fields.referenceStore) ||
      (fields.signal !== undefined && !(fields.signal instanceof AbortSignal))) invalid();
  const binding = snapshotBinding(fields.binding);
  const referenceHandles = snapshotStringArray(fields.reference_handles);
  const linkService = snapshotLinkService(fields.linkService);
  const preflight = snapshotPreflight(fields.preflight);
  const readClient = snapshotReadClient(fields.client);
  const createChat = findDataMethod(fields.client as object, "createChat");
  const startGrok = findDataMethod(fields.client as object, "startGrokImageWithInternalReferences");
  if (typeof createChat !== "function" || typeof startGrok !== "function") invalid();
  const client: OwnerGrokImageReferenceDispatchClient = Object.freeze({
    ...readClient,
    createChat: (scope: "image", title: string, signal?: AbortSignal) =>
      Reflect.apply(createChat, fields.client, [scope, title, signal]) as Promise<CreateChatReceipt>,
    startGrokImageWithInternalReferences: (request: StartImageRequest,
      references: readonly InternalUploadReference[], signal?: AbortSignal) =>
      Reflect.apply(startGrok, fields.client, [request, references, signal]) as Promise<MediaGenerationReceipt>
  });
  return {
    profileSet: fields.profile_set as OwnerGrokImageReferenceProfileSet,
    profileId: fields.profile_id as OwnerGrokImageReferenceProfileId,
    candidate: fields.candidate as OwnerGrokImageReferencePreparedCandidate,
    permit: fields.permit as OwnerGrokImageReferenceOneShotPermit,
    referenceHandles,
    binding,
    attemptId,
    linkService,
    referenceStore: fields.referenceStore,
    resolveAuthPrincipal: fields.resolveAuthPrincipal as GenerateOwnerGrokImageReferenceInput["resolveAuthPrincipal"],
    preflight,
    client,
    signal: fields.signal as AbortSignal | undefined
  };
}

function snapshotReconcileInput(value: unknown) {
  const fields = readExactRecord(value, [
    "profile_set", "profile_id", "attemptId", "recovery_id", "binding", "linkService",
    "resolveAuthPrincipal", "client", "signal"
  ], ["profile_set", "profile_id", "attemptId", "recovery_id", "binding", "linkService", "resolveAuthPrincipal", "client"]);
  const attemptId = safeAttempt(fields.attemptId);
  if (typeof fields.profile_id !== "string" || typeof fields.recovery_id !== "string" ||
      !RECOVERY_PATTERN.test(fields.recovery_id) || typeof fields.resolveAuthPrincipal !== "function" ||
      (fields.signal !== undefined && !(fields.signal instanceof AbortSignal))) invalid();
  const binding = snapshotBinding(fields.binding);
  const linkService = snapshotLinkService(fields.linkService);
  const client = snapshotReadClient(fields.client);
  return {
    profileSet: fields.profile_set as OwnerGrokImageReferenceProfileSet,
    profileId: fields.profile_id as OwnerGrokImageReferenceProfileId,
    attemptId,
    recoveryId: fields.recovery_id,
    binding,
    linkService,
    resolveAuthPrincipal: fields.resolveAuthPrincipal as ReconcileOwnerGrokImageReferenceInput["resolveAuthPrincipal"],
    client,
    signal: fields.signal as AbortSignal | undefined
  };
}

function snapshotReadClient(value: unknown): OwnerGrokImageReferenceReadClient {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  const history = findDataMethod(value, "listMessageCandidates");
  const getBatch = findDataMethod(value, "getGrokImageBatchMessage");
  if (typeof history !== "function" || typeof getBatch !== "function") invalid();
  return Object.freeze({
    listMessageCandidates: (chatUuid: string, echoId: string, signal?: AbortSignal) =>
      Reflect.apply(history, value, [chatUuid, echoId, signal]) as Promise<ChatMessageHistorySnapshot>,
    getGrokImageBatchMessage: (chatUuid: string, messageId: string, modelType: "grok_i2i" | "grok_i2i_pro", signal?: AbortSignal) =>
      Reflect.apply(getBatch, value, [chatUuid, messageId, modelType, signal]) as Promise<InternalGrokImageBatchEnvelope>
  });
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid();
  const getStatus = findDataMethod(value, "getStatus");
  if (typeof getStatus !== "function") invalid();
  return Object.freeze({
    getStatus: (binding, attemptId) =>
      Reflect.apply(getStatus, value, [binding, attemptId]) as ReturnType<PerUserLinkService["getStatus"]>
  });
}

function snapshotPreflight(value: unknown): OwnerGrokImageReferenceLifecyclePreflight {
  const fields = readExactRecord(value, ["verifyFreshSubscription", "verifyModelAccess", "authorizeCost"]);
  if (Object.values(fields).some((item) => typeof item !== "function")) invalid();
  return Object.freeze({
    verifyFreshSubscription: fields.verifyFreshSubscription as OwnerGrokImageReferenceLifecyclePreflight["verifyFreshSubscription"],
    verifyModelAccess: fields.verifyModelAccess as OwnerGrokImageReferenceLifecyclePreflight["verifyModelAccess"],
    authorizeCost: fields.authorizeCost as OwnerGrokImageReferenceLifecyclePreflight["authorizeCost"]
  });
}

function snapshotBinding(value: unknown): AuthBinding {
  const fields = readExactRecord(value, ["tenant_id", "subject"]);
  if (typeof fields.tenant_id !== "string" || typeof fields.subject !== "string") invalid();
  return Object.freeze({ tenant_id: fields.tenant_id, subject: fields.subject });
}

function snapshotStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
  if (!Number.isSafeInteger(length) || length < 1 || length > 3 || keys.length !== length + 1 ||
      keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) invalid();
  const result: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        typeof descriptor.value !== "string" || !/^reference_[0-9a-f-]{36}$/u.test(descriptor.value) ||
        result.includes(descriptor.value)) invalid();
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function getProfile(set: OwnerGrokImageReferenceProfileSet, profileId: OwnerGrokImageReferenceProfileId) {
  try { return getOwnerGrokImageReferenceProfile(set, profileId); }
  catch { invalid("PROFILE_MISMATCH"); }
}

function candidateMatchesProfile(
  candidate: OwnerGrokImageReferencePreparedCandidate,
  profile: ReturnType<typeof getProfile>,
  binding: NonNullable<ReturnType<typeof getOwnerGrokImageReferenceCandidateBinding>>,
  handles: readonly string[]
): boolean {
  const settings = candidate.request?.settings;
  return candidate.dispatch_allowed === false && candidate.status === "blocked" &&
    candidate.backend_acceptance === "unproven" && candidate.profile_id === profile.profile_id &&
    candidate.profile_set_sha256.length === 71 && candidate.profile_schema_hash === profile.schema_hash &&
    candidate.profile_catalog_version === profile.catalog_version && candidate.model_id === profile.model_id &&
    candidate.model_type === profile.model_type && candidate.variant_id === profile.variant_id &&
    candidate.operation_id === profile.operation_id && candidate.modality === "image" &&
    candidate.reference_count === handles.length && candidate.reference_order_sha256 === binding.reference_order_sha256 &&
    candidate.request_fingerprint === binding.request_fingerprint &&
    binding.reference_order_sha256 === schemaHash({ profile_id: profile.profile_id, reference_handles: handles }) &&
    settings?.n === 1 && settings.model_type === profile.model_type &&
    Number.isSafeInteger(settings.batch_size) && (settings.batch_size as number) >= 1 && (settings.batch_size as number) <= 5 &&
    (settings.resolution === "1k" || settings.resolution === "2k") &&
    (profile.aspect_ratio_policy.mode === "required"
      ? typeof settings.aspect_ratio === "string" && profile.aspect_ratio_policy.allowed_values.includes(settings.aspect_ratio as never)
      : !Object.hasOwn(settings, "aspect_ratio"));
}

function candidateFileUrls(candidate: OwnerGrokImageReferencePreparedCandidate, expectedCount: number): string[] {
  const settings = candidate.request?.settings;
  const values = settings?.file_urls;
  if (!Array.isArray(values) || types.isProxy(values) || values.length !== expectedCount) invalid("CANDIDATE_INVALID");
  return values.map((value) => {
    const fields = readExactRecord(value, ["type", "url"]);
    if (fields.type !== "image" || typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url)) invalid("CANDIDATE_INVALID");
    return fields.url;
  });
}

function findOwnedBotMessage(
  snapshotInput: ChatMessageHistorySnapshot,
  chatUuid: string,
  echoMessageId: string,
  modelType: "grok_i2i" | "grok_i2i_pro"
): { readonly echoMessageId: string; readonly botMessageId: string; readonly objectIds: readonly string[] } | null {
  const snapshot = readPlainRecord(snapshotInput);
  if (!Array.isArray(snapshot.messages) || types.isProxy(snapshot.messages) || snapshot.messages.length > 10 ||
      snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== 10 ||
      snapshot.total_pages !== 1 || snapshot.has_next !== false || snapshot.has_previous !== false ||
      snapshot.total_count !== snapshot.messages.length || snapshot.requested_chat_uuid !== chatUuid ||
      !safeIdentifier(snapshot.provider_chat_id)) invalid("OUTCOME_UNKNOWN");
  const messages = snapshot.messages.map((value) => readExactRecord(value, [
    "message_id", "provider_chat_id", "author_role", "objects"
  ]));
  if (messages.some((message) => message.provider_chat_id !== snapshot.provider_chat_id || !safeIdentifier(message.message_id) ||
      !["owner", "bot", "other"].includes(String(message.author_role)) || !Array.isArray(message.objects) ||
      types.isProxy(message.objects))) invalid("OUTCOME_UNKNOWN");
  const owners = messages.filter((message) => message.author_role === "owner");
  if (owners.length !== 1 || owners[0]!.message_id !== echoMessageId) invalid("OUTCOME_UNKNOWN");
  if (messages.length !== 2 || messages[0] !== owners[0]) invalid("OUTCOME_UNKNOWN");
  const bot = messages[1]!;
  if (bot.author_role !== "bot") return null;
  const objects = bot.objects as unknown[];
  if (objects.length === 0) return null;
  if (objects.length > 5) invalid("OUTCOME_UNKNOWN");
  const objectIds: string[] = [];
  for (const value of objects) {
    const object = readExactRecord(value, ["message_object_id", "object_type", "model_type"]);
    if (!safeIdentifier(object.message_object_id) || object.object_type !== "image" || object.model_type !== modelType ||
        objectIds.includes(object.message_object_id as string)) invalid("OUTCOME_UNKNOWN");
    objectIds.push(object.message_object_id as string);
  }
  return Object.freeze({
    echoMessageId,
    botMessageId: bot.message_id as string,
    objectIds: Object.freeze(objectIds)
  });
}

function validateBatchEnvelope(
  input: InternalGrokImageBatchEnvelope | unknown,
  recovery: RecoveryRecord,
  expectedObjectIds: readonly string[]
): OwnerGrokImageReferenceLifecycleArtifact[] {
  const envelope = readPlainRecord(input);
  if (envelope.status !== "COMPLETE" || envelope.chat_uuid !== recovery.chat_uuid ||
      envelope.message_id !== recovery.bot_message_id || envelope.model_type !== recovery.model_type ||
      !Array.isArray(envelope.objects) || types.isProxy(envelope.objects) ||
      envelope.objects.length !== expectedObjectIds.length || envelope.objects.length > 5) invalid("OUTCOME_UNKNOWN");
  const artifacts: OwnerGrokImageReferenceLifecycleArtifact[] = [];
  for (let index = 0; index < envelope.objects.length; index += 1) {
    const object = readExactRecord(envelope.objects[index], [
      "message_object_id", "message_id", "object_type", "model_type", "completed",
      "object_url", "mime_type", "mime_source"
    ]);
    if (object.message_object_id !== expectedObjectIds[index] || object.message_id !== recovery.bot_message_id ||
        object.object_type !== "image" || object.model_type !== recovery.model_type || object.completed !== true ||
        typeof object.object_url !== "string" || !isSafeUploadReferenceUrl(object.object_url) ||
        !OUTPUT_MIME_ALLOWLIST.has(String(object.mime_type)) || object.mime_source !== "URL_EXTENSION") invalid("OUTCOME_UNKNOWN");
    artifacts.push(Object.freeze({
      url: object.object_url,
      mime_type: object.mime_type as "image/jpeg" | "image/png",
      mime_source: "URL_EXTENSION",
      message_object_id: object.message_object_id as string
    }));
  }
  return artifacts;
}

function readExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
    !("value" in descriptors[key]!) || !descriptors[key]!.enumerable
  ) || requiredKeys.some((key) => !Object.hasOwn(descriptors, key))) invalid();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function readPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid("OUTCOME_UNKNOWN");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid("OUTCOME_UNKNOWN");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) {
    invalid("OUTCOME_UNKNOWN");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function findDataMethod(target: object, name: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function principalForAttempt(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { invalid("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) invalid("PRINCIPAL_MISMATCH");
  return principal;
}

function principalFromBinding(binding: AuthBinding, attemptId: string): Readonly<GenerationPrincipalRef> {
  return snapshotGenerationPrincipal({
    tenant_id: binding.tenant_id,
    subject_id: binding.subject,
    connection_id: attemptId
  });
}

function safeAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT_PATTERN.test(value)) invalid();
  return value;
}

function safeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}

function withDeadline<T>(deadline: AbsoluteRequestDeadline, operation: () => Promise<T>): Promise<T> {
  deadline.throwIfAborted();
  return deadline.waitFor(Promise.resolve().then(operation));
}

function initialUnknownDiagnostic(): MutableOwnerGrokImageReferenceUnknownDiagnostic {
  return {
    phase: "PRE_DISPATCH", echo_ack_known: false, history_get_eligible: false, history_get_performed: false,
    history_get_count: 0, history_get_count_capped: false, history_match: "NOT_RUN",
    result_get_performed: false, result_get_count: 0, result_get_count_capped: false,
    result_binding_known: false, upstream_error_code: null
  };
}

function snapshotUnknownDiagnostic(input: MutableOwnerGrokImageReferenceUnknownDiagnostic): OwnerGrokImageReferenceUnknownDiagnostic {
  return Object.freeze({ ...input });
}

function snapshotSafeUnknownDiagnostic(input: unknown): OwnerGrokImageReferenceUnknownDiagnostic {
  const fields = readExactRecord(input, [
    "phase", "echo_ack_known", "history_get_eligible", "history_get_performed", "history_get_count",
    "history_get_count_capped", "history_match", "result_get_performed", "result_get_count",
    "result_get_count_capped", "result_binding_known", "upstream_error_code"
  ]);
  const phase = fields.phase;
  const historyMatch = fields.history_match;
  const upstreamCode = fields.upstream_error_code;
  const validCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_UNKNOWN_DIAGNOSTIC_GETS;
  if (!(OWNER_GROK_UNKNOWN_DIAGNOSTIC_PHASES as readonly unknown[]).includes(phase) ||
      !(OWNER_GROK_UNKNOWN_HISTORY_MATCHES as readonly unknown[]).includes(historyMatch) ||
      !(upstreamCode === null || (typeof upstreamCode === "string" &&
        (OWNER_GROK_UNKNOWN_UPSTREAM_ERROR_CODES as readonly string[]).includes(upstreamCode))) ||
      typeof fields.echo_ack_known !== "boolean" || typeof fields.history_get_eligible !== "boolean" ||
      typeof fields.history_get_performed !== "boolean" || !validCount(fields.history_get_count) ||
      typeof fields.history_get_count_capped !== "boolean" || typeof fields.result_get_performed !== "boolean" ||
      !validCount(fields.result_get_count) || typeof fields.result_get_count_capped !== "boolean" ||
      typeof fields.result_binding_known !== "boolean") invalid("INVALID_REQUEST");
  return Object.freeze({
    phase: phase as OwnerGrokImageReferenceUnknownDiagnostic["phase"],
    echo_ack_known: fields.echo_ack_known as boolean,
    history_get_eligible: fields.history_get_eligible as boolean,
    history_get_performed: fields.history_get_performed as boolean,
    history_get_count: fields.history_get_count as number,
    history_get_count_capped: fields.history_get_count_capped as boolean,
    history_match: historyMatch as OwnerGrokImageReferenceUnknownDiagnostic["history_match"],
    result_get_performed: fields.result_get_performed as boolean,
    result_get_count: fields.result_get_count as number,
    result_get_count_capped: fields.result_get_count_capped as boolean,
    result_binding_known: fields.result_binding_known as boolean,
    upstream_error_code: upstreamCode as SyntxHttpErrorCode | null
  });
}

function unknown(record: RecoveryRecord, cause?: unknown): OwnerGrokImageReferenceLifecycleError {
  const code = safeUpstreamErrorCode(cause);
  if (code !== null) record.diagnostic.upstream_error_code = code;
  return new OwnerGrokImageReferenceLifecycleError("OUTCOME_UNKNOWN", record.recovery_id, snapshotUnknownDiagnostic(record.diagnostic));
}

function safeUpstreamErrorCode(error: unknown): SyntxHttpErrorCode | null {
  if (!error || typeof error !== "object" || types.isProxy(error) || !(error instanceof SyntxHttpError)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
      !(OWNER_GROK_UNKNOWN_UPSTREAM_ERROR_CODES as readonly string[]).includes(descriptor.value)) return null;
  return descriptor.value as SyntxHttpErrorCode;
}

function incrementDiagnosticGet(record: RecoveryRecord, kind: "history" | "result"): void {
  const field = kind === "history" ? "history_get_count" : "result_get_count";
  const capped = kind === "history" ? "history_get_count_capped" : "result_get_count_capped";
  record.diagnostic[kind === "history" ? "history_get_performed" : "result_get_performed"] = true;
  if (record.diagnostic[field] >= MAX_UNKNOWN_DIAGNOSTIC_GETS) record.diagnostic[capped] = true;
  else record.diagnostic[field] += 1;
}

function invalid(code: OwnerGrokImageReferenceLifecycleErrorCode = "INVALID_REQUEST"): never {
  throw new OwnerGrokImageReferenceLifecycleError(code);
}

export interface OwnerGrokImageReferenceLifecycleArtifact {
  readonly url: string;
  readonly mime_type: "image/jpeg" | "image/png";
  readonly mime_source: "URL_EXTENSION";
  readonly message_object_id: string;
}

export interface OwnerGrokImageReferenceLifecycleResult {
  readonly status: "result_observed";
  readonly backend_acceptance: "unproven";
  readonly profile_schema_hash: string;
  readonly profile_set_sha256: string;
  readonly request_fingerprint: string;
  readonly model_id: "grok_i2i" | "grok_i2i_pro";
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly variant_id: OwnerGrokImageReferenceProfileId;
  readonly requested_batch_size: number;
  readonly actual_result_count: number;
  readonly batch_count_matches_requested: true;
  readonly mime_confidence: "URL_EXTENSION_ONLY";
  readonly artifacts: readonly OwnerGrokImageReferenceLifecycleArtifact[];
}

export interface OwnerGrokImageReferenceRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: "grok_i2i" | "grok_i2i_pro";
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly created_at: string;
  readonly requested_batch_size: number;
  readonly diagnostic: OwnerGrokImageReferenceUnknownDiagnostic;
}

interface RecoveryRecord {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly profile_set_sha256: string;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly profile_catalog_version: string;
  readonly model_id: "grok_i2i" | "grok_i2i_pro";
  readonly model_type: "grok_i2i" | "grok_i2i_pro";
  readonly variant_id: OwnerGrokImageReferenceProfileId;
  readonly request_fingerprint: string;
  readonly reference_order_sha256: string;
  readonly reference_count: number;
  readonly requested_batch_size: number;
  readonly chat_uuid: string;
  echo_message_id: string | null;
  bot_message_id: string | null;
  diagnostic: MutableOwnerGrokImageReferenceUnknownDiagnostic;
  readonly created_at: string;
  readonly expires_at: number;
}

export type OwnerGrokImageReferenceLifecycleErrorCode =
  | "INVALID_REQUEST"
  | "SERVICE_CLOSED"
  | "SERVICE_BUSY"
  | "PROFILE_MISMATCH"
  | "CANDIDATE_INVALID"
  | "PERMIT_INVALID"
  | "PRINCIPAL_MISMATCH"
  | "REFERENCE_UNAVAILABLE"
  | "PRE_DISPATCH_FAILED"
  | "OUTCOME_UNKNOWN"
  | "RECOVERY_NOT_FOUND";

export class OwnerGrokImageReferenceLifecycleError extends Error {
  readonly diagnostic?: OwnerGrokImageReferenceUnknownDiagnostic;

  constructor(
    readonly code: OwnerGrokImageReferenceLifecycleErrorCode,
    readonly recovery_id?: string,
    diagnostic?: OwnerGrokImageReferenceUnknownDiagnostic
  ) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Grok reference request may have been dispatched; do not repeat it. Reconcile using the known recovery handle."
      : "The owner Grok reference operation could not be completed safely.");
    this.name = "OwnerGrokImageReferenceLifecycleError";
    if (code === "OUTCOME_UNKNOWN" && diagnostic !== undefined) this.diagnostic = snapshotSafeUnknownDiagnostic(diagnostic);
  }
}

/** Private one-POST lifecycle; no ordinary image dispatch fallback exists. */
export class OwnerGrokImageReferenceLifecycle {
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #pollDelayMs: number;
  readonly #maxPollAttempts: number;
  readonly #wait?: OwnerGrokImageReferenceLifecycleOptions["wait"];
  readonly #records = new Map<string, RecoveryRecord>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  #pending = 0;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerGrokImageReferenceLifecycleOptions = {}) {
    const fields = readExactRecord(options, ["now", "timeoutMs", "pollDelayMs", "maxPollAttempts", "wait"], []);
    if ((fields.now !== undefined && typeof fields.now !== "function") ||
        (fields.wait !== undefined && typeof fields.wait !== "function")) invalid();
    this.#now = fields.now as (() => number) | undefined ?? Date.now;
    this.#timeoutMs = boundedInteger(fields.timeoutMs, 1, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    this.#pollDelayMs = boundedInteger(fields.pollDelayMs, 0, 10_000, DEFAULT_POLL_DELAY_MS);
    this.#maxPollAttempts = boundedInteger(fields.maxPollAttempts, 1, MAX_POLL_ATTEMPTS, MAX_POLL_ATTEMPTS);
    this.#wait = fields.wait as OwnerGrokImageReferenceLifecycleOptions["wait"];
  }

  generate(input: GenerateOwnerGrokImageReferenceInput | unknown): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const request = snapshotGenerateInput(input);
    return this.#track(request.attemptId, request.signal, async (signal) => this.#generate(request, signal));
  }

  reconcile(input: ReconcileOwnerGrokImageReferenceInput | unknown): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const request = snapshotReconcileInput(input);
    return this.#track(request.attemptId, request.signal, async (signal) => this.#reconcile(request, signal));
  }

  async listRecoveries(input: ListOwnerGrokImageReferenceRecoveriesInput): Promise<readonly OwnerGrokImageReferenceRecoveryListItem[]> {
    if (this.#closed) invalid("SERVICE_CLOSED");
    const request = readExactRecord(input, ["profile_set", "profile_id", "attemptId", "principal", "limit"]);
    const set = request.profile_set as OwnerGrokImageReferenceProfileSet;
    const attemptId = safeAttempt(request.attemptId);
    const principal = principalForAttempt(request.principal, attemptId);
    if (typeof request.profile_id !== "string") invalid("PROFILE_MISMATCH");
    const profile = getProfile(set, request.profile_id as OwnerGrokImageReferenceProfileId);
    if (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 20) invalid();
    this.#prune();
    const result = [...this.#records.values()]
      .filter((record) => record.attempt_id === attemptId && record.profile_set_sha256 === set.profile_set_sha256 &&
        record.profile_id === profile.profile_id && record.profile_schema_hash === profile.schema_hash &&
        record.model_id === profile.model_id && sameGenerationPrincipal(record.principal, principal))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, request.limit as number)
      .map((record) => Object.freeze({
        recovery_id: record.recovery_id, model_id: record.model_id, profile_id: record.profile_id,
        created_at: record.created_at, requested_batch_size: record.requested_batch_size,
        diagnostic: snapshotSafeUnknownDiagnostic(record.diagnostic)
      }));
    return Object.freeze(result);
  }

  async invalidateAttempt(attemptIdInput: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptIdInput)) return;
    for (const controller of this.#controllers.get(attemptIdInput) ?? []) controller.abort();
    await Promise.allSettled([...(this.#pendingByAttempt.get(attemptIdInput) ?? [])]);
    for (const [recoveryId, record] of this.#records) {
      if (record.attempt_id === attemptIdInput) this.#records.delete(recoveryId);
    }
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
      await Promise.allSettled([...this.#pendingByAttempt.values()].flatMap((pending) => [...pending]));
      this.#records.clear();
      this.#controllers.clear();
      this.#pendingByAttempt.clear();
    })();
    return this.#closing;
  }

  async #generate(
    request: ReturnType<typeof snapshotGenerateInput>,
    signal: AbortSignal
  ): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => new Error("OWNER_GROK_REFERENCE_DEADLINE"));
    let recovery: RecoveryRecord | undefined;
    let dispatchPossible = false;
    try {
      deadline.throwIfAborted();
      const initialPrincipal = await this.#resolvePrincipal(request.resolveAuthPrincipal, request.attemptId, deadline.signal);
      this.#assertCurrentPrincipal(initialPrincipal, principalFromBinding(request.binding, request.attemptId));
      const profile = getProfile(request.profileSet, request.profileId);
      const binding = getOwnerGrokImageReferenceCandidateBinding(
        request.candidate, request.profileSet, request.profileId, initialPrincipal, request.attemptId
      );
      if (!binding || !candidateMatchesProfile(request.candidate, profile, binding, request.referenceHandles)) invalid("CANDIDATE_INVALID");
      const fileUrls = candidateFileUrls(request.candidate, request.referenceHandles.length);
      if (request.referenceHandles.length < profile.reference_bounds.minimum ||
          request.referenceHandles.length > profile.reference_bounds.maximum) invalid("CANDIDATE_INVALID");
      if (this.#records.size + this.#pending >= MAX_RECOVERIES) {
        this.#prune();
        if (this.#records.size + this.#pending >= MAX_RECOVERIES) invalid("SERVICE_BUSY");
      }

      await withDeadline(deadline, () => request.preflight.verifyFreshSubscription(
        request.attemptId, initialPrincipal, profile.model_id, deadline.signal
      ));
      await withDeadline(deadline, () => request.preflight.verifyModelAccess(
        request.attemptId, initialPrincipal, profile.model_id, deadline.signal
      ));
      await withDeadline(deadline, () => request.preflight.authorizeCost(
        request.attemptId, initialPrincipal, request.candidate, deadline.signal
      ));
      this.#assertCurrentPrincipal(await this.#resolvePrincipal(
        request.resolveAuthPrincipal, request.attemptId, deadline.signal
      ), initialPrincipal);

      deadline.throwIfAborted();
      consumeOwnerGrokImageReferenceOneShotPermit({
        permit: request.permit,
        candidate: request.candidate,
        profile_set: request.profileSet,
        profile_id: request.profileId,
        principal: initialPrincipal,
        attemptId: request.attemptId
      });
      const storeContract = getOwnerGrokReferenceStoreBinding(request.profileSet, request.profileId);
      await withDeadline(deadline, () => request.referenceStore.consumeOrderedImageReferences({
        server_contract: profile.model_id,
        binding: request.binding,
        attemptId: request.attemptId,
        linkService: request.linkService,
        contract: storeContract,
        reference_handles: request.referenceHandles,
        expected_file_urls: fileUrls
      }));
      this.#assertCurrentPrincipal(await this.#resolvePrincipal(
        request.resolveAuthPrincipal, request.attemptId, deadline.signal
      ), initialPrincipal);
      deadline.throwIfAborted();
      const chat = await withDeadline(deadline, () => request.client.createChat(
        "image", "owner-grok-reference-" + randomUUID(), deadline.signal
      ));
      if (!chat || !safeIdentifier(chat.chat_uuid)) throw new Error("OWNER_GROK_REFERENCE_CHAT_INVALID");
      recovery = this.#newRecovery(request, initialPrincipal, profile, binding, chat.chat_uuid);
      this.#records.set(recovery.recovery_id, recovery);
      deadline.throwIfAborted();
      this.#assertCurrentPrincipal(await this.#resolvePrincipal(
        request.resolveAuthPrincipal, request.attemptId, deadline.signal
      ), initialPrincipal);
      deadline.throwIfAborted();
      recovery.diagnostic.phase = "POST_CALL_STARTED";
      dispatchPossible = true;
      const dispatchSettings = Object.freeze({ ...request.candidate.request.settings, file_urls: Object.freeze([]) });
      const receipt = await withDeadline(deadline, () => request.client.startGrokImageWithInternalReferences({
        ai_name: "grok_image",
        prompt: request.candidate.request.prompt,
        settings: dispatchSettings,
        chat_uuid: chat.chat_uuid
      }, Object.freeze(fileUrls.map((url) => Object.freeze({ url }))), deadline.signal));
      if (!receipt || receipt.chat_uuid !== chat.chat_uuid || !safeIdentifier(receipt.message_id)) {
        throw new Error("OWNER_GROK_REFERENCE_ACK_INVALID");
      }
      recovery.echo_message_id = receipt.message_id;
      recovery.diagnostic.phase = "POST_ACK_KNOWN";
      recovery.diagnostic.echo_ack_known = true;
      recovery.diagnostic.history_get_eligible = true;
      return await this.#pollForCompleteBatch(recovery, request.client, deadline);
    } catch (error) {
      if (dispatchPossible && recovery) throw unknown(recovery, error);
      if (recovery) this.#records.delete(recovery.recovery_id);
      if (error instanceof OwnerGrokImageReferenceLifecycleError) throw error;
      if (error instanceof OwnerMediaReferenceStoreError) invalid("REFERENCE_UNAVAILABLE");
      if (error instanceof OwnerGrokImageReferenceOneShotPolicyError) invalid("PERMIT_INVALID");
      if (error instanceof OwnerGrokImageReferencePrepareError) invalid("CANDIDATE_INVALID");
      if (deadline.abortSource !== null) invalid("PRE_DISPATCH_FAILED");
      throw new OwnerGrokImageReferenceLifecycleError("PRE_DISPATCH_FAILED");
    } finally {
      deadline.close();
    }
  }

  async #reconcile(
    request: ReturnType<typeof snapshotReconcileInput>,
    signal: AbortSignal
  ): Promise<OwnerGrokImageReferenceLifecycleResult> {
    const record = this.#getRecovery(request.recoveryId, request.attemptId);
    if (record.profile_set_sha256 !== request.profileSet.profile_set_sha256 ||
        record.profile_id !== request.profileId) invalid("RECOVERY_NOT_FOUND");
    const principal = await this.#resolvePrincipal(request.resolveAuthPrincipal, request.attemptId, signal);
    if (!sameGenerationPrincipal(principal, record.principal) ||
        !sameGenerationPrincipal(principal, principalFromBinding(request.binding, request.attemptId))) invalid("RECOVERY_NOT_FOUND");
    const profile = getProfile(request.profileSet, request.profileId);
    if (profile.model_id !== record.model_id || profile.model_type !== record.model_type ||
        profile.schema_hash !== record.profile_schema_hash || profile.variant_id !== record.variant_id ||
        profile.catalog_version !== record.profile_catalog_version) invalid("RECOVERY_NOT_FOUND");
    if (record.echo_message_id === null) {
      record.diagnostic.phase = "POST_CALL_STARTED";
      record.diagnostic.echo_ack_known = false;
      record.diagnostic.history_get_eligible = false;
      throw unknown(record);
    }
    const deadline = new AbsoluteRequestDeadline(this.#timeoutMs, signal, () => new Error("OWNER_GROK_REFERENCE_DEADLINE"));
    try { return await this.#pollForCompleteBatch(record, request.client, deadline); }
    catch (error) {
      if (error instanceof OwnerGrokImageReferenceLifecycleError && error.code !== "OUTCOME_UNKNOWN") throw error;
      throw unknown(record, error);
    } finally {
      deadline.close();
    }
  }

  async #pollForCompleteBatch(
    record: RecoveryRecord,
    client: OwnerGrokImageReferenceReadClient,
    deadline: AbsoluteRequestDeadline
  ): Promise<OwnerGrokImageReferenceLifecycleResult> {
    for (let attempt = 0; attempt < this.#maxPollAttempts; attempt += 1) {
      deadline.throwIfAborted();
      if (record.echo_message_id === null) {
        record.diagnostic.phase = "POST_CALL_STARTED";
        record.diagnostic.echo_ack_known = false;
        record.diagnostic.history_get_eligible = false;
        throw unknown(record);
      }
      record.diagnostic.echo_ack_known = true;
      record.diagnostic.history_get_eligible = true;
      record.diagnostic.phase = "HISTORY_GET";
      incrementDiagnosticGet(record, "history");
      let history: ChatMessageHistorySnapshot;
      try {
        history = await withDeadline(deadline, () =>
          client.listMessageCandidates(record.chat_uuid, record.echo_message_id!, deadline.signal)
        );
      } catch (error) {
        throw unknown(record, error);
      }
      let match: ReturnType<typeof findOwnedBotMessage>;
      try { match = findOwnedBotMessage(history, record.chat_uuid, record.echo_message_id, record.model_type); }
      catch (error) {
        record.diagnostic.phase = "HISTORY_BINDING";
        record.diagnostic.history_match = "INVALID";
        throw unknown(record, error);
      }
      if (match === null) {
        record.diagnostic.phase = "HISTORY_WAIT";
        record.diagnostic.history_match = "NONE";
        if (attempt + 1 < this.#maxPollAttempts) await this.#waitForPoll(deadline);
        continue;
      }
      record.diagnostic.history_match = "UNIQUE";
      record.echo_message_id = match.echoMessageId;
      record.bot_message_id = match.botMessageId;
      record.diagnostic.phase = "RESULT_GET";
      incrementDiagnosticGet(record, "result");
      let batch: InternalGrokImageBatchEnvelope;
      try {
        batch = await withDeadline(deadline, () => client.getGrokImageBatchMessage(
          record.chat_uuid, match.botMessageId, record.model_type, deadline.signal
        ));
      } catch (error) {
        throw unknown(record, error);
      }
      let artifacts: OwnerGrokImageReferenceLifecycleArtifact[];
      try { artifacts = validateBatchEnvelope(batch, record, match.objectIds); }
      catch (error) {
        record.diagnostic.phase = "RESULT_BINDING";
        record.diagnostic.result_binding_known = false;
        throw unknown(record, error);
      }
      record.diagnostic.result_binding_known = true;
      if (artifacts.length > record.requested_batch_size) {
        record.diagnostic.phase = "RESULT_BINDING";
        record.diagnostic.result_binding_known = false;
        throw unknown(record);
      }
      if (artifacts.length === record.requested_batch_size) {
        this.#records.delete(record.recovery_id);
        return Object.freeze({
          status: "result_observed",
          backend_acceptance: "unproven",
          profile_schema_hash: record.profile_schema_hash,
          profile_set_sha256: record.profile_set_sha256,
          request_fingerprint: record.request_fingerprint,
          model_id: record.model_id,
          profile_id: record.profile_id,
          variant_id: record.variant_id,
          requested_batch_size: record.requested_batch_size,
          actual_result_count: artifacts.length,
          batch_count_matches_requested: true,
          mime_confidence: "URL_EXTENSION_ONLY",
          artifacts: Object.freeze(artifacts)
        });
      }
      record.diagnostic.phase = "RESULT_WAIT";
      if (attempt + 1 < this.#maxPollAttempts) await this.#waitForPoll(deadline);
    }
    throw unknown(record);
  }

  async #waitForPoll(deadline: AbsoluteRequestDeadline): Promise<void> {
    deadline.throwIfAborted();
    if (this.#pollDelayMs === 0) return;
    const wait = this.#wait
      ? this.#wait(this.#pollDelayMs, deadline.signal)
      : new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            deadline.signal.removeEventListener("abort", onAbort);
            resolve();
          }, this.#pollDelayMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new Error("OWNER_GROK_REFERENCE_WAIT_ABORTED"));
          };
          deadline.signal.addEventListener("abort", onAbort, { once: true });
        });
    await deadline.waitFor(wait);
  }

  #newRecovery(
    request: ReturnType<typeof snapshotGenerateInput>,
    principal: Readonly<GenerationPrincipalRef>,
    profile: ReturnType<typeof getProfile>,
    binding: NonNullable<ReturnType<typeof getOwnerGrokImageReferenceCandidateBinding>>,
    chatUuid: string
  ): RecoveryRecord {
    const now = this.#readNow();
    return {
      recovery_id: "recovery_" + randomUUID(),
      attempt_id: request.attemptId,
      principal,
      profile_set_sha256: binding.profile_set_sha256,
      profile_id: binding.profile_id,
      profile_schema_hash: binding.profile_schema_hash,
      catalog_version: binding.catalog_version,
      profile_catalog_version: profile.catalog_version,
      model_id: profile.model_id,
      model_type: profile.model_type,
      variant_id: profile.variant_id,
      request_fingerprint: binding.request_fingerprint,
      reference_order_sha256: binding.reference_order_sha256,
      reference_count: binding.reference_count,
      requested_batch_size: request.candidate.request.settings.batch_size as number,
      chat_uuid: chatUuid,
      echo_message_id: null,
      bot_message_id: null,
      diagnostic: initialUnknownDiagnostic(),
      created_at: new Date(now).toISOString(),
      expires_at: now + TTL_MS
    };
  }

  #getRecovery(recoveryId: string, attemptId: string): RecoveryRecord {
    if (!RECOVERY_PATTERN.test(recoveryId)) invalid("RECOVERY_NOT_FOUND");
    this.#prune();
    const record = this.#records.get(recoveryId);
    if (!record || record.attempt_id !== attemptId) invalid("RECOVERY_NOT_FOUND");
    return record;
  }

  async #resolvePrincipal(
    resolver: GenerateOwnerGrokImageReferenceInput["resolveAuthPrincipal"],
    attemptId: string,
    signal: AbortSignal
  ): Promise<Readonly<GenerationPrincipalRef>> {
    try {
      return snapshotGenerationPrincipal(await resolver(attemptId, signal));
    } catch {
      invalid("PRINCIPAL_MISMATCH");
    }
  }

  #assertCurrentPrincipal(current: Readonly<GenerationPrincipalRef>, expected: Readonly<GenerationPrincipalRef>): void {
    if (!sameGenerationPrincipal(current, expected)) invalid("PRINCIPAL_MISMATCH");
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - TTL_MS) invalid("SERVICE_CLOSED");
    return now;
  }

  #prune(): void {
    const now = this.#readNow();
    for (const [id, record] of this.#records) if (record.expires_at <= now) this.#records.delete(id);
  }

  #track<T>(attemptId: string, external: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new OwnerGrokImageReferenceLifecycleError("SERVICE_CLOSED"));
    if (this.#pending >= MAX_PENDING) return Promise.reject(new OwnerGrokImageReferenceLifecycleError("SERVICE_BUSY"));
    const controller = new AbortController();
    const signal = external ? AbortSignal.any([controller.signal, external]) : controller.signal;
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#controllers.set(attemptId, controllers);
    this.#pending += 1;
    const promise = Promise.resolve().then(() => operation(signal)).finally(() => {
      controllers.delete(controller);
      if (controllers.size === 0) this.#controllers.delete(attemptId);
      this.#pending -= 1;
      const pending = this.#pendingByAttempt.get(attemptId);
      pending?.delete(promise);
      if (pending?.size === 0) this.#pendingByAttempt.delete(attemptId);
    });
    const pending = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    pending.add(promise);
    this.#pendingByAttempt.set(attemptId, pending);
    return promise;
  }
}
