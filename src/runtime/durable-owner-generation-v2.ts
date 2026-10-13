import type { GenerationContractV2Request, PreparedSyntxMediaRequestV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import { snapshotSyntxGenerationRequest, type PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import type { GenerationRequest } from "../domain/types.js";

export interface DurableOwnerV2VariantSelection {
  readonly model_id: string;
  readonly operation_id: string;
  readonly variant_id: string;
}

export function selectDurableOwnerV2Request(
  request: GenerationRequest,
  selections: readonly DurableOwnerV2VariantSelection[]
): GenerationContractV2Request {
  if (!Array.isArray(selections)) throw new Error("DURABLE_OWNER_V2_VARIANT_SELECTION_INVALID");
  const snapshot = snapshotSyntxGenerationRequest(request);
  const variants = new Map<string, string>();
  for (const selection of selections) {
    if (selection === null || typeof selection !== "object" ||
        typeof selection.model_id !== "string" || selection.model_id.length === 0 ||
        typeof selection.operation_id !== "string" || selection.operation_id.length === 0 ||
        typeof selection.variant_id !== "string" || selection.variant_id.length === 0) {
      throw new Error("DURABLE_OWNER_V2_VARIANT_SELECTION_INVALID");
    }
    const key = selectionKey(selection.model_id, selection.operation_id);
    if (variants.has(key)) throw new Error("DURABLE_OWNER_V2_VARIANT_SELECTION_DUPLICATE");
    variants.set(key, selection.variant_id);
  }
  const variantId = variants.get(selectionKey(snapshot.model_id, snapshot.operation_id));
  return Object.freeze({
    model_id: snapshot.model_id,
    operation_id: snapshot.operation_id,
    catalog_version: snapshot.catalog_version,
    parameters: snapshot.parameters,
    ...(variantId === undefined ? {} : { variant_id: variantId })
  });
}

export function projectDurableOwnerV2PreparedRequest(
  prepared: PreparedSyntxMediaRequestV2
): PreparedSyntxMediaRequest {
  return Object.freeze({
    prompt: prepared.prompt,
    settings: prepared.settings,
    ai_name: prepared.ai_name,
    modality: prepared.modality,
    schema_hash: prepared.schema_hash
  });
}

function selectionKey(modelId: string, operationId: string): string {
  return `${modelId}\u0000${operationId}`;
}
