import { isProxy } from "node:util/types";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  getOwnerMagnificUpscaleSourceParameters,
  normalizeOwnerMagnificUpscaleParameters,
  OwnerMagnificUpscaleParametersError,
  type OwnerMagnificUpscaleVariant
} from "./owner-magnific-upscale-parameters.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const OPAQUE_HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_UTF8_BYTES = 5_000;
const MAX_LOCAL_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const PARAMETER_SOURCE = getOwnerMagnificUpscaleSourceParameters();
const SOURCE_BINDING = deepFreeze({
  ...PARAMETER_SOURCE.source_pins,
  file_uploader_sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786",
  file_upload_component_sha256: "sha256:2eddb5ee7f0b41cd31f56a2345542d9b5d70da419d1c2b1d003afc36519869d5"
});
const PROFILE_BASE = deepFreeze({
  profile_id: "magnific-upscale-source-reviewed-v1" as const,
  ai_name: "magnific" as const,
  scope: "tool_image_upscaler" as const,
  operation_id: "upscale-image" as const,
  modality: "image" as const,
  source_route: "design/generate" as const,
  public_catalog_version: PARAMETER_SOURCE.source_pins.public_catalog_version,
  source_binding: SOURCE_BINDING,
  variants: PARAMETER_SOURCE.variants,
  parameters_source: PARAMETER_SOURCE,
  mime: {
    source_values: IMAGE_MIME_TYPES,
    confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" as const
  },
  local_input_size: {
    maximum_bytes: MAX_LOCAL_IMAGE_BYTES,
    confidence: "SOURCE_UI_FALLBACK_NOT_PROVIDER_LIMIT" as const,
    public_zero_semantics: "ZERO_FALLS_BACK_TO_10MIB_FRONTEND_ONLY_NOT_PROVIDER_LIMIT" as const
  },
  prompt_policy: {
    required: false as const,
    local_maximum_utf8_bytes: MAX_PROMPT_UTF8_BYTES as 5_000,
    confidence: "CLIENT_LOCAL_LIMIT_NOT_PROVIDER_PROMISE" as const,
    ui_visibility: Object.freeze({ creative: true, precision_v1: false, precision_v2: false } as const)
  },
  dispatch_allowed: false as const,
  runtime_activation: false as const,
  backend_acceptance: "UNPROVEN" as const
});

const VARIANT_PROFILES = new Map<OwnerMagnificUpscaleVariant, Readonly<OwnerMagnificUpscaleSourceProfile>>(
  PARAMETER_SOURCE.variants.map((variant) => {
    const base = { ...PROFILE_BASE, variant, model_id: variant };
    const profileSchemaHash = schemaHash(base);
    return [variant, deepFreeze({ ...base, profile_schema_hash: profileSchemaHash })] as const;
  })
);

const ownedImageBrand: unique symbol = Symbol("OwnerMagnificUpscaleOwnedImageBinding");
const preparedBrand: unique symbol = Symbol("OwnerMagnificUpscalePreparedCandidate");
const issuedBindings = new WeakMap<object, Readonly<BoundOwnedImage>>();
const revokedBindings = new WeakSet<object>();
const candidateStates = new WeakMap<object, Readonly<PreparedCandidateState>>();

interface BoundOwnedImage {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly scope: "tool_image_upscaler";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly file_url: string;
  readonly mime_type: typeof IMAGE_MIME_TYPES[number];
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
  readonly opaque_image_handle: string;
}

interface PreparedCandidateState {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly binding: object;
}

export interface OwnerMagnificUpscaleSourceProfile {
  readonly profile_id: "magnific-upscale-source-reviewed-v1";
  readonly ai_name: "magnific";
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly scope: "tool_image_upscaler";
  readonly operation_id: "upscale-image";
  readonly modality: "image";
  readonly source_route: "design/generate";
  readonly public_catalog_version: string;
  readonly source_binding: Readonly<Record<string, unknown>>;
  readonly parameters_source: ReturnType<typeof getOwnerMagnificUpscaleSourceParameters>;
  readonly mime: Readonly<{ source_values: readonly string[]; confidence: "PUBLIC_CATALOG_DECLARATION_NOT_PROVIDER_ACCEPTANCE" }>;
  readonly local_input_size: Readonly<{
    maximum_bytes: number;
    confidence: "SOURCE_UI_FALLBACK_NOT_PROVIDER_LIMIT";
    public_zero_semantics: "ZERO_FALLS_BACK_TO_10MIB_FRONTEND_ONLY_NOT_PROVIDER_LIMIT";
  }>;
  readonly prompt_policy: Readonly<{
    required: false;
    local_maximum_utf8_bytes: 5_000;
    confidence: "CLIENT_LOCAL_LIMIT_NOT_PROVIDER_PROMISE";
    ui_visibility: Readonly<{ creative: true; precision_v1: false; precision_v2: false }>;
  }>;
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerMagnificUpscaleOwnedImageBinding {
  readonly [ownedImageBrand]: true;
}

export interface OwnerMagnificUpscaleOwnedImageResolution {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly scope: "tool_image_upscaler";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
  readonly file_url: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly sha256: string;
  readonly expires_at: number;
  readonly metadata_confidence: "CONTAINER_METADATA_ONLY";
}

export interface OwnerMagnificUpscaleOwnedImageResolveContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly opaque_image_handle: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly scope: "tool_image_upscaler";
  readonly catalog_version: string;
  readonly profile_schema_hash: string;
}

export interface OwnerMagnificUpscaleOwnedImageBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly opaque_image_handle: string;
}

export type ResolveOwnerMagnificUpscaleOwnedImage = (
  context: Readonly<OwnerMagnificUpscaleOwnedImageResolveContext>
) => Promise<unknown>;

export interface OwnerMagnificUpscaleOwnedImageBindingIssuer {
  issue(input: OwnerMagnificUpscaleOwnedImageBindingIssueInput | unknown): Promise<OwnerMagnificUpscaleOwnedImageBinding>;
  invalidateAttempt(attemptId: string): void;
  close(): void;
}

export interface OwnerMagnificUpscaleOwnedImageBindingIssuerOptions {
  readonly now?: () => number;
}

export interface PrepareOwnerMagnificUpscaleRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly parameters: unknown;
  readonly image_binding: OwnerMagnificUpscaleOwnedImageBinding;
  readonly prompt?: string | undefined;
}

export interface OwnerMagnificUpscalePreparedCandidate {
  readonly [preparedBrand]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_id: "magnific-upscale-source-reviewed-v1";
  readonly profile_schema_hash: string;
  readonly source_binding: OwnerMagnificUpscaleSourceProfile["source_binding"];
  readonly model_id: OwnerMagnificUpscaleVariant;
  readonly ai_name: "magnific";
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly model_type: OwnerMagnificUpscaleVariant;
  readonly operation_id: "upscale-image";
  readonly modality: "image";
  readonly scope: "tool_image_upscaler";
  readonly source_route: "design/generate";
  readonly image: Readonly<{
    mime_type: typeof IMAGE_MIME_TYPES[number];
    width: number;
    height: number;
    size: number;
    sha256: string;
    metadata_confidence: "CONTAINER_METADATA_ONLY";
  }>;
  readonly expires_at: number;
  readonly request_fingerprint: string;
  readonly query: Readonly<{ ai_name: "magnific" }>;
  readonly request: Readonly<{
    prompt?: string;
    settings: Readonly<{
      n: 1;
      model_type: OwnerMagnificUpscaleVariant;
      width: number;
      height: number;
      scale_factor: string;
      optimized_for: string;
      engine: string;
      creativity: number;
      hdr: number;
      resemblance: number;
      fractality: number;
      sharpen: number;
      smart_grain: number;
      ultra_detail: number;
      flavor: string;
      file_urls: readonly Readonly<{ type: "image"; url: string }> [];
    }>;
  }>;
}

export type OwnerMagnificUpscalePrepareErrorCode =
  | "INVALID_REQUEST"
  | "PRINCIPAL_MISMATCH"
  | "PROFILE_BINDING_MISMATCH"
  | "IMAGE_BINDING_INVALID"
  | "IMAGE_BINDING_EXPIRED"
  | "PARAMETERS_INVALID";

export class OwnerMagnificUpscalePrepareError extends Error {
  constructor(readonly code: OwnerMagnificUpscalePrepareErrorCode) {
    super("The owner Magnific upscaler candidate could not be prepared safely.");
    this.name = "OwnerMagnificUpscalePrepareError";
  }
}

/** Returns the frozen source profile for exactly the selected public model identity. */
export function getOwnerMagnificUpscaleSourceProfile(variantInput: unknown): Readonly<OwnerMagnificUpscaleSourceProfile> {
  if (!isVariant(variantInput)) fail("PROFILE_BINDING_MISMATCH");
  return VARIANT_PROFILES.get(variantInput)!;
}

/** Opaque upload-handle resolver; caller-supplied URLs and dimensions never enter this seam. */
export function createOwnerMagnificUpscaleOwnedImageBindingIssuer(
  resolveOwnedImage: ResolveOwnerMagnificUpscaleOwnedImage,
  options: OwnerMagnificUpscaleOwnedImageBindingIssuerOptions = {}
): OwnerMagnificUpscaleOwnedImageBindingIssuer {
  if (typeof resolveOwnedImage !== "function" || isProxy(resolveOwnedImage) || !options || typeof options !== "object" || isProxy(options)) {
    fail("INVALID_REQUEST");
  }
  const optionRecord = readExactRecord(options, ["now"], ["now"]);
  const now = optionRecord.now === undefined ? Date.now : readClock(optionRecord.now);
  let closed = false;
  const attemptEpoch = new Map<string, number>();
  const bindingsByAttempt = new Map<string, Set<object>>();
  const handleFingerprints = new Map<string, string>();

  return Object.freeze({
    async issue(input: OwnerMagnificUpscaleOwnedImageBindingIssueInput | unknown): Promise<OwnerMagnificUpscaleOwnedImageBinding> {
      if (closed) fail("IMAGE_BINDING_INVALID");
      const request = snapshotIssueInput(input);
      const principal = readPrincipal(request.principal, "INVALID_REQUEST");
      if (!ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id ||
          !OPAQUE_HANDLE_PATTERN.test(request.opaque_image_handle) || !isVariant(request.variant)) fail("INVALID_REQUEST");
      const profile = getOwnerMagnificUpscaleSourceProfile(request.variant);
      const epoch = attemptEpoch.get(request.attempt_id) ?? 0;
      const context = Object.freeze({
        principal,
        attempt_id: request.attempt_id,
        opaque_image_handle: request.opaque_image_handle,
        variant: request.variant,
        model_id: profile.model_id,
        scope: profile.scope,
        catalog_version: profile.public_catalog_version,
        profile_schema_hash: profile.profile_schema_hash
      });
      let raw: unknown;
      try { raw = await resolveOwnedImage(context); }
      catch { fail("IMAGE_BINDING_INVALID"); }
      if (closed || epoch !== (attemptEpoch.get(request.attempt_id) ?? 0)) fail("IMAGE_BINDING_INVALID");
      const resolved = snapshotResolvedOwnedImage(raw);
      const resolvedPrincipal = readPrincipal(resolved.principal, "IMAGE_BINDING_INVALID");
      if (resolved.attempt_id !== request.attempt_id || !sameGenerationPrincipal(principal, resolvedPrincipal)) {
        fail("PRINCIPAL_MISMATCH");
      }
      if (resolved.variant !== request.variant || resolved.model_id !== profile.model_id || resolved.scope !== profile.scope ||
          resolved.catalog_version !== profile.public_catalog_version || resolved.profile_schema_hash !== profile.profile_schema_hash) {
        fail("PROFILE_BINDING_MISMATCH");
      }
      const resolvedNow = readNow(now);
      validateResolvedImage(resolved, resolvedNow);
      const fingerprint = schemaHash({ ...resolved, principal: resolvedPrincipal, opaque_image_handle: request.opaque_image_handle });
      const handleKey = JSON.stringify([request.attempt_id, request.opaque_image_handle]);
      const previousFingerprint = handleFingerprints.get(handleKey);
      if (previousFingerprint !== undefined && previousFingerprint !== fingerprint) fail("IMAGE_BINDING_INVALID");
      handleFingerprints.set(handleKey, fingerprint);

      const binding = Object.freeze({ [ownedImageBrand]: true as const });
      issuedBindings.set(binding, Object.freeze({
        principal: resolvedPrincipal,
        attempt_id: resolved.attempt_id,
        variant: resolved.variant,
        model_id: resolved.model_id,
        scope: resolved.scope,
        catalog_version: resolved.catalog_version,
        profile_schema_hash: resolved.profile_schema_hash,
        file_url: resolved.file_url,
        mime_type: resolved.mime_type as typeof IMAGE_MIME_TYPES[number],
        width: resolved.width,
        height: resolved.height,
        size: resolved.size,
        sha256: resolved.sha256,
        expires_at: resolved.expires_at,
        metadata_confidence: resolved.metadata_confidence,
        opaque_image_handle: request.opaque_image_handle
      }));
      const bindings = bindingsByAttempt.get(request.attempt_id) ?? new Set<object>();
      bindings.add(binding);
      bindingsByAttempt.set(request.attempt_id, bindings);
      return binding;
    },
    invalidateAttempt(attemptId: string): void {
      if (!ATTEMPT_PATTERN.test(attemptId)) return;
      attemptEpoch.set(attemptId, (attemptEpoch.get(attemptId) ?? 0) + 1);
      for (const binding of bindingsByAttempt.get(attemptId) ?? []) revokedBindings.add(binding);
      bindingsByAttempt.delete(attemptId);
      for (const key of handleFingerprints.keys()) {
        if (JSON.parse(key)[0] === attemptId) handleFingerprints.delete(key);
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      for (const bindings of bindingsByAttempt.values()) for (const binding of bindings) revokedBindings.add(binding);
      bindingsByAttempt.clear();
      handleFingerprints.clear();
    }
  });
}

/** Creates a frozen candidate only from an opaque issued binding and complete normalized source state. */
export function prepareOwnerMagnificUpscaleRequest(
  input: PrepareOwnerMagnificUpscaleRequestInput | unknown,
  options: OwnerMagnificUpscaleOwnedImageBindingIssuerOptions = {}
): OwnerMagnificUpscalePreparedCandidate {
  const request = snapshotPrepareInput(input);
  const principal = readPrincipal(request.principal, "INVALID_REQUEST");
  if (!ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id || !isVariant(request.variant)) {
    fail("INVALID_REQUEST");
  }
  const binding = snapshotIssuedBinding(request.image_binding);
  const resolvedPrincipal = readPrincipal(binding.principal, "IMAGE_BINDING_INVALID");
  if (binding.attempt_id !== request.attempt_id || !sameGenerationPrincipal(principal, resolvedPrincipal)) fail("PRINCIPAL_MISMATCH");
  if (binding.variant !== request.variant || binding.model_id !== request.variant || binding.scope !== "tool_image_upscaler" ||
      binding.catalog_version !== getOwnerMagnificUpscaleSourceProfile(request.variant).public_catalog_version ||
      binding.profile_schema_hash !== getOwnerMagnificUpscaleSourceProfile(request.variant).profile_schema_hash) {
    fail("PROFILE_BINDING_MISMATCH");
  }
  const optionFields = readExactRecord(options, [], ["now"]);
  const now = readNow(optionFields.now === undefined ? Date.now : readClock(optionFields.now));
  if (revokedBindings.has(request.image_binding as object)) fail("IMAGE_BINDING_INVALID");
  if (binding.expires_at <= now) fail("IMAGE_BINDING_EXPIRED");

  const profile = getOwnerMagnificUpscaleSourceProfile(request.variant);
  const prompt = snapshotPrompt(request.prompt);
  let normalized: ReturnType<typeof normalizeOwnerMagnificUpscaleParameters>;
  try {
    normalized = normalizeOwnerMagnificUpscaleParameters({
      variant: request.variant,
      parameters: request.parameters,
      dimensions: { width: binding.width, height: binding.height }
    });
  } catch (error) {
    if (error instanceof OwnerMagnificUpscaleParametersError) fail("PARAMETERS_INVALID");
    throw error;
  }
  const fileUrls = Object.freeze([Object.freeze({ type: "image" as const, url: binding.file_url })]);
  const settings = deepFreeze({
    n: 1 as const,
    model_type: normalized.model_type,
    width: normalized.dimensions.width,
    height: normalized.dimensions.height,
    ...normalized.parameters,
    file_urls: fileUrls
  });
  const query = Object.freeze({ ai_name: profile.ai_name as "magnific" });
  const requestBody = deepFreeze({
    ...(prompt === undefined ? {} : { prompt }),
    settings
  });
  const requestFingerprint = schemaHash({
    profile_schema_hash: profile.profile_schema_hash,
    principal,
    attempt_id: request.attempt_id,
    variant: request.variant,
    prompt: prompt ?? null,
    query,
    settings,
    image: {
      mime_type: binding.mime_type,
      width: binding.width,
      height: binding.height,
      size: binding.size,
      sha256: binding.sha256,
      metadata_confidence: binding.metadata_confidence,
      expires_at: binding.expires_at
    }
  });
  const candidate = Object.freeze({
    [preparedBrand]: true as const,
    status: "blocked" as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const,
    profile_id: profile.profile_id,
    profile_schema_hash: profile.profile_schema_hash,
    source_binding: profile.source_binding,
    model_id: profile.model_id,
    ai_name: profile.ai_name,
    variant: profile.variant,
    model_type: normalized.model_type,
    operation_id: profile.operation_id,
    modality: profile.modality,
    scope: profile.scope,
    source_route: profile.source_route,
    image: Object.freeze({
      mime_type: binding.mime_type,
      width: binding.width,
      height: binding.height,
      size: binding.size,
      sha256: binding.sha256,
      metadata_confidence: binding.metadata_confidence
    }),
    expires_at: binding.expires_at,
    request_fingerprint: requestFingerprint,
    query,
    request: requestBody
  });
  candidateStates.set(candidate, Object.freeze({
    principal,
    attempt_id: request.attempt_id,
    variant: request.variant,
    expires_at: binding.expires_at,
    request_fingerprint: requestFingerprint,
    binding: request.image_binding as object
  }));
  return candidate;
}

/** Checks authenticity/context/expiry only; it never grants dispatch authority. */
export function isOwnerMagnificUpscalePreparedCandidateForPrincipal(
  candidateInput: unknown,
  principalInput: unknown,
  attemptIdInput: unknown,
  nowInput: unknown = Date.now()
): candidateInput is OwnerMagnificUpscalePreparedCandidate {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof attemptIdInput !== "string") return false;
  const state = candidateStates.get(candidateInput);
  if (!state || state.attempt_id !== attemptIdInput || state.expires_at <= safeReadNow(nowInput) || revokedBindings.has(state.binding)) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); }
  catch { return false; }
}

function snapshotPrepareInput(value: unknown): PrepareOwnerMagnificUpscaleRequestInput {
  const fields = readExactRecord(value, ["principal", "attempt_id", "variant", "parameters", "image_binding"], ["prompt"]);
  if (typeof fields.attempt_id !== "string" || (fields.prompt !== undefined && typeof fields.prompt !== "string")) fail("INVALID_REQUEST");
  return Object.freeze({
    principal: fields.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: fields.attempt_id,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    parameters: fields.parameters,
    image_binding: fields.image_binding as OwnerMagnificUpscaleOwnedImageBinding,
    ...(fields.prompt === undefined ? {} : { prompt: fields.prompt })
  });
}

function snapshotIssueInput(value: unknown): OwnerMagnificUpscaleOwnedImageBindingIssueInput {
  const fields = readExactRecord(value, ["principal", "attempt_id", "variant", "opaque_image_handle"]);
  if (typeof fields.attempt_id !== "string" || typeof fields.opaque_image_handle !== "string") fail("INVALID_REQUEST");
  return Object.freeze({
    principal: fields.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: fields.attempt_id,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    opaque_image_handle: fields.opaque_image_handle
  });
}

function snapshotResolvedOwnedImage(value: unknown): OwnerMagnificUpscaleOwnedImageResolution {
  const keys = ["principal", "attempt_id", "variant", "model_id", "scope", "catalog_version", "profile_schema_hash",
    "file_url", "mime_type", "width", "height", "size", "sha256", "expires_at", "metadata_confidence"];
  let fields: Record<string, unknown>;
  try { fields = readExactRecord(value, keys); }
  catch { fail("IMAGE_BINDING_INVALID"); }
  if (typeof fields.attempt_id !== "string" || typeof fields.variant !== "string" || typeof fields.model_id !== "string" ||
      typeof fields.scope !== "string" || typeof fields.catalog_version !== "string" || typeof fields.profile_schema_hash !== "string" ||
      typeof fields.file_url !== "string" || typeof fields.mime_type !== "string" || typeof fields.width !== "number" ||
      typeof fields.height !== "number" || typeof fields.size !== "number" || typeof fields.sha256 !== "string" ||
      typeof fields.expires_at !== "number" || typeof fields.metadata_confidence !== "string") fail("IMAGE_BINDING_INVALID");
  return {
    principal: fields.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: fields.attempt_id,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    model_id: fields.model_id as OwnerMagnificUpscaleVariant,
    scope: fields.scope as "tool_image_upscaler",
    catalog_version: fields.catalog_version,
    profile_schema_hash: fields.profile_schema_hash,
    file_url: fields.file_url,
    mime_type: fields.mime_type,
    width: fields.width,
    height: fields.height,
    size: fields.size,
    sha256: fields.sha256,
    expires_at: fields.expires_at,
    metadata_confidence: fields.metadata_confidence as "CONTAINER_METADATA_ONLY"
  };
}

function snapshotIssuedBinding(value: unknown): Readonly<BoundOwnedImage> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) || revokedBindings.has(value)) fail("IMAGE_BINDING_INVALID");
  const binding = issuedBindings.get(value);
  if (!binding) fail("IMAGE_BINDING_INVALID");
  return binding;
}

function validateResolvedImage(image: OwnerMagnificUpscaleOwnedImageResolution, now: number): void {
  if (!isSafeUploadReferenceUrl(image.file_url) || !IMAGE_MIME_TYPES.includes(image.mime_type as typeof IMAGE_MIME_TYPES[number]) ||
      !Number.isSafeInteger(image.width) || image.width <= 0 || !Number.isSafeInteger(image.height) || image.height <= 0 ||
      !Number.isSafeInteger(image.width * image.height) || !Number.isSafeInteger(image.size) || image.size <= 0 ||
      image.size > MAX_LOCAL_IMAGE_BYTES || !/^sha256:[a-f0-9]{64}$/u.test(image.sha256) ||
      !Number.isSafeInteger(image.expires_at) || image.expires_at <= now || image.metadata_confidence !== "CONTAINER_METADATA_ONLY") {
    fail(image.expires_at <= now ? "IMAGE_BINDING_EXPIRED" : "IMAGE_BINDING_INVALID");
  }
}

function snapshotPrompt(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (Buffer.byteLength(value, "utf8") > MAX_PROMPT_UTF8_BYTES || PROMPT_CONTROLS.test(value)) fail("PARAMETERS_INVALID");
  return value;
}

function readPrincipal(value: unknown, code: OwnerMagnificUpscalePrepareErrorCode): Readonly<GenerationPrincipalRef> {
  try { return snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { fail(code); }
}

function readClock(value: unknown): () => number {
  if (typeof value !== "function" || isProxy(value)) fail("INVALID_REQUEST");
  return value as () => number;
}

function readNow(clock: () => number): number {
  let value: unknown;
  try { value = clock(); } catch { fail("INVALID_REQUEST"); }
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("INVALID_REQUEST");
  return value as number;
}

function safeReadNow(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : Number.MAX_SAFE_INTEGER;
}

function readExactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) fail("INVALID_REQUEST");
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_REQUEST");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) fail("INVALID_REQUEST");
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("INVALID_REQUEST");
      output[key] = descriptor.value;
    }
    if (required.some((key) => !Object.hasOwn(output, key))) fail("INVALID_REQUEST");
    return output;
  } catch (error) {
    if (error instanceof OwnerMagnificUpscalePrepareError) throw error;
    fail("INVALID_REQUEST");
  }
}

function isVariant(value: unknown): value is OwnerMagnificUpscaleVariant {
  return typeof value === "string" && (PARAMETER_SOURCE.variants as readonly string[]).includes(value);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) for (const item of value) deepFreeze(item);
  else for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

function fail(code: OwnerMagnificUpscalePrepareErrorCode): never {
  throw new OwnerMagnificUpscalePrepareError(code);
}
