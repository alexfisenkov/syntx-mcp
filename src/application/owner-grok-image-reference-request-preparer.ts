import { types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import { OwnerReferencePrincipalError, resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../catalog/selected-discovery-catalog.js";
import {
  getOwnerGrokImageReferenceProfile,
  OwnerGrokImageReferenceProfileError,
  validateOwnerGrokImageReferenceParameters,
  type OwnerGrokImageReferenceProfile,
  type OwnerGrokImageReferenceProfileId,
  type OwnerGrokImageReferenceProfileSet,
  type OwnerGrokImageReferenceNormalizedRequest
} from "../catalog/owner-grok-image-reference-profiles.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { GenerationContractV2JsonValue } from "../domain/generation-contract-v2.js";
import {
  OwnerMediaReferenceStore,
  type OwnerMediaReferenceContractBinding
} from "./owner-media-reference-store.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REFERENCE_HANDLE_PATTERN = /^reference_[0-9a-f-]{36}$/u;
const candidateBrand: unique symbol = Symbol("OwnerGrokImageReferencePreparedCandidate");
const candidateStates = new WeakMap<object, CandidateState>();

export interface PrepareOwnerGrokImageReferenceRequestInput {
  readonly profile_set: OwnerGrokImageReferenceProfileSet;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly store: OwnerMediaReferenceStore;
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly reference_handles: readonly string[];
  readonly parameters: unknown;
}

export interface OwnerGrokImageReferencePreparedCandidate {
  readonly [candidateBrand]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "unproven";
  readonly profile_set_sha256: string;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly profile_schema_hash: string;
  readonly profile_catalog_version: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly model_type: string;
  readonly operation_id: "generate-image";
  readonly modality: "image";
  readonly variant_id: string;
  readonly reference_count: number;
  readonly reference_order_sha256: string;
  readonly request_fingerprint: string;
  readonly request: Readonly<{
    prompt: string;
    settings: Readonly<Record<string, GenerationContractV2JsonValue>>;
  }>;
}

export type OwnerGrokImageReferencePrepareErrorCode =
  | "INVALID_REQUEST"
  | "PROFILE_SET_INVALID"
  | "PROFILE_INVALID"
  | "PARAMETERS_INVALID"
  | "REFERENCE_UNAVAILABLE"
  | "PRINCIPAL_MISMATCH";

export class OwnerGrokImageReferencePrepareError extends Error {
  constructor(readonly code: OwnerGrokImageReferencePrepareErrorCode) {
    super("The owner Grok image-reference candidate could not be prepared safely.");
    this.name = "OwnerGrokImageReferencePrepareError";
  }
}

export interface OwnerGrokImageReferenceCandidateBinding {
  readonly profile_set_sha256: string;
  readonly profile_id: OwnerGrokImageReferenceProfileId;
  readonly profile_schema_hash: string;
  readonly catalog_version: string;
  readonly model_id: string;
  readonly model_type: string;
  readonly variant_id: string;
  readonly request_fingerprint: string;
  readonly reference_order_sha256: string;
  readonly reference_count: number;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
}

/** Resolve an authentic reviewed profile to the exact opaque-handle store binding. */
export function getOwnerGrokReferenceStoreBinding(
  profileSetInput: OwnerGrokImageReferenceProfileSet | unknown,
  profileIdInput: OwnerGrokImageReferenceProfileId | string
): OwnerMediaReferenceContractBinding {
  const { profileSet, profile } = resolveAuthenticProfile(profileSetInput, profileIdInput);
  if (profile.profile_id !== profileIdInput || profile.variant_id !== profile.profile_id ||
      profile.dispatch_allowed !== false || profile.backend_acceptance !== "unproven" ||
      profile.model_type !== profile.model_id || profile.operation_id !== "generate-image" || profile.modality !== "image" ||
      profile.catalog_version !== profileSet.catalog_version ||
      profile.server_contract.model_type !== profile.model_type || profile.server_contract.operation_id !== "generate-image" ||
      profile.server_contract.modality !== "image" || profile.server_contract.reference_input_field !== "reference_handles" ||
      profile.server_contract.reference_wire_field !== "file_urls" || !/^sha256:[a-f0-9]{64}$/u.test(profile.schema_hash)) {
    fail("PROFILE_INVALID");
  }
  return Object.freeze({
    schema_hash: profile.schema_hash,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    model_id: profile.model_id,
    model_type: profile.model_type,
    operation_id: "generate-image",
    modality: "image",
    variant_id: profile.variant_id
  });
}

/** Prepare a blocked, private candidate from owner-issued handles only. */
export async function prepareOwnerGrokImageReferenceRequest(
  input: PrepareOwnerGrokImageReferenceRequestInput | unknown
): Promise<OwnerGrokImageReferencePreparedCandidate> {
  const request = snapshotInput(input);
  const { profileSet, profile } = resolveAuthenticProfile(request.profileSet, request.profileId);
  const storeBinding = getOwnerGrokReferenceStoreBinding(profileSet, request.profileId);
  let normalized: OwnerGrokImageReferenceNormalizedRequest;
  try { normalized = validateOwnerGrokImageReferenceParameters(profile, request.parameters, request.referenceHandles.length); }
  catch { fail("PARAMETERS_INVALID"); }
  const principal = snapshotGenerationPrincipal({
    tenant_id: request.binding.tenant_id,
    subject_id: request.binding.subject,
    connection_id: request.attemptId
  });

  let resolved: Readonly<{ file_urls: readonly string[] }>;
  try {
    resolved = await request.store.resolveOrderedImageReferences({
      server_contract: profile.model_id,
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService,
      contract: storeBinding,
      reference_handles: request.referenceHandles
    });
  } catch {
    fail("REFERENCE_UNAVAILABLE");
  }
  const resolvedUrls = snapshotResolvedUrls(resolved, request.referenceHandles.length);
  let currentPrincipal: Readonly<GenerationPrincipalRef>;
  try {
    currentPrincipal = await resolveOwnerReferencePrincipal({
      binding: request.binding,
      attemptId: request.attemptId,
      linkService: request.linkService
    });
  } catch (error) {
    if (error instanceof OwnerReferencePrincipalError) fail("REFERENCE_UNAVAILABLE");
    fail("REFERENCE_UNAVAILABLE");
  }
  if (!sameGenerationPrincipal(principal, currentPrincipal)) fail("PRINCIPAL_MISMATCH");

  const referenceOrderSha256 = schemaHash({ profile_id: profile.profile_id, reference_handles: request.referenceHandles });
  const settings: Record<string, GenerationContractV2JsonValue> = {
    ...normalized.settings,
    file_urls: resolvedUrls.map((url) => Object.freeze({ type: "image", url }))
  };
  const frozenSettings = deepFreeze(settings);
  const requestBody = Object.freeze({ prompt: normalized.prompt, settings: frozenSettings });
  const requestFingerprint = fingerprintRequest(profileSet, profile, referenceOrderSha256, requestBody);
  const candidate = Object.freeze({
    [candidateBrand]: true as const,
    status: "blocked" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "unproven" as const,
    profile_set_sha256: profileSet.profile_set_sha256,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.schema_hash,
    profile_catalog_version: profile.catalog_version,
    catalog_version: storeBinding.catalog_version,
    model_id: profile.model_id,
    model_type: profile.model_type,
    operation_id: profile.operation_id,
    modality: profile.modality,
    variant_id: profile.variant_id,
    reference_count: request.referenceHandles.length,
    reference_order_sha256: referenceOrderSha256,
    request_fingerprint: requestFingerprint,
    request: requestBody
  });
  candidateStates.set(candidate, Object.freeze({
    profileSet,
    profile,
    principal,
    attemptId: request.attemptId,
    requestFingerprint,
    referenceOrderSha256,
    candidate
  }));
  return candidate;
}

/** Internal authenticity check used only by the Grok-specific one-shot policy. */
export function getOwnerGrokImageReferenceCandidateBinding(
  candidateInput: unknown,
  profileSetInput: unknown,
  profileIdInput: unknown,
  principalInput: unknown,
  attemptIdInput: unknown
): OwnerGrokImageReferenceCandidateBinding | null {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || types.isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof profileIdInput !== "string" || typeof attemptIdInput !== "string" ||
      !ATTEMPT_PATTERN.test(attemptIdInput)) return null;
  const state = candidateStates.get(candidateInput);
  if (!state || state.candidate !== candidateInput || state.profileSet !== profileSetInput || state.profile.profile_id !== profileIdInput ||
      state.attemptId !== attemptIdInput || !isCandidatePayloadIntact(candidateInput, state)) return null;
  try {
    const principal = snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef);
    if (!sameGenerationPrincipal(state.principal, principal)) return null;
  } catch { return null; }
  const candidate = candidateInput as OwnerGrokImageReferencePreparedCandidate;
  return Object.freeze({
    profile_set_sha256: candidate.profile_set_sha256,
    profile_id: candidate.profile_id,
    profile_schema_hash: candidate.profile_schema_hash,
    catalog_version: candidate.catalog_version,
    model_id: candidate.model_id,
    model_type: candidate.model_type,
    variant_id: candidate.variant_id,
    request_fingerprint: candidate.request_fingerprint,
    reference_order_sha256: candidate.reference_order_sha256,
    reference_count: candidate.reference_count,
    principal: state.principal,
    attemptId: state.attemptId
  });
}

export function isOwnerGrokImageReferencePreparedCandidateForPrincipal(
  candidate: unknown,
  profileSet: unknown,
  profileId: unknown,
  principal: unknown,
  attemptId: unknown
): candidate is OwnerGrokImageReferencePreparedCandidate {
  return getOwnerGrokImageReferenceCandidateBinding(candidate, profileSet, profileId, principal, attemptId) !== null;
}

interface CandidateState {
  readonly profileSet: OwnerGrokImageReferenceProfileSet;
  readonly profile: OwnerGrokImageReferenceProfile;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly requestFingerprint: string;
  readonly referenceOrderSha256: string;
  readonly candidate: OwnerGrokImageReferencePreparedCandidate;
}

function resolveAuthenticProfile(profileSetInput: unknown, profileIdInput: unknown): {
  readonly profileSet: OwnerGrokImageReferenceProfileSet;
  readonly profile: OwnerGrokImageReferenceProfile;
} {
  if (!profileSetInput || typeof profileSetInput !== "object" || types.isProxy(profileSetInput) || !Object.isFrozen(profileSetInput)) {
    fail("PROFILE_SET_INVALID");
  }
  if (typeof profileIdInput !== "string") fail("PROFILE_INVALID");
  let profile: OwnerGrokImageReferenceProfile;
  try { profile = getOwnerGrokImageReferenceProfile(profileSetInput, profileIdInput); }
  catch (error) {
    if (error instanceof OwnerGrokImageReferenceProfileError && error.code === "GROK_REFERENCE_PROFILE_SET_FORGED") fail("PROFILE_SET_INVALID");
    fail("PROFILE_INVALID");
  }
  const profileSet = profileSetInput as OwnerGrokImageReferenceProfileSet;
  if (profile.profile_id !== profileIdInput || profile.schema_hash.length !== 71 ||
      !/^sha256:[a-f0-9]{64}$/u.test(profile.schema_hash) || profileSet.profile_set_sha256.length !== 71 ||
      !/^sha256:[a-f0-9]{64}$/u.test(profileSet.profile_set_sha256)) fail("PROFILE_INVALID");
  return { profileSet, profile };
}

function snapshotInput(value: unknown) {
  const fields = readExactRecord(value, ["profile_set", "profile_id", "store", "binding", "attemptId", "linkService", "reference_handles", "parameters"]);
  const { profileSet, profile } = resolveAuthenticProfile(fields.profile_set, fields.profile_id);
  if (!(fields.store instanceof OwnerMediaReferenceStore) || types.isProxy(fields.store) ||
      typeof fields.attemptId !== "string" || !ATTEMPT_PATTERN.test(fields.attemptId)) fail("INVALID_REQUEST");
  const bindingFields = readExactRecord(fields.binding, ["tenant_id", "subject"]);
  if (typeof bindingFields.tenant_id !== "string" || typeof bindingFields.subject !== "string") fail("INVALID_REQUEST");
  const linkService = snapshotLinkService(fields.linkService);
  const handles = snapshotHandleArray(fields.reference_handles, profile.reference_bounds.maximum);
  if (handles.length < profile.reference_bounds.minimum || handles.length > profile.reference_bounds.maximum ||
      new Set(handles).size !== handles.length) fail("INVALID_REQUEST");
  return {
    profileSet,
    profile,
    profileId: profile.profile_id,
    store: fields.store,
    binding: Object.freeze({ tenant_id: bindingFields.tenant_id, subject: bindingFields.subject }),
    attemptId: fields.attemptId,
    linkService,
    referenceHandles: handles,
    parameters: fields.parameters
  };
}

function snapshotHandleArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("INVALID_REQUEST");
  const object: object = value;
  const keys = Reflect.ownKeys(object);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > maximum ||
      keys.length !== lengthDescriptor.value + 1) fail("INVALID_REQUEST");
  const handles: string[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !REFERENCE_HANDLE_PATTERN.test(descriptor.value)) {
      fail("INVALID_REQUEST");
    }
    handles.push(descriptor.value);
  }
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)) ||
      (key !== "length" && Number(key) >= lengthDescriptor.value))) fail("INVALID_REQUEST");
  return handles;
}

function snapshotResolvedUrls(value: unknown, expectedCount: number): string[] {
  const fields = readExactRecord(value, ["file_urls"]);
  const urls = fields.file_urls;
  if (!Array.isArray(urls) || types.isProxy(urls) || Object.getPrototypeOf(urls) !== Array.prototype) fail("REFERENCE_UNAVAILABLE");
  const object: object = urls;
  const keys = Reflect.ownKeys(object);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || lengthDescriptor.value !== expectedCount || keys.length !== expectedCount + 1) {
    fail("REFERENCE_UNAVAILABLE");
  }
  const result: string[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !isSafeUploadReferenceUrl(descriptor.value)) {
      fail("REFERENCE_UNAVAILABLE");
    }
    result.push(descriptor.value);
  }
  return result;
}

function snapshotLinkService(value: unknown): Pick<PerUserLinkService, "getStatus"> {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("INVALID_REQUEST");
  let current: object | null = value;
  let method: unknown;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "getStatus");
    if (descriptor) { method = "value" in descriptor ? descriptor.value : undefined; break; }
    current = Object.getPrototypeOf(current) as object | null;
  }
  if (typeof method !== "function") fail("INVALID_REQUEST");
  return Object.freeze({ getStatus: (binding: AuthBinding, attemptId: string) =>
    Reflect.apply(method as (...args: unknown[]) => unknown, value, [binding, attemptId]) as ReturnType<PerUserLinkService["getStatus"]> });
}

function fingerprintRequest(
  profileSet: OwnerGrokImageReferenceProfileSet,
  profile: OwnerGrokImageReferenceProfile,
  referenceOrderSha256: string,
  request: OwnerGrokImageReferencePreparedCandidate["request"]
): string {
  return schemaHash({ profile_set_sha256: profileSet.profile_set_sha256, profile_id: profile.profile_id,
    profile_schema_hash: profile.schema_hash, profile_catalog_version: profile.catalog_version,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, model_id: profile.model_id, model_type: profile.model_type,
    operation_id: profile.operation_id, variant_id: profile.variant_id, reference_order_sha256: referenceOrderSha256, request });
}

function isCandidatePayloadIntact(value: object, state: CandidateState): boolean {
  const candidate = value as OwnerGrokImageReferencePreparedCandidate;
  return candidate.status === "blocked" && candidate.dispatch_allowed === false && candidate.backend_acceptance === "unproven" &&
    candidate.profile_set_sha256 === state.profileSet.profile_set_sha256 && candidate.profile_id === state.profile.profile_id &&
    candidate.profile_schema_hash === state.profile.schema_hash && candidate.profile_catalog_version === state.profile.catalog_version &&
    candidate.catalog_version === DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION && candidate.model_id === state.profile.model_id &&
    candidate.model_type === state.profile.model_type && candidate.operation_id === "generate-image" && candidate.modality === "image" &&
    candidate.variant_id === state.profile.variant_id && candidate.reference_order_sha256 === state.referenceOrderSha256 &&
    candidate.reference_count >= state.profile.reference_bounds.minimum && candidate.reference_count <= state.profile.reference_bounds.maximum &&
    candidate.request_fingerprint === state.requestFingerprint &&
    candidate.request_fingerprint === fingerprintRequest(state.profileSet, state.profile, state.referenceOrderSha256, candidate.request);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}

function readExactRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_REQUEST");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== allowedKeys.length || keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key) ||
      !("value" in descriptors[key]!))) fail("INVALID_REQUEST");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function fail(code: OwnerGrokImageReferencePrepareErrorCode): never {
  throw new OwnerGrokImageReferencePrepareError(code);
}
