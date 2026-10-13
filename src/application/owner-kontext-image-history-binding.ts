import { types } from "node:util";
import type { ChatMessageHistorySnapshot } from "../adapter/syntx/chat-http-client.js";
import { getOwnerKontextImageSourceParameters, type OwnerKontextImageVariant } from "./owner-kontext-image-parameters.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const AUTHOR_ROLES = Object.freeze(["owner", "bot", "other"] as const);
const MAX_HISTORY_ROWS = 10;
const MAX_OBJECTS_PER_ROW = 64;
const SOURCE_PARAMETERS = getOwnerKontextImageSourceParameters();

export const OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS = Object.freeze([
  "INPUT_SCOPE_INVALID",
  "SNAPSHOT_SHAPE_INVALID",
  "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID",
  "PAGE_INCOMPLETE",
  "REQUESTED_CHAT_MISMATCH",
  "PROVIDER_CHAT_ID_INVALID",
  "TOTAL_COUNT_MISMATCH",
  "TOTAL_PAGES_MISMATCH",
  "ROW_SHAPE_INVALID",
  "MESSAGE_ID_INVALID",
  "DUPLICATE_MESSAGE_ID",
  "PROVIDER_CHAT_MISMATCH",
  "AUTHOR_ROLE_INVALID",
  "OWNER_ECHO_MISSING",
  "OWNER_ECHO_AMBIGUOUS",
  "OWNER_ECHO_AUTHOR_MISMATCH",
  "OWNER_ECHO_OBJECT_INVALID",
  "OWNER_ECHO_OBJECT_CARDINALITY_INVALID",
  "OBJECT_LIST_SHAPE_OR_LIMIT_INVALID",
  "OBJECT_SHAPE_INVALID",
  "OBJECT_ID_INVALID",
  "DUPLICATE_OBJECT_ID",
  "BOT_CANDIDATE_CARDINALITY_INVALID",
  "BOT_OBJECT_CARDINALITY_INVALID",
  "BOT_OBJECT_INVALID"
] as const);

export type OwnerKontextImageHistoryBindingInvalidReason =
  typeof OWNER_KONTEXT_IMAGE_HISTORY_INVALID_REASONS[number];

export interface CorrelateOwnerKontextImageHistoryBindingInput {
  readonly snapshot: ChatMessageHistorySnapshot;
  readonly requested_chat_uuid: string;
  readonly owner_echo_message_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly requested_reference_count: number;
}

export type OwnerKontextImageHistoryBindingResult =
  | Readonly<{
      kind: "READY";
      provider_chat_id: string;
      bot_message_id: string;
      object_id: string;
    }>
  | Readonly<{
      kind: "PENDING";
      provider_chat_id: string;
      bot_message_id: string | null;
    }>
  | Readonly<{
      kind: "INVALID";
      reason: OwnerKontextImageHistoryBindingInvalidReason;
    }>;

interface NormalizedKontextHistoryObject {
  readonly message_object_id: string;
  readonly object_type: string;
  readonly model_type: string | null;
}

interface NormalizedKontextHistoryRow {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly NormalizedKontextHistoryObject[];
}

class InvalidHistoryBinding extends Error {
  constructor(readonly reason: OwnerKontextImageHistoryBindingInvalidReason) {
    super("Kontext history binding is invalid.");
  }
}

/** Pure exact correlation over the native normalized history producer output. */
export function correlateOwnerKontextImageHistoryBinding(
  input: CorrelateOwnerKontextImageHistoryBindingInput | unknown
): OwnerKontextImageHistoryBindingResult {
  try {
    const request = readExactRecord(input, [
      "snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant", "requested_reference_count"
    ], "INPUT_SCOPE_INVALID");
    if (!isSafeIdentifier(request.requested_chat_uuid) || !isSafeIdentifier(request.owner_echo_message_id) ||
        !isVariant(request.variant) || !isValidReferenceCount(request.variant, request.requested_reference_count)) {
      fail("INPUT_SCOPE_INVALID");
    }
    const snapshot = readExactRecord(request.snapshot, [
      "complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
      "requested_chat_uuid", "provider_chat_id", "messages"
    ], "SNAPSHOT_SHAPE_INVALID");
    const messages = snapshotArray(snapshot.messages, MAX_HISTORY_ROWS, "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
    if (messages.length === 0) fail("MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== MAX_HISTORY_ROWS ||
        snapshot.has_next !== false || snapshot.has_previous !== false) fail("PAGE_INCOMPLETE");
    if (snapshot.requested_chat_uuid !== request.requested_chat_uuid) fail("REQUESTED_CHAT_MISMATCH");
    if (!isNumericProviderChatId(snapshot.provider_chat_id)) fail("PROVIDER_CHAT_ID_INVALID");
    if (!Number.isSafeInteger(snapshot.total_count) || snapshot.total_count !== messages.length) fail("TOTAL_COUNT_MISMATCH");
    if (snapshot.total_pages !== 1) fail("TOTAL_PAGES_MISMATCH");

    const providerChatId = snapshot.provider_chat_id;
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    const rows = messages.map((message) => snapshotMessageRow(message, providerChatId, messageIds, objectIds));
    const ownerEchoId = request.owner_echo_message_id;
    const echoRows = rows.filter((row) => row.message_id === ownerEchoId);
    if (echoRows.some((row) => row.author_role !== "owner")) fail("OWNER_ECHO_AUTHOR_MISMATCH");
    const ownerRows = rows.filter((row) => row.author_role === "owner");
    if (ownerRows.length > 1) fail("OWNER_ECHO_AMBIGUOUS");
    if (ownerRows.length === 0) {
      if (echoRows.length > 0) fail("OWNER_ECHO_AUTHOR_MISMATCH");
      fail("OWNER_ECHO_MISSING");
    }
    const owner = ownerRows[0]!;
    if (owner.message_id !== ownerEchoId || echoRows.length !== 1) fail("OWNER_ECHO_AUTHOR_MISMATCH");
    validateOwnerEchoObjects(owner.objects, request.variant, request.requested_reference_count);

    const botRows = rows.filter((row) => row.author_role === "bot");
    if (botRows.length > 1) fail("BOT_CANDIDATE_CARDINALITY_INVALID");
    if (botRows.length === 0) return pending(providerChatId, null);
    const bot = botRows[0]!;
    if (bot.objects.length === 0) return pending(providerChatId, bot.message_id);
    if (bot.objects.length !== 1) fail("BOT_OBJECT_CARDINALITY_INVALID");
    const resultObject = bot.objects[0]!;
    if (resultObject.object_type !== "image" || resultObject.model_type !== request.variant) {
      fail("BOT_OBJECT_INVALID");
    }
    return Object.freeze({
      kind: "READY",
      provider_chat_id: providerChatId,
      bot_message_id: bot.message_id,
      object_id: resultObject.message_object_id
    });
  } catch (error) {
    return invalid(error instanceof InvalidHistoryBinding ? error.reason : "SNAPSHOT_SHAPE_INVALID");
  }
}

function snapshotMessageRow(
  input: unknown,
  expectedProviderChatId: string,
  messageIds: Set<string>,
  objectIds: Set<string>
): NormalizedKontextHistoryRow {
  const row = readExactRecord(input,
    ["message_id", "provider_chat_id", "author_role", "objects"], "ROW_SHAPE_INVALID");
  if (!isSafeIdentifier(row.message_id)) fail("MESSAGE_ID_INVALID");
  if (messageIds.has(row.message_id)) fail("DUPLICATE_MESSAGE_ID");
  messageIds.add(row.message_id);
  if (row.provider_chat_id !== expectedProviderChatId) fail("PROVIDER_CHAT_MISMATCH");
  if (!AUTHOR_ROLES.includes(row.author_role as typeof AUTHOR_ROLES[number])) fail("AUTHOR_ROLE_INVALID");
  const objects = snapshotArray(row.objects, MAX_OBJECTS_PER_ROW, "OBJECT_LIST_SHAPE_OR_LIMIT_INVALID").map((entry) => {
    const object = readExactRecord(entry,
      ["message_object_id", "object_type", "model_type"], "OBJECT_SHAPE_INVALID");
    if (!isSafeIdentifier(object.message_object_id)) fail("OBJECT_ID_INVALID");
    if (objectIds.has(object.message_object_id)) fail("DUPLICATE_OBJECT_ID");
    objectIds.add(object.message_object_id);
    if (!isSafeIdentifier(object.object_type) ||
        !(object.model_type === null || isSafeIdentifier(object.model_type))) fail("OBJECT_SHAPE_INVALID");
    return Object.freeze({
      message_object_id: object.message_object_id,
      object_type: object.object_type,
      model_type: object.model_type as string | null
    });
  });
  return Object.freeze({
    message_id: row.message_id,
    provider_chat_id: row.provider_chat_id as string,
    author_role: row.author_role as NormalizedKontextHistoryRow["author_role"],
    objects: Object.freeze(objects)
  });
}

function validateOwnerEchoObjects(
  objects: readonly NormalizedKontextHistoryObject[],
  variant: OwnerKontextImageVariant,
  requestedReferenceCount: number
): void {
  if (objects.length > requestedReferenceCount + 1) fail("OWNER_ECHO_OBJECT_CARDINALITY_INVALID");
  let imageCount = 0;
  let textCount = 0;
  for (const object of objects) {
    if (object.object_type === "image") imageCount += 1;
    else if (object.object_type === "text") textCount += 1;
    else fail("OWNER_ECHO_OBJECT_INVALID");
    if (imageCount > requestedReferenceCount || textCount > 1 ||
        (object.model_type !== null && object.model_type !== variant)) fail("OWNER_ECHO_OBJECT_INVALID");
  }
}

function snapshotArray(
  value: unknown,
  maximum: number,
  reason: OwnerKontextImageHistoryBindingInvalidReason
): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maximum) fail(reason);
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value as object); }
  catch { fail(reason); }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string" ||
      (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail(reason);
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(reason);
    result.push(descriptor.value);
  }
  return result;
}

function readExactRecord(
  value: unknown,
  keys: readonly string[],
  reason: OwnerKontextImageHistoryBindingInvalidReason
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail(reason);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { fail(reason); }
  if (prototype !== Object.prototype && prototype !== null) fail(reason);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !descriptors[key]?.enumerable || !("value" in descriptors[key]!))) fail(reason);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actualKeys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isVariant(value: unknown): value is OwnerKontextImageVariant {
  return typeof value === "string" && SOURCE_PARAMETERS.variants.includes(value as OwnerKontextImageVariant);
}

function isValidReferenceCount(variant: OwnerKontextImageVariant, value: unknown): value is number {
  const policy = SOURCE_PARAMETERS.reference_count[variant];
  return Number.isSafeInteger(value) && (value as number) >= policy.minimum && (value as number) <= policy.maximum;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function isNumericProviderChatId(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 && String(numeric) === value;
}

function pending(providerChatId: string, botMessageId: string | null): OwnerKontextImageHistoryBindingResult {
  return Object.freeze({ kind: "PENDING", provider_chat_id: providerChatId, bot_message_id: botMessageId });
}

function invalid(reason: OwnerKontextImageHistoryBindingInvalidReason): OwnerKontextImageHistoryBindingResult {
  return Object.freeze({ kind: "INVALID", reason });
}

function fail(reason: OwnerKontextImageHistoryBindingInvalidReason): never {
  throw new InvalidHistoryBinding(reason);
}
