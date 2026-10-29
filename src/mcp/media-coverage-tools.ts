import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { MediaCoverageCatalog } from "../catalog/media-coverage.js";

export const SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME = "syntx_get_media_coverage" as const;

export function registerSyntxMediaCoverageTools(server: McpServer, catalog: MediaCoverageCatalog): void {
  server.registerTool(SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME, {
    title: "Get current media coverage",
    description: "Read the immutable current public non-text media census with pagination, inactive and unknown rows, operations/settings, mapped tool groups, operator flags, and separate code/result evidence status. Local read only; no auth, network, dispatch, or paid work.",
    inputSchema: z.object({
      offset: z.number().int().min(0).max(10_000).default(0),
      limit: z.number().int().min(1).max(100).default(50),
      include_inactive: z.boolean().default(false)
    }).strict(),
    annotations: { title: "Get current media coverage", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } satisfies ToolAnnotations
  }, async ({ offset, limit, include_inactive }): Promise<CallToolResult> => {
    const output = catalog.page({ offset, limit, include_inactive });
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output as unknown as Record<string, unknown> };
  });
}
