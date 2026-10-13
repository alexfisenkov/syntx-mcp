import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerSeedreamImageVariant } from "./owner-seedream-image-parameters.js";
import {
  getOwnerSeedreamEditorGenerationSourceProfile,
  OwnerSeedreamEditorGenerationSourceProfileError
} from "./owner-seedream-editor-generation-source-profile.js";
import {
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
  type OwnerSeedreamEditorOriginalUploadSourceProfile
} from "./owner-seedream-editor-original-upload-source-profile.js";

const DRAWING_SOURCE_ARTIFACTS = Object.freeze({
  editor_parent: Object.freeze({ module: "InpaintEditor.js", bytes: 24_250, sha256: "sha256:87509acda1040d79927edc30d8ddd18d503a6e7ce9387d5d0a059b1eb5028e14" }),
  canvas_editor: Object.freeze({ module: "useCanvasEditor.js", bytes: 2_586, sha256: "sha256:859a2906da81c354e9e7838d0d0e12fd8aa81de48246ba9fe30510f8aefde592" }),
  drawing_exporter: Object.freeze({ module: "useInpaintTool.js", bytes: 218_328, sha256: "sha256:de8396adca45a5ba79c9c52cdfa91b23f45285645bed5df120c0f337a192deb2" }),
  data_url_to_file: Object.freeze({ module: "convertBase64ToFile.js", bytes: 201, sha256: "sha256:3afd76ce0ccbede98246fc62a7617d0f17c71827e1ce3f017a0591a980b16437" })
});

export interface OwnerSeedreamEditorDrawingSourceProfile {
  readonly profile_id: "seedream-editor-drawing-source-profile-v1";
  readonly variant: OwnerSeedreamImageVariant;
  readonly model_id: OwnerSeedreamImageVariant;
  readonly model_type: OwnerSeedreamImageVariant;
  readonly navigation_id: "seedream-editor";
  readonly source_role: "editor_drawing";
  readonly wire_role: "image";
  readonly source_binding: Readonly<{
    public_catalog_version: typeof OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION;
    settings_inventory_version: typeof OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION;
    original_profile_schema_hash: string;
    source_artifacts: typeof DRAWING_SOURCE_ARTIFACTS;
    export: Readonly<{ with_image: false; default_mime_type: "image/png"; hidden_upload: true; extra_role: "image" }>;
    source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI";
  }>;
  readonly input_policy: Readonly<{
    mime_type: "image/png";
    local_resource_bound_bytes: 33_554_432;
    local_resource_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT";
    source_bytes_limit: "UNPROVEN";
    png_transparency: "NOT_CHECKED";
    geometry: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS";
  }>;
  readonly runtime_usable: false;
  readonly generation_allowed: false;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
  readonly profile_schema_hash: string;
}

export class OwnerSeedreamEditorDrawingSourceProfileError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH") {
    super("The Seedream Editor drawing source profile could not be verified.");
    this.name = "OwnerSeedreamEditorDrawingSourceProfileError";
  }
}

export function getOwnerSeedreamEditorDrawingSourceProfile(
  variantInput: unknown,
  originalProfileInput: OwnerSeedreamEditorOriginalUploadSourceProfile
): Readonly<OwnerSeedreamEditorDrawingSourceProfile> {
  let validatedOriginal: Readonly<OwnerSeedreamEditorOriginalUploadSourceProfile>;
  try { getOwnerSeedreamEditorGenerationSourceProfile(variantInput, originalProfileInput); validatedOriginal = originalProfileInput; }
  catch (error) {
    if (error instanceof OwnerSeedreamEditorGenerationSourceProfileError) fail(error.code);
    fail("PROFILE_BINDING_MISMATCH");
  }
  const variant = variantInput as OwnerSeedreamImageVariant;
  const hash = validatedOriginal.profile_schema_hash;

  const base = deepFreeze({
    profile_id: "seedream-editor-drawing-source-profile-v1" as const,
    variant, model_id: variant, model_type: variant, navigation_id: "seedream-editor" as const,
    source_role: "editor_drawing" as const, wire_role: "image" as const,
    source_binding: {
      public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
      settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
      original_profile_schema_hash: hash,
      source_artifacts: DRAWING_SOURCE_ARTIFACTS,
      export: { with_image: false as const, default_mime_type: "image/png" as const, hidden_upload: true as const, extra_role: "image" as const },
      source_confidence: "HASH_PINNED_STATIC_SOURCE_NOT_RENDERED_UI" as const
    },
    input_policy: {
      mime_type: "image/png" as const, local_resource_bound_bytes: 32 * 1024 * 1024,
      local_resource_policy: "BOUNDED_CONTAINER_INSPECTION_ONLY_NOT_SOURCE_OR_PROVIDER_LIMIT" as const,
      source_bytes_limit: "UNPROVEN" as const, png_transparency: "NOT_CHECKED" as const,
      geometry: "CONTAINER_METADATA_ONLY_NOT_DECODED_PIXELS" as const
    },
    runtime_usable: false as const, generation_allowed: false as const, dispatch_allowed: false as const,
    backend_acceptance: "UNPROVEN" as const
  });
  return deepFreeze({ ...base, profile_schema_hash: schemaHash(base) }) as Readonly<OwnerSeedreamEditorDrawingSourceProfile>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function fail(code: "INVALID_REQUEST" | "PROFILE_BINDING_MISMATCH"): never { throw new OwnerSeedreamEditorDrawingSourceProfileError(code); }
