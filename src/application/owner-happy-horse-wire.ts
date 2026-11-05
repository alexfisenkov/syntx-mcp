import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { getOwnerHappyHorseSourceProfile, normalizeOwnerHappyHorseParameters,
  type OwnerHappyHorseModelId, type OwnerHappyHorseNormalizedParameters } from "./owner-happy-horse-parameters.js";
import type { OwnerHappyHorseEditVideoMimeType } from "./owner-happy-horse-edit-video-policy.js";
import { deriveOwnerHappyHorseEditDuration, type OwnerHappyHorseAspectRatio, type OwnerHappyHorseResolution } from "./owner-happy-horse-current-controls.js";

const SHA256 = /^[a-f0-9]{64}$/u;
export interface OwnerHappyHorseCapturedImage { readonly url: string; readonly sha256: string; readonly width: number; readonly height: number }
export interface OwnerHappyHorseCapturedVideo extends OwnerHappyHorseCapturedImage { readonly mime_type: OwnerHappyHorseEditVideoMimeType; readonly measured_duration_seconds: number; readonly images?: readonly OwnerHappyHorseCapturedImage[] }
export interface OwnerHappyHorseWireInput {
  readonly ai_name: "happy_horse";
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerHappyHorseModelId;
    readonly aspect_ratio: OwnerHappyHorseAspectRatio;
    readonly resolution: OwnerHappyHorseResolution;
    readonly video_duration: number;
    readonly seed: number | null;
    readonly native_audio?: boolean;
    readonly file_urls: readonly Readonly<{ readonly type: "first_frame" | "image" | "video"; readonly url: string }>[];
  }>;
}
export interface OwnerHappyHorseWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: OwnerHappyHorseModelId;
  readonly source_profile_sha256: string;
  readonly wire: Readonly<OwnerHappyHorseWireInput>;
  readonly source_media: Readonly<{ type: "image" | "video"; sha256: string; width: number; height: number;
    duration_seconds: number | null; confidence: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS"; readonly images?: readonly OwnerHappyHorseCapturedImage[] }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export class OwnerHappyHorseWireError extends Error {
  constructor(readonly code: "INVALID_WIRE") { super("HappyHorse wire candidate is invalid."); this.name = "OwnerHappyHorseWireError"; }
}

/** Candidate serialization from the proven first_frame mapping and generic image path only. */
export function buildOwnerHappyHorseWire(input: unknown, capturedInput: unknown): Readonly<OwnerHappyHorseWireCandidate> {
  let normalized: Readonly<OwnerHappyHorseNormalizedParameters>;
  try { normalized = normalizeOwnerHappyHorseParameters(input); } catch { return invalid(); }
  if (normalized.intent.model_id === "happy_horse_edit") return invalid();
  const images = capturedImages(capturedInput), profile = getOwnerHappyHorseSourceProfile();
  if (images.length < 1 || images.length > (normalized.intent.model_id === "happy_horse_first_frame" ? 1 : 9)) invalid();
  const image = images[0]!;
  const type = normalized.intent.model_id === "happy_horse_first_frame" ? "first_frame" as const : "image" as const;
  const file_urls = Object.freeze(images.map((item) => Object.freeze({ type, url: item.url })));
  const settings = Object.freeze({ ...normalized.source_parameters, file_urls });
  const wire = Object.freeze({ ai_name: "happy_horse" as const, prompt: normalized.intent.prompt, settings });
  const intent = Object.freeze({ ...normalized.intent, source_profile_sha256: profile.source_sha256,
    ...(images.length === 1 ? { source_image_sha256: image.sha256, source_image_width: image.width, source_image_height: image.height }
      : { source_images: images.map((item) => ({ sha256: item.sha256, width: item.width, height: item.height })) }) });
  return Object.freeze({ status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    model_id: normalized.intent.model_id, source_profile_sha256: profile.source_sha256, wire,
    source_media: Object.freeze({ type: "image" as const, sha256: image.sha256, width: image.width, height: image.height,
      duration_seconds: null, confidence: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS" as const, ...(images.length === 1 ? {} : { images }) }),
    intent_fingerprint: schemaHash(intent), wire_fingerprint: schemaHash(wire), dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const });
}

/** Edit wire candidate accepts exactly one trusted measured video and no image attachments. */
export function buildOwnerHappyHorseEditWire(input: unknown, capturedInput: unknown): Readonly<OwnerHappyHorseWireCandidate> {
  const video = exactCapturedVideo(capturedInput), profile = getOwnerHappyHorseSourceProfile();
  let derivedDuration: number; try { derivedDuration = deriveOwnerHappyHorseEditDuration(video.measured_duration_seconds); } catch { return invalid(); }
  if (!input || typeof input !== "object" || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
  const durationDescriptor = Object.getOwnPropertyDescriptor(input, "video_duration");
  if (durationDescriptor && (!("value" in durationDescriptor) || durationDescriptor.value !== undefined && durationDescriptor.value !== derivedDuration)) invalid();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(fields).some((key) => typeof key !== "string" || !("value" in fields[key]!) || !fields[key]!.enumerable)) invalid();
  const projected = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.value]));
  let normalized: Readonly<OwnerHappyHorseNormalizedParameters>;
  try { normalized = normalizeOwnerHappyHorseParameters({ ...projected, video_duration: derivedDuration }); } catch { return invalid(); }
  if (normalized.intent.model_id !== "happy_horse_edit") return invalid();
  if (!isSafeUploadReferenceUrl(video.url) || !SHA256.test(video.sha256) || !Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) ||
      video.width < 400 || video.height < 400 || video.width > 2_160 || video.height > 2_160 || video.width * video.height > 52_500_000 ||
      !Number.isFinite(video.measured_duration_seconds) || video.measured_duration_seconds < 3 || video.measured_duration_seconds > 60) invalid();
  const images = video.images ?? [];
  if (images.length > 5) invalid();
  const file_urls = Object.freeze([Object.freeze({ type: "video" as const, url: video.url }), ...images.map((image) => Object.freeze({ type: "image" as const, url: image.url }))]);
  const settings = Object.freeze({ ...normalized.source_parameters, file_urls });
  const wire = Object.freeze({ ai_name: "happy_horse" as const, prompt: normalized.intent.prompt, settings });
  const intent = Object.freeze({ ...normalized.intent, source_profile_sha256: profile.source_sha256, source_video_sha256: video.sha256,
    source_video_width: video.width, source_video_height: video.height, measured_source_duration_seconds: video.measured_duration_seconds,
    source_mime_type: video.mime_type, local_probe_duration_ceiling_seconds: video.measured_duration_seconds <= 30 ? 30 : 60,
    ...(images.length ? { source_images: images.map((image) => ({ sha256: image.sha256, width: image.width, height: image.height })) } : {}) });
  return Object.freeze({ status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const, model_id: normalized.intent.model_id,
    source_profile_sha256: profile.source_sha256, wire, source_media: Object.freeze({ type: "video" as const, sha256: video.sha256,
      width: video.width, height: video.height, duration_seconds: video.measured_duration_seconds,
      confidence: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS" as const, ...(images.length ? { images } : {}) }), intent_fingerprint: schemaHash(intent),
    wire_fingerprint: schemaHash(wire), dispatch_allowed: false as const, backend_acceptance: "UNPROVEN" as const });
}

function exactCapturedVideo(value: unknown): OwnerHappyHorseCapturedVideo {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const proto = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), expected = ["url", "sha256", "width", "height", "mime_type", "measured_duration_seconds"];
    if ((proto !== Object.prototype && proto !== null) || expected.some((key) => !Object.hasOwn(ds, key)) || keys.some(key => typeof key !== "string" || ![...expected, "images"].includes(key) ||
      !ds[key] || !Object.hasOwn(ds[key]!, "value") || ds[key]!.enumerable !== true)) invalid();
    const f = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) f[key] = ds[key]!.value;
    if (typeof f.url !== "string" || typeof f.sha256 !== "string" || typeof f.width !== "number" || typeof f.height !== "number" ||
        (f.mime_type !== "video/mp4" && f.mime_type !== "video/quicktime") || typeof f.measured_duration_seconds !== "number") invalid();
    return Object.freeze({ url: f.url, sha256: f.sha256, width: f.width, height: f.height, mime_type: f.mime_type, measured_duration_seconds: f.measured_duration_seconds,
      ...(f.images === undefined ? {} : { images: capturedImages(f.images) }) });
  } catch { return invalid(); }
}

function exactCaptured(value: unknown): OwnerHappyHorseCapturedImage {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try {
    const proto = Object.getPrototypeOf(value), ds = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(ds), expected = ["url", "sha256", "width", "height"];
    if ((proto !== Object.prototype && proto !== null) || keys.length !== expected.length || keys.some(key => typeof key !== "string" ||
      !expected.includes(key) || !ds[key] || !Object.hasOwn(ds[key]!, "value") || ds[key]!.enumerable !== true)) invalid();
    const f = Object.create(null) as Record<string, unknown>; for (const key of expected) f[key] = ds[key]!.value;
    if (typeof f.url !== "string" || typeof f.sha256 !== "string" || typeof f.width !== "number" || typeof f.height !== "number") invalid();
    return Object.freeze({ url: f.url, sha256: f.sha256, width: f.width, height: f.height });
  } catch { return invalid(); }
}
function invalid(): never { throw new OwnerHappyHorseWireError("INVALID_WIRE"); }
function capturedImages(value: unknown): readonly OwnerHappyHorseCapturedImage[] {
  let values: unknown[];
  if (Array.isArray(value)) {
    if (types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 9 || Reflect.ownKeys(descriptors).length !== length + 1) return invalid();
    values = [];
    for (let i = 0; i < length; i++) { const descriptor = descriptors[String(i)]; if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return invalid(); values.push(descriptor.value); }
  } else values = [value];
  const seen = new Set<string>(), result: OwnerHappyHorseCapturedImage[] = [];
  for (const item of values) {
    const image = exactCaptured(item);
    if (!isSafeUploadReferenceUrl(image.url) || !SHA256.test(image.sha256) || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
        image.width < 400 || image.height < 400 || image.width > 8000 || image.height > 8000 || image.width * image.height > 52500000) invalid();
    if (!seen.has(image.url)) { seen.add(image.url); result.push(image); }
  }
  return Object.freeze(result);
}
