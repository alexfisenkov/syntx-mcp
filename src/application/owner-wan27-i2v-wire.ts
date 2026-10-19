import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { OWNER_WAN27_I2V_IMAGE_POLICY, type OwnerWan27I2vImageMimeType } from "./owner-wan27-i2v-image-policy.js";
import { getOwnerWan27I2vSourceProfile, normalizeOwnerWan27I2vParameters,
  type OwnerWan27I2vNormalizedParameters } from "./owner-wan27-i2v-parameters.js";

const SHA256 = /^[a-f0-9]{64}$/u;
export interface OwnerWan27I2vCapturedImage {
  readonly model_id: "wan_27_i2v"; readonly url: string; readonly sha256: string;
  readonly mime_type: OwnerWan27I2vImageMimeType; readonly size: number; readonly width: number; readonly height: number;
}
export interface OwnerWan27I2vWireSettings {
  readonly model_type: "wan_27_i2v"; readonly resolution: "720P"; readonly aspect_ratio: "1:1"; readonly video_duration: 5;
  readonly prompt_extend: false; readonly shot_type: "single"; readonly audio_setting: "auto"; readonly seed: null;
  readonly native_audio: false; readonly rendering_speed: "basic";
  readonly file_urls: readonly Readonly<{ type: "first_frame"; url: string }>[];
}
export interface OwnerWan27I2vWire {
  readonly ai_name: "wan_video"; readonly prompt: string; readonly settings: Readonly<OwnerWan27I2vWireSettings>;
}
export interface OwnerWan27I2vWireCandidate {
  readonly status: "SOURCE_CANDIDATE_NOT_DISPATCH_AUTHORITY"; readonly model_id: "wan_27_i2v"; readonly scope: "video";
  readonly source_profile_sha256: string; readonly wire: Readonly<OwnerWan27I2vWire>;
  readonly image_context: Readonly<OwnerWan27I2vCapturedImage>;
  readonly intent_fingerprint: string; readonly wire_fingerprint: string;
  readonly image_count: 1; readonly video_count: 0; readonly audio_count: 0;
  readonly upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER";
  readonly dispatch_allowed: false; readonly provider_acceptance: "UNPROVEN";
}
export class OwnerWan27I2vWireError extends Error {
  constructor(readonly code: "INVALID_WIRE_CANDIDATE") { super("The WAN 2.7 I2V wire candidate is invalid."); this.name = "OwnerWan27I2vWireError"; }
}
export function buildOwnerWan27I2vWire(parametersInput: unknown, imageInput: unknown): Readonly<OwnerWan27I2vWireCandidate> {
  let params: Readonly<OwnerWan27I2vNormalizedParameters>;
  try { params = normalizeOwnerWan27I2vParameters(parametersInput); } catch { return invalid(); }
  const image = exactImage(imageInput), policy = OWNER_WAN27_I2V_IMAGE_POLICY;
  if (image.model_id !== params.intent.model_id || !isSafeUploadReferenceUrl(image.url) || !SHA256.test(image.sha256) ||
      !policy.canonical_mime_types.includes(image.mime_type) || !Number.isSafeInteger(image.size) || image.size < 1 ||
      image.size > policy.public_bounds.max_file_size || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) ||
      image.width < policy.public_bounds.min_side || image.height < policy.public_bounds.min_side ||
      image.width > policy.public_bounds.max_side || image.height > policy.public_bounds.max_side ||
      image.width / image.height < policy.public_bounds.min_aspect_ratio || image.width / image.height > policy.public_bounds.max_aspect_ratio ||
      image.width * image.height > policy.local_max_pixels) invalid();
  const profileHash = getOwnerWan27I2vSourceProfile().source_sha256;
  const file_urls = Object.freeze([Object.freeze({ type: "first_frame" as const, url: image.url })]);
  const settings = Object.freeze({ ...params.settings, file_urls });
  const wire = Object.freeze({ ai_name: "wan_video" as const, prompt: params.intent.prompt, settings });
  const intent = Object.freeze({ model_id: params.intent.model_id, prompt: params.intent.prompt, settings: params.settings,
    image_sha256: image.sha256, image_mime_type: image.mime_type, image_size: image.size, image_width: image.width, image_height: image.height });
  return Object.freeze({ status: "SOURCE_CANDIDATE_NOT_DISPATCH_AUTHORITY" as const, model_id: "wan_27_i2v" as const,
    scope: "video" as const, source_profile_sha256: profileHash, wire, image_context: image,
    intent_fingerprint: schemaHash(intent), wire_fingerprint: schemaHash(wire),
    image_count: 1 as const, video_count: 0 as const, audio_count: 0 as const,
    upload_destination: "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER" as const,
    dispatch_allowed: false as const, provider_acceptance: "UNPROVEN" as const });
}
function exactImage(input: unknown): Readonly<OwnerWan27I2vCapturedImage> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) return invalid();
  try {
    const d = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(d);
    const required = ["model_id", "url", "sha256", "mime_type", "size", "width", "height"];
    if (keys.length !== required.length || keys.some(k => typeof k !== "string" || !required.includes(k) ||
        !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) return invalid();
    const f = Object.create(null) as Record<string, unknown>; for (const key of keys as string[]) f[key] = d[key]!.value;
    if (f.model_id !== "wan_27_i2v" || typeof f.url !== "string" || typeof f.sha256 !== "string" ||
        typeof f.mime_type !== "string" || typeof f.size !== "number" || typeof f.width !== "number" || typeof f.height !== "number") return invalid();
    return Object.freeze({ model_id: f.model_id, url: f.url, sha256: f.sha256, mime_type: f.mime_type,
      size: f.size, width: f.width, height: f.height }) as OwnerWan27I2vCapturedImage;
  } catch { return invalid(); }
}
function invalid(): never { throw new OwnerWan27I2vWireError("INVALID_WIRE_CANDIDATE"); }
