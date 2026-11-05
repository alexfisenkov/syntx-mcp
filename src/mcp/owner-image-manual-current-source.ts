import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { getOwnerImageManualCurrentControls, type OwnerImageManualFamily } from "../application/owner-image-manual-current-controls.js";

export function registerOwnerImageManualCurrentSource(server: McpServer, family: OwnerImageManualFamily): void {
  const source = getOwnerImageManualCurrentControls(family);
  server.registerTool(`syntx_owner_get_${family}_current_manual_source`, {
    title: `${family} current manual controls`,
    description: "Read source-pinned continuous manual ranges and provenance. The existing pricing catalog is separate from the current controls source. No account or provider acceptance is implied.",
    inputSchema: z.object({}).strict(), outputSchema: z.object({ source: z.json() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => ({ content: [{ type: "text", text: JSON.stringify({ source }) }], structuredContent: { source } }));
}
