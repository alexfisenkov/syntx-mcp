import {
  normalizeOwnerGrokT2iParameters,
  type OwnerGrokT2iModel
} from "./owner-grok-t2i-parameters.js";

const SOURCE_BINDING = Object.freeze({
  form_build_id: "1791467421",
  form_sha256: "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d",
  cost2_build_id: "1791467421",
  cost2_sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9",
  value_chain: "ROOT770_COST2_PROJECTOR_TO_GETCOST"
} as const);

export interface OwnerGrokT2iCostParametersInput {
  readonly model_id: OwnerGrokT2iModel;
  readonly reference_count: number;
  readonly parameters: Readonly<{
    aspect_ratio: string;
    batch_size: number;
    resolution: string;
    details_quality?: "low" | "medium";
  }>;
}

export interface OwnerGrokT2iCostParameters {
  readonly model_id: OwnerGrokT2iModel;
  readonly routing: Readonly<{ ai_name: "grok_image"; model_type: OwnerGrokT2iModel }>;
  readonly cost_inputs: Readonly<{
    batch_size: number;
    resolution?: string;
    details_quality?: "low" | "medium";
    ref_count?: number;
  }>;
  /** Selector metadata only; explicitly carries no owned-reference authority. */
  readonly reference_count_context: Readonly<{
    reference_count: number;
    confidence: "SOURCE_SELECTOR_COUNT_ONLY_NOT_OWNED_REFERENCE_PROOF";
    owned_references_bound: false;
  }>;
  readonly source_binding: typeof SOURCE_BINDING;
  readonly confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

/** Projects explicit, source-validated Grok T2I controls into the read-only model-info query keys. */
export function projectOwnerGrokT2iCostParameters(input: unknown): OwnerGrokT2iCostParameters {
  const normalized = normalizeOwnerGrokT2iParameters(input);
  const model = normalized.variant;
  const parameters = normalized.parameters;
  const costInputs = Object.freeze({
    batch_size: parameters.batch_size,
    ...(model === "grok_imagine_2" || model === "grok_imagine_quality"
      ? { resolution: parameters.resolution }
      : {}),
    ...(model === "grok_imagine_2" ? { details_quality: parameters.details_quality! } : {}),
    ...(model === "grok_imagine_2" && normalized.reference_count > 0
      ? { ref_count: normalized.reference_count }
      : {})
  });
  return Object.freeze({
    model_id: model,
    routing: Object.freeze({ ai_name: "grok_image", model_type: model }),
    cost_inputs: costInputs,
    reference_count_context: Object.freeze({
      reference_count: normalized.reference_count,
      confidence: "SOURCE_SELECTOR_COUNT_ONLY_NOT_OWNED_REFERENCE_PROOF",
      owned_references_bound: false
    }),
    source_binding: SOURCE_BINDING,
    confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP",
    dispatch_allowed: false,
    runtime_activation: false,
    backend_acceptance: "UNPROVEN"
  });
}
