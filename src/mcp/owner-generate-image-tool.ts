import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { OwnerGenerationPreflightError, type OwnerGenerationPreflight } from "../application/owner-generation-preflight.js";
import {
  generateOneOwnerImage,
  type OwnerImageModelId,
  type OwnerImageChatClient,
  type OwnerImageSettingsVariant
} from "../application/owner-generate-image.js";
import {
  OwnerImageGenerationOutcomeUnknownError,
  OwnerImageRecoveryNotFoundError,
  reconcileOwnerImageRecovery,
  type OwnerImageRecoveryStoreLike
} from "../application/owner-image-recovery.js";
import { SYNTX_HTTP_ERROR_MESSAGES } from "./syntx-http-error-messages.js";

export const SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME =
  "syntx_owner_generate_image" as const;
export const SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME =
  "syntx_owner_reconcile_image" as const;
export const SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME =
  "syntx_owner_list_image_recovery" as const;

export interface RegisterSyntxOwnerGenerateImageToolOptions {
  /** Server-owned binding must scope the exact attempt; the id is not identity. */
  resolveChatClient: (attemptId: string) => OwnerImageChatClient;
  /** Trusted owner runtime gate; direct unit compositions may omit it. */
  assertGenerationAllowed?: OwnerGenerationPreflight | undefined;
  /** Injectable only for tests; production callers keep the real timer. */
  wait?: ((milliseconds: number) => Promise<void>) | undefined;
  /** Bounded local GET-only reconciliation index for this explicit owner profile. */
  recoveryStore?: OwnerImageRecoveryStoreLike | undefined;
}

const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const VERIFIED_ASPECT_RATIOS = new Set<string>(["1:1", "16:9"]);
const OWNER_IMAGE_MODEL_IDS = ["banana", "banana-2.1", "nano-banana-pro", "gpt-image-1", "gpt-image-1.5", "ideogram", "flux-1", "seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-pro", "grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality", "runway_frames", "wan_26_t2i", "uni-1", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"] as const;
const OWNER_IMAGE_SETTINGS_VARIANTS = ["default", "sunburst-2k-high-16x9", "sunburst-4k-max-21x9", "flare-2k-high-16x9"] as const;

const attemptIdSchema = z
  .string()
  .regex(/^link_[A-Za-z0-9_-]{20,120}$/u)
  .describe("Exact linked attempt returned by syntx_begin_login.");

const artifactSchema = z
  .object({
    url: z.string(),
    mime_type: z.string().optional(),
    byte_size: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    duration_seconds: z.number().optional()
  })
  .strict();

const outputSchema = z
  .object({
    images: z.array(artifactSchema),
    requested_copies: z.number().int().min(1).max(1),
    succeeded_copies: z.number().int().min(0),
    notes: z.array(z.string())
  })
  .strict();

/**
 * Direct, single-step real generation: no separate confirmation step exists
 * beyond the fact that an already-linked owner session made this call (a
 * deliberate choice by the project owner, 2026-09-06 — see решения.md). The
 * omitted model_id uses the current public `banana` profile; the historical
 * `nano-banana-pro` value remains an explicit compatibility alias. model_id="gpt-image-1" is the
 * second narrowly verified profile and routes to provider scope
 * "sora-images" with the exact matching model_type, the exact Ideogram
 * generate-default profile, or Luma Image's exact uni-1 default. No other model
 * id/provider mapping is inferred. SYNTX's own count/n setting was tested
 * live and has no effect. Only one owner-tool copy is allowed until concurrent
 * independent dispatches have themselves been verified live.
 */
export function registerSyntxOwnerGenerateImageTool(
  server: McpServer,
  options: RegisterSyntxOwnerGenerateImageToolOptions
): void {
  server.registerTool(
    SYNTX_OWNER_GENERATE_IMAGE_TOOL_NAME,
    {
      title: "Generate an image (real spend, no separate approval)",
      description:
        "Dispatch one REAL, BILLED SYNTX image generation in its own temporary chat, wait for it to finish, and return direct CDN URLs. Owner image profiles include current public banana, the exact live-observed banana-2.1 settings profile, gpt-image-1, gpt-image-1.5, the Ideogram default generate profile, Flux-1 with its exact reviewed defaults, Seedream-4, Seedream-4.5, Seedream-5 and Seedream-5.0 Pro with their exact reviewed defaults, Grok T2I, Grok T2I Pro and Grok Imagine 2 with their exact reviewed defaults, Runway Frames with its exact reviewed defaults, Wan 2.6 T2I with its exact reviewed defaults, Luma Image uni-1 with its exact reviewed defaults, and GPT Image 2.5 Sunburst and Flare with their exact reviewed defaults. `banana-2.1` accepts only its single observed settings tuple; no broader family settings are inferred. GPT, Ideogram, Flux, Seedream, Grok, Runway, Wan, Luma, and GPT Image 2.5 Sunburst/Flare profiles accept only their exact reviewed settings with aspect_ratio=\"1:1\" unless using their separately verified 2K/high/16:9 settings variant; no other model id/provider scope is accepted. Polling has an absolute budget of about 3 minutes. Calling this tool IS the spend authorization — requires an attempt_id from a completed syntx_begin_login/syntx_check_login pair. If startImage is entered and the result is uncertain, the tool returns OUTCOME_UNKNOWN; do not invoke it again because a new call starts another billed generation. Use the exact-attempt GET-only reconciliation tool and opaque recovery id; recovery is process-local for 15 minutes and does not survive restart. Temporary chats are never auto-deleted.",
      inputSchema: z
        .object({
          link_attempt_id: attemptIdSchema,
          model_id: z
            .enum(OWNER_IMAGE_MODEL_IDS)
            .optional()
            .describe("Optional reviewed public model id; omitted uses the current public banana profile."),
          prompt: z
            .string()
            .trim()
            .min(1)
            .max(4096)
            // Matches chat-http-client.ts's own control-character ban, so a
            // prompt that would fail validateBoundedText() inside
            // startImage() is rejected here first, before a chat is even
            // created for it (critic-code, round 2, 2026-09-06).
            .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/u)
            .describe("Image prompt, sent to SYNTX as-is."),
          copies: z
            .number()
            .int()
            .min(1)
            .max(1)
            .default(1)
            .describe("Fixed at 1 until independent concurrent dispatches are verified live."),
          aspect_ratio: z
            .enum(ASPECT_RATIOS)
            .default("1:1")
            .describe("Reviewed live profiles currently accept only \"1:1\"; Banana also has a separately verified \"16:9\" path."),
          settings_variant: z
            .enum(OWNER_IMAGE_SETTINGS_VARIANTS)
            .default("default")
            .describe("Optional separately reviewed settings variant; Sunburst supports sunburst-2k-high-16x9 and sunburst-4k-max-21x9; Flare supports flare-2k-high-16x9.")
        })
        .strict(),
      outputSchema,
      annotations: {
        title: "Generate an image (real spend, no separate approval)",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (input, { signal }) => {
      try {
        const effectiveModelId = input.model_id ?? "banana";
        if (
          input.settings_variant !== "default" &&
          effectiveModelId !== "gpt-image-2.5-sunburst" &&
          effectiveModelId !== "gpt-image-2.5-flare"
        ) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "INVALID_REQUEST",
                  message: `settings_variant "${input.settings_variant}" is only supported for gpt-image-2.5-sunburst or gpt-image-2.5-flare.`
                }
              })
            }]
          };
        }
        if (
          input.settings_variant === "default" &&
          effectiveModelId !== "banana" &&
          effectiveModelId !== "nano-banana-pro" &&
          input.aspect_ratio !== "1:1"
        ) {
          return {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "INVALID_REQUEST",
                  message: `${effectiveModelId} only supports the live-verified aspect_ratio "1:1".`
                }
              })
            }]
          };
        }
        await options.assertGenerationAllowed?.(input.link_attempt_id, effectiveModelId, signal);
        const chatClient = options.resolveChatClient(input.link_attempt_id);
        const attempts = await Promise.allSettled(
          Array.from({ length: input.copies }, () =>
            generateOneOwnerImage(
              chatClient,
              input.prompt,
              input.aspect_ratio,
              signal,
              options.wait,
              effectiveModelId as OwnerImageModelId,
              input.settings_variant as OwnerImageSettingsVariant,
              options.recoveryStore === undefined ? undefined : {
                store: options.recoveryStore,
                attemptId: input.link_attempt_id,
                modelId: effectiveModelId as OwnerImageModelId
              }
            )
          )
        );
        const unknownOutcome = attempts.find((attempt) =>
          attempt.status === "rejected" && attempt.reason instanceof OwnerImageGenerationOutcomeUnknownError
        );
        if (unknownOutcome?.status === "rejected") return ownerImageUnknownResult(unknownOutcome.reason);
        const transportFailure = attempts.find((attempt) => attempt.status === "rejected" &&
          (attempt.reason instanceof SyntxHttpError || attempt.reason instanceof OwnerGenerationPreflightError));
        if (transportFailure?.status === "rejected") return generateToolError(transportFailure.reason);
        const images = attempts
          .filter((attempt) => attempt.status === "fulfilled")
          .flatMap((attempt) => attempt.value);
        const notes = attempts
          .map((attempt, index) =>
            attempt.status === "rejected"
              ? `copy ${index + 1} of ${input.copies} did not produce a confirmed result.`
              : null
          )
          .filter((note): note is string => note !== null);
        if ((effectiveModelId === "banana" || effectiveModelId === "nano-banana-pro") && !VERIFIED_ASPECT_RATIOS.has(input.aspect_ratio)) {
          notes.push(`aspect_ratio "${input.aspect_ratio}" is unverified; only "1:1" and "16:9" have been confirmed live.`);
        }
        if (images.length === 0) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ error: { code: "GENERATION_FAILED", message: notes.join(" ") } }) }]
          };
        }
        const result = {
          images,
          requested_copies: input.copies,
          succeeded_copies: attempts.filter((attempt) => attempt.status === "fulfilled").length,
          notes
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result
        };
      } catch (error) {
        return generateToolError(error);
      }
    }
  );
}

export function registerSyntxOwnerReconcileImageTool(
  server: McpServer,
  options: RegisterSyntxOwnerGenerateImageToolOptions
): void {
  if (options.recoveryStore === undefined) return;
  server.registerTool(
    SYNTX_OWNER_RECONCILE_IMAGE_TOOL_NAME,
    {
      title: "Reconcile image generation (read only)",
      description: "GET-only recovery for one opaque image recovery id and the exact linked attempt/model. The process-local record expires after 15 minutes and does not survive restart. This tool never checks subscription status, dispatches another generation, deletes a chat, or returns a chat UUID.",
      inputSchema: z.object({
        link_attempt_id: attemptIdSchema,
        model_id: z.enum(OWNER_IMAGE_MODEL_IDS),
        recovery_id: z.string().regex(/^recovery_[0-9a-f-]{36}$/u)
      }).strict(),
      outputSchema,
      annotations: {
        title: "Reconcile image generation (read only)",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (input, { signal }): Promise<CallToolResult> => {
      const record = options.recoveryStore!.get(input.recovery_id, input.link_attempt_id);
      if (record === undefined || record.model_id !== input.model_id) {
        return ownerImageRecoveryNotFoundResult();
      }
      try {
        const client = options.resolveChatClient(input.link_attempt_id);
        const images = await reconcileOwnerImageRecovery(client, record, signal);
        return {
          content: [{ type: "text", text: JSON.stringify({
            images,
            requested_copies: 1,
            succeeded_copies: 1,
            notes: []
          }) }],
          structuredContent: { images, requested_copies: 1, succeeded_copies: 1, notes: [] }
        };
      } catch (error) {
        if (error instanceof OwnerImageGenerationOutcomeUnknownError) return ownerImageUnknownResult(error);
        if (error instanceof OwnerImageRecoveryNotFoundError) return ownerImageRecoveryNotFoundResult();
        if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") return generateToolError(error);
        return ownerImageUnknownResult(new OwnerImageGenerationOutcomeUnknownError(input.recovery_id));
      }
    }
  );

  server.registerTool(
    SYNTX_OWNER_LIST_IMAGE_RECOVERY_TOOL_NAME,
    {
      title: "List pending image recovery handles",
      description: "List this exact linked attempt's recent process-local image recovery handles. This is a bounded in-memory read only: no subscription check, network request, chat UUID, prompt, settings or artifact URL is returned. Handles expire after 15 minutes and are lost on restart.",
      inputSchema: z.object({
        link_attempt_id: attemptIdSchema,
        limit: z.number().int().min(1).max(20).default(20)
      }).strict(),
      outputSchema: z.object({
        recoveries: z.array(z.object({
          recovery_id: z.string().regex(/^recovery_[0-9a-f-]{36}$/u),
          model_id: z.enum(OWNER_IMAGE_MODEL_IDS),
          created_at: z.iso.datetime()
        }).strict()).max(20)
      }).strict(),
      annotations: {
        title: "List pending image recovery handles",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (input): Promise<CallToolResult> => {
      const recoveries = options.recoveryStore!.list(input.link_attempt_id, input.limit).map((record) => ({
        recovery_id: record.recovery_id,
        model_id: record.model_id,
        created_at: record.created_at
      }));
      return { content: [{ type: "text", text: JSON.stringify({ recoveries }) }], structuredContent: { recoveries } };
    }
  );
}

function ownerImageUnknownResult(error: OwnerImageGenerationOutcomeUnknownError): CallToolResult {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({ error: {
        code: "OUTCOME_UNKNOWN",
        message: "The image generation may have been dispatched; do not retry. Reconcile with the exact linked attempt if a recovery id is available.",
        ...(error.recovery_id === undefined ? {} : { recovery_id: error.recovery_id })
      } })
    }]
  };
}

function ownerImageRecoveryNotFoundResult(): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: {
      code: "RECOVERY_NOT_FOUND",
      message: "No matching owner image recovery record is available for this attempt."
    } }) }]
  };
}

function generateToolError(error: unknown): CallToolResult {
  if (error instanceof OwnerImageGenerationOutcomeUnknownError) return ownerImageUnknownResult(error);
  if (error instanceof OwnerImageRecoveryNotFoundError) return ownerImageRecoveryNotFoundResult();
  const code = error instanceof OwnerGenerationPreflightError
    ? error.code
    : error instanceof SyntxHttpError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    ...SYNTX_HTTP_ERROR_MESSAGES,
    INVALID_REQUEST: "The generate request is invalid.",
    MODEL_UNAVAILABLE: "The selected model is unavailable for owner generation.",
    SUBSCRIPTION_REQUIRED: "An active paid SYNTX subscription is required for generation.",
    SUBSCRIPTION_STATUS_UNVERIFIED: "The current SYNTX subscription could not be verified; generation is unavailable."
  };
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          error: { code, message: messages[code] ?? messages.INTERNAL_ERROR }
        })
      }
    ]
  };
}
