import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

export const OWNER_SEEDANCE_CURRENT_MODEL_IDS = Object.freeze(["seedance-2.0", "seedance-2.5", "seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"] as const);
type Model = typeof OWNER_SEEDANCE_CURRENT_MODEL_IDS[number];
const RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const OWNER_SEEDANCE_CURRENT_SOURCE = freeze({
  status: "FORM_SOURCE_REVIEWED", provider_acceptance: "UNPROVEN", build: "1793890358",
  source_pins: Object.freeze({ public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
    settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json", form_id: "seedance",
    form_sha256: "sha256:383bd2c5f8bd5f8e80cce6ef675f92693585cef502e1a93e59d4d865b8fbd9b6" }),
  helper_sha256: "sha256:3e9229fe7c238a1e7b95f22d313bc8c6ea3b1612c0c54bb9fa08d406c5711d28",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  controls: Object.freeze({ versions20: ["mini", "fast", "pro"], modes20: ["omni-references", "frames"],
    modes25: ["omni-references", "frames", "extend", "edit"], durations20: [4, 15], durations25: [4, 30], auto_duration25: 0,
    frame_aspect: "adaptive", edit_duration: 0, duration_cost: "TRUSTED_VIDEO_TOTAL_ROUNDED_TO_TWO_DECIMALS",
    duration_slider_manual_fractions: true,
    slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
    hidden_older_aspect: "EXPLICIT_PREATTACH_CACHE_VALUE_PRESERVED", seeds: "NOT_CURRENT_FORM_CONTROLS" }),
  references: Object.freeze({ images20: 6, videos20: 3, audio20: 2, images25: 30, videos25: 10, audio25: 10,
    frames: "FIRST_REQUIRED_OPTIONAL_LAST", older_images: { seedance_pro: 2, "seedance_pro-fast": 1, "seedance-1.5-pro": 2 } })
});
const PROFILE = schemaHash(OWNER_SEEDANCE_CURRENT_SOURCE);
export interface OwnerSeedanceCurrentNormalized { readonly model_id: Model; readonly mode: string; readonly controls: Readonly<Record<string, unknown>>; }
declare const seedanceCurrentIntentBrand: unique symbol;
export interface OwnerSeedanceCurrentIntent extends OwnerCurrentVideoIntentDescription { readonly [seedanceCurrentIntentBrand]: never; }
const INTENTS = new WeakSet<object>();

export function normalizeOwnerSeedanceCurrentInput(value: unknown, referenceCount: number): OwnerSeedanceCurrentNormalized {
  const q = record(value), model = q.model_id as Model;
  if (!(OWNER_SEEDANCE_CURRENT_MODEL_IDS as readonly unknown[]).includes(model) || !Number.isSafeInteger(referenceCount) || referenceCount < 0 || referenceCount > 50) invalid();
  const modern = model === "seedance-2.0" || model === "seedance-2.5", mode = modern ? q.mode : "images";
  if (typeof mode !== "string" || !(modern ? model === "seedance-2.0" ? ["omni-references", "frames"] : ["omni-references", "frames", "extend", "edit"] : ["images"]).includes(mode)) invalid();
  const derivedAspect = modern && (mode === "frames" || mode === "edit" || mode === "extend"), edit = model === "seedance-2.5" && mode === "edit";
  const keys = ["model_id", "prompt", "resolution", ...(modern ? ["mode", "generate_audio"] : []),
    ...(model === "seedance-2.0" ? ["version"] : []), ...(!derivedAspect ? ["aspect_ratio"] : []), ...(!edit ? ["video_duration"] : []),
    ...(model === "seedance-1.5-pro" ? ["generate_audio", "camera_fixed"] : [])];
  if (Object.keys(q).length !== keys.length || keys.some(key => !Object.hasOwn(q, key)) ||
    typeof q.prompt !== "string" || /[\p{Cs}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(q.prompt) ||
    /<<<https?:\/\//iu.test(q.prompt) || q.prompt.length > (modern ? 35000 : 5000) ||
    (!(model === "seedance-2.5" && mode !== "frames") && !q.prompt.trim())) invalid();
  const resolutions = model === "seedance-1.5-pro" ? ["720p"] : model === "seedance-2.0" ?
    q.version === "pro" ? ["480p", "720p", "1080p", "4K"] : ["480p", "720p"] : ["480p", "720p", "1080p"];
  if (!resolutions.includes(q.resolution as string) || model === "seedance-2.0" && !["mini", "fast", "pro"].includes(q.version as string) ||
    !derivedAspect && ![...RATIOS, ...(model === "seedance-2.5" ? ["adaptive"] : [])].includes(q.aspect_ratio as typeof RATIOS[number]) ||
    model === "seedance_pro-fast" && q.aspect_ratio === "21:9" ||
    (modern || model === "seedance-1.5-pro") && typeof q.generate_audio !== "boolean" || model === "seedance-1.5-pro" && typeof q.camera_fixed !== "boolean") invalid();
  if (!edit) {
    const d = q.video_duration;
    const valid = typeof d === "number" && Number.isFinite(d) && (model === "seedance-2.5" ?
      d === 0 && (mode === "omni-references" || mode === "extend") || (d as number) >= 4 && (d as number) <= 30 :
      model === "seedance-2.0" ? (d as number) >= 4 && (d as number) <= 15 : model === "seedance_pro" ? d === 5 || d === 10 : (d as number) >= 5 && (d as number) <= 12);
    if (!valid) invalid();
  }
  if (!modern && referenceCount > (model === "seedance_pro-fast" ? 1 : 2) || mode === "frames" && (referenceCount < 1 || referenceCount > 2)) invalid();
  return Object.freeze({ model_id: model, mode, controls: Object.freeze(q) });
}

export function compileOwnerSeedanceCurrentIntent(input: OwnerSeedanceCurrentNormalized,
  supplied: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerSeedanceCurrentIntent {
  const metadata = snapshotMetadata(supplied), envelope = record(input), normalized = normalizeOwnerSeedanceCurrentInput(envelope.controls, metadata.length);
  if (Object.keys(envelope).length !== 3 || envelope.model_id !== normalized.model_id || envelope.mode !== normalized.mode) invalid();
  const q = normalized.controls, model = normalized.model_id, mode = normalized.mode, modern = model === "seedance-2.0" || model === "seedance-2.5";
  const counts = { image: 0, video: 0, audio: 0 }, frameRoles = metadata.map(item => item.role);
  let totalVideo = 0, totalAudio = 0;
  for (const m of metadata) {
    if (!Object.hasOwn(counts, m.kind)) invalid(); counts[m.kind as keyof typeof counts]++;
    if (modern && mode === "frames" ? m.kind !== "image" || !["first_frame", "last_frame"].includes(m.role) : m.role !== m.kind) invalid();
    if (m.kind === "video" || m.kind === "audio") {
      if (typeof m.duration_seconds !== "number" || !Number.isFinite(m.duration_seconds) || m.duration_seconds < 2 || m.duration_seconds > (model === "seedance-2.5" ? 30 : 15)) invalid();
      if (m.kind === "video") totalVideo += m.duration_seconds; else totalAudio += m.duration_seconds;
    }
  }
  if (mode === "frames" && (frameRoles[0] !== "first_frame" || frameRoles.length === 2 && frameRoles[1] !== "last_frame")) invalid();
  if (model === "seedance-2.0" ? counts.image > 6 || counts.video > 3 || counts.audio > 2 || totalVideo > 15.1 || counts.audio > 0 && counts.image + counts.video === 0 :
    model === "seedance-2.5" ? counts.image > 30 || counts.video > 10 || counts.audio > 10 || totalVideo > 30 || totalAudio > 30 || (mode === "edit" || mode === "extend") && counts.video === 0 :
    counts.video + counts.audio !== 0) invalid();
  const inputDuration = Number(totalVideo.toFixed(2)), aspect = modern && mode !== "omni-references" ? "adaptive" : q.aspect_ratio;
  const settings: Record<string, unknown> = { model_type: model, resolution: q.resolution, aspect_ratio: aspect,
    video_duration: mode === "edit" ? 0 : q.video_duration };
  if (modern) { settings.mode = mode; settings.generate_audio = q.generate_audio; }
  if (model === "seedance-2.0") { settings.version = q.version; settings.input_video_duration = Math.round(inputDuration) || 0; }
  if (model === "seedance-1.5-pro") { settings.generate_audio = q.generate_audio; settings.camera_fixed = q.camera_fixed; }
  const cost: Record<string, string | number | boolean> = { video_duration: settings.video_duration as number, resolution: q.resolution as string };
  if (modern) { cost.duration = inputDuration; cost.mode = mode; cost.size = aspect as string; }
  if (model === "seedance-2.0") cost.version = q.version as string;
  if (model === "seedance-1.5-pro") cost.generate_audio = q.generate_audio as boolean;
  const description = Object.freeze({ model_id: model, mode, ai_name: "seedance", prompt: q.prompt as string, settings: Object.freeze(settings),
    cost_parameters: Object.freeze(cost), reference_metadata: metadata,
    reference_prompt_mode: modern && mode !== "frames" ? "ENABLED_ALIASES" as const : "DISABLED_LITERAL" as const,
    source_profile_sha256: PROFILE, source_pins: OWNER_SEEDANCE_CURRENT_SOURCE.source_pins,
    intent_fingerprint: schemaHash({ model, mode, prompt: q.prompt, settings, cost, metadata }) });
  INTENTS.add(description); return description as unknown as OwnerSeedanceCurrentIntent;
}
export function inspectOwnerSeedanceCurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null {
  return value && typeof value === "object" && !types.isProxy(value) && INTENTS.has(value) && Object.isFrozen(value) ? value as OwnerSeedanceCurrentIntent : null;
}
const DEFINITION: OwnerCurrentVideoFamilyDefinition<OwnerSeedanceCurrentNormalized, OwnerSeedanceCurrentIntent> = Object.freeze({
  model_ids: OWNER_SEEDANCE_CURRENT_MODEL_IDS, source_profile_sha256: PROFILE, source_pins: OWNER_SEEDANCE_CURRENT_SOURCE.source_pins,
  normalize: normalizeOwnerSeedanceCurrentInput, compile: compileOwnerSeedanceCurrentIntent, inspect: inspectOwnerSeedanceCurrentIntent });
export function getOwnerSeedanceCurrentFamilyDefinition() { return DEFINITION; }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const d = Object.getOwnPropertyDescriptors(value), out = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(d)) { if (typeof key !== "string" || !d[key]!.enumerable || !("value" in d[key]!)) invalid(); out[key] = d[key]!.value; }
  return out;
}
function snapshotMetadata(value: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): readonly Readonly<OwnerCurrentVideoReferenceMetadata>[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap, length = descriptors.length!.value as number;
  if (!Number.isSafeInteger(length) || length < 0 || length > 50 || Reflect.ownKeys(descriptors).length !== length + 1) invalid();
  const result: Readonly<OwnerCurrentVideoReferenceMetadata>[] = [];
  for (let i = 0; i < length; i++) {
    const item = descriptors[String(i)]; if (!item?.enumerable || !("value" in item)) invalid();
    const q = record(item.value);
    if (Object.keys(q).some(key => !["role", "kind", "mime_type", "size", "sha256", "width", "height", "duration_seconds"].includes(key)) ||
      typeof q.role !== "string" || typeof q.kind !== "string" || !["image", "video", "audio"].includes(q.kind) ||
      typeof q.mime_type !== "string" || !q.mime_type.startsWith(`${q.kind}/`) || !Number.isSafeInteger(q.size) || (q.size as number) < 1 ||
      typeof q.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(q.sha256)) invalid();
    for (const dimension of ["width", "height"]) if ((q.kind !== "audio" || q[dimension] !== undefined) &&
      (!Number.isSafeInteger(q[dimension]) || (q[dimension] as number) < 1)) invalid();
    result.push(Object.freeze({ ...q }) as unknown as Readonly<OwnerCurrentVideoReferenceMetadata>);
  }
  return Object.freeze(result);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child); Object.freeze(value); }
  return value;
}

function invalid(): never { throw new Error("OWNER_SEEDANCE_CURRENT_INPUT_INVALID"); }
