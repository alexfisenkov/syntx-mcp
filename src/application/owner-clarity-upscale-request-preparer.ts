import { types } from "node:util";
import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import type { GenerationContractV2JsonValue } from "../domain/generation-contract-v2.js";

const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const PROMPT_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const MAX_PROMPT_UTF8_BYTES = 5_000;
const IMAGE_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/avif", "image/webp"] as const);
const PROFILE_ID = "clarity-upscale-source-reviewed-v1" as const;
const PROFILE = Object.freeze({
  profile_id: PROFILE_ID,
  status: "blocked" as const,
  dispatch_allowed: false as const,
  backend_acceptance: "unproven" as const,
  model_id: "clarity" as const,
  ai_name: "clarity" as const,
  model_type: "clarity" as const,
  operation_id: "upscale-image" as const,
  modality: "image" as const,
  source_route: "design/generate" as const,
  input_mime_types: IMAGE_MIME_TYPES,
  settings: Object.freeze({
    n: 1 as const,
    scale_base_coefficient: 4 as const,
    ordinary_scale_factors: Object.freeze([1.5, 2] as const),
    professional_scale_factor: Object.freeze({ minimum: 1, maximum: 6, step: 0.01 }),
    strength: Object.freeze({ minimum: 0.1, maximum: 1, step: 0.01 }),
    cfg: Object.freeze({ minimum: 2, maximum: 9 }),
    denoise: Object.freeze({ minimum: 0.1, maximum: 0.7, step: 0.01 }),
    dimension_ceiling: 8_000
  }),
  prompt_policy: Object.freeze({ maximum_utf8_bytes: MAX_PROMPT_UTF8_BYTES, confidence: "CLIENT_LOCAL_LIMIT_NOT_PROVIDER_PROMISE" as const }),
  mime_confidence: "UPLOAD_DECLARED_NOT_SNIFFED" as const,
  source_binding: Object.freeze({
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_models_sha256: "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444",
    settings_inventory_sha256: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61",
    app_sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf",
    parent_url: "https://syntx.ai/assets/1791467421/Upscaler.js",
    parent_sha256: "sha256:8b00e34ae7e8d848c3967255648ce8839853690643a68726cf3faee26b913587",
    submit_helper_url: "https://syntx.ai/assets/1791467421/useUpscalerTool.js",
    submit_helper_sha256: "sha256:83fdb2ef6086fc92c8497abd6fbfb4cb4f673a8cc44b695e3d865fd6dc021aad",
    form_url: "https://syntx.ai/assets/1791467421/clarity.js",
    form_sha256: "sha256:8d88f9a843c4c297ea734c1d2b5a9fda112ee813f4cf8cc99b6bb440dd6a9d54",
    helper_url: "https://syntx.ai/assets/1791467421/upscaler3.js",
    helper_sha256: "sha256:91f684d0675d788483698f2fa5c974be8d55ba925915a84449871e67b600487b",
    file_mapper_url: "https://syntx.ai/assets/1791467421/NewSessionButton.js",
    file_mapper_sha256: "sha256:8a1c0d06d68b82d97ac6a58ed7caf8d2e759d31cc10f0b1ceb26d676fa664706"
  })
});
const PROFILE_SCHEMA_HASH = schemaHash(PROFILE);
const preparedBrand: unique symbol = Symbol("OwnerClarityUpscalePreparedCandidate");
const ownedImageBrand: unique symbol = Symbol("OwnerClarityUpscaleOwnedImageBinding");
const issuedImageBindings = new WeakMap<object, Readonly<{
  principal: Readonly<GenerationPrincipalRef>; attempt_id: string; model_id: string; file_url: string;
  mime_type: string; width: number; height: number;
}>>();
const candidateState = new WeakMap<object, Readonly<{ principal: Readonly<GenerationPrincipalRef>; attempt_id: string; request_fingerprint: string }>>();

/** Opaque input available only to an internal owner-upload integration; not an MCP/tool DTO. */
export interface OwnerClarityUpscaleOwnedImageBinding {
  readonly [ownedImageBrand]: true;
}

export interface PrepareOwnerClarityUpscaleRequestInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly prompt?: string | undefined;
  readonly parameters: unknown;
  readonly image_binding: OwnerClarityUpscaleOwnedImageBinding;
}

export interface OwnerClarityUpscaleOwnedImageBindingIssueInput {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attempt_id: string;
  readonly opaque_image_handle: string;
}

export type ResolveOwnerClarityOwnedImage = (
  attemptId: string,
  principal: Readonly<GenerationPrincipalRef>,
  opaqueImageHandle: string
) => Promise<unknown>;

export interface OwnerClarityUpscaleOwnedImageBindingIssuer {
  issue(input: OwnerClarityUpscaleOwnedImageBindingIssueInput): Promise<OwnerClarityUpscaleOwnedImageBinding>;
}

export interface OwnerClarityUpscalePreparedCandidate {
  readonly [preparedBrand]: true;
  readonly status: "blocked";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "unproven";
  readonly profile_id: typeof PROFILE_ID;
  readonly profile_schema_hash: string;
  readonly source_binding: typeof PROFILE.source_binding;
  readonly model_id: "clarity";
  readonly ai_name: "clarity";
  readonly model_type: "clarity";
  readonly operation_id: "upscale-image";
  readonly modality: "image";
  readonly source_route: "design/generate";
  readonly mime_confidence: typeof PROFILE.mime_confidence;
  readonly image: Readonly<{ mime_type: (typeof IMAGE_MIME_TYPES)[number]; width: number; height: number }>;
  readonly request_fingerprint: string;
  readonly query: Readonly<{ ai_name: "clarity" }>;
  readonly request: Readonly<{
    prompt?: string;
    settings: Readonly<Record<string, GenerationContractV2JsonValue>>;
  }>;
}

export type OwnerClarityUpscalePrepareErrorCode =
  | "INVALID_REQUEST"
  | "PRINCIPAL_MISMATCH"
  | "IMAGE_BINDING_INVALID"
  | "PARAMETERS_INVALID";

export class OwnerClarityUpscalePrepareError extends Error {
  constructor(readonly code: OwnerClarityUpscalePrepareErrorCode) {
    super("The owner Clarity upscaler candidate could not be prepared safely.");
    this.name = "OwnerClarityUpscalePrepareError";
  }
}

/** Returns the closed, source-bound candidate policy; it grants no dispatch permission. */
export function getOwnerClarityUpscaleSourceProfile(): Readonly<typeof PROFILE> {
  return PROFILE;
}

/**
 * Internal application-port boundary: callers supply an opaque upload handle,
 * never a URL or dimensions. Only this resolver may turn a bound upload receipt
 * into a private preparer input; no MCP/tool factory is exposed.
 */
export function createOwnerClarityUpscaleOwnedImageBindingIssuer(
  resolveOwnedImage: ResolveOwnerClarityOwnedImage
): OwnerClarityUpscaleOwnedImageBindingIssuer {
  if (typeof resolveOwnedImage !== "function" || types.isProxy(resolveOwnedImage)) fail("INVALID_REQUEST");
  return Object.freeze({
    async issue(input: OwnerClarityUpscaleOwnedImageBindingIssueInput): Promise<OwnerClarityUpscaleOwnedImageBinding> {
      const request = snapshotIssueInput(input);
      const principal = snapshotGenerationPrincipal(request.principal);
      if (!ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(request.opaque_image_handle)) fail("INVALID_REQUEST");
      let raw: unknown;
      try { raw = await resolveOwnedImage(request.attempt_id, principal, request.opaque_image_handle); }
      catch { fail("IMAGE_BINDING_INVALID"); }
      const resolved = snapshotResolvedOwnedImage(raw);
      const resolvedPrincipal = snapshotGenerationPrincipal(resolved.principal);
      if (resolved.attempt_id !== request.attempt_id || !sameGenerationPrincipal(principal, resolvedPrincipal)) {
        fail("PRINCIPAL_MISMATCH");
      }
      if (resolved.scope !== "tool_image_upscaler" || resolved.model_id !== PROFILE.model_id ||
          !isSafeUploadReferenceUrl(resolved.file_url) || !IMAGE_MIME_TYPES.includes(resolved.mime_type as (typeof IMAGE_MIME_TYPES)[number]) ||
          !Number.isSafeInteger(resolved.width) || resolved.width <= 0 ||
          !Number.isSafeInteger(resolved.height) || resolved.height <= 0) fail("IMAGE_BINDING_INVALID");
      const binding = Object.freeze({ [ownedImageBrand]: true as const });
      issuedImageBindings.set(binding, Object.freeze({
        principal: resolvedPrincipal,
        attempt_id: resolved.attempt_id,
        model_id: resolved.model_id,
        file_url: resolved.file_url,
        mime_type: resolved.mime_type,
        width: resolved.width,
        height: resolved.height
      }));
      return binding;
    }
  });
}

/** Purely prepares a blocked request candidate from a nominal internal upload binding. */
export function prepareOwnerClarityUpscaleRequest(input: PrepareOwnerClarityUpscaleRequestInput): OwnerClarityUpscalePreparedCandidate {
  const request = snapshotInput(input);
  const principal = snapshotGenerationPrincipal(request.principal);
  if (!ATTEMPT_PATTERN.test(request.attempt_id) || principal.connection_id !== request.attempt_id) fail("INVALID_REQUEST");
  const image = snapshotImageBinding(request.image_binding);
  const imagePrincipal = snapshotGenerationPrincipal(image.principal);
  if (image.model_id !== PROFILE.model_id) fail("IMAGE_BINDING_INVALID");
  if (image.attempt_id !== request.attempt_id || !sameGenerationPrincipal(principal, imagePrincipal)) fail("PRINCIPAL_MISMATCH");
  if (!isSafeUploadReferenceUrl(image.file_url) || !IMAGE_MIME_TYPES.includes(image.mime_type as (typeof IMAGE_MIME_TYPES)[number]) ||
      !Number.isSafeInteger(image.width) || image.width <= 0 || !Number.isSafeInteger(image.height) || image.height <= 0) {
    fail("IMAGE_BINDING_INVALID");
  }
  const prompt = snapshotPrompt(request.prompt);
  const parameters = normalizeParameters(request.parameters, image.width, image.height);
  const settings: Record<string, GenerationContractV2JsonValue> = {
    n: 1,
    model_type: PROFILE.model_type,
    scale: parameters.scale_factor / PROFILE.settings.scale_base_coefficient,
    is_professional_mode: parameters.professional_mode,
    strength: parameters.strength,
    cfg: parameters.cfg,
    denoise: parameters.denoise,
    file_urls: [Object.freeze({ type: "image", url: image.file_url })]
  };
  const requestBody = Object.freeze({
    ...(prompt === undefined ? {} : { prompt }),
    settings: deepFreeze(settings)
  });
  const requestQuery = Object.freeze({ ai_name: PROFILE.ai_name });
  const requestFingerprint = schemaHash({
    profile_schema_hash: PROFILE_SCHEMA_HASH,
    principal,
    attempt_id: request.attempt_id,
    prompt: prompt ?? null,
    query: requestQuery,
    settings: settings
  });
  const candidate = Object.freeze({
    [preparedBrand]: true as const,
    status: PROFILE.status,
    dispatch_allowed: false as const,
    backend_acceptance: PROFILE.backend_acceptance,
    profile_id: PROFILE.profile_id,
    profile_schema_hash: PROFILE_SCHEMA_HASH,
    source_binding: PROFILE.source_binding,
    model_id: PROFILE.model_id,
    ai_name: PROFILE.ai_name,
    model_type: PROFILE.model_type,
    operation_id: PROFILE.operation_id,
    modality: PROFILE.modality,
    source_route: PROFILE.source_route,
    mime_confidence: PROFILE.mime_confidence,
    image: Object.freeze({ mime_type: image.mime_type as (typeof IMAGE_MIME_TYPES)[number], width: image.width, height: image.height }),
    request_fingerprint: requestFingerprint,
    query: requestQuery,
    request: requestBody
  });
  candidateState.set(candidate, Object.freeze({ principal, attempt_id: request.attempt_id, request_fingerprint: requestFingerprint }));
  return candidate;
}

/** Candidate identity check for future internal integration; never authorizes dispatch. */
export function isOwnerClarityUpscalePreparedCandidateForPrincipal(
  candidateInput: unknown, principalInput: unknown, attemptIdInput: unknown
): candidateInput is OwnerClarityUpscalePreparedCandidate {
  if (!candidateInput || typeof candidateInput !== "object" || Array.isArray(candidateInput) || types.isProxy(candidateInput) ||
      !Object.isFrozen(candidateInput) || typeof attemptIdInput !== "string") return false;
  const state = candidateState.get(candidateInput);
  if (!state || state.attempt_id !== attemptIdInput) return false;
  try { return sameGenerationPrincipal(state.principal, snapshotGenerationPrincipal(principalInput as GenerationPrincipalRef)); }
  catch { return false; }
}

function snapshotInput(value: unknown): PrepareOwnerClarityUpscaleRequestInput {
  const record = exactRecord(value, ["principal", "attempt_id", "parameters", "image_binding"], ["prompt"]);
  if (!record || typeof record.attempt_id !== "string") fail("INVALID_REQUEST");
  if (record.prompt !== undefined && typeof record.prompt !== "string") fail("INVALID_REQUEST");
  return Object.freeze({
    principal: record.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: record.attempt_id,
    ...(record.prompt === undefined ? {} : { prompt: record.prompt }),
    parameters: record.parameters,
    image_binding: record.image_binding as OwnerClarityUpscaleOwnedImageBinding
  });
}

function snapshotImageBinding(value: unknown): Readonly<{
  principal: Readonly<GenerationPrincipalRef>; attempt_id: string; model_id: string; file_url: string;
  mime_type: string; width: number; height: number;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("IMAGE_BINDING_INVALID");
  const issued = issuedImageBindings.get(value);
  if (!issued) fail("IMAGE_BINDING_INVALID");
  return issued;
}

function snapshotIssueInput(value: unknown): OwnerClarityUpscaleOwnedImageBindingIssueInput {
  const record = exactRecord(value, ["principal", "attempt_id", "opaque_image_handle"]);
  if (!record || typeof record.attempt_id !== "string" || typeof record.opaque_image_handle !== "string") fail("INVALID_REQUEST");
  return Object.freeze({
    principal: record.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: record.attempt_id,
    opaque_image_handle: record.opaque_image_handle
  });
}

function snapshotResolvedOwnedImage(value: unknown): Readonly<{
  principal: Readonly<GenerationPrincipalRef>; attempt_id: string; scope: string; model_id: string;
  file_url: string; mime_type: string; width: number; height: number;
}> {
  const record = exactRecord(value, ["principal", "attempt_id", "scope", "model_id", "file_url", "mime_type", "width", "height"]);
  if (!record || typeof record.attempt_id !== "string" || typeof record.scope !== "string" ||
      typeof record.model_id !== "string" || typeof record.file_url !== "string" ||
      typeof record.mime_type !== "string" || typeof record.width !== "number" || typeof record.height !== "number") {
    fail("IMAGE_BINDING_INVALID");
  }
  return Object.freeze({
    principal: record.principal as Readonly<GenerationPrincipalRef>,
    attempt_id: record.attempt_id,
    scope: record.scope,
    model_id: record.model_id,
    file_url: record.file_url,
    mime_type: record.mime_type,
    width: record.width,
    height: record.height
  });
}

function snapshotPrompt(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  if (Buffer.byteLength(value, "utf8") > MAX_PROMPT_UTF8_BYTES || PROMPT_CONTROLS.test(value)) fail("PARAMETERS_INVALID");
  return value;
}

function normalizeParameters(value: unknown, width: number, height: number): Readonly<{
  professional_mode: boolean; scale_factor: number; strength: number; cfg: number; denoise: number;
}> {
  const record = exactRecord(value, ["professional_mode", "scale_factor", "strength", "cfg", "denoise"]);
  if (!record || typeof record.professional_mode !== "boolean" ||
      typeof record.scale_factor !== "number" || !Number.isFinite(record.scale_factor) ||
      typeof record.strength !== "number" || typeof record.cfg !== "number" || typeof record.denoise !== "number") fail("PARAMETERS_INVALID");
  const maximumFactor = maximumProfessionalScaleFactor(width, height);
  const validScale = record.professional_mode
    ? isStepValue(record.scale_factor, PROFILE.settings.professional_scale_factor.minimum, maximumFactor,
      PROFILE.settings.professional_scale_factor.step)
    : (PROFILE.settings.ordinary_scale_factors as readonly number[]).includes(record.scale_factor) && record.scale_factor <= maximumFactor;
  if (!validScale || !isStepValue(record.strength, PROFILE.settings.strength.minimum,
    PROFILE.settings.strength.maximum, PROFILE.settings.strength.step) ||
      !Number.isInteger(record.cfg) || record.cfg < PROFILE.settings.cfg.minimum || record.cfg > PROFILE.settings.cfg.maximum ||
      !isStepValue(record.denoise, PROFILE.settings.denoise.minimum,
        PROFILE.settings.denoise.maximum, PROFILE.settings.denoise.step)) fail("PARAMETERS_INVALID");
  return Object.freeze({
    professional_mode: record.professional_mode,
    scale_factor: record.scale_factor,
    strength: record.strength,
    cfg: record.cfg,
    denoise: record.denoise
  });
}

function maximumProfessionalScaleFactor(width: number, height: number): number {
  const imageMaximum = Math.max(width, height);
  const dimensionBound = Math.floor(PROFILE.settings.dimension_ceiling / imageMaximum * 100) / 100;
  return Math.max(PROFILE.settings.professional_scale_factor.minimum,
    Math.min(PROFILE.settings.professional_scale_factor.maximum, dimensionBound));
}

function isStepValue(value: number, minimum: number, maximum: number, step: number): boolean {
  if (value < minimum || value > maximum) return false;
  const steps = (value - minimum) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
}

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const stringKeys: string[] = [];
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      stringKeys.push(key);
      output[key] = descriptor.value;
    }
    if (required.some((key) => !stringKeys.includes(key)) || stringKeys.some((key) => !required.includes(key) && !optional.includes(key))) return null;
    return output;
  } catch { return null; }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) for (const item of value) deepFreeze(item);
  else for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
  return Object.freeze(value);
}

function fail(code: OwnerClarityUpscalePrepareErrorCode): never { throw new OwnerClarityUpscalePrepareError(code); }
