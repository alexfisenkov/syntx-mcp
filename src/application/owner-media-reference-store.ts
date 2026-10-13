import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { generationPrincipalKey, sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isSafeUploadReferenceUrl, type InternalUploadReference } from "../adapter/syntx/upload-reference-bridge.js";
import type { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";

const MAX_ENTRIES = 128;
const TTL_MS = 15 * 60_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SAFE_REFERENCE_HANDLE = /^reference_[0-9a-f-]{36}$/u;
const SAFE_FILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f]{1,128}$/u;

export interface OwnerMediaReferenceContractBinding {
  readonly schema_hash: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly model_type: string;
  readonly operation_id: "generate-image" | "generate-video";
  readonly modality: "image" | "video";
  readonly variant_id: string;
}

export interface UploadOwnerMediaReferenceInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly client: Pick<SyntxChatHttpClient, "uploadFileReferences">;
  readonly contract: OwnerMediaReferenceContractBinding;
  readonly filename: string;
  readonly mime_type: string;
  readonly bytes: Uint8Array;
}

export interface OwnerMediaReferencePublicReceipt {
  readonly status: "accepted";
  readonly reference_handle: string;
  readonly mime_type: string;
  readonly mime_type_source: "request_declared";
  readonly size: number;
  readonly size_source: "request_bytes";
}

interface InternalImageReferenceRecord {
  readonly referenceHandle: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly principalKey: string;
  readonly contract: Readonly<OwnerMediaReferenceContractBinding>;
  readonly url: string;
  readonly fileId?: string;
  readonly mimeType: string;
  readonly mimeTypeSource: "request_declared";
  readonly size: number;
  readonly sizeSource: "request_bytes";
  readonly expiresAt: number;
}

export interface ResolveOwnerImageReferencesInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly contract: OwnerMediaReferenceContractBinding;
  readonly reference_handles: readonly string[];
}

export interface ConsumeOwnerImageReferenceInput extends ResolveOwnerImageReferencesInput {
  readonly reference_handle: string;
  readonly expected_url: string;
}

/** Closed internal server policy; callers cannot select numeric min/max limits. */
export type OwnerMediaReferenceServerContract = "grok_i2i" | "grok_i2i_pro";

export interface ResolveOrderedOwnerImageReferencesInput extends ResolveOwnerImageReferencesInput {
  readonly server_contract: OwnerMediaReferenceServerContract;
}

export interface ConsumeOrderedOwnerImageReferencesInput extends ResolveOrderedOwnerImageReferencesInput {
  readonly expected_file_urls: readonly string[];
}

export interface OwnerMediaReferenceStoreOptions {
  readonly now?: () => number;
  /** Deterministic local-test seam only; production defaults to randomUUID. */
  readonly createHandle?: () => string;
}

export class OwnerMediaReferenceStore {
  readonly #records = new Map<string, InternalImageReferenceRecord>();
  readonly #pendingByPrincipal = new Map<string, Set<{ invalidated: boolean }>>();
  readonly #now: () => number;
  readonly #createHandle: () => string;
  #pending = 0;
  #closed = false;

  constructor(options: OwnerMediaReferenceStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createHandle = options.createHandle ?? (() => `reference_${randomUUID()}`);
  }

  async uploadAndIssue(input: UploadOwnerMediaReferenceInput): Promise<OwnerMediaReferencePublicReceipt> {
    const request = snapshotUploadInput(input);
    this.#assertOpen();
    this.#pruneExpired(this.#readNow());
    if (this.#records.size + this.#pending >= MAX_ENTRIES) throw new OwnerMediaReferenceStoreError("REFERENCE_STORE_FULL");
    this.#pending += 1;
    const pendingToken = { invalidated: false };
    this.#trackPending(request.principalKey, pendingToken);
    let uploadInvoked = false;
    try {
      const principal = await resolveOwnerReferencePrincipal({
        binding: request.binding,
        attemptId: request.attemptId,
        linkService: request.linkService
      });
      this.#assertPending(pendingToken);
      this.#assertOpen();
      uploadInvoked = true;
      const references = await request.uploadFileReferences({
        bytes: new Uint8Array(request.bytes),
        filename: request.filename,
        mime_type: request.mime_type,
        destination: "hidden",
        check_duplicates: true,
        model_type: request.contract.model_type
      });
      this.#assertPending(pendingToken, true);
      this.#assertOpen();
      const reference = parseOneAttributableReference(references);
      const currentPrincipal = await resolveOwnerReferencePrincipal({
        binding: request.binding,
        attemptId: request.attemptId,
        linkService: request.linkService
      }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN"); });
      this.#assertPending(pendingToken, true);
      if (!sameGenerationPrincipal(principal, currentPrincipal)) {
        throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
      }
      const now = this.#readNow();
      this.#pruneExpired(now);
      if (this.#records.size >= MAX_ENTRIES) throw new OwnerMediaReferenceStoreError("REFERENCE_STORE_FULL");
      const referenceHandle = this.#createHandle();
      if (!SAFE_REFERENCE_HANDLE.test(referenceHandle) || this.#records.has(referenceHandle)) {
        throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
      }
      this.#assertPending(pendingToken, true);
      const record: InternalImageReferenceRecord = Object.freeze({
        referenceHandle,
        principal,
        principalKey: generationPrincipalKey(principal),
        contract: request.contract,
        url: reference.url,
        ...(reference.file_id === undefined ? {} : { fileId: reference.file_id }),
        mimeType: request.mime_type,
        mimeTypeSource: "request_declared",
        size: request.bytes.byteLength,
        sizeSource: "request_bytes",
        expiresAt: now + TTL_MS
      });
      this.#records.set(referenceHandle, record);
      return Object.freeze({
        status: "accepted" as const,
        reference_handle: referenceHandle,
        mime_type: record.mimeType,
        mime_type_source: record.mimeTypeSource,
        size: record.size,
        size_source: record.sizeSource
      });
    } catch (error) {
      if (error instanceof OwnerReferencePrincipalError) {
        throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerMediaReferenceStoreError) {
        if (uploadInvoked && error.code === "REFERENCE_STORE_CLOSED") {
          throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
        }
        throw error;
      }
      if (!uploadInvoked) throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
      if (error instanceof SyntxHttpError && isKnownUploadRejection(error.code)) {
        throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_REJECTED");
      }
      throw new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
    } finally {
      this.#untrackPending(request.principalKey, pendingToken);
      this.#pending -= 1;
    }
  }

  async resolveImageReferences(input: ResolveOwnerImageReferencesInput): Promise<Readonly<{ file_urls: readonly string[] }>> {
    const request = snapshotResolveInput(input);
    this.#assertOpen();
    const principal = await resolveOwnerReferencePrincipal({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    this.#pruneExpired(this.#readNow());
    if (request.referenceHandles.length !== 1) throw new OwnerMediaReferenceStoreError("REFERENCE_COUNT_INVALID");
    const record = this.#records.get(request.referenceHandles[0]!);
    if (!record) throw new OwnerMediaReferenceStoreError("REFERENCE_NOT_FOUND");
    if (record.expiresAt <= this.#readNow()) {
      this.#records.delete(record.referenceHandle);
      throw new OwnerMediaReferenceStoreError("REFERENCE_EXPIRED");
    }
    if (record.principalKey !== generationPrincipalKey(principal) || !sameGenerationPrincipal(record.principal, principal)) {
      throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    }
    if (!sameContractBinding(record.contract, request.contract)) throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    if (!IMAGE_MIME_TYPES.has(record.mimeType) || record.size < 1 || record.size > MAX_FILE_BYTES ||
        !isSafeUploadReferenceUrl(record.url)) throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
    return Object.freeze({ file_urls: Object.freeze([record.url]) });
  }

  /** Consume exactly one local handle after checking its fresh owner, contract, and candidate URL. */
  async consumeImageReference(input: ConsumeOwnerImageReferenceInput | unknown): Promise<void> {
    const request = snapshotConsumeInput(input);
    this.#assertOpen();
    const principal = await resolveOwnerReferencePrincipal({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    const now = this.#readNow();
    this.#pruneExpired(now);
    const record = this.#records.get(request.referenceHandle);
    if (!record) throw new OwnerMediaReferenceStoreError("REFERENCE_NOT_FOUND");
    if (record.expiresAt <= now) {
      this.#records.delete(record.referenceHandle);
      throw new OwnerMediaReferenceStoreError("REFERENCE_EXPIRED");
    }
    if (record.principalKey !== generationPrincipalKey(principal) || !sameGenerationPrincipal(record.principal, principal) ||
        !sameContractBinding(record.contract, request.contract) || record.url !== request.expectedUrl) {
      throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    }
    if (!IMAGE_MIME_TYPES.has(record.mimeType) || record.size < 1 || record.size > MAX_FILE_BYTES ||
        !isSafeUploadReferenceUrl(record.url)) throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
    this.#records.delete(record.referenceHandle);
  }

  /** Resolve an ordered Grok reference list after two exact owner/attempt checks; no handles are consumed. */
  async resolveOrderedImageReferences(input: ResolveOrderedOwnerImageReferencesInput | unknown): Promise<Readonly<{ file_urls: readonly string[] }>> {
    const request = snapshotOrderedResolveInput(input);
    this.#assertOpen();
    const principal = await resolveOwnerReferencePrincipal({
      binding: request.binding, attemptId: request.attemptId, linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    const initialRecords = this.#validateOrderedRecords(request, principal, this.#readNow());
    const currentPrincipal = await resolveOwnerReferencePrincipal({
      binding: request.binding, attemptId: request.attemptId, linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    if (!sameGenerationPrincipal(principal, currentPrincipal)) throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    const finalRecords = this.#validateOrderedRecords(request, currentPrincipal, this.#readNow());
    if (finalRecords.some((record, index) => record !== initialRecords[index])) {
      throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    }
    return Object.freeze({ file_urls: Object.freeze(finalRecords.map((record) => record.url)) });
  }

  /** Consume the complete ordered list atomically after fresh principal and record checks. */
  async consumeOrderedImageReferences(input: ConsumeOrderedOwnerImageReferencesInput | unknown): Promise<void> {
    const request = snapshotOrderedConsumeInput(input);
    this.#assertOpen();
    const principal = await resolveOwnerReferencePrincipal({
      binding: request.binding, attemptId: request.attemptId, linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    const initialRecords = this.#validateOrderedRecords(request, principal, this.#readNow());
    const currentPrincipal = await resolveOwnerReferencePrincipal({
      binding: request.binding, attemptId: request.attemptId, linkService: request.linkService
    }).catch(() => { throw new OwnerMediaReferenceStoreError("REFERENCE_PRINCIPAL_NOT_LINKED"); });
    this.#assertOpen();
    if (!sameGenerationPrincipal(principal, currentPrincipal)) throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    const finalRecords = this.#validateOrderedRecords(request, currentPrincipal, this.#readNow());
    if (finalRecords.some((record, index) => record !== initialRecords[index] || record.url !== request.expectedFileUrls[index])) {
      throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
    }
    // The validation above is synchronous and complete; no await can interleave with this deletion loop.
    for (const record of finalRecords) this.#records.delete(record.referenceHandle);
  }

  #validateOrderedRecords(
    request: ReturnType<typeof snapshotOrderedResolveInput>,
    principal: Readonly<GenerationPrincipalRef>,
    now: number
  ): InternalImageReferenceRecord[] {
    return request.referenceHandles.map((handle) => {
      const record = this.#records.get(handle);
      if (!record) throw new OwnerMediaReferenceStoreError("REFERENCE_NOT_FOUND");
      if (record.expiresAt <= now) throw new OwnerMediaReferenceStoreError("REFERENCE_EXPIRED");
      if (record.principalKey !== generationPrincipalKey(principal) || !sameGenerationPrincipal(record.principal, principal) ||
          !sameContractBinding(record.contract, request.contract)) throw new OwnerMediaReferenceStoreError("REFERENCE_SCOPE_MISMATCH");
      if (!IMAGE_MIME_TYPES.has(record.mimeType) || record.size < 1 || record.size > MAX_FILE_BYTES ||
          !isSafeUploadReferenceUrl(record.url)) throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
      return record;
    });
  }

  invalidateByPrincipal(principalInput: GenerationPrincipalRef): void {
    const principal = snapshotGenerationPrincipal(principalInput);
    for (const [handle, record] of this.#records) {
      if (sameGenerationPrincipal(record.principal, principal)) this.#records.delete(handle);
    }
    const pending = this.#pendingByPrincipal.get(generationPrincipalKey(principal));
    if (pending) for (const token of pending) token.invalidated = true;
  }

  close(): void {
    this.#closed = true;
    this.#records.clear();
  }

  #assertOpen(): void {
    if (this.#closed) throw new OwnerMediaReferenceStoreError("REFERENCE_STORE_CLOSED");
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isFinite(now) || now < 0) throw new OwnerMediaReferenceStoreError("REFERENCE_STORE_CLOSED");
    return now;
  }

  #pruneExpired(now: number): void {
    for (const [handle, record] of this.#records) {
      if (record.expiresAt <= now) this.#records.delete(handle);
    }
  }

  #trackPending(principalKey: string, token: { invalidated: boolean }): void {
    const pending = this.#pendingByPrincipal.get(principalKey) ?? new Set<{ invalidated: boolean }>();
    pending.add(token);
    this.#pendingByPrincipal.set(principalKey, pending);
  }

  #assertPending(token: { invalidated: boolean }, afterUpload = false): void {
    if (token.invalidated) {
      throw new OwnerMediaReferenceStoreError(afterUpload ? "REFERENCE_UPLOAD_OUTCOME_UNKNOWN" : "REFERENCE_PRINCIPAL_NOT_LINKED");
    }
  }

  #untrackPending(principalKey: string, token: { invalidated: boolean }): void {
    const pending = this.#pendingByPrincipal.get(principalKey);
    if (!pending) return;
    pending.delete(token);
    if (pending.size === 0) this.#pendingByPrincipal.delete(principalKey);
  }
}

export class OwnerMediaReferenceStoreError extends Error {
  constructor(readonly code:
    | "REFERENCE_RECEIPT_INVALID"
    | "REFERENCE_NOT_FOUND"
    | "REFERENCE_EXPIRED"
    | "REFERENCE_SCOPE_MISMATCH"
    | "REFERENCE_COUNT_INVALID"
    | "REFERENCE_PRINCIPAL_NOT_LINKED"
    | "REFERENCE_UPLOAD_REJECTED"
    | "REFERENCE_UPLOAD_OUTCOME_UNKNOWN"
    | "REFERENCE_STORE_FULL"
    | "REFERENCE_STORE_CLOSED"
    | "INVALID_REQUEST") {
    super("The owner media reference is unavailable.");
    this.name = "OwnerMediaReferenceStoreError";
  }
}

function snapshotUploadInput(input: UploadOwnerMediaReferenceInput) {
  const fields = readExactDataRecord(input, ["binding", "attemptId", "linkService", "client", "contract", "filename", "mime_type", "bytes"]);
  const contract = snapshotContract(fields.contract);
  const linkService = snapshotLinkService(fields.linkService);
  const client = fields.client as Pick<SyntxChatHttpClient, "uploadFileReferences">;
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      typeof fields.filename !== "string" || !SAFE_FILENAME.test(fields.filename) ||
      typeof fields.mime_type !== "string" || !IMAGE_MIME_TYPES.has(fields.mime_type) ||
      !(fields.bytes instanceof Uint8Array) || isProxy(fields.bytes) || fields.bytes.byteLength < 1 || fields.bytes.byteLength > MAX_FILE_BYTES ||
      !client || typeof client !== "object" || isProxy(client)) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  const uploadMethod = readDataMethod(client, "uploadFileReferences");
  if (typeof uploadMethod !== "function") throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  const uploadFileReferences: SyntxChatHttpClient["uploadFileReferences"] = (request) =>
    Reflect.apply(uploadMethod, client, [request]) as ReturnType<SyntxChatHttpClient["uploadFileReferences"]>;
  const bindingFields = readExactDataRecord(fields.binding, ["tenant_id", "subject"]);
  const attemptId = fields.attemptId;
  const principalCandidate = snapshotGenerationPrincipal({
    tenant_id: bindingFields.tenant_id as string,
    subject_id: bindingFields.subject as string,
    connection_id: attemptId
  });
  return {
    binding: Object.freeze({ tenant_id: principalCandidate.tenant_id, subject: principalCandidate.subject_id }),
    attemptId,
    principalKey: generationPrincipalKey(principalCandidate),
    linkService,
    uploadFileReferences,
    contract,
    filename: fields.filename,
    mime_type: fields.mime_type,
    bytes: Uint8Array.prototype.slice.call(fields.bytes) as Uint8Array
  };
}

function isKnownUploadRejection(code: SyntxHttpError["code"]): boolean {
  return code === "INVALID_REQUEST" || code === "AUTH_REQUIRED" ||
    code === "AUTH_OR_ACCESS_DENIED" || code === "UPSTREAM_RATE_LIMITED";
}

function snapshotResolveInput(input: ResolveOwnerImageReferencesInput) {
  const fields = readExactDataRecord(input, ["binding", "attemptId", "linkService", "contract", "reference_handles"]);
  const contract = snapshotContract(fields.contract);
  const linkService = snapshotLinkService(fields.linkService);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !Array.isArray(fields.reference_handles) ||
      isProxy(fields.reference_handles) || fields.reference_handles.some((handle) => typeof handle !== "string" || !SAFE_REFERENCE_HANDLE.test(handle))) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return {
    binding: fields.binding as AuthBinding,
    attemptId: fields.attemptId,
    linkService,
    contract,
    referenceHandles: [...fields.reference_handles] as string[]
  };
}

function snapshotOrderedResolveInput(input: ResolveOrderedOwnerImageReferencesInput | unknown) {
  const fields = readExactDataRecord(input, ["server_contract", "binding", "attemptId", "linkService", "contract", "reference_handles"]);
  const contract = snapshotContract(fields.contract);
  const serverContract = snapshotImageReferenceServerContract(fields.server_contract, contract);
  const range = imageReferenceCountRange(serverContract);
  const referenceHandles = snapshotStringArray(fields.reference_handles, range.max, SAFE_REFERENCE_HANDLE, "REFERENCE_COUNT_INVALID");
  assertReferenceCount(referenceHandles.length, range);
  if (new Set(referenceHandles).size !== referenceHandles.length) throw new OwnerMediaReferenceStoreError("REFERENCE_COUNT_INVALID");
  const linkService = snapshotLinkService(fields.linkService);
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId)) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return {
    serverContract,
    binding: fields.binding as AuthBinding,
    attemptId: fields.attemptId,
    linkService,
    contract,
    referenceHandles
  };
}

function snapshotOrderedConsumeInput(input: ConsumeOrderedOwnerImageReferencesInput | unknown) {
  const fields = readExactDataRecord(input, ["server_contract", "binding", "attemptId", "linkService", "contract", "reference_handles", "expected_file_urls"]);
  const base = snapshotOrderedResolveInput({
    server_contract: fields.server_contract,
    binding: fields.binding,
    attemptId: fields.attemptId,
    linkService: fields.linkService,
    contract: fields.contract,
    reference_handles: fields.reference_handles
  });
  const expectedFileUrls = snapshotStringArray(fields.expected_file_urls, imageReferenceCountRange(base.serverContract).max,
    /^https:\/\//u, "INVALID_REQUEST");
  assertReferenceCount(expectedFileUrls.length, imageReferenceCountRange(base.serverContract));
  if (expectedFileUrls.length !== base.referenceHandles.length || expectedFileUrls.some((url) => !isSafeUploadReferenceUrl(url))) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return { ...base, expectedFileUrls };
}

function snapshotImageReferenceServerContract(value: unknown, contract: OwnerMediaReferenceContractBinding): OwnerMediaReferenceServerContract {
  if ((value !== "grok_i2i" && value !== "grok_i2i_pro") || contract.model_id !== value || contract.model_type !== value ||
      contract.operation_id !== "generate-image" || contract.modality !== "image") {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return value;
}

function imageReferenceCountRange(serverContract: OwnerMediaReferenceServerContract): Readonly<{ min: 1; max: 1 | 3 }> {
  return serverContract === "grok_i2i"
    ? Object.freeze({ min: 1 as const, max: 3 as const })
    : Object.freeze({ min: 1 as const, max: 1 as const });
}

function assertReferenceCount(count: number, range: Readonly<{ min: number; max: number }>): void {
  if (count < range.min || count > range.max) throw new OwnerMediaReferenceStoreError("REFERENCE_COUNT_INVALID");
}

function snapshotStringArray(value: unknown, maxItems: number, itemPattern: RegExp, countError: "INVALID_REQUEST" | "REFERENCE_COUNT_INVALID"): string[] {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  const arrayObject: object = value;
  const descriptors = Object.getOwnPropertyDescriptors(arrayObject);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(arrayObject, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  const length = lengthDescriptor.value;
  if (length > maxItems) throw new OwnerMediaReferenceStoreError(countError);
  if (keys.length !== length + 1) throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  const items: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !itemPattern.test(descriptor.value)) {
      throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
    }
    items.push(descriptor.value);
  }
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)) ||
      (key !== "length" && Number(key) >= length))) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return items;
}

function snapshotConsumeInput(input: ConsumeOwnerImageReferenceInput | unknown) {
  const fields = readExactDataRecord(input, ["binding", "attemptId", "linkService", "contract", "reference_handles", "reference_handle", "expected_url"]);
  const base = snapshotResolveInput({
    binding: fields.binding as AuthBinding,
    attemptId: fields.attemptId as string,
    linkService: fields.linkService as Pick<PerUserLinkService, "getStatus">,
    contract: fields.contract as OwnerMediaReferenceContractBinding,
    reference_handles: fields.reference_handles as readonly string[]
  });
  if (base.referenceHandles.length !== 1 || fields.reference_handle !== base.referenceHandles[0] ||
      typeof fields.expected_url !== "string" || !isSafeUploadReferenceUrl(fields.expected_url)) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return { ...base, referenceHandle: base.referenceHandles[0]!, expectedUrl: fields.expected_url };
}

function snapshotContract(input: unknown): Readonly<OwnerMediaReferenceContractBinding> {
  const fields = readExactDataRecord(input, ["schema_hash", "catalog_version", "model_id", "model_type", "operation_id", "modality", "variant_id"]);
  if (typeof fields.schema_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(fields.schema_hash) ||
      typeof fields.catalog_version !== "string" || !/^sha256-[a-f0-9]{64}\.json$/u.test(fields.catalog_version) ||
      typeof fields.model_id !== "string" || !SAFE_IDENTIFIER.test(fields.model_id) ||
      typeof fields.model_type !== "string" || !SAFE_IDENTIFIER.test(fields.model_type) ||
      typeof fields.variant_id !== "string" || !SAFE_IDENTIFIER.test(fields.variant_id) ||
      (fields.operation_id !== "generate-image" && fields.operation_id !== "generate-video") ||
      (fields.modality !== "image" && fields.modality !== "video") ||
      (fields.operation_id === "generate-image") !== (fields.modality === "image")) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  return Object.freeze({
    schema_hash: fields.schema_hash,
    catalog_version: fields.catalog_version,
    model_id: fields.model_id,
    model_type: fields.model_type,
    operation_id: fields.operation_id,
    modality: fields.modality,
    variant_id: fields.variant_id
  });
}

function parseOneAttributableReference(value: unknown): InternalUploadReference {
  if (!Array.isArray(value) || isProxy(value) || value.length !== 1) throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
  const fields = readExactDataRecord(value[0], ["url", "file_id"]);
  if (typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) ||
      (fields.file_id !== undefined && (typeof fields.file_id !== "string" || !SAFE_FILE_ID.test(fields.file_id)))) {
    throw new OwnerMediaReferenceStoreError("REFERENCE_RECEIPT_INVALID");
  }
  return Object.freeze({ url: fields.url, ...(fields.file_id === undefined ? {} : { file_id: fields.file_id }) });
}

function sameContractBinding(left: OwnerMediaReferenceContractBinding, right: OwnerMediaReferenceContractBinding): boolean {
  return left.schema_hash === right.schema_hash && left.catalog_version === right.catalog_version &&
    left.model_id === right.model_id && left.model_type === right.model_type &&
    left.operation_id === right.operation_id && left.modality === right.modality && left.variant_id === right.variant_id;
}

function readExactDataRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) {
    throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
    result[key] = descriptor.value;
  }
  return result;
}

function readDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || isProxy(value)) throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  const method = readDataMethod(value, "getStatus");
  if (typeof method !== "function") throw new OwnerMediaReferenceStoreError("INVALID_REQUEST");
  return Object.freeze({
    getStatus: (binding: AuthBinding, attemptId: string) =>
      Reflect.apply(method, value, [binding, attemptId]) as ReturnType<PerUserLinkService["getStatus"]>
  });
}
