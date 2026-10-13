import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { ApplicationError } from "../errors.js";
import type { GenerationRequest, Modality } from "../domain/types.js";
import { CatalogRepository } from "./catalog.js";
import { DiscoveryCatalogRepository } from "./discovery-catalog.js";
import { sameSourceHashes } from "./runtime-capability-catalog.js";
import { sha256CanonicalPayload } from "./syntx-public-catalog.js";

/**
 * DEBT-043 (docs/проект/незакрыто.md): GenerationRequest.model_id lives in
 * catalog/v1/public-samples.json (e.g. "nano-banana-pro"), but the SYNTX
 * generation routes (startImage/startVideo/startAudio) need ai_name, which
 * lives in a DIFFERENT catalog (official-public-api.json, surfaced here via
 * DiscoveryCatalogRepository, e.g. "banana"). The two id spaces do not
 * overlap and no heuristic bridges them safely — a naive "strip trailing
 * digits" rule gives the wrong answer for real entries ("veo_omni" and
 * "banana3_light" are not simple digit-suffixed siblings of their families).
 *
 * IMPORTANT — this resolves the FAMILY only, not the specific SYNTX model
 * variant (round-2 critic review, 3 independent critics: "banana" covers
 * banana/banana2/banana3/banana3_light, "veo3" covers
 * veo3/veo_omni/veo3fast/veo3fast_r). Which variant SYNTX actually runs for
 * a bare ai_name is unobserved — DEBT-048 tracks that gap separately; do not
 * read family resolution as "the exact requested model will run".
 *
 * This is a small, hand-curated, hash-pinned overlay — the same pattern
 * RuntimeCapabilityCatalog (runtime-capability-catalog.ts) already uses for
 * a similar "public catalog does not carry this fact, so pin a reviewed
 * table and fail loudly on drift" problem, extended with the semantic
 * cross-check that pattern also does (round-2 critic-code/critic-risk: an
 * earlier version only checked that model_id and ai_name each independently
 * existed somewhere, which let a transposed pair like
 * nano-banana-pro -> suno construct successfully and resolve silently
 * wrong — modality overlap between the two sides is now required). Every
 * entry is added by a human reviewing both catalogs; construction throws if
 * either source catalog has since drifted from what the table was reviewed
 * against, if any current public-samples model is missing an entry (fail
 * closed, not silently partial), or if an entry's ai_name has no ACTIVE
 * SYNTX model at all (round-2 critic-code: an inactive-only family would
 * pass validation here and still fail at SYNTX, after the chat already
 * exists).
 */

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const modelIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
// Real ai_name families include hyphens (e.g. "hailuo-minimax",
// "stable-diffusion") — round-2 critic-code found the original
// underscore-only pattern would reject 10 of 49 real families, making the
// bridge unconstructable the moment one of them needed an entry.
const aiNameSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/u);

const bridgeEntrySchema = z
  .object({
    model_id: modelIdSchema,
    ai_name: aiNameSchema,
    // Free-text provenance, not machine-checked: where a reviewer found
    // this pairing (round-2 critic-risk — a bare pair with no trail forces
    // a full re-investigation on every future review).
    source_note: z.string().min(1).max(300)
  })
  .strict();

export const generationAiNameBridgeSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    public_samples_catalog_version: z.string().min(1).max(120),
    public_samples_sha256: sha256Schema,
    public_catalog_source_hashes: z
      .object({
        ai: sha256Schema,
        llm_models: sha256Schema,
        models: sha256Schema
      })
      .strict(),
    checked_at: z.iso.datetime(),
    entries: z.array(bridgeEntrySchema).max(1_000)
  })
  .strict()
  .superRefine((bridge, context) => {
    const seen = new Set<string>();
    for (const [index, entry] of bridge.entries.entries()) {
      if (seen.has(entry.model_id)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "model_id"],
          message: "Duplicate model_id in generation ai_name bridge."
        });
      }
      seen.add(entry.model_id);
    }
  });

export type GenerationAiNameBridge = z.infer<
  typeof generationAiNameBridgeSchema
>;

/**
 * Resolves GenerationRequest.model_id -> SYNTX ai_name via the pinned,
 * hand-reviewed bridge table, throwing on any unmapped or drifted input
 * rather than guessing (SyntxUpstreamAdapterOptions.resolveAiName's
 * contract).
 */
export class GenerationAiNameResolver {
  readonly #byModelId: ReadonlyMap<string, string>;

  constructor(
    catalog: CatalogRepository,
    discovery: DiscoveryCatalogRepository,
    bridge: GenerationAiNameBridge = loadGenerationAiNameBridge()
  ) {
    const validated = generationAiNameBridgeSchema.parse(bridge);
    if (
      validated.public_samples_catalog_version !==
      catalog.catalog.catalog_version
    ) {
      throw new TypeError(
        "Generation ai_name bridge drifted from the public sample catalog version (catalog/runtime/v1/generation-ai-name-bridge.json)."
      );
    }
    if (
      validated.public_samples_sha256 !==
      sha256CanonicalPayload(catalog.catalog)
    ) {
      throw new TypeError(
        "Generation ai_name bridge drifted from the public sample catalog content (catalog/runtime/v1/generation-ai-name-bridge.json) — the version string matched but the content changed."
      );
    }
    if (!sameSourceHashes(validated.public_catalog_source_hashes, discovery.source_hashes)) {
      throw new TypeError(
        "Generation ai_name bridge drifted from public catalog source hashes (catalog/runtime/v1/generation-ai-name-bridge.json)."
      );
    }
    const knownModelIds = new Set(catalog.catalog.models.map((model) => model.id));
    const activeModalitiesByAiName = collectActiveAiNameModalities(discovery);
    for (const entry of validated.entries) {
      if (!knownModelIds.has(entry.model_id)) {
        throw new TypeError(
          `Generation ai_name bridge references unknown model_id "${entry.model_id}" (catalog/runtime/v1/generation-ai-name-bridge.json).`
        );
      }
      const familyModalities = activeModalitiesByAiName.get(entry.ai_name);
      if (familyModalities === undefined) {
        throw new TypeError(
          `Generation ai_name bridge references ai_name "${entry.ai_name}" with no ACTIVE SYNTX model (catalog/runtime/v1/generation-ai-name-bridge.json).`
        );
      }
      const modelModalities = new Set(
        catalog.getModel(entry.model_id).modalities
      );
      const overlaps = [...familyModalities].some((modality) =>
        modelModalities.has(modality)
      );
      if (!overlaps) {
        throw new TypeError(
          `Generation ai_name bridge maps model_id "${entry.model_id}" (modalities: ${[...modelModalities].join(", ")}) to ai_name "${entry.ai_name}" (modalities: ${[...familyModalities].join(", ")}) — no overlap, likely a transposed or mistaken entry (catalog/runtime/v1/generation-ai-name-bridge.json).`
        );
      }
    }
    for (const model of catalog.catalog.models) {
      if (!validated.entries.some((entry) => entry.model_id === model.id)) {
        throw new TypeError(
          `Generation ai_name bridge is missing an entry for model_id "${model.id}" (catalog/runtime/v1/generation-ai-name-bridge.json).`
        );
      }
    }
    this.#byModelId = new Map(
      validated.entries.map((entry) => [entry.model_id, entry.ai_name] as const)
    );
  }

  resolve(modelId: string): string {
    const aiName = this.#byModelId.get(modelId);
    if (aiName === undefined) {
      throw new ApplicationError(
        "MODEL_NOT_FOUND",
        `No ai_name mapping is recorded for model ${modelId}.`
      );
    }
    return aiName;
  }
}

/**
 * SyntxUpstreamAdapterOptions.resolveModality's contract: GenerationRequest
 * carries no modality field, but CatalogOperation already does
 * (output_modality) — CatalogRepository.getOperation already throws
 * MODEL_NOT_FOUND/OPERATION_NOT_FOUND for anything it cannot resolve, so
 * this is composition, not new logic.
 */
export function resolveModalityFromCatalog(
  catalog: CatalogRepository,
  request: Pick<GenerationRequest, "model_id" | "operation_id">
): Modality {
  return catalog.getOperation(request.model_id, request.operation_id)
    .output_modality;
}

export function loadGenerationAiNameBridge(
  path?: string
): GenerationAiNameBridge {
  const bridgePath = path ?? findDefaultBridgePath();
  const raw: unknown = JSON.parse(readFileSync(bridgePath, "utf8"));
  return generationAiNameBridgeSchema.parse(raw);
}

/**
 * Only ACTIVE models count (round-2 critic-code): an ai_name whose sole
 * SYNTX models are all inactive would pass a "does this name exist at all"
 * check yet fail at SYNTX after the chat already exists. Also doubles as
 * the cross-validation input: modality overlap between a bridge entry's
 * public-samples model and its resolved family catches a transposed pair
 * (e.g. an audio family mistakenly mapped to an image model).
 */
function collectActiveAiNameModalities(
  discovery: DiscoveryCatalogRepository
): Map<string, Set<Modality>> {
  const byAiName = new Map<string, Set<Modality>>();
  let cursor: string | undefined;
  do {
    const page = discovery.search({
      include_inactive: false,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor })
    });
    for (const item of page.items) {
      const modalities = byAiName.get(item.ai_name) ?? new Set<Modality>();
      for (const modality of item.modalities) modalities.add(modality);
      byAiName.set(item.ai_name, modalities);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return byAiName;
}

function findDefaultBridgePath(): string {
  const candidates = [
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v1/generation-ai-name-bridge.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v1/generation-ai-name-bridge.json",
        import.meta.url
      )
    )
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Generation ai_name bridge was not found.");
  }
  return found;
}
