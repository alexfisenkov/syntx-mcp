import { types } from "node:util";

/** Redacted shape-only diagnostics for a future Video2Audio upload observation.
 * This decoder is deliberately separate from receipt admission and cannot create an upload reference.
 */
export type OwnerVideo2AudioUploadDiagnostic = Readonly<{
  http_status_class: "NOT_CAPTURED" | "HTTP_2XX" | "HTTP_3XX" | "HTTP_4XX" | "HTTP_5XX" | "HTTP_OTHER";
  body_kind: "OBJECT" | "ARRAY" | "NULL" | "STRING" | "NUMBER" | "BOOLEAN" | "UNSUPPORTED";
  outer_keys: readonly string[];
  counters: Readonly<Record<"total" | "successful" | "failed" | "duplicates", Readonly<{
    kind: "MISSING" | "INTEGER" | "OTHER";
    value: number | null;
  }>>>;
  files: Readonly<{
    kind: "MISSING" | "ARRAY" | "OTHER";
    count: number | null;
    status_counts: Readonly<Record<"success" | "error" | "duplicate" | "other" | "missing", number>>;
    samples: readonly Readonly<{
      keys: readonly string[];
      status: "success" | "error" | "duplicate" | "other" | "missing";
      content_type: "video/mp4" | "video/webm" | "video/quicktime" | "audio/mpeg" | "OTHER" | "MISSING";
      mime_type: "video/mp4" | "video/webm" | "video/quicktime" | "audio/mpeg" | "OTHER" | "MISSING";
      size: Readonly<{ kind: "MISSING" | "INTEGER" | "OTHER"; value: number | null }>;
      duration_source: "DURATION_NUMBER" | "DURATION_MISSING" | "DURATION_OTHER";
      url: "URL_STRING_PRESENT" | "URL_MISSING" | "URL_OTHER";
    }>[];
  }>;
}>;

const OUTER_KEYS = Object.freeze(["files", "total", "successful", "failed", "duplicates"] as const);
const FILE_KEYS = Object.freeze(["filename", "url", "status", "content_type", "mime_type", "size", "duration"] as const);
const MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "audio/mpeg"]);
const MAX_FILES = 10_000;
const MAX_SAMPLES = 3;

/** Summarizes only known upload-envelope keys and safe scalar metadata; it never returns values such as URL/name/id/hash. */
export function diagnoseOwnerVideo2AudioUploadEnvelope(raw: unknown, httpStatus?: unknown): OwnerVideo2AudioUploadDiagnostic {
  const record = isPlainRecord(raw) ? raw : undefined;
  const fileValue = record ? readField(record, "files") : undefined;
  const files = !types.isProxy(fileValue) && Array.isArray(fileValue) ? fileValue : undefined;
  const statusCounts = { success: 0, error: 0, duplicate: 0, other: 0, missing: 0 };
  const sampleCount = files ? Math.min(files.length, MAX_SAMPLES) : 0;
  const samples = Array.from({ length: sampleCount }, (_, index) => diagnoseFile(readArrayIndex(files!, index)));
  if (files) {
    for (let index = 0; index < Math.min(files.length, MAX_FILES); index += 1) {
      statusCounts[readStatus(readArrayIndex(files, index))] += 1;
    }
  }
  const counters = Object.fromEntries(([
    ["total", record ? readField(record, "total") : undefined], ["successful", record ? readField(record, "successful") : undefined],
    ["failed", record ? readField(record, "failed") : undefined], ["duplicates", record ? readField(record, "duplicates") : undefined]
  ] as const).map(([key, value]) => [key, readCounter(value, record !== undefined && Object.hasOwn(record, key))])) as OwnerVideo2AudioUploadDiagnostic["counters"];
  return Object.freeze({
    http_status_class: statusClass(httpStatus),
    body_kind: bodyKind(raw),
    outer_keys: Object.freeze(record ? OUTER_KEYS.filter((key) => Object.hasOwn(record, key)) : []),
    counters: Object.freeze(counters),
    files: Object.freeze({
      kind: !record || !Object.hasOwn(record, "files") ? "MISSING" : files ? "ARRAY" : "OTHER",
      count: files ? Math.min(files.length, MAX_FILES) : null,
      status_counts: Object.freeze(statusCounts),
      samples: Object.freeze(samples)
    })
  });
}

function diagnoseFile(value: unknown): OwnerVideo2AudioUploadDiagnostic["files"]["samples"][number] {
  const record = isPlainRecord(value) ? value : undefined;
  return Object.freeze({
    keys: Object.freeze(record ? FILE_KEYS.filter((key) => Object.hasOwn(record, key)) : []),
    status: readStatus(value),
    content_type: readMime(record ? readField(record, "content_type") : undefined, record !== undefined && Object.hasOwn(record, "content_type")),
    mime_type: readMime(record ? readField(record, "mime_type") : undefined, record !== undefined && Object.hasOwn(record, "mime_type")),
    size: readSize(record ? readField(record, "size") : undefined, record !== undefined && Object.hasOwn(record, "size")),
    duration_source: !record || !Object.hasOwn(record, "duration") ? "DURATION_MISSING"
      : typeof readField(record, "duration") === "number" && Number.isFinite(readField(record, "duration")) ? "DURATION_NUMBER" : "DURATION_OTHER",
    url: !record || !Object.hasOwn(record, "url") ? "URL_MISSING"
      : typeof readField(record, "url") === "string" ? "URL_STRING_PRESENT" : "URL_OTHER"
  });
}

function readStatus(value: unknown): "success" | "error" | "duplicate" | "other" | "missing" {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "status")) return "missing";
  const status = readField(value, "status");
  if (status === "success" || status === "error" || status === "duplicate") return status;
  return "other";
}

function readMime(value: unknown, present: boolean): "video/mp4" | "video/webm" | "video/quicktime" | "audio/mpeg" | "OTHER" | "MISSING" {
  if (!present) return "MISSING";
  if (typeof value === "string" && MIME_TYPES.has(value)) return value as "video/mp4" | "video/webm" | "video/quicktime" | "audio/mpeg";
  return "OTHER";
}

function readCounter(value: unknown, present: boolean): { kind: "MISSING" | "INTEGER" | "OTHER"; value: number | null } {
  if (!present) return { kind: "MISSING", value: null };
  if (typeof value === "number" && Number.isSafeInteger(value)) return { kind: "INTEGER", value: Math.max(-MAX_FILES, Math.min(MAX_FILES, value)) };
  return { kind: "OTHER", value: null };
}

function readSize(value: unknown, present: boolean): { kind: "MISSING" | "INTEGER" | "OTHER"; value: number | null } {
  if (!present) return { kind: "MISSING", value: null };
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return { kind: "INTEGER", value: Math.min(MAX_FILES * 1024 * 1024, value) };
  return { kind: "OTHER", value: null };
}

function statusClass(value: unknown): OwnerVideo2AudioUploadDiagnostic["http_status_class"] {
  if (typeof value !== "number" || !Number.isInteger(value)) return "NOT_CAPTURED";
  if (value >= 200 && value < 300) return "HTTP_2XX";
  if (value >= 300 && value < 400) return "HTTP_3XX";
  if (value >= 400 && value < 500) return "HTTP_4XX";
  if (value >= 500 && value < 600) return "HTTP_5XX";
  return "HTTP_OTHER";
}

function bodyKind(value: unknown): OwnerVideo2AudioUploadDiagnostic["body_kind"] {
  if (value === null) return "NULL";
  if (value && typeof value === "object" && types.isProxy(value)) return "UNSUPPORTED";
  if (Array.isArray(value)) return "ARRAY";
  if (isPlainRecord(value)) return "OBJECT";
  if (typeof value === "string") return "STRING";
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  return "UNSUPPORTED";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value)) return false;
  if (Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function readField(record: Record<string, unknown>, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch { return undefined; }
}

function readArrayIndex(values: unknown[], index: number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(values, String(index));
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
