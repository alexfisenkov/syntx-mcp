import { types } from "node:util";
import { getOwnerGrokT2iSourceParameters, OWNER_GROK_T2I_MODELS, type OwnerGrokT2iModel } from "./owner-grok-t2i-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

const INPUT_KEYS = Object.freeze([
  "snapshot", "requested_chat_uuid", "owner_echo_message_id", "model_id", "requested_batch_size",
  "expected_reference_count", "expected_reference_types", "profile_binding"
] as const);
const PROFILE_KEYS = Object.freeze(["profile_id", "model_id", "public_catalog_version", "profile_schema_hash"] as const);
const SNAPSHOT_KEYS = Object.freeze([
  "complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
  "requested_chat_uuid", "provider_chat_id", "messages"
] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;
const PROFILE_ID = "owner-grok-t2i-source-profile-v1" as const;
const SOURCE_PARAMETERS = getOwnerGrokT2iSourceParameters();

export interface CorrelateOwnerGrokT2iHistoryBindingInput {
  readonly snapshot: unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly requested_batch_size: number;
  readonly expected_reference_count: number;
  readonly expected_reference_types: readonly "image"[];
  readonly profile_binding: Readonly<{
    profile_id: typeof PROFILE_ID;
    model_id: OwnerGrokT2iModel;
    public_catalog_version: string;
    profile_schema_hash: string;
  }>;
}

export type OwnerGrokT2iHistoryBindingReason =
  | "INVALID_INPUT" | "HISTORY_SHAPE_INVALID" | "HISTORY_INCOMPLETE" | "HISTORY_PAGE_INVALID"
  | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_EMPTY" | "HISTORY_MESSAGE_SET_INVALID"
  | "MESSAGE_ID_INVALID" | "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH" | "OBJECT_ID_INVALID"
  | "OBJECT_ID_DUPLICATE" | "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS"
  | "OWNER_REFERENCE_SET_MISMATCH" | "BOT_MESSAGE_NOT_FOUND" | "BOT_MESSAGE_AMBIGUOUS"
  | "BOT_MESSAGE_BEFORE_ACK" | "BOT_OUTPUT_COUNT_INVALID" | "BOT_OUTPUT_NAMESPACE_UNVERIFIED";

interface BindingContext {
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly owner_echo_message_id: string;
  readonly result_message_id: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly profile_id: typeof PROFILE_ID;
  readonly public_catalog_version: string;
  readonly profile_schema_hash: string;
  readonly expected_reference_count: number;
  readonly reference_selector_confidence: "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION";
  readonly requested_batch_size: number;
  readonly message_object_ids: readonly string[];
  readonly profile_binding_confidence: "SOURCE_PROFILE_FINGERPRINT_CARRIED_NOT_AUTHORITY";
  readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerGrokT2iHistoryBinding =
  | Readonly<BindingContext & { status: "READY"; reason: null; observed_output_count: number }>
  | Readonly<BindingContext & { status: "PARTIAL"; reason: "OUTPUT_BATCH_PARTIAL"; observed_output_count: number }>
  | Readonly<{ status: "PENDING"; reason: OwnerGrokT2iHistoryBindingReason }>
  | Readonly<{ status: "UNVERIFIED"; reason: OwnerGrokT2iHistoryBindingReason }>
  | Readonly<{ status: "INVALID"; reason: OwnerGrokT2iHistoryBindingReason }>;

interface NormalizedObject { readonly message_object_id: string; readonly object_type: string; readonly model_type: string | null }
interface NormalizedMessage {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly NormalizedObject[];
}

/** Correlates one exact local T2I request with a bounded history page; READY is not provider acceptance. */
export function correlateOwnerGrokT2iHistoryBinding(input: CorrelateOwnerGrokT2iHistoryBindingInput | unknown): OwnerGrokT2iHistoryBinding {
  let request: Record<string, unknown>;
  try { request = readExactRecord(input, INPUT_KEYS); } catch { return invalid("INVALID_INPUT"); }
  const profile = readProfileBinding(request.profile_binding, request.model_id);
  if (!profile || !isModel(request.model_id) || !isSafeId(request.requested_chat_uuid) || !isSafeId(request.owner_echo_message_id) ||
      !Number.isSafeInteger(request.requested_batch_size) || (request.requested_batch_size as number) < 1 ||
      (request.requested_batch_size as number) > 5 || !Number.isSafeInteger(request.expected_reference_count) ||
      (request.expected_reference_count as number) < 0 ||
      (request.expected_reference_count as number) > SOURCE_PARAMETERS.models_by_id[request.model_id as OwnerGrokT2iModel].reference_count_selector_maximum) return invalid("INVALID_INPUT");
  let expectedTypes: unknown[];
  try { expectedTypes = readArray(request.expected_reference_types, 5); } catch { return invalid("INVALID_INPUT"); }
  if (expectedTypes.length !== request.expected_reference_count || expectedTypes.some((type) => type !== "image")) return invalid("INVALID_INPUT");

  let snapshot: Record<string, unknown>;
  try { snapshot = readExactRecord(request.snapshot, SNAPSHOT_KEYS); } catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
  if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 || snapshot.has_next !== false ||
      snapshot.has_previous !== false || !Number.isSafeInteger(snapshot.total_count)) return invalid("HISTORY_PAGE_INVALID");
  if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) return invalid("CHAT_SCOPE_MISMATCH");
  if (typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id) ||
      !Number.isSafeInteger(Number(snapshot.provider_chat_id))) return invalid("PROVIDER_CHAT_INVALID");
  let rawMessages: unknown[];
  try { rawMessages = readArray(snapshot.messages, 10); } catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.total_count !== rawMessages.length) return invalid("HISTORY_PAGE_INVALID");
  if (rawMessages.length === 0) return pending("HISTORY_EMPTY");

  const messages: NormalizedMessage[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const rawMessage of rawMessages) {
    let message: Record<string, unknown>;
    try { message = readExactRecord(rawMessage, MESSAGE_KEYS); } catch { return invalid("HISTORY_SHAPE_INVALID"); }
    if (!isSafeId(message.message_id)) return invalid("MESSAGE_ID_INVALID");
    if (messageIds.has(message.message_id)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(message.message_id);
    if (message.provider_chat_id !== snapshot.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.author_role !== "owner" && message.author_role !== "bot" && message.author_role !== "other") return invalid("HISTORY_SHAPE_INVALID");
    let rawObjects: unknown[];
    try { rawObjects = readArray(message.objects, 64); } catch { return invalid("HISTORY_SHAPE_INVALID"); }
    const objects: NormalizedObject[] = [];
    for (const rawObject of rawObjects) {
      let object: Record<string, unknown>;
      try { object = readExactRecord(rawObject, OBJECT_KEYS); } catch { return invalid("HISTORY_SHAPE_INVALID"); }
      if (!isSafeId(object.message_object_id)) return invalid("OBJECT_ID_INVALID");
      if (objectIds.has(object.message_object_id)) return invalid("OBJECT_ID_DUPLICATE");
      objectIds.add(object.message_object_id);
      if (typeof object.object_type !== "string" || !(object.model_type === null || typeof object.model_type === "string")) return invalid("HISTORY_SHAPE_INVALID");
      objects.push(Object.freeze({ message_object_id: object.message_object_id, object_type: object.object_type, model_type: object.model_type as string | null }));
    }
    messages.push(Object.freeze({ message_id: message.message_id, provider_chat_id: message.provider_chat_id as string,
      author_role: message.author_role, objects: Object.freeze(objects) }));
  }

  const owners = messages.filter((message) => message.author_role === "owner");
  const owner = messages.find((message) => message.message_id === request.owner_echo_message_id);
  if (owner && owner.author_role !== "owner") return invalid("OWNER_ACK_MISMATCH");
  if (owners.length === 0) return pending("OWNER_ACK_NOT_FOUND");
  if (owners.length !== 1) return invalid("OWNER_ACK_AMBIGUOUS");
  if (owners[0]!.message_id !== request.owner_echo_message_id) return invalid("OWNER_ACK_MISMATCH");
  const bots = messages.filter((message) => message.author_role === "bot");
  if (bots.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bots.length !== 1) return invalid("BOT_MESSAGE_AMBIGUOUS");
  const bot = bots[0]!;
  if (messages.indexOf(bot) < messages.indexOf(owners[0]!)) return invalid("BOT_MESSAGE_BEFORE_ACK");
  if (messages.length !== 2 || messages[0] !== owners[0] || messages[1] !== bot) return invalid("HISTORY_MESSAGE_SET_INVALID");
  if (owners[0]!.objects.length !== expectedTypes.length || owners[0]!.objects.some((object, index) => object.object_type !== expectedTypes[index])) {
    return invalid("OWNER_REFERENCE_SET_MISMATCH");
  }
  if (bot.objects.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bot.objects.length > (request.requested_batch_size as number)) return invalid("BOT_OUTPUT_COUNT_INVALID");
  if (bot.objects.some((object) => object.object_type !== "image" || object.model_type !== request.model_id)) return unverified("BOT_OUTPUT_NAMESPACE_UNVERIFIED");

  const ids = Object.freeze(bot.objects.map((object) => object.message_object_id));
  const context: BindingContext = Object.freeze({
    chat_uuid: request.requested_chat_uuid as string, provider_chat_id: snapshot.provider_chat_id as string,
    owner_echo_message_id: request.owner_echo_message_id as string, result_message_id: bot.message_id,
    model_id: request.model_id as OwnerGrokT2iModel, profile_id: PROFILE_ID,
    public_catalog_version: profile.public_catalog_version, profile_schema_hash: profile.profile_schema_hash,
    expected_reference_count: request.expected_reference_count as number,
    reference_selector_confidence: "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION",
    requested_batch_size: request.requested_batch_size as number,
    message_object_ids: ids, profile_binding_confidence: "SOURCE_PROFILE_FINGERPRINT_CARRIED_NOT_AUTHORITY",
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED", backend_acceptance: "UNPROVEN"
  });
  if (ids.length < context.requested_batch_size) return Object.freeze({ ...context, status: "PARTIAL", reason: "OUTPUT_BATCH_PARTIAL", observed_output_count: ids.length });
  return Object.freeze({ ...context, status: "READY", reason: null, observed_output_count: ids.length });
}

function readProfileBinding(value: unknown, model: unknown): { public_catalog_version: string; profile_schema_hash: string } | null {
  let fields: Record<string, unknown>;
  try { fields = readExactRecord(value, PROFILE_KEYS); } catch { return null; }
  if (fields.profile_id !== PROFILE_ID || fields.model_id !== model || fields.public_catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION ||
      typeof fields.profile_schema_hash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(fields.profile_schema_hash)) return null;
  return { public_catalog_version: fields.public_catalog_version, profile_schema_hash: fields.profile_schema_hash };
}
function isModel(value: unknown): value is OwnerGrokT2iModel { return typeof value === "string" && (OWNER_GROK_T2I_MODELS as readonly string[]).includes(value); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of own as string[]) result[key] = descriptors[key]!.value;
  return result;
}
function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (own.length !== value.length + 1 || own.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]?.value);
}
function invalid(reason: OwnerGrokT2iHistoryBindingReason): OwnerGrokT2iHistoryBinding { return Object.freeze({ status: "INVALID", reason }); }
function pending(reason: OwnerGrokT2iHistoryBindingReason): OwnerGrokT2iHistoryBinding { return Object.freeze({ status: "PENDING", reason }); }
function unverified(reason: OwnerGrokT2iHistoryBindingReason): OwnerGrokT2iHistoryBinding { return Object.freeze({ status: "UNVERIFIED", reason }); }
