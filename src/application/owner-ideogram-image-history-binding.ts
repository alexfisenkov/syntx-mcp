import { types } from "node:util";
import {
  OWNER_IDEOGRAM_IMAGE_CONTEXTS,
  getOwnerIdeogramImageParameterProfile,
  type OwnerIdeogramImageMode,
  type OwnerIdeogramImageModelId
} from "./owner-ideogram-image-parameters.js";

const INPUT_KEYS = Object.freeze(["snapshot", "requested_chat_uuid", "owner_echo_message_id", "model_id", "mode", "requested_mask_present", "output_count"] as const);
const SNAPSHOT_KEYS = Object.freeze(["complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"] as const);
const MESSAGE_KEYS = Object.freeze(["message_id", "provider_chat_id", "author_role", "objects"] as const);
const OBJECT_KEYS = Object.freeze(["message_object_id", "object_type", "model_type"] as const);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_PROVIDER_CHAT_ID = /^\d{1,16}$/u;

export interface CorrelateOwnerIdeogramImageHistoryBindingInput {
  readonly snapshot: unknown;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly model_id: OwnerIdeogramImageModelId;
  readonly mode: OwnerIdeogramImageMode;
  readonly requested_mask_present: boolean;
  readonly output_count: number;
}

export type OwnerIdeogramImageHistoryBindingReason =
  | "INVALID_INPUT" | "HISTORY_INCOMPLETE" | "HISTORY_SHAPE_INVALID" | "HISTORY_PAGE_INVALID"
  | "CHAT_SCOPE_MISMATCH" | "PROVIDER_CHAT_INVALID" | "HISTORY_EMPTY" | "HISTORY_MESSAGE_SET_INVALID"
  | "MESSAGE_ID_INVALID" | "MESSAGE_ID_DUPLICATE" | "MESSAGE_CHAT_MISMATCH" | "OBJECT_ID_INVALID"
  | "OBJECT_ID_DUPLICATE" | "OWNER_ACK_NOT_FOUND" | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS"
  | "BOT_MESSAGE_NOT_FOUND" | "BOT_MESSAGE_AMBIGUOUS" | "BOT_MESSAGE_BEFORE_ACK" | "BOT_MODEL_MISMATCH" | "BOT_OUTPUT_COUNT_INVALID"
  | "OUTPUT_BATCH_PARTIAL" | "MASK_ROLE_ECHO_NOT_SOURCE_BOUND";

export type OwnerIdeogramImageHistoryBinding =
  | Readonly<{
      status: "READY";
      chat_uuid: string;
      provider_chat_id: string;
      owner_echo_message_id: string;
      result_message_id: string;
      model_id: OwnerIdeogramImageModelId;
      mode: OwnerIdeogramImageMode;
      requested_mask_present: boolean;
      mask_acceptance: "UNPROVEN" | "NOT_REQUESTED";
      profile_id: string;
      message_object_ids: readonly string[];
      output_count: number;
      mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO";
      namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
      backend_acceptance: "UNPROVEN";
    }>
  | Readonly<{
      status: "PARTIAL";
      reason: "OUTPUT_BATCH_PARTIAL";
      chat_uuid: string;
      provider_chat_id: string;
      owner_echo_message_id: string;
      result_message_id: string;
      model_id: OwnerIdeogramImageModelId;
      mode: OwnerIdeogramImageMode;
      requested_mask_present: boolean;
      mask_acceptance: "UNPROVEN" | "NOT_REQUESTED";
      message_object_ids: readonly string[];
      output_count: number;
      mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO";
      namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
      backend_acceptance: "UNPROVEN";
    }>
  | Readonly<{ status: "PENDING"; reason: OwnerIdeogramImageHistoryBindingReason }>
  | Readonly<{ status: "NOT_VERIFIABLE"; reason: "MASK_ROLE_ECHO_NOT_SOURCE_BOUND" }>
  | Readonly<{ status: "INVALID"; reason: OwnerIdeogramImageHistoryBindingReason }>;

interface NormalizedObject {
  readonly message_object_id: string;
  readonly object_type: string;
  readonly model_type: string | null;
}
interface NormalizedMessage {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly NormalizedObject[];
}

/** Binds only an exact complete fresh-chat owner ACK and its following bot result. */
export function correlateOwnerIdeogramImageHistoryBinding(input: CorrelateOwnerIdeogramImageHistoryBindingInput | unknown): OwnerIdeogramImageHistoryBinding {
  let request: Record<string, unknown>;
  try { request = readRecord(input, INPUT_KEYS); }
  catch { return invalid("INVALID_INPUT"); }
  if (!isContext(request.model_id, request.mode) || typeof request.requested_mask_present !== "boolean" ||
      (request.requested_mask_present === true && !(request.model_id === "ideogram_45" && request.mode === "precise_edit")) ||
      !isSafeId(request.requested_chat_uuid) || !isSafeId(request.owner_echo_message_id) ||
      !Number.isSafeInteger(request.output_count) || (request.output_count as number) < 1 || (request.output_count as number) > 8) return invalid("INVALID_INPUT");

  let snapshot: Record<string, unknown>;
  try { snapshot = readRecord(request.snapshot, SNAPSHOT_KEYS); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.complete !== true) return pending("HISTORY_INCOMPLETE");
  if (snapshot.page !== 1 || snapshot.page_size !== 10 || snapshot.total_pages !== 1 || snapshot.has_next !== false ||
      snapshot.has_previous !== false || !Number.isSafeInteger(snapshot.total_count)) return invalid("HISTORY_PAGE_INVALID");
  if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) return invalid("CHAT_SCOPE_MISMATCH");
  if (typeof snapshot.provider_chat_id !== "string" || !SAFE_PROVIDER_CHAT_ID.test(snapshot.provider_chat_id) ||
      !Number.isSafeInteger(Number(snapshot.provider_chat_id))) return invalid("PROVIDER_CHAT_INVALID");
  let rawMessages: unknown[];
  try { rawMessages = readArray(snapshot.messages, 10); }
  catch { return invalid("HISTORY_SHAPE_INVALID"); }
  if (snapshot.total_count !== rawMessages.length) return invalid("HISTORY_PAGE_INVALID");
  if (rawMessages.length === 0) return pending("HISTORY_EMPTY");

  const messages: NormalizedMessage[] = [];
  const messageIds = new Set<string>();
  const objectIds = new Set<string>();
  for (const rawMessage of rawMessages) {
    let message: Record<string, unknown>;
    try { message = readRecord(rawMessage, MESSAGE_KEYS); }
    catch { return invalid("HISTORY_SHAPE_INVALID"); }
    if (!isSafeId(message.message_id)) return invalid("MESSAGE_ID_INVALID");
    if (messageIds.has(message.message_id)) return invalid("MESSAGE_ID_DUPLICATE");
    messageIds.add(message.message_id);
    if (message.provider_chat_id !== snapshot.provider_chat_id) return invalid("MESSAGE_CHAT_MISMATCH");
    if (message.author_role !== "owner" && message.author_role !== "bot" && message.author_role !== "other") return invalid("HISTORY_SHAPE_INVALID");
    let rawObjects: unknown[];
    try { rawObjects = readArray(message.objects, 64); }
    catch { return invalid("HISTORY_SHAPE_INVALID"); }
    const objects: NormalizedObject[] = [];
    for (const rawObject of rawObjects) {
      let object: Record<string, unknown>;
      try { object = readRecord(rawObject, OBJECT_KEYS); }
      catch { return invalid("HISTORY_SHAPE_INVALID"); }
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
  const ack = messages.find((message) => message.message_id === request.owner_echo_message_id);
  if (ack && ack.author_role !== "owner") return invalid("OWNER_ACK_MISMATCH");
  if (owners.length === 0) return pending("OWNER_ACK_NOT_FOUND");
  if (owners.length !== 1) return invalid("OWNER_ACK_AMBIGUOUS");
  const owner = owners[0]!;
  if (owner.message_id !== request.owner_echo_message_id) return invalid("OWNER_ACK_MISMATCH");
  const bots = messages.filter((message) => message.author_role === "bot");
  if (bots.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bots.length !== 1) return invalid("BOT_MESSAGE_AMBIGUOUS");
  const bot = bots[0]!;
  if (messages.indexOf(bot) < messages.indexOf(owner)) return invalid("BOT_MESSAGE_BEFORE_ACK");
  if (messages.length !== 2 || messages[0] !== owner || messages[1] !== bot) return invalid("HISTORY_MESSAGE_SET_INVALID");
  if (bot.objects.length === 0) return pending("BOT_MESSAGE_NOT_FOUND");
  if (bot.objects.length > (request.output_count as number)) return invalid("BOT_OUTPUT_COUNT_INVALID");
  if (bot.objects.some((object) => object.object_type !== "image" || object.model_type !== request.model_id)) return invalid("BOT_MODEL_MISMATCH");
  const outputIds = Object.freeze(bot.objects.map((object) => object.message_object_id));
  const shared = {
    chat_uuid: request.requested_chat_uuid as string, provider_chat_id: snapshot.provider_chat_id as string,
    owner_echo_message_id: request.owner_echo_message_id as string, result_message_id: bot.message_id,
    model_id: request.model_id as OwnerIdeogramImageModelId, mode: request.mode as OwnerIdeogramImageMode,
    requested_mask_present: request.requested_mask_present as boolean,
    mask_acceptance: request.requested_mask_present === true ? "UNPROVEN" as const : "NOT_REQUESTED" as const,
    message_object_ids: outputIds, output_count: request.output_count as number,
    mode_confidence: "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO" as const,
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED" as const, backend_acceptance: "UNPROVEN" as const
  };
  if (outputIds.length < (request.output_count as number)) return Object.freeze({ status: "PARTIAL", reason: "OUTPUT_BATCH_PARTIAL", ...shared });
  return Object.freeze({ status: "READY", profile_id: getOwnerIdeogramImageParameterProfile().profile_id, ...shared });
}

function isContext(model: unknown, mode: unknown): model is OwnerIdeogramImageModelId {
  return typeof model === "string" && OWNER_IDEOGRAM_IMAGE_CONTEXTS.some((context) => context.model_id === model && context.mode === mode);
}
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_IDENTIFIER.test(value); }
function readRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) throw new TypeError();
  const record = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) record[key] = descriptors[key]!.value;
  return record;
}
function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new TypeError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw new TypeError();
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
function pending(reason: OwnerIdeogramImageHistoryBindingReason): OwnerIdeogramImageHistoryBinding { return Object.freeze({ status: "PENDING", reason }); }
function invalid(reason: OwnerIdeogramImageHistoryBindingReason): OwnerIdeogramImageHistoryBinding { return Object.freeze({ status: "INVALID", reason }); }
