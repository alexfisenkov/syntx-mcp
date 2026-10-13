import { types } from "node:util";
import type { OwnerMagnificUpscaleVariant } from "./owner-magnific-upscale-parameters.js";

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const VARIANTS = Object.freeze(["creative", "precision_v1", "precision_v2"] as const);
const AUTHOR_ROLES = Object.freeze(["owner", "bot", "other"] as const);
const MAX_HISTORY_ROWS = 10;
const MAX_OBJECTS_PER_ROW = 64;

export const OWNER_MAGNIFIC_HISTORY_BINDING_REASONS = Object.freeze([
  "INPUT_SCOPE_INVALID",
  "SNAPSHOT_SHAPE_INVALID",
  "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID",
  "ROW_SHAPE_INVALID",
  "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID",
  "ROW_OBJECT_INVALID",
  "PAGE_INCOMPLETE",
  "REQUESTED_CHAT_MISMATCH",
  "PROVIDER_CHAT_ID_INVALID",
  "TOTAL_COUNT_MISMATCH",
  "TOTAL_PAGES_MISMATCH",
  "MESSAGE_ID_INVALID",
  "DUPLICATE_MESSAGE_ID",
  "PROVIDER_CHAT_MISMATCH",
  "AUTHOR_ROLE_INVALID",
  "OWNER_ECHO_MISSING",
  "OWNER_ECHO_AMBIGUOUS",
  "OWNER_ECHO_AUTHOR_MISMATCH",
  "OWNER_ECHO_OBJECT_INVALID",
  "OBJECT_ID_INVALID",
  "DUPLICATE_OBJECT_ID",
  "MESSAGE_CARDINALITY_INVALID",
  "BOT_CANDIDATE_CARDINALITY_INVALID",
  "BOT_OBJECT_CARDINALITY_INVALID",
  "BOT_OBJECT_INVALID"
] as const);

export type OwnerMagnificHistoryBindingInvalidReason = typeof OWNER_MAGNIFIC_HISTORY_BINDING_REASONS[number];

export interface CorrelateOwnerMagnificUpscaleHistoryBindingInput {
  readonly snapshot: unknown;
  readonly requested_chat_uuid: unknown;
  readonly owner_echo_message_id: unknown;
  readonly variant: unknown;
}

export type OwnerMagnificUpscaleHistoryBindingResult =
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
      reason: OwnerMagnificHistoryBindingInvalidReason;
    }>;

interface NormalizedMessageRow {
  readonly message_id: string;
  readonly provider_chat_id: string;
  readonly author_role: "owner" | "bot" | "other";
  readonly objects: readonly Readonly<{
    message_object_id: string;
    object_type: string;
    model_type: string | null;
  }>[];
}

class HistoryBindingInvalid extends Error {
  constructor(readonly reason: OwnerMagnificHistoryBindingInvalidReason) {
    super("Magnific history binding is invalid.");
  }
}

/**
 * Pure correlation over the native normalized ChatMessageHistorySnapshot.
 * The HTTP producer maps raw author_id to author_role (only an exact requested
 * echo with positive author_id becomes owner); raw author_id is not in the
 * normalized snapshot and is deliberately not invented here.
 */
export function correlateOwnerMagnificUpscaleHistoryBinding(
  input: CorrelateOwnerMagnificUpscaleHistoryBindingInput | unknown
): OwnerMagnificUpscaleHistoryBindingResult {
  try {
    const scope = readExactRecord(input, ["snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant"],
      ["snapshot", "requested_chat_uuid", "owner_echo_message_id", "variant"], "INPUT_SCOPE_INVALID");
    if (!isSafeIdentifier(scope.requested_chat_uuid) || !isSafeIdentifier(scope.owner_echo_message_id) || !isVariant(scope.variant)) {
      fail("INPUT_SCOPE_INVALID");
    }
    const requestedChatUuid = scope.requested_chat_uuid;
    const ownerEchoMessageId = scope.owner_echo_message_id;
    const variant = scope.variant;
    const snapshot = readExactRecord(scope.snapshot, ["complete", "page", "page_size", "total_count", "total_pages",
      "has_next", "has_previous", "requested_chat_uuid", "provider_chat_id", "messages"],
      ["complete", "page", "page_size", "total_count", "total_pages", "has_next", "has_previous",
        "requested_chat_uuid", "provider_chat_id", "messages"], "SNAPSHOT_SHAPE_INVALID");
    const rawMessages = snapshotArray(snapshot.messages, MAX_HISTORY_ROWS, "MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
    if (rawMessages.length === 0) fail("MESSAGE_LIST_SHAPE_OR_LIMIT_INVALID");
    if (snapshot.complete !== true || snapshot.page !== 1 || snapshot.page_size !== MAX_HISTORY_ROWS ||
        snapshot.has_next !== false || snapshot.has_previous !== false) fail("PAGE_INCOMPLETE");
    if (snapshot.requested_chat_uuid !== requestedChatUuid) fail("REQUESTED_CHAT_MISMATCH");
    if (!isNumericProviderChatId(snapshot.provider_chat_id)) fail("PROVIDER_CHAT_ID_INVALID");
    if (!Number.isSafeInteger(snapshot.total_count) || snapshot.total_count !== rawMessages.length) fail("TOTAL_COUNT_MISMATCH");
    if (snapshot.total_pages !== 1) fail("TOTAL_PAGES_MISMATCH");

    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    const rows = rawMessages.map((entry) => snapshotMessageRow(entry, snapshot.provider_chat_id as string, messageIds, objectIds));
    const echoRows = rows.filter((row) => row.message_id === ownerEchoMessageId);
    if (echoRows.some((row) => row.author_role !== "owner")) fail("OWNER_ECHO_AUTHOR_MISMATCH");
    const owners = rows.filter((row) => row.author_role === "owner");
    if (owners.length > 1) fail("OWNER_ECHO_AMBIGUOUS");
    if (owners.some((row) => row.message_id !== ownerEchoMessageId)) fail("OWNER_ECHO_AUTHOR_MISMATCH");
    if (owners.length === 0) fail("OWNER_ECHO_MISSING");
    const owner = owners[0]!;
    validateOwnerEchoObjects(owner.objects, variant);

    if (rows.length === 1) {
      return Object.freeze({ kind: "PENDING", provider_chat_id: snapshot.provider_chat_id as string, bot_message_id: null });
    }
    if (rows.length !== 2) fail("MESSAGE_CARDINALITY_INVALID");
    const botCandidates = rows.filter((row) => row.author_role === "bot");
    if (botCandidates.length !== 1) fail("BOT_CANDIDATE_CARDINALITY_INVALID");
    const bot = botCandidates[0]!;
    if (bot.message_id === owner.message_id) fail("MESSAGE_CARDINALITY_INVALID");
    if (bot.objects.length === 0) {
      return Object.freeze({ kind: "PENDING", provider_chat_id: snapshot.provider_chat_id as string, bot_message_id: bot.message_id });
    }
    if (bot.objects.length !== 1) fail("BOT_OBJECT_CARDINALITY_INVALID");
    const object = bot.objects[0]!;
    if (object.object_type !== "image" || object.model_type !== variant) fail("BOT_OBJECT_INVALID");
    return Object.freeze({
      kind: "READY",
      provider_chat_id: snapshot.provider_chat_id as string,
      bot_message_id: bot.message_id,
      object_id: object.message_object_id
    });
  } catch (error) {
    return invalid(error instanceof HistoryBindingInvalid ? error.reason : "SNAPSHOT_SHAPE_INVALID");
  }
}

function snapshotMessageRow(
  value: unknown,
  expectedProviderChatId: string,
  messageIds: Set<string>,
  objectIds: Set<string>
): NormalizedMessageRow {
  const fields = readExactRecord(value, ["message_id", "provider_chat_id", "author_role", "objects"],
    ["message_id", "provider_chat_id", "author_role", "objects"], "ROW_SHAPE_INVALID");
  if (!isSafeIdentifier(fields.message_id)) fail("MESSAGE_ID_INVALID");
  if (messageIds.has(fields.message_id)) fail("DUPLICATE_MESSAGE_ID");
  messageIds.add(fields.message_id);
  if (fields.provider_chat_id !== expectedProviderChatId) fail("PROVIDER_CHAT_MISMATCH");
  if (!AUTHOR_ROLES.includes(fields.author_role as typeof AUTHOR_ROLES[number])) fail("AUTHOR_ROLE_INVALID");
  const rawObjects = snapshotArray(fields.objects, MAX_OBJECTS_PER_ROW, "ROW_OBJECTS_SHAPE_OR_LIMIT_INVALID");
  const objects = rawObjects.map((entry) => {
    const object = readExactRecord(entry, ["message_object_id", "object_type", "model_type"],
      ["message_object_id", "object_type", "model_type"], "ROW_OBJECT_INVALID");
    if (!isSafeIdentifier(object.message_object_id)) fail("OBJECT_ID_INVALID");
    if (objectIds.has(object.message_object_id)) fail("DUPLICATE_OBJECT_ID");
    objectIds.add(object.message_object_id);
    if (typeof object.object_type !== "string" || !isSafeIdentifier(object.object_type) ||
        !(object.model_type === null || (typeof object.model_type === "string" && isSafeIdentifier(object.model_type)))) {
      fail("ROW_OBJECT_INVALID");
    }
    return Object.freeze({
      message_object_id: object.message_object_id,
      object_type: object.object_type,
      model_type: object.model_type as string | null
    });
  });
  return Object.freeze({
    message_id: fields.message_id,
    provider_chat_id: fields.provider_chat_id as string,
    author_role: fields.author_role as NormalizedMessageRow["author_role"],
    objects: Object.freeze(objects)
  });
}

function validateOwnerEchoObjects(objects: readonly NormalizedMessageRow["objects"][number][], variant: OwnerMagnificUpscaleVariant): void {
  if (objects.length > 2) fail("OWNER_ECHO_OBJECT_INVALID");
  let imageCount = 0;
  let textCount = 0;
  for (const object of objects) {
    if (object.object_type === "image") imageCount += 1;
    else if (object.object_type === "text") textCount += 1;
    else fail("OWNER_ECHO_OBJECT_INVALID");
    if (imageCount > 1 || textCount > 1 || (object.model_type !== null && object.model_type !== variant)) {
      fail("OWNER_ECHO_OBJECT_INVALID");
    }
  }
}

function snapshotArray(value: unknown, maximum: number, reason: OwnerMagnificHistoryBindingInvalidReason): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    fail(reason);
  }
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value as object); }
  catch { fail(reason); }
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor?.value !== value.length || keys.length !== value.length + 1 ||
      keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/u.test(key)))) fail(reason);
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail(reason);
    output.push(descriptor.value);
  }
  return output;
}

function readExactRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  reason: OwnerMagnificHistoryBindingInvalidReason
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail(reason);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch { fail(reason); }
  if (prototype !== Object.prototype && prototype !== null) fail(reason);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !descriptors[key]?.enumerable || !("value" in descriptors[key]!)) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) fail(reason);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value);
}

function isNumericProviderChatId(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 && String(numeric) === value;
}

function isVariant(value: unknown): value is OwnerMagnificUpscaleVariant {
  return typeof value === "string" && (VARIANTS as readonly string[]).includes(value);
}

function invalid(reason: OwnerMagnificHistoryBindingInvalidReason): OwnerMagnificUpscaleHistoryBindingResult {
  return Object.freeze({ kind: "INVALID", reason });
}

function fail(reason: OwnerMagnificHistoryBindingInvalidReason): never {
  throw new HistoryBindingInvalid(reason);
}
