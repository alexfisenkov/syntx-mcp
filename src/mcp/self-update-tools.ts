import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { McpSelfUpdateService } from "../application/mcp-self-update-service.js";

export function registerMcpSelfUpdateTools(server: McpServer, service: McpSelfUpdateService, allowApply: boolean): void {
  server.registerTool("syntx_update_check", {
    title: "Check for MCP update",
    description: "Read-only check of the fixed public SYNTX MCP repository. Does not install or activate code.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await service.check()) }] }));
  if (!allowApply) return;
  server.registerTool("syntx_update_apply", {
    title: "Prepare MCP update",
    description: "Prepare and validate the latest official public build for the next owner stdio restart.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await service.apply()) }] }));
  server.registerTool("syntx_update_rollback", {
    title: "Prepare MCP rollback",
    description: "Select the previously prepared working version for the next owner stdio restart.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await service.rollback()) }] }));
}
