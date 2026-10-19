import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { getOwnerActTwoSourceProfile, normalizeOwnerActTwoParameters, type OwnerActTwoNormalizedParameters } from "./owner-acttwo-parameters.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const MAX_DIMENSION = 8_400;
const MAX_PIXELS = 52_500_000;
const PROMPT_EVIDENCE = "EMPTY_STRING_CANDIDATE_UNTIL_LIVE_ACCEPTANCE" as const;

export interface OwnerActTwoCapturedCharacterImage {
  readonly url: string; readonly sha256: string; readonly size: number; readonly width: number; readonly height: number;
  readonly mime_type: "image/jpeg" | "image/png";
}
export interface OwnerActTwoCapturedPerformanceVideo {
  readonly url: string; readonly sha256: string; readonly size: number; readonly width: number; readonly height: number;
  readonly mime_type: "video/mp4"; readonly measured_duration_seconds: 5;
}
export interface OwnerActTwoWireInput {
  readonly ai_name: "runway";
  readonly prompt: "";
  readonly settings: Readonly<{
    readonly model_type: "acttwo";
    readonly aspect_ratio: "11";
    readonly video_duration: 5;
    readonly seed: null;
    readonly expression: 3;
    readonly file_urls: readonly [Readonly<{ readonly type: "video"; readonly url: string }>, Readonly<{ readonly type: "image"; readonly url: string }>];
  }>;
}
export interface OwnerActTwoWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: "acttwo";
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerActTwoWireInput>;
  readonly source_media: Readonly<{
    readonly character_image: Readonly<{ sha256: string; size: number; width: number; height: number; mime_type: "image/jpeg" | "image/png" }>;
    readonly performance_video: Readonly<{ sha256: string; size: number; width: number; height: number; mime_type: "video/mp4"; duration_seconds: 5 }>;
    readonly metadata_confidence: "CAPTURED_LOCAL_VALIDATION_AND_FFPROBE_NOT_DECODED_PIXELS";
  }>;
  readonly role_binding: "VIDEO_FROM_G_FILES_THEN_IMAGE_FROM_SETTINGS_FILE_URLS";
  readonly prompt_evidence: typeof PROMPT_EVIDENCE;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerActTwoWireError extends Error {
  constructor(readonly code: "INVALID_WIRE") {
    super("The owner Runway ActTwo wire candidate is invalid.");
    this.name = "OwnerActTwoWireError";
  }
}

/** Builds one role-preserving candidate. The empty prompt is an engineering inference, not observed provider acceptance. */
export function buildOwnerActTwoWire(input: unknown, capturedInput: unknown): Readonly<OwnerActTwoWireCandidate> {
  let normalized: Readonly<OwnerActTwoNormalizedParameters>;
  try { normalized = normalizeOwnerActTwoParameters(input); } catch { return invalidWire(); }
  const captured = exactCaptured(capturedInput);
  if (!isSafeUploadReferenceUrl(captured.character_image.url) || !SHA256.test(captured.character_image.sha256) ||
      !Number.isSafeInteger(captured.character_image.size) || captured.character_image.size < 1 || captured.character_image.size > IMAGE_MAX_BYTES ||
      !Number.isSafeInteger(captured.character_image.width) || captured.character_image.width < 1 || captured.character_image.width > MAX_DIMENSION ||
      !Number.isSafeInteger(captured.character_image.height) || captured.character_image.height < 1 || captured.character_image.height > MAX_DIMENSION ||
      captured.character_image.width * captured.character_image.height > MAX_PIXELS ||
      (captured.character_image.mime_type !== "image/jpeg" && captured.character_image.mime_type !== "image/png") ||
      !isSafeUploadReferenceUrl(captured.performance_video.url) || !SHA256.test(captured.performance_video.sha256) ||
      !Number.isSafeInteger(captured.performance_video.size) || captured.performance_video.size < 16 || captured.performance_video.size > VIDEO_MAX_BYTES ||
      !Number.isSafeInteger(captured.performance_video.width) || captured.performance_video.width < 300 || captured.performance_video.width > MAX_DIMENSION ||
      !Number.isSafeInteger(captured.performance_video.height) || captured.performance_video.height < 300 || captured.performance_video.height > MAX_DIMENSION ||
      captured.performance_video.width * captured.performance_video.height > MAX_PIXELS || captured.performance_video.mime_type !== "video/mp4" ||
      captured.performance_video.measured_duration_seconds !== 5) invalidWire();

  const source = getOwnerActTwoSourceProfile();
  const file_urls = Object.freeze([
    Object.freeze({ type: "video" as const, url: captured.performance_video.url }),
    Object.freeze({ type: "image" as const, url: captured.character_image.url })
  ] as const);
  const settings = Object.freeze({ ...normalized.source_parameters, file_urls });
  const wire: Readonly<OwnerActTwoWireInput> = Object.freeze({ ai_name: "runway", prompt: "", settings });
  const sourceMedia = Object.freeze({
    character_image: Object.freeze({ sha256: captured.character_image.sha256, size: captured.character_image.size,
      width: captured.character_image.width, height: captured.character_image.height, mime_type: captured.character_image.mime_type }),
    performance_video: Object.freeze({ sha256: captured.performance_video.sha256, size: captured.performance_video.size,
      width: captured.performance_video.width, height: captured.performance_video.height, mime_type: captured.performance_video.mime_type,
      duration_seconds: captured.performance_video.measured_duration_seconds }),
    metadata_confidence: "CAPTURED_LOCAL_VALIDATION_AND_FFPROBE_NOT_DECODED_PIXELS" as const
  });
  const intent = Object.freeze({ model_id: normalized.intent.model_id, aspect_ratio: normalized.intent.aspect_ratio,
    video_duration: normalized.intent.video_duration, seed: normalized.intent.seed, expression: normalized.intent.expression,
    profile_sha256: source.source_sha256, character_image_sha256: captured.character_image.sha256,
    performance_video_sha256: captured.performance_video.sha256, measured_video_duration_seconds: captured.performance_video.measured_duration_seconds,
    prompt_evidence: PROMPT_EVIDENCE });
  return Object.freeze({ status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const, model_id: "acttwo" as const,
    profile_sha256: source.source_sha256, wire, source_media: sourceMedia,
    role_binding: "VIDEO_FROM_G_FILES_THEN_IMAGE_FROM_SETTINGS_FILE_URLS" as const, prompt_evidence: PROMPT_EVIDENCE,
    intent_fingerprint: schemaHash(intent), wire_fingerprint: schemaHash(wire), dispatch_allowed: false as const,
    provider_acceptance: "UNPROVEN" as const });
}

function exactCaptured(value: unknown): Readonly<{ character_image: OwnerActTwoCapturedCharacterImage; performance_video: OwnerActTwoCapturedPerformanceVideo }> {
  const fields = exactRecord(value, ["character_image", "performance_video"]);
  const image = exactRecord(fields.character_image, ["url", "sha256", "size", "width", "height", "mime_type"]);
  const video = exactRecord(fields.performance_video, ["url", "sha256", "size", "width", "height", "mime_type", "measured_duration_seconds"]);
  if (typeof image.url !== "string" || typeof image.sha256 !== "string" || typeof image.size !== "number" ||
      typeof image.width !== "number" || typeof image.height !== "number" || typeof image.mime_type !== "string" ||
      typeof video.url !== "string" || typeof video.sha256 !== "string" || typeof video.size !== "number" ||
      typeof video.width !== "number" || typeof video.height !== "number" || typeof video.mime_type !== "string" ||
      typeof video.measured_duration_seconds !== "number") invalidWire();
  return Object.freeze({
    character_image: Object.freeze({ url: image.url, sha256: image.sha256, size: image.size, width: image.width, height: image.height,
      mime_type: image.mime_type as OwnerActTwoCapturedCharacterImage["mime_type"] }),
    performance_video: Object.freeze({ url: video.url, sha256: video.sha256, size: video.size, width: video.width, height: video.height,
      mime_type: video.mime_type as OwnerActTwoCapturedPerformanceVideo["mime_type"], measured_duration_seconds: video.measured_duration_seconds as 5 })
  });
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidWire();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== "string" || !required.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidWire();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalidWire(); }
}
function invalidWire(): never { throw new OwnerActTwoWireError("INVALID_WIRE"); }
