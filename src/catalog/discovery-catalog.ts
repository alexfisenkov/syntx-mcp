import { TextDecoder } from "node:util";
import { z } from "zod/v4";
import type { Modality } from "../domain/types.js";
import { ApplicationError } from "../errors.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema
} from "./syntx-public-catalog.js";
import type {
  SyntxPublicCatalogSnapshot,
  SyntxPublicLlmModelEntry,
  SyntxPublicModelEntry
} from "./syntx-public-catalog.js";

export const DISCOVERY_OPERATION_IDS = [
  "generate-text",
  "generate-image",
  "generate-video",
  "generate-audio",
  "inpaint-image",
  "upscale-image",
  "inpaint-video",
  "upscale-video"
] as const;

export type DiscoveryOperationId = (typeof DISCOVERY_OPERATION_IDS)[number];

export interface DiscoveryOperation {
  id: DiscoveryOperationId;
  display_name: string;
  output_modality: Modality;
  derivation: "PUBLIC_AI_SCOPE";
}

export interface DiscoverySourceHashes {
  readonly ai: string;
  readonly llm_models: string;
  readonly models: string;
}

export interface DiscoveryCatalogMetadata {
  fetched_at: string;
  source_hashes: DiscoverySourceHashes;
  sources: SyntxPublicCatalogSnapshot["sources"];
  summary: SyntxPublicCatalogSnapshot["summary"];
  public_settings_coverage: "ALLOWLISTED_PUBLIC_API_FIELDS";
}

export interface DiscoveryModelRecord {
  id: string;
  upstream_id: string;
  ai_name: string;
  display_name: string;
  description: string | null;
  active: boolean;
  default: boolean;
  type: string | null;
  scope: string | null;
  modalities: Modality[];
  operations: DiscoveryOperation[];
  features: SyntxPublicModelEntry["features"];
  settings: SyntxPublicModelEntry["settings"];
  llm_enrichment: SyntxPublicLlmModelEntry | null;
  catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT";
  runtime_usable: false;
  fetched_at: string;
  source_hashes: DiscoverySourceHashes;
}

export interface DiscoverySearchItem {
  id: string;
  ai_name: string;
  display_name: string;
  active: boolean;
  default: boolean;
  type: string | null;
  scope: string | null;
  modalities: Modality[];
  operations: DiscoveryOperation[];
}

export interface DiscoverySearchInput {
  query?: string | undefined;
  modality?: Modality | undefined;
  operation?: DiscoveryOperationId | undefined;
  include_inactive?: boolean | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface DiscoverySearchResult {
  catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT";
  runtime_usable: false;
  catalog_metadata: DiscoveryCatalogMetadata;
  total: number;
  items: DiscoverySearchItem[];
  next_cursor: string | null;
}

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 1_024;
const MAX_CURSOR_OFFSET = 10_000;

const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200).optional(),
    modality: z.enum(["text", "image", "video", "audio"]).optional(),
    operation: z.enum(DISCOVERY_OPERATION_IDS).optional(),
    include_inactive: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z
      .string()
      .min(1)
      .max(MAX_CURSOR_LENGTH)
      .regex(/^[A-Za-z0-9_-]+$/u)
      .optional()
  })
  .strict();

const cursorPayloadSchema = z
  .object({
    version: z.literal(CURSOR_VERSION),
    offset: z.number().int().positive().max(MAX_CURSOR_OFFSET),
    binding: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  })
  .strict();

interface NormalizedFilters {
  query: string | null;
  modality: Modality | null;
  operation: DiscoveryOperationId | null;
  include_inactive: boolean;
  limit: number;
}

interface CursorPayload {
  version: typeof CURSOR_VERSION;
  offset: number;
  binding: string;
}

const SCOPE_PROFILES: Readonly<
  Record<
    string,
    {
      operation: DiscoveryOperationId;
      displayName: string;
      modality: Modality;
    }
  >
> = {
  text: {
    operation: "generate-text",
    displayName: "Generate text",
    modality: "text"
  },
  image: {
    operation: "generate-image",
    displayName: "Generate image",
    modality: "image"
  },
  video: {
    operation: "generate-video",
    displayName: "Generate video",
    modality: "video"
  },
  audio: {
    operation: "generate-audio",
    displayName: "Generate audio",
    modality: "audio"
  },
  tool_image_inpaint: {
    operation: "inpaint-image",
    displayName: "Inpaint image",
    modality: "image"
  },
  tool_image_upscaler: {
    operation: "upscale-image",
    displayName: "Upscale image",
    modality: "image"
  },
  tool_video_inpaint: {
    operation: "inpaint-video",
    displayName: "Inpaint video",
    modality: "video"
  },
  tool_video_upscaler: {
    operation: "upscale-video",
    displayName: "Upscale video",
    modality: "video"
  }
};

export class DiscoveryCatalogRepository {
  readonly catalog_kind = "OFFICIAL_PUBLIC_API_SNAPSHOT" as const;
  readonly runtime_usable = false as const;
  readonly fetched_at: string;
  readonly source_hashes: DiscoverySourceHashes;
  readonly catalog_metadata: DiscoveryCatalogMetadata;

  readonly #records: DiscoveryModelRecord[];
  readonly #recordsById: Map<string, DiscoveryModelRecord>;

  constructor(
    snapshot: SyntxPublicCatalogSnapshot = loadSyntxPublicCatalogSnapshot()
  ) {
    const validated = syntxPublicCatalogSnapshotSchema.parse(snapshot);
    this.fetched_at = validated.fetched_at;
    this.source_hashes = Object.freeze(sourceHashesFromSnapshot(validated));
    this.catalog_metadata = {
      fetched_at: validated.fetched_at,
      source_hashes: this.source_hashes,
      sources: structuredClone(validated.sources),
      summary: structuredClone(validated.summary),
      public_settings_coverage: "ALLOWLISTED_PUBLIC_API_FIELDS"
    };

    const aiByName = new Map(
      validated.ai.map((entry) => [entry.value, entry] as const)
    );
    const publicModelIds = new Set(validated.models.map((entry) => entry.value));
    const llmById = new Map(
      validated.llm_models.map((entry) => [entry.id, entry] as const)
    );

    this.#records = validated.models
      .map((model) => {
        const ai = aiByName.get(model.ai_name);
        const operations = operationsFromScope(ai?.scope);
        const llmCandidate = llmById.get(model.value);
        const llmEnrichment =
          llmCandidate?.ai_name === model.ai_name ? llmCandidate : null;

        return {
          id: model.value,
          upstream_id: model.value,
          ai_name: model.ai_name,
          display_name: model.label,
          description: model.description,
          active: model.active,
          default: model.default,
          type: model.type,
          scope: ai?.scope ?? null,
          modalities: operations.map((operation) => operation.output_modality),
          operations,
          features: structuredClone(model.features),
          settings: structuredClone(model.settings),
          llm_enrichment:
            llmEnrichment === null ? null : structuredClone(llmEnrichment),
          catalog_kind: this.catalog_kind,
          runtime_usable: this.runtime_usable,
          fetched_at: this.fetched_at,
          source_hashes: { ...this.source_hashes }
        } satisfies DiscoveryModelRecord;
      })
      .concat(
        validated.llm_models
          .filter((llmModel) => !publicModelIds.has(llmModel.id))
          .map((llmModel) => {
            const ai = aiByName.get(llmModel.ai_name);
            const operations = operationsFromScope(ai?.scope);
            return {
              id: llmModel.id,
              upstream_id: llmModel.id,
              ai_name: llmModel.ai_name,
              display_name: llmModel.label,
              description: llmModel.description,
              active: llmModel.enabled && ai?.active === true,
              default: false,
              type: null,
              scope: ai?.scope ?? null,
              modalities: operations.map((operation) => operation.output_modality),
              operations,
              features: null,
              settings: null,
              llm_enrichment: structuredClone(llmModel),
              catalog_kind: this.catalog_kind,
              runtime_usable: this.runtime_usable,
              fetched_at: this.fetched_at,
              source_hashes: { ...this.source_hashes }
            } satisfies DiscoveryModelRecord;
          })
      )
      .sort((left, right) => compareCodeUnits(left.id, right.id));

    this.#recordsById = new Map(
      this.#records.map((record) => [record.id, record] as const)
    );
  }

  search(input: DiscoverySearchInput = {}): DiscoverySearchResult {
    const parsed = parseSearchInput(input);
    const filters = normalizeFilters(parsed);
    const matches = this.#records.filter((record) =>
      recordMatches(record, filters)
    );
    const offset = parsed.cursor
      ? decodeCursor(
          parsed.cursor,
          matches.length,
          filters,
          this.source_hashes
        )
      : 0;
    const nextOffset = Math.min(offset + filters.limit, matches.length);
    const page = matches.slice(offset, nextOffset);
    const nextCursor =
      nextOffset < matches.length
        ? encodeCursor(nextOffset, filters, this.source_hashes)
        : null;

    return {
      catalog_kind: this.catalog_kind,
      runtime_usable: this.runtime_usable,
      catalog_metadata: structuredClone(this.catalog_metadata),
      total: matches.length,
      items: page.map(toSearchItem),
      next_cursor: nextCursor
    };
  }

  get(modelId: string): DiscoveryModelRecord {
    const record = this.#recordsById.get(modelId);
    if (!record) {
      throw new ApplicationError(
        "MODEL_NOT_FOUND",
        "The requested public catalog model was not found."
      );
    }
    return structuredClone(record);
  }

  getModel(modelId: string): DiscoveryModelRecord {
    return this.get(modelId);
  }
}

function operationsFromScope(scope: string | undefined): DiscoveryOperation[] {
  if (scope === undefined) {
    return [];
  }
  const profile = SCOPE_PROFILES[scope];
  if (!profile) {
    return [];
  }
  return [
    {
      id: profile.operation,
      display_name: profile.displayName,
      output_modality: profile.modality,
      derivation: "PUBLIC_AI_SCOPE"
    }
  ];
}

function parseSearchInput(input: DiscoverySearchInput) {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidSearchError();
  }
  return parsed.data;
}

function normalizeFilters(
  input: z.infer<typeof searchInputSchema>
): NormalizedFilters {
  return {
    query: input.query ? normalizeSearchText(input.query) : null,
    modality: input.modality ?? null,
    operation: input.operation ?? null,
    include_inactive: input.include_inactive,
    limit: input.limit
  };
}

function recordMatches(
  record: DiscoveryModelRecord,
  filters: NormalizedFilters
): boolean {
  if (!filters.include_inactive && !record.active) {
    return false;
  }
  if (
    filters.modality !== null &&
    !record.modalities.includes(filters.modality)
  ) {
    return false;
  }
  if (
    filters.operation !== null &&
    !record.operations.some((operation) => operation.id === filters.operation)
  ) {
    return false;
  }
  if (filters.query !== null) {
    const terms = filters.query.split(/\s+/u);
    const haystack = normalizeSearchText(
      [
        record.id,
        record.upstream_id,
        record.ai_name,
        record.display_name,
        record.description ?? "",
        record.type ?? "",
        record.scope ?? "",
        ...record.operations.flatMap((operation) => [
          operation.id,
          operation.display_name
        ]),
        record.llm_enrichment?.label ?? "",
        record.llm_enrichment?.description ?? ""
      ].join(" ")
    );
    if (!terms.every((term) => haystack.includes(term))) {
      return false;
    }
  }
  return true;
}

function toSearchItem(record: DiscoveryModelRecord): DiscoverySearchItem {
  return {
    id: record.id,
    ai_name: record.ai_name,
    display_name: record.display_name,
    active: record.active,
    default: record.default,
    type: record.type,
    scope: record.scope,
    modalities: [...record.modalities],
    operations: structuredClone(record.operations)
  };
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").trim();
}

function encodeCursor(
  offset: number,
  filters: NormalizedFilters,
  sourceHashes: DiscoverySourceHashes
): string {
  const payload: CursorPayload = {
    version: CURSOR_VERSION,
    offset,
    binding: cursorBinding(offset, filters, sourceHashes)
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(
  encoded: string,
  total: number,
  filters: NormalizedFilters,
  sourceHashes: DiscoverySourceHashes
): number {
  let decoded: string;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.toString("base64url") !== encoded) {
      throw invalidSearchError();
    }
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidSearchError();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(decoded);
  } catch {
    throw invalidSearchError();
  }
  const parsed = cursorPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidSearchError();
  }
  if (parsed.data.offset >= total) {
    throw invalidSearchError();
  }
  const expectedBinding = cursorBinding(
    parsed.data.offset,
    filters,
    sourceHashes
  );
  if (parsed.data.binding !== expectedBinding) {
    throw invalidSearchError();
  }
  return parsed.data.offset;
}

function cursorBinding(
  offset: number,
  filters: NormalizedFilters,
  sourceHashes: DiscoverySourceHashes
): string {
  return sha256CanonicalPayload({
    cursor_version: CURSOR_VERSION,
    offset,
    source_hashes: sourceHashes,
    filters
  });
}

function sourceHashesFromSnapshot(
  snapshot: SyntxPublicCatalogSnapshot
): DiscoverySourceHashes {
  return {
    ai: snapshot.sources.ai.canonical_sha256,
    llm_models: snapshot.sources.llm_models.canonical_sha256,
    models: snapshot.sources.models.canonical_sha256
  };
}

function invalidSearchError(): ApplicationError {
  return new ApplicationError(
    "INVALID_PARAMETERS",
    "The discovery catalog search input or cursor is invalid."
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
