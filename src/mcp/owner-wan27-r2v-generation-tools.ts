import { types } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { OwnerWan27R2vGenerationService, OwnerWan27R2vGenerationServiceError, isOwnerWan27R2vGenerationService } from "../application/owner-wan27-r2v-generation-service.js";

const ATTEMPT = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const RECOVERY = z.string().regex(/^wan27_r2v_recovery_[0-9a-f-]{36}$/u);
const MAX_RESULTS = 4096;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const generateInput = z.object({ link_attempt_id: ATTEMPT, model_id: z.literal("wan_27_r2v"), manifest_handle: z.string().regex(/^wan27ref_[A-Za-z0-9_-]{20,120}$/u),
  prompt: z.string().max(1500).optional(), resolution: z.enum(["720P", "1080P"]), aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]),
  video_duration: z.number().int().min(2).max(15), prompt_extend: z.boolean(), seed: z.number().int().min(0).max(2147483647).nullable(), native_audio: z.literal(false) }).strict();
const reconcileInput = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY }).strict();
const listInput = z.object({ link_attempt_id: ATTEMPT, limit: z.number().int().min(1).max(128).optional() }).strict();
const pageInput = z.object({ link_attempt_id: ATTEMPT, recovery_id: RECOVERY, offset: z.number().int().min(0).max(MAX_RESULTS).optional() }).strict();
const diagnostic = z.object({ post_started: z.boolean(), ack_known: z.boolean(), history_status: z.enum(["NOT_READ", "PENDING", "COMPLETE", "INCOMPLETE", "UNVERIFIED"]),
  owner_ack_status: z.enum(["NOT_READ", "MATCHED", "MISSING", "AMBIGUOUS", "MISMATCH"]), history_get_calls: z.number().int().min(0).max(MAX_COUNTER), result_get_calls: z.number().int().min(0).max(MAX_COUNTER), gaps: z.array(z.string().max(128)).max(32) }).strict();
const artifact = z.object({ object_index: z.number().int().min(0), message_object_id: z.string().min(1).max(160), object_type: z.literal("video"), object_url: z.string().url().max(4096),
  mime_type: z.enum(["video/mp4", "video/quicktime"]), message_id: z.string().min(1).max(160), chat_uuid: z.string().min(1).max(160), model_id: z.literal("wan_27_r2v") }).strict();
const resultSchema = z.object({ status: z.literal("completed"), status_semantics: z.literal("LOCAL_OBSERVED_AVAILABILITY_ONLY"), backend_acceptance: z.literal("UNPROVEN"), provider_terminal_status: z.literal("UNPROVEN"),
  cost_cap_enforced: z.literal(false), recovery_id: RECOVERY, model_id: z.literal("wan_27_r2v"), source_binding: z.object({ public_catalog_version: z.string().max(160), profile_schema_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/u), request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u), intent_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict(),
  observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), offset: z.number().int().min(0).max(MAX_RESULTS), page_size: z.number().int().min(1).max(64), artifacts: z.array(artifact).max(64), has_more: z.boolean(), next_offset: z.number().int().min(0).max(MAX_RESULTS).nullable(), diagnostic }).strict();
const recoveryList = z.object({ recoveries: z.array(z.object({ recovery_id: RECOVERY, created_at: z.iso.datetime(), model_id: z.literal("wan_27_r2v"), status: z.enum(["outcome_unknown", "completed"]), observed_artifact_count: z.number().int().min(0).max(MAX_RESULTS), diagnostic }).strict()).max(128) }).strict();

export const SYNTX_OWNER_GENERATE_WAN27_R2V_TOOL_NAME = "syntx_owner_generate_wan27_r2v" as const;
export const SYNTX_OWNER_RECONCILE_WAN27_R2V_TOOL_NAME = "syntx_owner_reconcile_wan27_r2v" as const;
export const SYNTX_OWNER_LIST_WAN27_R2V_RECOVERIES_TOOL_NAME = "syntx_owner_list_wan27_r2v_recoveries" as const;
export const SYNTX_OWNER_GET_WAN27_R2V_RESULT_PAGE_TOOL_NAME = "syntx_owner_get_wan27_r2v_result_page" as const;
export const OWNER_WAN27_R2V_GENERATION_TOOL_NAMES = Object.freeze([SYNTX_OWNER_GENERATE_WAN27_R2V_TOOL_NAME, SYNTX_OWNER_RECONCILE_WAN27_R2V_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN27_R2V_RECOVERIES_TOOL_NAME, SYNTX_OWNER_GET_WAN27_R2V_RESULT_PAGE_TOOL_NAME] as const);
export interface OwnerWan27R2vGenerationToolComposition { readonly generationService: OwnerWan27R2vGenerationService; }

export function registerSyntxOwnerWan27R2vGenerationTools(server: McpServer, input: unknown): void {
  const service = exactService(input);
  server.registerTool(SYNTX_OWNER_GENERATE_WAN27_R2V_TOOL_NAME, { title: "Generate WAN 2.7 R2V video", description: "Starts one owner generation. For an unknown outcome, reconcile by recovery ID and never retry generation.", inputSchema: generateInput, outputSchema: resultSchema,
    annotations: { title: "Generate WAN 2.7 R2V video", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }, async (raw, { signal }) => {
      const parsed = generateInput.safeParse(snapshot(raw)); if (!parsed.success) return generationError("INVALID_REQUEST"); const v = parsed.data;
      try { return structured(resultSchema, await service.generate({ attemptId: v.link_attempt_id, request: { model_id: v.model_id, manifest_handle: v.manifest_handle, ...(v.prompt === undefined ? {} : { prompt: v.prompt }), parameters: { resolution: v.resolution, aspect_ratio: v.aspect_ratio, video_duration: v.video_duration, prompt_extend: v.prompt_extend, seed: v.seed, native_audio: false } } }, signal)); }
      catch (error) { return generationError(generationCode(error), error); }
    });
  server.registerTool(SYNTX_OWNER_RECONCILE_WAN27_R2V_TOOL_NAME, { title: "Reconcile WAN 2.7 R2V generation", description: "GET-only recovery; this command never starts or repeats generation.", inputSchema: reconcileInput, outputSchema: resultSchema,
    annotations: { title: "Reconcile WAN 2.7 R2V generation", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async (raw, { signal }) => {
      const p = reconcileInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(resultSchema, await service.reconcile({ attemptId: p.data.link_attempt_id, recovery_id: p.data.recovery_id }, signal)); } catch (error) { return generationError(generationCode(error), error); }
    });
  server.registerTool(SYNTX_OWNER_LIST_WAN27_R2V_RECOVERIES_TOOL_NAME, { title: "List WAN 2.7 R2V recoveries", description: "Lists bounded local recovery summaries without result URLs.", inputSchema: listInput, outputSchema: recoveryList,
    annotations: { title: "List WAN 2.7 R2V recoveries", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
      const p = listInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(recoveryList, { recoveries: await service.listRecoveries({ attemptId: p.data.link_attempt_id, ...(p.data.limit === undefined ? {} : { limit: p.data.limit }) }) }); } catch (error) { return generationError(generationCode(error), error); }
    });
  server.registerTool(SYNTX_OWNER_GET_WAN27_R2V_RESULT_PAGE_TOOL_NAME, { title: "Get WAN 2.7 R2V result page", description: "Reads one bounded page from the local result cache; backend completion remains unproven.", inputSchema: pageInput, outputSchema: resultSchema,
    annotations: { title: "Get WAN 2.7 R2V result page", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async (raw) => {
      const p = pageInput.safeParse(snapshot(raw)); if (!p.success) return generationError("INVALID_REQUEST"); try { return structured(resultSchema, await service.getResultPage({ attemptId: p.data.link_attempt_id, recovery_id: p.data.recovery_id, ...(p.data.offset === undefined ? {} : { offset: p.data.offset }) })); } catch (error) { return generationError(generationCode(error), error); }
    });
}

type GenerationCode = "INVALID_REQUEST" | "SERVICE_CLOSED" | "SERVICE_BUSY" | "PRINCIPAL_NOT_LINKED" | "MODEL_BINDING_MISMATCH" | "PREFLIGHT_FAILED" | "INTENT_ALREADY_CLAIMED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "RECOVERY_NOT_FOUND";
const messages: Record<GenerationCode, string> = { INVALID_REQUEST: "The WAN 2.7 R2V request is invalid.", SERVICE_CLOSED: "The generation service is closed.", SERVICE_BUSY: "The generation service is busy.", PRINCIPAL_NOT_LINKED: "A currently linked owner attempt is required.", MODEL_BINDING_MISMATCH: "The selected model binding is unavailable.", PREFLIGHT_FAILED: "Current account or model access could not be verified.", INTENT_ALREADY_CLAIMED: "This generation intent has an unresolved outcome.", PRE_DISPATCH_FAILED: "The request was not safely dispatched.", OUTCOME_UNKNOWN: "The request may have been dispatched; reconcile its recovery and do not retry.", RECOVERY_NOT_FOUND: "The recovery is unavailable or expired." };
function exactService(input: unknown): OwnerWan27R2vGenerationService { if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) throw new Error("OWNER_WAN27_R2V_GENERATION_COMPOSITION_INVALID"); try { const d = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(d); if (Object.getPrototypeOf(input) !== Object.prototype || keys.length !== 1 || keys[0] !== "generationService" || !d.generationService!.enumerable || !("value" in d.generationService!)) throw new Error(); const service = d.generationService!.value; if (!isOwnerWan27R2vGenerationService(service)) throw new Error(); return service; } catch { throw new Error("OWNER_WAN27_R2V_GENERATION_COMPOSITION_INVALID"); } }
function snapshot(value: unknown): unknown { try { return walk(value, 0, { count: 0 }); } catch { return undefined; } }
function walk(value: unknown, depth: number, budget: { count: number }): unknown {
  budget.count += 1; if (budget.count > 50_000 || depth > 32) throw new Error();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error(); return value; }
  if (!value || typeof value !== "object" || types.isProxy(value)) throw new Error();
  const prototype = Object.getPrototypeOf(value); if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value), output: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key as keyof typeof descriptors]; if (typeof key !== "string" || !descriptor || !("value" in descriptor)) throw new Error();
    if (Array.isArray(output)) {
      if (key === "length") { if (descriptor.enumerable || descriptor.value !== (value as unknown[]).length) throw new Error(); continue; }
      if (!descriptor.enumerable || !/^(?:0|[1-9]\d*)$/u.test(key)) throw new Error(); output[Number(key)] = walk(descriptor.value, depth + 1, budget);
    } else { if (!descriptor.enumerable) throw new Error(); Object.defineProperty(output, key, { value: walk(descriptor.value, depth + 1, budget), enumerable: true, writable: true, configurable: true }); }
  }
  return output;
}
function structured<T extends z.ZodType>(schema: T, value: unknown): CallToolResult { const parsed = schema.safeParse(snapshot(value)); if (!parsed.success) return failure("OUTPUT_INVALID"); const data = parsed.data as Record<string, unknown>; return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }; }
function generationCode(error: unknown): GenerationCode { return error instanceof OwnerWan27R2vGenerationServiceError && Object.hasOwn(messages, error.code) ? error.code : "PRE_DISPATCH_FAILED"; }
function generationError(code: GenerationCode, error?: unknown): CallToolResult { const known = error instanceof OwnerWan27R2vGenerationServiceError ? error : undefined; const recovery = known?.recovery_id && RECOVERY.safeParse(known.recovery_id).success ? known.recovery_id : undefined; const safeDiagnostic = known?.diagnostic ? diagnostic.safeParse(snapshot(known.diagnostic)) : undefined; const body = { error: { code, message: messages[code], ...(code === "OUTCOME_UNKNOWN" && recovery ? { recovery_id: recovery, ...(safeDiagnostic?.success ? { diagnostic: safeDiagnostic.data } : {}) } : {}) } }; return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] }; }
function failure(code: string): CallToolResult { return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "The generation service returned an invalid response." } }) }] }; }
