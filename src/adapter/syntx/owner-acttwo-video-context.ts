import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl } from "./upload-reference-bridge.js";
import type { OwnerActTwoUploadDestination } from "./owner-acttwo-image-context.js";

export interface OwnerActTwoPerformanceVideoUploadContext {
  readonly status: "uploaded";
  readonly model_id: "acttwo";
  readonly destination: OwnerActTwoUploadDestination;
  readonly media_type: "video";
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly measured_duration_seconds: 5;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS";
  readonly provider_acceptance: "UNPROVEN";
  readonly generation_permit: false;
}
export type OwnerActTwoPerformanceVideoReference = Readonly<{ type: "video"; url: string }>;

const METHOD = "uploadOwnerActTwoPerformanceVideo";
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerActTwoPerformanceVideoUploadContext; url: string; nativeMethod: Function }>>();

export function createOwnerActTwoPerformanceVideoUploadContext(clientInput: unknown, referenceInput: unknown,
  metadataInput: unknown): OwnerActTwoPerformanceVideoUploadContext {
  if (!isClient(clientInput)) throw new Error("OWNER_ACTTWO_VIDEO_CONTEXT_INVALID");
  const url = safeReference(referenceInput), metadata = readMetadata(metadataInput);
  if (!url || !metadata) throw new Error("OWNER_ACTTWO_VIDEO_CONTEXT_INVALID");
  const nativeMethod = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
  if (typeof nativeMethod !== "function") throw new Error("OWNER_ACTTWO_VIDEO_CONTEXT_INVALID");
  const context = Object.freeze({ status: "uploaded" as const, model_id: "acttwo" as const, destination: metadata.destination,
    media_type: "video" as const, mime_type: "video/mp4" as const, size: metadata.size, sha256: metadata.sha256,
    width: metadata.width, height: metadata.height, measured_duration_seconds: 5 as const,
    probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS" as const, provider_acceptance: "UNPROVEN" as const,
    generation_permit: false as const });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url, nativeMethod }));
  return context;
}

export function readOwnerActTwoPerformanceVideoReference(clientInput: unknown, contextInput: unknown): OwnerActTwoPerformanceVideoReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const witness = UPLOADS.get(contextInput);
    if (!witness || witness.client !== clientInput || witness.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, witness.nativeMethod) || !isSafeUploadReferenceUrl(witness.url)) return null;
    const context = contextInput as OwnerActTwoPerformanceVideoUploadContext;
    if (context.status !== "uploaded" || context.model_id !== "acttwo" || context.destination !== witness.context.destination ||
        context.media_type !== "video" || context.mime_type !== "video/mp4" || context.size !== witness.context.size ||
        context.sha256 !== witness.context.sha256 || context.width !== witness.context.width || context.height !== witness.context.height ||
        context.measured_duration_seconds !== 5 || context.probe_confidence !== "FFPROBE_METADATA_NOT_DECODED_PIXELS" ||
        context.provider_acceptance !== "UNPROVEN" || context.generation_permit !== false) return null;
    return Object.freeze({ type: "video", url: witness.url });
  } catch { return null; }
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const method = Reflect.get(SyntxChatHttpClient.prototype, METHOD);
    return typeof method === "function" && (expected === undefined || expected === method) && Reflect.get(value, METHOD) === method;
  } catch { return false; }
}
function safeReference(value: unknown): string | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string" || !["url", "file_id"].includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
        descriptors[key]!.enumerable !== true)) return null;
    const url = descriptors.url?.value;
    return typeof url === "string" && isSafeUploadReferenceUrl(url) ? url : null;
  } catch { return null; }
}
function readMetadata(value: unknown): Readonly<Omit<OwnerActTwoPerformanceVideoUploadContext,
  "status" | "media_type" | "mime_type" | "measured_duration_seconds" | "probe_confidence" | "provider_acceptance" | "generation_permit">> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    const expected = ["model_id", "destination", "mime_type", "size", "sha256", "width", "height", "measured_duration_seconds"];
    if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || keys.length !== expected.length ||
        keys.some(key => typeof key !== "string" || !expected.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) return null;
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of expected) fields[key] = descriptors[key]!.value;
    if (fields.model_id !== "acttwo" || (fields.destination !== "uploaded" && fields.destination !== "hidden") ||
        fields.mime_type !== "video/mp4" || !Number.isSafeInteger(fields.size) || (fields.size as number) < 16 ||
        (fields.size as number) > 20 * 1024 * 1024 || typeof fields.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(fields.sha256) ||
        !Number.isSafeInteger(fields.width) || !Number.isSafeInteger(fields.height) || (fields.width as number) < 300 ||
        (fields.height as number) < 300 || (fields.width as number) > 8_400 || (fields.height as number) > 8_400 ||
        (fields.width as number) * (fields.height as number) > 52_500_000 || fields.measured_duration_seconds !== 5) return null;
    return Object.freeze({ model_id: "acttwo", destination: fields.destination as OwnerActTwoUploadDestination, mime_type: "video/mp4",
      size: fields.size as number, sha256: fields.sha256, width: fields.width as number, height: fields.height as number,
      measured_duration_seconds: 5 });
  } catch { return null; }
}
