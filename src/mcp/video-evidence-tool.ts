import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";

export const SYNTX_VIDEO_EVIDENCE_TOOL_NAME = "syntx_get_video_evidence" as const;

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/u)
  .max(160);
const locator = z
  .object({ line: z.number().int().positive(), column: z.number().int().positive() })
  .strict();
const evidenceRecord = z
  .object({
    scope: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    exported: z.boolean(),
    locator,
    status: z.enum(["STATIC_VALUE", "BLOCKED"]),
    value: z.json().optional(),
    blocker: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u).optional()
  })
  .strict()
  .superRefine((record, context) => {
    if (record.status === "STATIC_VALUE" && !("value" in record)) {
      context.addIssue({ code: "custom", message: "Static evidence requires a value." });
    }
    if (record.status === "BLOCKED" && !("blocker" in record)) {
      context.addIssue({ code: "custom", message: "Blocked evidence requires a blocker." });
    }
  });
const node = z
  .object({
    module_name: z.string().min(1).max(300),
    source_path: z.string().min(1).max(2_000),
    source_content_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    relation: z.enum(["DIRECT_IMPORT", "PROVIDER_ROOT"])
  })
  .strict();

export const videoEvidenceOutputSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.literal("VIDEO_EVIDENCE"),
    public_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
    settings_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
    build_id: z.string().regex(/^\d{6,20}$/u),
    runtime_usable: z.literal(false),
    form_id: identifier.nullable(),
    module_name: z.string().min(1).max(300).nullable(),
    evidence_records: z.array(evidenceRecord).max(512),
    nodes: z.array(node).max(512),
    blockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u)).max(512)
  })
  .strict();

export type VideoEvidenceQuery = {
  readonly form_id?: string | undefined;
  readonly module_name?: string | undefined;
};
export type VideoEvidenceOutput = z.infer<typeof videoEvidenceOutputSchema>;
export type VideoEvidenceResolver = (
  query: VideoEvidenceQuery
) => VideoEvidenceOutput | Promise<VideoEvidenceOutput>;

export interface RegisterSyntxVideoEvidenceToolOptions {
  readonly resolveEvidence: VideoEvidenceResolver;
}

export function registerSyntxVideoEvidenceTool(
  server: McpServer,
  options: RegisterSyntxVideoEvidenceToolOptions
): void {
  server.registerTool(
    SYNTX_VIDEO_EVIDENCE_TOOL_NAME,
    {
      title: "Get version-bound video evidence",
      description:
        "Read version-bound, static video evidence supplied by the host. This is an offline/read-only surface: it never loads files, contacts SYNTX, executes vendor code, or exposes source, prompts, or credentials.",
      inputSchema: z
        .object({
          form_id: identifier.optional().describe("Optional bounded video form id."),
          module_name: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u)
            .max(300)
            .optional()
            .describe("Optional bounded helper module filename.")
        })
        .strict(),
      outputSchema: videoEvidenceOutputSchema,
      annotations: {
        title: "Get version-bound video evidence",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input): Promise<CallToolResult> => {
      try {
        const result = videoEvidenceOutputSchema.parse(
          await options.resolveEvidence(input)
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid video evidence.";
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: { code: "VIDEO_EVIDENCE_UNAVAILABLE", message } }) }]
        };
      }
    }
  );
}
