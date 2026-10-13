import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type {
  GenerateOwnerImageReferenceCandidateInput,
  OwnerContractMediaResult,
  OwnerContractMediaService
} from "../application/owner-contract-media.js";
import { OwnerContractMediaError } from "../application/owner-contract-media.js";

export const SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME = "syntx_owner_probe_image_reference" as const;

const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const artifactSchema = z.object({
  url: z.string().url(),
  mime_type: z.literal("image/jpeg"),
  byte_size: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
}).strict();
const outputSchema = z.object({
  model_id: z.literal("banana-2.1"),
  operation_id: z.literal("generate-image"),
  variant_id: z.literal("banana21-image-1k-minimal-square-reference-candidate"),
  status: z.literal("candidate_result_observed"),
  candidate_status: z.literal("blocked"),
  dispatch_allowed: z.literal(false),
  confidence_scope: z.literal("one_owner_reference_result_only"),
  artifacts: z.array(artifactSchema).length(1)
}).strict();

export interface RegisterSyntxOwnerImageReferenceProbeOptions {
  readonly attemptId: string;
  readonly service: OwnerContractMediaService;
  readonly input: Omit<GenerateOwnerImageReferenceCandidateInput, "attemptId" | "signal">;
}

/** Registered only on the isolated source harness server, never by default MCP composition. */
export function registerSyntxOwnerImageReferenceProbeTool(
  server: McpServer,
  options: RegisterSyntxOwnerImageReferenceProbeOptions
): void {
  if (!attemptIdSchema.safeParse(options.attemptId).success ||
      options.input.candidate.status !== "blocked" || options.input.candidate.dispatch_allowed !== false) {
    throw new Error("OWNER_IMAGE_REFERENCE_PROBE_BINDING_INVALID");
  }
  server.registerTool(SYNTX_OWNER_IMAGE_REFERENCE_PROBE_TOOL_NAME, {
    title: "Probe one owner image reference (one real dispatch)",
    description: "Source-only exact owner experiment. Uses one fixed in-memory benign PNG reference and one blocked Banana 2.1 candidate. The reference permit is one-shot. Unknown outcomes must not be retried; only the known recovery handle may be reconciled with GET requests. The candidate and base contract remain unpromoted.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema }).strict(),
    outputSchema,
    annotations: { title: "Probe one owner image reference", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (toolInput, { signal }): Promise<CallToolResult> => {
    if (toolInput.link_attempt_id !== options.attemptId) return probeError("PROBE_UNAVAILABLE");
    try {
      const result = await options.service.generateImageReferenceCandidate({
        ...options.input,
        attemptId: options.attemptId,
        ...(signal === undefined ? {} : { signal })
      });
      return probeSuccess(result);
    } catch (error) {
      return probeFailure(error);
    }
  });
}

function probeSuccess(result: OwnerContractMediaResult): CallToolResult {
  try {
    const output = outputSchema.parse({
      model_id: result.model_id,
      operation_id: result.operation_id,
      variant_id: "banana21-image-1k-minimal-square-reference-candidate",
      status: "candidate_result_observed",
      candidate_status: "blocked",
      dispatch_allowed: false,
      confidence_scope: "one_owner_reference_result_only",
      artifacts: result.artifacts
    });
    return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
  } catch {
    return probeError("OUTCOME_UNKNOWN");
  }
}

function probeFailure(error: unknown): CallToolResult {
  if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN") {
    const recoveryId = typeof error.recoveryId === "string" && /^recovery_[0-9a-f-]{36}$/u.test(error.recoveryId)
      ? error.recoveryId : undefined;
    return probeError("OUTCOME_UNKNOWN", recoveryId);
  }
  if (error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED") return probeError("PRE_DISPATCH_FAILED");
  return probeError("PROBE_UNAVAILABLE");
}

function probeError(code: "OUTCOME_UNKNOWN" | "PRE_DISPATCH_FAILED" | "PROBE_UNAVAILABLE" | "RESULT_UNAVAILABLE", recoveryId?: string): CallToolResult {
  const message = code === "OUTCOME_UNKNOWN"
    ? "The image request may have been dispatched; do not retry. Use only the known recovery handle for GET-only reconciliation."
    : code === "PRE_DISPATCH_FAILED"
      ? "The image request did not reach generation dispatch."
      : "The image-reference probe is unavailable for this exact owner attempt.";
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } }) }]
  };
}
