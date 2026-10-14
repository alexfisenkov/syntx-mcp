import { types } from "node:util";
import {
  SyntxChatHttpClient,
  type SyntxUploadDestination
} from "./chat-http-client.js";
import {
  OwnerKlingI2VImageInputError,
  readValidatedOwnerKlingI2VImageInput,
  validateOwnerKlingI2VImageInput,
  type OwnerKlingI2VCanonicalMimeType
} from "../../application/owner-kling-i2v-input-policy.js";

const CONTEXTS = new WeakMap<object, Readonly<ContextState>>();
let capturedNativeUpload: typeof SyntxChatHttpClient.prototype.uploadKlingI2VImageReference | undefined;

/** Safe metadata only. The native upload URL and provider file ID remain private. */
export interface OwnerKlingI2VUploadContext {
  readonly status: "uploaded";
  readonly model_id: "kling_image2video";
  readonly destination: SyntxUploadDestination;
  readonly source_mime_type: OwnerKlingI2VCanonicalMimeType;
  readonly source_size: number;
  readonly source_sha256: string;
  readonly width: number;
  readonly height: number;
  readonly input_acceptance: "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED";
}

export class OwnerKlingI2VUploadContextError extends Error {
  constructor(readonly code: "INVALID_IMAGE_INPUT" | "INVALID_UPLOAD_CLIENT" | "INVALID_DESTINATION" | "UPLOAD_RECEIPT_UNAVAILABLE") {
    super("The owner Kling I2V upload context could not be established safely.");
    this.name = "OwnerKlingI2VUploadContextError";
  }
}

/**
 * Performs exactly one native single-image upload and seals its sole parsed
 * reference to this client. Destination is explicit because the source does
 * not identify whether Kling uses uploaded or hidden files.
 */
export async function uploadOwnerKlingI2VImage(
  clientInput: unknown,
  imageInput: unknown,
  destination: SyntxUploadDestination,
  signal?: AbortSignal
): Promise<OwnerKlingI2VUploadContext> {
  if (!isNativeClient(clientInput)) {
    throw new OwnerKlingI2VUploadContextError("INVALID_UPLOAD_CLIENT");
  }
  if (destination !== "uploaded" && destination !== "hidden") {
    throw new OwnerKlingI2VUploadContextError("INVALID_DESTINATION");
  }
  let validated;
  try {
    validated = validateOwnerKlingI2VImageInput(imageInput);
  } catch (error) {
    if (error instanceof OwnerKlingI2VImageInputError) {
      throw new OwnerKlingI2VUploadContextError("INVALID_IMAGE_INPUT");
    }
    throw error;
  }
  const owned = readValidatedOwnerKlingI2VImageInput(validated);
  if (!owned) throw new OwnerKlingI2VUploadContextError("INVALID_IMAGE_INPUT");
  const uploadBytes = owned.bytes;
  try {
    const reference = await Reflect.apply(nativeUploadMethod(), clientInput, [{
      bytes: uploadBytes, filename: owned.filename, mime_type: owned.mime_type
    }, destination, signal]);
    if (!isSafeUploadReference(reference)) {
      throw new OwnerKlingI2VUploadContextError("UPLOAD_RECEIPT_UNAVAILABLE");
    }
    const context: OwnerKlingI2VUploadContext = Object.freeze({
      status: "uploaded",
      model_id: "kling_image2video",
      destination,
      source_mime_type: owned.mime_type,
      source_size: owned.size,
      source_sha256: owned.sha256,
      width: owned.width,
      height: owned.height,
      input_acceptance: "SOURCE_FORMAT_DECLARED_PROVIDER_ACCEPTANCE_UNVERIFIED"
    });
    CONTEXTS.set(context, Object.freeze({ client: clientInput, reference, url: reference.url }));
    return context;
  } finally {
    uploadBytes.fill(0);
  }
}

/** Private composition boundary. A forged receipt or a context from another client cannot reveal a URL. */
export function readOwnerKlingI2VUploadReferenceForClient(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ readonly url: string }> | null {
  if (!isNativeClient(clientInput) || !contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
  const state = CONTEXTS.get(contextInput);
  if (!state || state.client !== clientInput) return null;
  const context = contextInput as OwnerKlingI2VUploadContext;
  if (context.status !== "uploaded" || context.model_id !== "kling_image2video" ||
      context.destination !== "uploaded" && context.destination !== "hidden" ||
      !Number.isSafeInteger(context.source_size) || context.source_size < 1 ||
      !/^[a-f0-9]{64}$/u.test(context.source_sha256) || !isSafeUploadReference(state.reference) ||
      context.source_mime_type !== "image/jpeg" && context.source_mime_type !== "image/png" &&
      context.source_mime_type !== "image/avif" && context.source_mime_type !== "image/webp") return null;
  return Object.freeze({ url: state.url });
}

function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    SyntxChatHttpClient.prototype.uploadKlingI2VImageReference === nativeUploadMethod();
}

function nativeUploadMethod(): typeof SyntxChatHttpClient.prototype.uploadKlingI2VImageReference {
  capturedNativeUpload ??= SyntxChatHttpClient.prototype.uploadKlingI2VImageReference;
  return capturedNativeUpload;
}

function isSafeUploadReference(value: unknown): value is Readonly<{ readonly url: string }> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length < 1 || keys.length > 2 || keys.some((key) => key !== "url" && key !== "file_id") ||
      !("url" in descriptors) || !("value" in descriptors.url!)) return false;
  return typeof descriptors.url!.value === "string" && isSafeUploadReferenceUrl(descriptors.url!.value);
}

function isSafeUploadReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "r2.syntx.ai" && url.port === "" &&
      url.username === "" && url.password === "" && url.hash === "" && url.pathname !== "/";
  } catch {
    return false;
  }
}

interface ContextState {
  readonly client: SyntxChatHttpClient;
  readonly reference: Readonly<{ readonly url: string }>;
  readonly url: string;
}
