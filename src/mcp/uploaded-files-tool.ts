import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  SYNTX_UPLOADED_FILE_SCOPES,
  SyntxHttpError,
  type SyntxHttpClient
} from "../adapter/syntx/http-client.js";
import { UploadedFilesService } from "../application/uploaded-files.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_LIST_UPLOADED_FILES_TOOL_NAME = "syntx_list_uploaded_files" as const;

export interface RegisterSyntxListUploadedFilesToolOptions {
  /** Server-owned binding must scope the exact attempt; the id is not identity. */
  resolveClient: (attemptId: string) => SyntxHttpClient;
}

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const itemSchema = z.object({
  id: z.string().max(256).optional(),
  filename: z.string().max(256).optional(),
  mime_type: z.string().max(256).optional(),
  size: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  created_at: z.string().max(64).optional()
}).strict();

export function registerSyntxListUploadedFilesTool(
  server: McpServer,
  options: RegisterSyntxListUploadedFilesToolOptions
): void {
  server.registerTool(SYNTX_LIST_UPLOADED_FILES_TOOL_NAME, {
    title: "List SYNTX uploaded files",
    description:
      "Read a bounded page of metadata for files already stored in the linked SYNTX account. This is read-only: it never uploads, deletes, downloads, or returns URLs, object URLs, signed links, or unknown upstream fields. Uses an observed frontend envelope and fails closed on unsupported response shapes.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema.describe("Exact linked attempt returned by syntx_begin_login."),
      scope: z.enum(SYNTX_UPLOADED_FILE_SCOPES),
      page: z.number().int().min(1).max(1000),
      page_size: z.number().int().min(1).max(100)
    }).strict(),
    outputSchema: z.object({
      page: z.number().int().min(1).max(1000),
      page_size: z.number().int().min(1).max(100),
      has_more: z.boolean(),
      total: z.number().int().nonnegative().nullable(),
      items: z.array(itemSchema).max(100)
    }).strict(),
    annotations: {
      title: "List SYNTX uploaded files",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ link_attempt_id, scope, page, page_size }, { signal }) => {
    try {
      const result = await new UploadedFilesService(options.resolveClient(link_attempt_id))
        .listUploadedFiles({ scope, page, page_size }, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>
      };
    } catch (error) {
      return uploadedFilesToolError(error);
    }
  });
}

function uploadedFilesToolError(error: unknown): CallToolResult {
  const code = error instanceof SyntxHttpError ? error.code : "INTERNAL_ERROR";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({
      error: { code, message: SYNTX_HTTP_ERROR_MESSAGES[code] ?? SYNTX_HTTP_ERROR_MESSAGES.INTERNAL_ERROR }
    }) }]
  };
}
