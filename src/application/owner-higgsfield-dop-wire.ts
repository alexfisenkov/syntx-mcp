import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerHiggsfieldDopSourceProfile,
  normalizeOwnerHiggsfieldDopParameters,
  type OwnerHiggsfieldDopModelId,
  type OwnerHiggsfieldDopMotionSelection,
  type OwnerHiggsfieldDopNormalizedParameters
} from "./owner-higgsfield-dop-parameters.js";
import { OWNER_HIGGSFIELD_DOP_IMAGE_POLICY } from "./owner-higgsfield-dop-image-policy.js";

const SHA256 = /^[a-f0-9]{64}$/u;

export interface OwnerHiggsfieldDopCapturedImage {
  readonly url: string;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

export interface OwnerHiggsfieldDopWireInput {
  readonly ai_name: "higgsfield";
  readonly prompt: string;
  readonly settings: Readonly<{
    readonly model_type: OwnerHiggsfieldDopModelId;
    readonly enhance_prompt: false;
    readonly motions: readonly OwnerHiggsfieldDopMotionSelection[];
    readonly file_urls: readonly Readonly<{ readonly type: "image"; readonly url: string }> [];
  }>;
}

export interface OwnerHiggsfieldDopWireCandidate {
  readonly status: "SOURCE_ONLY_WIRE_CANDIDATE_NOT_DISPATCH_AUTHORITY";
  readonly model_id: OwnerHiggsfieldDopModelId;
  readonly profile_sha256: string;
  readonly wire: Readonly<OwnerHiggsfieldDopWireInput>;
  readonly source_image_context: Readonly<{
    readonly sha256: string;
    readonly width: number;
    readonly height: number;
    readonly authority: "CAPTURED_UPLOAD_METADATA_NOT_DECODED_PIXELS";
  }>;
  readonly intent_fingerprint: string;
  readonly wire_fingerprint: string;
  readonly reference_binding: "ONE_CAPTURED_IMAGE";
  readonly upload_authority: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerHiggsfieldDopWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") {
    super("The owner Higgsfield DOP wire candidate is invalid.");
    this.name = "OwnerHiggsfieldDopWireError";
  }
}

/** Builds a deterministic candidate only; this helper cannot upload or dispatch. */
export function buildOwnerHiggsfieldDopWire(input: unknown, capturedInput: unknown): Readonly<OwnerHiggsfieldDopWireCandidate> {
  let normalized: Readonly<OwnerHiggsfieldDopNormalizedParameters>;
  try { normalized = normalizeOwnerHiggsfieldDopParameters(input); } catch { return invalidWire(); }
  const captured = exactCapturedImage(capturedInput);
  if (!isSafeUploadReferenceUrl(captured.url) || !SHA256.test(captured.sha256) ||
      !Number.isSafeInteger(captured.width) || captured.width < 1 || captured.width > OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.max_dimension ||
      !Number.isSafeInteger(captured.height) || captured.height < 1 || captured.height > OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.max_dimension ||
      captured.width * captured.height > OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.max_pixels) invalidWire();

  const profileSha256 = getOwnerHiggsfieldDopSourceProfile().source_sha256;
  const file_urls = Object.freeze([Object.freeze({ type: "image" as const, url: captured.url })]);
  const settings = Object.freeze({
    model_type: normalized.source_parameters.model_type,
    enhance_prompt: false as const,
    motions: normalized.source_parameters.motions,
    file_urls
  });
  const wire: Readonly<OwnerHiggsfieldDopWireInput> = Object.freeze({
    ai_name: "higgsfield",
    prompt: normalized.intent.prompt,
    settings
  });
  const semanticIntent = Object.freeze({
    model_id: normalized.intent.model_id,
    prompt: normalized.intent.prompt,
    motions: normalized.intent.motions,
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
    upload_authority: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactCapturedImage(value: unknown): OwnerHiggsfieldDopCapturedImage {
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
    if (typeof fields.url !== "string" || typeof fields.sha256 !== "string" ||
        typeof fields.width !== "number" || typeof fields.height !== "number") invalidWire();
    return Object.freeze({ url: fields.url, sha256: fields.sha256, width: fields.width, height: fields.height });
  } catch { return invalidWire(); }
}

function invalidWire(): never { throw new OwnerHiggsfieldDopWireError("INVALID_WIRE_CANDIDATE"); }
