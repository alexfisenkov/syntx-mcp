import { randomUUID } from "node:crypto";
import type {
  ChatMutationReceipt,
  CreateChatReceipt,
  InProgressMessage,
  MediaGenerationReceipt,
  RedactedMessageEnvelope,
  SafeArtifactMetadata,
  StartImageRequest
} from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import {
  canonicalizeRuntimeCoverageModelId,
  getRuntimeCoverageProfile
} from "../catalog/runtime-coverage-registry.js";
import {
  OwnerImageGenerationOutcomeUnknownError,
  type OwnerImageRecoveryStoreLike
} from "./owner-image-recovery.js";

/** Narrow, structural subset of SyntxChatHttpClient this module actually uses. */
export interface OwnerImageChatClient {
  createChat(
    scope: "image",
    title: string,
    signal?: AbortSignal
  ): Promise<CreateChatReceipt>;
  deleteChat(chatUuid: string, signal?: AbortSignal): Promise<ChatMutationReceipt>;
  startImage(
    request: StartImageRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
  listInProgress(
    chatUuid: string,
    signal?: AbortSignal
  ): Promise<InProgressMessage[]>;
  getMessage(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<RedactedMessageEnvelope>;
}

/**
 * The owner image model ids with a narrow observed live profile. `banana` is
 * the current public model identity and routes to the `banana` provider
 * scope. The historical `nano-banana-pro` identity remains an explicit
 * compatibility alias only; it is not part of the current runtime coverage
 * registry. `banana-2.1` is a separate exact settings profile, not a generic
 * Banana-family settings contract. Both GPT Image ids route to the `sora-images` provider scope.
 * Do not infer additional mappings here.
 */
export type OwnerImageModelId =
  | "banana"
  | "banana-2.1"
  | "nano-banana-pro"
  | "gpt-image-1"
  | "gpt-image-1.5"
  | "ideogram"
  | "flux-1"
  | "seedream-4"
  | "seedream-4.5"
  | "seedream-5"
  | "seedream-5.0-pro"
  | "grok_t2i"
  | "grok_t2i_pro"
  | "grok_imagine_2"
  | "grok_imagine_quality"
  | "runway_frames"
  | "wan_26_t2i"
  | "uni-1"
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.5-flare";

export type OwnerImageSettingsVariant =
  | "default"
  | "sunburst-2k-high-16x9"
  | "sunburst-4k-max-21x9"
  | "flare-2k-high-16x9";

export interface OwnerImageRecoveryContext {
  readonly store: OwnerImageRecoveryStoreLike;
  readonly attemptId: string;
  /** Exact caller-selected id, including a supported legacy alias. */
  readonly modelId: OwnerImageModelId;
}

const OWNER_IMAGE_MODEL_IDS = new Set<OwnerImageModelId>([
  "banana",
  "banana-2.1",
  "nano-banana-pro",
  "gpt-image-1",
  "gpt-image-1.5",
  "ideogram",
  "flux-1",
  "seedream-4",
  "seedream-4.5",
  "seedream-5",
  "seedream-5.0-pro",
  "grok_t2i",
  "grok_t2i_pro",
  "grok_imagine_2",
  "grok_imagine_quality",
  "runway_frames",
  "wan_26_t2i",
  "uni-1",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare"
]);

export function isOwnerImageModelId(value: string): value is OwnerImageModelId {
  return OWNER_IMAGE_MODEL_IDS.has(value as OwnerImageModelId);
}

/**
 * Direct, single-step real generation, deliberately separate from
 * ApplicationCore/SyntxUpstreamAdapter: no idempotency key, no durable
 * saga, no confirmation store. A repeated call is a repeated real dispatch,
 * not a replay (decision 2026-09-06, решения.md). The live profiles include
 * the current `banana` profile and one separate exact `banana-2.1` 1K/minimal
 * settings tuple, GPT Image 1/1.5 and the Ideogram default generate profile; SYNTX's own count/n setting was tested live and
 * has no effect — callers loop this function instead
 * (docs/интеграция/наблюдение-banana-generation-2026-09-06.md). A generated
 * CDN URL has been confirmed live to survive its chat's deletion for at
 * least a few hours (2026-09-06, four URLs from earlier real generations,
 * all still HTTP 200 after their chats were deleted) — longer-term
 * retention is NOT confirmed, so the chat is deliberately NOT deleted on
 * the success path either (critic-risk, round 2, 2026-09-06): losing the
 * only remaining lead to a paid result is worse than an accumulated,
 * harmless empty chat. See DEBT-055.
 */

const IN_PROGRESS_POLL_ATTEMPTS = 20;
const IN_PROGRESS_POLL_DELAY_MS = 2_000;
// Keep the normal poll window below the 180-second absolute deadline so a
// terminal result can still receive a brief reconciliation read.
const ARTIFACT_POLL_ATTEMPTS = 59;
const ARTIFACT_POLL_DELAY_MS = 3_000;
const ARTIFACT_RECONCILIATION_ATTEMPTS = 2;
const ARTIFACT_RECONCILIATION_DELAY_MS = 1_000;
const OWNER_IMAGE_POLL_DEADLINE_MS = 180_000;
const SAFE_RESPONSE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;

export class GenerationFinishedWithoutArtifactError extends OwnerImageGenerationOutcomeUnknownError {
  constructor(recoveryId?: string) {
    // Deliberately does not assert a specific cause: the generation could
    // have genuinely failed (rejected/moderated/provider error), OR
    // produced an artifact that redactMessage() filtered out (unexpected
    // host/type — critic-code, round 2, 2026-09-06). Either way, this
    // function cannot tell which, so it does not claim to.
    super(recoveryId);
    this.name = "OwnerImageGenerationOutcomeUnknownError";
  }
}

export async function generateOneOwnerImage(
  chatClient: OwnerImageChatClient,
  prompt: string,
  aspectRatio: string,
  signal: AbortSignal | undefined,
  /** Injectable only for tests; production callers use the real timer. */
  wait: (milliseconds: number) => Promise<void> = delay,
  modelId: OwnerImageModelId = "banana",
  settingsVariant: OwnerImageSettingsVariant = "default",
  recovery?: OwnerImageRecoveryContext
): Promise<SafeArtifactMetadata[]> {
  // Validate the profile and its settings before creating a chat or reaching
  // the paid POST. This is deliberately fail-closed for unknown models and
  // for settings not covered by the live contract.
  const imageRequest = ownerImageRequest(modelId, aspectRatio, prompt, settingsVariant);
  throwIfAbortedBeforeDispatch(signal);
  const chat = await chatClient.createChat(
    "image",
    `owner-generate-${randomUUID()}`,
    signal
  );
  // Set before the dispatch call, not after it resolves: #startMedia parses
  // the HTTP response only after the request already completed, so a
  // protocol error or timeout there can follow a real, already-billed
  // dispatch. Treating that as "nothing was billed" was the exact mistake
  // that destroyed a prior real generation's only access (see решения.md);
  // it is fixed here, not just in the diagnostic script.
  let dispatched = false;
  let recoveryId: string | undefined;
  try {
    // A client port may ignore cancellation and resolve createChat after the
    // caller has already aborted. Recheck before reserving or dispatching.
    throwIfAbortedBeforeDispatch(signal);
    if (recovery !== undefined) {
      const canonicalModelId = canonicalizeRuntimeCoverageModelId(modelId);
      const profile = getRuntimeCoverageProfile(canonicalModelId);
      if (!profile || profile.modality !== "image") throw new Error("owner image recovery profile unavailable");
      recoveryId = recovery.store.create({
        attempt_id: recovery.attemptId,
        chat_uuid: chat.chat_uuid,
        model_id: recovery.modelId,
        model_type: String(imageRequest.settings.model_type),
        mime_types: profile.result_mime_types,
        message_id: null
      }).recovery_id;
    }
    throwIfAbortedBeforeDispatch(signal);
    dispatched = true;
    const dispatch = await chatClient.startImage(
      { ...imageRequest, chat_uuid: chat.chat_uuid },
      signal
    );
    if (!SAFE_RESPONSE_IDENTIFIER.test(dispatch?.message_id) || dispatch.chat_uuid !== chat.chat_uuid) {
      throw new OwnerImageGenerationOutcomeUnknownError(recoveryId);
    }
    if (recovery !== undefined && recoveryId !== undefined) {
      recovery.store.updateMessageId(recoveryId, recovery.attemptId, dispatch.message_id);
    }
    const deadline = new AbsoluteRequestDeadline(
      OWNER_IMAGE_POLL_DEADLINE_MS,
      signal,
      (source) =>
        new Error(
          source === "external"
            ? "owner image generation polling was aborted"
            : "timed out waiting for the generation to finish"
        )
    );
    try {
      const botMessageId = await waitForBotMessageId(
        chatClient,
        chat.chat_uuid,
        dispatch.message_id,
        deadline,
        wait,
        recoveryId
      );
      if (recovery !== undefined && recoveryId !== undefined) {
        recovery.store.updateMessageId(recoveryId, recovery.attemptId, botMessageId);
      }
      const artifacts = await waitForArtifacts(
        chatClient,
        chat.chat_uuid,
        botMessageId,
        deadline,
        wait
      );
      // Not deleting on success either, pending longer-term CDN retention
      // confirmation — see class doc above.
      if (recovery !== undefined && recoveryId !== undefined) {
        try { recovery.store.remove?.(recoveryId, recovery.attemptId); } catch { /* Successful results stay successful; TTL bounds stale local handles. */ }
      }
      return artifacts;
    } finally {
      deadline.close();
    }
  } catch (error) {
    if (!dispatched) {
      if (recovery !== undefined && recoveryId !== undefined) {
        try { recovery.store.remove?.(recoveryId, recovery.attemptId); } catch { /* Do not keep a misleading reserved handle after a pre-dispatch abort. */ }
      }
      // Nothing was billed yet; safe to clean up the still-empty chat.
      await chatClient.deleteChat(chat.chat_uuid, signal).catch(() => undefined);
      throw error;
    }
    // Once startImage is entered, receipt parsing, timeout, external abort and
    // result polling can all fail after a billed dispatch. Keep the chat and
    // the recovery pointer, and never echo raw errors, prompts or chat UUIDs.
    if (error instanceof GenerationFinishedWithoutArtifactError) {
      throw new GenerationFinishedWithoutArtifactError(recoveryId);
    }
    throw new OwnerImageGenerationOutcomeUnknownError(recoveryId);
  }
}

function throwIfAbortedBeforeDispatch(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new SyntxHttpError("UPSTREAM_REQUEST_ABORTED", "The image request was canceled before generation dispatch.");
  }
}

function ownerImageRequest(
  modelId: string,
  aspectRatio: string,
  prompt: string,
  settingsVariant: OwnerImageSettingsVariant
): Pick<StartImageRequest, "ai_name" | "prompt" | "settings"> {
  if (!isOwnerImageModelId(modelId)) {
    throw new Error("owner image model_id is not live-verified");
  }
  const canonicalModelId = canonicalizeRuntimeCoverageModelId(modelId);
  const profile = getRuntimeCoverageProfile(canonicalModelId);
  if (!profile || profile.modality !== "image") {
    throw new Error("owner image model_id is not live-verified");
  }
  if (
    settingsVariant !== "default" &&
    canonicalModelId !== "gpt-image-2.5-sunburst" &&
    canonicalModelId !== "gpt-image-2.5-flare"
  ) {
    throw new Error(
      `settings_variant "${settingsVariant}" is only supported for gpt-image-2.5-sunburst or gpt-image-2.5-flare`
    );
  }
  if (settingsVariant !== "default") {
    const variant = profile.settings_variants?.find(
      (candidate) => candidate.id === settingsVariant
    );
    if (!variant) {
      throw new Error("owner image settings_variant is not live-verified");
    }
    return {
      ai_name: profile.ai_name,
      prompt,
      settings: { ...variant.settings }
    };
  }
  if (canonicalModelId !== "banana" && aspectRatio !== "1:1") {
    throw new Error(`${canonicalModelId} only supports the live-verified aspect_ratio "1:1"`);
  }
  return {
    ai_name: profile.ai_name,
    prompt,
    settings:
      canonicalModelId === "banana" && aspectRatio !== "1:1"
        ? { ...profile.settings, aspect_ratio: aspectRatio }
        : { ...profile.settings }
  };
}

async function waitForBotMessageId(
  chatClient: OwnerImageChatClient,
  chatUuid: string,
  echoedMessageId: string,
  deadline: AbsoluteRequestDeadline,
  wait: (milliseconds: number) => Promise<void>,
  recoveryId?: string
): Promise<string> {
  for (let attempt = 0; attempt < IN_PROGRESS_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await waitWithinDeadline(deadline, wait, IN_PROGRESS_POLL_DELAY_MS);
    const inProgress = await callWithinDeadline(deadline, (requestSignal) => chatClient.listInProgress(chatUuid, requestSignal));
    const candidate = inProgress.find(
      (entry) => entry.message_id !== echoedMessageId
    );
    if (candidate) return candidate.message_id;
  }
  throw new OwnerImageGenerationOutcomeUnknownError(recoveryId);
}

/**
 * Two independent terminal signals, matching
 * docs/интеграция/наблюдение-banana-generation-2026-09-06.md: an artifact
 * appearing is the positive signal; disappearing from listInProgress
 * (already confirmed present by waitForBotMessageId) without ever producing
 * one is the negative signal — completed=true alone does not distinguish
 * success from a rejected/moderated/failed generation, and waiting out the
 * full timeout for the latter would needlessly hold the tool call open.
 */
async function waitForArtifacts(
  chatClient: OwnerImageChatClient,
  chatUuid: string,
  messageId: string,
  deadline: AbsoluteRequestDeadline,
  wait: (milliseconds: number) => Promise<void>,
  recoveryId?: string
): Promise<SafeArtifactMetadata[]> {
  for (let attempt = 0; attempt < ARTIFACT_POLL_ATTEMPTS; attempt += 1) {
    await waitWithinDeadline(deadline, wait, ARTIFACT_POLL_DELAY_MS);
    // listInProgress is read BEFORE getMessage, not after: reading it after
    // opened a race where the generation could complete between the two
    // reads, making a genuinely successful result look like "gone without
    // an artifact" (critic-code, round 2, 2026-09-06). With this order, the
    // artifact check below always uses the more recent read, so it can
    // only be negative once both reads agree the generation is over.
    const inProgress = await callWithinDeadline(deadline, (requestSignal) => chatClient.listInProgress(chatUuid, requestSignal));
    const stillInProgress = inProgress.some((entry) => entry.message_id === messageId);
    const message = await callWithinDeadline(deadline, (requestSignal) => chatClient.getMessage(chatUuid, messageId, requestSignal));
    if (message.artifacts.length > 0) return message.artifacts;
    if (!stillInProgress) {
      const reconciled = await reconcileArtifacts(
        chatClient,
        chatUuid,
        messageId,
        deadline,
        wait
      );
      if (reconciled.length > 0) return reconciled;
      throw new GenerationFinishedWithoutArtifactError(recoveryId);
    }
  }
  throw new OwnerImageGenerationOutcomeUnknownError(recoveryId);
}

/** A short read-only grace period for an eventually consistent terminal GET. */
async function reconcileArtifacts(
  chatClient: OwnerImageChatClient,
  chatUuid: string,
  messageId: string,
  deadline: AbsoluteRequestDeadline,
  wait: (milliseconds: number) => Promise<void>
): Promise<SafeArtifactMetadata[]> {
  for (let attempt = 0; attempt < ARTIFACT_RECONCILIATION_ATTEMPTS; attempt += 1) {
    await waitWithinDeadline(deadline, wait, ARTIFACT_RECONCILIATION_DELAY_MS);
    const message = await callWithinDeadline(deadline, (requestSignal) => chatClient.getMessage(chatUuid, messageId, requestSignal));
    if (message.artifacts.length > 0) return message.artifacts;
  }
  return [];
}

async function callWithinDeadline<T>(deadline: AbsoluteRequestDeadline, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  deadline.throwIfAborted();
  return deadline.waitFor(operation(deadline.signal));
}

async function waitWithinDeadline(
  deadline: AbsoluteRequestDeadline,
  wait: (milliseconds: number) => Promise<void>,
  milliseconds: number
): Promise<void> {
  deadline.throwIfAborted();
  await deadline.waitFor(wait(milliseconds));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
