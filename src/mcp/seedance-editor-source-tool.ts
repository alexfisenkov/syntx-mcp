import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { getOwnerSeedanceEditorSourceProfile } from "../application/owner-seedance-editor-parameters.js";

export const SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME = "syntx_get_seedance_editor_source" as const;

const outputSchema = z.object({
  network_access: z.literal(false),
  paid_operations: z.literal(false),
  dispatch_allowed: z.literal(false),
  profile: z.json()
}).strict();

/** Local source evidence only: no account, uploaded URLs, runtime promotion or dispatch. */
export function registerSyntxSeedanceEditorSourceTool(server: McpServer): void {
  server.registerTool(SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME, {
    title: "Get Seedance 2.5 Editor source contract",
    description: "Read the pinned Editor no-frame-reference contract: tool_video_inpaint, upstream seedance-2.5/edit and explicit 480p/720p/1080p choices. This is NOT a generation tool or a public catalog model ID. Cost, access, validated upload limits and provider acceptance are unproven; generation remains disabled. No network, authentication or paid operation occurs.",
    inputSchema: z.object({}).strict(),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = outputSchema.parse({
        network_access: false, paid_operations: false, dispatch_allowed: false,
        profile: getOwnerSeedanceEditorSourceProfile()
      });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
        code: "SEEDANCE_EDITOR_SOURCE_UNAVAILABLE", message: "The local Seedance Editor source contract is unavailable."
      } }) }] };
    }
  });
}
