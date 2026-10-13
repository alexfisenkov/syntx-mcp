import { types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { OwnerElevenLabsDialogueModel } from "./owner-elevenlabs-generation-parameters.js";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const MAX_CONTEXTS = 128;
const MAX_OBJECTS_PER_CONTEXT = 64;
const MAX_GAPS = 32;

export interface OwnerElevenLabsDialogueHistoryExpectation {
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: GenerationPrincipalRef;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly owner_echo_message_id: string;
  readonly voice_epoch: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly source_profile_schema_hash: string;
}
export interface OwnerElevenLabsDialogueResultContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_epoch: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly source_profile_schema_hash: string;
}
export interface OwnerElevenLabsDialogueHistoryInput {
  readonly status: "COMPLETE" | "PENDING" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH" | "UNKNOWN";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly history_get_calls: number;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerElevenLabsDialogueResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsDialogueDecodedHistory {
  readonly availability: "PENDING" | "UNVERIFIED" | "BOUND";
  readonly owner_ack_status: OwnerElevenLabsDialogueHistoryInput["owner_ack_status"];
  readonly history_get_calls: number;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerElevenLabsDialogueResultContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsDialogueAudioObject {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "audio";
  readonly object_url: string;
}
export interface OwnerElevenLabsDialogueResultInput {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly objects: readonly OwnerElevenLabsDialogueAudioObject[];
  readonly gaps: readonly (string | Readonly<{ object_index: number | null; code: string }>)[];
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerElevenLabsDialogueDecodedResult {
  readonly availability: "OBSERVED" | "PARTIAL" | "PENDING" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN";
  readonly artifacts: readonly Readonly<{ url: string; mime_type: null; mime_source: "UNKNOWN";
    message_id: string; message_object_id: string; object_index: number; object_type: "audio" }> [];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
  readonly provider_terminal_status: "UNPROVEN";
}

/** Binds only native-owned ACK/history contexts. A top-level dialogue prompt is deliberately not part of this matcher. */
export function decodeOwnerElevenLabsDialogueHistory(raw: unknown,
  expectedInput: OwnerElevenLabsDialogueHistoryExpectation | unknown): OwnerElevenLabsDialogueDecodedHistory {
  const expected = readExpectation(expectedInput);
  const row = readHistoryEnvelope(raw);
  if (!row) return historyUnverified("UNKNOWN", ["HISTORY_ENVELOPE_INVALID"]);
  if (row.backend_acceptance !== "UNPROVEN" || row.history_page_status !== "COMPLETE" || row.status === "UNVERIFIED") {
    return historyUnverified(row.owner_ack_status, uniqueStrings(row.gaps, MAX_GAPS), row.history_get_calls);
  }
  if (row.owner_ack_status !== "MATCHED" || row.owner_echo_message_id !== expected.owner_echo_message_id ||
      row.history_binding_status !== "BOUND" || row.status !== "COMPLETE") {
    return historyUnverified(row.owner_ack_status === "MATCHED" ? "UNKNOWN" : row.owner_ack_status,
      uniqueStrings([...row.gaps, "OWNER_ACK_OR_HISTORY_NOT_BOUND"], MAX_GAPS), row.history_get_calls);
  }
  if (!row.provider_chat_id || !isProviderChatId(row.provider_chat_id)) {
    return historyUnverified("UNKNOWN", uniqueStrings([...row.gaps, "PROVIDER_CHAT_ID_UNAVAILABLE"], MAX_GAPS), row.history_get_calls);
  }
  const seenMessages = new Set<string>(); const seenObjects = new Set<string>();
  const contexts: OwnerElevenLabsDialogueResultContext[] = [];
  for (const rawContext of row.contexts) {
    const context = readResultContext(rawContext);
    if (!context || context.chat_uuid !== expected.chat_uuid || context.model_id !== expected.model_id ||
        context.provider_chat_id !== row.provider_chat_id || context.owner_echo_message_id !== expected.owner_echo_message_id ||
        context.attempt_id !== expected.attempt_id || !sameGenerationPrincipal(context.principal, expected.principal) ||
        context.voice_epoch !== expected.voice_epoch || context.intent_fingerprint !== expected.intent_fingerprint ||
        context.profile_schema_hash !== expected.profile_schema_hash || context.source_profile_schema_hash !== expected.source_profile_schema_hash ||
        seenMessages.has(context.message_id) || context.message_object_ids.some((id) => seenObjects.has(id))) {
      return historyUnverified("UNKNOWN", uniqueStrings([...row.gaps, "HISTORY_CONTEXT_BINDING_INVALID"], MAX_GAPS), row.history_get_calls);
    }
    seenMessages.add(context.message_id); context.message_object_ids.forEach((id) => seenObjects.add(id));
    // Keep the native-minted object identity intact for its subsequent GET-only result reader.
    contexts.push(rawContext as OwnerElevenLabsDialogueResultContext);
    if (contexts.length > MAX_CONTEXTS) return historyUnverified("UNKNOWN", ["HISTORY_CONTEXT_LIMIT"] , row.history_get_calls);
  }
  return Object.freeze({ availability: contexts.length ? "BOUND" : "PENDING", owner_ack_status: "MATCHED",
    history_get_calls: row.history_get_calls, owner_echo_message_id: expected.owner_echo_message_id,
    contexts: Object.freeze(contexts), gaps: Object.freeze(uniqueStrings(row.gaps, MAX_GAPS)), backend_acceptance: "UNPROVEN" });
}

/** Decodes only message/object identity and safe artifact URL. MIME and provider terminal status are not inferred. */
export function decodeOwnerElevenLabsDialogueResult(raw: unknown, contextInput: OwnerElevenLabsDialogueResultContext | unknown): OwnerElevenLabsDialogueDecodedResult {
  const context = readResultContext(contextInput);
  if (!context) throw new TypeError("INVALID_OWNER_ELEVENLABS_DIALOGUE_RESULT_CONTEXT");
  const row = readResultEnvelope(raw);
  if (!row || row.backend_acceptance !== "UNPROVEN" || row.message_binding !== "BOUND" ||
      (row.model_echo !== "MATCHED" && row.model_echo !== "UNKNOWN")) {
    return resultUnverified(["DIALOGUE_RESULT_BINDING_UNVERIFIED"]);
  }
  if (row.objects.length > MAX_OBJECTS_PER_CONTEXT) return resultUnverified(["DIALOGUE_RESULT_OBJECT_LIMIT"]);
  const expected = new Set(context.message_object_ids);
  const seen = new Set<string>(); const artifacts: OwnerElevenLabsDialogueDecodedResult["artifacts"][number][] = [];
  for (const rawObject of row.objects) {
    const object = readAudioObject(rawObject);
    if (!object || object.object_type !== "audio" || object.object_index < 0 || object.object_index >= MAX_OBJECTS_PER_CONTEXT ||
        !expected.has(object.message_object_id) || seen.has(object.message_object_id) ||
        context.message_object_ids[object.object_index] !== object.message_object_id || !isSafeDialogueAudioUrl(object.object_url)) {
      return resultUnverified(["DIALOGUE_RESULT_PROJECTION_INVALID"]);
    }
    seen.add(object.message_object_id);
    artifacts.push(Object.freeze({ url: object.object_url, mime_type: null, mime_source: "UNKNOWN",
      message_id: context.message_id, message_object_id: object.message_object_id, object_index: object.object_index, object_type: "audio" }));
  }
  const gaps = uniqueStrings(readResultGaps(row.gaps) ?? [], MAX_GAPS);
  for (const id of expected) if (!seen.has(id)) gaps.push("EXPECTED_AUDIO_OBJECT_MISSING");
  return Object.freeze({ availability: artifacts.length === 0 ? "PENDING" : gaps.length ? "PARTIAL" : "OBSERVED",
    model_echo: row.model_echo, artifacts: Object.freeze(artifacts), gaps: Object.freeze(uniqueStrings(gaps, MAX_GAPS)),
    backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
}

function historyUnverified(ack: OwnerElevenLabsDialogueHistoryInput["owner_ack_status"], gaps: readonly string[], calls = 0): OwnerElevenLabsDialogueDecodedHistory {
  return Object.freeze({ availability: "UNVERIFIED", owner_ack_status: ack, history_get_calls: boundedCount(calls),
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze(uniqueStrings(gaps, MAX_GAPS)), backend_acceptance: "UNPROVEN" });
}
function resultUnverified(gaps: readonly string[]): OwnerElevenLabsDialogueDecodedResult {
  return Object.freeze({ availability: "UNVERIFIED", model_echo: "UNKNOWN", artifacts: Object.freeze([]),
    gaps: Object.freeze(uniqueStrings(gaps, MAX_GAPS)), backend_acceptance: "UNPROVEN", provider_terminal_status: "UNPROVEN" });
}
function readExpectation(value: unknown): Readonly<OwnerElevenLabsDialogueHistoryExpectation> {
  const row = record(value, ["chat_uuid", "attempt_id", "principal", "model_id", "owner_echo_message_id", "voice_epoch",
    "intent_fingerprint", "profile_schema_hash", "source_profile_schema_hash"]);
  if (!row || !isSafeId(row.chat_uuid) || !isAttempt(row.attempt_id) || !isDialogueModel(row.model_id) ||
      !isSafeId(row.owner_echo_message_id) || !Number.isSafeInteger(row.voice_epoch) || (row.voice_epoch as number) < 0 ||
      !isHash(row.intent_fingerprint) || !isHash(row.profile_schema_hash) || !isHash(row.source_profile_schema_hash)) {
    throw new TypeError("INVALID_OWNER_ELEVENLABS_DIALOGUE_HISTORY_EXPECTATION");
  }
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef); }
  catch { throw new TypeError("INVALID_OWNER_ELEVENLABS_DIALOGUE_HISTORY_EXPECTATION"); }
  if (principal.connection_id !== row.attempt_id) throw new TypeError("INVALID_OWNER_ELEVENLABS_DIALOGUE_HISTORY_EXPECTATION");
  return Object.freeze({ chat_uuid: row.chat_uuid, attempt_id: row.attempt_id, principal, model_id: row.model_id,
    owner_echo_message_id: row.owner_echo_message_id, voice_epoch: row.voice_epoch as number,
    intent_fingerprint: row.intent_fingerprint, profile_schema_hash: row.profile_schema_hash, source_profile_schema_hash: row.source_profile_schema_hash });
}
function readHistoryEnvelope(value: unknown): OwnerElevenLabsDialogueHistoryInput | undefined {
  const row = record(value, ["status", "owner_ack_status", "history_binding_status", "history_page_status", "history_get_calls",
    "provider_chat_id", "owner_echo_message_id", "contexts", "gaps", "backend_acceptance"]);
  if (!row || !["COMPLETE", "PENDING", "UNVERIFIED"].includes(String(row.status)) ||
      !["MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH", "UNKNOWN"].includes(String(row.owner_ack_status)) ||
      !["BOUND", "PARTIAL", "UNVERIFIED"].includes(String(row.history_binding_status)) ||
      !["COMPLETE", "INCOMPLETE", "UNVERIFIED"].includes(String(row.history_page_status)) ||
      !Number.isSafeInteger(row.history_get_calls) || (row.history_get_calls as number) < 0 ||
      !(row.provider_chat_id === null || typeof row.provider_chat_id === "string") ||
      !(row.owner_echo_message_id === null || typeof row.owner_echo_message_id === "string") ||
      !denseArray(row.contexts, MAX_CONTEXTS) || !denseArray(row.gaps, MAX_GAPS) ||
      (row.gaps as unknown[]).some((gap) => typeof gap !== "string" || gap.length > 96) || row.backend_acceptance !== "UNPROVEN") return undefined;
  return row as unknown as OwnerElevenLabsDialogueHistoryInput;
}
function readResultContext(value: unknown): OwnerElevenLabsDialogueResultContext | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return undefined;
  const row = record(value, ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids", "owner_echo_message_id",
    "attempt_id", "principal", "voice_epoch", "intent_fingerprint", "profile_schema_hash", "source_profile_schema_hash"]);
  if (!row || !isSafeId(row.chat_uuid) || !isSafeId(row.message_id) || !isDialogueModel(row.model_id) ||
      typeof row.provider_chat_id !== "string" || !isProviderChatId(row.provider_chat_id) || !isSafeId(row.owner_echo_message_id) ||
      !isAttempt(row.attempt_id) || !Number.isSafeInteger(row.voice_epoch) || (row.voice_epoch as number) < 0 ||
      !isHash(row.intent_fingerprint) || !isHash(row.profile_schema_hash) || !isHash(row.source_profile_schema_hash) ||
      !denseArray(row.message_object_ids, MAX_OBJECTS_PER_CONTEXT)) return undefined;
  const ids = row.message_object_ids as unknown[];
  if (!ids.length || ids.some((id) => !isSafeId(id)) || new Set(ids).size !== ids.length) return undefined;
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(row.principal as GenerationPrincipalRef); } catch { return undefined; }
  if (principal.connection_id !== row.attempt_id) return undefined;
  return Object.freeze({ chat_uuid: row.chat_uuid, message_id: row.message_id, model_id: row.model_id,
    provider_chat_id: row.provider_chat_id, message_object_ids: Object.freeze([...ids]) as readonly string[],
    owner_echo_message_id: row.owner_echo_message_id, attempt_id: row.attempt_id, principal, voice_epoch: row.voice_epoch as number,
    intent_fingerprint: row.intent_fingerprint, profile_schema_hash: row.profile_schema_hash,
    source_profile_schema_hash: row.source_profile_schema_hash });
}
function readResultEnvelope(value: unknown): OwnerElevenLabsDialogueResultInput | undefined {
  const row = record(value, ["message_binding", "model_echo", "objects", "gaps", "backend_acceptance"]);
  if (!row || !["BOUND", "UNVERIFIED"].includes(String(row.message_binding)) ||
      !["MATCHED", "UNKNOWN", "MISMATCH"].includes(String(row.model_echo)) || !denseArray(row.objects, MAX_OBJECTS_PER_CONTEXT) ||
      !denseArray(row.gaps, MAX_GAPS) || !readResultGaps(row.gaps) ||
      row.backend_acceptance !== "UNPROVEN") return undefined;
  return { ...row, gaps: readResultGaps(row.gaps)! } as unknown as OwnerElevenLabsDialogueResultInput;
}
function readResultGaps(value: unknown): readonly string[] | undefined {
  if (!denseArray(value, MAX_GAPS)) return undefined;
  const gaps: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.length <= 96) { gaps.push(item); continue; }
    const gap = record(item, ["object_index", "code"]);
    if (!gap || !(gap.object_index === null || (Number.isSafeInteger(gap.object_index) && (gap.object_index as number) >= 0)) ||
        typeof gap.code !== "string" || !/^[A-Z0-9_]{1,96}$/u.test(gap.code)) return undefined;
    gaps.push(gap.code);
  }
  return Object.freeze(gaps);
}
function readAudioObject(value: unknown): OwnerElevenLabsDialogueAudioObject | undefined {
  const row = record(value, ["object_index", "message_object_id", "object_type", "object_url"]);
  if (!row || !Number.isSafeInteger(row.object_index) || typeof row.message_object_id !== "string" ||
      !isSafeId(row.message_object_id) || row.object_type !== "audio" || typeof row.object_url !== "string") return undefined;
  return row as unknown as OwnerElevenLabsDialogueAudioObject;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return undefined;
    const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) return undefined;
    const desc = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(desc).length !== keys.length || keys.some((key) => !Object.hasOwn(desc, key) ||
        !("value" in desc[key]!) || desc[key]!.enumerable !== true) || Reflect.ownKeys(desc).some((key) => !keys.includes(String(key)))) return undefined;
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of keys) out[key] = desc[key]!.value;
    return out;
  } catch { return undefined; }
}
function denseArray(value: unknown, maximum: number): value is unknown[] {
  try {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return false;
    const desc = Object.getOwnPropertyDescriptors(value);
    return Reflect.ownKeys(desc).length === value.length + 1 && Object.keys(desc).length === value.length + 1 &&
      Array.from({ length: value.length }, (_, i) => desc[String(i)]).every((item) => !!item && "value" in item && item.enumerable);
  } catch { return false; }
}
function uniqueStrings(values: readonly string[], maximum: number): string[] { return [...new Set(values)].slice(0, maximum); }
function boundedCount(value: number): number { return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100) : 0; }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }
function isAttempt(value: unknown): value is string { return typeof value === "string" && /^link_[A-Za-z0-9_-]{20,120}$/u.test(value); }
function isProviderChatId(value: string): boolean { return SAFE_PROVIDER_CHAT_ID.test(value) && Number.isSafeInteger(Number(value)); }
function isHash(value: unknown): value is string { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value); }
function isDialogueModel(value: unknown): value is OwnerElevenLabsDialogueModel { return value === "eleven_v3" || value === "eleven_v4" || value === "eleven_v4_turbo"; }
function isSafeDialogueAudioUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && !url.port && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
