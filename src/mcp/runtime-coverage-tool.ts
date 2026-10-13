import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { ApplicationError } from "../errors.js";
import {
  RUNTIME_COVERAGE_CATALOG_ONLY,
  RUNTIME_COVERAGE_PROFILES,
  RUNTIME_COVERAGE_VERSION
} from "../catalog/runtime-coverage-registry.js";

export const SYNTX_RUNTIME_COVERAGE_TOOL_NAME = "syntx_get_runtime_coverage" as const;

const VERIFICATION_SCOPE = "HISTORICAL_OWNER_GENERATION_AND_TERMINAL_RESULT" as const;
const VERIFICATION_NOTE = "Historical owner-generation evidence does not establish current catalog availability, account entitlement, or current runtime behavior.";

export type RuntimeCoverageCurrentCatalogStatus =
  | "AVAILABLE_IN_SNAPSHOT"
  | "INACTIVE"
  | "NOT_IN_CATALOG"
  | "NOT_CHECKED";

export interface RuntimeCoverageCurrentModelResult {
  readonly catalog_kind: string;
  readonly model: { readonly id: string; readonly active?: boolean | undefined };
}

export interface RegisterSyntxRuntimeCoverageToolOptions {
  /** Synchronous local read from the selected public snapshot; never performs network I/O. */
  resolveCurrentModel?: ((modelId: string) => RuntimeCoverageCurrentModelResult) | undefined;
}

const profileSchema = z
  .object({
    model_id: z.string().min(1),
    ai_name: z.string().min(1),
    modality: z.enum(["image", "video"]),
    settings: z.record(z.string(), z.unknown()),
    settings_variants: z.array(z.object({
      id: z.enum(["sunburst-2k-high-16x9", "sunburst-4k-max-21x9", "flare-2k-high-16x9"]),
      settings: z.record(z.string(), z.unknown()),
      runtime_verified: z.literal(true)
    }).strict()).optional(),
    one_copy_only: z.literal(true),
    opt_in_flag: z.enum(["SYNTX_OWNER_GENERATE_IMAGE", "SYNTX_OWNER_GENERATE_VIDEO"]),
    result_mime_types: z.array(z.string().min(1)).min(1),
    cancel_mode: z.enum(["OPEN"]),
    output_schema: z
      .object({
        type: z.literal("object"),
        artifact_field: z.enum(["images", "videos"]),
        required_fields: z.tuple([
          z.enum(["images", "videos"]),
          z.literal("requested_copies"),
          z.literal("succeeded_copies"),
          z.literal("notes")
        ]),
        artifact_mime_types: z.array(z.string().min(1)).min(1),
        additional_properties: z.literal(false)
      })
      .strict(),
    runtime_verified: z.literal(true),
    verification_scope: z.literal(VERIFICATION_SCOPE),
    verification_notes: z.array(z.string().min(1)).min(1),
    current_catalog_status: z.enum([
      "AVAILABLE_IN_SNAPSHOT", "INACTIVE", "NOT_IN_CATALOG", "NOT_CHECKED"
    ]),
    catalog_only: z.literal(false),
    unsupported_notes: z.array(z.string().min(1)).min(1)
  })
  .strict();

export const runtimeCoverageOutputSchema = z
  .object({
    schema_version: z.literal("2.0.0"),
    coverage_version: z.string().min(1),
    runtime_scope: z.literal("owner"),
    network_access: z.literal(false),
    paid_operations: z.literal(false),
    profiles: z.array(profileSchema).min(1),
    catalog_only: z
      .object({
        model_ids: z.array(z.string().min(1)).min(1),
        notes: z.array(z.string().min(1)).min(1)
      })
      .strict()
  })
  .strict();

export type RuntimeCoverageOutput = z.infer<typeof runtimeCoverageOutputSchema>;

function buildRuntimeCoverageOutput(
  resolveCurrentModel?: ((modelId: string) => RuntimeCoverageCurrentModelResult) | undefined
): RuntimeCoverageOutput {
  return runtimeCoverageOutputSchema.parse({
    schema_version: "2.0.0",
    coverage_version: RUNTIME_COVERAGE_VERSION,
    runtime_scope: "owner",
    network_access: false,
    paid_operations: false,
    profiles: RUNTIME_COVERAGE_PROFILES.map((profile) => ({
      model_id: profile.model_id,
      ai_name: profile.ai_name,
      modality: profile.modality,
      settings: { ...profile.settings },
      ...(profile.settings_variants === undefined ? {} : {
        settings_variants: profile.settings_variants.map((variant) => ({
          id: variant.id,
          settings: { ...variant.settings },
          runtime_verified: true as const
        }))
      }),
      one_copy_only: true,
      opt_in_flag: profile.opt_in_flag,
      result_mime_types: [...profile.result_mime_types],
      cancel_mode: profile.cancel_mode,
      output_schema: {
        type: profile.output_schema.type,
        artifact_field: profile.output_schema.artifact_field,
        required_fields: [...profile.output_schema.required_fields] as [
          "images" | "videos",
          "requested_copies",
          "succeeded_copies",
          "notes"
        ],
        artifact_mime_types: [...profile.output_schema.artifact_mime_types],
        additional_properties: false
      },
      runtime_verified: true,
      verification_scope: VERIFICATION_SCOPE,
      verification_notes: [VERIFICATION_NOTE],
      current_catalog_status: currentCatalogStatus(profile.model_id, resolveCurrentModel),
      catalog_only: false,
      unsupported_notes: [...profile.unsupported_notes]
    })),
    catalog_only: {
      model_ids: [...RUNTIME_COVERAGE_CATALOG_ONLY.model_ids],
      notes: [...RUNTIME_COVERAGE_CATALOG_ONLY.notes]
    }
  });
}

export function registerSyntxRuntimeCoverageTool(
  server: McpServer,
  options: RegisterSyntxRuntimeCoverageToolOptions = {}
): void {
  server.registerTool(
    SYNTX_RUNTIME_COVERAGE_TOOL_NAME,
    {
      title: "Get owner generation evidence",
      description:
        "Return a redacted historical list of owner image/video profiles with terminal-result observations, plus their status in the currently selected public catalog when available. Historical verification is not current availability, account entitlement, or current runtime behavior. This read-only local lookup performs no authentication, network access, chat mutation, or paid operation.",
      inputSchema: z.object({}).strict(),
      outputSchema: runtimeCoverageOutputSchema,
      annotations: runtimeCoverageAnnotations()
    },
    async (): Promise<CallToolResult> => {
      const output = buildRuntimeCoverageOutput(options.resolveCurrentModel);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        structuredContent: output as unknown as Record<string, unknown>
      };
    }
  );
}

function currentCatalogStatus(
  modelId: string,
  resolveCurrentModel?: ((modelId: string) => RuntimeCoverageCurrentModelResult) | undefined
): RuntimeCoverageCurrentCatalogStatus {
  if (!resolveCurrentModel) return "NOT_CHECKED";
  try {
    const result = resolveCurrentModel(modelId);
    if (
      result.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" ||
      result.model.id !== modelId
    ) return "NOT_CHECKED";
    if (result.model.active === true) return "AVAILABLE_IN_SNAPSHOT";
    if (result.model.active === false) return "INACTIVE";
    return "NOT_CHECKED";
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "MODEL_NOT_FOUND") return "NOT_IN_CATALOG";
    return "NOT_CHECKED";
  }
}

function runtimeCoverageAnnotations(): ToolAnnotations {
  return {
    title: "Get owner generation evidence",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  };
}
