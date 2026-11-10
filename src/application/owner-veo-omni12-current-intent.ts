import { types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../domain/generation-contract.js";
import { validateOwnerCurrentVideoReferenceSelection } from "./owner-current-video-reference-policy.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

const MODEL_ID = "omni1.2" as const;
const SOURCE_PINS = Object.freeze({
  public_catalog_version: "sha256-49f41bb1565932456137e2a264a2904c441a95e9f5e0aa2a76a9a0c503fedc13.json",
  settings_inventory_version: "sha256-0a03f8d27f72361e8ca6cff628e2a6245e8fca11b338d0c996ecf71c79b43c32.json",
  form_id: "veo-3",
  form_sha256: "sha256:518c722a239067a2730df3d7fb9202bffa98bec045d62617cd0c61ea3126fb90"
});

/** New public model identity. The legacy veo_omni profiles retain their own source pins and proofs. */
export const OWNER_VEO_OMNI12_CURRENT_SOURCE = Object.freeze({
  status: "FORM_SOURCE_REVIEWED_CURRENT_MODES" as const,
  build_id: "1794311734" as const,
  model_id: MODEL_ID,
  ai_name: "veo3" as const,
  source_pins: SOURCE_PINS,
  constants_sha256: "sha256:e146ec65c75aef4f000017f01ee42710f9bbfeab15292cc76886180c296bf70d",
  reference_card_sha256: "sha256:b1e4b6d6db53f25da970354ac6f4c477d2b511f550ff4cb90f37a774ac7d76fe",
  quality_sha256: "sha256:99fd22bb4ba60d5e9ea7a05426901e5ac87891c4c943475f845273b97ff94ea0",
  controls: Object.freeze({ type: Object.freeze(["text", "image", "references"] as const), aspect_ratio: Object.freeze(["16:9", "9:16"] as const),
    video_duration: Object.freeze([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const),
    upscale: Object.freeze([0, 1, 2, 3] as const), prompt_minimum_utf16: 8, prompt_maximum_utf16: 50_000 }),
  references: Object.freeze({ image: "first_frame image; optional last_frame image; or sole first_clip video" as const,
    references: "1..7 total; up to 7 images alone, or up to 5 images plus 1 video" as const,
    input_clip_seconds: Object.freeze({ min: 2.9, max: 15.1 }), image_mode_two_frames_max_output_seconds: 10,
    image_mode_first_clip_max_output_seconds: 10, first_clip_total_seconds: 30 }),
  cost: Object.freeze({ base_caller_keys: Object.freeze(["upscale", "video_duration"] as const),
    references_with_video: Object.freeze({ mode: "full" as const }), image_first_clip: Object.freeze({ veo3_type: "extend" as const }) }),
  reference_prompt_mode: "ALIASES_IN_REFERENCES_ONLY" as const,
  video_editor_task_to_edit: "SEPARATE_HISTORY_DEPENDENT_FLOW_NOT_ADMITTED" as const,
  effective_saved_ui_defaults: "UNKNOWN" as const,
  provider_acceptance: "UNPROVEN" as const
});
const sourceHash = schemaHash(OWNER_VEO_OMNI12_CURRENT_SOURCE);
const schema = z.object({
  model_id: z.literal(MODEL_ID), type: z.enum(["text", "image", "references"]), prompt: z.string().min(8).max(50_000),
  aspect_ratio: z.enum(["16:9", "9:16"]), video_duration: z.number().int().min(3).max(15),
  upscale: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
}).strict();
export type OwnerVeoOmni12CurrentNormalized = Readonly<z.infer<typeof schema> & { readonly mode: "text" | "image" | "references" }>;
declare const intentBrand: unique symbol;
export interface OwnerVeoOmni12CurrentIntent { readonly [intentBrand]: never; }
const intents = new WeakMap<object, Readonly<OwnerCurrentVideoIntentDescription>>();

export function normalizeOwnerVeoOmni12CurrentInput(value: unknown): OwnerVeoOmni12CurrentNormalized {
  plain(value);
  const parsed = schema.parse(value), prompt = parsed.prompt.trim();
  if (prompt.length < 8 || !wellFormed(prompt) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt) || /<<<https?:\/\//iu.test(prompt)) invalid();
  return Object.freeze({ ...parsed, prompt, mode: parsed.type });
}

export function compileOwnerVeoOmni12CurrentIntent(input: OwnerVeoOmni12CurrentNormalized,
  metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerVeoOmni12CurrentIntent {
  plain(input);
  const { mode, ...fields } = input, normalized = normalizeOwnerVeoOmni12CurrentInput(fields), references = snapshotMetadata(metadata);
  if (mode !== normalized.mode) invalid();
  validateOwnerCurrentVideoReferenceSelection(MODEL_ID, mode, references.map((ref, index) => Object.freeze({ ...ref,
    reference_handle: `current_video_ref_00000000-0000-4000-8000-${String(index).padStart(12, "0")}` })));
  const firstClip = mode === "image" && references[0]?.role === "first_clip";
  if (mode === "image" && (references.length === 2 || firstClip) && normalized.video_duration > 10) invalid();
  if (firstClip && normalized.video_duration > Math.floor(30 - references[0]!.duration_seconds!)) invalid();
  const settings = Object.freeze({ model_type: MODEL_ID, type: normalized.type, aspect_ratio: normalized.aspect_ratio,
    video_duration: normalized.video_duration, upscale: normalized.upscale });
  const cost_parameters = Object.freeze({ upscale: normalized.upscale, video_duration: normalized.video_duration,
    ...(mode === "references" && references.some(ref => ref.kind === "video") ? { mode: "full" } : {}),
    ...(firstClip ? { veo3_type: "extend" } : {}) });
  const description: OwnerCurrentVideoIntentDescription = Object.freeze({ model_id: MODEL_ID, mode, ai_name: "veo3", prompt: normalized.prompt,
    settings, cost_parameters, reference_metadata: references,
    reference_prompt_mode: mode === "references" ? "ENABLED_ALIASES" : "DISABLED_LITERAL",
    intent_fingerprint: schemaHash({ source_profile_sha256: sourceHash, prompt: normalized.prompt, settings, references }),
    source_profile_sha256: sourceHash, source_pins: SOURCE_PINS });
  const intent = Object.freeze({}) as OwnerVeoOmni12CurrentIntent;
  intents.set(intent, description);
  return intent;
}
export function inspectOwnerVeoOmni12CurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null {
  return value && typeof value === "object" && !types.isProxy(value) ? intents.get(value) ?? null : null;
}
const definition: OwnerCurrentVideoFamilyDefinition<OwnerVeoOmni12CurrentNormalized, OwnerVeoOmni12CurrentIntent> = Object.freeze({
  model_ids: Object.freeze([MODEL_ID]), source_profile_sha256: sourceHash, source_pins: SOURCE_PINS,
  normalize: normalizeOwnerVeoOmni12CurrentInput, compile: compileOwnerVeoOmni12CurrentIntent,
  inspect: inspectOwnerVeoOmni12CurrentIntent
});
export function getOwnerVeoOmni12CurrentFamilyDefinition() { return definition; }
function snapshotMetadata(value: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): readonly Readonly<OwnerCurrentVideoReferenceMetadata>[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 7) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some(key => key !== "length" &&
      (typeof key !== "string" || !/^\d+$/u.test(key) || Number(key) >= value.length))) invalid();
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const slot = descriptors[String(index)];
    if (!slot?.enumerable || !Object.hasOwn(slot, "value")) invalid();
    const ref = slot.value as OwnerCurrentVideoReferenceMetadata;
    plain(ref);
    const own = Object.keys(ref);
    if (own.some(key => !["role", "kind", "mime_type", "size", "sha256", "width", "height", "duration_seconds"].includes(key)) ||
        typeof ref.role !== "string" || typeof ref.kind !== "string" || typeof ref.mime_type !== "string" ||
        !Number.isSafeInteger(ref.size) || ref.size < 1 || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) invalid();
    if (ref.kind === "image") {
      if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(ref.mime_type) || ref.size > 27_525_120 ||
          !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width! < 1 || ref.height! < 1 ||
          ref.width! > 8000 || ref.height! > 8000 || ref.width! * ref.height! > 52_500_000 || ref.duration_seconds !== undefined) invalid();
    } else if (ref.kind === "video") {
      if (!["video/mp4", "video/quicktime"].includes(ref.mime_type) || ref.size > 100 * 1024 * 1024 ||
          !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width! < 240 || ref.height! < 240 ||
          ref.width! > 8000 || ref.height! > 8000 || typeof ref.duration_seconds !== "number" ||
          !Number.isFinite(ref.duration_seconds) || ref.duration_seconds < 2.9 || ref.duration_seconds > 15.1) invalid();
    } else invalid();
    return Object.freeze({ ...ref });
  }));
}
function plain(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
      Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key => typeof key !== "string" ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) invalid();
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (n >= 0xdc00 && n <= 0xdfff) return false;
  }
  return true;
}
function invalid(): never { throw new Error("OWNER_VEO_OMNI12_CURRENT_INTENT_INVALID"); }
