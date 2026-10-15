import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import {
  normalizeOwnerWan30FirstLastGenerationIntent,
  projectOwnerWan30FirstLastGenerationWireCandidate,
  type OwnerWan30FirstLastGenerationIntent
} from "../../application/owner-wan30-first-last-generation-parameters.js";
import { inspectBoundedOwnerImageBytesWithMax } from "../../application/owner-image-reference-input-validator.js";
import { SyntxChatHttpClient, type SyntxChatHttpClient as SyntxChatHttpClientInstance } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "./upload-reference-bridge.js";

const MODEL_ID = "wan_30_first_last_frame" as const;
const POLICY_ID = "OWNER_WAN30_FIRST_LAST_FRAME_INPUT_LOCAL_V1" as const;
const MAX_BYTES = 7 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const RECEIPTS = new WeakMap<object, LocalFrameState>();
const UPLOADS = new WeakMap<object, UploadState>();
const GENERATIONS = new WeakMap<object, GenerationState>();
const NATIVE_UPLOAD_FILE_REFERENCES = SyntxChatHttpClient.prototype.uploadFileReferences;

export type OwnerWan30FirstLastFrameRole = "first_frame" | "last_frame";

/** Safe local metadata only. This is not an assertion of provider input limits or acceptance. */
export interface OwnerWan30FirstLastValidatedFrame {
  readonly status: "LOCAL_SOURCE_VALIDATED";
  readonly policy_id: typeof POLICY_ID;
  readonly model_id: typeof MODEL_ID;
  readonly filename: string;
  readonly mime_type: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly role_binding: "NOT_ESTABLISHED";
  readonly owner_upload_binding: "NOT_ESTABLISHED";
  readonly generation_permit: false;
}

/** URL and provider file id remain private in the weak map. */
export interface OwnerWan30FirstLastUploadedFrame {
  readonly status: "uploaded";
  readonly model_id: typeof MODEL_ID;
  readonly role: OwnerWan30FirstLastFrameRole;
  readonly mime_type: "image/png" | "image/jpeg";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly upload_profile_confidence: "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED";
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

export interface OwnerWan30FirstLastGenerationContext {
  readonly status: "ready";
  readonly model_id: typeof MODEL_ID;
  readonly profile_id: "owner-wan30-first-last-web-request-observed-1823";
  readonly reference_roles: readonly ["first_frame", "last_frame"];
  readonly dispatch_state: "READY" | "RESERVED";
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerWan30FirstLastNativeRequest {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly chat_id: string;
  readonly intent: OwnerWan30FirstLastGenerationIntent;
  readonly first_frame: OwnerWan30FirstLastUploadedFrame;
  readonly last_frame: OwnerWan30FirstLastUploadedFrame;
}

export class OwnerWan30FirstLastNativeContextError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_CLIENT" | "UPLOAD_OUTCOME_UNKNOWN" | "INVALID_CONTEXT") {
    super("The owner WAN 3.0 First and Last Frame context could not be established safely.");
    this.name = "OwnerWan30FirstLastNativeContextError";
  }
}

interface LocalFrameState {
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
  readonly metadata: OwnerWan30FirstLastUploadedFrame;
  readonly role: OwnerWan30FirstLastFrameRole;
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
  readonly first: OwnerWan30FirstLastUploadedFrame;
  readonly last: OwnerWan30FirstLastUploadedFrame;
  dispatchState: "READY" | "RESERVED" | "RELEASED";
}

/**
 * Bounded local PNG/JPEG inspection. The 7 MiB guard is a local resource cap,
 * not a provider limit; dimensions are container metadata, not pixel decode.
 */
export function validateOwnerWan30FirstLastFrameInput(input: unknown): OwnerWan30FirstLastValidatedFrame {
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
        inspected.width > MAX_DIMENSION || inspected.height > MAX_DIMENSION ||
        inspected.width * inspected.height > MAX_PIXELS) fail("INVALID_INPUT");
    const state: LocalFrameState = {
      bytes, filename: fields.filename, mimeType: inspected.mime, size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"), width: inspected.width, height: inspected.height
    };
    const receipt: OwnerWan30FirstLastValidatedFrame = Object.freeze({
      status: "LOCAL_SOURCE_VALIDATED", policy_id: POLICY_ID, model_id: MODEL_ID,
      filename: state.filename, mime_type: state.mimeType, size: state.size, sha256: state.sha256,
      width: state.width, height: state.height, role_binding: "NOT_ESTABLISHED",
      owner_upload_binding: "NOT_ESTABLISHED", generation_permit: false
    });
    RECEIPTS.set(receipt, state);
    return receipt;
  } catch (error) {
    bytes.fill(0);
    if (error instanceof OwnerWan30FirstLastNativeContextError) throw error;
    fail("INVALID_INPUT");
  }
}

/** Revokes and zeroes only this validator's private byte snapshot. */
export function releaseOwnerWan30FirstLastFrameInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = RECEIPTS.get(input as object);
  if (!state) return false;
  state.bytes.fill(0);
  return RECEIPTS.delete(input as object);
}

/**
 * Uploads one role-bound frame with the narrow owner profile. The upload
 * multipart profile is an implementation inference pending static/UI join;
 * the normal UI upload body was not available in the observation.
 */
export async function uploadOwnerWan30FirstLastFrame(
  clientInput: unknown,
  receiptInput: unknown,
  role: OwnerWan30FirstLastFrameRole,
  signal?: AbortSignal
): Promise<OwnerWan30FirstLastUploadedFrame> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_INPUT");
  const methods = nativeClientMethods();
  if (!isExactClient(clientInput, methods)) fail("INVALID_CLIENT");
  if (role !== "first_frame" && role !== "last_frame") fail("INVALID_INPUT");
  const receipt = readValidatedReceipt(receiptInput);
  if (!receipt) fail("INVALID_INPUT");
  const bytes = Buffer.from(receipt.bytes);
  try {
    const request = Object.freeze({ bytes, filename: receipt.filename, mime_type: receipt.mimeType,
      destination: "uploaded" as const, check_duplicates: true as const, model_type: MODEL_ID });
    let result: unknown;
    try { result = await Reflect.apply(methods.uploadFileReferences, clientInput, [request, signal]); }
    catch { fail("UPLOAD_OUTCOME_UNKNOWN"); }
    const reference = readSingleReference(result);
    if (signal?.aborted || !reference || !isSafeUploadReferenceUrl(reference.url)) fail("UPLOAD_OUTCOME_UNKNOWN");
    const metadata: OwnerWan30FirstLastUploadedFrame = Object.freeze({ status: "uploaded", model_id: MODEL_ID,
      role, mime_type: receipt.mimeType, size: receipt.size, sha256: receipt.sha256,
      width: receipt.width, height: receipt.height,
      upload_profile_confidence: "OWNER_IMPLEMENTATION_INFERENCE_NOT_UI_MULTIPART_OBSERVED",
      owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD" });
    UPLOADS.set(metadata, { client: clientInput, metadata, role, url: reference.url, released: false });
    return metadata;
  } finally {
    bytes.fill(0);
    releaseOwnerWan30FirstLastFrameInput(receiptInput);
  }
}

/** Creates a nominal, URL-free context after owner preflight/chat creation. */
export function createOwnerWan30FirstLastGenerationContext(
  clientInput: unknown,
  input: OwnerWan30FirstLastNativeRequest
): OwnerWan30FirstLastGenerationContext {
  const fields = exactRecord(input, ["attempt_id", "principal", "chat_id", "intent", "first_frame", "last_frame"]);
  if (typeof fields.attempt_id !== "string" || !ATTEMPT.test(fields.attempt_id) ||
      typeof fields.chat_id !== "string" || !SAFE_ID.test(fields.chat_id)) fail("INVALID_CONTEXT");
  const principal = snapshotPrincipal(fields.principal);
  const intentFields = exactRecord(fields.intent, ["model_id", "prompt", "parameters"]);
  if (intentFields.model_id !== MODEL_ID) fail("INVALID_CONTEXT");
  const normalized = normalizeOwnerWan30FirstLastGenerationIntent({
    prompt: intentFields.prompt,
    parameters: intentFields.parameters
  });
  const first = readUpload(clientInput, fields.first_frame, "first_frame");
  const last = readUpload(clientInput, fields.last_frame, "last_frame");
  if (first === last) fail("INVALID_CONTEXT");
  const candidate = projectOwnerWan30FirstLastGenerationWireCandidate(normalized.intent);
  if (candidate.dispatch_allowed !== false || candidate.chat_id_bound !== false ||
      candidate.profile_id !== "owner-wan30-first-last-web-request-observed-1823") fail("INVALID_CONTEXT");
  const context: OwnerWan30FirstLastGenerationContext = Object.freeze({ status: "ready", model_id: MODEL_ID,
    profile_id: candidate.profile_id, reference_roles: Object.freeze(["first_frame", "last_frame"] as const),
    dispatch_state: "READY", backend_acceptance: "UNPROVEN" });
  GENERATIONS.set(context, { client: first.client, attemptId: fields.attempt_id, principal, chatId: fields.chat_id,
    prompt: candidate.prompt_candidate, settings: candidate.settings_candidate,
    first: fields.first_frame as OwnerWan30FirstLastUploadedFrame,
    last: fields.last_frame as OwnerWan30FirstLastUploadedFrame, dispatchState: "READY" });
  return context;
}

/** Reserves before the only possible POST and returns URLs only to the native client hook. */
export function consumeOwnerWan30FirstLastGenerationContext(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ chat_id: string; prompt: string; settings: Readonly<Record<string, unknown>> }> {
  const state = readGeneration(clientInput, contextInput);
  if (!state || state.dispatchState !== "READY") fail("INVALID_CONTEXT");
  const first = readUpload(clientInput, state.first, "first_frame");
  const last = readUpload(clientInput, state.last, "last_frame");
  const { model_type, ...remainingSettings } = state.settings;
  state.dispatchState = "RESERVED";
  return Object.freeze({ chat_id: state.chatId, prompt: state.prompt, settings: Object.freeze({ model_type,
    file_urls: Object.freeze([{ type: "first_frame", url: first.url }, { type: "last_frame", url: last.url }]),
    ...remainingSettings }) });
}

/** Clears nominal generation and upload URL state after the app lifecycle closes. */
export function releaseOwnerWan30FirstLastGenerationContext(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = GENERATIONS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.dispatchState === "RELEASED") return false;
  state.dispatchState = "RELEASED";
  GENERATIONS.delete(contextInput as object);
  releaseOwnerWan30FirstLastUploadedFrame(clientInput, state.first);
  releaseOwnerWan30FirstLastUploadedFrame(clientInput, state.last);
  return true;
}

export function releaseOwnerWan30FirstLastUploadedFrame(clientInput: unknown, contextInput: unknown): boolean {
  if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return false;
  const state = UPLOADS.get(contextInput as object);
  if (!state || state.client !== clientInput || state.released) return false;
  state.url = null;
  state.released = true;
  return UPLOADS.delete(contextInput as object);
}

export function inspectOwnerWan30FirstLastGenerationContext(clientInput: unknown, contextInput: unknown):
  Readonly<{ attempt_id: string; principal: Readonly<GenerationPrincipalRef>; chat_id: string; prompt: string;
    dispatch_state: "READY" | "RESERVED" }> | null {
  const state = readGeneration(clientInput, contextInput);
  if (!state) return null;
  const dispatchState = state.dispatchState;
  if (dispatchState === "RELEASED") return null;
  return Object.freeze({ attempt_id: state.attemptId, principal: state.principal, chat_id: state.chatId,
    prompt: state.prompt, dispatch_state: dispatchState });
}

function readGeneration(client: unknown, context: unknown): GenerationState | null {
  if (!context || typeof context !== "object" || types.isProxy(context)) return null;
  const state = GENERATIONS.get(context as object);
  if (!state || state.client !== client || state.dispatchState === "RELEASED") return null;
  try {
    if (!readUpload(client, state.first, "first_frame") || !readUpload(client, state.last, "last_frame")) return null;
    return state;
  } catch { return null; }
}

function readUpload(client: unknown, context: unknown, role: OwnerWan30FirstLastFrameRole): UploadState {
  if (!context || typeof context !== "object" || types.isProxy(context)) fail("INVALID_CONTEXT");
  const state = UPLOADS.get(context as object);
  if (!state || state.metadata !== context || state.client !== client || state.role !== role || state.released ||
      state.metadata.model_id !== MODEL_ID || state.metadata.role !== role || state.metadata.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD" ||
      !state.url || !isSafeUploadReferenceUrl(state.url)) fail("INVALID_CONTEXT");
  return state;
}

function readValidatedReceipt(input: unknown): LocalFrameState | null {
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
  }
  catch { return false; }
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
      typeof descriptors.url.value !== "string" ||
      !isSafeUploadReferenceUrl(descriptors.url.value)) return null;
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
  return new Uint8Array(value);
}
function validFilename(value: string, mimeType: unknown): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u.test(value)) return false;
  const lower = value.toLowerCase();
  return mimeType === "image/png" ? lower.endsWith(".png") :
    mimeType === "image/jpeg" ? lower.endsWith(".jpg") || lower.endsWith(".jpeg") : false;
}
function fail(code: ConstructorParameters<typeof OwnerWan30FirstLastNativeContextError>[0]): never {
  throw new OwnerWan30FirstLastNativeContextError(code);
}
