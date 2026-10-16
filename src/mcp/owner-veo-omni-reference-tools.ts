import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { types } from "node:util";
import { z } from "zod/v4";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { getOwnerVeoOmniReferenceProfile, normalizeOwnerVeoOmniReferenceGenerationInput, OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 } from "../application/owner-veo-omni-reference-profile.js";

export const OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES = Object.freeze([
  "syntx_owner_get_veo_omni_reference_source", "syntx_owner_upload_veo_omni_reference",
  "syntx_owner_generate_veo_omni_references", "syntx_owner_reconcile_veo_omni_references",
  "syntx_owner_list_veo_omni_reference_recoveries", "syntx_owner_get_veo_omni_reference_result_page"
] as const);
export interface OwnerVeoOmniReferenceToolOptions {
  readonly maxFileBytes?: number;
  readonly referenceService: { uploadReference(input: unknown, signal?: AbortSignal): Promise<unknown> };
  readonly generationService: {
    generate(input: unknown, signal?: AbortSignal): Promise<unknown>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<unknown>;
    listRecoveries(input: unknown): Promise<readonly unknown[]>;
    getResultPage(input: unknown): Promise<unknown>;
  };
}
const attempt = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const handle = z.string().regex(/^veo_omni_reference_[0-9a-f-]{36}$/u);
const recovery = z.string().regex(/^veo_omni_reference_recovery_[0-9a-f-]{36}$/u);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const mime = z.enum(["image/jpeg", "image/jpg", "image/avif", "image/webp", "image/png", "video/mp4", "video/quicktime"]);
const MAX_RESULTS = 4096;
const diagnostic = z.object({
  phase: z.enum(["VALIDATE_REQUEST", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]),
  request_echo_status: z.enum(["NOT_READ", "MATCHED", "ABSENT", "PARTIAL_UNPROVEN", "CONTRADICTORY"]),
  history_get_calls: z.number().int().nonnegative(), result_get_calls: z.number().int().nonnegative(),
  result_status: z.enum(["NOT_READ", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u)).max(32)
}).strict();
const resultSchema = z.object({
  status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), output_count: z.literal("UNKNOWN"),
  recovery_id: recovery, model_id: z.literal("veo_omni"),
  source_binding: z.object({
    public_catalog_version: z.literal("sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json"),
    profile_sha256: z.literal(OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256), request_fingerprint: sha, intent_fingerprint: sha
  }).strict(),
  observed_artifact_count: z.number().int().min(1).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(64),
  artifacts: z.array(z.object({ object_index: z.number().int().nonnegative(), message_object_id: z.string().min(1).max(160),
    object_type: z.literal("video"), object_url: z.string().max(4096).refine(isSafeUploadReferenceUrl),
    mime_type: z.enum(["video/mp4", "video/quicktime"]).nullable(), mime_source: z.enum(["URL_EXTENSION", "UNKNOWN"]),
    message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160), model_id: z.literal("veo_omni")
  }).strict()).max(64), has_more: z.boolean(), next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), diagnostic
}).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: recovery, model_id: z.literal("veo_omni"),
  created_at: z.iso.datetime(), status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic
}).strict()).max(128) }).strict();
const generationInput = z.object({ link_attempt_id: attempt, prompt: z.string().max(100_000), input_type: z.enum(["image", "references"]),
  upscale: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]), aspect_ratio: z.enum(["16:9", "9:16"]),
  video_duration: z.union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)]), reference_handles: z.array(handle).min(1).max(7)
}).strict();
const recoveryInput = z.object({ link_attempt_id: attempt, recovery_id: recovery }).strict();
const listInput = z.object({ link_attempt_id: attempt, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: attempt, recovery_id: recovery, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();
const sourceSchema = z.object({ profile: z.record(z.string(), z.unknown()),
  local_policy: z.object({ max_file_bytes: z.number().int().positive(), reference_ttl_seconds: z.literal(900),
    input_inspection: z.literal("LOCAL_METADATA_ONLY_NO_DECODE"),
    image_subset: z.literal("STATIC_JPEG_PNG_WEBP_AV1_AVIF_CONSERVATIVE_STRUCTURE"),
    animated_or_derived_image_variants: z.literal("NOT_SUPPORTED_BY_LOCAL_VALIDATOR"),
    price_or_provider_cost_cap: z.literal("NOT_ENFORCED_BY_PROVIDER"),
    durability: z.literal("PROCESS_LOCAL_ONLY") }).strict(), backend_acceptance: z.literal("UNPROVEN")
}).strict();
const ERRORS = new Set(["INVALID_REQUEST", "OUTPUT_INVALID", "SERVICE_CLOSED", "SERVICE_BUSY", "CAPACITY_EXCEEDED", "REQUEST_ABORTED",
  "PRINCIPAL_NOT_LINKED", "PROBE_REJECTED", "VALIDATION_REJECTED", "UPLOAD_REJECTED", "UPLOAD_OUTCOME_UNKNOWN", "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED",
  "MODEL_BINDING_MISMATCH", "PREFLIGHT_FAILED", "SUBSCRIPTION_REQUIRED", "SUBSCRIPTION_STATUS_UNVERIFIED", "INTENT_ALREADY_CLAIMED",
  "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"]);

/** Registers a private owner composition; no raw URL/role/model/cost input is model-callable. */
export function registerSyntxOwnerVeoOmniReferenceTools(server: McpServer, options: OwnerVeoOmniReferenceToolOptions): void {
  const profile = getOwnerVeoOmniReferenceProfile();
  const cap = options.maxFileBytes ?? profile.local_resource_policy.default_max_file_bytes;
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > profile.public_limits.max_file_size_bytes) throw new Error("INVALID_OMNI_OPERATOR_CAP");
  const uploadInput = z.object({ link_attempt_id: attempt, filename: z.string().min(1).max(128), mime_type: mime,
    content_base64: z.string().min(4).max(Math.ceil(cap / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u)
  }).strict();
  const uploadOutput = z.object({ status: z.literal("uploaded"), reference_handle: handle, model_id: z.literal("veo_omni"),
    kind: z.enum(["image", "video"]), mime_type: mime, size: z.number().int().min(1).max(cap), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    width: z.number().int().positive(), height: z.number().int().positive(), duration_seconds: z.number().positive().max(10.2).nullable(),
    expires_in_seconds: z.number().int().min(0).max(900), input_confidence: z.literal("LOCAL_METADATA_ONLY_NO_DECODE")
  }).strict().refine((value) => value.kind === "image" ? value.mime_type.startsWith("image/") && value.duration_seconds === null
    : value.mime_type.startsWith("video/") && value.duration_seconds !== null);

  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[0], {
    title: "Get Omni reference controls and limits",
    description: "Returns pinned source controls for Veo Omni and separately the configured local resource limits. Static source flags are not provider acceptance or authorization. No account, network or generation call.",
    inputSchema: z.object({}).strict(), outputSchema: sourceSchema, annotations: annotations(true, false)
  }, async () => success(sourceSchema, { profile, local_policy: { max_file_bytes: cap, reference_ttl_seconds: 900,
    input_inspection: "LOCAL_METADATA_ONLY_NO_DECODE", image_subset: "STATIC_JPEG_PNG_WEBP_AV1_AVIF_CONSERVATIVE_STRUCTURE",
    animated_or_derived_image_variants: "NOT_SUPPORTED_BY_LOCAL_VALIDATOR", price_or_provider_cost_cap: "NOT_ENFORCED_BY_PROVIDER",
    durability: "PROCESS_LOCAL_ONLY" }, backend_acceptance: "UNPROVEN" }));

  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[1], {
    title: "Upload one owner Omni reference",
    description: "Uploads one owner-supplied image or video to the linked account after local metadata validation. Returns an opaque 15-minute handle, never the private upload URL. Base64 must be canonical. Trusted operator limits may be below public limits. Unknown upload must not be repeated.",
    inputSchema: uploadInput, outputSchema: uploadOutput, annotations: annotations(false, true)
  }, async (input, { signal }) => {
    let bytes: Buffer | undefined;
    try {
      const data = uploadInput.parse(input);
      const padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0;
      const size = data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(size) || size < 1 || size > cap) return safeErrorCode("INVALID_REQUEST");
      bytes = Buffer.from(data.content_base64, "base64");
      if (bytes.length !== size || bytes.toString("base64") !== data.content_base64) return safeErrorCode("INVALID_REQUEST");
      const output = await options.referenceService.uploadReference({ attemptId: data.link_attempt_id, filename: data.filename,
        mime_type: data.mime_type, bytes }, signal);
      return success(uploadOutput, output, "UPLOAD_OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
    finally { bytes?.fill(0); }
  });

  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[2], {
    title: "Generate one owner Omni reference video",
    description: "One non-idempotent Veo Omni generation using owned opaque handles and explicit controls. image: 1–2 images; references: 1–7 images or one video plus 0–5 images. Optional [[ref:N]] mentions use 1-based handle order. Raw URLs, roles, wire fields and price mode are forbidden. Active paid plan, live model access, finite quote and enough balance are checked twice. An uncertain result requires GET-only reconciliation; never repeat generation.",
    inputSchema: generationInput, outputSchema: resultSchema, annotations: annotations(false, true)
  }, async (input, { signal }) => {
    try {
      const { link_attempt_id, ...fields } = generationInput.parse(input);
      const raw = { ...fields, attemptId: link_attempt_id };
      // Keep the public schema and the stricter closed application semantics aligned.
      normalizeOwnerVeoOmniReferenceGenerationInput(raw);
      return success(resultSchema, await options.generationService.generate(raw, signal), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });

  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[3], {
    title: "Reconcile Omni reference video (GET only)", description: "Reads only this linked owner's existing recovery. Does not upload, create a chat or repeat generation.",
    inputSchema: recoveryInput, outputSchema: resultSchema, annotations: annotations(true, true)
  }, async (input, { signal }) => {
    try { const { link_attempt_id, recovery_id } = recoveryInput.parse(input);
      return success(resultSchema, await options.generationService.reconcile({ attemptId: link_attempt_id, recovery_id }, signal), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[4], {
    title: "List Omni reference recoveries", description: "Lists bounded process-local recoveries for the linked owner, without provider dispatch.",
    inputSchema: listInput, outputSchema: recoveryList, annotations: annotations(true, false)
  }, async (input) => {
    try { const { link_attempt_id, ...fields } = listInput.parse(input);
      return success(recoveryList, { recoveries: await options.generationService.listRecoveries({ attemptId: link_attempt_id, ...fields }) });
    } catch (error) { return safeError(error); }
  });
  server.registerTool(OWNER_VEO_OMNI_REFERENCE_TOOL_NAMES[5], {
    title: "Read Omni reference result page", description: "Reads a bounded page of already observed owner results. No generation or provider retry.",
    inputSchema: pageInput, outputSchema: resultSchema, annotations: annotations(true, false)
  }, async (input) => {
    try { const { link_attempt_id, ...fields } = pageInput.parse(input);
      return success(resultSchema, await options.generationService.getResultPage({ attemptId: link_attempt_id, ...fields }), "OUTCOME_UNKNOWN");
    } catch (error) { return safeError(error); }
  });
}

function annotations(readOnly: boolean, openWorld: boolean) {
  return { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: openWorld };
}
function success<T extends z.ZodType>(schema: T, value: unknown, failureCode = "OUTPUT_INVALID"): CallToolResult {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    let recoveryId: string | undefined;
    if (failureCode === "OUTCOME_UNKNOWN" && value && typeof value === "object" && !types.isProxy(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, "recovery_id");
      if (descriptor && Object.hasOwn(descriptor, "value") && recovery.safeParse(descriptor.value).success) recoveryId = descriptor.value as string;
    }
    return safeErrorCode(failureCode, recoveryId);
  }
  return { content: [{ type: "text", text: JSON.stringify(parsed.data) }], structuredContent: parsed.data as Record<string, unknown> };
}
function safeError(error: unknown): CallToolResult {
  let code = "INVALID_REQUEST", recoveryId: string | undefined;
  if (error && typeof error === "object" && !types.isProxy(error)) {
    const c = Object.getOwnPropertyDescriptor(error, "code"), r = Object.getOwnPropertyDescriptor(error, "recovery_id");
    if (c && Object.hasOwn(c, "value") && typeof c.value === "string" && ERRORS.has(c.value)) code = c.value;
    if (code === "OUTCOME_UNKNOWN" && r && Object.hasOwn(r, "value") && recovery.safeParse(r.value).success) recoveryId = r.value as string;
  }
  return safeErrorCode(code, recoveryId);
}
function safeErrorCode(code: string, recoveryId?: string): CallToolResult {
  const unknown = code === "OUTCOME_UNKNOWN" || code === "UPLOAD_OUTCOME_UNKNOWN";
  const message = unknown ? "The operation may have been dispatched; do not retry. Use the same recovery handle for GET-only reconciliation if available."
    : "The owner Omni reference operation could not be completed safely.";
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message,
    ...(recoveryId === undefined ? {} : { recovery_id: recoveryId }) } }) }] };
}
