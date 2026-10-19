import { types } from "node:util";
import { SyntxChatHttpClient } from "./chat-http-client.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "./upload-reference-bridge.js";
import type { OwnerHappyHorseEditVideoMimeType, ValidatedOwnerHappyHorseEditVideo } from "../../application/owner-happy-horse-edit-video-policy.js";
import type { OwnerHappyHorseUploadDestination } from "./owner-happy-horse-image-context.js";

const METHOD = "uploadOwnerHappyHorseEditVideo";
const UPLOADS = new WeakMap<object, Readonly<{ client: SyntxChatHttpClient; context: OwnerHappyHorseEditVideoUploadContext; url: string; nativeMethod: Function }>>();
export interface OwnerHappyHorseEditVideoUploadContext {
  readonly status: "uploaded"; readonly model_id: "happy_horse_edit"; readonly destination: OwnerHappyHorseUploadDestination;
  readonly media_type: "video"; readonly mime_type: OwnerHappyHorseEditVideoMimeType; readonly size: number; readonly sha256: string;
  readonly width: number; readonly height: number; readonly measured_duration_seconds: number;
  readonly probe_confidence: "FFPROBE_METADATA_NOT_DECODED_PIXELS"; readonly local_limit_confidence: "CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT";
  readonly provider_acceptance: "UNPROVEN"; readonly generation_permit: false;
}
export type OwnerHappyHorseVideoUploadReference = Readonly<{ type: "video"; url: string }>;

/** Root-owned client method calls this after its normal file upload response has been parsed. */
export function createOwnerHappyHorseEditVideoUploadContext(clientInput: unknown, referenceInput: InternalUploadReference,
  validatedInput: unknown, destination: OwnerHappyHorseUploadDestination): OwnerHappyHorseEditVideoUploadContext {
  if (!isClient(clientInput)) throw new Error("OWNER_HAPPY_HORSE_VIDEO_CONTEXT_INVALID");
  const ref = readReference(referenceInput), fields = readValidated(validatedInput);
  if (!ref || !fields || (destination !== "uploaded" && destination !== "hidden")) throw new Error("OWNER_HAPPY_HORSE_VIDEO_CONTEXT_INVALID");
  const method = Reflect.get(SyntxChatHttpClient.prototype, METHOD); if (typeof method !== "function") throw new Error("OWNER_HAPPY_HORSE_VIDEO_CONTEXT_INVALID");
  const context = Object.freeze({ status: "uploaded" as const, model_id: "happy_horse_edit" as const, destination, media_type: "video" as const,
    mime_type: fields.mime_type, size: fields.size, sha256: fields.sha256, width: fields.width, height: fields.height,
    measured_duration_seconds: fields.measured_duration_seconds, probe_confidence: fields.probe_confidence,
    local_limit_confidence: fields.local_limit_confidence, provider_acceptance: "UNPROVEN" as const, generation_permit: false as const });
  UPLOADS.set(context, Object.freeze({ client: clientInput as SyntxChatHttpClient, context, url: ref.url, nativeMethod: method }));
  return context;
}

export function readOwnerHappyHorseEditVideoReference(clientInput: unknown, contextInput: unknown): OwnerHappyHorseVideoUploadReference | null {
  try {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const w = UPLOADS.get(contextInput); if (!w || w.client !== clientInput || w.context !== contextInput || !Object.isFrozen(contextInput) ||
        !isClient(clientInput, w.nativeMethod) || !isSafeUploadReferenceUrl(w.url)) return null;
    const c = contextInput as OwnerHappyHorseEditVideoUploadContext;
    if (c.status !== "uploaded" || c.model_id !== "happy_horse_edit" || c.destination !== w.context.destination || c.media_type !== "video" ||
        c.mime_type !== w.context.mime_type || c.size !== w.context.size || c.sha256 !== w.context.sha256 || c.width !== w.context.width ||
        c.height !== w.context.height || c.measured_duration_seconds !== w.context.measured_duration_seconds || c.probe_confidence !== w.context.probe_confidence ||
        c.local_limit_confidence !== w.context.local_limit_confidence || c.provider_acceptance !== "UNPROVEN" || c.generation_permit !== false) return null;
    return Object.freeze({ type: "video", url: w.url });
  } catch { return null; }
}

function isClient(value: unknown, expected?: Function): value is SyntxChatHttpClient {
  try { if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== SyntxChatHttpClient.prototype || Object.hasOwn(value, METHOD)) return false;
    const m = Reflect.get(SyntxChatHttpClient.prototype, METHOD); return typeof m === "function" && (expected === undefined || expected === m) && Reflect.get(value, METHOD) === m;
  } catch { return false; }
}
function readReference(value: unknown): Readonly<{ url: string }> | null {
  try { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
    const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
    if (keys.some(k => typeof k !== "string" || !["url", "file_id"].includes(k) || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) return null;
    const url = d.url?.value; return typeof url === "string" && isSafeUploadReferenceUrl(url) ? Object.freeze({ url }) : null;
  } catch { return null; }
}
function readValidated(value: unknown): Pick<ValidatedOwnerHappyHorseEditVideo, "mime_type" | "size" | "sha256" | "width" | "height" | "measured_duration_seconds" | "probe_confidence" | "local_limit_confidence"> | null {
  try { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) return null;
    const v = value as ValidatedOwnerHappyHorseEditVideo;
    if (v.status !== "LOCALLY_PROBED_SOURCE_VIDEO_NOT_UPLOAD_AUTHORITY" || v.model_id !== "happy_horse_edit" ||
        (v.mime_type !== "video/mp4" && v.mime_type !== "video/quicktime") || !Number.isSafeInteger(v.size) || v.size < 16 || v.size > 100 * 1024 * 1024 ||
        typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(v.sha256) || !Number.isSafeInteger(v.width) || !Number.isSafeInteger(v.height) ||
        v.width < 400 || v.width > 2_160 || v.height < 400 || v.height > 2_160 || v.width * v.height > 52_500_000 ||
        !Number.isFinite(v.measured_duration_seconds) || v.measured_duration_seconds < 3 || v.measured_duration_seconds > 30 ||
        v.probe_confidence !== "FFPROBE_METADATA_NOT_DECODED_PIXELS" || v.local_limit_confidence !== "CONSERVATIVE_LOCAL_PROBE_CEILING_NOT_PROVIDER_LIMIT" || v.generation_permit !== false) return null;
    return Object.freeze({ mime_type: v.mime_type, size: v.size, sha256: v.sha256, width: v.width, height: v.height,
      measured_duration_seconds: v.measured_duration_seconds, probe_confidence: v.probe_confidence, local_limit_confidence: v.local_limit_confidence });
  } catch { return null; }
}
