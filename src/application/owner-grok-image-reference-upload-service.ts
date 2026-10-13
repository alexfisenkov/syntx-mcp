import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import {
  OwnerGrokImageReferenceProfileError,
  type OwnerGrokImageReferenceProfileId,
  type OwnerGrokImageReferenceProfileSet
} from "../catalog/owner-grok-image-reference-profiles.js";
import { getOwnerGrokReferenceStoreBinding } from "./owner-grok-image-reference-request-preparer.js";
import { snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  OwnerImageReferenceInputError,
  validateOwnerImageReferenceInput
} from "./owner-image-reference-input-validator.js";
import {
  OwnerMediaReferenceStore,
  OwnerMediaReferenceStoreError,
  type OwnerMediaReferencePublicReceipt
} from "./owner-media-reference-store.js";

const SAFE_ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_HANDLE = /^reference_[0-9a-f-]{36}$/u;

export interface UploadOwnerGrokImageReferenceInput {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly store: OwnerMediaReferenceStore;
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly client: Pick<SyntxChatHttpClient, "uploadFileReferences">;
  readonly content_base64: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly signal?: AbortSignal;
}

export interface OwnerGrokImageReferenceUploadReceipt extends OwnerMediaReferencePublicReceipt {
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly model_id: string;
  readonly expires_in_seconds: 900;
  readonly image: Readonly<{
    mime_type: "image/jpeg" | "image/png" | "image/webp";
    width: number;
    height: number;
    sha256: string;
    byte_length: number;
  }>;
  readonly confidence_scope: "input_bytes_sniffed_and_dimensions_checked";
}

export type OwnerGrokImageReferenceUploadErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_INVALID"
  | "UPLOAD_RECEIPT_INVALID";

export class OwnerGrokImageReferenceUploadError extends Error {
  constructor(readonly code: OwnerGrokImageReferenceUploadErrorCode) {
    super("The owner Grok image reference could not be issued safely.");
    this.name = "OwnerGrokImageReferenceUploadError";
  }
}

/** Validate bytes locally, bind the upload to one authentic source-reviewed Grok profile, then issue one opaque handle. */
export async function uploadOwnerGrokImageReference(
  input: UploadOwnerGrokImageReferenceInput | unknown
): Promise<OwnerGrokImageReferenceUploadReceipt> {
  const request = snapshotInput(input);
  let contract;
  try {
    contract = getOwnerGrokReferenceStoreBinding(request.profile_set, request.profile_id);
  } catch (error) {
    if (error instanceof OwnerGrokImageReferenceProfileError) throw new OwnerGrokImageReferenceUploadError("PROFILE_INVALID");
    throw new OwnerGrokImageReferenceUploadError("PROFILE_INVALID");
  }

  request.signal?.throwIfAborted();
  let image;
  try {
    image = validateOwnerImageReferenceInput({
      content_base64: request.content_base64,
      filename: request.filename,
      mime_type: request.mime_type
    });
  } catch (error) {
    if (error instanceof OwnerImageReferenceInputError) throw new OwnerGrokImageReferenceUploadError("INVALID_REQUEST");
    throw new OwnerGrokImageReferenceUploadError("INVALID_REQUEST");
  }

  const wrappedClient: Pick<SyntxChatHttpClient, "uploadFileReferences"> = Object.freeze({
    uploadFileReferences: async (upload) => {
      request.signal?.throwIfAborted();
      const result = await request.uploadFileReferences(upload, request.signal);
      // If cancellation races a completed network response, let the store record
      // an unknown upload outcome; do not issue a handle or retry the POST.
      request.signal?.throwIfAborted();
      return result;
    }
  });

  let storeReceipt: OwnerMediaReferencePublicReceipt;
  try {
    storeReceipt = await request.store.uploadAndIssue({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService,
      client: wrappedClient,
      contract,
      filename: image.filename,
      mime_type: image.mime_type,
      bytes: image.bytes
    });
  } catch (error) {
    // Preserve linked-principal and rejected/unknown upload store errors verbatim.
    if (error instanceof OwnerMediaReferenceStoreError) throw error;
    throw new OwnerGrokImageReferenceUploadError("UPLOAD_RECEIPT_INVALID");
  }

  const receipt = snapshotReceipt(storeReceipt, image.mime_type, image.bytes.byteLength);
  return Object.freeze({
    ...receipt,
    profile_id: request.profile_id,
    model_id: contract.model_id,
    expires_in_seconds: 900,
    image: Object.freeze({
      mime_type: image.mime_type,
      width: image.width,
      height: image.height,
      sha256: image.sha256,
      byte_length: image.bytes.byteLength
    }),
    confidence_scope: "input_bytes_sniffed_and_dimensions_checked"
  });
}

interface UploadRequestSnapshot {
  profile_set: OwnerGrokImageReferenceProfileSet;
  profile_id: OwnerGrokImageReferenceProfileId;
  store: OwnerMediaReferenceStore;
  binding: AuthBinding;
  attemptId: string;
  linkService: Pick<PerUserLinkService, "getStatus">;
  uploadFileReferences: Pick<SyntxChatHttpClient, "uploadFileReferences">["uploadFileReferences"];
  content_base64: string;
  filename: string;
  mime_type: string;
  signal?: AbortSignal;
}

function snapshotInput(input: unknown): UploadRequestSnapshot {
  const fields = exactRecord(input, [
    "profile_set", "profile_id", "store", "binding", "attemptId", "linkService", "client",
    "content_base64", "filename", "mime_type", "signal"
  ], ["profile_set", "profile_id", "store", "binding", "attemptId", "linkService", "client", "content_base64", "filename", "mime_type"]);
  if (!fields.profile_set || typeof fields.profile_set !== "object" || types.isProxy(fields.profile_set) ||
      typeof fields.profile_id !== "string" || !(fields.store instanceof OwnerMediaReferenceStore) || types.isProxy(fields.store) ||
      typeof fields.attemptId !== "string" || !SAFE_ATTEMPT.test(fields.attemptId) ||
      typeof fields.content_base64 !== "string" || typeof fields.filename !== "string" ||
      typeof fields.mime_type !== "string" ||
      (fields.signal !== undefined && (!(fields.signal instanceof AbortSignal) || types.isProxy(fields.signal)))) {
    invalidRequest();
  }
  const bindingFields = exactRecord(fields.binding, ["tenant_id", "subject"]);
  const principal = snapshotGenerationPrincipal({
    tenant_id: bindingFields.tenant_id as string,
    subject_id: bindingFields.subject as string,
    connection_id: fields.attemptId
  });
  const linkService = snapshotService(fields.linkService);
  const uploadFileReferences = snapshotUploadClient(fields.client);
  return {
    profile_set: fields.profile_set as OwnerGrokImageReferenceProfileSet,
    profile_id: fields.profile_id as OwnerGrokImageReferenceProfileId,
    store: fields.store,
    binding: Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id }),
    attemptId: fields.attemptId,
    linkService,
    uploadFileReferences,
    content_base64: fields.content_base64,
    filename: fields.filename,
    mime_type: fields.mime_type,
    ...(fields.signal === undefined ? {} : { signal: fields.signal as AbortSignal })
  };
}

function snapshotService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalidRequest();
  const method = findMethod(value, "getStatus");
  if (typeof method !== "function") invalidRequest();
  return value as Pick<PerUserLinkService, "getStatus">;
}

function snapshotUploadClient(value: unknown): UploadRequestSnapshot["uploadFileReferences"] {
  if (!value || typeof value !== "object" || types.isProxy(value)) invalidRequest();
  const method = findMethod(value, "uploadFileReferences");
  if (typeof method !== "function") invalidRequest();
  return method.bind(value) as UploadRequestSnapshot["uploadFileReferences"];
}

function snapshotReceipt(
  value: unknown,
  mimeType: OwnerGrokImageReferenceUploadReceipt["mime_type"],
  byteLength: number
): OwnerMediaReferencePublicReceipt {
  const fields = exactRecord(value, [
    "status", "reference_handle", "mime_type", "mime_type_source", "size", "size_source"
  ]);
  if (fields.status !== "accepted" || typeof fields.reference_handle !== "string" || !SAFE_HANDLE.test(fields.reference_handle) ||
      fields.mime_type !== mimeType || fields.mime_type_source !== "request_declared" ||
      fields.size !== byteLength || fields.size_source !== "request_bytes") {
    throw new OwnerGrokImageReferenceUploadError("UPLOAD_RECEIPT_INVALID");
  }
  return Object.freeze({
    status: "accepted",
    reference_handle: fields.reference_handle,
    mime_type: mimeType,
    mime_type_source: "request_declared",
    size: byteLength,
    size_source: "request_bytes"
  });
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[] = allowedKeys
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidRequest();
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) ||
      keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) || !("value" in descriptors[key]!)) ||
      requiredKeys.some((key) => !keys.includes(key))) invalidRequest();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function findMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function invalidRequest(): never {
  throw new OwnerGrokImageReferenceUploadError("INVALID_REQUEST");
}
