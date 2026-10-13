/**
 * Versioned, redacted inventory of the owner profiles that have a live
 * terminal-result observation. This is deliberately static: importing it
 * never authenticates, contacts SYNTX, or starts a billed operation.
 *
 * Operational generators keep their own request validation, but this registry
 * is the read-only public contract for what that validation currently allows.
 */

import type { SyntxPublicCatalogSnapshot } from "./syntx-public-catalog.js";

export const RUNTIME_COVERAGE_VERSION = "owner-live-verified-2026-10-09" as const;

export type RuntimeCoverageModality = "image" | "video";
export type RuntimeCoverageCancelMode = "OPEN";

export interface RuntimeCoverageOutputSchema {
  readonly type: "object";
  readonly artifact_field: "images" | "videos";
  readonly required_fields: readonly [
    "images" | "videos",
    "requested_copies",
    "succeeded_copies",
    "notes"
  ];
  readonly artifact_mime_types: readonly string[];
  readonly additional_properties: false;
}

export interface RuntimeCoverageSettingsVariant {
  readonly id: "sunburst-2k-high-16x9" | "sunburst-4k-max-21x9" | "flare-2k-high-16x9";
  readonly settings: Readonly<Record<string, unknown>>;
  readonly runtime_verified: true;
}

export interface RuntimeCoverageProfile {
  readonly model_id: string;
  readonly ai_name: string;
  readonly modality: RuntimeCoverageModality;
  readonly settings: Readonly<Record<string, unknown>>;
  /** Optional separately verified settings variants; absent means no extra variant is enabled. */
  readonly settings_variants?: readonly RuntimeCoverageSettingsVariant[];
  readonly one_copy_only: true;
  readonly opt_in_flag:
    | "SYNTX_OWNER_GENERATE_IMAGE"
    | "SYNTX_OWNER_GENERATE_VIDEO";
  readonly result_mime_types: readonly string[];
  /** No live cancellation contract is claimed for this profile. */
  readonly cancel_mode: RuntimeCoverageCancelMode;
  /** Redacted shape of the corresponding owner tool result. */
  readonly output_schema: RuntimeCoverageOutputSchema;
  readonly runtime_verified: true;
  readonly catalog_only: false;
  readonly unsupported_notes: readonly string[];
}

export interface RuntimeCoverageCatalogDrift {
  readonly model_id: string;
  readonly kind: "missing_model" | "ai_name_mismatch" | "modality_mismatch";
  readonly expected: string;
  readonly actual: string | null;
}

const image = (
  model_id: string,
  ai_name: string,
  settings: Readonly<Record<string, unknown>>,
  result_mime_types: readonly string[] = ["image/png"],
  settings_variants?: readonly RuntimeCoverageSettingsVariant[]
): RuntimeCoverageProfile => ({
  model_id,
  ai_name,
  modality: "image",
  settings,
  ...(settings_variants === undefined ? {} : { settings_variants }),
  one_copy_only: true,
  opt_in_flag: "SYNTX_OWNER_GENERATE_IMAGE",
  result_mime_types,
  cancel_mode: "OPEN",
  output_schema: {
    type: "object",
    artifact_field: "images",
    required_fields: ["images", "requested_copies", "succeeded_copies", "notes"],
    artifact_mime_types: result_mime_types,
    additional_properties: false
  },
  runtime_verified: true,
  catalog_only: false,
  unsupported_notes: [
    "Only the exact settings shown here are live-verified; other variants remain catalog-only."
  ]
});

const video = (
  model_id: string,
  ai_name: string,
  settings: Readonly<Record<string, unknown>>
): RuntimeCoverageProfile => ({
  model_id,
  ai_name,
  modality: "video",
  settings,
  one_copy_only: true,
  opt_in_flag: "SYNTX_OWNER_GENERATE_VIDEO",
  result_mime_types: ["video/mp4"],
  cancel_mode: "OPEN",
  output_schema: {
    type: "object",
    artifact_field: "videos",
    required_fields: ["videos", "requested_copies", "succeeded_copies", "notes"],
    artifact_mime_types: ["video/mp4"],
    additional_properties: false
  },
  runtime_verified: true,
  catalog_only: false,
  unsupported_notes: [
    "Only text-to-video with the exact settings shown here is live-verified; image-to-video, edit and upload variants remain catalog-only."
  ]
});

export const RUNTIME_COVERAGE_PROFILES: readonly RuntimeCoverageProfile[] = [
  image("banana", "banana", { model_type: "banana" }),
  image("banana-2.1", "banana", {
    n: 1,
    model_type: "banana-2.1",
    aspect_ratio: "1:1",
    image_size: "1K",
    thinking_level: "minimal",
    file_urls: []
  }, ["image/jpeg"]),
  image("gpt-image-1", "sora-images", { model_type: "gpt-image-1" }),
  image("gpt-image-1.5", "sora-images", { model_type: "gpt-image-1.5" }),
  image("ideogram", "ideogram", {
    model_type: "ideogram",
    rendering_speed: "TURBO",
    aspect_ratio: "1:1",
    resolution: "",
    style_type: "GENERAL",
    style_preset: "",
    magic_prompt: "AUTO",
    color_palette_mode: "preset",
    negative_prompt: "",
    num_images: 1,
    seed: null,
    mode: "generate",
    image_weight: 50,
    resemblance: 55,
    detail: 90
  }),
  image("flux-1", "flux", {
    model_type: "flux-1",
    steps: 28,
    cfg: 3.5,
    resolution: "1024x1024",
    civitai_loras: [],
    workflow_type: "default",
    image_strength: 0.5
  }),
  image("seedream-4", "seedream", {
    model_type: "seedream-4",
    resolution: "2K",
    stream: false,
    aspect_ratio: "1:1"
  }, ["image/jpeg"]),
  image("seedream-4.5", "seedream", {
    model_type: "seedream-4.5",
    resolution: "2K",
    stream: false,
    aspect_ratio: "1:1"
  }, ["image/jpeg"]),
  image("seedream-5", "seedream", {
    model_type: "seedream-5",
    resolution: "2K",
    stream: false,
    aspect_ratio: "1:1"
  }, ["image/jpeg"]),
  image("seedream-5.0-pro", "seedream", {
    model_type: "seedream-5.0-pro",
    resolution: "2K",
    stream: false,
    aspect_ratio: "1:1"
  }, ["image/jpeg"]),
  image("grok_t2i", "grok_image", {
    model_type: "grok_t2i",
    aspect_ratio: "1:1",
    resolution: "1k",
    batch_size: 1
  }, ["image/jpeg"]),
  image("grok_t2i_pro", "grok_image", {
    model_type: "grok_t2i_pro",
    aspect_ratio: "1:1",
    resolution: "1k",
    batch_size: 1,
    details_quality: "low"
  }, ["image/jpeg"]),
  image("grok_imagine_2", "grok_image", {
    model_type: "grok_imagine_2",
    aspect_ratio: "1:1",
    resolution: "1k",
    batch_size: 1,
    details_quality: "low"
  }, ["image/jpeg"]),
  image("grok_imagine_quality", "grok_image", {
    model_type: "grok_imagine_quality",
    aspect_ratio: "1:1",
    resolution: "1k",
    batch_size: 1,
    details_quality: "low"
  }, ["image/jpeg"]),
  image("runway_frames", "runway-frames", {
    model_type: "runway_frames",
    temperature: 3,
    resolution: "1088x1088"
  }),
  image("wan_26_t2i", "wan_image", {
    model_type: "wan_26_t2i",
    aspect_ratio: "1:1",
    resolution: "720P",
    seed: null,
    batch_size: 1,
    prompt_extend: false,
    bbox_list: []
  }),
  image("uni-1", "luma_image", {
    model_type: "uni-1"
  }),
  image("gpt-image-2.5-sunburst", "sora-images", {
    model_type: "gpt-image-2.5-sunburst",
    aspect_ratio: "1:1",
    details_quality: "medium",
    quality: "1K"
  }, ["image/png"], [
    {
      id: "sunburst-2k-high-16x9",
      settings: {
        model_type: "gpt-image-2.5-sunburst",
        aspect_ratio: "16:9",
        details_quality: "high",
        quality: "2K"
      },
      runtime_verified: true
    },
    {
      id: "sunburst-4k-max-21x9",
      settings: {
        model_type: "gpt-image-2.5-sunburst",
        aspect_ratio: "21:9",
        details_quality: "max",
        quality: "4K"
      },
      runtime_verified: true
    }
  ]),
  image("gpt-image-2.5-flare", "sora-images", {
    model_type: "gpt-image-2.5-flare",
    aspect_ratio: "1:1",
    details_quality: "medium",
    quality: "1K"
  }, ["image/png"], [
    {
      id: "flare-2k-high-16x9",
      settings: {
        model_type: "gpt-image-2.5-flare",
        aspect_ratio: "16:9",
        details_quality: "high",
        quality: "2K"
      },
      runtime_verified: true
    }
  ]),
  video("seedance-2.0", "seedance", {
    model_type: "seedance-2.0",
    resolution: "720p",
    mode: "mini",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: true
  }),
  video("seedance-1.5-pro", "seedance", {
    model_type: "seedance-1.5-pro",
    resolution: "720p",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: false
  }),
  video("seedance_pro", "seedance", {
    model_type: "seedance_pro",
    resolution: "720p",
    mode: "mini",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: true
  }),
  video("seedance_pro-fast", "seedance", {
    model_type: "seedance_pro-fast",
    resolution: "720p",
    mode: "mini",
    aspect_ratio: "16:9",
    video_duration: 5,
    generate_audio: true
  }),
  video("kling_text2video", "kling", {
    model_type: "kling_text2video",
    temperature: 0.5,
    aspect_ratio: "16:9",
    mode: "standart",
    version: "3.0-turbo",
    native_audio: false,
    video_duration: 5
  }),
  video("ray-3.14", "luma", {
    model_type: "ray-3.14",
    video_duration: 5,
    quality: "720p",
    aspect_ratio: "16:9",
    gen_type: "text2video"
  }),
  video("sora_1", "sora", {
    model_type: "sora_1",
    video_duration: 10,
    quality: 720,
    aspect_ratio: "16:9",
    gen_type: "text2video"
  }),
  video("wan_26_t2v", "wan_video", {
    model_type: "wan_26_t2v",
    file_urls: [],
    aspect_ratio: "1:1",
    resolution: "720P",
    video_duration: 5,
    prompt_extend: true,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false
  }),
  video("wan_27_t2v", "wan_video", {
    model_type: "wan_27_t2v",
    file_urls: [],
    aspect_ratio: "1:1",
    resolution: "1080P",
    video_duration: 5,
    prompt_extend: true,
    shot_type: "single",
    audio_setting: "auto",
    seed: null,
    native_audio: false
  }),
  video("flux3_t2v", "flux3_video", {
    model_type: "flux3_t2v",
    aspect_ratio: "auto",
    resolution: "hd",
    video_duration: 5,
    generate_audio: true
  }),
  video("happy_horse_t2v", "happy_horse", {
    model_type: "happy_horse_t2v",
    aspect_ratio: "16:9",
    resolution: "720P",
    video_duration: 5,
    native_audio: false,
    seed: null
  }),
  video("text2video", "runway", {
    model_type: "text2video",
    video_duration: "5.0",
    seed: null,
    aspect_ratio: "1"
  }),
  video("text2video-4.5", "runway", {
    model_type: "text2video-4.5",
    video_duration: "5.0",
    seed: null,
    aspect_ratio: "169"
  })
];

/**
 * Historical owner-facing identity kept only as an explicit compatibility
 * alias. It is not a runtime-coverage profile and is deliberately excluded
 * from catalog drift checks: the current public catalog names the canonical
 * profile `banana`.
 */
export const RUNTIME_COVERAGE_LEGACY_ALIASES = Object.freeze({
  "nano-banana-pro": "banana"
} as const);

export function canonicalizeRuntimeCoverageModelId(modelId: string): string {
  return RUNTIME_COVERAGE_LEGACY_ALIASES[
    modelId as keyof typeof RUNTIME_COVERAGE_LEGACY_ALIASES
  ] ?? modelId;
}

export const RUNTIME_COVERAGE_CATALOG_ONLY = Object.freeze({
  model_ids: ["veo-omni-flash", "hailuo-2.3-fast", "sora_2", "luma-image"],
  notes: [
    "Catalog presence does not imply an executable or live-verified runtime contract.",
    "VEO and Hailuo currently have no confirmed terminal artifact in the owner runtime.",
    "Upload, image-to-video, edit, upscale, audio and unlisted future variants are unsupported by this read-only coverage contract.",
    "The list is intentionally non-exhaustive; consult syntx_search_models for the dated public catalog."
  ]
} as const);

export function getRuntimeCoverageProfile(modelId: string): RuntimeCoverageProfile | undefined {
  const canonicalModelId = canonicalizeRuntimeCoverageModelId(modelId);
  return RUNTIME_COVERAGE_PROFILES.find((profile) => profile.model_id === canonicalModelId);
}

/**
 * Compare the paid owner allowlist with one already-selected, immutable public
 * snapshot. This is intentionally pure/offline: it never selects a version,
 * reads the network, authenticates, or starts a generation. Callers should run
 * this at a source-check/CI boundary and fail closed on a non-empty result.
 *
 * The public snapshot stores model identity in `models[].value`, provider
 * identity in `models[].ai_name`, and modality in `ai[].scope`. Keeping this
 * check here prevents the discovery tool and the paid owner tools from drifting
 * silently when a public snapshot rotates.
 */
export function findRuntimeCoverageCatalogDrift(
  snapshot: SyntxPublicCatalogSnapshot,
  profiles: readonly RuntimeCoverageProfile[] = RUNTIME_COVERAGE_PROFILES
): readonly RuntimeCoverageCatalogDrift[] {
  const aiScopeByName = new Map(snapshot.ai.map((entry) => [entry.value, entry.scope]));
  const modelsById = new Map(snapshot.models.map((entry) => [entry.value, entry]));
  const drift: RuntimeCoverageCatalogDrift[] = [];
  for (const profile of profiles) {
    const model = modelsById.get(profile.model_id);
    if (!model) {
      drift.push({
        model_id: profile.model_id,
        kind: "missing_model",
        expected: `models[].value=${profile.model_id}`,
        actual: null
      });
      continue;
    }
    if (model.ai_name !== profile.ai_name) {
      drift.push({
        model_id: profile.model_id,
        kind: "ai_name_mismatch",
        expected: profile.ai_name,
        actual: model.ai_name
      });
    }
    const scope = aiScopeByName.get(model.ai_name) ?? null;
    if (scope !== profile.modality) {
      drift.push({
        model_id: profile.model_id,
        kind: "modality_mismatch",
        expected: profile.modality,
        actual: scope
      });
    }
  }
  return drift;
}

/** Fail-closed assertion for offline catalog/source checks. */
export function assertRuntimeCoverageCatalogCompatible(
  snapshot: SyntxPublicCatalogSnapshot,
  profiles?: readonly RuntimeCoverageProfile[]
): void {
  const drift = findRuntimeCoverageCatalogDrift(snapshot, profiles);
  if (drift.length === 0) return;
  const details = drift
    .map(
      (entry) =>
        `${entry.kind}: model_id=${entry.model_id} expected=${entry.expected} actual=${entry.actual ?? "<missing>"}`
    )
    .join("; ");
  throw new Error(`RUNTIME_COVERAGE_CATALOG_DRIFT: ${details}`);
}
