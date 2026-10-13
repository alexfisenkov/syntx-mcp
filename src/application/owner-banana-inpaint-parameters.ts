import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  type OwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadVariant
} from "./owner-banana-inpaint-original-upload-source-profile.js";

const VARIANTS = OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS;
const CATALOG_DEFAULTS = Object.freeze({ banana: false, banana2: false, banana3: true, banana3_light: true } as const);
const IMAGE_SIZE_CONTROLS = Object.freeze({
  banana: Object.freeze({ visible: false, options: Object.freeze([] as string[]), initial_source_value: null,
    initial_value_semantics: "SOURCE_NULL_NO_VISIBLE_SIZE_CONTROL" as const }),
  banana2: Object.freeze({ visible: true, options: Object.freeze(["1K", "2K", "4K"] as const), initial_source_value: "2K",
    initial_value_semantics: "SOURCE_INITIALIZER_VALUE_NOT_RUNTIME_DEFAULT" as const }),
  banana3: Object.freeze({ visible: true, options: Object.freeze(["0.5K", "1K", "2K", "4K"] as const), initial_source_value: null,
    initial_value_semantics: "SOURCE_NULL_BRANCH_EFFECTIVE_DEFAULT_UNPROVEN" as const }),
  banana3_light: Object.freeze({ visible: false, options: Object.freeze(["1K"] as const), initial_source_value: "1K",
    initial_value_semantics: "SOURCE_INITIALIZER_VALUE_NOT_RUNTIME_DEFAULT" as const })
} as const);
const SOURCE_ARTIFACTS = Object.freeze({
  inpaint_form: Object.freeze({ module: "banana-inpaint.js", bytes: 8_715,
    sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172" }),
  settings_helper: Object.freeze({ module: "settings3.js", bytes: 4_123,
    sha256: "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe" }),
  app_store: Object.freeze({ module: "app.js", bytes: 2_445_534,
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf" }),
  caller: Object.freeze({ module: "useImageEditorTool.js", bytes: 12_652,
    sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe" }),
  cost2: Object.freeze({ module: "cost2.js", bytes: 1_660,
    sha256: "sha256:c343afcc3f7a63dcfe479d4407a75dea0791309d0414d1f82e5aca1abdc4cfb9" }),
  cost_service: Object.freeze({ module: "cost.js", bytes: 2_745,
    sha256: "sha256:12db4cc4e9cce28d915b6a7179f26be03967122edc791a393bfbc485b201c223" })
} as const);
const SOURCE_PASS = Object.freeze({
  root: 897,
  started_at: "2026-10-11T16:18:09.096Z",
  ended_at: "2026-10-11T16:24:31.095Z",
  requests: 5,
  bytes: 135_762,
  start_homepage_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
  end_homepage_sha256: null,
  source_pass_freshness: "UNVERIFIED_END_FINGERPRINT_MISSING" as const,
  vendor_executed: false,
  raw_body_saved: false
});

export interface OwnerBananaInpaintSourceParameters {
  readonly profile_id: "banana-inpaint-controls-source-v1";
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly image_size: Readonly<{
    visible: boolean;
    options: readonly string[];
    initial_source_value: string | null;
    initial_value_semantics: string;
  }>;
  readonly source_binding: Readonly<{
    original_upload_profile_schema_hash: string;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_pass: typeof SOURCE_PASS;
    control_source_call: "settings3.u(tool_image_inpaint,banana,{model_type,image_size})";
  }>;
  readonly effective_defaults: "UNKNOWN";
  readonly runtime_activation: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export interface OwnerBananaInpaintNormalizedParameters {
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly image_size: string | null;
  readonly effective_default_applied: false;
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerBananaInpaintCostParameters {
  readonly variant: OwnerBananaInpaintOriginalUploadVariant;
  readonly routing: Readonly<{ ai_name: "banana"; model_type: OwnerBananaInpaintOriginalUploadVariant }>;
  readonly cost_inputs: Readonly<{ image_size?: string }>;
  readonly source_binding: Readonly<{
    public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
    settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
    source_artifacts: typeof SOURCE_ARTIFACTS;
    source_pass: typeof SOURCE_PASS;
    caller_cost_call: "banana-inpaint.js Ae(k)@4621 with k=banana";
    cost2_forwarding: "getCost(ai_name,model_type,projected_cost_keys)";
    caller_ai_name: "banana";
    cost_keys_by_variant: Readonly<{ banana: readonly []; banana2: readonly ["image_size"]; banana3: readonly ["image_size"]; banana3_light: readonly ["image_size"] }>;
  }>;
  readonly confidence: "SOURCE_JOINED_COST2_QUERY_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP";
  readonly quote_or_amount: "UNPROVEN";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaInpaintSourceParametersError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The Banana Inpaint parameter source profile could not be verified.");
    this.name = "OwnerBananaInpaintSourceParametersError";
  }
}

export class OwnerBananaInpaintParametersError extends Error {
  constructor(readonly code: "INVALID_PARAMETERS") {
    super("The Banana Inpaint image-size selection is invalid.");
    this.name = "OwnerBananaInpaintParametersError";
  }
}

export function getOwnerBananaInpaintSourceParameters(
  variantInput: unknown,
  originalProfileInput: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>
): Readonly<OwnerBananaInpaintSourceParameters> {
  if (!isVariant(variantInput)) failSource("INVALID_REQUEST");
  const original = snapshotOriginalProfile(originalProfileInput, variantInput);
  const base = deepFreeze({
    profile_id: "banana-inpaint-controls-source-v1" as const,
    variant: variantInput,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    image_size: IMAGE_SIZE_CONTROLS[variantInput],
    source_binding: {
      original_upload_profile_schema_hash: original.profile_schema_hash,
      source_artifacts: SOURCE_ARTIFACTS,
      source_pass: SOURCE_PASS,
      control_source_call: "settings3.u(tool_image_inpaint,banana,{model_type,image_size})" as const
    },
    effective_defaults: "UNKNOWN" as const,
    runtime_activation: false as const,
    dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaInpaintSourceParameters>;
}

export function normalizeOwnerBananaInpaintParameters(_input: unknown): OwnerBananaInpaintNormalizedParameters {
  const request = readExactRecord(_input, ["variant", "image_size"]);
  if (!isVariant(request.variant)) failParameters();
  const variant = request.variant;
  const options = IMAGE_SIZE_CONTROLS[variant].options;
  if (variant === "banana" ? request.image_size !== null : !options.includes(request.image_size as never)) failParameters();
  return deepFreeze({
    variant,
    image_size: request.image_size as string | null,
    effective_default_applied: false as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerBananaInpaintNormalizedParameters;
}

export function projectOwnerBananaInpaintCostParameters(_input: unknown): OwnerBananaInpaintCostParameters {
  const normalized = normalizeOwnerBananaInpaintParameters(_input);
  const model = normalized.variant;
  const costInputs = model === "banana" ? {} : { image_size: normalized.image_size as string };
  return deepFreeze({
    variant: model,
    routing: { ai_name: "banana" as const, model_type: model },
    cost_inputs: costInputs,
    source_binding: {
      public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
      settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
      source_artifacts: SOURCE_ARTIFACTS,
      source_pass: SOURCE_PASS,
      caller_cost_call: "banana-inpaint.js Ae(k)@4621 with k=banana" as const,
      cost2_forwarding: "getCost(ai_name,model_type,projected_cost_keys)" as const,
      caller_ai_name: "banana" as const,
      cost_keys_by_variant: {
        banana: [] as const,
        banana2: ["image_size"] as const,
        banana3: ["image_size"] as const,
        banana3_light: ["image_size"] as const
      }
    },
    confidence: "SOURCE_JOINED_COST2_QUERY_KEYS_NOT_QUOTE_BILLING_OR_HARDCAP" as const,
    quote_or_amount: "UNPROVEN" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as OwnerBananaInpaintCostParameters;
}

interface OriginalProfileSnapshot {
  readonly profile_schema_hash: string;
}

function snapshotOriginalProfile(input: unknown, variant: OwnerBananaInpaintOriginalUploadVariant): OriginalProfileSnapshot {
  if (!input || typeof input !== "object" || isProxy(input) || !Object.isFrozen(input)) failSource("PROFILE_BINDING_MISMATCH");
  const fields = snapshotTree(input);
  if (!isRecord(fields)) failSource("PROFILE_BINDING_MISMATCH");
  const sourceBinding = record(fields.source_binding);
  const settingsInventory = record(sourceBinding.settings_inventory);
  const familyForm = record(settingsInventory.family_model_form);
  const modelIdentity = record(sourceBinding.model_identity);
  const hashes = record(sourceBinding.selected_public_source_hashes);
  const artifacts = record(sourceBinding.source_artifacts);
  const inpaintForm = record(settingsInventory.inpaint_form);
  const inputPolicy = record(fields.input_policy);
  const defaults = CATALOG_DEFAULTS[variant];
  const base = { ...fields };
  delete base.profile_schema_hash;
  const expectedHashes = {
    ai: "sha256:b99bb90d170acb5a3a06c5be0cbc51d2ab0d17902bee21303a44b32c5fcaef39",
    llm_models: "sha256:8f991c198f3fa4ae8f296259cbf42d53cfef1a3af22cb46b49775278ba7cf4fa",
    models: "sha256:16735c498e3743b67fb384ccee44de34ffd3ac8debaeb46033a5723938191a58"
  };
  const expectedInpaintForm = {
    form_id: "banana-inpaint", module_name: "banana-inpaint.js", bytes: 8_715,
    sha256: SOURCE_ARTIFACTS.inpaint_form.sha256, parse_diagnostics: 0,
    model_value_settings_keys: ["image_size", "model_type"], static_setting_defaults: {}
  };
  if (fields.profile_id !== "banana-inpaint-original-upload-source-profile-v1" || fields.variant !== variant ||
      fields.model_id !== variant || fields.model_type !== variant || fields.family_ai_name !== "banana" ||
      fields.form_ai_name !== "banana_inpaint" || fields.form_id !== "banana-inpaint" ||
      fields.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      fields.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      fields.catalog_default_flag !== defaults ||
      fields.catalog_default_confidence !== "PUBLIC_CATALOG_METADATA_ONLY_NOT_RUNTIME_SELECTION" ||
      fields.runtime_usable !== false || fields.runtime_activation !== false || fields.dispatch_allowed !== false ||
      fields.backend_acceptance !== "UNPROVEN" ||
      sourceBinding.source_confidence !== "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" ||
      sourceBinding.selected_public_catalog_fetched_at !== "2026-10-11T12:04:10.638Z" || !sameJson(hashes, expectedHashes) ||
      !sameJson(modelIdentity, { id: variant, upstream_id: variant, ai_name: "banana", active: true, default: defaults }) ||
      settingsInventory.schema_version !== "2.1.0" || settingsInventory.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      settingsInventory.build_id !== "1791467421" || settingsInventory.runtime_usable !== false ||
      !sameJson(familyForm, { form_id: "banana", form_binding_status: "STRUCTURAL_MATCH", settings_status: "PUBLIC_SETTINGS_KNOWN" }) ||
      !sameJson(inpaintForm, expectedInpaintForm) || !sameOriginalArtifacts(artifacts) ||
      !sameJson(inputPolicy, {
        accepted_file_types: ["image/jpeg", "image/png"], max_file_bytes: 52_428_800, max_file_count: 1,
        size_scope: "SOURCE_UI_FILE_INPUT_LIMIT_NOT_PROVIDER_LIMIT", destination: "hidden", check_duplicates: true,
        model_type_source: "EXPLICIT_UNDERLYING_BANANA_VARIANT"
      }) ||
      typeof fields.profile_schema_hash !== "string" || fields.profile_schema_hash !== schemaHash(base)) {
    failSource("PROFILE_BINDING_MISMATCH");
  }
  return Object.freeze({ profile_schema_hash: fields.profile_schema_hash });
}

function sameOriginalArtifacts(artifacts: Record<string, unknown>): boolean {
  const expected = {
    inpaint_form: SOURCE_ARTIFACTS.inpaint_form,
    original_upload_caller: SOURCE_ARTIFACTS.caller,
    settings_helper: SOURCE_ARTIFACTS.settings_helper,
    app_upload_store: SOURCE_ARTIFACTS.app_store
  };
  return sameJson(artifacts, expected);
}

function snapshotTree(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === undefined || typeof value === "function" || typeof value === "symbol") failSource("PROFILE_BINDING_MISMATCH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) failSource("PROFILE_BINDING_MISMATCH");
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) failSource("PROFILE_BINDING_MISMATCH");
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || key !== "length" && !/^(0|[1-9]\d*)$/u.test(key))) failSource("PROFILE_BINDING_MISMATCH");
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) failSource("PROFILE_BINDING_MISMATCH");
      out.push(snapshotTree(descriptor.value, depth + 1));
    }
    if (keys.length !== value.length + 1) failSource("PROFILE_BINDING_MISMATCH");
    return out;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) failSource("PROFILE_BINDING_MISMATCH");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") failSource("PROFILE_BINDING_MISMATCH");
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || descriptor.enumerable !== true) failSource("PROFILE_BINDING_MISMATCH");
    out[key] = snapshotTree(descriptor.value, depth + 1);
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) failSource("PROFILE_BINDING_MISMATCH");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

function isVariant(value: unknown): value is OwnerBananaInpaintOriginalUploadVariant {
  return typeof value === "string" && (VARIANTS as readonly string[]).includes(value);
}

function readExactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) failParameters();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) failParameters();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) failParameters();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function failParameters(): never {
  throw new OwnerBananaInpaintParametersError("INVALID_PARAMETERS");
}

function failSource(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never {
  throw new OwnerBananaInpaintSourceParametersError(code);
}
