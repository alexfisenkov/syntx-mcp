import { createHash } from "node:crypto";
import { types } from "node:util";
import type { ValidatedOwnerWan25I2vPreviewImage } from "../../application/owner-wan25-i2v-image-policy.js";
import { readValidatedOwnerWan25I2vPreviewImage } from "../../application/owner-wan25-i2v-image-policy.js";
import type { SyntxChatHttpClient, UploadFileRequest } from "./chat-http-client.js";
import type { InternalUploadReference } from "./upload-reference-bridge.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const UPLOADS = new WeakMap<object, UploadState>();

export interface OwnerWan25I2vImageUploadContext {
  readonly status: "uploaded";
  readonly model_id: typeof MODEL_ID;
  readonly media_type: "image";
  readonly mime_type: "image/jpeg" | "image/png" | "image/bmp" | "image/webp";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly dispatch_allowed: false;
  readonly generation_permit: false;
  readonly owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD";
}

export type OwnerWan25I2vUploadContextErrorCode =
  | "INVALID_REQUEST" | "UPLOAD_OUTCOME_UNKNOWN" | "NATIVE_CLIENT_INVALID";

export class OwnerWan25I2vUploadContextError extends Error {
  constructor(readonly code: OwnerWan25I2vUploadContextErrorCode) {
    super("The WAN 2.5 I2V preview image upload context could not be established safely.");
    this.name = "OwnerWan25I2vUploadContextError";
  }
}

interface UploadState {
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerWan25I2vImageUploadContext;
  readonly url: string;
  readonly nativeMethods: NativeClientMethods;
}
interface NativeClientMethods {
  readonly clientPrototype: object;
  readonly uploadFileReferences: Function;
  readonly createChat: Function;
  readonly startVideo: Function;
  readonly uploadWan25I2vImage?: Function;
}

/** Internal fixed WAN25 upload entry point for the future class method; callers provide no URL or route. */
export async function uploadOwnerWan25I2vImage(clientInput: unknown, receiptInput: ValidatedOwnerWan25I2vPreviewImage | unknown,
  signal?: AbortSignal): Promise<OwnerWan25I2vImageUploadContext> {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) fail("INVALID_REQUEST");
  const nativeMethods = await readNativeClientMethods();
  if (!isExactWan25UploadClient(clientInput, nativeMethods)) fail("NATIVE_CLIENT_INVALID");
  const owned = readValidatedOwnerWan25I2vPreviewImage(receiptInput);
  if (!owned || owned.model_id !== MODEL_ID || !validOwnedImage(owned)) fail("INVALID_REQUEST");
  const client = clientInput;
  const request: UploadFileRequest = { bytes: owned.bytes, filename: owned.filename, mime_type: owned.mime_type,
    destination: "uploaded", check_duplicates: true, model_type: MODEL_ID };
  let references: InternalUploadReference[];
  try {
    references = await Reflect.apply(nativeMethods.uploadFileReferences, client, [request, signal]) as InternalUploadReference[];
  } catch { owned.bytes.fill(0); fail("UPLOAD_OUTCOME_UNKNOWN"); }
  finally { owned.bytes.fill(0); }
  const reference = readOneReference(references);
  if (signal?.aborted || !reference || !isSafeUploadReferenceUrl(reference.url)) fail("UPLOAD_OUTCOME_UNKNOWN");
  const context: OwnerWan25I2vImageUploadContext = Object.freeze({ status: "uploaded", model_id: MODEL_ID,
    media_type: "image", mime_type: owned.mime_type, size: owned.size, sha256: owned.sha256,
    width: owned.width, height: owned.height, dispatch_allowed: false, generation_permit: false,
    owner_upload_binding: "SAME_CLIENT_NATIVE_UPLOAD" });
  UPLOADS.set(context, Object.freeze({ client, context, url: reference.url, nativeMethods }));
  return context;
}

/** Exposes a URL only to the exact SyntxChatHttpClient that performed this genuine WAN25 upload. */
export function readOwnerWan25I2vUploadReferenceForClient(clientInput: unknown, contextInput: unknown): Readonly<{ url: string }> | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const state = UPLOADS.get(contextInput as object);
    if (!state || state.client !== clientInput || state.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isExactWan25UploadClient(clientInput, state.nativeMethods) ||
        state.context.status !== "uploaded" || state.context.model_id !== MODEL_ID || state.context.media_type !== "image" ||
        state.context.dispatch_allowed !== false || state.context.generation_permit !== false ||
        state.context.owner_upload_binding !== "SAME_CLIENT_NATIVE_UPLOAD" || !isSafeUploadReferenceUrl(state.url)) return null;
    return Object.freeze({ url: state.url });
  } catch { return null; }
}

export function isOwnerWan25I2vImageUploadContext(input: unknown): input is OwnerWan25I2vImageUploadContext {
  if (!input || typeof input !== "object" || types.isProxy(input)) return false;
  const state = UPLOADS.get(input as object);
  return !!state && state.context === input && state.context.model_id === MODEL_ID &&
    readOwnerWan25I2vUploadReferenceForClient(state.client, input) !== null;
}

function validOwnedImage(owned: ReturnType<typeof readValidatedOwnerWan25I2vPreviewImage> extends infer T ? Exclude<T, null> : never): boolean {
  return owned.size > 0 && owned.size === owned.bytes.byteLength && /^[a-f0-9]{64}$/u.test(owned.sha256) &&
    createHash("sha256").update(owned.bytes).digest("hex") === owned.sha256 &&
    ["image/jpeg", "image/png", "image/bmp", "image/webp"].includes(owned.mime_type) &&
    Number.isSafeInteger(owned.width) && owned.width >= 384 && owned.width <= 5_000 &&
    Number.isSafeInteger(owned.height) && owned.height >= 384 && owned.height <= 5_000;
}

function readOneReference(value: unknown): InternalUploadReference | null {
  try {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length !== 1) return null;
    const arrayDescriptors = Object.getOwnPropertyDescriptors(value), arrayKeys = Reflect.ownKeys(arrayDescriptors);
    if (arrayKeys.length !== 2 || !arrayKeys.includes("0") || !arrayKeys.includes("length") ||
        !("value" in arrayDescriptors["0"]!) || arrayDescriptors["0"]!.enumerable !== true ||
        Object.getOwnPropertyDescriptor(value, "length")?.value !== 1) return null;
    const reference = arrayDescriptors["0"]!.value;
    if (!reference || typeof reference !== "object" || Array.isArray(reference) || types.isProxy(reference) ||
        Object.getPrototypeOf(reference) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(reference), keys = Reflect.ownKeys(descriptors);
    const urlDescriptor = descriptors.url;
    if (!urlDescriptor || !keys.includes("url") || typeof urlDescriptor.value !== "string" || keys.some((key) => typeof key !== "string" ||
        !["url", "file_id"].includes(key) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) return null;
    if (descriptors.file_id && (typeof descriptors.file_id.value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(descriptors.file_id.value))) return null;
    return Object.freeze({ ...(descriptors.file_id ? { file_id: descriptors.file_id.value as string } : {}), url: urlDescriptor.value });
  } catch { return null; }
}

async function readNativeClientMethods(): Promise<NativeClientMethods> {
  const clientModule = await import("./chat-http-client.js");
  const prototype = clientModule.SyntxChatHttpClient.prototype;
  const uploadFileReferences = getDataMethod(prototype, "uploadFileReferences");
  const createChat = getDataMethod(prototype, "createChat");
  const startVideo = getDataMethod(prototype, "startVideo");
  const uploadWan25I2vImage = getDataMethod(prototype, "uploadWan25I2vImage");
  if (typeof uploadFileReferences !== "function" || typeof createChat !== "function" || typeof startVideo !== "function") fail("NATIVE_CLIENT_INVALID");
  return Object.freeze({ clientPrototype: prototype, uploadFileReferences, createChat, startVideo,
    ...(typeof uploadWan25I2vImage === "function" ? { uploadWan25I2vImage } : {}) });
}

function isExactWan25UploadClient(value: unknown, methods: NativeClientMethods): value is SyntxChatHttpClient {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) && Object.getPrototypeOf(value) === methods.clientPrototype &&
      !Object.hasOwn(value, "uploadFileReferences") && !Object.hasOwn(value, "createChat") && !Object.hasOwn(value, "startVideo") &&
      !Object.hasOwn(value, "uploadWan25I2vImage") &&
      getDataMethod(value, "uploadFileReferences") === methods.uploadFileReferences && Reflect.get(value, "uploadFileReferences") === methods.uploadFileReferences &&
      getDataMethod(value, "createChat") === methods.createChat && Reflect.get(value, "createChat") === methods.createChat &&
      getDataMethod(value, "startVideo") === methods.startVideo && Reflect.get(value, "startVideo") === methods.startVideo &&
      (methods.uploadWan25I2vImage === undefined ||
        (getDataMethod(value, "uploadWan25I2vImage") === methods.uploadWan25I2vImage && Reflect.get(value, "uploadWan25I2vImage") === methods.uploadWan25I2vImage));
  } catch { return false; }
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function fail(code: OwnerWan25I2vUploadContextErrorCode): never { throw new OwnerWan25I2vUploadContextError(code); }
