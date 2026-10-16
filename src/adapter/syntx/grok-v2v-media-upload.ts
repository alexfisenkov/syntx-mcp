import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  isOwnerGrokV2vOriginalProbe,
  readOwnerGrokV2vOriginalProbeBytes,
  type OwnerGrokV2vOriginalProbeResult
} from "../../application/owner-grok-v2v-original-probe.js";
import {
  getOwnerGrokV2vSourceProfile,
  OWNER_GROK_V2V_MODEL_ID,
  OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION
} from "../../application/owner-grok-v2v-source-profile.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

export type OwnerGrokV2vUploadDestination = "uploaded" | "hidden";
const MAX_INPUT_BYTES = 52_428_800;
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 8.7;
const MODEL_ID = OWNER_GROK_V2V_MODEL_ID;
const AI_NAME = "grok_video" as const;

export interface ValidatedOwnerGrokV2vUploadInput {
  readonly model_id: "grok_v2v";
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly context_fields: Readonly<{ metadata: OwnerGrokV2vOriginalProbeResult["metadata"] }>;
}

export interface OwnerGrokV2vUploadContext {
  readonly status: "OWNER_GROK_V2V_ORIGINAL_UPLOADED";
  readonly model_id: typeof MODEL_ID;
  readonly ai_name: typeof AI_NAME;
  readonly source_catalog_version: typeof OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION;
  readonly destination: OwnerGrokV2vUploadDestination;
  readonly filename: string;
  readonly source_mime_type: "video/mp4" | "video/quicktime";
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly metadata: OwnerGrokV2vOriginalProbeResult["metadata"];
}

interface ValidatedState {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerGrokV2vOriginalProbeResult["mime_type"];
  readonly size: number;
  readonly sha256: string;
  readonly metadata: OwnerGrokV2vOriginalProbeResult["metadata"];
}

const validatedStates = new WeakMap<object, ValidatedState>();
const validatedDescriptors = new WeakMap<object, Readonly<Record<string, PropertyDescriptor>>>();
const validatedOwners = new WeakMap<ValidatedState, object>();

/** Accepts only an unmodified, process-local Grok V2V probe and returns its own copied bytes. */
export function validateOwnerGrokV2vOriginalForUpload(input: unknown): ValidatedOwnerGrokV2vUploadInput {
  if (!isOwnerGrokV2vOriginalProbe(input)) throw new Error("GROK_V2V_PROBE_UNTRUSTED");
  const probe = input as OwnerGrokV2vOriginalProbeResult;
  let bytes: Uint8Array;
  try { bytes = readOwnerGrokV2vOriginalProbeBytes(input); }
  catch { throw new Error("GROK_V2V_PROBE_UNTRUSTED"); }

  try {
    const profile = getOwnerGrokV2vSourceProfile(MODEL_ID);
    const mimeMatches = probe.mime_type === "video/mp4" ? probe.filename.toLowerCase().endsWith(".mp4") :
      probe.mime_type === "video/quicktime" && probe.filename.toLowerCase().endsWith(".mov");
    const metadata = probe.metadata;
    if (!profile || profile.status !== "SOURCE_REVIEWED_STATIC_ONLY" || profile.model_id !== MODEL_ID ||
        profile.ai_name !== AI_NAME || profile.source_pins.public_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION ||
        profile.source_pins !== probe.source_pins || profile.input.role !== "video" || profile.input.file_count_limit !== 1 ||
        profile.input.max_file_size_bytes !== MAX_INPUT_BYTES || profile.input.total_duration_seconds.minimum !== MIN_DURATION_SECONDS ||
        profile.input.total_duration_seconds.maximum !== MAX_DURATION_SECONDS || profile.input.accepted_file_types.length !== 2 ||
        profile.input.accepted_file_types[0] !== "video/mp4" || profile.input.accepted_file_types[1] !== "video/quicktime" ||
        profile.dispatch_allowed !== false || profile.runtime_usable !== false ||
        probe.status !== "TRUSTED_LOCAL_VIDEO_PROBE" || probe.model_id !== MODEL_ID || probe.ai_name !== AI_NAME ||
        probe.source_catalog_version !== OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION || probe.dispatch_allowed !== false ||
        probe.owner_upload_binding !== "NOT_ESTABLISHED" || !safeFilename(probe.filename) || !mimeMatches ||
        (probe.mime_type === "video/mp4" && metadata.container !== "ISO_BMFF_MP4") ||
        (probe.mime_type === "video/quicktime" && metadata.container !== "QUICKTIME_MOV") ||
        !isRecord(metadata) || !isRecord(metadata.video) || !Object.isFrozen(metadata) || !Object.isFrozen(metadata.video) ||
        !safeCodec(metadata.video.codec_name) || !positiveInteger(metadata.video.width) || !positiveInteger(metadata.video.height) ||
        !nullablePositive(metadata.video.duration_seconds) || !nullablePositive(metadata.container_duration_seconds) ||
        !Number.isSafeInteger(metadata.audio_stream_count) || metadata.audio_stream_count < 0 ||
        metadata.duration_confidence !== "CONTAINER_DURATION_SECONDS_LOCAL_POLICY" ||
        metadata.inspection !== "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE" ||
        !finiteWithin(metadata.duration_seconds, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS) ||
        !Number.isSafeInteger(probe.source_size_bytes) || probe.source_size_bytes < 16 || probe.source_size_bytes > MAX_INPUT_BYTES ||
        bytes.byteLength !== probe.source_size_bytes || !/^[a-f0-9]{64}$/u.test(probe.source_sha256) ||
        createHash("sha256").update(bytes).digest("hex") !== probe.source_sha256) {
      throw new Error("GROK_V2V_PROBE_INVALID");
    }

    const validated: ValidatedOwnerGrokV2vUploadInput = Object.freeze({
      model_id: MODEL_ID,
      bytes,
      filename: probe.filename,
      mime_type: probe.mime_type,
      size: probe.source_size_bytes,
      sha256: probe.source_sha256,
      context_fields: Object.freeze({ metadata })
    });
    validatedStates.set(validated, { bytes, filename: probe.filename, mime_type: probe.mime_type,
      size: probe.source_size_bytes, sha256: probe.source_sha256, metadata });
    const state = validatedStates.get(validated)!;
    validatedOwners.set(state, validated);
    validatedDescriptors.set(validated, Object.getOwnPropertyDescriptors(validated));
    return validated;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

export function parseOwnerGrokV2vUploadReceipt(
  raw: unknown,
  expected: Pick<ValidatedOwnerGrokV2vUploadInput, "filename" | "mime_type" | "size" | "sha256" | "context_fields">
): Readonly<{ url: string }> {
  const state = readValidated(expected);
  if (!state || !validatedBytesMatch(state)) return invalidReceiptAndWipe(state);
  const rawFields = readPlainDataRecord(raw);
  const filesField = rawFields?.get("files");
  const files = filesField?.value;
  if (!rawFields || !filesField || !Object.hasOwn(filesField, "value") || !Array.isArray(files) || types.isProxy(files)) {
    return invalidReceiptAndWipe(state);
  }
  const arrayDescriptors = Object.getOwnPropertyDescriptors(files);
  const fileDescriptor = arrayDescriptors["0"];
  const lengthDescriptor = Object.getOwnPropertyDescriptor(files, "length");
  if (!fileDescriptor || !Object.hasOwn(fileDescriptor, "value") || lengthDescriptor?.value !== 1 ||
      Reflect.ownKeys(arrayDescriptors).length !== 2) return invalidReceiptAndWipe(state);
  const fileFields = readPlainDataRecord(fileDescriptor.value);
  const url = fileFields?.get("url")?.value;
  if (!fileFields || typeof url !== "string" || !isSafeUploadReferenceUrl(url) ||
      !optionalEcho(fileFields, "filename", state.filename, (value) => typeof value === "string") ||
      !optionalEcho(fileFields, "status", "success", (value) => value === "success") ||
      !optionalEcho(fileFields, "size", state.size, (value) => Number.isSafeInteger(value)) ||
      !optionalEcho(fileFields, "mime_type", state.mime_type, (value) => typeof value === "string") ||
      !optionalEcho(fileFields, "content_type", state.mime_type, (value) => typeof value === "string") ||
      !optionalEcho(fileFields, "sha256", state.sha256, (value) => typeof value === "string") ||
      !optionalEcho(fileFields, "source_sha256", state.sha256, (value) => typeof value === "string") ||
      !optionalEcho(fileFields, "model_type", MODEL_ID, (value) => value === MODEL_ID) ||
      !optionalEcho(fileFields, "ai_name", AI_NAME, (value) => value === AI_NAME) ||
      !optionalEcho(fileFields, "width", state.metadata.video.width, (value) => positiveInteger(value)) ||
      !optionalEcho(fileFields, "height", state.metadata.video.height, (value) => positiveInteger(value)) ||
      !validOptionalDuration(fileFields, state.metadata.duration_seconds)) return invalidReceiptAndWipe(state);
  return Object.freeze({ url });
}

export function createOwnerGrokV2vUploadContext(
  validated: ValidatedOwnerGrokV2vUploadInput,
  destination: OwnerGrokV2vUploadDestination
): OwnerGrokV2vUploadContext {
  const state = readValidated(validated);
  if (!state || !validatedBytesMatch(state) || (destination !== "uploaded" && destination !== "hidden")) {
    return invalidProbeAndWipe(state);
  }
  return Object.freeze({
    status: "OWNER_GROK_V2V_ORIGINAL_UPLOADED",
    model_id: MODEL_ID,
    ai_name: AI_NAME,
    source_catalog_version: OWNER_GROK_V2V_PUBLIC_CATALOG_VERSION,
    destination,
    filename: state.filename,
    source_mime_type: state.mime_type,
    mime_type: state.mime_type,
    size: state.size,
    sha256: state.sha256,
    metadata: state.metadata
  });
}

function readValidated(value: unknown): ValidatedState | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const state = validatedStates.get(value);
  const expected = validatedDescriptors.get(value);
  if (!state || !expected || !Object.isFrozen(value)) return undefined;
  const actual = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key) => !expectedKeys.includes(key))) return undefined;
  for (const key of expectedKeys) {
    const current = actual[key as keyof typeof actual], original = expected[key as keyof typeof expected];
    if (!current || !original || !Object.hasOwn(current, "value") || current.value !== original.value ||
        current.enumerable !== original.enumerable || current.configurable !== false || current.writable !== false) return undefined;
  }
  return state;
}

function validatedBytesMatch(state: ValidatedState): boolean {
  return state.bytes.byteLength === state.size && createHash("sha256").update(state.bytes).digest("hex") === state.sha256;
}

function optionalEcho(
  fields: Map<string, PropertyDescriptor>,
  name: string,
  expected: unknown,
  valid: (value: unknown) => boolean
): boolean {
  const descriptor = fields.get(name);
  return descriptor === undefined || Object.hasOwn(descriptor, "value") && valid(descriptor.value) && descriptor.value === expected;
}

function validOptionalDuration(fields: Map<string, PropertyDescriptor>, expected: number): boolean {
  const descriptor = fields.get("duration");
  if (descriptor === undefined) return true;
  const value = descriptor.value;
  return Object.hasOwn(descriptor, "value") && finiteWithin(value, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS) &&
    normalizeDuration(value) === normalizeDuration(expected);
}

function readPlainDataRecord(value: unknown): Map<string, PropertyDescriptor> | undefined {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) return undefined;
  const fields = new Map<string, PropertyDescriptor>();
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return undefined;
    fields.set(key, descriptor);
  }
  return fields;
}

function invalidReceiptAndWipe(state: ValidatedState | undefined): never {
  wipeValidated(state);
  throw new Error("GROK_V2V_UPLOAD_RECEIPT_INVALID");
}

function invalidProbeAndWipe(state: ValidatedState | undefined): never {
  wipeValidated(state);
  throw new Error("GROK_V2V_PROBE_INVALID");
}

function wipeValidated(state: ValidatedState | undefined): void {
  if (!state) return;
  state.bytes.fill(0);
  const owner = validatedOwners.get(state);
  if (owner) { validatedStates.delete(owner); validatedDescriptors.delete(owner); }
  validatedOwners.delete(state);
}

function safeFilename(filename: string): boolean {
  return filename.length > 0 && filename.length <= 255 && filename === filename.trim() && filename !== "." && filename !== ".." &&
    !/[\\/\p{Cc}\p{Cf}\p{Cs}]/u.test(filename) && !/[. ]$/u.test(filename) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(filename);
}

function safeCodec(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9_+-]{1,64}$/iu.test(value); }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function nullablePositive(value: unknown): value is number | null {
  return value === null || typeof value === "number" && Number.isFinite(value) && value > 0;
}
function finiteWithin(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value);
}
function normalizeDuration(value: number): number { return Number(Number(value).toFixed(2)); }
