import {
  OwnerSoulGenerationParametersError,
  normalizeOwnerSoulGenerationParameters,
  type OwnerSoulGenerationParametersInput
} from "./owner-soul-generation-parameters.js";

const MODEL_ID = "higgsfield-soul" as const;
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json" as const;
const MODEL_RECORD_SHA256 = "sha256:16da8ea2298f05143e9992197536d63830a9359428312e2c635287d8f152fa22" as const;
const SOURCE_BINDING = Object.freeze({
  public_catalog_version: CATALOG_VERSION,
  full_public_model_record_sha256: MODEL_RECORD_SHA256,
  form_build_id: "1791467421",
  form_sha256: "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391",
  cost2_build_id: "1791467421",
  cost2_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  value_chain: "SOUL_AE_SINGLE_ARGUMENT_TO_COST2_MODEL_ACCESS_READ_ONLY_QUERY",
  declared_model_info_keys: Object.freeze(["quality", "resolution", "batch_size", "version"] as const),
  projected_model_info_keys: Object.freeze(["quality", "resolution", "batch_size"] as const),
  version_value: "UNRESOLVED_NOT_UI_FIELD_OMITTED_NOT_DEFAULTED" as const,
  intent_only_fields: Object.freeze(["prompt", "enhance_prompt", "seed", "style", "character"] as const),
  generation_wire_bound: false
} as const);

export interface OwnerSoulImageCostParameters {
  readonly model_id: typeof MODEL_ID;
  readonly routing: Readonly<{ ai_name: typeof MODEL_ID; model_type: typeof MODEL_ID }>;
  readonly cost_inputs: Readonly<{
    quality: OwnerSoulGenerationParametersInput["quality"];
    resolution: OwnerSoulGenerationParametersInput["resolution"];
    batch_size: OwnerSoulGenerationParametersInput["batch_size"];
  }>;
  readonly source_binding: typeof SOURCE_BINDING;
  readonly cost_inputs_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

/** Validates the complete explicit Soul intent and projects only the proven read-only cost2 keys. */
export function projectOwnerSoulImageCostParameters(input: OwnerSoulGenerationParametersInput | unknown): OwnerSoulImageCostParameters {
  const normalized = normalizeOwnerSoulGenerationParameters(input);
  if (normalized.model.model_id !== MODEL_ID || normalized.model.ai_name !== MODEL_ID ||
      normalized.model.model_type !== MODEL_ID || normalized.model.catalog_version !== CATALOG_VERSION) {
    throw new OwnerSoulGenerationParametersError("MODEL_BINDING_MISMATCH");
  }
  const intent = normalized.intent;
  const costInputs = Object.freeze({ quality: intent.quality, resolution: intent.resolution, batch_size: intent.batch_size });
  return Object.freeze({
    model_id: MODEL_ID,
    routing: Object.freeze({ ai_name: MODEL_ID, model_type: MODEL_ID }),
    cost_inputs: costInputs,
    source_binding: SOURCE_BINDING,
    cost_inputs_confidence: "SOURCE_JOINED_COST2_QUERY_FIELDS_NOT_QUOTE_BILLING_OR_HARDCAP",
    dispatch_allowed: false,
    runtime_activation: false,
    backend_acceptance: "UNPROVEN"
  });
}
