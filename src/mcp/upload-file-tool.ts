import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { SyntxHttpClient } from "../adapter/syntx/http-client.js";
import { UploadFileService } from "../application/upload-file.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { ApplicationError } from "../errors.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_UPLOAD_FILE_TOOL_NAME = "syntx_upload_file" as const;
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const modelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
const mimeSchema = z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime", "audio/mpeg", "audio/wav"]);
const resultSchema = z.object({ status: z.string(), file_id: z.string().nullable(), mime_type: mimeSchema, size: z.number().int().positive().max(10 * 1024 * 1024) }).strict();

export interface RegisterSyntxUploadFileToolOptions {
  catalog: DiscoveryCatalogRepository;
  resolveClient: (attemptId: string) => SyntxHttpClient;
}

export function registerSyntxUploadFileTool(server: McpServer, options: RegisterSyntxUploadFileToolOptions): void {
  server.registerTool(SYNTX_UPLOAD_FILE_TOOL_NAME, {
    title: "Upload one SYNTX reference file",
    description: "Owner-authorized opt-in upload of one base64 file (max 10 MiB) for a public catalog model. Stores it hidden with duplicate checking. Returns only status, file_id, mime_type and size.",
    inputSchema: z.object({
      link_attempt_id: attemptIdSchema,
      model_id: modelIdSchema,
      filename: z.string().min(1).max(128),
      mime_type: mimeSchema,
      content_base64: z.string().min(4).max(14_000_000)
    }).strict(),
    outputSchema: resultSchema,
    annotations: { title: "Upload one SYNTX reference file", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ link_attempt_id, model_id, filename, mime_type, content_base64 }, { signal }) => {
    try {
      const result = await new UploadFileService(options.catalog, options.resolveClient(link_attempt_id)).upload({ content_base64, filename, mime_type, model_id }, signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      return uploadFileToolError(error);
    }
  });
}

function uploadFileToolError(error: unknown): CallToolResult {
  const code = error instanceof SyntxHttpError ? error.code : error instanceof ApplicationError && error.code === "MODEL_NOT_FOUND" ? "MODEL_NOT_FOUND" : "INVALID_REQUEST";
  const message = code === "MODEL_NOT_FOUND" ? "The requested public catalog model was not found." : SYNTX_HTTP_ERROR_MESSAGES[code] ?? "The upload request was rejected.";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] };
}
