import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

export const SYNTX_PUBLIC_CATALOG_ENDPOINTS = {
  ai: "https://api.syntx.ai/api/v1/ai?lang=ru",
  llm_models: "https://api.syntx.ai/api/v1/llm/models?lang=ru",
  models: "https://api.syntx.ai/api/v1/ai/models?lang=ru"
} as const;

const identifierSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._-]+$/u);
const shortTextSchema = z.string().max(2_000);
const descriptionSchema = z.string().max(20_000).nullable();
const nonnegativeNumberSchema = z.number().min(0);
const nonnegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const utcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected a valid UTC timestamp."
  });

const publicAiEntrySchema = z
  .object({
    active: z.boolean(),
    description: descriptionSchema,
    label: z.string().min(1).max(500),
    scope: identifierSchema,
    value: identifierSchema
  })
  .strict();

const featureFlagsSchema = z
  .object({
    files_generation: z.boolean(),
    files_processing: z.boolean(),
    image_generation: z.boolean(),
    image_processing: z.boolean(),
    search: z.boolean()
  })
  .strict();

const mediaCountLimitSchema = z
  .object({
    audios: nonnegativeIntegerSchema.optional(),
    documents: nonnegativeIntegerSchema.optional(),
    first_frame: nonnegativeIntegerSchema.optional(),
    images: nonnegativeIntegerSchema.optional(),
    last_frame: nonnegativeIntegerSchema.optional(),
    videos: nonnegativeIntegerSchema.optional()
  })
  .strict();

const mediaFileSizeLimitSchema = z
  .object({
    audios: nonnegativeIntegerSchema.optional(),
    documents: nonnegativeIntegerSchema.optional(),
    images: nonnegativeIntegerSchema.optional(),
    videos: nonnegativeIntegerSchema.optional()
  })
  .strict();

const labelledStringOptionSchema = z
  .object({
    label: z.string().min(1).max(500),
    value: z.string().min(1).max(500)
  })
  .strict();

const qualityWithDurationsSchema = z
  .object({
    durations: z.array(nonnegativeNumberSchema).max(100),
    label: z.string().min(1).max(500),
    value: nonnegativeNumberSchema
  })
  .strict();

const publicSettingsSchema = z
  .object({
    accepted_file_types: z.array(z.string().min(1).max(500)).max(500).optional(),
    allowed_media_types: z.array(z.string().min(1).max(100)).max(100).optional(),
    allowed_modes: z.array(z.string().min(1).max(160)).max(200).optional(),
    aspect_ratio: z.array(labelledStringOptionSchema).max(200).optional(),
    attach_info_text: shortTextSchema.nullable().optional(),
    custom_mode_prompt_length: nonnegativeIntegerSchema.optional(),
    default_model: identifierSchema.optional(),
    dialogue_max_inputs: nonnegativeIntegerSchema.optional(),
    dialogue_prompt_limit: nonnegativeIntegerSchema.optional(),
    file_count_limit: z
      .union([nonnegativeIntegerSchema, mediaCountLimitSchema])
      .optional(),
    file_mentions: z.boolean().optional(),
    files_mention: z.boolean().optional(),
    get_cost_params: z.array(identifierSchema).max(200).optional(),
    hdr_video_support: z.boolean().optional(),
    image_resize_limit: nonnegativeIntegerSchema.optional(),
    max_audio_duration: nonnegativeNumberSchema.optional(),
    max_audio_file_size: nonnegativeIntegerSchema.optional(),
    max_audio_total_duration: nonnegativeNumberSchema.optional(),
    max_dimension: nonnegativeNumberSchema.optional(),
    max_file_size: z
      .union([nonnegativeIntegerSchema, mediaFileSizeLimitSchema])
      .optional(),
    max_frame_count: nonnegativeIntegerSchema.optional(),
    max_image_aspect_ratio: nonnegativeNumberSchema.optional(),
    max_image_dimension: nonnegativeIntegerSchema.optional(),
    max_image_file_size: nonnegativeIntegerSchema.optional(),
    max_image_height: nonnegativeNumberSchema.optional(),
    max_image_pixel_count: nonnegativeIntegerSchema.optional(),
    max_image_width: nonnegativeNumberSchema.optional(),
    max_prompt_length: nonnegativeIntegerSchema.optional(),
    max_side: nonnegativeNumberSchema.optional(),
    max_total_file_size: nonnegativeIntegerSchema.optional(),
    max_video_aspect_ratio: nonnegativeNumberSchema.optional(),
    max_video_duration: nonnegativeNumberSchema.optional(),
    max_video_file_size: nonnegativeIntegerSchema.optional(),
    max_video_fps: nonnegativeNumberSchema.optional(),
    max_video_height: nonnegativeNumberSchema.optional(),
    max_video_pixel_count: nonnegativeIntegerSchema.optional(),
    max_video_total_duration: nonnegativeNumberSchema.optional(),
    max_video_width: nonnegativeNumberSchema.optional(),
    min_audio_duration: nonnegativeNumberSchema.optional(),
    min_audio_total_duration: nonnegativeNumberSchema.optional(),
    min_dimension: nonnegativeNumberSchema.optional(),
    min_image_aspect_ratio: nonnegativeNumberSchema.optional(),
    min_image_height: nonnegativeNumberSchema.optional(),
    min_image_pixel_count: nonnegativeIntegerSchema.optional(),
    min_image_width: nonnegativeNumberSchema.optional(),
    min_prompt_length: nonnegativeIntegerSchema.optional(),
    min_side: nonnegativeNumberSchema.optional(),
    min_video_aspect_ratio: nonnegativeNumberSchema.optional(),
    min_video_duration: nonnegativeNumberSchema.optional(),
    min_video_fps: nonnegativeNumberSchema.optional(),
    min_video_height: nonnegativeNumberSchema.optional(),
    min_video_pixel_count: nonnegativeIntegerSchema.optional(),
    min_video_total_duration: nonnegativeNumberSchema.optional(),
    min_video_width: nonnegativeNumberSchema.optional(),
    model_descriptions: z
      .record(identifierSchema, descriptionSchema)
      .refine((descriptions) => Object.keys(descriptions).length <= 200)
      .optional(),
    models: z
      .record(
        z.string().min(1).max(160),
        z.record(identifierSchema, z.string().min(1).max(500))
      )
      .optional(),
    prohibited_codecs: z.array(z.string().min(1).max(160)).max(200).optional(),
    qualities: z.array(qualityWithDurationsSchema).max(200).optional(),
    quality: z.array(labelledStringOptionSchema).max(200).optional(),
    simple_mode_prompt_length: nonnegativeIntegerSchema.optional(),
    style_prompt_limit: nonnegativeIntegerSchema.optional(),
    title_limit: nonnegativeIntegerSchema.optional(),
    uploadable: z.boolean().optional()
  })
  .strict();

const publicModelEntrySchema = z
  .object({
    active: z.boolean(),
    ai_name: identifierSchema,
    default: z.boolean(),
    description: descriptionSchema,
    features: featureFlagsSchema.nullable(),
    label: z.string().min(1).max(500),
    settings: publicSettingsSchema.nullable(),
    type: z.string().max(160).nullable(),
    value: identifierSchema
  })
  .strict();

export const syntxPublicAiEndpointSchema = z
  .array(publicAiEntrySchema)
  .min(1)
  .max(1_000)
  .superRefine((entries, context) => {
    addDuplicateValueIssues(entries, context);
    addForbiddenKeyIssues(entries, context);
  });

export const syntxPublicModelsEndpointSchema = z
  .array(publicModelEntrySchema)
  .min(1)
  .max(10_000)
  .superRefine((entries, context) => {
    addDuplicateValueIssues(entries, context);
    addForbiddenKeyIssues(entries, context);
  });

const llmCapabilitiesSchema = z
  .object({
    deep_research: z.boolean(),
    files: z.boolean(),
    images: z.boolean(),
    planning: z.boolean(),
    streaming: z.boolean(),
    system_message: z.boolean(),
    thinking: z.boolean(),
    web_explorer: z.boolean()
  })
  .strict();

const publicLlmModelEntrySchema = z
  .object({
    ai_name: identifierSchema,
    available_subscriptions: z.array(identifierSchema).max(100),
    capabilities: llmCapabilitiesSchema,
    context_window: positiveIntegerSchema,
    default_max_tokens: positiveIntegerSchema,
    description: descriptionSchema,
    enabled: z.boolean(),
    free_from_sub: identifierSchema.nullable(),
    icon: z.null(),
    id: identifierSchema,
    is_free: z.boolean(),
    label: z.string().min(1).max(500),
    max_images_count: nonnegativeIntegerSchema,
    min_subscription: identifierSchema.nullable(),
    performance_level: positiveIntegerSchema,
    supported_tools: z.array(identifierSchema).max(500)
  })
  .strict();

export const syntxPublicLlmModelsEndpointSchema = z
  .object({
    count: positiveIntegerSchema,
    models: z.array(publicLlmModelEntrySchema).min(1).max(10_000)
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.count !== payload.models.length) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "LLM count does not match the models array length."
      });
    }
    addDuplicateIdIssues(payload.models, context, ["models"]);
    addForbiddenKeyIssues(payload, context);
  });

const summarySchema = z
  .object({
    ai_active: nonnegativeIntegerSchema,
    ai_inactive: nonnegativeIntegerSchema,
    ai_total: nonnegativeIntegerSchema,
    ai_without_models: nonnegativeIntegerSchema,
    llm_model_disabled: nonnegativeIntegerSchema,
    llm_model_enabled: nonnegativeIntegerSchema,
    llm_model_free: nonnegativeIntegerSchema,
    llm_model_total: nonnegativeIntegerSchema,
    model_active: nonnegativeIntegerSchema,
    model_ai_names_without_ai: nonnegativeIntegerSchema,
    model_defaults: nonnegativeIntegerSchema,
    model_inactive: nonnegativeIntegerSchema,
    model_total: nonnegativeIntegerSchema,
    models_with_features: nonnegativeIntegerSchema,
    models_with_settings: nonnegativeIntegerSchema,
    unique_llm_ai_names: nonnegativeIntegerSchema,
    unique_model_ai_names: nonnegativeIntegerSchema
  })
  .strict();

const snapshotBaseSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    catalog_kind: z.literal("OFFICIAL_PUBLIC_API_SNAPSHOT"),
    runtime_usable: z.literal(false),
    language: z.literal("ru"),
    fetched_at: utcTimestampSchema,
    sources: z
      .object({
        ai: z
          .object({
            url: z.literal(SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai),
            canonical_sha256: sha256Schema
          })
          .strict(),
        llm_models: z
          .object({
            url: z.literal(SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models),
            canonical_sha256: sha256Schema
          })
          .strict(),
        models: z
          .object({
            url: z.literal(SYNTX_PUBLIC_CATALOG_ENDPOINTS.models),
            canonical_sha256: sha256Schema
          })
          .strict()
      })
      .strict(),
    summary: summarySchema,
    ai: syntxPublicAiEndpointSchema,
    llm_models: z.array(publicLlmModelEntrySchema).min(1).max(10_000),
    models: syntxPublicModelsEndpointSchema
  })
  .strict();

export const syntxPublicCatalogSnapshotSchema = snapshotBaseSchema.superRefine(
  (snapshot, context) => {
    const expectedSummary = summarizePublicCatalog(
      snapshot.ai,
      snapshot.models,
      snapshot.llm_models
    );
    if (canonicalJson(snapshot.summary) !== canonicalJson(expectedSummary)) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Summary counts do not match the allowlisted catalog payload."
      });
    }

    const expectedAiHash = sha256CanonicalPayload(snapshot.ai);
    if (snapshot.sources.ai.canonical_sha256 !== expectedAiHash) {
      context.addIssue({
        code: "custom",
        path: ["sources", "ai", "canonical_sha256"],
        message: `AI payload hash mismatch; expected ${expectedAiHash}.`
      });
    }

    const expectedModelsHash = sha256CanonicalPayload(snapshot.models);
    if (snapshot.sources.models.canonical_sha256 !== expectedModelsHash) {
      context.addIssue({
        code: "custom",
        path: ["sources", "models", "canonical_sha256"],
        message: `Models payload hash mismatch; expected ${expectedModelsHash}.`
      });
    }

    const expectedLlmModelsHash = sha256CanonicalPayload({
      count: snapshot.llm_models.length,
      models: snapshot.llm_models
    });
    if (
      snapshot.sources.llm_models.canonical_sha256 !== expectedLlmModelsHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources", "llm_models", "canonical_sha256"],
        message: `LLM models payload hash mismatch; expected ${expectedLlmModelsHash}.`
      });
    }

    addDuplicateIdIssues(snapshot.llm_models, context, ["llm_models"]);

    addForbiddenKeyIssues(snapshot, context);
  }
);

export type SyntxPublicAiEntry = z.infer<typeof publicAiEntrySchema>;
export type SyntxPublicLlmModelEntry = z.infer<
  typeof publicLlmModelEntrySchema
>;
export type SyntxPublicModelEntry = z.infer<typeof publicModelEntrySchema>;
export type SyntxPublicCatalogSnapshot = z.infer<
  typeof snapshotBaseSchema
>;

export interface BuildSyntxPublicCatalogInput {
  aiPayload: unknown;
  llmModelsPayload: unknown;
  modelsPayload: unknown;
  fetchedAt: string;
}

export function buildSyntxPublicCatalogSnapshot(
  input: BuildSyntxPublicCatalogInput
): SyntxPublicCatalogSnapshot {
  const ai = syntxPublicAiEndpointSchema.parse(input.aiPayload);
  const llmModelsPayload = syntxPublicLlmModelsEndpointSchema.parse(
    input.llmModelsPayload
  );
  const llmModels = llmModelsPayload.models;
  const models = syntxPublicModelsEndpointSchema.parse(input.modelsPayload);

  const candidate = {
    schema_version: "1.0.0",
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
    runtime_usable: false,
    language: "ru",
    fetched_at: input.fetchedAt,
    sources: {
      ai: {
        url: SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai,
        canonical_sha256: sha256CanonicalPayload(ai)
      },
      llm_models: {
        url: SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models,
        canonical_sha256: sha256CanonicalPayload(llmModelsPayload)
      },
      models: {
        url: SYNTX_PUBLIC_CATALOG_ENDPOINTS.models,
        canonical_sha256: sha256CanonicalPayload(models)
      }
    },
    summary: summarizePublicCatalog(ai, models, llmModels),
    ai,
    llm_models: llmModels,
    models
  } as const;

  return syntxPublicCatalogSnapshotSchema.parse(candidate);
}

export function summarizePublicCatalog(
  ai: readonly SyntxPublicAiEntry[],
  models: readonly SyntxPublicModelEntry[],
  llmModels: readonly SyntxPublicLlmModelEntry[]
) {
  const aiValues = new Set(ai.map((entry) => entry.value));
  const modelAiNames = new Set(models.map((entry) => entry.ai_name));
  const llmAiNames = new Set(llmModels.map((entry) => entry.ai_name));

  return {
    ai_active: ai.filter((entry) => entry.active).length,
    ai_inactive: ai.filter((entry) => !entry.active).length,
    ai_total: ai.length,
    ai_without_models: ai.filter((entry) => !modelAiNames.has(entry.value)).length,
    llm_model_disabled: llmModels.filter((entry) => !entry.enabled).length,
    llm_model_enabled: llmModels.filter((entry) => entry.enabled).length,
    llm_model_free: llmModels.filter((entry) => entry.is_free).length,
    llm_model_total: llmModels.length,
    model_active: models.filter((entry) => entry.active).length,
    model_ai_names_without_ai: [...modelAiNames].filter(
      (aiName) => !aiValues.has(aiName)
    ).length,
    model_defaults: models.filter((entry) => entry.default).length,
    model_inactive: models.filter((entry) => !entry.active).length,
    model_total: models.length,
    models_with_features: models.filter((entry) => entry.features !== null).length,
    models_with_settings: models.filter((entry) => entry.settings !== null).length,
    unique_llm_ai_names: llmAiNames.size,
    unique_model_ai_names: modelAiNames.size
  };
}

export function loadSyntxPublicCatalogSnapshot(
  path?: string
): SyntxPublicCatalogSnapshot {
  const snapshotPath = path ?? findDefaultSnapshotPath();
  const raw: unknown = JSON.parse(readFileSync(snapshotPath, "utf8"));
  return syntxPublicCatalogSnapshotSchema.parse(raw);
}

export function serializeSyntxPublicCatalogSnapshot(
  snapshot: SyntxPublicCatalogSnapshot
): string {
  const validated = syntxPublicCatalogSnapshotSchema.parse(snapshot);
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function sha256CanonicalPayload(value: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `sha256:${digest}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

export function findForbiddenPublicCatalogKeyPaths(
  value: unknown,
  path = "$"
): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findForbiddenPublicCatalogKeyPaths(entry, `${path}[${index}]`)
    );
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      const nestedPath = `${path}.${key}`;
      const ownFinding = isForbiddenPublicCatalogKey(key) ? [nestedPath] : [];
      return [
        ...ownFinding,
        ...findForbiddenPublicCatalogKeyPaths(nested, nestedPath)
      ];
    }
  );
}

const FORBIDDEN_PUBLIC_CATALOG_KEYS = new Set([
  "api_key",
  "authorization",
  "authorization_header",
  "auth_header",
  "bearer",
  "chat_id",
  "client_ip",
  "credential",
  "credentials",
  "email",
  "ip",
  "ip_address",
  "otp",
  "passcode",
  "password",
  "phone",
  "phone_number",
  "private_key",
  "secret_key",
  "telegram_id",
  "telegram_session",
  "token",
  "tokens",
  "user",
  "user_data",
  "user_id"
]);

const FORBIDDEN_PUBLIC_CATALOG_KEY_PATTERNS = [
  /(?:^|_)(?:access|refresh|id|api|auth|bearer)_tokens?(?:_|$)/u,
  /(?:^|_)(?:api|private|secret|signing|encryption)_keys?(?:_|$)/u,
  /(?:^|_)(?:auth|authorization)_headers?(?:_|$)/u,
  /(?:^|_)client_ip(?:_|$)/u,
  /(?:^|_)(?:set_)?cookies?(?:_|$)/u,
  /(?:^|_)credentials?(?:_|$)/u,
  /(?:^|_)passwords?(?:_|$)/u,
  /(?:^|_)secrets?(?:_|$)/u,
  /(?:^|_)sessions?(?:_|$)/u,
  /(?:^|_)user_(?:data|id)(?:_|$)/u
] as const;

function isForbiddenPublicCatalogKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/gu, "_")
    .toLowerCase()
    .replace(/^_+|_+$/gu, "");

  if (FORBIDDEN_PUBLIC_CATALOG_KEYS.has(normalized)) {
    return true;
  }

  return FORBIDDEN_PUBLIC_CATALOG_KEY_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

function addDuplicateValueIssues<T extends { value: string }>(
  entries: readonly T[],
  context: z.RefinementCtx
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.value)) {
      context.addIssue({
        code: "custom",
        path: [index, "value"],
        message: `Duplicate public catalog value ${entry.value}.`
      });
    }
    seen.add(entry.value);
  }
}

function addDuplicateIdIssues<T extends { id: string }>(
  entries: readonly T[],
  context: z.RefinementCtx,
  pathPrefix: PropertyKey[]
): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry.id)) {
      context.addIssue({
        code: "custom",
        path: [...pathPrefix, index, "id"],
        message: `Duplicate public LLM model id ${entry.id}.`
      });
    }
    seen.add(entry.id);
  }
}

function addForbiddenKeyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const forbiddenPath of findForbiddenPublicCatalogKeyPaths(value)) {
    context.addIssue({
      code: "custom",
      message: `Forbidden sensitive key at ${forbiddenPath}.`
    });
  }
}

function findDefaultSnapshotPath(): string {
  const candidates = [
    fileURLToPath(
      new URL("../../catalog/v1/official-public-api.json", import.meta.url)
    ),
    fileURLToPath(
      new URL("../../../catalog/v1/official-public-api.json", import.meta.url)
    )
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Official public API catalog snapshot was not found.");
  }
  return found;
}
