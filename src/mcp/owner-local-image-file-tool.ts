import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OWNER_STANDARD_IMAGE_VARIANTS } from "../application/owner-standard-image-request-preparer.js";
import { OwnerLocalImageFileService, OwnerLocalImageFileServiceError } from "../application/owner-local-image-file-service.js";
import { OwnerStandardImageUploadServiceError } from "../application/owner-standard-image-upload-service.js";
import { getStandardImageReferencePreparationPolicy } from "../application/standard-image-reference-preparation.js";

export const SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME = "syntx_upload_standard_image_reference_file" as const;
const inputSchema = z.object({
  link_attempt_id: z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u),
  variant: z.enum(OWNER_STANDARD_IMAGE_VARIANTS),
  absolute_path: z.string().min(1).max(4096),
  auto_compress: z.boolean().optional().default(true)
}).strict();
const receiptSchema = z.object({
  status: z.literal("uploaded"), reference_handle: z.string().min(1), variant: z.enum(OWNER_STANDARD_IMAGE_VARIANTS),
  kind: z.literal("image"), original_mime_type: z.string(), mime_type: z.string(), width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(), duration: z.null(), size: z.number().int().positive(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u), expires_in_seconds: z.number().int().nonnegative(),
  metadata_confidence: z.enum(["CONTAINER_METADATA_ONLY", "NOT_EXTRACTED"]), validation_confidence: z.string()
}).strict();
const preparationSchema = z.object({
  applied: z.boolean(), original_bytes: z.number().int().positive(), prepared_bytes: z.number().int().positive(),
  original_width: z.number().int().positive().optional(), original_height: z.number().int().positive().optional(),
  prepared_width: z.number().int().positive().optional(), prepared_height: z.number().int().positive().optional(),
  original_mime_type: z.string().optional(), prepared_mime_type: z.string().optional()
}).strict();
const policySchema = z.object({
  source_catalog_version: z.string(), source_catalog_fetched_at: z.string(), model_id: z.enum(OWNER_STANDARD_IMAGE_VARIANTS),
  source_limit_bytes: z.number().int().positive(), prepared_target_bytes: z.number().int().positive(),
  legacy_validator_limit_bytes: z.number().int().positive(), max_width: z.number().int().positive(), max_height: z.number().int().positive(),
  provider_acceptance: z.literal("NOT_PROVEN")
}).strict();
const outputSchema = z.object({ receipt: receiptSchema, preparation: preparationSchema, filename: z.string().min(1).max(255),
  preparation_policy: policySchema }).strict();

export function registerSyntxOwnerLocalImageFileTool(server: McpServer, service: OwnerLocalImageFileService): void {
  server.registerTool(SYNTX_UPLOAD_STANDARD_IMAGE_REFERENCE_FILE_TOOL_NAME, {
    title: "Upload a local image file as a reference",
    description: "Preferred local-desktop path for a Banana or GPT Image reference: it avoids sending file Base64 through the model and avoids downloading the attachment from a temporary ChatGPT file host. Supply the absolute path on the computer running this local MCP process; paths on another computer or a remote MCP host cannot be read. The path must be inside an operator-configured local root. Current source-guided limits: Banana 2.1 accepts originals up to 20 MiB and prepares them to 5 MiB or less; the other nine variants accept originals up to 32 MiB and prepare them to 26.25 MiB or less. Preparation uses a local copy and never overwrites the original file. FFmpeg must be configured with an absolute path only when the image needs preparation; images already within the selected target can be uploaded without it. Preparation limits follow public metadata and do not prove provider acceptance. This uploads a reference only and does not generate an image.",
    inputSchema, outputSchema,
    annotations: { title: "Upload a local image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }): Promise<CallToolResult> => {
    const request = inputSchema.safeParse(input);
    if (!request.success) return errorResult("INVALID_REQUEST");
    try {
      const result = await service.upload({ attemptId: request.data.link_attempt_id, variant: request.data.variant,
        absolute_path: request.data.absolute_path, auto_compress: request.data.auto_compress,
        ...(signal === undefined ? {} : { signal }) });
      const checked = outputSchema.parse({ ...result, preparation_policy: getStandardImageReferencePreparationPolicy(request.data.variant) });
      return { content: [{ type: "text", text: JSON.stringify(checked) }], structuredContent: checked };
    } catch (error) {
      return errorResult(error instanceof OwnerLocalImageFileServiceError || error instanceof OwnerStandardImageUploadServiceError
        ? error.code : "UPLOAD_FAILED");
    }
  });
}

function errorResult(code: string): CallToolResult {
  const messages: Record<string, string> = {
    INVALID_REQUEST: "The local image upload request is invalid.",
    PATH_NOT_ALLOWED: "The image path is outside the operator-approved local folders.",
    FILE_UNAVAILABLE: "The local image file is unavailable or is not a regular file.",
    FILE_TOO_LARGE: "The local image file exceeds the selected variant's source-read limit.",
    FILE_CHANGED: "The local image file changed while it was being read. Try again with a stable file.",
    REQUEST_ABORTED: "The local image upload was cancelled.",
    PREPARATION_FAILED: "The local image could not be validated or prepared for upload.",
    PREPARATION_UNAVAILABLE: "This image needs local preparation. Configure an absolute FFmpeg path with SYNTX_MEDIA_FFMPEG_PATH, or use an image already within the selected variant limits.",
    PRINCIPAL_NOT_LINKED: "The owner attempt is not linked.",
    INVALID_IMAGE_INPUT: "Provide a supported image with valid image data and matching type.",
    UNSUPPORTED_IMAGE_COMPOSITION: "This image composition is not supported by the current validator.",
    LOCAL_RESOURCE_LIMIT_EXCEEDED: "The image exceeds the selected variant's local resource limit.",
    SERVICE_BUSY: "The image upload service is busy. Try again later.",
    CAPACITY_EXCEEDED: "The image upload service has reached its local capacity.",
    UPLOAD_REJECTED: "The image upload was rejected. Check the file and owner link before trying again.",
    UPLOAD_OUTCOME_UNKNOWN: "The upload outcome is unknown. Do not retry automatically; no upload handle was issued. Check the linked account's existing uploaded files before deciding what to do.",
    UPLOAD_FAILED: "The local image upload failed safely."
  };
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: messages[code] ?? messages.UPLOAD_FAILED } }) }] };
}
