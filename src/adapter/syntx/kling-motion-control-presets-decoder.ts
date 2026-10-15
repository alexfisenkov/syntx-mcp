import { types as utilTypes } from "node:util";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

export const KLING_MOTION_CONTROL_PRESET_SOURCE_SHAPE = "SOURCE_OBSERVED_RESPONSE_SHAPE_ONLY" as const;
export const KLING_MOTION_CONTROL_PRESET_URL_POLICY = "R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY" as const;
const MAX_RECORDS = 256;
const MAX_GRAPH_NODES = 8_192;
const MAX_GRAPH_DEPTH = 32;
const MAX_NAME_BYTES = 160;
const MAX_URL_BYTES = 4_096;
const KNOWN_FIELDS = new Set(["name", "preview", "audio", "noaudio", "audio_preview", "noaudio_preview", "top"]);

export interface KlingMotionControlPresetGap {
  readonly index: number;
  readonly code: "UNKNOWN_ENTRY_FIELD" | "VARIANT_URL_INVALID" | "VARIANT_URL_UNSAFE" |
    "VARIANT_URL_ORIGIN_UNVERIFIED" | "PREVIEW_URL_INVALID" | "PREVIEW_URL_UNSAFE" |
    "PREVIEW_URL_ORIGIN_UNVERIFIED" | "NO_SAFE_VARIANT";
}

export interface DecodedKlingMotionControlPreset {
  readonly index: number;
  readonly name: string;
  readonly audio_url?: string;
  readonly noaudio_url?: string;
  readonly preview_url?: string;
  readonly audio_preview_url?: string;
  readonly noaudio_preview_url?: string;
  readonly availability: Readonly<{ audio: boolean; noaudio: boolean }>;
}

export interface DecodedKlingMotionControlPresets {
  readonly source_shape: typeof KLING_MOTION_CONTROL_PRESET_SOURCE_SHAPE;
  readonly url_policy: typeof KLING_MOTION_CONTROL_PRESET_URL_POLICY;
  readonly entries: readonly DecodedKlingMotionControlPreset[];
  readonly gaps: readonly KlingMotionControlPresetGap[];
}

type PlainRecord = Record<string, unknown>;

/**
 * Decodes only the observed response.data array form. Returned URLs are inert
 * data and confer no client, upload, preset-library, or generation authority.
 */
export function decodeKlingMotionControlPresets(raw: unknown): DecodedKlingMotionControlPresets {
  if (!Array.isArray(raw) || utilTypes.isProxy(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > MAX_RECORDS) invalidResponse();
  inspectDataGraph(raw);

  const rootDescriptors = Object.getOwnPropertyDescriptors(raw);
  const ownKeys = Reflect.ownKeys(rootDescriptors);
  if (ownKeys.some((key) => typeof key !== "string" || (key !== "length" && !isArrayIndex(key, raw.length)))) invalidResponse();
  const entries: DecodedKlingMotionControlPreset[] = [];
  const gaps: KlingMotionControlPresetGap[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const descriptor = rootDescriptors[String(index)];
    if (!descriptor || !("value" in descriptor)) invalidResponse();
    const record = descriptor.value;
    if (!isPlainRecord(record)) invalidResponse();
    const fields = Object.getOwnPropertyDescriptors(record);
    const keys = Reflect.ownKeys(fields);
    const values: PlainRecord = Object.create(null) as PlainRecord;
    for (const key of keys) {
      if (typeof key !== "string") {
        gaps.push(makeGap(index, "UNKNOWN_ENTRY_FIELD"));
        continue;
      }
      const fieldDescriptor = fields[key];
      if (!fieldDescriptor || !("value" in fieldDescriptor)) invalidResponse();
      values[key] = fieldDescriptor.value;
      if (!KNOWN_FIELDS.has(key)) gaps.push(makeGap(index, "UNKNOWN_ENTRY_FIELD"));
    }

    const name = readName(values.name);
    if (name === null) invalidResponse();
    const output: {
      index: number; name: string; audio_url?: string; noaudio_url?: string; preview_url?: string;
      audio_preview_url?: string; noaudio_preview_url?: string; availability: Readonly<{ audio: boolean; noaudio: boolean }>;
    } = { index, name, availability: Object.freeze({ audio: false, noaudio: false }) };
    const audioUrl = readUrl(values.audio, index, "VARIANT", gaps);
    const noaudioUrl = readUrl(values.noaudio, index, "VARIANT", gaps);
    if (audioUrl.value !== undefined) output.audio_url = audioUrl.value;
    if (noaudioUrl.value !== undefined) output.noaudio_url = noaudioUrl.value;
    output.availability = Object.freeze({ audio: audioUrl.value !== undefined, noaudio: noaudioUrl.value !== undefined });
    if (audioUrl.value === undefined && noaudioUrl.value === undefined) {
      gaps.push(makeGap(index, "NO_SAFE_VARIANT"));
      continue;
    }
    const previewUrl = readUrl(values.preview, index, "PREVIEW", gaps);
    const audioPreviewUrl = readUrl(values.audio_preview, index, "PREVIEW", gaps);
    const noaudioPreviewUrl = readUrl(values.noaudio_preview, index, "PREVIEW", gaps);
    if (previewUrl.value !== undefined) output.preview_url = previewUrl.value;
    if (audioPreviewUrl.value !== undefined) output.audio_preview_url = audioPreviewUrl.value;
    if (noaudioPreviewUrl.value !== undefined) output.noaudio_preview_url = noaudioPreviewUrl.value;
    entries.push(Object.freeze(output));
  }

  return Object.freeze({
    source_shape: KLING_MOTION_CONTROL_PRESET_SOURCE_SHAPE,
    url_policy: KLING_MOTION_CONTROL_PRESET_URL_POLICY,
    entries: Object.freeze(entries),
    gaps: Object.freeze(gaps)
  });
}

function readUrl(value: unknown, index: number, kind: "VARIANT" | "PREVIEW", gaps: KlingMotionControlPresetGap[]): { value?: string } {
  if (value === undefined || value === null) return {};
  const prefix = kind === "VARIANT" ? "VARIANT" : "PREVIEW";
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value || /[\p{Cc}\p{Cf}]/u.test(value) ||
      new TextEncoder().encode(value).byteLength > MAX_URL_BYTES) {
    gaps.push(makeGap(index, `${prefix}_URL_INVALID` as KlingMotionControlPresetGap["code"]));
    return {};
  }
  if (isSafeUploadReferenceUrl(value)) return { value };
  const url = safeParseUrl(value);
  if (!url || url.protocol !== "https:" || url.username !== "" || url.password !== "" || isLocalHostname(url.hostname)) {
    gaps.push(makeGap(index, `${prefix}_URL_UNSAFE`));
  } else {
    gaps.push(makeGap(index, `${prefix}_URL_ORIGIN_UNVERIFIED`));
  }
  return {};
}

function readName(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  try {
    if (encodeURIComponent(value).length === 0 || new TextEncoder().encode(value).byteLength > MAX_NAME_BYTES) return null;
  } catch { return null; }
  return value.trim();
}

function inspectDataGraph(root: unknown): void {
  const visiting = new WeakSet<object>();
  const visited = new WeakSet<object>();
  let nodes = 0;
  const walk = (value: unknown, depth: number): void => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return;
    if (typeof value === "function" || utilTypes.isProxy(value)) invalidResponse();
    if (visiting.has(value)) invalidResponse();
    if (visited.has(value)) return;
    if (++nodes > MAX_GRAPH_NODES || depth > MAX_GRAPH_DEPTH) invalidResponse();
    visiting.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as keyof typeof descriptors];
      if (!descriptor || !("value" in descriptor)) invalidResponse();
      walk(descriptor.value, depth + 1);
    }
    visiting.delete(value);
    visited.add(value);
  };
  walk(root, 0);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeParseUrl(value: string): URL | null {
  try { return new URL(value); } catch { return null; }
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    host === "::1" || host === "0.0.0.0" || /^127\./u.test(host) || /^10\./u.test(host) ||
    /^192\.168\./u.test(host) || /^169\.254\./u.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./u.test(host);
}

function isArrayIndex(value: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/u.test(value)) return false;
  const index = Number(value);
  return Number.isSafeInteger(index) && index < length;
}

function makeGap(index: number, code: KlingMotionControlPresetGap["code"]): KlingMotionControlPresetGap {
  return Object.freeze({ index, code });
}

function invalidResponse(): never {
  throw new Error("INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE");
}
