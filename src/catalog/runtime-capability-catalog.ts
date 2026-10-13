import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { ApplicationError } from "../errors.js";
import {
  DiscoveryCatalogRepository,
  type DiscoveryModelRecord,
  type DiscoveryOperationId
} from "./discovery-catalog.js";
import { sha256CanonicalPayload } from "./syntx-public-catalog.js";

export const RUNTIME_CONTRACT_EVIDENCE = [
  "OPEN",
  "PUBLIC_CONSTRAINTS",
  "STATIC_CLIENT",
  "LIVE_OWNER"
] as const;

export type RuntimeContractEvidence =
  (typeof RUNTIME_CONTRACT_EVIDENCE)[number];

export type SyntxRouteProfile = "llm" | "design" | "video" | "audio";

export type RuntimeCancelMode =
  | "OPEN"
  | "STATIC_TEXT_ONLY"
  | "UNSUPPORTED"
  | "LIVE_VERIFIED";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const requestSchemaSchema = z
  .object({
    $schema: z.literal("https://json-schema.org/draft/2020-12/schema"),
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(z.string().min(1).max(160), z.unknown()),
    required: z.array(z.string().min(1).max(160)).max(256)
  })
  .strict()
  .superRefine((schema, context) => {
    const seen = new Set<string>();
    for (const [index, requiredProperty] of schema.required.entries()) {
      if (seen.has(requiredProperty)) {
        context.addIssue({
          code: "custom",
          path: ["required", index],
          message: "Required property names must be unique."
        });
      }
      seen.add(requiredProperty);
      if (
        !Object.prototype.hasOwnProperty.call(
          schema.properties,
          requiredProperty
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["required", index],
          message: "Every required property must be declared in properties."
        });
      }
    }
  });

const sourceArtifactSchema = z
  .object({
    url: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.hostname === "syntx.ai" &&
        url.port === "" &&
        /^\/assets\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.js$/u.test(
          url.pathname
        ) &&
        url.username === "" &&
        url.password === "" &&
        url.search === "" &&
        url.hash === "" &&
        url.href === value
      );
    }),
    sha256: sha256Schema
  })
  .strict();

const overlayEntrySchema = z
  .object({
    model_id: z.string().min(1).max(160),
    ai_name: z.string().min(1).max(160),
    operation_id: z.enum([
      "generate-text",
      "generate-image",
      "generate-video",
      "generate-audio",
      "inpaint-image",
      "upscale-image",
      "inpaint-video",
      "upscale-video"
    ]),
    modality: z.enum(["text", "image", "video", "audio"]),
    route_profile: z.enum(["llm", "design", "video", "audio"]),
    evidence: z.enum(RUNTIME_CONTRACT_EVIDENCE),
    runtime_usable: z.literal(false),
    cost_parameter_names: z
      .array(z.string().regex(/^[A-Za-z][A-Za-z0-9._-]{0,63}$/u))
      .max(64),
    source_artifact_urls: z.array(z.url()).min(1).max(32),
    request_schema: requestSchemaSchema,
    schema_hash: sha256Schema,
    create_status: z.enum(RUNTIME_CONTRACT_EVIDENCE),
    status_status: z.enum(RUNTIME_CONTRACT_EVIDENCE),
    result_status: z.enum(RUNTIME_CONTRACT_EVIDENCE),
    cancel_mode: z.enum([
      "OPEN",
      "STATIC_TEXT_ONLY",
      "UNSUPPORTED",
      "LIVE_VERIFIED"
    ]),
    notes: z.array(z.string().min(1).max(1_000)).max(32)
  })
  .strict();

export const runtimeCapabilityOverlaySchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    catalog_version: z.string().min(1).max(200),
    source_build: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.hostname === "syntx.ai" &&
          /^\/assets\/[A-Za-z0-9._-]+\/$/u.test(url.pathname) &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === "" &&
          url.href === value
        );
      }),
    public_catalog_source_hashes: z
      .object({
        ai: sha256Schema,
        llm_models: sha256Schema,
        models: sha256Schema
      })
      .strict(),
    source_artifacts: z.array(sourceArtifactSchema).min(1).max(1_000),
    checked_at: z.iso.datetime(),
    entries: z.array(overlayEntrySchema).max(10_000)
  })
  .strict()
  .superRefine((catalog, context) => {
    const sourceBuild = new URL(catalog.source_build);
    const artifactsByUrl = new Map<string, string>();
    const artifactHashes = new Set<string>();
    for (const [index, artifact] of catalog.source_artifacts.entries()) {
      const artifactUrl = new URL(artifact.url);
      const relativePath = artifactUrl.pathname.slice(
        sourceBuild.pathname.length
      );
      if (
        artifactUrl.origin !== sourceBuild.origin ||
        !artifactUrl.pathname.startsWith(sourceBuild.pathname) ||
        !/^[A-Za-z0-9._-]+\.js$/u.test(relativePath)
      ) {
        context.addIssue({
          code: "custom",
          path: ["source_artifacts", index, "url"],
          message: "Source artifact must be a direct JavaScript child of source_build."
        });
      }
      if (artifactsByUrl.has(artifact.url)) {
        context.addIssue({
          code: "custom",
          path: ["source_artifacts", index, "url"],
          message: "Source artifact URLs must be unique."
        });
      }
      artifactsByUrl.set(artifact.url, artifact.sha256);
      if (artifactHashes.has(artifact.sha256)) {
        context.addIssue({
          code: "custom",
          path: ["source_artifacts", index, "sha256"],
          message: "Source artifact hashes must be unique."
        });
      }
      artifactHashes.add(artifact.sha256);
    }

    const seen = new Set<string>();
    for (const [index, entry] of catalog.entries.entries()) {
      if (seen.has(entry.model_id)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "model_id"],
          message: "Runtime overlay model ids must be unique."
        });
      }
      seen.add(entry.model_id);
      const referencedArtifacts = new Set<string>();
      for (const [urlIndex, artifactUrl] of
        entry.source_artifact_urls.entries()) {
        if (referencedArtifacts.has(artifactUrl)) {
          context.addIssue({
            code: "custom",
            path: ["entries", index, "source_artifact_urls", urlIndex],
            message: "Source artifact references must be unique per entry."
          });
        }
        referencedArtifacts.add(artifactUrl);
        if (!artifactsByUrl.has(artifactUrl)) {
          context.addIssue({
            code: "custom",
            path: ["entries", index, "source_artifact_urls", urlIndex],
            message: "Runtime overlay references an unknown source artifact."
          });
        }
      }
      if (sha256CanonicalPayload(entry.request_schema) !== entry.schema_hash) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "schema_hash"],
          message: "Runtime overlay request schema hash does not match."
        });
      }
    }
  });

export type RuntimeCapabilityOverlay = z.infer<
  typeof runtimeCapabilityOverlaySchema
>;

export interface RuntimeCapabilityRecord {
  model_id: string;
  ai_name: string;
  display_name: string;
  active: boolean;
  operation_id: DiscoveryOperationId | null;
  modality: "text" | "image" | "video" | "audio" | null;
  route_profile: SyntxRouteProfile | null;
  contract_status: "PUBLIC_CONSTRAINTS_ONLY" | "OBSERVED_PARTIAL";
  runtime_usable: false;
  public_settings: DiscoveryModelRecord["settings"];
  cost_parameter_names: string[];
  request_schema: z.infer<typeof requestSchemaSchema> | null;
  schema_hash: string | null;
  evidence: RuntimeContractEvidence;
  create_status: RuntimeContractEvidence;
  status_status: RuntimeContractEvidence;
  result_status: RuntimeContractEvidence;
  cancel_mode: RuntimeCancelMode;
  notes: string[];
  catalog_version: string;
  source_build: string;
  checked_at: string;
}

/**
 * Projects every official-public model into an explicit runtime status and
 * overlays only contracts observed in the first-party client. No record is
 * executable until live mutation and cost semantics are independently proven.
 */
export class RuntimeCapabilityCatalog {
  readonly #records: RuntimeCapabilityRecord[];
  readonly #byId: Map<string, RuntimeCapabilityRecord>;

  constructor(
    discovery = new DiscoveryCatalogRepository(),
    overlay: RuntimeCapabilityOverlay = loadRuntimeCapabilityOverlay()
  ) {
    const validated = runtimeCapabilityOverlaySchema.parse(overlay);
    if (
      !sameSourceHashes(
        validated.public_catalog_source_hashes,
        discovery.source_hashes
      )
    ) {
      throw new TypeError(
        "Runtime capability overlay drifted from public catalog source hashes."
      );
    }
    const overlays = new Map(
      validated.entries.map((entry) => [entry.model_id, entry] as const)
    );
    const publicModels = readAllDiscoveryModels(discovery);

    for (const entry of validated.entries) {
      const publicModel = discovery.getModel(entry.model_id);
      const publicOperation = publicModel.operations.find(
        (operation) => operation.id === entry.operation_id
      );
      const publicCostParameters = [...(
        publicModel.settings?.get_cost_params ?? []
      )].sort();
      if (
        publicModel.ai_name !== entry.ai_name ||
        publicOperation?.output_modality !== entry.modality ||
        routeProfileFor(entry.operation_id) !== entry.route_profile ||
        !sameStrings(publicCostParameters, [...entry.cost_parameter_names].sort())
      ) {
        throw new TypeError(
          "Runtime capability overlay drifted from the public catalog."
        );
      }
    }

    this.#records = publicModels.map((model) =>
      projectRuntimeCapability(model, validated, overlays.get(model.id))
    );
    this.#byId = new Map(
      this.#records.map((record) => [record.model_id, record] as const)
    );
  }

  list(): RuntimeCapabilityRecord[] {
    return structuredClone(this.#records);
  }

  get(modelId: string): RuntimeCapabilityRecord {
    const record = this.#byId.get(modelId);
    if (!record) {
      throw new ApplicationError(
        "MODEL_NOT_FOUND",
        "The requested runtime capability was not found."
      );
    }
    return structuredClone(record);
  }
}

export function loadRuntimeCapabilityOverlay(
  path?: string
): RuntimeCapabilityOverlay {
  const overlayPath = path ?? findDefaultOverlayPath();
  const raw: unknown = JSON.parse(readFileSync(overlayPath, "utf8"));
  return runtimeCapabilityOverlaySchema.parse(raw);
}

function projectRuntimeCapability(
  model: DiscoveryModelRecord,
  catalog: RuntimeCapabilityOverlay,
  overlay: RuntimeCapabilityOverlay["entries"][number] | undefined
): RuntimeCapabilityRecord {
  const operation = model.operations[0];
  if (overlay) {
    return {
      model_id: model.id,
      ai_name: model.ai_name,
      display_name: model.display_name,
      active: model.active,
      operation_id: overlay.operation_id,
      modality: overlay.modality,
      route_profile: overlay.route_profile,
      contract_status: "OBSERVED_PARTIAL",
      runtime_usable: false,
      public_settings: structuredClone(model.settings),
      cost_parameter_names: [...overlay.cost_parameter_names],
      request_schema: structuredClone(overlay.request_schema),
      schema_hash: overlay.schema_hash,
      evidence: overlay.evidence,
      create_status: overlay.create_status,
      status_status: overlay.status_status,
      result_status: overlay.result_status,
      cancel_mode: overlay.cancel_mode,
      notes: [...overlay.notes],
      catalog_version: catalog.catalog_version,
      source_build: catalog.source_build,
      checked_at: catalog.checked_at
    };
  }

  return {
    model_id: model.id,
    ai_name: model.ai_name,
    display_name: model.display_name,
    active: model.active,
    operation_id: operation?.id ?? null,
    modality: operation?.output_modality ?? null,
    route_profile: operation ? routeProfileFor(operation.id) : null,
    contract_status: "PUBLIC_CONSTRAINTS_ONLY",
    runtime_usable: false,
    public_settings: structuredClone(model.settings),
    cost_parameter_names: [...(model.settings?.get_cost_params ?? [])],
    request_schema: null,
    schema_hash: null,
    evidence: "PUBLIC_CONSTRAINTS",
    create_status: "OPEN",
    status_status: "OPEN",
    result_status: "OPEN",
    cancel_mode: "OPEN",
    notes: [
      "No model-specific first-party request codec has been recorded yet."
    ],
    catalog_version: catalog.catalog_version,
    source_build: catalog.source_build,
    checked_at: catalog.checked_at
  };
}

function readAllDiscoveryModels(
  discovery: DiscoveryCatalogRepository
): DiscoveryModelRecord[] {
  const records: DiscoveryModelRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = discovery.search({
      include_inactive: true,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor })
    });
    records.push(...page.items.map((item) => discovery.getModel(item.id)));
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  return records;
}

function routeProfileFor(
  operationId: DiscoveryOperationId
): SyntxRouteProfile | null {
  switch (operationId) {
    case "generate-text":
      return "llm";
    case "generate-image":
      return "design";
    case "generate-video":
      return "video";
    case "generate-audio":
      return "audio";
    case "inpaint-image":
    case "upscale-image":
    case "inpaint-video":
    case "upscale-video":
      return null;
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Shared with generation-ai-name-bridge.ts, which pins the same
 * DiscoverySourceHashes shape against a different overlay — exported so a
 * future change to DiscoverySourceHashes only needs one comparison updated,
 * not two silently-diverging copies (critic-risk).
 */
export function sameSourceHashes(
  left: RuntimeCapabilityOverlay["public_catalog_source_hashes"],
  right: DiscoveryCatalogRepository["source_hashes"]
): boolean {
  return (
    left.ai === right.ai &&
    left.llm_models === right.llm_models &&
    left.models === right.models
  );
}

function findDefaultOverlayPath(): string {
  const candidates = [
    fileURLToPath(
      new URL(
        "../../catalog/runtime/v1/observed-codec-overlays.json",
        import.meta.url
      )
    ),
    fileURLToPath(
      new URL(
        "../../../catalog/runtime/v1/observed-codec-overlays.json",
        import.meta.url
      )
    )
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Runtime capability overlay was not found.");
  }
  return found;
}
