import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationContractCatalogPort } from "../adapter/syntx/generation-contract-executor.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import {
  getOwnerImageReferenceCandidateStoreBinding
} from "./owner-image-reference-request-preparer.js";
import {
  OwnerMediaReferenceStore,
  type OwnerMediaReferencePublicReceipt
} from "./owner-media-reference-store.js";

const MAX_BANANA_IMAGE_BYTES = 7 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;
const SAFE_LINK_ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SAFE_REFERENCE_HANDLE = /^reference_[0-9a-f-]{36}$/u;

export interface UploadOwnerImageReferenceInput {
  readonly registry: GenerationContractRegistryV2;
  readonly catalog: GenerationContractCatalogPort;
  readonly store: OwnerMediaReferenceStore;
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly client: Pick<SyntxChatHttpClient, "uploadFileReferences">;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}

export type OwnerImageReferenceUploadErrorCode = "INVALID_REQUEST" | "UPLOAD_RECEIPT_INVALID";

export class OwnerImageReferenceUploadError extends Error {
  constructor(readonly code: OwnerImageReferenceUploadErrorCode) {
    super("The owner image reference could not be issued safely.");
    this.name = "OwnerImageReferenceUploadError";
  }
}

/**
 * Uploads one owner-provided image through the existing store. The 7 MiB
 * Banana upload boundary is checked before the store or upload client runs.
 * Store errors, including unknown outcomes, pass through unchanged.
 */
export async function uploadOwnerImageReference(
  input: UploadOwnerImageReferenceInput | unknown
): Promise<OwnerMediaReferencePublicReceipt> {
  const request = snapshotInput(input);
  const contract = getOwnerImageReferenceCandidateStoreBinding(request.registry, request.catalog);
  const receipt = await request.store.uploadAndIssue({
    binding: request.binding,
    attemptId: request.attemptId,
    linkService: request.linkService,
    client: request.client,
    contract,
    filename: request.filename,
    mime_type: request.mime_type,
    bytes: request.bytes
  });
  return snapshotReceipt(receipt, request.mime_type, request.bytes.byteLength);
}

function snapshotInput(input: unknown) {
  const fields = readExactRecord(input, [
    "registry", "catalog", "store", "binding", "attemptId", "linkService", "client", "filename", "mime_type", "bytes"
  ], "INVALID_REQUEST");
  if (!fields.registry || !fields.catalog || typeof fields.catalog !== "object" || types.isProxy(fields.catalog) ||
      !(fields.store instanceof OwnerMediaReferenceStore) || types.isProxy(fields.store) ||
      typeof fields.attemptId !== "string" || !SAFE_LINK_ATTEMPT.test(fields.attemptId) ||
      typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
      typeof fields.mime_type !== "string" || !ALLOWED_MIME_TYPES.has(fields.mime_type) ||
      !(fields.bytes instanceof Uint8Array) || types.isProxy(fields.bytes) ||
      fields.bytes.byteLength < 1 || fields.bytes.byteLength > MAX_BANANA_IMAGE_BYTES ||
      !fields.linkService || typeof fields.linkService !== "object" || types.isProxy(fields.linkService) ||
      !fields.client || typeof fields.client !== "object" || types.isProxy(fields.client)) {
    fail("INVALID_REQUEST");
  }
  const bindingFields = readExactRecord(fields.binding, ["tenant_id", "subject"], "INVALID_REQUEST");
  const principal = snapshotGenerationPrincipal({
    tenant_id: bindingFields.tenant_id as string,
    subject_id: bindingFields.subject as string,
    connection_id: fields.attemptId
  });
  const getStatus = findMethod(fields.linkService, "getStatus");
  const uploadFileReferences = findMethod(fields.client, "uploadFileReferences");
  if (typeof getStatus !== "function" || typeof uploadFileReferences !== "function") fail("INVALID_REQUEST");

  return {
    registry: fields.registry as GenerationContractRegistryV2,
    catalog: fields.catalog as GenerationContractCatalogPort,
    store: fields.store,
    binding: Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id }),
    attemptId: fields.attemptId,
    linkService: fields.linkService as Pick<PerUserLinkService, "getStatus">,
    client: fields.client as Pick<SyntxChatHttpClient, "uploadFileReferences">,
    filename: fields.filename,
    mime_type: fields.mime_type,
    bytes: new Uint8Array(fields.bytes)
  };
}

function snapshotReceipt(value: unknown, mimeType: string, byteLength: number): OwnerMediaReferencePublicReceipt {
  const fields = readExactRecord(value, [
    "status", "reference_handle", "mime_type", "mime_type_source", "size", "size_source"
  ], "UPLOAD_RECEIPT_INVALID");
  if (fields.status !== "accepted" || typeof fields.reference_handle !== "string" || !SAFE_REFERENCE_HANDLE.test(fields.reference_handle) ||
      fields.mime_type !== mimeType || fields.mime_type_source !== "request_declared" ||
      fields.size !== byteLength || fields.size_source !== "request_bytes") {
    fail("UPLOAD_RECEIPT_INVALID");
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

function readExactRecord(value: unknown, keys: readonly string[], code: OwnerImageReferenceUploadErrorCode): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(descriptors);
  if (actualKeys.length !== keys.length || actualKeys.some((key) =>
    typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!)
  )) fail(code);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of actualKeys as string[]) result[key] = descriptors[key]!.value;
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

function fail(code: OwnerImageReferenceUploadErrorCode): never {
  throw new OwnerImageReferenceUploadError(code);
}
