import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";

const MODEL_ID = "acttwo" as const;
const ASPECT_RATIO = "1:1" as const;
const ASPECT_SOURCE_CODE = "11" as const;
const VIDEO_DURATION_SECONDS = 5 as const;
const EXPRESSION = 3 as const;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

const SOURCE_FACTS = Object.freeze({
  profile_id: "owner-runway-acttwo-source2355-v1",
  status: "STATIC_SOURCE_CONTRACT_NOT_RUNTIME_OR_PROVIDER_ACCEPTANCE" as const,
  form_build_id: "1792363638" as const,
  form_module: "runway.js" as const,
  form_bytes: 19_785 as const,
  form_sha256: "sha256:975b82daca30bf02e5b0591373fcf6a944b25661a42ffaa4d039c2c1ab36cb91" as const,
  public_models_snapshot_sha256: "sha256:cb2581608a551f4bc783af85d2edd8cca6a926f8f84f41e3382885ba9a3cf054" as const,
  public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const,
  model_id: MODEL_ID,
  ai_name: "runway" as const,
  form_id: "runway" as const,
  scope: "video" as const,
  aspect_ratio: Object.freeze({ caller_value: ASPECT_RATIO, source_code: ASPECT_SOURCE_CODE }),
  video_duration: Object.freeze({ mode: "MEASURED_PERFORMANCE_VIDEO_METADATA" as const, initial_seconds: VIDEO_DURATION_SECONDS,
    initial_source_value: 5 as const, initial_slice_only: true as const }),
  seed: null,
  expression: EXPRESSION,
  gestures: "OMITTED_WHEN_CHARACTER_FILE_URL_IS_IMAGE" as const,
  prompt_policy: "DISABLED_OMIT_CALLER_PROMPT" as const,
  prompt_wire_candidate: "EMPTY_STRING_CANDIDATE_UNTIL_LIVE_ACCEPTANCE" as const,
  roles: Object.freeze({ character: "settings.file_urls:image" as const, performance: "g.files:video" as const,
    character_count: 1 as const, performance_count: 1 as const }),
  merged_wire_order: Object.freeze(["performance_video", "character_image"] as const),
  image: Object.freeze({ accepted_mime_types: Object.freeze(["image/jpeg", "image/png"] as const),
    max_file_size_bytes: MAX_MEDIA_BYTES, source_ui_count: 1 as const }),
  performance_video: Object.freeze({ accepted_mime_types: Object.freeze(["video/mp4"] as const),
    max_file_size_bytes: MAX_MEDIA_BYTES, source_catalog_max_duration_seconds: 30 as const,
    measured_duration_required: true as const }),
  cost_keys: Object.freeze(["video_duration"] as const),
  dispatch_allowed: false as const,
  runtime_usable: false as const,
  provider_acceptance: "UNPROVEN" as const
});

const SOURCE_PROFILE = Object.freeze({ ...SOURCE_FACTS, source_sha256: schemaHash(SOURCE_FACTS) });

export interface OwnerActTwoParametersInput {
  readonly model_id: typeof MODEL_ID;
  readonly aspect_ratio: typeof ASPECT_RATIO;
  readonly video_duration: typeof VIDEO_DURATION_SECONDS;
  readonly seed: null;
  readonly expression: typeof EXPRESSION;
}

export interface OwnerActTwoNormalizedParameters {
  readonly status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY";
  readonly intent: Readonly<OwnerActTwoParametersInput>;
  readonly source_parameters: Readonly<{
    model_type: typeof MODEL_ID;
    aspect_ratio: typeof ASPECT_SOURCE_CODE;
    video_duration: typeof VIDEO_DURATION_SECONDS;
    seed: null;
    expression: typeof EXPRESSION;
  }>;
  readonly profile_sha256: string;
  readonly prompt_policy: "DISABLED_OMIT_CALLER_PROMPT";
  readonly measured_duration_required: true;
  readonly dispatch_allowed: false;
  readonly provider_acceptance: "UNPROVEN";
}

export class OwnerActTwoParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The owner Runway ActTwo parameter selection is invalid.");
    this.name = "OwnerActTwoParametersError";
  }
}

export function getOwnerActTwoSourceProfile(): Readonly<typeof SOURCE_PROFILE> {
  return SOURCE_PROFILE;
}

/** Exact initial ActTwo slice. Duration is an upload-measured value, not a caller override. */
export function normalizeOwnerActTwoParameters(input: unknown): Readonly<OwnerActTwoNormalizedParameters> {
  const fields = exactRecord(input, ["model_id", "aspect_ratio", "video_duration", "seed", "expression"]);
  if (fields.model_id !== MODEL_ID || fields.aspect_ratio !== ASPECT_RATIO || fields.video_duration !== VIDEO_DURATION_SECONDS ||
      fields.seed !== null || fields.expression !== EXPRESSION) invalidParameters();

  const intent = Object.freeze({
    model_id: MODEL_ID,
    aspect_ratio: ASPECT_RATIO,
    video_duration: VIDEO_DURATION_SECONDS,
    seed: null,
    expression: EXPRESSION
  });
  const source_parameters = Object.freeze({
    model_type: MODEL_ID,
    aspect_ratio: ASPECT_SOURCE_CODE,
    video_duration: VIDEO_DURATION_SECONDS,
    seed: null,
    expression: EXPRESSION
  });
  return Object.freeze({ status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const, intent, source_parameters,
    profile_sha256: SOURCE_PROFILE.source_sha256, prompt_policy: "DISABLED_OMIT_CALLER_PROMPT" as const,
    measured_duration_required: true as const, dispatch_allowed: false as const, provider_acceptance: "UNPROVEN" as const });
}

function exactRecord(value: unknown, required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidParameters();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) invalidParameters();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return invalidParameters(); }
}

function invalidParameters(): never {
  throw new OwnerActTwoParametersError("INVALID_PARAMETERS");
}
