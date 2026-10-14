import { types } from "node:util";
import type { OwnerKlingI2VImageReferenceService, OwnerKlingI2VImageResolution, OwnerKlingI2VImageResolveInput } from "./owner-kling-i2v-reference-service.js";
import { buildOwnerKlingI2vWireSettingsTemplate, type OwnerKlingI2vWireSettingsTemplate } from "./owner-kling-i2v-wire-source.js";
import type { OwnerKlingI2VUploadContext } from "../adapter/syntx/kling-i2v-upload-context.js";
import { readOwnerKlingI2VUploadReferenceForClient } from "../adapter/syntx/kling-i2v-upload-context.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";

const CONTEXTS = new WeakMap<object, OwnerKlingI2vGenerationContextState>();

export interface OwnerKlingI2vGenerationContext {
  readonly status: "ready";
  readonly model_id: "kling_image2video";
  readonly reference_count: 1;
  readonly generation_permit: "ONE_SHOT_RESERVED_ON_DISPATCH";
}

export interface CreateOwnerKlingI2vGenerationContextInput {
  readonly referenceService: Pick<OwnerKlingI2VImageReferenceService, "withCapturedNativeImage" | "isOwnedResolution">;
  readonly resolution: OwnerKlingI2VImageResolution;
  readonly reference: OwnerKlingI2VImageResolveInput;
  readonly parameters: unknown;
  readonly controls: unknown;
  readonly signal?: AbortSignal;
}

export interface OwnerKlingI2vGenerationContextInspection {
  readonly model_id: "kling_image2video";
  readonly attempt_id: string;
  readonly image_handle: string;
  readonly chat_id: string;
  readonly prompt: string;
  readonly settings: OwnerKlingI2vWireSettingsTemplate["settings_template"];
  readonly reference_sha256: string;
  readonly reference_epoch: number;
  readonly reference_expires_at: number;
  readonly dispatch_state: "READY" | "RESERVED";
}

interface OwnerKlingI2vGenerationContextState {
  readonly client: SyntxChatHttpClient;
  readonly referenceService: CreateOwnerKlingI2vGenerationContextInput["referenceService"];
  readonly resolution: OwnerKlingI2VImageResolution;
  readonly reference: OwnerKlingI2VImageResolveInput;
  readonly principal: OwnerKlingI2VImageResolution["principal"];
  readonly uploadContext: OwnerKlingI2VUploadContext;
  readonly attemptId: string;
  readonly imageHandle: string;
  readonly chatId: string;
  readonly prompt: string;
  readonly settings: OwnerKlingI2vWireSettingsTemplate["settings_template"];
  readonly referenceSha256: string;
  readonly referenceEpoch: number;
  readonly referenceExpiresAt: number;
  dispatchState: "READY" | "RESERVED";
}

export type OwnerKlingI2vGenerationContextErrorCode = "INVALID_CONTEXT" | "CHAT_CREATE_FAILED";

export class OwnerKlingI2vGenerationContextError extends Error {
  constructor(readonly code: OwnerKlingI2vGenerationContextErrorCode) {
    super("The owner Kling I2V generation context could not be established safely.");
    this.name = "OwnerKlingI2vGenerationContextError";
  }
}

/** Creates one native video chat from a current, nominal owner image resolution. */
export async function createOwnerKlingI2vGenerationContext(
  input: CreateOwnerKlingI2vGenerationContextInput
): Promise<OwnerKlingI2vGenerationContext> {
  const serviceModule = await import("./owner-kling-i2v-reference-service.js");
  const servicePrototype = serviceModule.OwnerKlingI2VImageReferenceService.prototype;
  if (Object.getPrototypeOf(input.referenceService) !== servicePrototype ||
      servicePrototype.withCapturedNativeImage !== input.referenceService.withCapturedNativeImage ||
      servicePrototype.isOwnedResolution !== input.referenceService.isOwnedResolution ||
      !Reflect.apply(servicePrototype.isOwnedResolution, input.referenceService, [input.resolution, input.reference])) invalid();
  const template = buildOwnerKlingI2vWireSettingsTemplate({ parameters: input.parameters, controls: input.controls });
  if (input.resolution.model_id !== "kling_image2video" || input.resolution.wire_type !== "image" ||
      input.resolution.generation_permit !== false || input.reference.attempt_id !== input.resolution.attempt_id ||
      input.reference.image_handle !== input.resolution.image_handle || !isPlainObject(template.settings_template)) invalid();

  const created = await input.referenceService.withCapturedNativeImage(
    input.resolution,
    input.reference,
    async (client, uploadContext, captureSignal) => {
      if (!isNativeClient(client) || uploadContext.model_id !== "kling_image2video" ||
          uploadContext.source_sha256 !== input.resolution.sha256 ||
          !readOwnerKlingI2VUploadReferenceForClient(client, uploadContext)) invalid();
      let chat;
      try {
        chat = await Reflect.apply(SyntxChatHttpClient.prototype.createOwnerKlingI2vVideoChat, client, [captureSignal ?? input.signal]);
      } catch {
        return Object.freeze({ error: true as const });
      }
      const context: OwnerKlingI2vGenerationContext = Object.freeze({
        status: "ready", model_id: "kling_image2video", reference_count: 1,
        generation_permit: "ONE_SHOT_RESERVED_ON_DISPATCH"
      });
      CONTEXTS.set(context, {
        client, referenceService: input.referenceService, resolution: input.resolution,
        reference: input.reference, principal: input.resolution.principal,
        uploadContext, attemptId: input.resolution.attempt_id,
        imageHandle: input.resolution.image_handle, chatId: chat.chat_uuid,
        prompt: template.prompt, settings: template.settings_template,
        referenceSha256: input.resolution.sha256, referenceEpoch: input.resolution.epoch,
        referenceExpiresAt: input.resolution.expires_at, dispatchState: "READY"
      });
      return Object.freeze({ context });
    },
    input.signal
  );
  if ("error" in created) throw new OwnerKlingI2vGenerationContextError("CHAT_CREATE_FAILED");
  return created.context;
}

/** Internal inspection for the later service/preparer; it never includes the uploaded URL or file ID. */
export function inspectOwnerKlingI2vGenerationContext(
  clientInput: unknown,
  contextInput: unknown
): OwnerKlingI2vGenerationContextInspection | null {
  const state = readState(clientInput, contextInput);
  if (!state) return null;
  return Object.freeze({ model_id: "kling_image2video", attempt_id: state.attemptId,
    image_handle: state.imageHandle, chat_id: state.chatId, prompt: state.prompt,
    settings: state.settings, reference_sha256: state.referenceSha256,
    reference_epoch: state.referenceEpoch, reference_expires_at: state.referenceExpiresAt,
    dispatch_state: state.dispatchState });
}

/** Reserves before the sole POST; every failure after this point remains non-replayable. */
export function consumeOwnerKlingI2vGenerationContext(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ chat_id: string; prompt: string; settings: OwnerKlingI2vWireSettingsTemplate["settings_template"]; uploadContext: OwnerKlingI2VUploadContext }> {
  const state = readState(clientInput, contextInput);
  if (!state || state.dispatchState !== "READY" || !readOwnerKlingI2VUploadReferenceForClient(state.client, state.uploadContext)) invalid();
  state.dispatchState = "RESERVED";
  return Object.freeze({ chat_id: state.chatId, prompt: state.prompt, settings: state.settings, uploadContext: state.uploadContext });
}

/** Rechecks the live owner and reference epoch immediately around native dispatch. */
export async function withCapturedOwnerKlingI2vGenerationContext<T>(
  clientInput: unknown,
  contextInput: unknown,
  consume: (uploadContext: OwnerKlingI2VUploadContext, signal: AbortSignal) => T | Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const state = readState(clientInput, contextInput);
  if (!state || typeof consume !== "function" || types.isProxy(consume)) invalid();
  return state.referenceService.withCapturedNativeImage(state.resolution, state.reference, async (client, uploadContext, captureSignal) => {
    if (client !== state.client || uploadContext !== state.uploadContext ||
        state.resolution.principal !== state.principal || state.reference.attempt_id !== state.attemptId ||
        state.reference.image_handle !== state.imageHandle || !readOwnerKlingI2VUploadReferenceForClient(client, uploadContext)) invalid();
    return consume(uploadContext, captureSignal);
  }, signal);
}

function readState(clientInput: unknown, contextInput: unknown): OwnerKlingI2vGenerationContextState | null {
  if (!isNativeClient(clientInput) || !contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
  const state = CONTEXTS.get(contextInput);
  if (!state || state.client !== clientInput || state.uploadContext.model_id !== "kling_image2video" ||
      !readOwnerKlingI2VUploadReferenceForClient(clientInput, state.uploadContext)) return null;
  return state;
}

function isNativeClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === SyntxChatHttpClient.prototype &&
    typeof SyntxChatHttpClient.prototype.createOwnerKlingI2vVideoChat === "function" &&
    typeof SyntxChatHttpClient.prototype.startOwnerKlingI2vVideoWithContext === "function";
}

function isPlainObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(): never { throw new OwnerKlingI2vGenerationContextError("INVALID_CONTEXT"); }
