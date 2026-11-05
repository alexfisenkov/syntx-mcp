import { types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

const model = "hailuo-3.0" as const;
const ratios = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const pins = Object.freeze({ public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json", form_id: "hailuo-minimax",
  form_sha256: "sha256:fd029a522237cdb41a287c52603b7c262e8cf54617ea3cd5920ff41db7abd98f" });
export const OWNER_HAILUO3_CURRENT_SOURCE = deepFreeze({ status: "FORM_SOURCE_REVIEWED", model_ids: [model], ai_name: "hailuo-minimax", source_pins: pins,
  helpers: Object.freeze({ reference_card: "sha256:7ec3b3e3ff800d787712f0c4a04bae1bd3c6282a3bb58887d6def8d9a94c15fc",
    common_input: "sha256:a5cda2ec36e1f9c2ee43cc0bf3ffc84e4537bc9ae19aa5301d4bf9e238bbd54e",
    common_store: "sha256:d4cee0c4eedbd4e7d22e04e27a51fb349b644570c192ac4d3931bbc90d8bd49b",
    settings: "sha256:bd56383bbe49cdb2b154c8227cecaa73785b82c0d991ba0b17e1145a11082933" }),
  modes: ["omni-references", "frames"], resolutions: ["768p", "2K"], video_duration: { minimum: 4, maximum: 15, integer: false, slider_step: 1, manual_quantization: "NONE" },
  aspect_ratio: { omni: ratios, frames: ["auto"], frames_semantics: "FORCED_AUTO_WIRE_INPUT_DERIVED_NOT_CALLER_RATIO" },
  references: { omni: { total: 12, images: 9, videos: 3, audios: 3, empty_and_audio_only: true }, frames: { first_frame: 1, last_frame: 1, last_only: true, minimum: 1 },
    per_video_seconds: [2, 15], total_video_seconds: 15, per_audio_seconds: [2, 15], total_audio_seconds: 15,
    image_bytes: 27_525_120, image_api_maximum_bytes: 31_457_280, video_bytes: 52_428_800, audio_bytes: 15_728_640,
    image_side: [256, 5760], image_aspect: [0.4, 2.5], video_hdr: false, video_side_fps_bounds: "NOT_INHERITED_FROM_IMAGE_OR_OTHER_MODELS" },
  prompt: { required: true, ui_maximum: "ZERO_MEANS_UNLIMITED_IN_COMMON_INPUT", local_maximum_utf16: 20000, local_bound_kind: "OPERATOR_RESOURCE_GUARD_NOT_PROVIDER_LIMIT", file_mentions: false },
  cost: { keys: ["ref_count", "resolution", "duration", "video_duration"], ref_count: "ALL_SELECTED_IMAGES_INCLUDING_FRAME_ROLES", duration: "VIDEO_DURATION_SUM_ROUND2_THEN_FIXED2_STRING_OR_NUMBER0" },
  effective_saved_ui_defaults: "NOT_INFERRED", provider_acceptance: "UNPROVEN_NEW_TUPLES", historical_frames_422: "UNCHANGED_NOT_REPLAYED_OR_PROMOTED" } as const);
const sourceHash = schemaHash(OWNER_HAILUO3_CURRENT_SOURCE);
const inputSchema = z.object({ model_id: z.literal(model), mode: z.enum(["omni-references", "frames"]), prompt: z.string().max(20000),
  resolution: z.enum(["768p", "2K"]), video_duration: z.number().finite().min(4).max(15), aspect_ratio: z.enum(["auto", ...ratios]) }).strict();
export type OwnerHailuo3CurrentNormalizedInput = Readonly<z.infer<typeof inputSchema>>;
declare const hailuoIntentBrand: unique symbol;
export interface OwnerHailuo3CurrentIntent { readonly [hailuoIntentBrand]: never; }
const intents = new WeakMap<object, Readonly<OwnerCurrentVideoIntentDescription>>();

export function normalizeOwnerHailuo3CurrentInput(value: unknown): OwnerHailuo3CurrentNormalizedInput {
  plain(value); const parsed = inputSchema.parse(value), prompt = parsed.prompt.trim();
  if (!prompt || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt) || /[\uD800-\uDFFF]/u.test(prompt) ||
      (parsed.mode === "frames" ? parsed.aspect_ratio !== "auto" : parsed.aspect_ratio === "auto")) invalid();
  return Object.freeze({ ...parsed, prompt });
}
export function compileOwnerHailuo3CurrentIntent(input: OwnerHailuo3CurrentNormalizedInput,
  metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerHailuo3CurrentIntent {
  const normalized = normalizeOwnerHailuo3CurrentInput(input), refs = snapshotMetadata(metadata);
  let videos = 0, audios = 0, images = 0, totalVideo = 0, totalAudio = 0;
  if (normalized.mode === "frames" && (refs.length < 1 || refs.length > 2 || refs.some(ref => ref.kind !== "image" || !["first_frame", "last_frame"].includes(ref.role)) ||
      new Set(refs.map(ref => ref.role)).size !== refs.length || refs.length === 2 && (refs[0]!.role !== "first_frame" || refs[1]!.role !== "last_frame"))) invalid();
  for (const ref of refs) {
    if (normalized.mode === "omni-references" && ref.role !== ref.kind) invalid();
    if (ref.kind === "image") {
      images++; const width = ref.width!, height = ref.height!;
      if (!["image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif"].includes(ref.mime_type) || ref.size > 27_525_120 ||
          !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || Math.min(width, height) < 256 || Math.max(width, height) > 5760 || width / height < 0.4 || width / height > 2.5) invalid();
    } else if (ref.kind === "video" || ref.kind === "audio") {
      if (normalized.mode === "frames" || typeof ref.duration_seconds !== "number" || !Number.isFinite(ref.duration_seconds) || ref.duration_seconds < 2 || ref.duration_seconds > 15) invalid();
      if (ref.kind === "video") { videos++; totalVideo += ref.duration_seconds; if (!["video/mp4", "video/quicktime"].includes(ref.mime_type) || ref.size > 52_428_800) invalid(); }
      else { audios++; totalAudio += ref.duration_seconds; if (!["audio/mpeg", "audio/wav"].includes(ref.mime_type) || ref.size > 15_728_640) invalid(); }
    } else invalid();
  }
  if (refs.length > 12 || normalized.mode === "omni-references" && (images > 9 || videos > 3 || audios > 3) || totalVideo > 15 || totalAudio > 15) invalid();
  const settings = Object.freeze({ model_type: model, mode: normalized.mode, resolution: normalized.resolution,
    video_duration: normalized.video_duration, aspect_ratio: normalized.aspect_ratio });
  const roundedDuration = Number(totalVideo.toFixed(2)), cost = Object.freeze({ ref_count: images, resolution: normalized.resolution,
    duration: roundedDuration ? roundedDuration.toFixed(2) : 0, video_duration: normalized.video_duration });
  const fingerprint = schemaHash({ source_profile_sha256: sourceHash, prompt: normalized.prompt, settings, references: refs });
  const description: OwnerCurrentVideoIntentDescription = Object.freeze({ model_id: model, mode: normalized.mode, ai_name: "hailuo-minimax", prompt: normalized.prompt,
    settings, cost_parameters: cost, reference_metadata: refs, reference_prompt_mode: "DISABLED_LITERAL", intent_fingerprint: fingerprint,
    source_profile_sha256: sourceHash, source_pins: pins });
  const token = Object.freeze({}) as OwnerHailuo3CurrentIntent; intents.set(token, description); return token;
}
export function inspectOwnerHailuo3CurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null {
  return value && typeof value === "object" && !types.isProxy(value) ? intents.get(value) ?? null : null;
}
const definition: OwnerCurrentVideoFamilyDefinition<OwnerHailuo3CurrentNormalizedInput, OwnerHailuo3CurrentIntent> = Object.freeze({ model_ids: Object.freeze([model]),
  source_profile_sha256: sourceHash, source_pins: pins, normalize: normalizeOwnerHailuo3CurrentInput, compile: compileOwnerHailuo3CurrentIntent, inspect: inspectOwnerHailuo3CurrentIntent });
export function getOwnerHailuo3CurrentFamilyDefinition() { return definition; }
function snapshotMetadata(value: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): readonly Readonly<OwnerCurrentVideoReferenceMetadata>[] {
  if (!Array.isArray(value) || types.isProxy(value) || value.length > 12 || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const slots = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(slots).length !== value.length + 1 || Array.from({ length: value.length }, (_, i) => slots[String(i)]).some(slot => !slot || !Object.hasOwn(slot, "value"))) invalid();
  return Object.freeze(Array.from({ length: value.length }, (_, index) => { const ref = slots[String(index)]!.value as Readonly<OwnerCurrentVideoReferenceMetadata>; plain(ref); if (!Number.isSafeInteger(ref.size) || ref.size < 1 || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) || typeof ref.mime_type !== "string") invalid(); return Object.freeze({ ...ref }); }));
}
function plain(value: unknown) { if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
  Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key => typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) invalid(); }
function invalid(): never { throw new Error("OWNER_HAILUO3_CURRENT_INTENT_INVALID"); }

function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
