import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

export const OWNER_KLING_MEDIA_MODEL_IDS = Object.freeze([
  "kling_elements", "kling_o1_image2video", "kling_o1_video2video"
] as const);
export type OwnerKlingMediaModelId = typeof OWNER_KLING_MEDIA_MODEL_IDS[number];
type DeepReadonly<T> = T extends readonly unknown[] ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

const COST_QUERY_KEYS = Object.freeze({
  kling_elements: Object.freeze(["version", "mode", "video_duration", "native_audio"] as const),
  kling_o1_image2video: Object.freeze(["version", "mode", "video_duration"] as const),
  kling_o1_video2video: Object.freeze(["version", "mode", "video_duration"] as const)
});
const SOURCE_FACTS = deepFreeze({
  profile_id: "owner-kling-media-source-candidates-2349-v1",
  status: "STATIC_FORM_AND_PINNED_PUBLIC_METADATA_ONLY" as const,
  source_pins: {
    form_build_id: "1792363638" as const,
    form_module: "kling.js" as const,
    form_sha256: "sha256:b6ced9afe924548678f49be6b10437d3f9d1279f6c2553eb467cc2a07f8aef53" as const,
    video_module: "video.js" as const,
    video_sha256: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b" as const,
    settings_module: "settings3.js" as const,
    settings_sha256: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6" as const,
    cost_module: "cost2.js" as const,
    cost_sha256: "sha256:3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa" as const,
    file_uploader_module: "fileUploader.js" as const,
    file_uploader_sha256: "sha256:45f3174473d1ae4c9e57fbee47c7bf0c7e75773e9f3b36dbb8c3e5cc7ec3863a" as const,
    new_session_button_module: "NewSessionButton.js" as const,
    new_session_button_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" as const,
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const,
    public_row_snapshot: "sha256-284c89792942da7c2643c366ea414710886d954bf5641bd011216303eca66a87.json" as const
  },
  ai_name: "kling" as const,
  scope: "video" as const,
  route: "video/generate" as const,
  model_ids: OWNER_KLING_MEDIA_MODEL_IDS,
  cost_query_keys: COST_QUERY_KEYS,
  candidate_initial_tuples: {
    kling_elements: { version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false },
    kling_o1_image2video: { version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false },
    kling_o1_video2video: { version: "1.6", mode: "hd", video_duration: 5, native_audio: false }
  },
  input_media: {
    kling_elements: { source_type: "image" as const, selected_slice_count: 1 as const, source_validator_counts_by_version: { "1.6": [1, 4], "3.0": [1, 7] } },
    kling_o1_image2video: { source_type: "image" as const, selected_slice_count: 1 as const, source_validator_counts: [1, 4] },
    kling_o1_video2video: { source_type: "video" as const, selected_slice_count: 1 as const, source_validator_exact_video_count: 1 as const,
      selected_slice_image_count: 0 as const, source_image_count_max: 4 as const, selected_video_duration_seconds: 5 as const }
  },
  prompt_limit: { source_public_value: 0 as const, effective_semantics: "UNKNOWN" as const,
    local_maximum_utf16_length: 1_000, local_limit_confidence: "CONSERVATIVE_LOCAL_BOUND_NOT_PROVIDER_LIMIT" as const },
  wire: { body_fields: ["chat_id", "prompt", "settings"] as const, query: { ai_name: "kling" as const },
    typed_file_url: ["type", "url"] as const, o1_v2v_aspect_ratio: "OMITTED_AFTER_SOURCE_CLEAR" as const },
  dispatch_allowed: false as const, upload_authority: false as const,
  backend_acceptance: "UNPROVEN" as const, result_codec: "UNPROVEN" as const
});
const SOURCE_PROFILE = deepFreeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

type CommonInput<M extends OwnerKlingMediaModelId> = { readonly model_id: M; readonly prompt: string; readonly version: "1.6";
  readonly mode: "hd"; readonly video_duration: 5; readonly native_audio: false };
export type OwnerKlingMediaParametersInput =
  | (CommonInput<"kling_elements"> & { readonly aspect_ratio: "16:9" })
  | (CommonInput<"kling_o1_image2video"> & { readonly aspect_ratio: "16:9" })
  | CommonInput<"kling_o1_video2video">;
type SourceParameters =
  | { readonly model_type: "kling_elements"; readonly version: "1.6"; readonly mode: "hd"; readonly aspect_ratio: "16:9"; readonly video_duration: 5; readonly native_audio: false }
  | { readonly model_type: "kling_o1_image2video"; readonly version: "1.6"; readonly mode: "hd"; readonly aspect_ratio: "16:9"; readonly video_duration: 5; readonly native_audio: false }
  | { readonly model_type: "kling_o1_video2video"; readonly version: "1.6"; readonly mode: "hd"; readonly video_duration: 5; readonly native_audio: false };
export interface OwnerKlingMediaNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY"; readonly intent: Readonly<OwnerKlingMediaParametersInput>;
  readonly source_parameters: Readonly<SourceParameters>; readonly source_profile_sha256: string; readonly cost_query_keys: readonly string[];
  readonly prompt_limit_confidence: "CONSERVATIVE_LOCAL_BOUND_NOT_PROVIDER_LIMIT"; readonly prompt_maximum_utf16_length: 1_000;
  readonly dispatch_allowed: false; readonly upload_authority: false; readonly backend_acceptance: "UNPROVEN";
}
export class OwnerKlingMediaParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") { super("The source-bound Kling media parameter tuple is invalid."); this.name = "OwnerKlingMediaParametersError"; }
}
export function getOwnerKlingMediaSourceProfile(): DeepReadonly<typeof SOURCE_PROFILE> { return SOURCE_PROFILE; }

export function normalizeOwnerKlingMediaParameters(input: unknown): Readonly<OwnerKlingMediaNormalizedParameters> {
  const fields = exactRecord(input), modelId = fields.model_id, prompt = fields.prompt;
  if (!isOwnerKlingMediaModelId(modelId) || typeof prompt !== "string" || prompt.trim().length === 0 || !wellFormedUnicode(prompt) || prompt.length > 1_000) invalid();
  let sourceParameters: SourceParameters;
  if (modelId === "kling_elements" || modelId === "kling_o1_image2video") {
    if (!hasExactKeys(fields, ["model_id", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio"]) ||
        fields.version !== "1.6" || fields.mode !== "hd" || fields.aspect_ratio !== "16:9" || fields.video_duration !== 5 || fields.native_audio !== false) invalid();
    sourceParameters = Object.freeze({ model_type: modelId, version: "1.6", mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: false });
  } else {
    if (!hasExactKeys(fields, ["model_id", "prompt", "version", "mode", "video_duration", "native_audio"]) ||
        fields.version !== "1.6" || fields.mode !== "hd" || fields.video_duration !== 5 || fields.native_audio !== false) invalid();
    sourceParameters = Object.freeze({ model_type: "kling_o1_video2video", version: "1.6", mode: "hd", video_duration: 5, native_audio: false });
  }
  const intent = Object.freeze({ ...fields }) as Readonly<OwnerKlingMediaParametersInput>;
  return Object.freeze({ status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY", intent, source_parameters: sourceParameters,
    source_profile_sha256: SOURCE_PROFILE.source_sha256, cost_query_keys: COST_QUERY_KEYS[modelId],
    prompt_limit_confidence: "CONSERVATIVE_LOCAL_BOUND_NOT_PROVIDER_LIMIT", prompt_maximum_utf16_length: 1_000,
    dispatch_allowed: false, upload_authority: false, backend_acceptance: "UNPROVEN" });
}
export function isOwnerKlingMediaModelId(value: unknown): value is OwnerKlingMediaModelId {
  return typeof value === "string" && (OWNER_KLING_MEDIA_MODEL_IDS as readonly string[]).includes(value);
}
function exactRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  try { const p = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
    if ((p !== Object.prototype && p !== null) || keys.some(k => typeof k !== "string" || !Object.hasOwn(d[k]!, "value") || d[k]!.enumerable !== true)) invalid();
    const out = Object.create(null) as Record<string, unknown>; for (const k of keys as string[]) out[k] = d[k]!.value; return out;
  } catch { return invalid(); }
}
function hasExactKeys(v: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(v); return actual.length === expected.length && expected.every(k => Object.hasOwn(v, k));
}
function wellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) { const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { if (i + 1 >= value.length) return false; const n = value.charCodeAt(++i); if (n < 0xdc00 || n > 0xdfff) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  } return true;
}
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value as DeepReadonly<T>;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]); return Object.freeze(value) as DeepReadonly<T>;
}
function invalid(): never { throw new OwnerKlingMediaParametersError("INVALID_PARAMETERS"); }
