import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import {
  normalizeOwnerWan30EditGenerationIntent,
  type OwnerWan30EditGenerationIntent
} from "../../application/owner-wan30-edit-generation-parameters.js";
import {
  copyTrustedOwnerWan30EditOriginalBytes,
  isTrustedOwnerWan30EditOriginalProbeResult,
  releaseTrustedOwnerWan30EditOriginalProbeResult,
  type TrustedOwnerWan30EditOriginalProbeResult
} from "./owner-wan30-edit-original-probe.js";
import { SyntxChatHttpClient, type SyntxChatHttpClient as SyntxChatHttpClientInstance } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "./upload-reference-bridge.js";

const MODEL_ID = "wan_30_edit" as const;
const PROFILE_ID = "owner-wan30-edit-web-request-observed-1918" as const;
const MAX_BYTES = 30 * 1024 * 1024;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECEIPTS = new WeakMap<object, LocalVideoState>();
const UPLOADS = new WeakMap<object, UploadState>();
const GENERATIONS = new WeakMap<object, GenerationState>();
const NATIVE_UPLOAD_FILE_REFERENCES = SyntxChatHttpClient.prototype.uploadFileReferences;

export interface OwnerWan30EditValidatedVideo {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly fps: number;
  readonly frame_count: number | null;
  readonly probe_confidence: "LOCAL_FFPROBE_METADATA_ONLY";
  readonly upload_binding: "NOT_ESTABLISHED";
  readonly generation_permit: false;
}

/** The own-upload URL and provider file ID stay in private WeakMap state. */
export interface OwnerWan30EditUploadedVideo {
  readonly status: "uploaded";
  readonly model_id: typeof MODEL_ID;
  readonly reference_type: "video";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: number;
  readonly fps: number;
  readonly frame_count: number | null;
  readonly upload_profile_confidence: "UI_MULTIPART_FIELDS_OBSERVED_1918";
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

export interface OwnerWan30EditGenerationContext {
  readonly status: "ready";
  readonly model_id: typeof MODEL_ID;
  readonly profile_id: typeof PROFILE_ID;
  readonly reference_types: readonly ["video"];
  readonly dispatch_state: "READY" | "RESERVED";
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30EditNativeRequest {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly chat_id: string;
  readonly intent: OwnerWan30EditGenerationIntent;
  readonly reference_video: OwnerWan30EditUploadedVideo;
}

export type OwnerWan30EditOwnerAckUnverifiedReason =
  | "CONTEXT_NOT_RESERVED" | "MESSAGE_ID_INVALID" | "GET_UNAVAILABLE" | "ACK_SHAPE_INVALID"
  | "ACK_ID_MISMATCH" | "ACK_AUTHOR_NOT_OWNER" | "ACK_MODEL_MISMATCH" | "ACK_OBJECTS_MISMATCH" | "CONTEXT_CHANGED";

export type OwnerWan30EditOwnerAckBinding =
  | Readonly<{ status: "BOUND" }>
  | Readonly<{ status: "UNVERIFIED"; reason: OwnerWan30EditOwnerAckUnverifiedReason }>;

export class OwnerWan30EditNativeContextError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_CLIENT" | "UPLOAD_OUTCOME_UNKNOWN" | "INVALID_CONTEXT") {
    super("The owner WAN 3.0 Edit video context could not be established safely.");
    this.name = "OwnerWan30EditNativeContextError";
  }
}

interface LocalVideoState {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly frameCount: number | null;
}

interface UploadState {
  readonly client: SyntxChatHttpClientInstance;
  readonly metadata: OwnerWan30EditUploadedVideo;
  url: string | null;
  released: boolean;
}

interface GenerationState {
  readonly client: SyntxChatHttpClientInstance;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly chatId: string;
  readonly prompt: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly reference: OwnerWan30EditUploadedVideo;
  dispatchState: "READY" | "RESERVED" | "RELEASED";
}

/** Copies only bytes held by a genuine local ffprobe receipt for the observed input case. */
export function validateOwnerWan30EditVideoInput(input: unknown): OwnerWan30EditValidatedVideo {
  if (!isTrustedOwnerWan30EditOriginalProbeResult(input)) fail("INVALID_INPUT");
  let bytes: Uint8Array | undefined;
  try {
    const metadata = readTrustedProbeMetadata(input);
    if (!metadata || !trustedInputMetadata(metadata)) fail("INVALID_INPUT");
    bytes = copyTrustedOwnerWan30EditOriginalBytes(input);
    if (bytes.byteLength !== metadata.size || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) {
      fail("INVALID_INPUT");
    }
    const owned = Buffer.from(bytes);
    const state: LocalVideoState = {
      bytes: owned,
      filename: metadata.filename,
      size: owned.byteLength,
      sha256: metadata.sha256,
      width: metadata.width,
      height: metadata.height,
      durationSeconds: metadata.duration_seconds,
      fps: metadata.fps,
      frameCount: metadata.frame_count
    };
    const receipt: OwnerWan30EditValidatedVideo = Object.freeze({
      status: "LOCAL_SOURCE_VALIDATED",
      model_id: MODEL_ID,
      filename: state.filename,
      mime_type: "video/mp4",
      size: state.size,
      sha256: state.sha256,
      width: state.width,
      height: state.height,
      duration_seconds: state.durationSeconds,
      fps: state.fps,
      frame_count: state.frameCount,
      probe_confidence: "LOCAL_FFPROBE_METADATA_ONLY",
      upload_binding: "NOT_ESTABLISHED",
      generation_permit: false
    });
    RECEIPTS.set(receipt, state);
    return receipt;
  } catch (error) {
    if (error instanceof OwnerWan30EditNativeContextError) throw error;
    return fail("INVALID_INPUT");
  } finally {
    bytes?.fill(0);
    releaseTrustedOwnerWan30EditOriginalProbeResult(input);
  }
}

export function releaseOwnerWan30EditVideoInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = RECEIPTS.get(input as object);
  if (!state) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(input as object);
}

/** The UI multipart tuple was observed for this one owner-uploaded MP4 case. */
export async function uploadOwnerWan30EditVideo(
  clientInput: unknown,
  receiptInput: unknown,
  signal?: AbortSignal
): Promise<OwnerWan30EditUploadedVideo> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_INPUT");
  const methods = nativeClientMethods();
  if (!isExactClient(clientInput, methods)) fail("INVALID_CLIENT");
  const receipt = readValidatedReceipt(receiptInput);
  if (!receipt) fail("INVALID_INPUT");
  if (!RECEIPTS.delete(receiptInput as object)) fail("INVALID_INPUT");
  let bytes: Buffer;
  try { bytes = Buffer.from(receipt.bytes); }
  catch { receipt.bytes.fill(0); fail("INVALID_INPUT"); }
  receipt.bytes.fill(0);
  try {
    const request = Object.freeze({ bytes, filename: receipt.filename, mime_type: "video/mp4" as const,
      destination: "uploaded" as const, check_duplicates: true as const, model_type: MODEL_ID });
    let result: unknown;
    try { result = await Reflect.apply(methods.uploadFileReferences, clientInput, [request, signal]); }
    catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
    const reference = readSingleReference(result);
    if (signal?.aborted || !reference || !isSafeUploadReferenceUrl(reference.url)) fail("UPLOAD_OUTCOME_UNKNOWN");
    const metadata: OwnerWan30EditUploadedVideo = Object.freeze({
      status: "uploaded", model_id: MODEL_ID, reference_type: "video", mime_type: "video/mp4",
      size: receipt.size, sha256: receipt.sha256, width: receipt.width, height: receipt.height,
      duration_seconds: receipt.durationSeconds, fps: receipt.fps, frame_count: receipt.frameCount,
      upload_profile_confidence: "UI_MULTIPART_FIELDS_OBSERVED_1918", owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD"
    });
    UPLOADS.set(metadata, { client: clientInput, metadata, url: reference.url, released: false });
    return metadata;
  } finally { bytes.fill(0); }
}

/** Creates a URL-free nominal context from the exact Edit intent and same-client upload. */
export function createOwnerWan30EditGenerationContext(
  clientInput: unknown,
  input: OwnerWan30EditNativeRequest
): OwnerWan30EditGenerationContext {
  const fields = exactRecord(input, ["attempt_id", "principal", "chat_id", "intent", "reference_video"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
      typeof fields.chat_id !== "string" || !SAFE_ID.test(fields.chat_id)) fail("INVALID_CONTEXT");
  const methods = nativeClientMethods();
  if (!isExactClient(clientInput, methods)) fail("INVALID_CLIENT");
  const principal = snapshotPrincipal(fields.principal);
  const intent = exactRecord(fields.intent, ["model_id", "prompt", "parameters"]);
  if (intent.model_id !== MODEL_ID) fail("INVALID_CONTEXT");
  const normalized = normalizeOwnerWan30EditGenerationIntent({ prompt: intent.prompt, parameters: intent.parameters });
  if (normalized.dispatch_allowed !== false || normalized.runtime_usable !== false ||
      normalized.source_profile_id !== PROFILE_ID || normalized.intent.model_id !== MODEL_ID) fail("INVALID_CONTEXT");
  readUploaded(clientInput, fields.reference_video);
  const parameters = normalized.intent.parameters;
  const settings = Object.freeze({
    model_type: MODEL_ID,
    ...parameters
  });
  const context: OwnerWan30EditGenerationContext = Object.freeze({
    status: "ready", model_id: MODEL_ID, profile_id: PROFILE_ID,
    reference_types: Object.freeze(["video"] as const), dispatch_state: "READY", backend_acceptance: "UNPROVEN"
  });
  GENERATIONS.set(context, {
    client: clientInput,
    attemptId: fields.attempt_id,
    principal,
    chatId: fields.chat_id,
    prompt: normalized.intent.prompt,
    settings,
    reference: fields.reference_video as OwnerWan30EditUploadedVideo,
    dispatchState: "READY"
  });
  return context;
}

/** Reserves the sole generation POST synchronously and returns the exact observed plain-prompt wire shape. */
export function consumeOwnerWan30EditGenerationContext(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ chat_id: string; prompt: string; settings: Readonly<Record<string, unknown>> }> {
  const state = readGeneration(clientInput, contextInput);
  if (!state || state.dispatchState !== "READY") fail("INVALID_CONTEXT");
  const reference = readUploaded(clientInput, state.reference);
  const trustedUrl = reference.url;
  if (!trustedUrl) fail("INVALID_CONTEXT");
  state.dispatchState = "RESERVED";
  return Object.freeze({ chat_id: state.chatId, prompt: state.prompt,
      settings: Object.freeze({ model_type: MODEL_ID,
      file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: trustedUrl })]),
      ...state.settings }) });
}

export function releaseOwnerWan30EditGenerationContext(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = GENERATIONS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.dispatchState === "RELEASED") return false;
  state.dispatchState = "RELEASED";
  GENERATIONS.delete(contextInput as object);
  releaseOwnerWan30EditUploadedVideo(clientInput, state.reference);
  return true;
}

export function releaseOwnerWan30EditUploadedVideo(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = UPLOADS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.released) return false;
  state.url = null;
  state.released = true;
  return UPLOADS.delete(contextInput as object);
}

export function inspectOwnerWan30EditGenerationContext(clientInput: unknown, contextInput: unknown):
  Readonly<{ attempt_id: string; principal: Readonly<GenerationPrincipalRef>; chat_id: string; prompt: string;
    dispatch_state: "READY" | "RESERVED" }> | null {
  const state = readGeneration(clientInput, contextInput);
  return state && state.dispatchState !== "RELEASED" ? Object.freeze({ attempt_id: state.attemptId, principal: state.principal, chat_id: state.chatId,
    prompt: state.prompt, dispatch_state: state.dispatchState }) : null;
}

export function readOwnerWan30EditPrivateWireBinding(clientInput: unknown, contextInput: unknown):
  Readonly<{ prompt: string; reference_url: string }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state) return null;
  try {
    const reference = readUploaded(clientInput, state.reference);
    return reference.url ? Object.freeze({ prompt: state.prompt, reference_url: reference.url }) : null;
  } catch { return null; }
}

export function readOwnerWan30EditPrivateAckContext(clientInput: unknown, contextInput: unknown):
  Readonly<{ chat_uuid: string; prompt: string; reference_url: string }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state || state.dispatchState !== "RESERVED") return null;
  try {
    const reference = readUploaded(clientInput, state.reference);
    return reference.url ? Object.freeze({ chat_uuid: state.chatId, prompt: state.prompt, reference_url: reference.url }) : null;
  } catch { return null; }
}

function readGeneration(client: unknown, context: unknown): GenerationState | null {
  if (!context || typeof context !== "object" || types.isProxy(context)) return null;
  const state = GENERATIONS.get(context as object);
  if (!state || state.client !== client || state.dispatchState === "RELEASED") return null;
  try { return readUploaded(client, state.reference) ? state : null; }
  catch { return null; }
}

function readUploaded(client: unknown, context: unknown): UploadState {
  if (!context || typeof context !== "object" || types.isProxy(context)) fail("INVALID_CONTEXT");
  const state = UPLOADS.get(context as object);
  if (!state || state.metadata !== context || state.client !== client || state.released ||
      state.metadata.model_id !== MODEL_ID || state.metadata.reference_type !== "video" ||
      state.metadata.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD" ||
      !state.url || !isSafeUploadReferenceUrl(state.url)) fail("INVALID_CONTEXT");
  return state;
}

function readValidatedReceipt(input: unknown): LocalVideoState | null {
  if (!input || typeof input !== "object" || types.isProxy(input)) return null;
  const state = RECEIPTS.get(input as object);
  if (!state || !Object.isFrozen(input) || state.bytes.byteLength !== state.size ||
      createHash("sha256").update(state.bytes).digest("hex") !== state.sha256) return null;
  return state;
}

interface NativeMethods { readonly prototype: object; readonly uploadFileReferences: Function }
function nativeClientMethods(): NativeMethods {
  return Object.freeze({ prototype: SyntxChatHttpClient.prototype, uploadFileReferences: NATIVE_UPLOAD_FILE_REFERENCES });
}
function isExactClient(value: unknown, methods: NativeMethods): value is SyntxChatHttpClientInstance {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === methods.prototype &&
      !Object.hasOwn(value, "uploadFileReferences") &&
      Object.getOwnPropertyDescriptor(methods.prototype, "uploadFileReferences")?.value === methods.uploadFileReferences &&
      Reflect.get(value, "uploadFileReferences") === methods.uploadFileReferences;
  } catch { return false; }
}

function readSingleReference(value: unknown): InternalUploadReference | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 1) return null;
  const array = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, "length");
  if (Reflect.ownKeys(array).length !== 2 || !array["0"] || !("value" in array["0"]) || !array["0"].enumerable ||
      !length || length.value !== 1 || Reflect.ownKeys(array).some((key) => key !== "0" && key !== "length")) return null;
  const reference = array["0"].value;
  if (!reference || typeof reference !== "object" || types.isProxy(reference) || Array.isArray(reference) ||
      (Object.getPrototypeOf(reference) !== Object.prototype && Object.getPrototypeOf(reference) !== null)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(reference);
  if (Reflect.ownKeys(descriptors).some((key) => key !== "url" && key !== "file_id") ||
      !descriptors.url || !("value" in descriptors.url) || descriptors.url.enumerable !== true ||
      (descriptors.file_id && (!("value" in descriptors.file_id) || descriptors.file_id.enumerable !== true)) ||
      typeof descriptors.url.value !== "string" || !isSafeUploadReferenceUrl(descriptors.url.value)) return null;
  return Object.freeze({ url: descriptors.url.value });
}

function readTrustedProbeMetadata(input: TrustedOwnerWan30EditOriginalProbeResult): TrustedOwnerWan30EditOriginalProbeResult | null {
  try {
    const prototype = Object.getPrototypeOf(input), descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = ["model_id", "filename", "mime_type", "size", "sha256", "width", "height", "duration_seconds",
      "fps", "frame_count", "container_confidence", "generation_permit"];
    if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(descriptors).length !== keys.length ||
        Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key) ||
          !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) return null;
    return input;
  } catch { return null; }
}

function trustedInputMetadata(value: TrustedOwnerWan30EditOriginalProbeResult): boolean {
  return value.model_id === MODEL_ID && value.mime_type === "video/mp4" &&
    typeof value.filename === "string" && value.filename.toLowerCase().endsWith(".mp4") &&
    Number.isSafeInteger(value.size) && value.size >= 1 && value.size <= MAX_BYTES && /^[a-f0-9]{64}$/u.test(value.sha256) &&
    Number.isSafeInteger(value.width) && value.width > 0 && Number.isSafeInteger(value.height) && value.height > 0 &&
    Math.abs(value.duration_seconds - 2) <= 0.001 && Number.isFinite(value.fps) && value.fps > 0 &&
    (value.frame_count === null || (Number.isSafeInteger(value.frame_count) && value.frame_count > 0)) &&
    value.container_confidence === "LOCAL_FFPROBE_METADATA_ONLY" && value.generation_permit === false;
}

function snapshotPrincipal(value: unknown): Readonly<GenerationPrincipalRef> {
  const fields = exactRecord(value, ["tenant_id", "subject_id", "connection_id"]);
  if (Object.values(fields).some((part) => typeof part !== "string" || part.trim().length === 0)) fail("INVALID_CONTEXT");
  return Object.freeze({ tenant_id: fields.tenant_id as string, subject_id: fields.subject_id as string,
    connection_id: fields.connection_id as string });
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_INPUT");
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), ownKeys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || ownKeys.length !== keys.length ||
        ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) fail("INVALID_INPUT");
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of keys) out[key] = descriptors[key]!.value;
    return out;
  } catch { return fail("INVALID_INPUT"); }
}

function fail(code: ConstructorParameters<typeof OwnerWan30EditNativeContextError>[0]): never {
  throw new OwnerWan30EditNativeContextError(code);
}
