import { randomUUID } from "node:crypto";
import type {
  ChatMutationReceipt,
  CreateChatReceipt,
  InProgressMessage,
  MediaGenerationReceipt,
  RedactedMessageEnvelope,
  SafeArtifactMetadata,
  StartVideoRequest
} from "../adapter/syntx/chat-http-client.js";
import { AbsoluteRequestDeadline } from "../adapter/syntx/request-deadline.js";
import { getRuntimeCoverageProfile } from "../catalog/runtime-coverage-registry.js";

export interface OwnerVideoChatClient {
  createChat(scope: "video", title: string, signal?: AbortSignal): Promise<CreateChatReceipt>;
  deleteChat(chatUuid: string, signal?: AbortSignal): Promise<ChatMutationReceipt>;
  startVideo(request: StartVideoRequest, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
  listInProgress(chatUuid: string, signal?: AbortSignal): Promise<InProgressMessage[]>;
  getMessage(chatUuid: string, messageId: string, signal?: AbortSignal): Promise<RedactedMessageEnvelope>;
}

export interface OwnerVideoRecoveryContext {
  reserve(chatUuid: string, modelId: OwnerVideoModelId): string;
  updateMessageId?(recoveryId: string, messageId: string): void;
  remove?(recoveryId: string): void;
}

export const OWNER_VIDEO_MODEL_IDS = ["seedance-2.0", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "kling_text2video", "ray-3.14", "sora_1", "wan_26_t2v", "wan_27_t2v", "flux3_t2v", "happy_horse_t2v", "text2video", "text2video-4.5"] as const;
export type OwnerVideoModelId = (typeof OWNER_VIDEO_MODEL_IDS)[number];
export const OWNER_VIDEO_MODEL_ID = "seedance-2.0" as const;

export interface OwnerVideoProfile {
  readonly model_id: OwnerVideoModelId;
  readonly ai_name: "seedance" | "kling" | "luma" | "sora" | "wan_video" | "flux3_video" | "happy_horse" | "runway";
  readonly settings: Readonly<Record<string, unknown>>;
}

export function getOwnerVideoProfile(modelId: string): OwnerVideoProfile | undefined {
  const profile = getRuntimeCoverageProfile(modelId);
  if (!profile || profile.modality !== "video") return undefined;
  return {
    model_id: profile.model_id as OwnerVideoModelId,
    ai_name: profile.ai_name as OwnerVideoProfile["ai_name"],
    settings: profile.settings
  };
}
const POLL_ATTEMPTS = 59;
const POLL_DELAY_MS = 3_000;
const START_ATTEMPTS = 20;
const START_DELAY_MS = 2_000;
const ARTIFACT_RECONCILIATION_ATTEMPTS = 2;
const ARTIFACT_RECONCILIATION_DELAY_MS = 1_000;
const DEADLINE_MS = 180_000;

/**
 * A dispatch may have reached SYNTX even when the local caller cannot prove
 * its terminal outcome.  This error deliberately carries no chat identifier:
 * the MCP boundary must not reveal reconciliation handles to a client.
 */
export class OwnerVideoOutcomeUnknownError extends Error {
  readonly recovery_id: string | undefined;

  constructor(recoveryId?: string) {
    super("The video generation may have been dispatched; do not retry automatically.");
    this.name = "OwnerVideoOutcomeUnknownError";
    this.recovery_id = recoveryId;
  }
}

export async function generateOneOwnerVideo(
  client: OwnerVideoChatClient,
  prompt: string,
  signal?: AbortSignal,
  wait: (milliseconds: number) => Promise<void> = delay
): Promise<SafeArtifactMetadata[]> {
  return generateOneOwnerVideoForModel(client, OWNER_VIDEO_MODEL_ID, prompt, signal, wait);
}

export async function generateOneOwnerVideoForModel(
  client: OwnerVideoChatClient,
  modelId: string,
  prompt: string,
  signal?: AbortSignal,
  wait: (milliseconds: number) => Promise<void> = delay,
  onOutcomeUnknown?: (chatUuid: string, modelId: OwnerVideoModelId, messageId: string | null) => string,
  recovery?: OwnerVideoRecoveryContext
): Promise<SafeArtifactMetadata[]> {
  const model = getOwnerVideoProfile(modelId);
  if (!model) throw new Error("owner video model is not live-verified");
  if (prompt.trim().length === 0) throw new Error("owner video prompt is required");
  const request: Pick<StartVideoRequest, "ai_name" | "prompt" | "settings"> = {
    ai_name: model.ai_name,
    prompt,
    settings: model.settings
  };
  throwIfAbortedBeforeDispatch(signal);
  const chat = await client.createChat("video", `owner-video-${randomUUID()}`, signal);
  let dispatched = false;
  let recoveryId: string | undefined;
  // Prefer the bot message id once it is discovered. If startup fails before
  // that point, retain the dispatch echo id as the best bounded recovery key.
  let recoveryMessageId: string | null = null;
  try {
    // createChat may ignore cancellation and resolve after its caller aborts.
    throwIfAbortedBeforeDispatch(signal);
    recoveryId = recovery?.reserve(chat.chat_uuid, model.model_id);
    throwIfAbortedBeforeDispatch(signal);
    dispatched = true;
    const dispatch = await client.startVideo({ ...request, chat_id: chat.chat_uuid }, signal);
    recoveryMessageId = dispatch.message_id;
    if (recovery !== undefined && recoveryId !== undefined) {
      recovery.updateMessageId?.(recoveryId, dispatch.message_id);
    }
    const deadline = new AbsoluteRequestDeadline(DEADLINE_MS, signal, (source) =>
      new Error(source === "external" ? "owner video generation polling was aborted" : "timed out waiting for the generation to finish")
    );
    try {
      const botId = await waitForBotMessageId(client, chat.chat_uuid, dispatch.message_id, deadline, wait);
      recoveryMessageId = botId;
      if (recovery !== undefined && recoveryId !== undefined) {
        recovery.updateMessageId?.(recoveryId, botId);
      }
      const artifacts = await waitForArtifacts(client, model, chat.chat_uuid, botId, deadline, wait);
      if (recovery !== undefined && recoveryId !== undefined) {
        try { recovery.remove?.(recoveryId); } catch { /* A completed result remains successful; stale handles expire by TTL. */ }
      }
      return artifacts;
    } finally {
      deadline.close();
    }
  } catch (error) {
    if (!dispatched) {
      if (recovery !== undefined && recoveryId !== undefined) {
        try { recovery.remove?.(recoveryId); } catch { /* Do not retain a handle for a request that was never dispatched. */ }
      }
      await client.deleteChat(chat.chat_uuid, signal).catch(() => undefined);
      throw error;
    }
    // Once startVideo has been entered, an error can follow a billed dispatch
    // (for example while parsing the receipt or polling). Do not expose the
    // chat UUID and do not let clients infer that retrying is safe.
    try {
      const callbackRecoveryId = onOutcomeUnknown?.(chat.chat_uuid, model.model_id, recoveryMessageId);
      recoveryId ??= callbackRecoveryId;
    } catch {
      // A failing optional recovery hook must never replace the fixed safe
      // unknown-outcome error with a raw store/runtime error.
    }
    throw new OwnerVideoOutcomeUnknownError(recoveryId);
  }
}

function throwIfAbortedBeforeDispatch(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("The video request was canceled before generation dispatch.");
  }
}

async function waitForBotMessageId(client: OwnerVideoChatClient, chatUuid: string, echoed: string, deadline: AbsoluteRequestDeadline, wait: (milliseconds: number) => Promise<void>): Promise<string> {
  for (let i = 0; i < START_ATTEMPTS; i += 1) {
    if (i > 0) await deadline.waitFor(wait(START_DELAY_MS));
    const entries = await callWithinDeadline(deadline, (requestSignal) => client.listInProgress(chatUuid, requestSignal));
    const found = entries.find((entry) => entry.message_id !== echoed);
    if (found) return found.message_id;
  }
  throw new Error("timed out waiting for the bot's response to start");
}

async function waitForArtifacts(client: OwnerVideoChatClient, model: OwnerVideoProfile, chatUuid: string, messageId: string, deadline: AbsoluteRequestDeadline, wait: (milliseconds: number) => Promise<void>): Promise<SafeArtifactMetadata[]> {
  for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
    await deadline.waitFor(wait(POLL_DELAY_MS));
    const entries = await callWithinDeadline(deadline, (requestSignal) => client.listInProgress(chatUuid, requestSignal));
    const still = entries.some((entry) => entry.message_id === messageId);
    const message = await callWithinDeadline(deadline, (requestSignal) => client.getMessage(chatUuid, messageId, requestSignal));
    const artifacts = verifiedVideoArtifacts(message, model);
    if (artifacts.length > 0) return artifacts;
    if (!still) {
      const reconciled = await reconcileVideoArtifacts(client, model, chatUuid, messageId, deadline, wait);
      if (reconciled.length > 0) return reconciled;
      throw new Error("the generation finished without a usable video artifact appearing");
    }
  }
  throw new Error("timed out waiting for the generation to finish");
}

/** A bounded, read-only grace period for an eventually consistent terminal GET. */
async function reconcileVideoArtifacts(client: OwnerVideoChatClient, model: OwnerVideoProfile, chatUuid: string, messageId: string, deadline: AbsoluteRequestDeadline, wait: (milliseconds: number) => Promise<void>): Promise<SafeArtifactMetadata[]> {
  for (let attempt = 0; attempt < ARTIFACT_RECONCILIATION_ATTEMPTS; attempt += 1) {
    await deadline.waitFor(wait(ARTIFACT_RECONCILIATION_DELAY_MS));
    const message = await callWithinDeadline(deadline, (requestSignal) => client.getMessage(chatUuid, messageId, requestSignal));
    const artifacts = verifiedVideoArtifacts(message, model);
    if (artifacts.length > 0) return artifacts;
  }
  return [];
}

function verifiedVideoArtifacts(message: RedactedMessageEnvelope, model: OwnerVideoProfile): SafeArtifactMetadata[] {
  // redactMessage preserves only token-shaped object/model identifiers, never
  // message text, settings, author data, or raw provider body. For the narrow
  // owner-video contract a result must still identify exactly one expected
  // Seedance model and a verified MP4 artifact.
  if (message.object_type !== "video" || message.model_type !== model.settings.model_type) {
    return [];
  }
  return message.artifacts.filter((artifact) => artifact.mime_type === "video/mp4");
}

function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
export function describeVideoError(error: unknown): string { return error instanceof Error ? error.message : "unknown error"; }

function callWithinDeadline<T>(deadline: AbsoluteRequestDeadline, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  deadline.throwIfAborted();
  return deadline.waitFor(operation(deadline.signal));
}
