import { types } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OWNER_HAILUO02_I2V_SOURCE_PROFILE } from "../application/owner-hailuo02-i2v-source-profile.js";
import { OwnerHailuo02I2vImageReferenceService, OwnerHailuo02I2vImageReferenceServiceError } from "../application/owner-hailuo02-i2v-image-reference-service.js";
import { OwnerHailuo02I2vGenerationService, OwnerHailuo02I2vGenerationServiceError, isOwnerHailuo02I2vGenerationService } from "../application/owner-hailuo02-i2v-generation-service.js";

const MAX_BYTES = 10 * 1024 * 1024, MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4, MAX_RESULTS = 4096;
const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const RECOVERY = z.string().regex(/^hailuo02_i2v_recovery_[0-9a-f-]{36}$/u);
const model = z.literal("hailuo-02");
const uploadInput = z.object({ link_attempt_id: ATTEMPT, filename: z.string().min(1).max(255),
  mime_type: z.enum(["image/jpeg", "image/jpg", "image/png", "image/webp"]),
  content_base64: z.string().min(4).max(MAX_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u) }).strict();
const generateInput = z.object({ link_attempt_id: ATTEMPT, model_id: model,
  image_handle: z.string().regex(/^h02img_[A-Za-z0-9_-]{20,120}$/u), prompt: z.string().min(1).max(5000),
  resolution: z.enum(["512p", "768p", "1080p"]), video_duration: z.union([z.literal(6), z.literal(10)]) }).strict()
  .superRefine((v, ctx) => { if (!OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls.valid_pairs.some((p) => p.resolution === v.resolution && p.video_duration === v.video_duration))
    ctx.addIssue({ code: "custom", path: ["video_duration"], message: "Unsupported resolution and duration pair." }); });
const reconcileInput = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY }).strict();
const listInput = z.object({ link_attempt_id: ATTEMPT, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();
const diagnostic = z.object({ phase: z.enum(["VALIDATE_REQUEST", "RESOLVE_PRINCIPAL", "PREPARE_CANDIDATE", "PREFLIGHT_ONE", "CHAT_CREATE", "PREFLIGHT_TWO", "GENERATION_POST", "POST_ACK_KNOWN", "HISTORY_GET", "RESULT_GET", "RESULT_BINDING"]),
  post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]), history_get_calls: z.number().int().min(0).max(255), result_get_calls: z.number().int().min(0).max(255),
  result_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "UNVERIFIED"]), gaps: z.array(z.string().max(128)).max(32) }).strict();
const artifact = z.object({ object_index: z.number().int().min(0), message_object_id: z.string().min(1), object_type: z.literal("video"), object_url: z.string().url().max(4096),
  mime_type: z.enum(["video/mp4", "video/quicktime"]), mime_source: z.literal("URL_EXTENSION_LOCAL_POLICY"), message_id: z.string().min(1), chat_uuid: z.string().min(1), model_id: model }).strict();
const sourceBinding = z.object({ public_catalog_version: z.string(), profile_schema_hash: z.string(), request_fingerprint: z.string(), intent_fingerprint: z.string() }).strict();
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"),
  provider_terminal_status: z.literal("UNPROVEN"), cost_cap_enforced: z.literal(false), recovery_id: RECOVERY, model_id: model, source_binding: sourceBinding,
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.literal(64),
  artifacts: z.array(artifact).max(64), has_more: z.boolean(), next_offset: z.number().int().nullable(), diagnostic }).strict();
const uploadOutput = z.object({ status: z.literal("uploaded"), image_handle: z.string().regex(/^h02img_[A-Za-z0-9_-]{20,120}$/u), model_id: model,
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp"]), size: z.number().int().min(1).max(MAX_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  width: z.number().int().positive(), height: z.number().int().positive(), expires_in_seconds: z.number().int().min(0).max(900) }).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: RECOVERY, created_at: z.iso.datetime(), model_id: model,
  status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic }).strict()).max(128) }).strict();
const parametersOutput = z.object({ status: z.literal("SOURCE_REVIEWED_STATIC_ONLY"), source_pins: z.record(z.string(), z.unknown()), model: z.record(z.string(), z.unknown()),
  controls: z.record(z.string(), z.unknown()), defaults: z.literal("UNKNOWN"), runtime_usable: z.literal(false), backend_acceptance: z.literal("UNPROVEN") }).strict();
export const SYNTX_OWNER_GET_HAILUO02_I2V_PARAMETERS_TOOL_NAME = "syntx_owner_get_hailuo02_i2v_parameters" as const;
export const SYNTX_OWNER_UPLOAD_HAILUO02_I2V_IMAGE_TOOL_NAME = "syntx_owner_upload_hailuo02_i2v_image" as const;
export const SYNTX_OWNER_GENERATE_HAILUO02_I2V_TOOL_NAME = "syntx_owner_generate_hailuo02_i2v" as const;
export const SYNTX_OWNER_RECONCILE_HAILUO02_I2V_TOOL_NAME = "syntx_owner_reconcile_hailuo02_i2v" as const;
export const SYNTX_OWNER_LIST_HAILUO02_I2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_hailuo02_i2v_recoveries" as const;
export const SYNTX_OWNER_GET_HAILUO02_I2V_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_hailuo02_i2v_result_page" as const;
export const OWNER_HAILUO02_I2V_TOOL_NAMES = Object.freeze([SYNTX_OWNER_GET_HAILUO02_I2V_PARAMETERS_TOOL_NAME, SYNTX_OWNER_UPLOAD_HAILUO02_I2V_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_HAILUO02_I2V_TOOL_NAME, SYNTX_OWNER_RECONCILE_HAILUO02_I2V_TOOL_NAME, SYNTX_OWNER_LIST_HAILUO02_I2V_RECOVERIES_TOOL_NAME, SYNTX_OWNER_GET_HAILUO02_I2V_RESULT_PAGE_TOOL_NAME] as const);
export interface OwnerHailuo02I2vServiceComposition { readonly imageReferenceService: OwnerHailuo02I2vImageReferenceService; readonly generationService: OwnerHailuo02I2vGenerationService; }

export function registerSyntxOwnerHailuo02I2vTools(server: McpServer, input: unknown): void {
  const services = exactServices(input);
  server.registerTool(SYNTX_OWNER_GET_HAILUO02_I2V_PARAMETERS_TOOL_NAME, { title: "Get Hailuo-02 I2V parameters", description: "Returns source-reviewed controls; runtime defaults and provider acceptance remain unproven.",
    inputSchema: z.object({}).strict(), outputSchema: parametersOutput,
    annotations: { title: "Get Hailuo-02 I2V parameters", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => structured(parametersOutput, { status: "SOURCE_REVIEWED_STATIC_ONLY", source_pins: OWNER_HAILUO02_I2V_SOURCE_PROFILE.source_pins,
      model: OWNER_HAILUO02_I2V_SOURCE_PROFILE.model, controls: OWNER_HAILUO02_I2V_SOURCE_PROFILE.controls, defaults: "UNKNOWN", runtime_usable: false, backend_acceptance: "UNPROVEN" }));
  server.registerTool(SYNTX_OWNER_UPLOAD_HAILUO02_I2V_IMAGE_TOOL_NAME, { title: "Upload Hailuo-02 I2V image", description: "Uploads one bounded image for the linked owner. An uncertain upload must not be repeated.", inputSchema: uploadInput, outputSchema: uploadOutput,
    annotations: { title: "Upload Hailuo-02 I2V image", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
      const parsed = uploadInput.safeParse(snapshot(raw)); if (!parsed.success) return imageError("INVALID_REQUEST");
      const { data } = parsed, padding = data.content_base64.endsWith("==") ? 2 : data.content_base64.endsWith("=") ? 1 : 0, size = data.content_base64.length / 4 * 3 - padding;
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES) return imageError("INVALID_REQUEST");
      const bytes = Buffer.from(data.content_base64, "base64");
      try { if (bytes.length !== size) return imageError("INVALID_REQUEST"); return structured(uploadOutput, await services.imageReferenceService.uploadImage({ attemptId: data.link_attempt_id, filename: data.filename, mime_type: data.mime_type, bytes }, signal)); }
      catch (e) { return imageError(imageCode(e)); } finally { bytes.fill(0); }
    });
  server.registerTool(SYNTX_OWNER_GENERATE_HAILUO02_I2V_TOOL_NAME, { title: "Generate Hailuo-02 I2V video", description: "Starts one owner generation. For an unknown outcome, reconcile by recovery ID and never retry generation.", inputSchema: generateInput, outputSchema: resultSchema,
    annotations: { title: "Generate Hailuo-02 I2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
      const p = generateInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST");
      try { return structured(resultSchema, await services.generationService.generate({ attemptId: p.data.link_attempt_id, request: { model_id: p.data.model_id, image_handle: p.data.image_handle,
        prompt: p.data.prompt, resolution: p.data.resolution, video_duration: p.data.video_duration } }, signal)); } catch (e) { return generationError(generationCode(e), e); }
    });
  server.registerTool(SYNTX_OWNER_RECONCILE_HAILUO02_I2V_TOOL_NAME, { title: "Reconcile Hailuo-02 I2V generation", description: "GET-only recovery; it never starts or repeats generation.", inputSchema: reconcileInput, outputSchema: resultSchema,
    annotations: { title: "Reconcile Hailuo-02 I2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async (raw, { signal }) => {
      const p = reconcileInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(resultSchema, await services.generationService.reconcile({ attemptId: p.data.link_attempt_id, recovery_id: p.data.recovery_id }, signal)); } catch (e) { return generationError(generationCode(e), e); }
    });
  server.registerTool(SYNTX_OWNER_LIST_HAILUO02_I2V_RECOVERIES_TOOL_NAME, { title: "List Hailuo-02 I2V recoveries", description: "Lists bounded local recovery summaries without result URLs.", inputSchema: listInput, outputSchema: recoveryList,
    annotations: { title: "List Hailuo-02 I2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
      const p = listInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(recoveryList, { recoveries: await services.generationService.listRecoveries({ attemptId: p.data.link_attempt_id, ...(p.data.limit === undefined ? {} : { limit: p.data.limit }) }) }); } catch (e) { return generationError(generationCode(e), e); }
    });
  server.registerTool(SYNTX_OWNER_GET_HAILUO02_I2V_RESULT_PAGE_TOOL_NAME, { title: "Get Hailuo-02 I2V result page", description: "Reads a page from the locally observed result cache; backend completion is unproven.", inputSchema: pageInput, outputSchema: resultSchema,
    annotations: { title: "Get Hailuo-02 I2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
      const p = pageInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(resultSchema, await services.generationService.getResultPage({ attemptId: p.data.link_attempt_id, recovery_id: p.data.recovery_id, ...(p.data.offset === undefined ? {} : { offset: p.data.offset }) })); } catch (e) { return generationError(generationCode(e), e); }
    });
}

type ImageCode = "INVALID_REQUEST" | "PRINCIPAL_NOT_LINKED" | "REQUEST_ABORTED" | "SERVICE_BUSY" | "CAPACITY_EXCEEDED" | "SERVICE_CLOSED" | "IMAGE_REJECTED" | "UPLOAD_REJECTED" | "UPLOAD_OUTCOME_UNKNOWN" | "REFERENCE_UNAVAILABLE" | "REFERENCE_EXPIRED";
type GenerationCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
const imageMessages: Record<ImageCode, string> = { INVALID_REQUEST: "The Hailuo-02 I2V image request is invalid.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.", REQUEST_ABORTED: "The image upload was cancelled.", SERVICE_BUSY: "The image service is busy.", CAPACITY_EXCEEDED: "The image service is full.", SERVICE_CLOSED: "The image service is closed.", IMAGE_REJECTED: "The image was not accepted.", UPLOAD_REJECTED: "The image upload was rejected.", UPLOAD_OUTCOME_UNKNOWN: "The image upload outcome is unknown; do not repeat it.", REFERENCE_UNAVAILABLE: "The image reference is unavailable.", REFERENCE_EXPIRED: "The image reference has expired." };
const generationMessages: Record<GenerationCode, string> = { INVALID_REQUEST: "The Hailuo-02 I2V request is invalid.", SERVICE_CLOSED: "The generation service is closed.", SERVICE_BUSY: "The generation service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.", MODEL_BINDING_MISMATCH: "The selected model binding is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.", INTENT_ALREADY_CLAIMED: "This generation intent has an unresolved outcome.", PRE_DISPATCH_FAILED: "The request was not safely dispatched.", OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.", RECOVERY_NOT_FOUND: "The recovery is unavailable or expired." };
function exactServices(v: unknown): OwnerHailuo02I2vServiceComposition { if (!v || typeof v !== "object" || Array.isArray(v) || types.isProxy(v)) throw new Error("INVALID_HAILUO02_I2V_SERVICE_COMPOSITION");
  try { const d = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(d); if (Object.getPrototypeOf(v) !== Object.prototype || keys.length !== 2 || !keys.includes("imageReferenceService") || !keys.includes("generationService") || keys.some((k) => typeof k !== "string" || !d[k]!.enumerable || !("value" in d[k]!))) throw new Error();
    const image = d.imageReferenceService!.value, generation = d.generationService!.value;
    if (!(image instanceof OwnerHailuo02I2vImageReferenceService) || Object.getPrototypeOf(image) !== OwnerHailuo02I2vImageReferenceService.prototype || Object.hasOwn(image, "uploadImage") ||
        !isOwnerHailuo02I2vGenerationService(generation)) throw new Error(); return Object.freeze({ imageReferenceService: image, generationService: generation });
  } catch { throw new Error("INVALID_HAILUO02_I2V_SERVICE_COMPOSITION"); } }
function snapshot(v: unknown): unknown { try { return walk(v, 0, { n: 0 }); } catch { return undefined; } }
function walk(v: unknown, depth: number, b: { n: number }): unknown { b.n++; if (b.n > 50_000 || depth > 32) throw new Error(); if (v === null || typeof v === "string" || typeof v === "boolean") return v; if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error(); return v; }
  if (!v || typeof v !== "object" || types.isProxy(v) || (Array.isArray(v) ? Object.getPrototypeOf(v) !== Array.prototype : Object.getPrototypeOf(v) !== Object.prototype)) throw new Error();
  const ds = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> | unknown[] = Array.isArray(v) ? [] : {};
  for (const k of Reflect.ownKeys(ds)) { const d = ds[k as keyof typeof ds]; if (typeof k !== "string" || !d || !("value" in d)) throw new Error(); if (Array.isArray(out)) { if (k === "length") { if (d.enumerable || d.value !== (v as unknown[]).length) throw new Error(); continue; } if (!d.enumerable || !/^(?:0|[1-9]\d*)$/u.test(k)) throw new Error(); out[Number(k)] = walk(d.value, depth + 1, b); }
    else { if (!d.enumerable) throw new Error(); Object.defineProperty(out, k, { value: walk(d.value, depth + 1, b), enumerable: true, writable: true, configurable: true }); } } return out; }
function structured<T>(schema: z.ZodType<T>, v: unknown): CallToolResult { const p = schema.safeParse(snapshot(v)); if (!p.success) return err("OUTPUT_INVALID", "The service returned an invalid response."); return { content: [{ type: "text", text: JSON.stringify(p.data) }], structuredContent: p.data as Record<string, unknown> }; }
function err(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message, ...extra } }) }] }; }
function imageCode(e: unknown): ImageCode { return e instanceof OwnerHailuo02I2vImageReferenceServiceError && Object.hasOwn(imageMessages, e.code) ? e.code : "INVALID_REQUEST"; }
function generationCode(e: unknown): GenerationCode { return e instanceof OwnerHailuo02I2vGenerationServiceError && Object.hasOwn(generationMessages, e.code) ? e.code : "PRE_DISPATCH_FAILED"; }
function imageError(code: ImageCode): CallToolResult { return err(code, imageMessages[code]); }
function generationError(code: GenerationCode, e?: unknown): CallToolResult { const known = e instanceof OwnerHailuo02I2vGenerationServiceError ? e : undefined; return err(code, generationMessages[code], code === "OUTCOME_UNKNOWN" && known?.recovery_id ? { recovery_id: known.recovery_id, ...(known.diagnostic ? { diagnostic: known.diagnostic } : {}) } : {}); }
