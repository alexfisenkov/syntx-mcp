import { types } from "node:util";

// Local parsing bounds only; these are not provider limits or acceptance claims.
const MAX_INERT_GRAPH_DEPTH = 64;
const MAX_INERT_GRAPH_NODES = 4_096;
const MAX_HISTORY_ROWS_PER_PAGE = 10;
const MAX_MESSAGE_OBJECTS = 64;
const UNKNOWN_FIELD_MARKER = "__owner_i2v_unrecognized_wire_field__";
// Root1700-observed auxiliary envelope keys only; a local shape rule, not provider semantics.
const PAGE_AUXILIARY_FIELDS = Object.freeze({ chat_limits: isPlainRecord, context: isPlainRecord });
const PAGINATION_AUXILIARY_FIELDS = Object.freeze({ next_cursor: isCursor, prev_cursor: isCursor });

export type OwnerWanI2vWireEvidenceProjection = Readonly<{ status: "PROJECTED"; value: unknown }> |
  Readonly<{ status: "INVALID" }>;

/** Projects one parsed WAN I2V history page, removing only the known inert metadata fields. */
export function projectOwnerWanI2vHistoryPageEvidence(input: unknown): OwnerWanI2vWireEvidenceProjection {
  if (!isBoundedDescriptorGraph(input)) return INVALID;
  try {
    const page = projectRecord(input, ["messages", "pagination"], [], ["created_at", "updated_at"], PAGE_AUXILIARY_FIELDS);
    if (!page) return INVALID;
    const messages = projectArray(page.messages, MAX_HISTORY_ROWS_PER_PAGE, projectHistoryRow);
    const pagination = projectRecord(page.pagination,
      ["page", "page_size", "total_count", "total_pages", "has_next", "has_previous"], [], ["next", "previous"],
      PAGINATION_AUXILIARY_FIELDS);
    if (!messages || !pagination) return INVALID;
    return projected(Object.freeze({ ...page, messages, pagination }));
  } catch { return INVALID; }
}

/** Projects one parsed WAN I2V result envelope before the unchanged strict result decoder. */
export function projectOwnerWanI2vResultEnvelopeEvidence(input: unknown): OwnerWanI2vWireEvidenceProjection {
  if (!isBoundedDescriptorGraph(input)) return INVALID;
  try {
    const message = projectRecord(input, ["id", "chat_id", "author_id", "message_object"], [],
      ["created_at", "updated_at", "is_favorite"]);
    if (!message) return INVALID;
    const objects = projectArray(message.message_object, MAX_MESSAGE_OBJECTS, projectResultObject);
    if (!objects) return INVALID;
    return projected(Object.freeze({ ...message, message_object: objects }));
  } catch { return INVALID; }
}

const INVALID: OwnerWanI2vWireEvidenceProjection = Object.freeze({ status: "INVALID" });
function projected(value: unknown): OwnerWanI2vWireEvidenceProjection { return Object.freeze({ status: "PROJECTED", value }); }

function projectHistoryRow(input: unknown): Record<string, unknown> | null {
  const row = projectRecord(input, ["id", "chat_id", "author_id", "message_object"], [],
    ["created_at", "updated_at", "is_favorite"]);
  if (!row) return null;
  const objects = projectArray(row.message_object, MAX_MESSAGE_OBJECTS, projectHistoryObject);
  return objects ? { ...row, message_object: objects } : null;
}

function projectHistoryObject(input: unknown): Record<string, unknown> | null {
  return projectRecord(input, ["id", "message_id", "object_type"], ["model_type", "object_text", "completed"],
    ["object_url", "created_at", "updated_at", "task_id", "metadata"]);
}

function projectResultObject(input: unknown): Record<string, unknown> | null {
  return projectRecord(input, ["id", "message_id", "object_type"],
    ["model_type", "completed", "object_url"], ["object_text", "created_at", "updated_at", "task_id", "metadata"]);
}

/** Copies only own data descriptors; unknown names are reduced to one marker consumed as a codec gap. */
function projectRecord(input: unknown, required: readonly string[], consumedOptional: readonly string[], inert: readonly string[],
  auxiliary: Readonly<Record<string, (value: unknown) => boolean>> = {}):
  Record<string, unknown> | null {
  if (!isPlainRecord(input)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output = Object.create(null) as Record<string, unknown>;
  const consumed = [...required, ...consumedOptional];
  let unrecognized = false;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") { unrecognized = true; continue; }
    const descriptor = descriptors[key]!;
    // Full graph validation proved this is enumerable own data; never evaluate a getter here.
    if (consumed.includes(key)) output[key] = descriptor.value;
    else if (inert.includes(key)) continue;
    else if (Object.hasOwn(auxiliary, key)) {
      if (!auxiliary[key]!(descriptor.value)) unrecognized = true;
    } else unrecognized = true;
  }
  if (required.some((key) => !Object.hasOwn(descriptors, key))) return null;
  if (unrecognized) output[UNKNOWN_FIELD_MARKER] = true;
  return Object.freeze(output);
}

function projectArray(input: unknown, maximum: number, project: (value: unknown) => Record<string, unknown> | null):
  readonly Record<string, unknown>[] | null {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== input.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= input.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) return null;
  const output: Record<string, unknown>[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    const projected = project(descriptor.value);
    if (!projected) return null;
    output.push(projected);
  }
  return Object.freeze(output);
}

function isPlainRecord(value: unknown): value is object {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCursor(value: unknown): boolean { return value === null || Number.isSafeInteger(value) && (value as number) >= 0; }

/** Bounds all raw values, including discarded inert metadata, without reading properties through accessors. */
function isBoundedDescriptorGraph(root: unknown): boolean {
  const active = new WeakSet<object>(), visited = new WeakSet<object>();
  let visits = 0;
  const visit = (value: unknown, depth: number): boolean => {
    if (++visits > MAX_INERT_GRAPH_NODES || depth > MAX_INERT_GRAPH_DEPTH) return false;
    if (value === null || typeof value === "string" || typeof value === "boolean") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "object" || types.isProxy(value) || active.has(value)) return false;
    if (visited.has(value)) return true;
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > MAX_INERT_GRAPH_NODES ||
          keys.length !== (length as number) + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
            (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= (length as number)))) {
        active.delete(value); return false;
      }
    }
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true || !visit(descriptor.value, depth + 1)) {
        active.delete(value); return false;
      }
    }
    active.delete(value); visited.add(value); return true;
  };
  try { return visit(root, 0); } catch { return false; }
}
