import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  OwnerSoulStyleOptionsServiceError,
  type OwnerSoulStyleOptionsService,
  type OwnerSoulStyleOptionsServiceErrorCode
} from "../application/owner-soul-style-options-service.js";
import { OwnerReferencePrincipalError } from "../auth/owner-reference-principal.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";

export const SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME = "syntx_list_owner_soul_style_options" as const;
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
  .describe("Exact currently linked owner attempt. It does not select a different account.");
const byteRangeSchema = z.object({ min: z.number().int().min(1).max(4096), max: z.number().int().min(1).max(4096) }).strict();
const summarySchema = z.object({
  route: z.literal("hf/lora/styles"),
  response_bytes: z.number().int().min(0).max(65_536),
  record_count: z.number().int().min(1).max(128),
  total_matches: z.literal(true),
  unique_ids: z.literal(true),
  fields_valid: z.literal(true),
  unknown_top_level_key_count: z.number().int().min(0).max(64),
  unknown_item_key_count: z.number().int().min(0).max(128 * 64),
  style_id_utf8_bytes: byteRangeSchema,
  name_utf8_bytes: byteRangeSchema
}).strict();
const outputSchema = z.object({
  status: z.literal("OPTIONS_ISSUED"),
  model_id: z.literal("higgsfield-soul"),
  catalog_version: z.literal(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION),
  confidence_scope: z.literal("owner_authenticated_source_reviewed_style_options"),
  source_reviewed: z.literal(true),
  source_mapping_sha256: z.literal(SOURCE_MAPPING_SHA256),
  generation_allowed: z.literal(false),
  expires_in_seconds: z.literal(300),
  options: z.array(z.object({
    style_handle: z.string().regex(/^soul_style_[0-9a-f-]{36}$/u),
    label: z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]*$/u)
  }).strict()).min(1).max(128),
  summary: summarySchema
}).strict();

export interface RegisterSyntxOwnerSoulStyleOptionsToolOptions {
  readonly service: Pick<OwnerSoulStyleOptionsService, "listOptions">;
}

export function registerSyntxOwnerSoulStyleOptionsTool(
  server: McpServer,
  options: RegisterSyntxOwnerSoulStyleOptionsToolOptions
): void {
  server.registerTool(SYNTX_LIST_OWNER_SOUL_STYLE_OPTIONS_TOOL_NAME, {
    title: "List owner Soul style options",
    description: "Read the fixed source-reviewed Soul styles list for the exact linked owner. Returns bounded plain-text labels and opaque process-local handles for five minutes, plus safe source/shape metadata. Raw style IDs and image URLs are never returned. This does not establish provider ownership, generation admission, or an executable generation contract; it does not generate, upload, train, or delete.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema }).strict(),
    outputSchema,
    annotations: {
      title: "List owner Soul style options",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async ({ link_attempt_id }, { signal }) => {
    try {
      const result = await options.service.listOptions({ attemptId: link_attempt_id, signal });
      const output = outputSchema.parse(result);
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
    } catch (error) {
      return styleOptionsToolError(error);
    }
  });
}

function styleOptionsToolError(error: unknown): CallToolResult {
  const code: OwnerSoulStyleOptionsServiceErrorCode = error instanceof OwnerSoulStyleOptionsServiceError
    ? error.code
    : error instanceof OwnerReferencePrincipalError ? "PRINCIPAL_NOT_LINKED" : "UPSTREAM_UNAVAILABLE";
  const messages: Record<OwnerSoulStyleOptionsServiceErrorCode, string> = {
    INVALID_REQUEST: "The Soul style options request is invalid.",
    PRINCIPAL_NOT_LINKED: "A linked owner attempt is required.",
    MODEL_BINDING_MISMATCH: "The pinned Soul model is unavailable in the selected catalog.",
    SERVICE_BUSY: "The owner Soul style reader is busy.",
    SERVICE_CLOSED: "The owner Soul style reader is closed.",
    SNAPSHOT_SUPERSEDED: "A newer Soul style list replaced this read.",
    CAPACITY_EXCEEDED: "The bounded owner Soul style option capacity is full.",
    SOURCE_SNAPSHOT_INVALID: "The source-reviewed Soul style list did not match the safe local contract.",
    OPTION_HANDLE_NOT_FOUND: "The style option handle is unavailable for this owner attempt.",
    OPTION_HANDLE_EXPIRED: "The style option handle expired.",
    UPSTREAM_UNAVAILABLE: "The owner Soul style list could not be read.",
    UPSTREAM_TIMEOUT: "The owner Soul style list request timed out.",
    UPSTREAM_REQUEST_ABORTED: "The owner Soul style list request was cancelled.",
    UPSTREAM_PROTOCOL_ERROR: "The owner Soul style list did not match the safe source shape."
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: messages[code] } }) }] };
}
