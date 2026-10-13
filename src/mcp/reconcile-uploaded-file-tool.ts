import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { SyntxHttpError, type SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { UploadedFilesService } from "../application/uploaded-files.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME = "syntx_reconcile_uploaded_file" as const;

export interface RegisterSyntxReconcileUploadedFileToolOptions {
  resolveClient: (attemptId: string) => SyntxHttpClient;
}

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const fileIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const metadataSchema = z.object({
  mime_type: z.string().max(256).optional(),
  size: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  created_at: z.string().max(64).optional()
}).strict();
const resultSchema = z.object({
  status: z.enum(["FOUND", "NOT_FOUND", "SEARCH_INCOMPLETE"]),
  file_id: fileIdSchema,
  metadata: metadataSchema
}).strict();

export function registerSyntxReconcileUploadedFileTool(
  server: McpServer,
  options: RegisterSyntxReconcileUploadedFileToolOptions
): void {
  server.registerTool(SYNTX_RECONCILE_UPLOADED_FILE_TOOL_NAME, {
    title: "Reconcile one SYNTX uploaded file",
    description:
      "Read-only bounded reconciliation for one opaque file id. Searches only the first confirmed scope=all page with page_size=10 and returns SEARCH_INCOMPLETE when more pages exist. Never uploads, deletes, downloads, returns URLs, or exposes unknown upstream fields.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema.describe("Exact linked attempt returned by syntx_begin_login."),
      file_id: fileIdSchema.describe("Opaque bounded file id returned by a trusted SYNTX receipt or inventory.")
    }).strict(),
    outputSchema: resultSchema,
    annotations: {
      title: "Reconcile one SYNTX uploaded file",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ link_attempt_id, file_id }, { signal }) => {
    try {
      const result = await new UploadedFilesService(options.resolveClient(link_attempt_id))
        .reconcileUploadedFile({ file_id }, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>
      };
    } catch (error) {
      return reconcileUploadedFileToolError(error);
    }
  });
}

function reconcileUploadedFileToolError(error: unknown): CallToolResult {
  const code = error instanceof SyntxHttpError ? error.code : "INTERNAL_ERROR";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({
      error: { code, message: SYNTX_HTTP_ERROR_MESSAGES[code] ?? SYNTX_HTTP_ERROR_MESSAGES.INTERNAL_ERROR }
    }) }]
  };
}

export { resultSchema as reconcileUploadedFileOutputSchema };
