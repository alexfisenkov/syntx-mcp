import { randomUUID } from "node:crypto";
import { types } from "node:util";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { SyntxChatHttpClient, type MediaGenerationReceipt } from "../adapter/syntx/chat-http-client.js";
import { OwnerWan25I2vNativeError, type OwnerWan25I2vChatContext, type OwnerWan25I2vNativeOperationInput,
  type OwnerWan25I2vNativeChatOperationInput, type OwnerWan25I2vNativeResultOperationInput,
  type OwnerWan25I2vResultCandidates, type OwnerWan25I2vResultContext } from "../adapter/syntx/owner-wan25-i2v-native-context.js";
import type { OwnerWan25I2vVideoResult, OwnerWan25I2vReadyVideo } from "../adapter/syntx/owner-wan25-i2v-video-result.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import type { AuthBinding } from "../auth/types.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository, type DiscoveryModelRecord } from "../catalog/discovery-catalog.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import { AccountStatusService, type AccountStatusResult } from "./account-status.js";
import { ModelAccessService, type ModelAccessResult } from "./model-access.js";
import { isOwnerWan25I2vPreparedCandidate, isOwnerWan25I2vRequestPreparer,
  type OwnerWan25I2vPreparedCandidate, type OwnerWan25I2vPreparedCandidateBinding,
  type OwnerWan25I2vPreparedRequest, type OwnerWan25I2vRequestPreparer } from "./owner-wan25-i2v-request-preparer.js";
import { createOwnerWan25I2vOneShotPermit, revalidateOwnerWan25I2vOneShotPermit,
  type OwnerWan25I2vOneShotPermit } from "./owner-wan25-i2v-one-shot-policy.js";
import { getOwnerWan25I2vGenerationParametersSource, normalizeOwnerWan25I2vGenerationParameters,
  OwnerWan25I2vGenerationParametersError, type OwnerWan25I2vGenerationParametersInput } from "./owner-wan25-i2v-generation-parameters.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const MODEL_NAME = "wan_video" as const;
const CATALOG_VERSION = "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json" as const;
const MODEL_HASH = "sha256:ed71470b73f05fb23a224cfdcea1727c62e8d357ffcf09d747a26c6a57053e3a" as const;
const CATALOG_FETCHED_AT = "2026-10-15T07:17:24.901Z" as const;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const IMAGE_HANDLE = /^wan25image_[0-9a-f-]{36}$/u;
const RECOVERY_ID = /^wan25_generation_recovery_[0-9a-f-]{36}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MAX_RECOVERIES = 128;
const MAX_ACTIVE_RUNS = 4;
const PAGE_SIZE = 10;
const MAX_ARTIFACTS = 4096;
const MAX_CONTEXTS = 64;
const DEFAULT_TIMEOUT_MS = 120_000;
const PREFLIGHT_FRESH_MS = 120_000;
const SERVICE_BRAND = new WeakSet<object>();

export const OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION = CATALOG_VERSION;
export interface OwnerWan25I2vGenerationServiceOptions {
  readonly binding: AuthBinding; readonly linkService: PerUserLinkService; readonly catalog: DiscoveryCatalogRepository;
  readonly catalog_version: string; readonly preparer: OwnerWan25I2vRequestPreparer;
  readonly resolveChatClient: (attemptId: string) => unknown;
  readonly createAccountStatusService: (attemptId: string) => AccountStatusService;
  readonly createModelAccessService: (attemptId: string) => ModelAccessService;
  readonly now?: () => number; readonly timeoutMs?: number;
}

export function isOwnerWan25I2vGenerationService(value: unknown): value is OwnerWan25I2vGenerationService {
  return !!value && typeof value === "object" && !types.isProxy(value) && Object.isFrozen(value) && SERVICE_BRAND.has(value as object);
}
function snapshotGenerate(value: unknown): Readonly<OwnerWan25I2vGenerateInput> {
  const outer = exactRecord(value, ["attemptId", "request"]), attemptId = readAttempt(outer.attemptId);
  const raw = exactRecord(outer.request, ["model_id", "image_handle", "audio_handle", "prompt", "parameters"]);
  if (raw.model_id !== MODEL_ID || typeof raw.image_handle !== "string" || !IMAGE_HANDLE.test(raw.image_handle) || raw.audio_handle !== null || typeof raw.prompt !== "string") fail("INVALID_REQUEST");
  let normalized: ReturnType<typeof normalizeOwnerWan25I2vGenerationParameters>;
  try { normalized = normalizeOwnerWan25I2vGenerationParameters({ model_id: MODEL_ID, prompt: raw.prompt, parameters: raw.parameters }); }
  catch { fail("INVALID_REQUEST"); }
  const request: OwnerWan25I2vGenerationRequest = Object.freeze({ model_id: MODEL_ID, prompt: normalized.intent.prompt,
    parameters: normalized.intent.parameters, image_handle: raw.image_handle, audio_handle: null });
  return Object.freeze({ attemptId, request });
}
function snapshotRecovery(value: unknown): Readonly<OwnerWan25I2vReconcileInput> { const f = exactRecord(value, ["attemptId", "recovery_id"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id) }); }
function snapshotList(value: unknown): Readonly<OwnerWan25I2vRecoveryListInput> { const f = exactRecord(value, ["attemptId"], ["limit"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), limit: bounded(f.limit, 1, 128, 20) }); }
function snapshotPage(value: unknown): Readonly<OwnerWan25I2vResultPageInput> { const f = exactRecord(value, ["attemptId", "recovery_id"], ["offset"]);
  return Object.freeze({ attemptId: readAttempt(f.attemptId), recovery_id: readRecoveryId(f.recovery_id), offset: bounded(f.offset, 0, MAX_ARTIFACTS, 0) }); }
function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isPlainObject(value)) fail("INVALID_REQUEST"); let ds: PropertyDescriptorMap; try { ds = Object.getOwnPropertyDescriptors(value); } catch { fail("INVALID_REQUEST"); }
  const keys = Reflect.ownKeys(ds), allowed = [...required, ...optional]; if (required.some((key) => !Object.hasOwn(ds, key)) ||
    keys.some((key) => typeof key !== "string" || !allowed.includes(key) || !("value" in ds[key]!) || ds[key]!.enumerable !== true)) fail("INVALID_REQUEST");
  const result = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) result[key] = ds[key]!.value; return result;
}
function snapshotBinding(value: unknown): Readonly<AuthBinding> { const f = exactRecord(value, ["tenant_id", "subject"]);
  if (typeof f.tenant_id !== "string" || !f.tenant_id.trim() || f.tenant_id.length > 256 || /[\u0000-\u001f\u007f]/u.test(f.tenant_id) ||
      typeof f.subject !== "string" || !f.subject.trim() || f.subject.length > 512 || /[\u0000-\u001f\u007f]/u.test(f.subject)) fail("INVALID_REQUEST");
  return Object.freeze({ tenant_id: f.tenant_id, subject: f.subject }); }
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try { const p = Object.getPrototypeOf(value); return p === Object.prototype || p === null; } catch { return false; }
}
function readAttempt(value: unknown): string { if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST"); return value; }
function readRecoveryId(value: unknown): string { if (typeof value !== "string" || !RECOVERY_ID.test(value)) fail("INVALID_REQUEST"); return value; }
function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_REQUEST"); return value;
}
function validateSignal(signal?: AbortSignal): void { if (signal !== undefined && (!signal || types.isProxy(signal) || !(signal instanceof AbortSignal))) fail("INVALID_REQUEST"); }
function isLinkService(value: unknown): value is PerUserLinkService { try { return !!value && typeof value === "object" && !types.isProxy(value) &&
  Object.getPrototypeOf(value) === PerUserLinkService.prototype && !Object.hasOwn(value, "getStatus") &&
  Object.getOwnPropertyDescriptor(PerUserLinkService.prototype, "getStatus")?.value === PerUserLinkService.prototype.getStatus; } catch { return false; } }
function exactService<T extends object>(value: unknown, ctor: new (...args: any[]) => T, method: string): value is T {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  try { const native = methodOf(ctor.prototype, method); return Object.getPrototypeOf(value) === ctor.prototype && !Object.hasOwn(value, method) &&
    typeof native === "function" && methodOf(value, method) === native && Reflect.get(value, method) === native; } catch { return false; }
}
function methodOf(target: object, key: string): unknown { let current: object | null = target; while (current) {
  const d = Object.getOwnPropertyDescriptor(current, key); if (d) return "value" in d ? d.value : undefined; current = Object.getPrototypeOf(current) as object | null;
  } return undefined; }
function exactNativeClient(value: unknown): SyntxChatHttpClient {
  try { const prototype = SyntxChatHttpClient.prototype;
    const names = ["createChat", "startVideo", "uploadFileReferences", "uploadWan25I2vImage", "createOwnerWan25I2vChat", "startOwnerWan25I2vWithOwnedCandidate",
      "listOwnedWan25I2vCandidates", "getOwnedWan25I2vResult"];
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== prototype ||
        names.some((name) => Object.hasOwn(value, name) || typeof methodOf(prototype, name) !== "function" || methodOf(value, name) !== methodOf(prototype, name) ||
          Reflect.get(value, name) !== methodOf(prototype, name))) fail("PROFILE_BINDING_MISMATCH"); return value as SyntxChatHttpClient;
  } catch { fail("PROFILE_BINDING_MISMATCH"); }
}
function invoke<T>(client: SyntxChatHttpClient, method: string, args: readonly unknown[]): Promise<T> {
  const fn = methodOf(SyntxChatHttpClient.prototype, method); if (typeof fn !== "function" || methodOf(client, method) !== fn) fail("PROFILE_BINDING_MISMATCH");
  try { return Reflect.apply(fn, client, args) as Promise<T>; } catch { return Promise.reject(new OwnerWan25I2vGenerationServiceError("PRE_DISPATCH_FAILED")); }
}
function claimKey(principal: Readonly<GenerationPrincipalRef>, intent: string): string {
  return schemaHash([principal.tenant_id, principal.subject_id, principal.connection_id, intent]);
}
function validAccount(value: AccountStatusResult, now: number): boolean {
  if (!isPlainObject(value) || !isPlainObject(value.balance) || value.balance.unit !== "tokens" ||
      !(value.balance.available === null || (typeof value.balance.available === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value.balance.available))) ||
      !isPlainObject(value.subscription) || value.subscription.active !== true || typeof value.subscription.end_date !== "string" ||
      !["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(value.subscription.end_date_kind)) ||
      value.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || value.source_build !== ACCOUNT_SOURCE_BUILD || !freshAt(value.observed_at, now)) return false;
  const until = Date.parse(value.subscription.end_date); return Number.isFinite(until) && until > now;
}
function validAccess(value: ModelAccessResult, catalog: DiscoveryCatalogRepository, expectedCost: Readonly<Record<string, string | number | boolean>>, now: number): boolean {
  try { const model = catalog.getModel(MODEL_ID), expectedKeys = ["resolution", "video_duration"];
    return value.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" && value.catalog_version === `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}` &&
      value.model_id === MODEL_ID && value.ai_name === model.ai_name && value.model_type === model.upstream_id && value.account_read_live === true &&
      value.access === true && value.parameters_redacted === true && Array.isArray(value.parameter_keys) && value.parameter_keys.length === 2 &&
      schemaHash([...value.parameter_keys].sort()) === schemaHash(expectedKeys) && value.parameter_keys.every((k) => expectedKeys.includes(k)) &&
      validQuote(value.cost) && validQuote(value.discount_cost) && (finite(value.cost) || finite(value.discount_cost)) && freshAt(value.observed_at, now) &&
      Object.keys(expectedCost).sort().join(",") === expectedKeys.join(","); } catch { return false; }
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function validQuote(value: unknown): boolean { return value === null || finite(value); }
function freshAt(value: unknown, now: number): boolean { if (typeof value !== "string") return false; const at = Date.parse(value); return Number.isFinite(at) && Math.abs(now - at) <= PREFLIGHT_FRESH_MS; }
function assertPrivateRequest(value: OwnerWan25I2vPreparedRequest, expected: OwnerWan25I2vGenerationRequest): void {
  if (!isPlainObject(value) || value.prompt !== expected.prompt || !isPlainObject(value.settings) || value.settings.model_type !== MODEL_ID ||
      value.settings.resolution !== expected.parameters.resolution || value.settings.aspect_ratio !== expected.parameters.aspect_ratio ||
      value.settings.video_duration !== expected.parameters.video_duration || value.settings.prompt_extend !== expected.parameters.prompt_extend ||
      value.settings.seed !== expected.parameters.seed || value.settings.native_audio !== false || value.settings.shot_type !== "single" ||
      value.settings.audio_setting !== "auto" || Object.hasOwn(value.settings, "duration") || !Array.isArray(value.settings.file_urls) ||
      value.settings.file_urls.length !== 1 || value.settings.file_urls[0]?.type !== "image" || typeof value.settings.file_urls[0]?.url !== "string" ||
      !safeVideoSourceUrl(value.settings.file_urls[0].url)) fail("PRE_DISPATCH_FAILED");
}
function safeVideoSourceUrl(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && isSafeUploadReferenceUrl(value); } catch { return false; } }
function assertPermit(value: OwnerWan25I2vOneShotPermit, binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>): void {
  if (value.status !== "nominal" || value.dispatch_allowed !== false || value.runtime_usable !== false || value.backend_acceptance !== "UNPROVEN" ||
      value.model_id !== MODEL_ID || value.profile_schema_hash !== binding.profile_schema_hash || value.request_fingerprint !== binding.request_fingerprint ||
      value.intent_fingerprint !== binding.intent_fingerprint || value.expires_at !== binding.expires_at) fail("PRE_DISPATCH_FAILED");
}
function assertChat(chat: OwnerWan25I2vChatContext, attemptId: string, binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>): void {
  if (!chat || chat.status !== "created" || !SAFE_ID.test(chat.chat_uuid) || chat.attempt_id !== attemptId || chat.model_id !== MODEL_ID ||
      chat.profile_schema_hash !== binding.profile_schema_hash || chat.request_fingerprint !== binding.request_fingerprint ||
      chat.intent_fingerprint !== binding.intent_fingerprint || chat.expires_at !== binding.expires_at || chat.dispatch_allowed !== false ||
      chat.backend_acceptance !== "UNPROVEN") fail("PRE_DISPATCH_FAILED");
}
function validAck(ack: MediaGenerationReceipt, chatUuid: string): boolean { return !!ack && ack.chat_uuid === chatUuid && SAFE_ID.test(ack.message_id); }
function isKnownPreDispatch(error: unknown): boolean { return error instanceof OwnerWan25I2vNativeError &&
  ["CHAT_NOT_DISPATCHED", "CANDIDATE_INVALID", "CHAT_CONTEXT_INVALID", "PRINCIPAL_NOT_LINKED", "REQUEST_ABORTED"].includes(error.code); }
function historyAckMatches(recovery: Recovery, history: OwnerWan25I2vResultCandidates): boolean {
  return history.owner_ack_status === "MATCHED" && typeof history.owner_echo_message_id === "string" && SAFE_ID.test(history.owner_echo_message_id) &&
    (recovery.ack === null || recovery.ack === history.owner_echo_message_id);
}
function validContext(value: OwnerWan25I2vResultContext, recovery: Recovery): boolean {
  return !!value && value.chat_uuid === recovery.chat.chat_uuid && value.model_id === MODEL_ID && value.attempt_id === recovery.attemptId &&
    value.profile_schema_hash === recovery.binding.profile_schema_hash && value.intent_fingerprint === recovery.binding.intent_fingerprint &&
    value.owner_echo_message_id === recovery.ack && SAFE_ID.test(value.message_id) && /^\d{1,16}$/u.test(value.provider_chat_id) &&
    Array.isArray(value.message_object_ids) && value.message_object_ids.length > 0 && value.message_object_ids.length <= 64 &&
    value.message_object_ids.every((id) => typeof id === "string" && SAFE_ID.test(id)) && new Set(value.message_object_ids).size === value.message_object_ids.length;
}
function validReadyVideo(video: OwnerWan25I2vReadyVideo, context: OwnerWan25I2vResultContext): boolean {
  return !!video && Number.isSafeInteger(video.object_index) && video.object_index >= 0 && video.object_index < context.message_object_ids.length &&
    context.message_object_ids[video.object_index] === video.message_object_id && video.object_type === "video" && isSafeUploadReferenceUrl(video.object_url) &&
    safeVideoUrl(video.object_url) && (video.mime_type === null || video.mime_type === "video/mp4" || video.mime_type === "video/webm") && video.model_echo === "MATCHED";
}
function safeVideoUrl(value: string): boolean { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && /\.(?:mp4|webm)$/iu.test(u.pathname); } catch { return false; } }
function storeArtifact(recovery: Recovery, context: OwnerWan25I2vResultContext, video: OwnerWan25I2vReadyVideo): void {
  const key = schemaHash([context.message_id, video.object_index, video.message_object_id]);
  recovery.artifacts.set(key, Object.freeze({ object_index: video.object_index, message_object_id: video.message_object_id, object_type: "video",
    object_url: video.object_url, mime_type: video.mime_type, message_id: context.message_id, chat_uuid: context.chat_uuid, model_id: MODEL_ID }));
}
function newDiagnostic(): DiagnosticState { return { post_started: false, ack_known: false, history_status: "NOT_READ", owner_ack_status: "NOT_READ",
  history_get_calls: 0, result_get_calls: 0, backend_error_observed: false, pending_object_indices: [], gaps: [] }; }
function diagnosticSnapshot(value: DiagnosticState): Readonly<OwnerWan25I2vGenerationDiagnostic> { return Object.freeze({ ...value,
  pending_object_indices: Object.freeze([...value.pending_object_indices]), gaps: Object.freeze([...value.gaps]) }); }
function appendGaps(current: readonly OwnerWan25I2vGenerationDiagnosticCode[], values: readonly OwnerWan25I2vGenerationDiagnosticCode[]): OwnerWan25I2vGenerationDiagnosticCode[] {
  const out = [...current]; for (const value of values) if (!out.includes(value) && out.length < 32) out.push(value); return out;
}
function mapHistoryGap(code: string): OwnerWan25I2vGenerationDiagnosticCode { if (code === "OWNER_ACK_MISSING") return "OWNER_ACK_MISSING";
  if (code === "OWNER_ACK_AMBIGUOUS") return "OWNER_ACK_AMBIGUOUS"; if (code === "OWNER_ACK_MISMATCH") return "OWNER_ACK_MISMATCH";
  if (code === "BOT_ERROR_OBSERVED") return "BACKEND_ERROR_OBSERVED"; if (code.includes("INCOMPLETE") || code.includes("PAGE_LIMIT") || code.includes("MESSAGE_LIMIT")) return "HISTORY_INCOMPLETE";
  return "HISTORY_UNVERIFIED"; }
function mapResultGap(code: string): OwnerWan25I2vGenerationDiagnosticCode { if (code === "RESULT_URL_PENDING" || code === "OBJECT_NOT_COMPLETED" || code === "RESULT_COMPLETION_FLAG_INVALID") return "RESULT_PENDING";
  if (code === "MODEL_ECHO_MISMATCH") return "RESULT_MODEL_ECHO_MISMATCH"; if (code === "MODEL_ECHO_UNAVAILABLE") return "RESULT_MODEL_ECHO_UNAVAILABLE";
  if (code === "RESULT_URL_UNSAFE") return "RESULT_URL_UNSAFE"; return "RESULT_UNVERIFIED"; }
function mergePending(a: readonly number[], b: readonly number[]): number[] { return [...new Set([...a, ...b].filter((v) => Number.isSafeInteger(v) && v >= 0 && v < 64))].slice(0, 64); }
function counter(value: number): number { return Math.max(0, Math.min(10_000, value)); }
function boundedCount(value: unknown, max: number): number { return Number.isSafeInteger(value) && (value as number) >= 0 ? Math.min(value as number, max) : 0; }
function resultPage(recovery: Recovery, offset: number): OwnerWan25I2vGenerationResult {
  const order = new Map(recovery.contexts.map((c, i) => [c.message_id, i] as const));
  const all = [...recovery.artifacts.values()].sort((a, b) => (order.get(a.message_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.message_id) ?? Number.MAX_SAFE_INTEGER) || a.object_index - b.object_index);
  const artifacts = all.slice(offset, offset + PAGE_SIZE), hasMore = offset + artifacts.length < all.length;
  return Object.freeze({ status: "completed", status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY", provider_terminal_status: "UNPROVEN",
    backend_acceptance: "UNPROVEN", cost_cap_enforced: false, model_id: MODEL_ID, recovery_id: recovery.id,
    observed_artifact_count: all.length, offset, page_size: artifacts.length, artifacts: Object.freeze(artifacts), has_more: hasMore,
    next_offset: hasMore ? offset + artifacts.length : null, diagnostic: diagnosticSnapshot(recovery.diagnostic) });
}
function outcomeUnknown(recovery: Recovery): OwnerWan25I2vGenerationServiceError { return new OwnerWan25I2vGenerationServiceError("OUTCOME_UNKNOWN", recovery.id, diagnosticSnapshot(recovery.diagnostic)); }
function fail(code: OwnerWan25I2vGenerationServiceErrorCode): never { throw new OwnerWan25I2vGenerationServiceError(code); }
export interface OwnerWan25I2vGenerationRequest extends OwnerWan25I2vGenerationParametersInput {
  readonly image_handle: string; readonly audio_handle: null;
}
export interface OwnerWan25I2vGenerateInput { readonly attemptId: string; readonly request: OwnerWan25I2vGenerationRequest }
export interface OwnerWan25I2vReconcileInput { readonly attemptId: string; readonly recovery_id: string }
export interface OwnerWan25I2vRecoveryListInput { readonly attemptId: string; readonly limit?: number }
export interface OwnerWan25I2vResultPageInput { readonly attemptId: string; readonly recovery_id: string; readonly offset?: number }
export type OwnerWan25I2vGenerationDiagnosticCode = "PREFLIGHT_FAILED" | "HISTORY_UNAVAILABLE" | "HISTORY_INCOMPLETE" |
  "HISTORY_UNVERIFIED" | "OWNER_ACK_MISSING" | "OWNER_ACK_AMBIGUOUS" | "OWNER_ACK_MISMATCH" | "BACKEND_ERROR_OBSERVED" |
  "RESULT_GET_UNAVAILABLE" | "RESULT_PENDING" | "RESULT_UNVERIFIED" | "RESULT_MODEL_ECHO_UNAVAILABLE" |
  "RESULT_MODEL_ECHO_MISMATCH" | "RESULT_URL_UNSAFE" | "NO_VIDEO_OBSERVED" | "ARTIFACT_LIMIT_EXCEEDED";
export interface OwnerWan25I2vGenerationDiagnostic {
  readonly post_started: boolean; readonly ack_known: boolean; readonly history_status: OwnerWan25I2vResultCandidates["status"] | "NOT_READ";
  readonly owner_ack_status: OwnerWan25I2vResultCandidates["owner_ack_status"] | "NOT_READ"; readonly history_get_calls: number;
  readonly result_get_calls: number; readonly backend_error_observed: boolean; readonly pending_object_indices: readonly number[];
  readonly gaps: readonly OwnerWan25I2vGenerationDiagnosticCode[];
}
export interface OwnerWan25I2vGenerationArtifact { readonly object_index: number; readonly message_object_id: string;
  readonly object_type: "video"; readonly object_url: string; readonly mime_type: "video/mp4" | "video/webm" | null;
  readonly message_id: string; readonly chat_uuid: string; readonly model_id: typeof MODEL_ID }
export interface OwnerWan25I2vGenerationResult {
  readonly status: "completed"; readonly status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY";
  readonly provider_terminal_status: "UNPROVEN"; readonly backend_acceptance: "UNPROVEN"; readonly cost_cap_enforced: false;
  readonly model_id: typeof MODEL_ID; readonly recovery_id: string; readonly observed_artifact_count: number; readonly offset: number;
  readonly page_size: number; readonly artifacts: readonly Readonly<OwnerWan25I2vGenerationArtifact>[];
  readonly has_more: boolean; readonly next_offset: number | null; readonly diagnostic: Readonly<OwnerWan25I2vGenerationDiagnostic>;
}
export interface OwnerWan25I2vRecoveryListItem { readonly recovery_id: string; readonly created_at: string;
  readonly status: "outcome_unknown" | "completed"; readonly model_id: typeof MODEL_ID; readonly observed_artifact_count: number }
export type OwnerWan25I2vGenerationServiceErrorCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" |
  "PRINCIPAL_NOT_LINKED" | "PROFILE_BINDING_MISMATCH" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" |
  "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND" | "REQUEST_ABORTED";
export class OwnerWan25I2vGenerationServiceError extends Error {
  constructor(readonly code: OwnerWan25I2vGenerationServiceErrorCode, readonly recovery_id?: string,
    readonly diagnostic?: Readonly<OwnerWan25I2vGenerationDiagnostic>) {
    super("The owner WAN 2.5 I2V preview request could not be completed safely."); this.name = "OwnerWan25I2vGenerationServiceError";
  }
}
interface DiagnosticState { post_started: boolean; ack_known: boolean; history_status: OwnerWan25I2vGenerationDiagnostic["history_status"];
  owner_ack_status: OwnerWan25I2vGenerationDiagnostic["owner_ack_status"]; history_get_calls: number; result_get_calls: number;
  backend_error_observed: boolean; pending_object_indices: number[]; gaps: OwnerWan25I2vGenerationDiagnosticCode[] }
interface Claim { readonly attemptId: string; readonly principal: Readonly<GenerationPrincipalRef>; readonly state: "reserved" | "pre_dispatch_failed" | "outcome_unknown" | "completed";
  readonly reservationId?: string; readonly recoveryId?: string }
interface Recovery { readonly id: string; readonly attemptId: string; readonly createdAt: string; readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intentKey: string; readonly candidate: OwnerWan25I2vPreparedCandidate; readonly permit: OwnerWan25I2vOneShotPermit;
  readonly binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>; readonly chat: OwnerWan25I2vChatContext; readonly client: SyntxChatHttpClient;
  ack: string | null; contexts: readonly OwnerWan25I2vResultContext[]; status: "outcome_unknown" | "completed"; busy: boolean;
  readonly artifacts: Map<string, Readonly<OwnerWan25I2vGenerationArtifact>>; diagnostic: DiagnosticState }
interface Run { readonly attemptId: string; readonly controller: AbortController; readonly promise: Promise<unknown> }

/** Single exact WAN25 preview service. It prepares, quotes and dispatches once; recovery is GET-only. */
export class OwnerWan25I2vGenerationService {
  readonly #binding: Readonly<AuthBinding>; readonly #links: PerUserLinkService; readonly #catalog: DiscoveryCatalogRepository;
  readonly #preparer: OwnerWan25I2vRequestPreparer; readonly #resolveClient: OwnerWan25I2vGenerationServiceOptions["resolveChatClient"];
  readonly #createAccount: OwnerWan25I2vGenerationServiceOptions["createAccountStatusService"];
  readonly #createAccess: OwnerWan25I2vGenerationServiceOptions["createModelAccessService"];
  readonly #now: () => number; readonly #timeoutMs: number; readonly #claims = new Map<string, Claim>(); readonly #recoveries = new Map<string, Recovery>();
  readonly #clients = new Map<string, SyntxChatHttpClient>(); readonly #usedAccounts = new WeakSet<object>(); readonly #usedAccess = new WeakSet<object>();
  readonly #runs = new Set<Run>(); readonly #runsByAttempt = new Map<string, Set<Run>>(); readonly #invalidating = new Set<string>();
  #closed = false; #closing: Promise<void> | undefined;
  constructor(optionsInput: OwnerWan25I2vGenerationServiceOptions | unknown) {
    const o = exactRecord(optionsInput, ["binding", "linkService", "catalog", "catalog_version", "preparer", "resolveChatClient",
      "createAccountStatusService", "createModelAccessService"], ["now", "timeoutMs"]);
    if (!isLinkService(o.linkService) || !(o.catalog instanceof DiscoveryCatalogRepository) || o.catalog_version !== CATALOG_VERSION ||
        !isOwnerWan25I2vRequestPreparer(o.preparer) || typeof o.resolveChatClient !== "function" || types.isProxy(o.resolveChatClient) ||
        typeof o.createAccountStatusService !== "function" || types.isProxy(o.createAccountStatusService) ||
        typeof o.createModelAccessService !== "function" || types.isProxy(o.createModelAccessService) ||
        (o.now !== undefined && (typeof o.now !== "function" || types.isProxy(o.now)))) fail("INVALID_REQUEST");
    this.#binding = snapshotBinding(o.binding); this.#links = o.linkService; this.#catalog = o.catalog; this.#preparer = o.preparer;
    this.#resolveClient = o.resolveChatClient as OwnerWan25I2vGenerationServiceOptions["resolveChatClient"];
    this.#createAccount = o.createAccountStatusService as OwnerWan25I2vGenerationServiceOptions["createAccountStatusService"];
    this.#createAccess = o.createModelAccessService as OwnerWan25I2vGenerationServiceOptions["createModelAccessService"];
    this.#now = o.now as (() => number) | undefined ?? Date.now; this.#timeoutMs = bounded(o.timeoutMs, 1_000, 300_000, DEFAULT_TIMEOUT_MS);
    this.#assertCatalog(); SERVICE_BRAND.add(this); Object.freeze(this);
  }

  generate(inputValue: OwnerWan25I2vGenerateInput | unknown, signal?: AbortSignal): Promise<OwnerWan25I2vGenerationResult> {
    this.#assertOpen(); const request = snapshotGenerate(inputValue); validateSignal(signal);
    return this.#run(request.attemptId, signal, (runSignal) => this.#generate(request, runSignal));
  }
  reconcile(inputValue: OwnerWan25I2vReconcileInput | unknown, signal?: AbortSignal): Promise<OwnerWan25I2vGenerationResult> {
    this.#assertOpen(); const request = snapshotRecovery(inputValue); validateSignal(signal);
    return this.#run(request.attemptId, signal, (runSignal) => this.#reconcile(request, runSignal));
  }
  listRecoveries(inputValue: OwnerWan25I2vRecoveryListInput | unknown): Promise<readonly Readonly<OwnerWan25I2vRecoveryListItem>[]> {
    this.#assertOpen(); const request = snapshotList(inputValue);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "PREFLIGHT_FAILED");
      try { const principal = await this.#wait(deadline, () => this.#principal(request.attemptId)); const client = this.#client(request.attemptId);
        await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
        return Object.freeze([...this.#recoveries.values()].filter((r) => r.attemptId === request.attemptId && sameGenerationPrincipal(r.principal, principal))
          .slice(-(request.limit ?? 20)).reverse().map((r) => Object.freeze({ recovery_id: r.id, created_at: r.createdAt,
            status: r.status, model_id: MODEL_ID, observed_artifact_count: r.artifacts.size })));
      } finally { deadline.close(); }
    });
  }
  getResultPage(inputValue: OwnerWan25I2vResultPageInput | unknown): Promise<OwnerWan25I2vGenerationResult> {
    this.#assertOpen(); const request = snapshotPage(inputValue);
    return this.#run(request.attemptId, undefined, async (signal) => {
      const deadline = this.#deadline(signal, "OUTCOME_UNKNOWN");
      try { const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
        const recovery = this.#ownedRecovery(request.attemptId, request.recovery_id, principal), client = this.#client(request.attemptId);
        if (client !== recovery.client) fail("RECOVERY_NOT_FOUND"); await this.#assertCurrent(request.attemptId, principal, client, signal, "RECOVERY_NOT_FOUND");
        if (recovery.status !== "completed") throw outcomeUnknown(recovery); return resultPage(recovery, request.offset ?? 0);
      } finally { deadline.close(); }
    });
  }
  async invalidateAttempt(value: unknown): Promise<void> {
    const attemptId = readAttempt(value); if (this.#invalidating.has(attemptId)) return;
    this.#invalidating.add(attemptId); const runs = [...(this.#runsByAttempt.get(attemptId) ?? [])]; for (const run of runs) run.controller.abort();
    try { await this.#preparer.invalidateAttempt(attemptId); } catch { /* local claim/recovery revocation below */ }
    await Promise.allSettled(runs.map((r) => r.promise)); this.#removeAttemptState(attemptId); this.#invalidating.delete(attemptId);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing; this.#closed = true;
    const attempts = new Set([...this.#runsByAttempt.keys(), ...[...this.#recoveries.values()].map((r) => r.attemptId)]);
    const runs = [...this.#runs]; for (const run of runs) run.controller.abort();
    this.#closing = (async () => { const pending: Promise<unknown>[] = [...[...attempts].map((a) => this.invalidateAttempt(a)), ...runs.map((r) => r.promise)];
      await Promise.allSettled(pending);
      this.#recoveries.clear(); this.#claims.clear(); this.#clients.clear(); await this.#preparer.close(); })(); return this.#closing;
  }

  async #generate(request: Readonly<OwnerWan25I2vGenerateInput>, signal: AbortSignal): Promise<OwnerWan25I2vGenerationResult> {
    const deadline = this.#deadline(signal, "PRE_DISPATCH_FAILED"); let intentKey: string | undefined; let reservationId: string | undefined;
    let permitIssued = false, startInvoked = false; let recovery: Recovery | undefined;
    try {
      const principal = await this.#wait(deadline, () => this.#principal(request.attemptId));
      const candidate = await this.#wait(deadline, () => this.#preparer.prepare({ attempt_id: request.attemptId,
        model_id: MODEL_ID, image_handle: request.request.image_handle, audio_handle: null, prompt: request.request.prompt,
        parameters: request.request.parameters }, deadline.signal));
      const binding = this.#candidateBinding(candidate, request, principal), privateRequest = this.#preparer.getPrivateRequest(candidate);
      assertPrivateRequest(privateRequest, request.request);
      intentKey = claimKey(principal, binding.intent_fingerprint); reservationId = this.#reserve(intentKey, request.attemptId, principal);
      await this.#preflight(request.attemptId, principal, request.request, deadline);
      const client = this.#client(request.attemptId); await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, request.attemptId, deadline);
      const permit = await this.#wait(deadline, () => createOwnerWan25I2vOneShotPermit({ preparer: this.#preparer, candidate,
        principal, attemptId: request.attemptId })); permitIssued = true; assertPermit(permit, binding);
      const base = this.#nativeOperation(candidate, permit, principal, request.attemptId);
      const chat = await this.#wait(deadline, () => invoke<OwnerWan25I2vChatContext>(client, "createOwnerWan25I2vChat", [base, deadline.signal]));
      assertChat(chat, request.attemptId, binding); await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      await this.#preflight(request.attemptId, principal, request.request, deadline);
      await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      await this.#revalidateCandidate(candidate, binding, principal, request.attemptId, deadline);
      await this.#wait(deadline, () => revalidateOwnerWan25I2vOneShotPermit({ permit, preparer: this.#preparer,
        candidate, principal, attemptId: request.attemptId })); await this.#assertCurrent(request.attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
      recovery = this.#newRecovery(request.attemptId, principal, intentKey, candidate, permit, binding, chat, client);
      this.#recoveries.set(recovery.id, recovery); this.#setRecoveryClaim(intentKey, recovery); recovery.diagnostic.post_started = true; startInvoked = true;
      let ack: MediaGenerationReceipt;
      try { ack = await this.#wait(deadline, () => invoke<MediaGenerationReceipt>(client, "startOwnerWan25I2vWithOwnedCandidate",
        [this.#nativeChatOperation(recovery!), deadline.signal])); }
      catch (error) {
        if (isKnownPreDispatch(error)) { this.#recoveries.delete(recovery.id); this.#claims.set(intentKey, Object.freeze({ attemptId: request.attemptId,
          principal, state: "pre_dispatch_failed" })); recovery = undefined; fail("PRE_DISPATCH_FAILED"); }
        throw outcomeUnknown(recovery);
      }
      if (!validAck(ack, chat.chat_uuid)) throw outcomeUnknown(recovery); recovery.ack = ack.message_id; recovery.diagnostic.ack_known = true;
      return await this.#observe(recovery, deadline);
    } catch (error) {
      if (startInvoked && recovery) { if (error instanceof OwnerWan25I2vGenerationServiceError && error.code === "OUTCOME_UNKNOWN") throw error; throw outcomeUnknown(recovery); }
      if (error instanceof OwnerWan25I2vGenerationServiceError) throw error; throw this.#mapPreDispatch(error);
    } finally {
      if (intentKey && reservationId) this.#releaseReservation(intentKey, reservationId, permitIssued && !recovery); deadline.close();
    }
  }

  async #reconcile(input: Readonly<OwnerWan25I2vReconcileInput>, signal: AbortSignal): Promise<OwnerWan25I2vGenerationResult> {
    const deadline = this.#deadline(signal, "OUTCOME_UNKNOWN"); let recovery: Recovery | undefined; let ownsBusy = false;
    try { const principal = await this.#wait(deadline, () => this.#principal(input.attemptId));
      recovery = this.#ownedRecovery(input.attemptId, input.recovery_id, principal); const client = this.#client(input.attemptId);
      if (client !== recovery.client) fail("RECOVERY_NOT_FOUND"); if (recovery.busy) fail("SERVICE_BUSY"); recovery.busy = true; ownsBusy = true;
      await this.#assertCurrent(input.attemptId, principal, client, deadline.signal, "RECOVERY_NOT_FOUND"); return await this.#observe(recovery, deadline);
    } catch (error) {
      if (recovery && !(error instanceof OwnerWan25I2vGenerationServiceError && error.code === "RECOVERY_NOT_FOUND")) {
        if (error instanceof OwnerWan25I2vGenerationServiceError && ["OUTCOME_UNKNOWN", "SERVICE_BUSY"].includes(error.code)) throw error;
        throw outcomeUnknown(recovery);
      }
      throw this.#mapRecovery(error);
    } finally { if (recovery && ownsBusy) recovery.busy = false; deadline.close(); }
  }

  async #observe(recovery: Recovery, deadline: AbsoluteRequestDeadline): Promise<OwnerWan25I2vGenerationResult> {
    await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
    let history: OwnerWan25I2vResultCandidates;
    try { history = await this.#wait(deadline, () => invoke<OwnerWan25I2vResultCandidates>(recovery.client,
      "listOwnedWan25I2vCandidates", [this.#nativeChatOperation(recovery), deadline.signal])); }
    catch (error) { if (error instanceof OwnerWan25I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("RECOVERY_NOT_FOUND");
      recovery.diagnostic.history_status = "UNVERIFIED"; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNAVAILABLE"]); throw outcomeUnknown(recovery); }
    recovery.diagnostic.history_get_calls = counter(recovery.diagnostic.history_get_calls + boundedCount(history.history_get_calls, 7));
    recovery.diagnostic.history_status = history.status; recovery.diagnostic.owner_ack_status = history.owner_ack_status;
    if (history.bot_error_observed) { recovery.diagnostic.backend_error_observed = true; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["BACKEND_ERROR_OBSERVED"]); }
    recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, history.gaps.map(mapHistoryGap));
    if (!historyAckMatches(recovery, history)) throw outcomeUnknown(recovery);
    if (!recovery.ack && history.owner_echo_message_id) { recovery.ack = history.owner_echo_message_id; recovery.diagnostic.ack_known = true; }
    if (history.status !== "COMPLETE" || history.history_binding_status !== "BOUND" || history.history_page_status !== "COMPLETE" ||
        history.gaps.length !== 0 || !recovery.ack || history.contexts.length === 0 || history.contexts.length > MAX_CONTEXTS) {
      if (history.status === "PENDING" || history.status === "INCOMPLETE") recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_INCOMPLETE"]);
      else if (history.status !== "COMPLETE") recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNVERIFIED"]); throw outcomeUnknown(recovery);
    }
    recovery.contexts = Object.freeze([...history.contexts]); let allObserved = true, readyCount = 0;
    for (const context of recovery.contexts) {
      if (!validContext(context, recovery)) { allObserved = false; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["HISTORY_UNVERIFIED"]); continue; }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
      recovery.diagnostic.result_get_calls = counter(recovery.diagnostic.result_get_calls + 1);
      let result: OwnerWan25I2vVideoResult;
      try { result = await this.#wait(deadline, () => invoke<OwnerWan25I2vVideoResult>(recovery.client, "getOwnedWan25I2vResult",
        [this.#nativeResultOperation(recovery, context), deadline.signal])); }
      catch (error) { if (error instanceof OwnerWan25I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") fail("RECOVERY_NOT_FOUND");
        allObserved = false; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_GET_UNAVAILABLE"]); continue; }
      await this.#assertCurrent(recovery.attemptId, recovery.principal, recovery.client, deadline.signal, "RECOVERY_NOT_FOUND");
      if (result.backend_error_observed) { recovery.diagnostic.backend_error_observed = true; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["BACKEND_ERROR_OBSERVED"]); }
      if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED") { allObserved = false;
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, [result.model_echo === "MISMATCH" ? "RESULT_MODEL_ECHO_MISMATCH" :
          result.model_echo === "UNKNOWN" ? "RESULT_MODEL_ECHO_UNAVAILABLE" : "RESULT_UNVERIFIED"]); continue; }
      if (result.result_status !== "OBSERVED" || result.gaps.length || result.pending_object_indices.length || result.backend_error_observed) allObserved = false;
      if (result.pending_object_indices.length || result.result_status === "PENDING") { recovery.diagnostic.pending_object_indices = mergePending(recovery.diagnostic.pending_object_indices, result.pending_object_indices);
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_PENDING"]); }
      for (const gap of result.gaps) recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, [mapResultGap(gap.code)]);
      const ready = result.ready_videos.filter((video) => validReadyVideo(video, context));
      if (ready.length !== result.ready_videos.length) { allObserved = false; recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["RESULT_URL_UNSAFE"]); }
      if (result.result_status === "OBSERVED" && ready.length === 0) allObserved = false;
      for (const video of ready) { storeArtifact(recovery, context, video); readyCount += 1; }
    }
    if (recovery.artifacts.size > MAX_ARTIFACTS) { recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["ARTIFACT_LIMIT_EXCEEDED"]); throw outcomeUnknown(recovery); }
    if (!allObserved || recovery.artifacts.size === 0) { if (recovery.artifacts.size === 0 && readyCount === 0)
        recovery.diagnostic.gaps = appendGaps(recovery.diagnostic.gaps, ["NO_VIDEO_OBSERVED"]); throw outcomeUnknown(recovery); }
    recovery.status = "completed"; const claim = this.#claims.get(recovery.intentKey);
    if (claim?.recoveryId === recovery.id) this.#claims.set(recovery.intentKey, Object.freeze({ ...claim, state: "completed" }));
    recovery.diagnostic.pending_object_indices = []; return resultPage(recovery, 0);
  }

  async #preflight(attemptId: string, principal: Readonly<GenerationPrincipalRef>, request: OwnerWan25I2vGenerationRequest,
    deadline: AbsoluteRequestDeadline): Promise<void> {
    const client = this.#client(attemptId); await this.#assertCurrent(attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
    let account: AccountStatusService, access: ModelAccessService;
    try { account = Reflect.apply(this.#createAccount, undefined, [attemptId]) as AccountStatusService;
      access = Reflect.apply(this.#createAccess, undefined, [attemptId]) as ModelAccessService; } catch { fail("PREFLIGHT_FAILED"); }
    if (!exactService(account, AccountStatusService, "getAccountStatus") || this.#usedAccounts.has(account) ||
        !exactService(access, ModelAccessService, "getModelAccess") || this.#usedAccess.has(access)) fail("PREFLIGHT_FAILED");
    this.#usedAccounts.add(account); this.#usedAccess.add(access);
    const cost = Object.freeze({ resolution: request.parameters.resolution, video_duration: request.parameters.video_duration });
    let accountValue: AccountStatusResult, accessValue: ModelAccessResult;
    try { accountValue = await this.#wait(deadline, () => Reflect.apply(methodOf(account, "getAccountStatus") as Function, account, [deadline.signal]) as Promise<AccountStatusResult>); }
    catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
    try { accessValue = await this.#wait(deadline, () => Reflect.apply(methodOf(access, "getModelAccess") as Function, access,
      [{ model_id: MODEL_ID, cost_parameters: cost }, deadline.signal]) as Promise<ModelAccessResult>); } catch { fail("PREFLIGHT_FAILED"); }
    await this.#assertCurrent(attemptId, principal, client, deadline.signal, "PRINCIPAL_NOT_LINKED");
    if (!validAccount(accountValue, this.#readWallNow()) || !validAccess(accessValue, this.#catalog, cost, this.#readWallNow())) fail("PREFLIGHT_FAILED");
  }

  #candidateBinding(candidate: OwnerWan25I2vPreparedCandidate, request: Readonly<OwnerWan25I2vGenerateInput>, principal: Readonly<GenerationPrincipalRef>): Readonly<OwnerWan25I2vPreparedCandidateBinding> {
    if (!isOwnerWan25I2vPreparedCandidate(candidate)) fail("PRE_DISPATCH_FAILED"); const binding = this.#preparer.inspectCandidate(candidate);
    const pins = getOwnerWan25I2vGenerationParametersSource().source_pins;
    if (!binding || candidate.model_id !== MODEL_ID || binding.model_id !== MODEL_ID || binding.attempt_id !== request.attemptId ||
        !sameGenerationPrincipal(binding.principal, principal) || candidate.status !== "prepared" || candidate.dispatch_allowed !== false ||
        candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" || candidate.source_pins.public_catalog_version !== CATALOG_VERSION ||
        candidate.source_pins.public_catalog_fetched_at !== CATALOG_FETCHED_AT || candidate.source_pins.public_models_sha256 !== MODEL_HASH ||
        candidate.source_pins.files_mention !== false || candidate.intent_fingerprint !== binding.intent_fingerprint ||
        candidate.request_fingerprint !== binding.request_fingerprint || candidate.request_fingerprint !== binding.wire_fingerprint ||
        candidate.profile_schema_hash !== binding.profile_schema_hash || !/^sha256:[a-f0-9]{64}$/u.test(binding.intent_fingerprint) ||
        candidate.model_id !== request.request.model_id) fail("PRE_DISPATCH_FAILED");
    if (pins.public_catalog_version !== CATALOG_VERSION) fail("MODEL_BINDING_MISMATCH"); return binding;
  }
  async #revalidateCandidate(candidate: OwnerWan25I2vPreparedCandidate, binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>,
    principal: Readonly<GenerationPrincipalRef>, attemptId: string, deadline: AbsoluteRequestDeadline): Promise<void> {
    try { const fresh = await this.#wait(deadline, () => this.#preparer.revalidateCandidate(candidate, deadline.signal));
      if (fresh.wire_fingerprint !== binding.wire_fingerprint || fresh.intent_fingerprint !== binding.intent_fingerprint ||
          fresh.model_id !== MODEL_ID || fresh.attempt_id !== attemptId || !sameGenerationPrincipal(fresh.principal, principal)) fail("PRE_DISPATCH_FAILED"); }
    catch (error) { if (error instanceof OwnerWan25I2vGenerationServiceError) throw error; fail("PRE_DISPATCH_FAILED"); }
  }
  #reserve(key: string, attemptId: string, principal: Readonly<GenerationPrincipalRef>): string {
    const prior = this.#claims.get(key); if (prior) { if (prior.state === "outcome_unknown" && prior.recoveryId) {
        const recovery = this.#recoveries.get(prior.recoveryId); if (recovery?.status === "outcome_unknown") throw outcomeUnknown(recovery); }
      fail("INTENT_ALREADY_CLAIMED"); }
    if (this.#claims.size >= MAX_RECOVERIES || this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    const reservationId = randomUUID(); this.#claims.set(key, Object.freeze({ attemptId, principal, state: "reserved", reservationId })); return reservationId;
  }
  #releaseReservation(key: string, reservationId: string, sticky: boolean): void { const claim = this.#claims.get(key);
    if (!claim || claim.state !== "reserved" || claim.reservationId !== reservationId) return;
    if (sticky) this.#claims.set(key, Object.freeze({ attemptId: claim.attemptId, principal: claim.principal, state: "pre_dispatch_failed" })); else this.#claims.delete(key); }
  #newRecovery(attemptId: string, principal: Readonly<GenerationPrincipalRef>, intentKey: string, candidate: OwnerWan25I2vPreparedCandidate,
    permit: OwnerWan25I2vOneShotPermit, binding: Readonly<OwnerWan25I2vPreparedCandidateBinding>, chat: OwnerWan25I2vChatContext,
    client: SyntxChatHttpClient): Recovery {
    if (this.#recoveries.size >= MAX_RECOVERIES) fail("SERVICE_BUSY");
    return { id: `wan25_generation_recovery_${randomUUID()}`, attemptId, createdAt: new Date(this.#readWallNow()).toISOString(), principal,
      intentKey, candidate, permit, binding, chat, client, ack: null, contexts: Object.freeze([]), status: "outcome_unknown", busy: false,
      artifacts: new Map(), diagnostic: newDiagnostic() };
  }
  #setRecoveryClaim(intentKey: string, recovery: Recovery): void { this.#claims.set(intentKey, Object.freeze({ attemptId: recovery.attemptId,
    principal: recovery.principal, state: "outcome_unknown", recoveryId: recovery.id })); }
  #nativeOperation(candidate: OwnerWan25I2vPreparedCandidate, permit: OwnerWan25I2vOneShotPermit, principal: Readonly<GenerationPrincipalRef>,
    attemptId: string): OwnerWan25I2vNativeOperationInput { return Object.freeze({ preparer: this.#preparer, candidate, permit, principal,
      attemptId, linkService: this.#links, binding: this.#binding }); }
  #nativeChatOperation(recovery: Recovery): OwnerWan25I2vNativeChatOperationInput {
    return Object.freeze({ ...this.#nativeOperation(recovery.candidate, recovery.permit, recovery.principal, recovery.attemptId), chat: recovery.chat });
  }
  #nativeResultOperation(recovery: Recovery, context: OwnerWan25I2vResultContext): OwnerWan25I2vNativeResultOperationInput {
    return Object.freeze({ ...this.#nativeOperation(recovery.candidate, recovery.permit, recovery.principal, recovery.attemptId), context });
  }
  #ownedRecovery(attemptId: string, id: string, principal: Readonly<GenerationPrincipalRef>): Recovery { const r = this.#recoveries.get(id);
    if (!r || r.attemptId !== attemptId || !sameGenerationPrincipal(r.principal, principal)) fail("RECOVERY_NOT_FOUND"); return r; }
  async #principal(attemptId: string): Promise<Readonly<GenerationPrincipalRef>> { try { return snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({ binding: this.#binding, attemptId, linkService: this.#links })); }
    catch (error) { if (error instanceof OwnerReferencePrincipalError) fail("PRINCIPAL_NOT_LINKED"); fail("PRINCIPAL_NOT_LINKED"); } }
  #client(attemptId: string): SyntxChatHttpClient { let value: unknown; try { value = Reflect.apply(this.#resolveClient, undefined, [attemptId]); }
    catch { fail("PROFILE_BINDING_MISMATCH"); } const client = exactNativeClient(value), old = this.#clients.get(attemptId);
    if (old && old !== client) fail("PROFILE_BINDING_MISMATCH"); this.#clients.set(attemptId, client); return client; }
  async #assertCurrent(attemptId: string, principal: Readonly<GenerationPrincipalRef>, client: SyntxChatHttpClient, signal: AbortSignal,
    errorCode: "PRINCIPAL_NOT_LINKED" | "RECOVERY_NOT_FOUND"): Promise<void> {
    if (signal.aborted) fail("REQUEST_ABORTED"); let latest: Readonly<GenerationPrincipalRef>;
    try { latest = await this.#principal(attemptId); } catch { fail(errorCode); }
    if (signal.aborted || !sameGenerationPrincipal(principal, latest) || this.#client(attemptId) !== client) fail(errorCode);
  }
  #assertCatalog(): void {
    const pins = getOwnerWan25I2vGenerationParametersSource().source_pins;
    if (pins.public_catalog_version !== CATALOG_VERSION || this.#catalog.fetched_at !== CATALOG_FETCHED_AT || this.#catalog.source_hashes.models !== MODEL_HASH) fail("MODEL_BINDING_MISMATCH");
    let model: DiscoveryModelRecord; try { model = this.#catalog.getModel(MODEL_ID); } catch { fail("MODEL_BINDING_MISMATCH"); }
    const costKeys = model.settings?.get_cost_params;
    if (model.id !== MODEL_ID || model.upstream_id !== MODEL_ID || model.ai_name !== MODEL_NAME || model.active !== true ||
        model.settings?.files_mention !== false || !Array.isArray(costKeys) || costKeys.length !== 2 ||
        schemaHash([...costKeys].sort()) !== schemaHash(["resolution", "video_duration"]) ||
        !model.operations.some((op) => op.id === "generate-video" && op.output_modality === "video")) fail("MODEL_BINDING_MISMATCH");
  }
  #readWallNow(): number { let value: unknown; try { value = Reflect.apply(this.#now, undefined, []); } catch { fail("PREFLIGHT_FAILED"); }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 8.64e15) fail("PREFLIGHT_FAILED"); return value; }
  #deadline(signal: AbortSignal, code: "PREFLIGHT_FAILED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN"): AbsoluteRequestDeadline {
    return new AbsoluteRequestDeadline(this.#timeoutMs, signal, (source) => new OwnerWan25I2vGenerationServiceError(source === "external" ? "REQUEST_ABORTED" : code));
  }
  #wait<T>(deadline: AbsoluteRequestDeadline, work: () => Promise<T>): Promise<T> { return deadline.waitFor(work()); }
  #assertOpen(): void { if (this.#closed) fail("SERVICE_CLOSED"); }
  #run<T>(attemptId: string, parent: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.#assertOpen(); if (this.#invalidating.has(attemptId) || this.#runs.size >= MAX_ACTIVE_RUNS) fail("SERVICE_BUSY");
    const controller = new AbortController(), signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    let run!: Run; const promise = Promise.resolve().then(() => work(signal)).finally(() => { this.#runs.delete(run);
      const set = this.#runsByAttempt.get(attemptId); set?.delete(run); if (!set?.size) this.#runsByAttempt.delete(attemptId); });
    run = { attemptId, controller, promise }; this.#runs.add(run); const set = this.#runsByAttempt.get(attemptId) ?? new Set<Run>();
    set.add(run); this.#runsByAttempt.set(attemptId, set); return promise;
  }
  #removeAttemptState(attemptId: string): void { for (const [id, r] of this.#recoveries) if (r.attemptId === attemptId) this.#recoveries.delete(id);
    for (const [key, claim] of this.#claims) if (claim.attemptId === attemptId) this.#claims.delete(key); this.#clients.delete(attemptId); }
  #mapPreDispatch(error: unknown): OwnerWan25I2vGenerationServiceError { if (error instanceof OwnerWan25I2vGenerationServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan25I2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    if (error instanceof OwnerWan25I2vGenerationParametersError) return new OwnerWan25I2vGenerationServiceError("INVALID_REQUEST");
    if (error instanceof OwnerWan25I2vNativeError && error.code === "PRINCIPAL_NOT_LINKED") return new OwnerWan25I2vGenerationServiceError("PRINCIPAL_NOT_LINKED");
    return new OwnerWan25I2vGenerationServiceError("PRE_DISPATCH_FAILED"); }
  #mapRecovery(error: unknown): OwnerWan25I2vGenerationServiceError { if (error instanceof OwnerWan25I2vGenerationServiceError) return error;
    if (error instanceof OwnerReferencePrincipalError) return new OwnerWan25I2vGenerationServiceError("RECOVERY_NOT_FOUND");
    return new OwnerWan25I2vGenerationServiceError("RECOVERY_NOT_FOUND"); }
}
