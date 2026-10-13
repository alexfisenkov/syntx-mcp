import {
  getOwnerWanT2iSourceParameters,
  normalizeOwnerWanT2iParameters,
  type OwnerWanT2iModel,
  type OwnerWanT2iParameters
} from "./owner-wan-t2i-parameters.js";

const SOURCE_PARAMETERS = getOwnerWanT2iSourceParameters();
const SOURCE_BINDING = Object.freeze({
  public_catalog_version: SOURCE_PARAMETERS.source_pins.public_catalog_version,
  public_models_sha256: SOURCE_PARAMETERS.source_pins.public_models_sha256,
  form_build_id: SOURCE_PARAMETERS.source_pins.form_build_id,
  form_sha256: SOURCE_PARAMETERS.source_pins.form_sha256,
  cost_source_sha256: SOURCE_PARAMETERS.source_pins.cost_source_sha256,
  cost_helper_sha256: SOURCE_PARAMETERS.source_pins.cost_helper_sha256
} as const);

export interface OwnerWanT2iCostParameters {
  readonly model_id: OwnerWanT2iModel;
  readonly routing: Readonly<{ ai_name: "wan_image"; model_type: OwnerWanT2iModel }>;
  readonly cost_inputs: Readonly<{ batch_size: OwnerWanT2iParameters["batch_size"] }>;
  readonly declared_model_info_keys: readonly ["size", "batch_size"];
  readonly omitted_model_info_keys: readonly ["size"];
  readonly size_policy: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS";
  readonly source_projection_status: "SOURCE_JOINED_BATCH_SIZE_ONLY";
  readonly source_binding: typeof SOURCE_BINDING;
  readonly confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly quote_units_billing_hard_cap: "UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

/** Projects explicit, validated WAN T2I intent into the only controlled cost query input. */
export function projectOwnerWanT2iCostParameters(input: unknown): Readonly<OwnerWanT2iCostParameters> {
  const normalized = normalizeOwnerWanT2iParameters(input);
  assertSourceCostMapping();
  const modelId = normalized.source_bound_intent.model_id;
  const base = {
    model_id: modelId,
    routing: Object.freeze({ ai_name: normalized.cost_routing.ai_name, model_type: normalized.cost_routing.model_type }),
    cost_inputs: Object.freeze({ batch_size: normalized.cost_inputs.batch_size }),
    declared_model_info_keys: Object.freeze(["size", "batch_size"] as const),
    omitted_model_info_keys: Object.freeze(["size"] as const),
    size_policy: "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS" as const,
    source_projection_status: "SOURCE_JOINED_BATCH_SIZE_ONLY" as const,
    source_binding: SOURCE_BINDING,
    confidence: "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    quote_units_billing_hard_cap: "UNPROVEN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  };
  return Object.freeze(base);
}

function assertSourceCostMapping(): void {
  const cost = SOURCE_PARAMETERS.cost;
  if (cost.declared_get_cost_params.length !== 2 || cost.declared_get_cost_params[0] !== "size" ||
      cost.declared_get_cost_params[1] !== "batch_size" || cost.cost_inputs.length !== 1 ||
      cost.cost_inputs[0] !== "batch_size" || cost.size !== "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS" ||
      cost.quote_billing_units_hard_cap !== "UNPROVEN") {
    throw new Error("The pinned WAN T2I cost projection is inconsistent.");
  }
}
