import { isProxy } from "node:util/types";
import { schemaHash } from "../domain/generation-contract.js";
import {
  getOwnerBananaInpaintPaintedCompositeSourceProfile,
  type OwnerBananaInpaintPaintedCompositeSourceProfile
} from "./owner-banana-inpaint-painted-composite-source-profile.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  type OwnerBananaInpaintOriginalUploadSourceProfile,
  type OwnerBananaInpaintOriginalUploadVariant
} from "./owner-banana-inpaint-original-upload-source-profile.js";
import {
  getOwnerBananaInpaintSourceParameters,
  type OwnerBananaInpaintSourceParameters
} from "./owner-banana-inpaint-parameters.js";

export const OWNER_BANANA_INPAINT_IMAGE_VARIANTS = OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS;
export type OwnerBananaInpaintImageVariant = OwnerBananaInpaintOriginalUploadVariant;

const SOURCE_ARTIFACTS = Object.freeze({
  form: Object.freeze({
    module: "banana-inpaint.js", bytes: 8_715,
    sha256: "sha256:4a22ce6da71d2b39c97614cdfcde3d38f201dad3015f2a59f018d8b7c8146172"
  }),
  parent_editor: Object.freeze({
    module: "InpaintEditor.js", bytes: 24_250,
    sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14"
  }),
  sender_helper: Object.freeze({
    module: "useImageEditorTool.js", bytes: 12_652,
    sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe"
  }),
  wire_sender: Object.freeze({
    module: "video.js", bytes: 8_689,
    sha256: "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae"
  })
} as const);

const SOURCE_PASS = Object.freeze({
  root: 904,
  starting_head: "5cc87d3",
  build_id: "1791467421",
  requests: 5,
  bytes: 282_629,
  homepage_start_end_same: true,
  homepage_sha256: "a7a68e6ae96547333037962ab9bb3a40ddf7aeb912223d65a9962ab5ce6982da",
  raw_source_saved: false,
  vendor_executed: false
} as const);

const MODEL_IMAGE_SIZE_VALUES = Object.freeze({
  banana: Object.freeze([null] as const),
  banana2: Object.freeze(["1K", "2K", "4K"] as const),
  banana3: Object.freeze(["0.5K", "1K", "2K", "4K"] as const),
  banana3_light: Object.freeze(["1K"] as const)
} as const);

const AUXILIARY_SOURCE_PROFILE_ID = "banana-inpaint-auxiliary-image-source-profile-v1" as const;
const AUXILIARY_SOURCE_ARTIFACTS = Object.freeze({
  reference: Object.freeze({
    module: "Reference.js", bytes: 5_956,
    sha256: "sha256:99979b585bb47bb5547e28ca927f9a4b5cbe12af56b9a0bfd481e07f91fcea4a"
  }),
  upload_dropdown: Object.freeze({
    module: "UploadDropdown.js", bytes: 42_832,
    sha256: "sha256:b399a8a1d5fede3a16dd444abcfb4b8ddc89cd89e03ab493c5f9b5eff0f9d783"
  }),
  file_uploader: Object.freeze({
    module: "fileUploader.js", bytes: 362_328,
    sha256: "sha256:b1e9af34daa830845c9712121ebb25c92801d22bbcec4f49d8b1748ecbc47786"
  }),
  inpaint_caller: Object.freeze({
    module: "useImageEditorTool.js", bytes: 12_652,
    sha256: "sha256:6ede93da546e372b8a550a00d370a79a65b0e6841942c74317ad7814097ceebe"
  }),
  app_uploader: Object.freeze({
    module: "app.js", bytes: 2_445_534,
    sha256: "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"
  })
} as const);
const AUXILIARY_SOURCE_EVIDENCE = Object.freeze({
  source_profile_id: AUXILIARY_SOURCE_PROFILE_ID,
  direct_source_artifacts: AUXILIARY_SOURCE_ARTIFACTS,
  root_facts: Object.freeze({
    root909: "image_wildcard_max1_weight_inactive",
    root912: "app_upload_uploaded_default_duplicate_check_true_current_model_type_uri_to_image",
    root914: "file_uploader_bridge_passes_files_only_and_maps_uploaded_uri_to_image"
  })
} as const);
const AUXILIARY_SOURCE_EVIDENCE_HASH = schemaHash(AUXILIARY_SOURCE_EVIDENCE);

const OPERATION = Object.freeze({
  method: "POST",
  route: "design/generate",
  ai_name: "banana",
  scope: "tool_image_inpaint"
} as const);

const WIRE_CONTRACT = Object.freeze({
  body_fields: Object.freeze(["chat_uuid", "prompt", "settings"] as const),
  settings_fields: Object.freeze(["editor", "model_type", "image_size", "file_urls"] as const),
  editor_value: true,
  model_type_binding: "EXPLICIT_UNDERLYING_VARIANT" as const,
  image_size_binding: "EXPLICIT_898_NORMALIZED_VALUE_NO_DEFAULT" as const,
  file_urls_order: Object.freeze(["original_image", "painted_composite_mask", "optional_auxiliary_image"] as const),
  ordinary_n1_included: false,
  cost_keys_included: false,
  caller_urls_allowed: false,
  arbitrary_context_allowed: false
} as const);

const AUXILIARY_REFERENCE = Object.freeze({
  minimum_count: 0,
  maximum_count: 1,
  media_types: Object.freeze(["images"] as const),
  weight_active: false,
  source_role: "image" as const,
  position: "AFTER_ORIGINAL_AND_PAINTED_COMPOSITE" as const,
  upload_authority: "SOURCE_JOINED_UPLOAD_PATH_ONLY_NOT_GENERATION_PERMISSION" as const,
  destination: "uploaded" as const,
  hidden_default: false,
  check_duplicates: true,
  model_type_binding: "EXPLICIT_UNDERLYING_VARIANT_FROM_CURRENT_SETTINGS" as const,
  input_mapper: "UPLOADED_URI_STRING_TO_IMAGE_REFERENCE" as const,
  picker_accept_hint: "image/*" as const,
  source_byte_cap: "UNKNOWN" as const,
  source_mime_acceptance: "UNPROVEN" as const,
  provider_acceptance: "UNPROVEN" as const,
  mime_and_size_policy: "SOURCE_MIME_AND_BYTE_CAP_UNPROVEN" as const
} as const);

const ACKNOWLEDGEMENT = Object.freeze({
  http_response: "JSON_DATA_WITH_MESSAGE_ID" as const,
  message_id_field: "id" as const,
  placeholder_replaced: true,
  truthy_ack_starts_chat_uuid_polling_and_returns_ack: true,
  absent_ack: "ERROR_AND_RESET" as const,
  poller_module: "text.js" as const,
  poller_alias: "a as rt" as const,
  poller_call: "g.pullingMessagesInProgress(chat_uuid)@8084" as const,
  poller_internals: "NOT_JOINED" as const,
  retry_or_billing_semantics: "UNPROVEN" as const
} as const);

const RESULT_CONTRACT = Object.freeze({
  image_object_predicate: "(object_type=image OR object_type=image_url) AND truthy object_url" as const,
  latest_bot_selector: "AUTHOR_ID_MINUS_ONE_REVERSE_MESSAGE_SCAN" as const,
  message_object_selection: "PREFER_OBJECT_MATCHING_IMAGE_PREDICATE_ELSE_LAST_OBJECT" as const,
  ready_predicate: "completed===true AND truthy object_url" as const,
  known_object_fields: Object.freeze(["id", "author_id", "message_object", "object_type", "object_url", "completed"] as const),
  history_endpoint_statuses_model_binding: "NOT_JOINED" as const,
  output_cardinality_mime_dimensions: "UNPROVEN" as const,
  provider_acceptance: "UNPROVEN" as const
} as const);

export interface OwnerBananaInpaintImageSourceProfile {
  readonly profile_id: "banana-inpaint-image-source-profile-v1";
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly model_identity: Readonly<{
    model_id: OwnerBananaInpaintImageVariant;
    model_type: OwnerBananaInpaintImageVariant;
    ai_name: "banana";
    form_ai_name: "banana_inpaint";
    form_id: "banana-inpaint";
    scope: "tool_image_inpaint";
  }>;
  readonly public_catalog_version: typeof OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION;
  readonly source_binding: Readonly<{
    original_upload_profile_id: OwnerBananaInpaintOriginalUploadSourceProfile["profile_id"];
    original_upload_profile_schema_hash: string;
    painted_composite_profile_id: OwnerBananaInpaintPaintedCompositeSourceProfile["profile_id"];
    painted_composite_profile_schema_hash: string;
    controls_profile_id: OwnerBananaInpaintSourceParameters["profile_id"];
    controls_profile_schema_hash: string;
    controls_source_freshness: OwnerBananaInpaintSourceParameters["source_binding"]["source_pass"]["source_pass_freshness"];
    auxiliary_upload_source_profile_id: typeof AUXILIARY_SOURCE_PROFILE_ID;
    auxiliary_upload_source_artifacts: typeof AUXILIARY_SOURCE_ARTIFACTS;
    auxiliary_upload_source_evidence_hash: string;
    direct_source_artifacts: typeof SOURCE_ARTIFACTS;
    source_pass: typeof SOURCE_PASS;
    confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly operation: typeof OPERATION;
  readonly wire_contract: typeof WIRE_CONTRACT;
  readonly image_size_values: typeof MODEL_IMAGE_SIZE_VALUES;
  readonly auxiliary_reference: typeof AUXILIARY_REFERENCE;
  readonly prompt_policy: Readonly<{
    button_disabled_predicate: "!prompt?.trim() || isGenerating";
    wire_transformation: "UNCHANGED";
    source_maximum: "UNKNOWN";
    local_max_utf16_code_units: 65_536;
    local_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER";
  }>;
  readonly acknowledgement: typeof ACKNOWLEDGEMENT;
  readonly result_contract: typeof RESULT_CONTRACT;
  readonly runtime_usable: false;
  readonly runtime_activation: false;
  readonly dispatch_allowed: false;
  readonly generation_permission: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export type OwnerBananaInpaintImageSourceProfileErrorCode = "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH";

export class OwnerBananaInpaintImageSourceProfileError extends Error {
  constructor(readonly code: OwnerBananaInpaintImageSourceProfileErrorCode) {
    super("The Banana Inpaint generation source profile could not be verified.");
    this.name = "OwnerBananaInpaintImageSourceProfileError";
  }
}

export interface OwnerBananaInpaintNormalizedPrompt {
  readonly variant: OwnerBananaInpaintImageVariant;
  readonly prompt: string;
  readonly length_utf16_code_units: number;
  readonly maximum_utf16_code_units: 65_536;
  readonly admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL";
  readonly source_maximum: "UNKNOWN";
  readonly local_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER";
  readonly wire_transformation: "UNCHANGED";
  readonly dispatch_allowed: false;
  readonly runtime_activation: false;
  readonly backend_acceptance: "UNPROVEN";
}

export class OwnerBananaInpaintPromptError extends Error {
  constructor(readonly code: "INVALID_PROMPT" | "PROMPT_TOO_LONG") {
    super("The Banana Inpaint prompt is invalid or exceeds the local resource bound.");
    this.name = "OwnerBananaInpaintPromptError";
  }
}

/** Preserves explicit prompt text; its UTF-16 cap is local resource policy, not source/provider evidence. */
export function normalizeOwnerBananaInpaintPrompt(input: unknown): Readonly<OwnerBananaInpaintNormalizedPrompt> {
  const fields = readExactPromptInput(input);
  if (!isVariant(fields.variant) || typeof fields.prompt !== "string" || fields.prompt.trim().length === 0) invalidPrompt();
  const prompt = fields.prompt;
  if (prompt.length > 65_536) throw new OwnerBananaInpaintPromptError("PROMPT_TOO_LONG");
  return deepFreeze({
    variant: fields.variant,
    prompt,
    length_utf16_code_units: prompt.length,
    maximum_utf16_code_units: 65_536 as const,
    admission: "TRIMMED_NONEMPTY_PRESERVE_ORIGINAL" as const,
    source_maximum: "UNKNOWN" as const,
    local_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER" as const,
    wire_transformation: "UNCHANGED" as const,
    dispatch_allowed: false as const,
    runtime_activation: false as const,
    backend_acceptance: "UNPROVEN" as const
  }) as Readonly<OwnerBananaInpaintNormalizedPrompt>;
}

/** Binds the actual original, painted-composite, and control profiles to source-only generation facts. */
export function getOwnerBananaInpaintImageSourceProfile(
  variantInput: unknown,
  originalProfileInput: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>,
  paintedProfileInput: Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>,
  controlsProfileInput: Readonly<OwnerBananaInpaintSourceParameters>
): Readonly<OwnerBananaInpaintImageSourceProfile> {
  if (!isVariant(variantInput)) failProfile("INVALID_REQUEST");
  let original: Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;
  let painted: Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>;
  let controls: Readonly<OwnerBananaInpaintSourceParameters>;
  try {
    original = snapshotFrozenData(originalProfileInput) as Readonly<OwnerBananaInpaintOriginalUploadSourceProfile>;
    painted = snapshotFrozenData(paintedProfileInput) as Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>;
    controls = snapshotFrozenData(controlsProfileInput) as Readonly<OwnerBananaInpaintSourceParameters>;
  } catch { failProfile("PROFILE_BINDING_MISMATCH"); }
  if (original.variant !== variantInput || painted.variant !== variantInput || controls.variant !== variantInput ||
      original.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      painted.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      controls.public_catalog_version !== OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION ||
      original.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      painted.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION ||
      controls.settings_inventory_version !== OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION) failProfile("PROFILE_BINDING_MISMATCH");

  let expectedPainted: Readonly<OwnerBananaInpaintPaintedCompositeSourceProfile>;
  let expectedControls: Readonly<OwnerBananaInpaintSourceParameters>;
  try {
    expectedPainted = getOwnerBananaInpaintPaintedCompositeSourceProfile(variantInput, originalProfileInput);
    expectedControls = getOwnerBananaInpaintSourceParameters(variantInput, originalProfileInput);
  } catch { failProfile("PROFILE_BINDING_MISMATCH"); }
  if (!sameProfile(painted, expectedPainted) || !sameProfile(controls, expectedControls)) failProfile("PROFILE_BINDING_MISMATCH");

  const base = deepFreeze({
    profile_id: "banana-inpaint-image-source-profile-v1" as const,
    variant: variantInput,
    model_identity: {
      model_id: variantInput,
      model_type: variantInput,
      ai_name: "banana" as const,
      form_ai_name: "banana_inpaint" as const,
      form_id: "banana-inpaint" as const,
      scope: "tool_image_inpaint" as const
    },
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    source_binding: {
      original_upload_profile_id: original.profile_id,
      original_upload_profile_schema_hash: original.profile_schema_hash,
      painted_composite_profile_id: painted.profile_id,
      painted_composite_profile_schema_hash: painted.profile_schema_hash,
      controls_profile_id: controls.profile_id,
      controls_profile_schema_hash: controls.profile_schema_hash,
      controls_source_freshness: controls.source_binding.source_pass.source_pass_freshness,
      auxiliary_upload_source_profile_id: AUXILIARY_SOURCE_PROFILE_ID,
      auxiliary_upload_source_artifacts: AUXILIARY_SOURCE_ARTIFACTS,
      auxiliary_upload_source_evidence_hash: AUXILIARY_SOURCE_EVIDENCE_HASH,
      direct_source_artifacts: SOURCE_ARTIFACTS,
      source_pass: SOURCE_PASS,
      confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
    },
    operation: OPERATION,
    wire_contract: WIRE_CONTRACT,
    image_size_values: MODEL_IMAGE_SIZE_VALUES,
    auxiliary_reference: AUXILIARY_REFERENCE,
    prompt_policy: {
      button_disabled_predicate: "!prompt?.trim() || isGenerating" as const,
      wire_transformation: "UNCHANGED" as const,
      source_maximum: "UNKNOWN" as const,
      local_max_utf16_code_units: 65_536 as const,
      local_limit_scope: "LOCAL_RESOURCE_BOUND_ONLY_NOT_SOURCE_UI_OR_PROVIDER" as const
    },
    acknowledgement: ACKNOWLEDGEMENT,
    result_contract: RESULT_CONTRACT,
    runtime_usable: false as const,
    runtime_activation: false as const,
    dispatch_allowed: false as const,
    generation_permission: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerBananaInpaintImageSourceProfile>;
}

function isVariant(value: unknown): value is OwnerBananaInpaintImageVariant {
  return typeof value === "string" && (OWNER_BANANA_INPAINT_IMAGE_VARIANTS as readonly string[]).includes(value);
}

function snapshotFrozenData(input: unknown): unknown {
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (!value || typeof value !== "object" || depth > 32 || isProxy(value) || !Object.isFrozen(value) || active.has(value)) {
      failProfile("PROFILE_BINDING_MISMATCH");
    }
    active.add(value);
    try {
      if (Array.isArray(value)) {
        const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<string, PropertyDescriptor>;
        const ownKeys = Reflect.ownKeys(descriptors);
        const length = descriptors["length"]?.value;
        if (!Number.isSafeInteger(length) || ownKeys.length !== length + 1 || ownKeys.some((key) =>
          key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) ||
            !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) failProfile("PROFILE_BINDING_MISMATCH");
        return Array.from({ length }, (_, index) => {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor)) failProfile("PROFILE_BINDING_MISMATCH");
          return copy(descriptor.value, depth + 1);
        });
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) failProfile("PROFILE_BINDING_MISMATCH");
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownKeys = Reflect.ownKeys(descriptors);
      if (ownKeys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) {
        failProfile("PROFILE_BINDING_MISMATCH");
      }
      const result: Record<string, unknown> = {};
      for (const key of ownKeys as string[]) result[key] = copy(descriptors[key]!.value, depth + 1);
      return result;
    } finally { active.delete(value); }
  };
  return copy(input, 0);
}

function sameProfile(actual: unknown, expected: unknown): boolean {
  try { return schemaHash(actual) === schemaHash(expected); }
  catch { return false; }
}

function readExactPromptInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) invalidPrompt();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidPrompt();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || keys.some((key) => typeof key !== "string" || !["variant", "prompt"].includes(key) ||
      !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalidPrompt();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function invalidPrompt(): never {
  throw new OwnerBananaInpaintPromptError("INVALID_PROMPT");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

function failProfile(code: OwnerBananaInpaintImageSourceProfileErrorCode): never {
  throw new OwnerBananaInpaintImageSourceProfileError(code);
}
