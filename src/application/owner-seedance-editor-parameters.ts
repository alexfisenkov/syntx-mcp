import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

const MODEL_ID = "seedance-2.5-editor" as const;
const MODEL_TYPE = "seedance-2.5" as const;
const AI_NAME = "seedance" as const;
const RESOLUTIONS = Object.freeze(["480p", "720p", "1080p"] as const);
const MAX_PROMPT_UTF16 = 5_000;

const SOURCE_FACTS = Object.freeze({
  profile_id: "owner-seedance-editor-source2216-no-frame-variant-v1",
  status: "STATIC_SOURCE_CONTRACT_NOT_RUNTIME_OR_PROVIDER_ACCEPTANCE" as const,
  form_id: "seedance-editor" as const,
  scope: "tool_video_inpaint" as const,
  model_id: MODEL_ID,
  model_type: MODEL_TYPE,
  ai_name: AI_NAME,
  operation_id: "generate-video" as const,
  source_pins: Object.freeze({
    source_build_id: "1792156098" as const,
    form_module: "seedance-editor.js" as const,
    form_bytes: 9_580 as const,
    form_sha256: "sha256:979eb2c9dbfe1e276a4cd006f0d4f96084ccf06abeb7c38aabcd24d841cd8155" as const,
    app_router_module: "app.js" as const,
    app_router_bytes: 2_450_053 as const,
    app_router_sha256: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042" as const,
    video_parent_module: "InpaintEditor2.js" as const,
    video_parent_bytes: 15_396 as const,
    video_parent_sha256: "sha256:87b56ae610c0aba6880a9686709b201d4be404fe2e0e4812a19cdef8a1874ce1" as const,
    editor_helper_module: "useInpaintTool.js" as const,
    editor_helper_bytes: 218_328 as const,
    editor_helper_sha256: "sha256:cc01e4bbbd52225a952485809da756145f86bb4b11ddd3b310cb3af4f5fb730d" as const,
    new_session_module: "NewSessionButton.js" as const,
    new_session_bytes: 2_052 as const,
    new_session_sha256: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc" as const,
    enrich_module: "useEnrichFileMetaWithDuration.js" as const,
    enrich_bytes: 45_241 as const,
    enrich_sha256: "sha256:09611977302662f75f1076cefed631360c1734ba07f7795fe289f562dee49ba6" as const
  }),
  form_initializer: Object.freeze({
    model_type: MODEL_TYPE,
    mode: "edit" as const,
    aspect_ratio: "adaptive" as const,
    resolution: "720p" as const,
    video_duration: 0 as const,
    generate_audio: false as const
  }),
  resolution_values: RESOLUTIONS,
  input_video_duration: Object.freeze({ minimum_seconds: 4 as const, maximum_seconds: "UNKNOWN" as const }),
  prompt_limit: Object.freeze({ maximum_utf16_length: MAX_PROMPT_UTF16, scope: "LOCAL_RESOURCE_BOUND_NOT_PROVIDER_LIMIT" as const }),
  input_variant: "ONE_VIDEO_NO_FRAME_REFERENCES" as const,
  effective_defaults: "UNKNOWN" as const,
  cost_projection: "UNKNOWN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const,
  backend_acceptance: "UNPROVEN" as const
});

const SOURCE_PROFILE = Object.freeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

const CURRENT_UI_OBSERVATION_FACTS = Object.freeze({
  observation_date: "2026-10-30" as const,
  status: "CURRENT_UI_POST_OBSERVED_HTTP_400_ACCEPTANCE_UNPROVEN" as const,
  source: Object.freeze({
    build_id: "1793202992" as const,
    form_module: "seedance-editor.js" as const,
    form_sha256: "sha256:118844ecf40ae5735cbabb0fc52f2d40531a29ebd1c11431ab3e97638fe938cd" as const
  }),
  observed_source_video_duration_seconds: 5,
  request: Object.freeze({
    method: "POST" as const,
    path: "/api/v1/video/generate" as const,
    query_ai_name: AI_NAME,
    body_keys: Object.freeze(["chat_id", "prompt", "settings"] as const),
    settings: Object.freeze({
      n: 1 as const,
      model_type: MODEL_TYPE,
      mode: "edit" as const,
      aspect_ratio: "adaptive" as const,
      resolution: "720p" as const,
      video_duration: 0 as const,
      generate_audio: true as const,
      file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: "OWNER_SUPPLIED_URL_REDACTED" as const })])
    })
  }),
  response: Object.freeze({ http_status: 400 as const, accepted: "UNPROVEN" as const, generation_result: "NOT_CONFIRMED" as const })
});
const CURRENT_UI_OBSERVATION = Object.freeze({ ...CURRENT_UI_OBSERVATION_FACTS,
  observation_sha256: schemaHash(CURRENT_UI_OBSERVATION_FACTS) });

const CURRENT_SOURCE_FACTS = Object.freeze({
  observation_date: "2026-11-05" as const,
  status: "STATIC_SOURCE_ONLY_NOT_RUNTIME_OR_PROVIDER_ACCEPTANCE" as const,
  source_build_id: "1793711938" as const,
  public_catalog_sha256: "bca24244ca2a2ffc79e6788621993335181f0a44958d3b0ff0fac724326fd41b" as const,
  settings_sha256: "f8012eea6e0f7017604df399f6d5e1e5dc1f41dec5e813ec353588de746866b2" as const,
  form_sha256: "ad1a4e965e13d9765fe4f885dc7ac352c68d9bad5fdcfe417be30d8fa8028cf7" as const,
  submit_helper_sha256: "54d454584001e2f1289d139e2c9259e880c877a50f14d574063021078e2f4a72" as const,
  submit_removes_n: true as const,
  initializer_generate_audio: true as const,
  provider_acceptance: "UNPROVEN" as const
});
const CURRENT_SOURCE = Object.freeze({ ...CURRENT_SOURCE_FACTS, source_sha256: schemaHash(CURRENT_SOURCE_FACTS) });

export function getOwnerSeedanceEditorCurrentSource(): Readonly<typeof CURRENT_SOURCE> {
  return CURRENT_SOURCE;
}

const FRAME_SOURCE_FACTS = Object.freeze({
  source_build_id: "1793890358" as const,
  public_catalog_sha256: "a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88" as const,
  settings_sha256: "4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187" as const,
  form_sha256: "5c884dcb0dca241d1bc47185db237ad556854d951b29c7cf5e4f5589641624f4" as const,
  parent_sha256: "e607b023f73446cb083fddd3e530c7dcd3a3b5adc2c72359c22efc31601c81d6" as const,
  frame_timecode_sha256: "d69325f2be02ee6825285235b5308d880d7210fc3ed089d8ff285fedee592996" as const,
  sender_sha256: "4d81d1d8ea5b5f0a47fbe482f2bf974c0bdf8acbe1eea99699ded91edd5a1354" as const,
  canvas_frame_mime: "image/png" as const,
  maximum_images_catalog: 30 as const,
  local_frame_limit_bytes: 20 * 1024 * 1024,
  local_image_geometry: Object.freeze({ min_width: 300, min_height: 300, max_width: 6000, max_height: 6000,
    max_pixels: 52500000, min_aspect: 0.4, max_aspect: 2.5 }),
  timecode_format: "MM:SS.mmm_ROUNDED_TO_NEAREST_MILLISECOND" as const,
  source_video_first: true as const,
  frame_contents_match_video: "NOT_VERIFIED" as const,
  effective_defaults: "UNKNOWN" as const,
  rendered_ui: "NOT_CHECKED" as const,
  backend_acceptance: "UNPROVEN" as const,
  runtime_usable: false as const,
  dispatch_allowed: false as const
});
const FRAME_SOURCE = Object.freeze({ ...FRAME_SOURCE_FACTS, source_sha256: schemaHash(FRAME_SOURCE_FACTS) });
export function getOwnerSeedanceEditorFrameSource(): Readonly<typeof FRAME_SOURCE> { return FRAME_SOURCE; }

export type OwnerSeedanceEditorResolution = typeof RESOLUTIONS[number];

export interface OwnerSeedanceEditorParametersInput {
  readonly model_id: typeof MODEL_ID;
  readonly prompt: string;
  readonly resolution: OwnerSeedanceEditorResolution;
}

export interface OwnerSeedanceEditorNormalizedParameters {
  readonly status: "SOURCE_DERIVED_PARAMETERS_NORMALIZED_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerSeedanceEditorParametersInput>;
  readonly profile_sha256: string;
  readonly prompt_bound: "LOCAL_RESOURCE_BOUND_UTF16";
  readonly effective_defaults: "UNKNOWN";
  readonly cost_projection: "UNKNOWN";
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerSeedanceEditorParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner Seedance Editor parameter selection is invalid.");
    this.name = "OwnerSeedanceEditorParametersError";
  }
}

export function getOwnerSeedanceEditorSourceProfile(): Readonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Separate current browser-wire observation; it does not replace the immutable older static profile. */
export function getOwnerSeedanceEditorCurrentUiObservation(): Readonly<typeof CURRENT_UI_OBSERVATION> {
  return CURRENT_UI_OBSERVATION;
}

/** Normalizes explicit choices only; the form initializer is not treated as an effective default. */
export function normalizeOwnerSeedanceEditorParameters(input: unknown): Readonly<OwnerSeedanceEditorNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "prompt", "resolution"]);
  if (fields.model_id !== MODEL_ID || typeof fields.prompt !== "string" || fields.prompt.trim().length === 0 ||
      fields.prompt.length > MAX_PROMPT_UTF16 || /<<<https?:\/\//iu.test(fields.prompt) || !isWellFormedUnicode(fields.prompt) || !oneOf(fields.resolution, RESOLUTIONS)) {
    invalidParameters();
  }
  const intent = Object.freeze({ model_id: MODEL_ID, prompt: fields.prompt, resolution: fields.resolution as OwnerSeedanceEditorResolution });
  return Object.freeze({
    status: "SOURCE_DERIVED_PARAMETERS_NORMALIZED_NOT_DISPATCH_AUTHORITY" as const,
    intent,
    profile_sha256: SOURCE_PROFILE.source_sha256,
    prompt_bound: "LOCAL_RESOURCE_BOUND_UTF16" as const,
    effective_defaults: "UNKNOWN" as const,
    cost_projection: "UNKNOWN" as const,
    dispatch_allowed: false as const,
    runtime_usable: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidParameters();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) {
      invalidParameters();
    }
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch { return invalidParameters(); }
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function invalidParameters(): never {
  throw new OwnerSeedanceEditorParametersError("INVALID_PARAMETERS");
}
