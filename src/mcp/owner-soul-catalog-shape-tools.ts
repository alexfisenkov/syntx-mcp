import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OwnerSoulCatalogShapeService,
  OwnerSoulCatalogShapeServiceError
} from "../application/owner-soul-catalog-shape-service.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";

export const SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME = "syntx_inspect_owner_soul_catalog_shape" as const;

const knownKeySchema = z.enum([
  "items", "data", "styles", "characters", "list", "results",
  "value", "style_id", "lora_id", "reference_id", "id", "name", "image",
  "status", "model_type", "total", "page", "page_size", "has_more",
  "next", "count"
]);
const shapeTypeSchema = z.enum(["null", "object", "array", "string", "number", "boolean"]);
const fieldsSchema = z.partialRecord(knownKeySchema, z.object({
  types: z.array(shapeTypeSchema).max(6),
  occurrences: z.number().int().min(1).max(128)
}).strict());
const levelSchema = z.object({ fields: fieldsSchema, unknown_key_count: z.number().int().min(0).max(4096) }).strict();
const outputSchema = z.object({
  model_id: z.literal("higgsfield-soul"),
  catalog_version: z.literal("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"),
  confidence_scope: z.literal("owner_authenticated_fixed_route_shape_only"),
  generation_allowed: z.literal(false),
  backend_acceptance: z.literal("unproven"),
  kind: z.enum(["styles", "characters"]),
  outcome: z.enum(["SHAPE_OBSERVED", "EMPTY_INCONCLUSIVE", "UNRECOGNIZED_SHAPE"]),
  response_bytes: z.number().int().min(0).max(65536),
  top_level: levelSchema,
  items: z.object({
    container_key: knownKeySchema.nullable(),
    item_count: z.number().int().min(0).max(100000),
    inspected_count: z.number().int().min(0).max(128),
    truncated: z.boolean(),
    value_types: z.array(shapeTypeSchema).max(6),
    fields: fieldsSchema,
    unknown_key_count: z.number().int().min(0).max(128 * 4096)
  }).strict()
}).strict();

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
  .describe("Exact linked owner attempt ID; it does not select a different identity.");

export interface RegisterSyntxOwnerSoulCatalogShapeToolsOptions {
  readonly service: Pick<OwnerSoulCatalogShapeService, "inspect">;
}

export function registerSyntxOwnerSoulCatalogShapeTools(
  server: McpServer,
  options: RegisterSyntxOwnerSoulCatalogShapeToolsOptions
): void {
  server.registerTool(SYNTX_INSPECT_OWNER_SOUL_CATALOG_SHAPE_TOOL_NAME, {
    title: "Inspect owner Soul catalog response shape",
    description: "Read-only diagnostic of the fixed Soul style or Character list route. Reports only bounded JSON key/type/cardinality metadata; no IDs, names, URLs, raw body, training, upload, or generation. Empty/unknown shape is inconclusive, not a complete catalog or generation schema.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      kind: z.enum(["styles", "characters"])
    }).strict(),
    outputSchema,
    annotations: {
      title: "Inspect owner Soul catalog response shape",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ link_attempt_id, kind }, { signal }) => {
    try {
      const result = await options.service.inspect({ attemptId: link_attempt_id, kind, signal });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>
      };
    } catch (error) {
      return shapeToolError(error);
    }
  });
}

function shapeToolError(error: unknown): CallToolResult {
  const code = error instanceof OwnerSoulCatalogShapeServiceError
    ? error.code
    : error instanceof OwnerReferencePrincipalError ? "PRINCIPAL_NOT_LINKED" : "UPSTREAM_UNAVAILABLE";
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The Soul shape request is invalid.",
    PRINCIPAL_NOT_LINKED: "A linked owner attempt is required.",
    MODEL_BINDING_MISMATCH: "The pinned Soul model is unavailable in the selected catalog.",
    SERVICE_BUSY: "The owner Soul shape reader is busy; try again later.",
    SERVICE_CLOSED: "The owner Soul shape reader is closed.",
    UPSTREAM_UNAVAILABLE: "The owner Soul catalog shape could not be read.",
    UPSTREAM_TIMEOUT: "The owner Soul catalog shape request timed out.",
    UPSTREAM_REQUEST_ABORTED: "The owner Soul catalog shape request was cancelled.",
    UPSTREAM_PROTOCOL_ERROR: "The owner Soul catalog response did not match a safe JSON shape."
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message: messages[code] ?? messages.UPSTREAM_UNAVAILABLE } }) }]
  };
}
