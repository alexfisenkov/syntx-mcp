import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { getOwnerSeedanceEditorCurrentUiObservation, getOwnerSeedanceEditorSourceProfile } from "../application/owner-seedance-editor-parameters.js";

export const SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME = "syntx_get_seedance_editor_source" as const;

const outputSchema = z.object({
  network_access: z.literal(false),
  paid_operations: z.literal(false),
  dispatch_allowed: z.literal(false),
  profile: z.json(),
  current_ui_observation: z.json()
}).strict();

/** Local source evidence only: no account, uploaded URLs, runtime promotion or dispatch. */
export function registerSyntxSeedanceEditorSourceTool(server: McpServer): void {
  server.registerTool(SYNTX_SEEDANCE_EDITOR_SOURCE_TOOL_NAME, {
    title: "Get Seedance 2.5 Editor source contract",
    description: "Returns two separate records: the immutable older static-source profile and the 2026-10-30 current UI wire observation. Current UI used generate_audio=true and received HTTP 400; that does not establish provider acceptance or explain the response. The source reader is not a generation tool; it performs no network or authentication.",
    inputSchema: z.object({}).strict(),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (): Promise<CallToolResult> => {
    try {
      const output = outputSchema.parse({
        network_access: false, paid_operations: false, dispatch_allowed: false,
        profile: getOwnerSeedanceEditorSourceProfile(),
        current_ui_observation: getOwnerSeedanceEditorCurrentUiObservation()
      });
      return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
    } catch {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: {
        code: "SEEDANCE_EDITOR_SOURCE_UNAVAILABLE", message: "The local Seedance Editor source contract is unavailable."
      } }) }] };
    }
  });
}
