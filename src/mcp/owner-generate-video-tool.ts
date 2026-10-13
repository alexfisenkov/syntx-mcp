import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { OwnerGenerationPreflightError, type OwnerGenerationPreflight } from "../application/owner-generation-preflight.js";
import { OwnerVideoOutcomeUnknownError, generateOneOwnerVideoForModel, type OwnerVideoChatClient } from "../application/owner-generate-video.js";
import { OwnerVideoRecoveryStore, reconcileOwnerVideoRecovery, type OwnerVideoRecoveryStoreLike } from "../application/owner-video-recovery.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME = "syntx_owner_generate_video" as const;
export const SYNTX_OWNER_RECONCILE_VIDEO_TOOL_NAME = "syntx_owner_reconcile_video" as const;
export interface RegisterSyntxOwnerGenerateVideoToolOptions { resolveChatClient: (attemptId: string) => OwnerVideoChatClient; assertGenerationAllowed?: OwnerGenerationPreflight | undefined; wait?: (milliseconds: number) => Promise<void>; recoveryStore?: OwnerVideoRecoveryStoreLike; }
const attemptIdSchema = z.string().regex(/^link_[A-Za-z0-9_-]{20,120}$/u);
const recoveryIdSchema = z.string().regex(/^recovery_[0-9a-f-]{36}$/u);
const artifactSchema = z.object({ url: z.string(), mime_type: z.string().optional(), byte_size: z.number().optional(), width: z.number().optional(), height: z.number().optional(), duration_seconds: z.number().optional() }).strict();
const outputSchema = z.object({ videos: z.array(artifactSchema), requested_copies: z.literal(1), succeeded_copies: z.number().int().min(0).max(1), notes: z.array(z.string()) }).strict();

export function registerSyntxOwnerGenerateVideoTool(server: McpServer, options: RegisterSyntxOwnerGenerateVideoToolOptions): void {
  const recoveryStore = options.recoveryStore ?? new OwnerVideoRecoveryStore();
  server.registerTool(SYNTX_OWNER_GENERATE_VIDEO_TOOL_NAME, {
    title: "Generate a video (real spend, no separate approval)",
    description: "Dispatch one REAL, BILLED owner video generation. Live-verified text-only exact profiles are seedance-2.0 (720p, mini, 16:9, 5 seconds, audio enabled), seedance-1.5-pro (720p, 16:9, 5 seconds, audio disabled), seedance_pro and seedance_pro-fast (720p, mini, 16:9, 5 seconds, audio enabled), kling_text2video (Kling 3.0-turbo, standard text-to-video, 16:9, 5 seconds, native audio disabled), ray-3.14 (Luma, 720p, 16:9, 5 seconds, text2video), sora_1 (Sora, 720 quality, 16:9, 10 seconds, text2video), wan_26_t2v (Wan Video, 720P, 1:1, 5 seconds, prompt extension, single shot, automatic audio setting), wan_27_t2v (Wan Video, 1080P, 1:1, 5 seconds, prompt extension, single shot, automatic audio setting), flux3_t2v (Flux 3 Video, HD, automatic aspect ratio, 5 seconds, audio enabled), happy_horse_t2v (Happy Horse, 720P, 16:9, 5 seconds, native audio disabled), text2video (Runway, 5 seconds, aspect ratio 1, default seed), and text2video-4.5 (Runway, 5 seconds, aspect ratio 169, default seed). One copy is fixed. This tool is separately opt-in and leaves a dispatched chat in place on uncertain outcome.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema.describe("Exact linked attempt returned by syntx_begin_login."), model_id: z.enum(["seedance-2.0", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "kling_text2video", "ray-3.14", "sora_1", "wan_26_t2v", "wan_27_t2v", "flux3_t2v", "happy_horse_t2v", "text2video", "text2video-4.5"]).default("seedance-2.0"), prompt: z.string().trim().min(1).max(4096).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u), copies: z.literal(1).default(1) }).strict(),
    outputSchema,
    annotations: { title: "Generate a video (real spend, no separate approval)", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  }, async (input, { signal }) => {
    try {
      await options.assertGenerationAllowed?.(input.link_attempt_id, input.model_id, signal);
      const chatClient = options.resolveChatClient(input.link_attempt_id);
      let reservedRecoveryId: string | undefined;
      const video = await generateOneOwnerVideoForModel(
        chatClient,
        input.model_id,
        input.prompt,
        signal,
        options.wait,
        (chatUuid, modelId, messageId) => reservedRecoveryId ?? recoveryStore.create({
          attempt_id: input.link_attempt_id,
          chat_uuid: chatUuid,
          model_id: modelId,
          message_id: messageId
        }).recovery_id,
        {
          reserve: (chatUuid, modelId) => {
            reservedRecoveryId = recoveryStore.create({ attempt_id: input.link_attempt_id, chat_uuid: chatUuid, model_id: modelId }).recovery_id;
            return reservedRecoveryId;
          },
          updateMessageId: (recoveryId, messageId) => recoveryStore.updateMessageId?.(recoveryId, input.link_attempt_id, messageId),
          remove: (recoveryId) => recoveryStore.remove?.(recoveryId, input.link_attempt_id)
        }
      );
      const result = { videos: video, requested_copies: 1 as const, succeeded_copies: 1, notes: [] as string[] };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      const code = error instanceof OwnerGenerationPreflightError ? error.code : error instanceof OwnerVideoOutcomeUnknownError ? "OUTCOME_UNKNOWN" : error instanceof SyntxHttpError ? error.code : "GENERATION_FAILED";
      const messages: Record<string, string> = { ...SYNTX_HTTP_ERROR_MESSAGES, MODEL_UNAVAILABLE: "The selected model is unavailable for owner generation.", SUBSCRIPTION_REQUIRED: "An active paid SYNTX subscription is required for generation.", SUBSCRIPTION_STATUS_UNVERIFIED: "The current SYNTX subscription could not be verified; generation is unavailable.", GENERATION_FAILED: "The video generation failed.", INTERNAL_ERROR: "The video generation failed.", OUTCOME_UNKNOWN: "The video generation may have been dispatched; use the recovery tool before retrying." };
      const payload: { error: { code: string; message: string; recovery_id?: string } } = { error: { code, message: messages[code] ?? "The video generation failed." } };
      if (error instanceof OwnerVideoOutcomeUnknownError && error.recovery_id !== undefined) payload.error.recovery_id = error.recovery_id;
      return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
    }
  });
}

export interface RegisterSyntxOwnerReconcileVideoToolOptions { resolveChatClient: (attemptId: string) => OwnerVideoChatClient; recoveryStore: OwnerVideoRecoveryStoreLike; }

export function registerSyntxOwnerReconcileVideoTool(server: McpServer, options: RegisterSyntxOwnerReconcileVideoToolOptions): void {
  server.registerTool(SYNTX_OWNER_RECONCILE_VIDEO_TOOL_NAME, {
    title: "Reconcile an unknown video",
    description: "Read-only recovery for a previously dispatched owner video. It only performs bounded list/get reads; it never creates chats, posts a generation, deletes a chat, retries, or spends tokens.",
    inputSchema: z.object({ link_attempt_id: attemptIdSchema, recovery_id: recoveryIdSchema }).strict(),
    outputSchema,
    annotations: { title: "Reconcile an unknown video", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }, async (input, { signal }) => {
    const record = options.recoveryStore.get(input.recovery_id, input.link_attempt_id);
    if (record === undefined) return unknownRecoveryResult(input.recovery_id);
    try {
      const videos = await reconcileOwnerVideoRecovery(options.resolveChatClient(input.link_attempt_id), record, signal);
      if (videos.length === 0) return unknownRecoveryResult(record.recovery_id);
      const result = { videos, requested_copies: 1 as const, succeeded_copies: 1, notes: ["Recovered using read-only list/get reconciliation."] };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    } catch { return unknownRecoveryResult(record.recovery_id); }
  });
}

function unknownRecoveryResult(recoveryId: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "OUTCOME_UNKNOWN", message: "The video generation outcome remains unknown; do not retry automatically.", recovery_id: recoveryId } }) }] };
}
