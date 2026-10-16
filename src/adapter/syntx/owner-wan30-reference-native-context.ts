import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import {
  normalizeOwnerWan30ReferenceGenerationIntent,
  projectOwnerWan30ReferenceGenerationWireCandidate,
  type OwnerWan30ReferenceGenerationIntent
} from "../../application/owner-wan30-reference-generation-parameters.js";
import { inspectBoundedOwnerImageBytesWithMax } from "../../application/owner-image-reference-input-validator.js";
import { SyntxChatHttpClient, type SyntxChatHttpClient as SyntxChatHttpClientInstance } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "./upload-reference-bridge.js";

const MODEL_ID = "wan_30_reference" as const;
const PROFILE_ID = "owner-wan30-reference-web-request-observed-1865" as const;
const POLICY_ID = "OWNER_WAN30_REFERENCE_IMAGE_LOCAL_V1" as const;
const MAX_BYTES = 7 * 1024 * 1024;
const MAX_DIMENSION = 8_000;
const MAX_PIXELS = 52_500_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECEIPTS = new WeakMap<object, LocalImageState>();
const UPLOADS = new WeakMap<object, UploadState>();
const GENERATIONS = new WeakMap<object, GenerationState>();
const NATIVE_UPLOAD_FILE_REFERENCES = SyntxChatHttpClient.prototype.uploadFileReferences;

export interface OwnerWan30ReferenceValidatedImage {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly policy_id: typeof POLICY_ID;
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly upload_binding: "NOT_ESTABLISHED";
  readonly generation_permit: false;
}

/** The uploaded URL and provider file ID exist only in this object's private WeakMap state. */
export interface OwnerWan30ReferenceUploadedImage {
  readonly status: "uploaded";
  readonly model_id: typeof MODEL_ID;
  readonly reference_type: "image";
  readonly mime_type: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly upload_profile_confidence: "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED";
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

export interface OwnerWan30ReferenceGenerationContext {
  readonly status: "ready";
  readonly model_id: typeof MODEL_ID;
  readonly profile_id: typeof PROFILE_ID;
  readonly reference_types: readonly ["image"];
  readonly dispatch_state: "READY" | "RESERVED";
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30ReferenceNativeRequest {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly chat_id: string;
  readonly intent: OwnerWan30ReferenceGenerationIntent;
  readonly reference_image: OwnerWan30ReferenceUploadedImage;
}

export type OwnerWan30ReferenceOwnerAckUnverifiedReason =
  | "CONTEXT_NOT_RESERVED" | "MESSAGE_ID_INVALID" | "GET_UNAVAILABLE" | "ACK_SHAPE_INVALID"
  | "ACK_ID_MISMATCH" | "ACK_AUTHOR_NOT_OWNER" | "ACK_MODEL_MISMATCH" | "ACK_OBJECTS_MISMATCH" | "CONTEXT_CHANGED";

export type OwnerWan30ReferenceOwnerAckBinding =
  | Readonly<{ status: "BOUND" }>
  | Readonly<{ status: "UNVERIFIED"; reason: OwnerWan30ReferenceOwnerAckUnverifiedReason }>;

export class OwnerWan30ReferenceNativeContextError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_CLIENT" | "UPLOAD_OUTCOME_UNKNOWN" | "INVALID_CONTEXT") {
    super("The owner WAN 3.0 Reference image context could not be established safely.");
    this.name = "OwnerWan30ReferenceNativeContextError";
  }
}

interface LocalImageState {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

interface UploadState {
  readonly client: SyntxChatHttpClientInstance;
  readonly metadata: OwnerWan30ReferenceUploadedImage;
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
  readonly reference: OwnerWan30ReferenceUploadedImage;
  dispatchState: "READY" | "RESERVED" | "RELEASED";
}

/** Bounded local PNG/JPEG header metadata check; byte/dimension/pixel caps are local, with no pixel decode/provider limit claim. */
export function validateOwnerWan30ReferenceImageInput(input: unknown): OwnerWan30ReferenceValidatedImage {
  const fields = exactRecord(input, ["filename", "mime_type", "bytes"]);
  if (typeof fields.filename !== "string" || !validFilename(fields.filename, fields.mime_type) ||
      (fields.mime_type !== "image/png" && fields.mime_type !== "image/jpeg")) fail("INVALID_INPUT");
  const source = readBytes(fields.bytes);
  if (source.byteLength < 1 || source.byteLength > MAX_BYTES) { source.fill(0); fail("INVALID_INPUT"); }
  const bytes = Buffer.from(source);
  source.fill(0);
  try {
    const inspected = inspectBoundedOwnerImageBytesWithMax(bytes, MAX_BYTES);
    if (inspected.mime !== fields.mime_type || inspected.width < 1 || inspected.height < 1 ||
        inspected.width > MAX_DIMENSION || inspected.height > MAX_DIMENSION || inspected.width * inspected.height > MAX_PIXELS) {
      fail("INVALID_INPUT");
    }
    const state: LocalImageState = { bytes, filename: fields.filename, mimeType: inspected.mime, size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"), width: inspected.width, height: inspected.height };
    const receipt: OwnerWan30ReferenceValidatedImage = Object.freeze({ status: "LOCAL_SOURCE_VALIDATED", policy_id: POLICY_ID,
      model_id: MODEL_ID, filename: state.filename, mime_type: state.mimeType, size: state.size, sha256: state.sha256,
      width: state.width, height: state.height, upload_binding: "NOT_ESTABLISHED", generation_permit: false });
    RECEIPTS.set(receipt, state);
    return receipt;
  } catch (error) {
    bytes.fill(0);
    if (error instanceof OwnerWan30ReferenceNativeContextError) throw error;
    fail("INVALID_INPUT");
  }
}

export function releaseOwnerWan30ReferenceImageInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = RECEIPTS.get(input as object);
  if (!state) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(input as object);
}

/** Upload tuple is a narrow owner implementation inference; UI multipart fields were not observed. */
export async function uploadOwnerWan30ReferenceImage(
  clientInput: unknown,
  receiptInput: unknown,
  signal?: AbortSignal
): Promise<OwnerWan30ReferenceUploadedImage> {
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
    const request = Object.freeze({ bytes, filename: receipt.filename, mime_type: receipt.mimeType,
      destination: "uploaded" as const, check_duplicates: true as const, model_type: MODEL_ID });
    let result: unknown;
    try { result = await Reflect.apply(methods.uploadFileReferences, clientInput, [request, signal]); }
    catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
    const reference = readSingleReference(result);
    if (signal?.aborted || !reference || !isSafeUploadReferenceUrl(reference.url)) fail("UPLOAD_OUTCOME_UNKNOWN");
    const metadata: OwnerWan30ReferenceUploadedImage = Object.freeze({ status: "uploaded", model_id: MODEL_ID,
      reference_type: "image", mime_type: receipt.mimeType, size: receipt.size, sha256: receipt.sha256,
      width: receipt.width, height: receipt.height,
      upload_profile_confidence: "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED",
      owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD" });
    UPLOADS.set(metadata, { client: clientInput, metadata, url: reference.url, released: false });
    return metadata;
  } finally {
    bytes.fill(0);
  }
}

/** Creates a URL-free nominal context after owner preflight and chat creation. */
export function createOwnerWan30ReferenceGenerationContext(
  clientInput: unknown,
  input: OwnerWan30ReferenceNativeRequest
): OwnerWan30ReferenceGenerationContext {
  const fields = exactRecord(input, ["attempt_id", "principal", "chat_id", "intent", "reference_image"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
      typeof fields.chat_id !== "string" || !SAFE_ID.test(fields.chat_id)) fail("INVALID_CONTEXT");
  const methods = nativeClientMethods();
  if (!isExactClient(clientInput, methods)) fail("INVALID_CLIENT");
  const principal = snapshotPrincipal(fields.principal);
  const intentFields = exactRecord(fields.intent, ["model_id", "prompt", "parameters"]);
  if (intentFields.model_id !== MODEL_ID) fail("INVALID_CONTEXT");
  const normalized = normalizeOwnerWan30ReferenceGenerationIntent({ prompt: intentFields.prompt, parameters: intentFields.parameters });
  const candidate = projectOwnerWan30ReferenceGenerationWireCandidate(normalized.intent);
  if (candidate.dispatch_allowed !== false || candidate.chat_id_bound !== false || candidate.profile_id !== PROFILE_ID ||
      candidate.reference_prompt_plan.file_urls_bound !== false || candidate.reference_prompt_plan.url_source !== "TRUSTED_OWNER_REFERENCE_LAYER_NOT_ACCEPTED_HERE") {
    fail("INVALID_CONTEXT");
  }
  readUploaded(clientInput, fields.reference_image);
  const context: OwnerWan30ReferenceGenerationContext = Object.freeze({ status: "ready", model_id: MODEL_ID,
    profile_id: PROFILE_ID, reference_types: Object.freeze(["image"] as const), dispatch_state: "READY", backend_acceptance: "UNPROVEN" });
  GENERATIONS.set(context, { client: clientInput, attemptId: fields.attempt_id, principal, chatId: fields.chat_id,
    prompt: candidate.prompt_candidate, settings: candidate.settings_candidate,
    reference: fields.reference_image as OwnerWan30ReferenceUploadedImage, dispatchState: "READY" });
  return context;
}

/** Reserves the sole POST before exposing the trusted URL to the native transport. */
export function consumeOwnerWan30ReferenceGenerationContext(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ chat_id: string; prompt: string; settings: Readonly<Record<string, unknown>> }> {
  const state = readGeneration(clientInput, contextInput);
  if (!state || state.dispatchState !== "READY") fail("INVALID_CONTEXT");
  const reference = readUploaded(clientInput, state.reference);
  const trustedUrl = reference.url;
  if (!trustedUrl) fail("INVALID_CONTEXT");
  const { model_type, ...remainingSettings } = state.settings;
  state.dispatchState = "RESERVED";
  return Object.freeze({ chat_id: state.chatId, prompt: `<<<${trustedUrl}>>> ${state.prompt} `,
    settings: Object.freeze({ model_type, file_urls: Object.freeze([Object.freeze({ type: "image" as const, url: trustedUrl })]),
      ...remainingSettings }) });
}

export function releaseOwnerWan30ReferenceGenerationContext(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = GENERATIONS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.dispatchState === "RELEASED") return false;
  state.dispatchState = "RELEASED";
  GENERATIONS.delete(contextInput as object);
  releaseOwnerWan30ReferenceUploadedImage(clientInput, state.reference);
  return true;
}

export function releaseOwnerWan30ReferenceUploadedImage(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = UPLOADS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.released) return false;
  state.url = null;
  state.released = true;
  return UPLOADS.delete(contextInput as object);
}

export function inspectOwnerWan30ReferenceGenerationContext(clientInput: unknown, contextInput: unknown):
  Readonly<{ attempt_id: string; principal: Readonly<GenerationPrincipalRef>; chat_id: string; prompt: string;
    dispatch_state: "READY" | "RESERVED" }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state) return null;
  const dispatchState = state.dispatchState;
  if (dispatchState === "RELEASED") return null;
  return Object.freeze({ attempt_id: state.attemptId, principal: state.principal, chat_id: state.chatId,
    prompt: state.prompt, dispatch_state: dispatchState });
}

/** Internal service-only history binding; never include this URL-bearing value in MCP/public output. */
export function readOwnerWan30ReferencePrivateWireBinding(clientInput: unknown, contextInput: unknown):
  Readonly<{ prompt: string; reference_url: string }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state) return null;
  try {
    const reference = readUploaded(clientInput, state.reference);
    const url = reference.url;
    if (!url) return null;
    return Object.freeze({ prompt: `<<<${url}>>> ${state.prompt} `, reference_url: url });
  } catch { return null; }
}

/** Internal client-only ACK witness. It is available only for the same client's live RESERVED context. */
export function readOwnerWan30ReferencePrivateAckContext(clientInput: unknown, contextInput: unknown):
  Readonly<{ chat_uuid: string; prompt: string; reference_url: string }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state || state.dispatchState !== "RESERVED") return null;
  try {
    const reference = readUploaded(clientInput, state.reference);
    const url = reference.url;
    if (!url) return null;
    return Object.freeze({ chat_uuid: state.chatId, prompt: `<<<${url}>>> ${state.prompt} `, reference_url: url });
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
  if (!state || state.metadata !== context || state.client !== client || state.released || state.metadata.model_id !== MODEL_ID ||
      state.metadata.reference_type !== "image" || state.metadata.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD" ||
      !state.url || !isSafeUploadReferenceUrl(state.url)) fail("INVALID_CONTEXT");
  return state;
}

function readValidatedReceipt(input: unknown): LocalImageState | null {
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
  const array = Object.getOwnPropertyDescriptors(value);
  const length = Object.getOwnPropertyDescriptor(value, "length");
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
function readBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || types.isProxy(value) ||
      (!Buffer.isBuffer(value) && Object.getPrototypeOf(value) !== Uint8Array.prototype) ||
      Object.hasOwn(value, "buffer") || Object.hasOwn(value, "byteOffset") || Object.hasOwn(value, "byteLength") || Object.hasOwn(value, "length")) fail("INVALID_INPUT");
  const byteLength = value.byteLength;
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > MAX_BYTES) fail("INVALID_INPUT");
  return new Uint8Array(value);
}
function validFilename(value: string, mimeType: unknown): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u.test(value)) return false;
  const lower = value.toLowerCase();
  return mimeType === "image/png" ? lower.endsWith(".png") : mimeType === "image/jpeg" ? lower.endsWith(".jpg") || lower.endsWith(".jpeg") : false;
}
function fail(code: ConstructorParameters<typeof OwnerWan30ReferenceNativeContextError>[0]): never {
  throw new OwnerWan30ReferenceNativeContextError(code);
}
