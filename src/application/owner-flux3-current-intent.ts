import { types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

export const OWNER_FLUX3_CURRENT_MODELS = ["flux3_t2v", "flux3_i2v", "flux3_v2v"] as const;
const ratios = ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
const pins = Object.freeze({ public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_id: "flux-3-video", form_sha256: "sha256:944766de74b3dd67e362eccbd6f28b890faf5df3da4144284f39b6ec7843307a" });
export const OWNER_FLUX3_CURRENT_SOURCE = deepFreeze({ status: "FORM_SOURCE_REVIEWED", build_id: "1793890358", source_pins: pins,
  model_ids: OWNER_FLUX3_CURRENT_MODELS, resolution: ["hd", "fhd"], generate_audio: "EXPLICIT_BOOLEAN",
  video_duration: { minimum: 5, maximum_t2v_i2v: 20, maximum_v2v: 15, manual_fractions: true, slider_step: 1,
    slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46", setter: "NUMBER_CLAMP_NO_QUANTIZATION" },
  aspect_ratio: { text: ratios, media: "auto" }, reference_counts: { text: 0, image: [1, 10], video: 1 },
  source_cost_keys: ["video_duration", "resolution", "draft"], supplied_cost_keys: ["video_duration", "resolution"],
  draft: "UNSET_OMITTED_NOT_LITERAL_UNDEFINED", seed: "NOT_A_CURRENT_CONTROL", prompt_local_maximum_utf16: 35000,
  provider_acceptance: "UNPROVEN_NEW_TUPLES", saved_ui_defaults: "NOT_INFERRED", legacy_profiles: "UNCHANGED" } as const);
const profileHash = schemaHash(OWNER_FLUX3_CURRENT_SOURCE);
const schema = z.object({ model_id: z.enum(OWNER_FLUX3_CURRENT_MODELS), prompt: z.string().min(1).max(35000),
  resolution: z.enum(["hd", "fhd"]), video_duration: z.number().finite().min(5).max(20), generate_audio: z.boolean(),
  aspect_ratio: z.enum(ratios).optional() }).strict();
export type OwnerFlux3CurrentNormalizedInput = Readonly<z.infer<typeof schema> & { mode: "text" | "image" | "video" }>;
declare const flux3CurrentBrand: unique symbol;
export interface OwnerFlux3CurrentIntent { readonly [flux3CurrentBrand]: never; }
const intents = new WeakMap<object, Readonly<OwnerCurrentVideoIntentDescription>>();
export function normalizeOwnerFlux3CurrentInput(value: unknown, referenceCount = 0): OwnerFlux3CurrentNormalizedInput {
  plain(value); const input = schema.parse(value), mode = input.model_id === "flux3_t2v" ? "text" : input.model_id === "flux3_i2v" ? "image" : "video";
  if (!Number.isSafeInteger(referenceCount) || !input.prompt.trim() || /<<<https?:\/\//iu.test(input.prompt) ||
    /[\p{Cs}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.prompt) ||
    (mode === "text" ? referenceCount !== 0 || input.aspect_ratio === undefined : input.aspect_ratio !== undefined) ||
    mode === "image" && (referenceCount < 1 || referenceCount > 10) || mode === "video" && (referenceCount !== 1 || input.video_duration > 15)) invalid();
  return Object.freeze({ ...input, mode });
}
export function compileOwnerFlux3CurrentIntent(input: OwnerFlux3CurrentNormalizedInput,
  metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerFlux3CurrentIntent {
  plain(input); if (!Array.isArray(metadata) || types.isProxy(metadata) || Object.getPrototypeOf(metadata) !== Array.prototype) invalid();
  const slots = Object.getOwnPropertyDescriptors(metadata);
  if (Reflect.ownKeys(slots).length !== metadata.length + 1 || metadata.length > 10) invalid();
  const { mode, ...fields } = input, normalized = normalizeOwnerFlux3CurrentInput(fields, metadata.length);
  if (mode !== normalized.mode) invalid();
  const refs = Object.freeze(Array.from({ length: metadata.length }, (_, index) => {
    const slot = slots[String(index)]; if (!slot || !slot.enumerable || !Object.hasOwn(slot, "value")) invalid();
    const ref = slot.value as Readonly<OwnerCurrentVideoReferenceMetadata>; plain(ref);
    if (ref.role !== mode || ref.kind !== mode || !Number.isSafeInteger(ref.size) || ref.size < 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) || !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) ||
      ref.width! < 1 || ref.height! < 1 || ref.width! > 8400 || ref.height! > 8400 || ref.width! * ref.height! > 52500000 ||
      (mode === "image" ? !["image/jpeg", "image/png", "image/webp"].includes(ref.mime_type) || ref.size > 10485760 :
        ref.mime_type !== "video/mp4" || ref.size > 52428800 || !Number.isFinite(ref.duration_seconds) || ref.duration_seconds! <= 0 || ref.duration_seconds! > 15)) invalid();
    return Object.freeze({ ...ref });
  }));
  const settings = Object.freeze({ model_type: normalized.model_id, video_duration: normalized.video_duration,
    resolution: normalized.resolution, aspect_ratio: mode === "text" ? normalized.aspect_ratio! : "auto", generate_audio: normalized.generate_audio });
  const description: OwnerCurrentVideoIntentDescription = Object.freeze({ model_id: normalized.model_id, mode, ai_name: "flux3_video", prompt: normalized.prompt,
    settings, cost_parameters: Object.freeze({ video_duration: normalized.video_duration, resolution: normalized.resolution }), reference_metadata: refs,
    reference_prompt_mode: "DISABLED_LITERAL", intent_fingerprint: schemaHash({ source_profile_sha256: profileHash, prompt: normalized.prompt, settings, references: refs }),
    source_profile_sha256: profileHash, source_pins: pins });
  const token = Object.freeze({}) as OwnerFlux3CurrentIntent; intents.set(token, description); return token;
}
export function inspectOwnerFlux3CurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null {
  return value && typeof value === "object" && !types.isProxy(value) ? intents.get(value) ?? null : null;
}
const definition: OwnerCurrentVideoFamilyDefinition<OwnerFlux3CurrentNormalizedInput, OwnerFlux3CurrentIntent> = Object.freeze({
  model_ids: OWNER_FLUX3_CURRENT_MODELS, source_profile_sha256: profileHash, source_pins: pins,
  normalize: normalizeOwnerFlux3CurrentInput, compile: compileOwnerFlux3CurrentIntent, inspect: inspectOwnerFlux3CurrentIntent });
export function getOwnerFlux3CurrentFamilyDefinition() { return definition; }
function plain(value: unknown) { if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
  Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
  Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key => typeof key !== "string" ||
    !Object.getOwnPropertyDescriptor(value, key)!.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) invalid(); }
function invalid(): never { throw new Error("OWNER_FLUX3_CURRENT_INPUT_INVALID"); }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
