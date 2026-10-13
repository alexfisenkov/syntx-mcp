import { createHash } from "node:crypto";
import { canonicalJson } from "../../application/generation-request.js";
import type { DiscoveryCatalogRepository } from "../../catalog/discovery-catalog.js";
import { ApplicationError } from "../../errors.js";
import type { GenerationRequest } from "../../domain/types.js";
import {
  snapshotSyntxGenerationRequest,
  type PreparedSyntxMediaRequest
} from "./upstream-adapter.js";

/**
 * STATIC candidate from observation 2026-09-04, not an executable catalog or
 * live attestation. Both the validator and wire builder use these constants.
 * Changing this local contract changes the durable schema binding on replay.
 */
const CONTRACT = Object.freeze({
  version: "banana-lite-prompt-only-static-candidate-v1",
  catalog_version: "2026-09-02T19:59:39.979Z.4d79bae5266c",
  model_id: "banana3_light",
  operation_id: "generate-image",
  ai_name: "banana",
  modality: "image" as const,
  parameters: Object.freeze(["prompt", "image_size", "aspect_ratio"]),
  prompt: Object.freeze({
    type: "string", nonblank: true, max_utf8_bytes: 4096, normalization: "none",
    forbidden_controls: "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]"
  }),
  additional_properties: false,
  wire_settings: Object.freeze({
    model_type: "banana3_light",
    image_size: "1K",
    aspect_ratio: "1:1",
    n: 1,
    image_url: Object.freeze([])
  })
});

const SCHEMA_HASH = `sha256:${createHash("sha256").update(canonicalJson(CONTRACT)).digest("hex")}`;

/** Explicit injection only. No credential lookup, network, write or runtime enablement. */
export function createBananaLiteRequestPreparer(
  catalog: DiscoveryCatalogRepository
): (request: GenerationRequest) => PreparedSyntxMediaRequest {
  // Resolve once from the validated Discovery repository, never from samples
  // or the unrelated observed-overlay catalog_version namespace.
  try {
    const version = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
    const model = catalog.getModel(CONTRACT.model_id);
    if (version !== CONTRACT.catalog_version || model.id !== CONTRACT.model_id ||
        model.upstream_id !== CONTRACT.wire_settings.model_type || model.ai_name !== CONTRACT.ai_name ||
        !model.active || model.scope !== CONTRACT.modality ||
        !model.operations.some((operation) => operation.id === CONTRACT.operation_id &&
          operation.output_modality === CONTRACT.modality)) throw invalidCandidate();
  } catch {
    throw invalidCandidate();
  }

  return (input) => {
    const request = snapshotSyntxGenerationRequest(input);
    const parameters = request.parameters;
    const keys = Object.keys(parameters);
    if (request.model_id !== CONTRACT.model_id || request.operation_id !== CONTRACT.operation_id ||
        request.catalog_version !== CONTRACT.catalog_version || keys.length !== CONTRACT.parameters.length ||
        keys.some((key) => !CONTRACT.parameters.includes(key)) ||
        typeof parameters.prompt !== CONTRACT.prompt.type || typeof parameters.prompt !== "string" ||
        parameters.prompt.trim().length === 0 ||
        Buffer.byteLength(parameters.prompt, "utf8") > CONTRACT.prompt.max_utf8_bytes ||
        new RegExp(CONTRACT.prompt.forbidden_controls, "u").test(parameters.prompt) ||
        parameters.image_size !== CONTRACT.wire_settings.image_size ||
        parameters.aspect_ratio !== CONTRACT.wire_settings.aspect_ratio) throw invalidCandidate();
    return Object.freeze({
      prompt: parameters.prompt,
      settings: CONTRACT.wire_settings,
      ai_name: CONTRACT.ai_name,
      modality: CONTRACT.modality,
      schema_hash: SCHEMA_HASH
    });
  };
}

function invalidCandidate(): ApplicationError {
  return new ApplicationError("INVALID_PARAMETERS", "The static Banana Lite request candidate is invalid or unpinned.");
}
