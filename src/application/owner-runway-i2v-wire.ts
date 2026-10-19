import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerRunwayI2vSourceProfile,
  normalizeOwnerRunwayI2vParameters,
  type OwnerRunwayI2vNormalizedParameters,
  type OwnerRunwayI2vAspectRatio
} from "./owner-runway-i2v-parameters.js";
import { OWNER_RUNWAY_I2V_IMAGE_POLICY } from "./owner-runway-i2v-image-policy.js";

const MODEL_IDS = Object.freeze(["4genfirstframeimage", "turbo4genfirstframeimage", "gen4.5i2v"] as const);
const RATIO_PARTS: Readonly<Record<OwnerRunwayI2vAspectRatio, readonly [number, number]>> = Object.freeze({
  "21:9": [21, 9], "16:9": [16, 9], "4:3": [4, 3], "1:1": [1, 1], "3:4": [3, 4], "9:16": [9, 16]
});
const SHA256 = /^[a-f0-9]{64}$/u;

export interface OwnerRunwayI2vCapturedReference {
  readonly url: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}
export interface OwnerRunwayI2vWireInput {
  readonly ai_name: "runway";
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: typeof MODEL_IDS[number];
    readonly aspect_ratio: string;
    readonly video_duration: "5.0" | "8.0" | "10.0";
    readonly seed: null;
    readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }>[];
  }>;
}
export interface OwnerRunwayI2vWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: typeof MODEL_IDS[number];
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerRunwayI2vWireInput>;
  readonly source_image_context: Readonly<{
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS";
  }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_CROPPED_IMAGE";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export class OwnerRunwayI2vWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner Runway I2V wire candidate is invalid.");
    this.name = "OwnerRunwayI2vWireError";
  }
}

/** Builds a deterministic, source-derived candidate from one owner-captured cropped image. */
export function buildOwnerRunwayI2vWire(input: unknown, capturedInput: unknown): Readonly<OwnerRunwayI2vWireCandidate> {
  let normalized: Readonly<OwnerRunwayI2vNormalizedParameters>;
  try { normalized = normalizeOwnerRunwayI2vParameters(input); } catch { return invalidWire(); }
  const captured = exactCapturedReference(capturedInput);
  const [ratioWidth, ratioHeight] = RATIO_PARTS[normalized.intent.aspect_ratio];
  if (!isSafeUploadReferenceUrl(captured.url) || !SHA256.test(captured.sha256) ||
      !Number.isSafeInteger(captured.width) || captured.width < 1 || captured.width > OWNER_RUNWAY_I2V_IMAGE_POLICY.max_dimension ||
      !Number.isSafeInteger(captured.height) || captured.height < 1 || captured.height > OWNER_RUNWAY_I2V_IMAGE_POLICY.max_dimension ||
      captured.width * captured.height > OWNER_RUNWAY_I2V_IMAGE_POLICY.max_pixels ||
      captured.width * ratioHeight !== captured.height * ratioWidth) invalidWire();

  const profileSha256 = getOwnerRunwayI2vSourceProfile().source_sha256;
  const file_urls = Object.freeze([Object.freeze({ type: "image" as const, url: captured.url })]);
  const settings = Object.freeze({
    model_type: normalized.source_parameters.model_type,
    aspect_ratio: normalized.source_parameters.aspect_ratio,
    video_duration: normalized.source_parameters.video_duration,
    seed: normalized.source_parameters.seed,
    file_urls
  });
  const wire: Readonly<OwnerRunwayI2vWireInput> = Object.freeze({
    ai_name: "runway",
    prompt: normalized.intent.prompt,
    settings
  });
  const semanticIntent = Object.freeze({
    model_id: normalized.intent.model_id,
    prompt: normalized.intent.prompt,
    aspect_ratio: normalized.intent.aspect_ratio,
    video_duration: normalized.intent.video_duration,
    seed: null,
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
    reference_binding: "ONE_CAPTURED_CROPPED_IMAGE" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactCapturedReference(value: unknown): OwnerRunwayI2vCapturedReference {
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
function invalidWire(): never { throw new OwnerRunwayI2vWireError("INVALID_WIRE_CANDIDATE"); }
