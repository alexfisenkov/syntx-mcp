import { isDeepStrictEqual, types } from "node:util";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import {
  isOwnerBananaInpaintImageRequestPreparer,
  OwnerBananaInpaintImageRequestPreparerError,
  type OwnerBananaInpaintImageCandidateBinding,
  type OwnerBananaInpaintImagePreparedCandidate,
  type OwnerBananaInpaintImageRequest,
  type OwnerBananaInpaintImageRequestPreparer
} from "./owner-banana-inpaint-image-request-preparer.js";

const ATTEMPT = /^link_[A-Za-z0-9_-]{20,120}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const BRAND: unique symbol = Symbol("OwnerBananaInpaintImageOneShotPermit");
const permits = new WeakMap<object, PermitState>();
const candidatePermits = new WeakMap<object, object>();

export interface CreateOwnerBananaInpaintImageOneShotPermitInput {
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

/** Opaque local receipt; it is not an operator, billing, provider, or dispatch grant. */
export interface OwnerBananaInpaintImageOneShotPermit {
  readonly [BRAND]: true;
  readonly status: "nominal";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly expires_at: number;
}

export interface RevalidateOwnerBananaInpaintImageOneShotPermitInput {
  readonly permit: OwnerBananaInpaintImageOneShotPermit;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface ConsumeOwnerBananaInpaintImageOneShotPermitInput extends RevalidateOwnerBananaInpaintImageOneShotPermitInput {}

export interface OwnerBananaInpaintImageOneShotPermitReceipt {
  readonly status: "consumed";
  readonly dispatch_allowed: false;
  readonly request_fingerprint: string;
}

export type OwnerBananaInpaintImageOneShotPolicyErrorCode =
  | "INVALID_REQUEST" | "PREPARER_UNTRUSTED" | "CANDIDATE_UNBOUND" | "CANDIDATE_EXPIRED"
  | "PRINCIPAL_MISMATCH" | "SOURCE_BINDING_MISMATCH" | "CANDIDATE_ALREADY_ISSUED"
  | "PERMIT_INVALID" | "PERMIT_ALREADY_CONSUMED" | "PERMIT_NOT_REVALIDATED" | "CANDIDATE_MISMATCH";

export class OwnerBananaInpaintImageOneShotPolicyError extends Error {
  constructor(readonly code: OwnerBananaInpaintImageOneShotPolicyErrorCode) {
    super("The Banana Inpaint image one-shot policy could not be satisfied.");
    this.name = "OwnerBananaInpaintImageOneShotPolicyError";
  }
}

interface PermitState {
  readonly permit: OwnerBananaInpaintImageOneShotPermit;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerBananaInpaintImageCandidateBinding>;
  readonly bindingFingerprint: string;
  readonly candidateFingerprint: string;
  readonly privateRequestFingerprint: string;
  readonly requestFingerprint: string;
  readonly intentFingerprint: string;
  revalidated: boolean;
  consumed: boolean;
}

/** Issues one nominal receipt for one actual preparer candidate after a fresh pair read. */
export async function createOwnerBananaInpaintImageOneShotPermit(
  inputInput: CreateOwnerBananaInpaintImageOneShotPermitInput | unknown
): Promise<OwnerBananaInpaintImageOneShotPermit> {
  const fields = exact(inputInput, ["preparer", "candidate", "principal", "attemptId"]);
  const preparer = trustedPreparer(fields.preparer);
  const attemptId = readAttempt(fields.attemptId);
  const principal = readPrincipal(fields.principal, attemptId);
  const candidate = fields.candidate as OwnerBananaInpaintImagePreparedCandidate;
  const binding = readCurrentBinding(preparer, candidate);
  assertBinding(candidate, binding, principal, attemptId);
  if (candidatePermits.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const request = readPrivateRequest(preparer, candidate);
  const privateRequestFingerprint = schemaHash(request);
  const candidateFingerprint = fingerprintRequest(candidate, binding, request);
  const bindingFingerprint = schemaHash(binding);
  try {
    const refreshed = await Reflect.apply(preparer.revalidateCandidate, preparer, [candidate]);
    assertFreshBinding(candidate, binding, refreshed, preparer, principal, attemptId, privateRequestFingerprint, candidateFingerprint);
  } catch (error) {
    if (error instanceof OwnerBananaInpaintImageOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
  if (candidatePermits.has(candidate)) fail("CANDIDATE_ALREADY_ISSUED");
  const permit: OwnerBananaInpaintImageOneShotPermit = Object.freeze({
    [BRAND]: true as const,
    status: "nominal" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    expires_at: binding.expires_at
  });
  permits.set(permit, {
    permit, candidate, preparer, principal, attemptId, binding,
    bindingFingerprint, candidateFingerprint, privateRequestFingerprint,
    requestFingerprint: binding.request_fingerprint,
    intentFingerprint: binding.intent_fingerprint,
    revalidated: false, consumed: false
  });
  candidatePermits.set(candidate, permit);
  return permit;
}

/** Re-reads the owned pair asynchronously; success is kept only in private permit state. */
export async function revalidateOwnerBananaInpaintImageOneShotPermit(
  inputInput: RevalidateOwnerBananaInpaintImageOneShotPermitInput | unknown
): Promise<void> {
  const fields = readPermitInput(inputInput);
  const state = readPermitState(fields);
  state.revalidated = false;
  try {
    const refreshed = await Reflect.apply(state.preparer.revalidateCandidate, state.preparer, [state.candidate]);
    assertFreshBinding(state.candidate, state.binding, refreshed, state.preparer, state.principal, state.attemptId,
      state.privateRequestFingerprint, state.candidateFingerprint);
    assertPermitBinding(state);
    state.revalidated = true;
  } catch (error) {
    state.revalidated = false;
    if (error instanceof OwnerBananaInpaintImageOneShotPolicyError) throw error;
    fail("CANDIDATE_EXPIRED");
  }
}

/** Burns the actual permit synchronously, immediately before a future native POST. */
export function consumeOwnerBananaInpaintImageOneShotPermit(
  inputInput: ConsumeOwnerBananaInpaintImageOneShotPermitInput | unknown
): OwnerBananaInpaintImageOneShotPermitReceipt {
  const fields = readPermitInput(inputInput);
  const state = readPermitState(fields);
  if (!state.revalidated) fail("PERMIT_NOT_REVALIDATED");
  assertPermitBinding(state);
  state.consumed = true;
  state.revalidated = false;
  return Object.freeze({ status: "consumed", dispatch_allowed: false, request_fingerprint: state.requestFingerprint });
}

function assertFreshBinding(candidate: OwnerBananaInpaintImagePreparedCandidate,
  original: Readonly<OwnerBananaInpaintImageCandidateBinding>, refreshedInput: unknown,
  preparer: OwnerBananaInpaintImageRequestPreparer, principal: Readonly<GenerationPrincipalRef>, attemptId: string,
  privateRequestFingerprint: string, candidateFingerprint: string): void {
  const refreshed = readBinding(refreshedInput);
  if (!isDeepStrictEqual(refreshed, original)) fail("CANDIDATE_MISMATCH");
  assertBinding(candidate, refreshed, principal, attemptId);
  const request = readPrivateRequest(preparer, candidate);
  if (schemaHash(request) !== privateRequestFingerprint || fingerprintRequest(candidate, refreshed, request) !== candidateFingerprint) {
    fail("CANDIDATE_MISMATCH");
  }
  const current = readCurrentBinding(preparer, candidate);
  if (!isDeepStrictEqual(current, refreshed)) fail("CANDIDATE_EXPIRED");
}

function assertPermitBinding(state: PermitState): void {
  if (candidatePermits.get(state.candidate) !== state.permit ||
      schemaHash(readCurrentBinding(state.preparer, state.candidate)) !== state.bindingFingerprint ||
      schemaHash(readPrivateRequest(state.preparer, state.candidate)) !== state.privateRequestFingerprint ||
      fingerprintRequest(state.candidate, state.binding, readPrivateRequest(state.preparer, state.candidate)) !== state.candidateFingerprint ||
      state.permit.expires_at !== state.binding.expires_at || state.permit.status !== "nominal" ||
      state.permit.dispatch_allowed !== false || state.permit.backend_acceptance !== "UNPROVEN") fail("CANDIDATE_MISMATCH");
}

function readPermitInput(value: unknown): Readonly<ConsumeOwnerBananaInpaintImageOneShotPermitInput> {
  const fields = exact(value, ["permit", "candidate", "preparer", "principal", "attemptId"]);
  const preparer = trustedPreparer(fields.preparer);
  const attemptId = readAttempt(fields.attemptId);
  const principal = readPrincipal(fields.principal, attemptId);
  return Object.freeze({ permit: fields.permit as OwnerBananaInpaintImageOneShotPermit,
    candidate: fields.candidate as OwnerBananaInpaintImagePreparedCandidate, preparer, principal, attemptId });
}

function readPermitState(fields: Readonly<ConsumeOwnerBananaInpaintImageOneShotPermitInput>): PermitState {
  const permit = fields.permit;
  if (!permit || typeof permit !== "object" || types.isProxy(permit)) fail("PERMIT_INVALID");
  const state = permits.get(permit);
  if (!state || state.permit !== permit || !hasPermitShape(permit)) fail("PERMIT_INVALID");
  if (state.consumed) fail("PERMIT_ALREADY_CONSUMED");
  if (fields.preparer !== state.preparer) fail("PREPARER_UNTRUSTED");
  if (fields.candidate !== state.candidate) fail("CANDIDATE_MISMATCH");
  if (fields.attemptId !== state.attemptId || !sameGenerationPrincipal(fields.principal, state.principal)) fail("PRINCIPAL_MISMATCH");
  assertBinding(state.candidate, readCurrentBinding(state.preparer, state.candidate), state.principal, state.attemptId);
  return state;
}

function hasPermitShape(permit: OwnerBananaInpaintImageOneShotPermit): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(permit);
    const keys = Reflect.ownKeys(descriptors);
    return Object.isFrozen(permit) && keys.length === 5 && keys.includes(BRAND) &&
      ["status", "dispatch_allowed", "backend_acceptance", "expires_at"].every((key) => {
        const descriptor = descriptors[key];
        return descriptor !== undefined && "value" in descriptor && descriptor.enumerable && !descriptor.writable && !descriptor.configurable;
      }) && descriptors[BRAND] !== undefined && "value" in descriptors[BRAND]! && descriptors[BRAND]!.value === true;
  } catch { return false; }
}

function assertBinding(candidate: OwnerBananaInpaintImagePreparedCandidate,
  binding: Readonly<OwnerBananaInpaintImageCandidateBinding>, principal: Readonly<GenerationPrincipalRef>, attemptId: string): void {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) ||
      !Object.isFrozen(candidate) || Object.getPrototypeOf(candidate) !== null ||
      candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      candidate.profile_id !== binding.profile_id || candidate.profile_schema_hash !== binding.profile_schema_hash ||
      !isDeepStrictEqual(candidate.source_binding, binding.source_binding) || candidate.variant !== binding.variant ||
      candidate.model_type !== binding.variant || candidate.ai_name !== "banana" || candidate.form_ai_name !== "banana_inpaint" ||
      candidate.form_id !== "banana-inpaint" || candidate.scope !== "tool_image_inpaint" ||
      candidate.expires_at !== binding.expires_at || candidate.request_fingerprint !== binding.request_fingerprint ||
      candidate.intent_fingerprint !== binding.intent_fingerprint || binding.attempt_id !== attemptId ||
      !sameGenerationPrincipal(binding.principal, principal) || binding.auxiliary_reference_handle !== null &&
        (typeof binding.auxiliary_reference_handle !== "string" || !SAFE_ID.test(binding.auxiliary_reference_handle)) ||
      !SHA256.test(candidate.profile_schema_hash) || !SHA256.test(candidate.request_fingerprint) || !SHA256.test(candidate.intent_fingerprint)) {
    fail(binding.attempt_id !== attemptId || !sameGenerationPrincipal(binding.principal, principal) ? "PRINCIPAL_MISMATCH" : "CANDIDATE_MISMATCH");
  }
  readBinding(binding);
}

function readCurrentBinding(preparer: OwnerBananaInpaintImageRequestPreparer,
  candidate: OwnerBananaInpaintImagePreparedCandidate): Readonly<OwnerBananaInpaintImageCandidateBinding> {
  let binding: unknown;
  try { binding = Reflect.apply(preparer.inspectCandidate, preparer, [candidate]); }
  catch (error) { mapPreparerError(error); }
  if (!binding) {
    try { Reflect.apply(preparer.getPrivateRequest, preparer, [candidate]); }
    catch (error) { mapPreparerError(error); }
    fail("CANDIDATE_UNBOUND");
  }
  return readBinding(binding);
}

function mapPreparerError(error: unknown): never {
  if (error instanceof OwnerBananaInpaintImageRequestPreparerError) {
    fail(error.code === "CANDIDATE_EXPIRED" || error.code === "SERVICE_CLOSED" || error.code === "CLOCK_INVALID"
      ? "CANDIDATE_EXPIRED" : "CANDIDATE_UNBOUND");
  }
  fail("CANDIDATE_EXPIRED");
}

function readBinding(value: unknown): Readonly<OwnerBananaInpaintImageCandidateBinding> {
  const fields = exact(value, ["attempt_id", "principal", "variant", "profile_id", "profile_schema_hash", "source_binding",
    "original_handle", "painted_handle", "original_sha256", "painted_sha256", "original_epoch", "painted_epoch", "expires_at",
    "request_fingerprint", "intent_fingerprint", "auxiliary_reference_handle", "auxiliary_profile_schema_hash", "auxiliary_sha256",
    "auxiliary_epoch", "auxiliary_expires_at"]);
  const principal = readPrincipal(fields.principal, readAttempt(fields.attempt_id));
  if (typeof fields.variant !== "string" || !["banana", "banana2", "banana3", "banana3_light"].includes(fields.variant) ||
      !isSafeId(fields.profile_id) || !isSha256(fields.profile_schema_hash) ||
      !fields.source_binding || typeof fields.source_binding !== "object" || types.isProxy(fields.source_binding) || !Object.isFrozen(fields.source_binding) ||
      !isSafeId(fields.original_handle) || !isSafeId(fields.painted_handle) ||
      !isSha256(fields.original_sha256) || !isSha256(fields.painted_sha256) ||
      !Number.isSafeInteger(fields.original_epoch) || (fields.original_epoch as number) < 0 ||
      !Number.isSafeInteger(fields.painted_epoch) || (fields.painted_epoch as number) < 0 ||
      !Number.isSafeInteger(fields.expires_at) || (fields.expires_at as number) <= 0 ||
      !isSha256(fields.request_fingerprint) || !isSha256(fields.intent_fingerprint)) {
    fail("CANDIDATE_MISMATCH");
  }
  const auxiliaryAbsent = fields.auxiliary_reference_handle === null;
  const auxiliaryFields = [fields.auxiliary_profile_schema_hash, fields.auxiliary_sha256, fields.auxiliary_epoch, fields.auxiliary_expires_at];
  if (auxiliaryAbsent
    ? auxiliaryFields.some((field) => field !== null)
    : !isSafeId(fields.auxiliary_reference_handle) || !isSha256(fields.auxiliary_profile_schema_hash) ||
      !isSha256(fields.auxiliary_sha256) || !Number.isSafeInteger(fields.auxiliary_epoch) ||
      (fields.auxiliary_epoch as number) < 0 || !Number.isSafeInteger(fields.auxiliary_expires_at) ||
      (fields.auxiliary_expires_at as number) <= 0 || (fields.auxiliary_expires_at as number) < (fields.expires_at as number)) {
    fail("CANDIDATE_MISMATCH");
  }
  return Object.freeze({ ...fields, principal }) as unknown as Readonly<OwnerBananaInpaintImageCandidateBinding>;
}

function readPrivateRequest(preparer: OwnerBananaInpaintImageRequestPreparer,
  candidate: OwnerBananaInpaintImagePreparedCandidate): Readonly<OwnerBananaInpaintImageRequest> {
  let request: unknown;
  try { request = Reflect.apply(preparer.getPrivateRequest, preparer, [candidate]); }
  catch { fail("CANDIDATE_EXPIRED"); }
  const body = exact(request, ["prompt", "settings"]);
  if (typeof body.prompt !== "string") fail("CANDIDATE_MISMATCH");
  const settings = exact(body.settings, ["editor", "model_type", "image_size", "file_urls"]);
  if (settings.editor !== true || settings.model_type !== candidate.variant || settings.image_size !== candidate.image_size ||
      !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls)) fail("CANDIDATE_MISMATCH");
  const files = settings.file_urls as unknown[];
  if (files.length !== candidate.reference_count || (files.length !== 2 && files.length !== 3)) fail("CANDIDATE_MISMATCH");
  const expectedTypes = files.length === 2 ? ["image", "mask"] : ["image", "mask", "image"];
  for (let index = 0; index < files.length; index += 1) {
    const file = exact(files[index], ["type", "url"]);
    if (file.type !== expectedTypes[index] || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) fail("CANDIDATE_MISMATCH");
  }
  if (!Array.isArray(candidate.references) || types.isProxy(candidate.references) || candidate.references.length !== files.length) fail("CANDIDATE_MISMATCH");
  return Object.freeze({ prompt: body.prompt, settings: settings as unknown as OwnerBananaInpaintImageRequest["settings"] });
}

function fingerprintRequest(candidate: OwnerBananaInpaintImagePreparedCandidate,
  binding: Readonly<OwnerBananaInpaintImageCandidateBinding>, request: Readonly<OwnerBananaInpaintImageRequest>): string {
  if (binding.auxiliary_reference_handle === null && request.settings.file_urls.length !== 2 ||
      binding.auxiliary_reference_handle !== null && request.settings.file_urls.length !== 2 && request.settings.file_urls.length !== 3) {
    fail("SOURCE_BINDING_MISMATCH");
  }
  return schemaHash({ candidate: { profile_id: candidate.profile_id, profile_schema_hash: candidate.profile_schema_hash,
    source_binding: candidate.source_binding, variant: candidate.variant, model_type: candidate.model_type, image_size: candidate.image_size,
    reference_count: candidate.reference_count, references: candidate.references, expires_at: candidate.expires_at,
    request_fingerprint: candidate.request_fingerprint, intent_fingerprint: candidate.intent_fingerprint }, binding, request });
}

function trustedPreparer(value: unknown): OwnerBananaInpaintImageRequestPreparer {
  if (!isOwnerBananaInpaintImageRequestPreparer(value)) fail("PREPARER_UNTRUSTED");
  return value;
}

function readAttempt(value: unknown): string {
  if (typeof value !== "string" || !ATTEMPT.test(value)) fail("INVALID_REQUEST");
  return value;
}

function readPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail("PRINCIPAL_MISMATCH"); }
  if (principal.connection_id !== attemptId) fail("PRINCIPAL_MISMATCH");
  return principal;
}

function isSha256(value: unknown): value is string { return typeof value === "string" && SHA256.test(value); }
function isSafeId(value: unknown): value is string { return typeof value === "string" && SAFE_ID.test(value); }

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) fail("INVALID_REQUEST");
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of ownKeys as string[]) output[key] = descriptors[key]!.value;
    return output;
  } catch (error) {
    if (error instanceof OwnerBananaInpaintImageOneShotPolicyError) throw error;
    fail("INVALID_REQUEST");
  }
}

function fail(code: OwnerBananaInpaintImageOneShotPolicyErrorCode): never {
  throw new OwnerBananaInpaintImageOneShotPolicyError(code);
}
