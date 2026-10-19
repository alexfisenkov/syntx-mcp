import { createHash } from "node:crypto";
import { types } from "node:util";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "./upload-reference-bridge.js";
import type { SyntxChatHttpClient } from "./chat-http-client.js";

const MODEL_ID = "switchx" as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const UPLOADS = new WeakMap<object, UploadState>();
const CHATS = new WeakMap<object, ChatState>();

interface VideoMetadata {
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: 5;
  readonly frame_rate: 24;
}

interface UploadState {
  readonly client: SyntxChatHttpClient;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly destination: "uploaded" | "hidden";
  readonly url: string;
  readonly file_id?: string;
  readonly metadata: VideoMetadata;
  chat_creation_started: boolean;
}

interface ChatState extends UploadState {
  readonly chat_uuid: string;
  dispatch_attempted: boolean;
}

export interface OwnerSwitchxVideoUploadContext {
  readonly status: "uploaded";
  readonly model_id: typeof MODEL_ID;
  readonly attempt_id: string;
  readonly destination: "uploaded" | "hidden";
  readonly filename: string;
  readonly mime_type: "video/mp4" | "video/quicktime";
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly duration_seconds: 5;
  readonly frame_rate: 24;
  readonly generation_permit: false;
  readonly provider_acceptance: "UNPROVEN";
}

export interface OwnerSwitchxVideoChatContext extends Omit<OwnerSwitchxVideoUploadContext, "status"> {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly dispatch_attempted: false;
}

export class OwnerSwitchxVideoNativeContextError extends Error {
  constructor(readonly code: "INVALID_CONTEXT" | "UPLOAD_ALREADY_USED" | "CHAT_ALREADY_USED") {
    super("The owner Switchx video native context is invalid or already consumed.");
    this.name = "OwnerSwitchxVideoNativeContextError";
  }
}

export function createOwnerSwitchxVideoUploadContext(input: unknown): Readonly<OwnerSwitchxVideoUploadContext> {
  const row = exact(input, ["client", "attempt_id", "principal", "destination", "reference", "metadata"]);
  if (!isClient(row.client) || typeof row.attempt_id !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(row.attempt_id) ||
      (row.destination !== "uploaded" && row.destination !== "hidden") || !isUploadReference(row.reference) || !isMetadata(row.metadata)) invalid();
  const principal = snapshotGenerationPrincipal(row.principal);
  if (principal.connection_id !== row.attempt_id) invalid();
  const metadata = Object.freeze({ ...row.metadata });
  const context: OwnerSwitchxVideoUploadContext = Object.freeze({ status: "uploaded", model_id: MODEL_ID,
    attempt_id: row.attempt_id, destination: row.destination, filename: metadata.filename, mime_type: metadata.mime_type,
    size: metadata.size, sha256: metadata.sha256, width: metadata.width, height: metadata.height,
    duration_seconds: 5, frame_rate: 24, generation_permit: false, provider_acceptance: "UNPROVEN" });
  UPLOADS.set(context, { client: row.client, attempt_id: row.attempt_id, principal, destination: row.destination,
    url: row.reference.url, ...(row.reference.file_id === undefined ? {} : { file_id: row.reference.file_id }), metadata, chat_creation_started: false });
  return context;
}

export function createOwnerSwitchxVideoChatContext(input: unknown): Readonly<OwnerSwitchxVideoChatContext> {
  const row = exact(input, ["client", "upload_context", "chat_uuid"]);
  if (!isClient(row.client) || typeof row.chat_uuid !== "string" || !SAFE_ID.test(row.chat_uuid)) invalid();
  readOwnerSwitchxVideoUploadForClient(row.client, row.upload_context);
  const state = UPLOADS.get(row.upload_context as object)!;
  if (!state.chat_creation_started) invalid();
  const context: OwnerSwitchxVideoChatContext = Object.freeze({ ...row.upload_context, status: "created", chat_uuid: row.chat_uuid,
    dispatch_attempted: false });
  CHATS.set(context, { ...state, chat_uuid: row.chat_uuid, dispatch_attempted: false });
  UPLOADS.delete(row.upload_context as object);
  return context;
}

/** Reserves the one chat-create call before its network await; an unknown result cannot be retried. */
export function beginOwnerSwitchxVideoChatCreation(client: unknown, contextInput: unknown): Readonly<{
  attempt_id: string; principal: Readonly<GenerationPrincipalRef>; destination: "uploaded" | "hidden";
  url: string; file_id?: string; metadata: VideoMetadata;
}> {
  const state = stateFromUpload(client, contextInput);
  if (state.chat_creation_started) throw new OwnerSwitchxVideoNativeContextError("UPLOAD_ALREADY_USED");
  state.chat_creation_started = true;
  return Object.freeze({ attempt_id: state.attempt_id, principal: state.principal, destination: state.destination,
    url: state.url, ...(state.file_id === undefined ? {} : { file_id: state.file_id }), metadata: state.metadata });
}

/** Reads the upload URL only inside the fixed native chat/start methods. */
export function readOwnerSwitchxVideoUploadForClient(client: unknown, contextInput: unknown): Readonly<{
  attempt_id: string; principal: Readonly<GenerationPrincipalRef>; destination: "uploaded" | "hidden";
  url: string; file_id?: string; metadata: VideoMetadata;
}> {
  const state = stateFromUpload(client, contextInput);
  return Object.freeze({ attempt_id: state.attempt_id, principal: state.principal, destination: state.destination,
    url: state.url, ...(state.file_id === undefined ? {} : { file_id: state.file_id }), metadata: state.metadata });
}

export function consumeOwnerSwitchxVideoStartContext(client: unknown, contextInput: unknown, attemptId: string,
  principalInput: unknown): Readonly<{ chat_uuid: string; attempt_id: string; principal: Readonly<GenerationPrincipalRef>;
    destination: "uploaded" | "hidden"; url: string; file_id?: string; metadata: VideoMetadata }> {
  const state = stateFromChat(client, contextInput);
  const principalRow = exact(principalInput, ["tenant_id", "subject_id", "connection_id"]);
  const tenantId = principalRow.tenant_id;
  const subjectId = principalRow.subject_id;
  const connectionId = principalRow.connection_id;
  if (typeof tenantId !== "string" || typeof subjectId !== "string" || typeof connectionId !== "string") invalid();
  const principal = snapshotGenerationPrincipal({ tenant_id: tenantId, subject_id: subjectId,
    connection_id: connectionId });
  if (state.attempt_id !== attemptId || principal.connection_id !== attemptId ||
      state.principal.tenant_id !== principal.tenant_id || state.principal.subject_id !== principal.subject_id ||
      state.chat_uuid !== (contextInput as OwnerSwitchxVideoChatContext).chat_uuid) invalid();
  if (state.dispatch_attempted) throw new OwnerSwitchxVideoNativeContextError("CHAT_ALREADY_USED");
  state.dispatch_attempted = true;
  return Object.freeze({ chat_uuid: state.chat_uuid, attempt_id: state.attempt_id, principal: state.principal,
    destination: state.destination, url: state.url, ...(state.file_id === undefined ? {} : { file_id: state.file_id }), metadata: state.metadata });
}

export function readOwnerSwitchxVideoChatState(client: unknown, contextInput: unknown): Readonly<{
  chat_uuid: string; attempt_id: string; principal: Readonly<GenerationPrincipalRef>; metadata: VideoMetadata; reference_url_sha256: string;
  dispatch_attempted: boolean;
}> {
  const state = stateFromChat(client, contextInput);
  return Object.freeze({ chat_uuid: state.chat_uuid, attempt_id: state.attempt_id, principal: state.principal,
    metadata: state.metadata, reference_url_sha256: createHash("sha256").update(state.url, "utf8").digest("hex"),
    dispatch_attempted: state.dispatch_attempted });
}

export function isOwnerSwitchxVideoUploadContext(value: unknown): value is Readonly<OwnerSwitchxVideoUploadContext> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = UPLOADS.get(value);
  return state !== undefined && Object.isFrozen(value) && contextDescriptorsValid(value, "uploaded");
}

export function isOwnerSwitchxVideoChatContext(value: unknown): value is Readonly<OwnerSwitchxVideoChatContext> {
  if (!value || typeof value !== "object" || types.isProxy(value)) return false;
  const state = CHATS.get(value);
  return state !== undefined && Object.isFrozen(value) && contextDescriptorsValid(value, "created");
}

function stateFromUpload(client: unknown, input: unknown): UploadState {
  if (!input || typeof input !== "object" || types.isProxy(input) || !isOwnerSwitchxVideoUploadContext(input)) invalid();
  const state = UPLOADS.get(input)!;
  if (state.client !== client) invalid();
  return state;
}
function stateFromChat(client: unknown, input: unknown): ChatState {
  if (!input || typeof input !== "object" || types.isProxy(input) || !isOwnerSwitchxVideoChatContext(input)) invalid();
  const state = CHATS.get(input)!;
  if (state.client !== client) invalid();
  return state;
}
function contextDescriptorsValid(value: object, status: "uploaded" | "created"): boolean {
  try {
    const row = value as Record<string, unknown>;
    return row.status === status && row.model_id === MODEL_ID && row.generation_permit === false && row.provider_acceptance === "UNPROVEN" &&
      typeof row.attempt_id === "string" && SHA256.test(row.sha256 as string) &&
      Number.isSafeInteger(row.size) && (row.size as number) > 0 && row.duration_seconds === 5 && row.frame_rate === 24 &&
      (status === "uploaded" || (typeof row.chat_uuid === "string" && SAFE_ID.test(row.chat_uuid) && row.dispatch_attempted === false));
  } catch { return false; }
}
function isUploadReference(value: unknown): value is InternalUploadReference {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.url === "string" && isSafeUploadReferenceUrl(row.url) &&
    (row.file_id === undefined || (typeof row.file_id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(row.file_id)));
}
function isMetadata(value: unknown): value is VideoMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.filename === "string" && row.filename.length > 0 &&
    (row.mime_type === "video/mp4" || row.mime_type === "video/quicktime") && Number.isSafeInteger(row.size) && (row.size as number) > 0 &&
    typeof row.sha256 === "string" && SHA256.test(row.sha256) && Number.isSafeInteger(row.width) && (row.width as number) > 0 &&
    Number.isSafeInteger(row.height) && (row.height as number) > 0 && row.duration_seconds === 5 && row.frame_rate === 24;
}
function isClient(value: unknown): value is SyntxChatHttpClient {
  return !!value && typeof value === "object" && !types.isProxy(value);
}
function exact(value: unknown, keys: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  let descriptors: PropertyDescriptorMap;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { invalid(); }
  const actual = Reflect.ownKeys(descriptors);
  if ((Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) || actual.length !== keys.length ||
      actual.some((key) => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) invalid();
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of actual as string[]) out[key] = descriptors[key]!.value;
  return out;
}
function invalid(): never { throw new OwnerSwitchxVideoNativeContextError("INVALID_CONTEXT"); }
