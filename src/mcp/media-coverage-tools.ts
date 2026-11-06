import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { MediaCoverageCatalog, MEDIA_COVERAGE_VERSION } from "../catalog/media-coverage.js";
import { DISCOVERY_OPERATION_IDS } from "../catalog/discovery-catalog.js";
import { RUNTIME_CONTRACT_EVIDENCE } from "../catalog/runtime-capability-catalog.js";
import { syntxPublicModelsEndpointSchema } from "../catalog/syntx-public-catalog.js";
import { MODALITIES } from "../domain/types.js";

export const SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME = "syntx_get_media_coverage" as const;

const mediaCoverageOutputSchema = z.object({
  schema_version: z.literal("1.0.0"), coverage_version: z.literal(MEDIA_COVERAGE_VERSION),
  catalog_kind: z.literal("OFFICIAL_PUBLIC_API_SNAPSHOT"), runtime_usable: z.literal(false),
  source_hashes: z.object({ ai: z.string().min(1), llm_models: z.string().min(1), models: z.string().min(1) }).strict(),
  total: z.number().int().nonnegative(), offset: z.number().int().min(0).max(10_000), limit: z.number().int().min(1).max(100),
  next_offset: z.number().int().nonnegative().nullable(), census: z.record(z.string(), z.number().int().nonnegative()),
  interpretation_notes: z.array(z.string()),
  items: z.array(z.object({
    model_id: z.string().min(1), ai_name: z.string().min(1), display_name: z.string().min(1), active: z.boolean(),
    modalities: z.array(z.enum(MODALITIES)),
    operations: z.array(z.object({ id: z.enum(DISCOVERY_OPERATION_IDS), display_name: z.string().min(1),
      output_modality: z.enum(MODALITIES), derivation: z.literal("PUBLIC_AI_SCOPE") }).strict()),
    operation_role: z.enum(["SELECTOR", "MODEL_OPERATION"]),
    settings: syntxPublicModelsEndpointSchema.element.shape.settings,
    settings_status: z.enum(["LIMITED_RUNTIME_TUPLE_ONLY", "MIXED_LIMITED_AND_NATIVE", "NATIVE_PARAMETER_ROUTE_PRESENT",
      "NATIVE_GENERATION_ROUTE_SETTINGS_UNCLASSIFIED", "PUBLIC_METADATA_ONLY", "SOURCE_ONLY", "UNKNOWN"]),
    runtime_status: z.enum(["CODE_MAPPED", "SOURCE_ONLY", "UNKNOWN"]),
    result_status: z.enum(["HISTORICAL_RESULT", "NO_RESULT_EVIDENCE", "UNKNOWN"]),
    provider_case_status: z.enum(["HISTORICAL_CASE", "NOT_PROVEN", "UNKNOWN"]),
    historical_evidence: z.enum([...RUNTIME_CONTRACT_EVIDENCE, "NONE"]),
    mcp_tool_names: z.array(z.string()), mcp_tool_groups: z.array(z.string()), operator_flags: z.array(z.string()).nullable(),
    notes: z.array(z.string())
  }).strict()).max(100)
}).strict();

export function registerSyntxMediaCoverageTools(server: McpServer, catalog: MediaCoverageCatalog): void {
  server.registerTool(SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME, {
    title: "Get current media coverage",
    description: "Read the immutable current public non-text media census with pagination, inactive and unknown rows, operations/settings, mapped tool groups, operator flags, and separate code/result evidence status. Local read only; no auth, network, dispatch, or paid work.",
    inputSchema: z.object({
      offset: z.number().int().min(0).max(10_000).default(0),
      limit: z.number().int().min(1).max(100).default(50),
      include_inactive: z.boolean().default(false)
    }).strict(),
    outputSchema: mediaCoverageOutputSchema,
    annotations: { title: "Get current media coverage", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } satisfies ToolAnnotations
  }, async ({ offset, limit, include_inactive }): Promise<CallToolResult> => {
    const output = mediaCoverageOutputSchema.parse(catalog.page({ offset, limit, include_inactive }));
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
  });
}
