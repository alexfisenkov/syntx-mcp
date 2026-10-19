import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerGrokI2vSourceProfile,
  normalizeOwnerGrokI2vParameters,
  type OwnerGrokI2vNormalizedParameters,
  type OwnerGrokI2vModelId
} from "./owner-grok-i2v-parameters.js";
import { OWNER_GROK_I2V_IMAGE_POLICY } from "./owner-grok-i2v-image-policy.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface OwnerGrokI2vCapturedImage {
  readonly url: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}
export interface OwnerGrokI2vWireInput {
  readonly ai_name: "grok_video";
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerGrokI2vModelId;
    readonly aspect_ratio: string;
    readonly video_duration: number;
    readonly resolution: "480p" | "720p";
    readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[];
  }>;
}
export interface OwnerGrokI2vWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: OwnerGrokI2vModelId;
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerGrokI2vWireInput>;
  readonly source_image_context: Readonly<{
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS";
  }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_IMAGE";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerGrokI2vWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner Grok I2V wire candidate is invalid.");
    this.name = "OwnerGrokI2vWireError";
  }
}

/** Builds a deterministic, source-derived candidate only; it cannot upload or dispatch. */
export function buildOwnerGrokI2vWire(input: unknown, capturedInput: unknown): Readonly<OwnerGrokI2vWireCandidate> {
  let normalized: Readonly<OwnerGrokI2vNormalizedParameters>;
  try { normalized = normalizeOwnerGrokI2vParameters(input); } catch { return invalidWire(); }
  const captured = exactCapturedImage(capturedInput);
  if (!isSafeUploadReferenceUrl(captured.url) || !SHA256.test(captured.sha256) ||
      !Number.isSafeInteger(captured.width) || captured.width < 1 || captured.width > OWNER_GROK_I2V_IMAGE_POLICY.max_dimension ||
      !Number.isSafeInteger(captured.height) || captured.height < 1 || captured.height > OWNER_GROK_I2V_IMAGE_POLICY.max_dimension ||
      captured.width * captured.height > OWNER_GROK_I2V_IMAGE_POLICY.max_pixels ||
      (normalized.intent.model_id === "grok_i2v" && captured.width * 9 !== captured.height * 16)) invalidWire();

  const profileSha256 = getOwnerGrokI2vSourceProfile().source_sha256;
  const file_urls = Object.freeze([Object.freeze({ type: "image" as const, url: captured.url })]);
  const settings = Object.freeze({
    model_type: normalized.source_parameters.model_type,
    aspect_ratio: normalized.source_parameters.aspect_ratio,
    video_duration: normalized.source_parameters.video_duration,
    resolution: normalized.source_parameters.resolution,
    file_urls
  });
  const wire: Readonly<OwnerGrokI2vWireInput> = Object.freeze({
    ai_name: "grok_video",
    prompt: normalized.intent.prompt,
    settings
  });
  const semanticIntent = Object.freeze({
    model_id: normalized.intent.model_id,
    prompt: normalized.intent.prompt,
    aspect_ratio: normalized.intent.aspect_ratio,
    video_duration: normalized.intent.video_duration,
    resolution: normalized.intent.resolution,
    source_profile_sha256: profileSha256,
    source_image_sha256: captured.sha256,
    source_image_width: captured.width,
    source_image_height: captured.height
  });
  return Object.freeze({
    status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const,
    model_id: normalized.intent.model_id,
    profile_sha256: profileSha256,
    wire,
    source_image_context: Object.freeze({ sha256: captured.sha256, width: captured.width, height: captured.height,
      authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS" as const }),
    intent_fingerprint: schemaHash(semanticIntent),
    wire_fingerprint: schemaHash(wire),
    reference_binding: "ONE_CAPTURED_IMAGE" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactCapturedImage(value: unknown): OwnerGrokI2vCapturedImage {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidWire();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const required = ["url", "sha256", "width", "height"] as const;
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key as typeof required[number]) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalidWire();
    const fields = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) fields[key] = descriptors[key]!.value;
    if (typeof fields.url !== "string" || typeof fields.sha256 !== "string" || typeof fields.width !== "number" || typeof fields.height !== "number") invalidWire();
    return Object.freeze({ url: fields.url, sha256: fields.sha256, width: fields.width, height: fields.height });
  } catch { return invalidWire(); }
}
function invalidWire(): never { throw new OwnerGrokI2vWireError("INVALID_WIRE_CANDIDATE"); }
