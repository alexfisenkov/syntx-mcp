import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerHailuoInitialSourceProfile,
  normalizeOwnerHailuoInitialParameters,
  type OwnerHailuoInitialModelId,
  type OwnerHailuoInitialNormalizedParameters
} from "./owner-hailuo-media-parameters.js";
import {
  OWNER_HAILUO_INITIAL_IMAGE_POLICY,
  type OwnerHailuoInitialImageMimeType
} from "./owner-hailuo-image-policy.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface OwnerHailuoInitialCapturedImage {
  readonly model_id: OwnerHailuoInitialModelId;
  readonly url: string;
  readonly sha256: string;
  readonly mime_type: OwnerHailuoInitialImageMimeType;
  readonly width: number;
  readonly height: number;
}

export type OwnerHailuoInitialWireSettings =
  | Readonly<{ readonly model_type: "hailuo-01-live-character"; readonly resolution: "720p"; readonly video_duration: 6;
      readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[] }>
  | Readonly<{ readonly model_type: "hailuo-2.3-fast"; readonly resolution: "768p" | "1080p"; readonly video_duration: 6 | 10;
      readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[] }>
  | Readonly<{ readonly model_type: "hailuo-3.0"; readonly resolution: "2K"; readonly video_duration: 5;
      readonly aspect_ratio: "16:9"; readonly mode: "omni-references";
      readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[] }>;

export interface OwnerHailuoInitialWireInput {
  readonly ai_name: "hailuo-minimax";
  readonly prompt: string;
  readonly settings: OwnerHailuoInitialWireSettings;
}

export interface OwnerHailuoInitialWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly scope: "video";
  readonly model_id: OwnerHailuoInitialModelId;
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerHailuoInitialWireInput>;
  readonly source_image_context: Readonly<{
    readonly model_id: OwnerHailuoInitialModelId;
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly mime_type: OwnerHailuoInitialImageMimeType;
    readonly authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS";
  }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_IMAGE";
  readonly upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER";
  readonly upload_authority: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHailuoInitialWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner Hailuo initial wire candidate is invalid.");
    this.name = "OwnerHailuoInitialWireError";
  }
}

/** Builds a deterministic candidate only; the trusted upload destination and dispatch authority stay external. */
export function buildOwnerHailuoInitialWire(parameters: unknown, capturedInput: unknown): Readonly<OwnerHailuoInitialWireCandidate> {
  let normalized: Readonly<OwnerHailuoInitialNormalizedParameters>;
  try { normalized = normalizeOwnerHailuoInitialParameters(parameters); } catch { return invalidWire(); }
  const captured = exactCapturedImage(capturedInput);
  const maxDimension = OWNER_HAILUO_INITIAL_IMAGE_POLICY.max_dimension[normalized.intent.model_id];
  const minDimension = OWNER_HAILUO_INITIAL_IMAGE_POLICY.min_dimension[normalized.intent.model_id];
  if (captured.model_id !== normalized.intent.model_id || !isSafeUploadReferenceUrl(captured.url) || !SHA256.test(captured.sha256) ||
      !OWNER_HAILUO_INITIAL_IMAGE_POLICY.local_supported_mime_types.includes(captured.mime_type) ||
      !Number.isSafeInteger(captured.width) || !Number.isSafeInteger(captured.height) ||
      captured.width < minDimension || captured.height < minDimension || captured.width > maxDimension || captured.height > maxDimension ||
      captured.width * captured.height > OWNER_HAILUO_INITIAL_IMAGE_POLICY.max_pixels) invalidWire();

  const profileSha256 = getOwnerHailuoInitialSourceProfile().source_sha256;
  const file_urls = Object.freeze([Object.freeze({ type: "image" as const, url: captured.url })]);
  let settings: OwnerHailuoInitialWireSettings;
  if (normalized.intent.model_id === "hailuo-01-live-character") {
    settings = Object.freeze({ model_type: "hailuo-01-live-character", resolution: "720p", video_duration: 6, file_urls });
  } else if (normalized.intent.model_id === "hailuo-2.3-fast") {
    settings = Object.freeze({ model_type: "hailuo-2.3-fast",
      resolution: normalized.source_parameters.resolution as "768p" | "1080p",
      video_duration: normalized.source_parameters.video_duration as 6 | 10, file_urls });
  } else {
    settings = Object.freeze({ model_type: "hailuo-3.0", resolution: "2K", video_duration: 5,
      aspect_ratio: "16:9", mode: "omni-references", file_urls });
  }
  const wire: Readonly<OwnerHailuoInitialWireInput> = Object.freeze({
    ai_name: "hailuo-minimax",
    prompt: normalized.intent.prompt,
    settings
  });
  const semanticIntent = Object.freeze({
    model_id: normalized.intent.model_id,
    prompt: normalized.intent.prompt,
    source_parameters: normalized.source_parameters,
    source_profile_sha256: profileSha256,
    source_image_model_id: captured.model_id,
    source_image_sha256: captured.sha256,
    source_image_width: captured.width,
    source_image_height: captured.height,
    source_image_mime_type: captured.mime_type
  });
  return Object.freeze({
    status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    scope: "video" as const,
    model_id: normalized.intent.model_id,
    profile_sha256: profileSha256,
    wire,
    source_image_context: Object.freeze({ model_id: captured.model_id, sha256: captured.sha256, width: captured.width,
      height: captured.height, mime_type: captured.mime_type, authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS" as const }),
    intent_fingerprint: schemaHash(semanticIntent),
    wire_fingerprint: schemaHash(wire),
    reference_binding: "ONE_CAPTURED_IMAGE" as const,
    upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const,
    upload_authority: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactCapturedImage(value: unknown): Readonly<OwnerHailuoInitialCapturedImage> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidWire();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const required = ["model_id", "url", "sha256", "mime_type", "width", "height"] as const;
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key as typeof required[number]) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidWire();
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
    if (!isOwnerModel(fields.model_id) || typeof fields.url !== "string" || typeof fields.sha256 !== "string" ||
        typeof fields.mime_type !== "string" || typeof fields.width !== "number" || typeof fields.height !== "number") invalidWire();
    return Object.freeze({ model_id: fields.model_id, url: fields.url, sha256: fields.sha256, mime_type: fields.mime_type,
      width: fields.width, height: fields.height }) as Readonly<OwnerHailuoInitialCapturedImage>;
  } catch { return invalidWire(); }
}

function isOwnerModel(value: unknown): value is OwnerHailuoInitialModelId {
  return value === "hailuo-01-live-character" || value === "hailuo-2.3-fast" || value === "hailuo-3.0";
}

function invalidWire(): never { throw new OwnerHailuoInitialWireError("INVALID_WIRE_CANDIDATE"); }
