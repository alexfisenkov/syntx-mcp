import { types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

const model = "ray-3.14" as const, ratios = ["9:16", "3:4", "1:1", "4:3", "16:9", "21:9"] as const;
const pins = Object.freeze({ public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json", form_id: "luma",
  form_sha256: "sha256:c1db0b946e901a92a834c855c568f1081d57c27be1dedf18ee1931731952e7d2" });
export const OWNER_LUMA_CURRENT_SOURCE = deepFreeze({ status: "FORM_SOURCE_REVIEWED", model_ids: [model], ai_name: "luma", source_pins: pins,
  images: { minimum: 0, maximum: 2, role: "image", order: "SOURCE_ARRAY_ORDER", original_or_prepared_bytes: true },
  gen_type: "DERIVED_TEXT2VIDEO_WITH0_IMAGES_KEYFRAMES_WITH1_OR2", quality: ["360p", "540p", "720p", "1080p"],
  aspect_ratio: { text: ratios, images: ["auto"], image_semantics: "WATCHER_FORCES_AUTO_DISABLED_RATIO_FROM_INPUT" },
  video_duration: { text: [5, 10], images: [5], image_semantics: "WATCHER_FORCES5_DISABLED_SELECT" },
  prompt: { required_with_images: [0, 1], optional_with_images: 2, maximum_utf16: 5000, file_mentions: true },
  cost: { caller_keys: ["quality", "video_duration"], identity_owned_key: "model_type" },
  canonical_image_bytes: 26_214_400, provider_acceptance: "UNPROVEN_NEW_REFERENCE_TUPLES", effective_saved_ui_defaults: "NOT_INFERRED" } as const);
const sourceHash = schemaHash(OWNER_LUMA_CURRENT_SOURCE);
const schema = z.object({ model_id: z.literal(model), prompt: z.string().max(5000).default(""), quality: z.enum(["360p", "540p", "720p", "1080p"]),
  video_duration: z.union([z.literal(5), z.literal(10)]), aspect_ratio: z.enum(["auto", ...ratios]) }).strict();
export type OwnerLumaCurrentNormalizedInput = Readonly<z.infer<typeof schema> & { mode: "text2video" | "keyframes" }>;
declare const lumaIntentBrand: unique symbol;
export interface OwnerLumaCurrentIntent { readonly [lumaIntentBrand]: never; }
const intents = new WeakMap<object, Readonly<OwnerCurrentVideoIntentDescription>>();
export function normalizeOwnerLumaCurrentInput(value: unknown, referenceCount = 0): OwnerLumaCurrentNormalizedInput {
  plain(value); const parsed = schema.parse(value), prompt = parsed.prompt.trim();
  if (!Number.isSafeInteger(referenceCount) || referenceCount < 0 || referenceCount > 2 || /[\uD800-\uDFFF]/u.test(prompt) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt) || referenceCount < 2 && !prompt ||
      (referenceCount ? parsed.video_duration !== 5 || parsed.aspect_ratio !== "auto" : parsed.aspect_ratio === "auto")) invalid();
  return Object.freeze({ ...parsed, prompt, mode: referenceCount ? "keyframes" : "text2video" });
}
export function compileOwnerLumaCurrentIntent(input: OwnerLumaCurrentNormalizedInput, metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerLumaCurrentIntent {
  plain(input); const { mode, ...fields } = input;
  if (!Array.isArray(metadata) || types.isProxy(metadata) || metadata.length > 2) invalid();
  const normalized = normalizeOwnerLumaCurrentInput(fields, metadata.length); if (mode !== normalized.mode) invalid();
  const slots = Object.getOwnPropertyDescriptors(metadata);
  if (Object.getPrototypeOf(metadata) !== Array.prototype || Reflect.ownKeys(slots).length !== metadata.length + 1 || Array.from({ length: metadata.length }, (_, i) => slots[String(i)]).some(slot => !slot || !Object.hasOwn(slot, "value"))) invalid();
  const refs = Object.freeze(Array.from({ length: metadata.length }, (_, index) => { const ref = slots[String(index)]!.value as Readonly<OwnerCurrentVideoReferenceMetadata>; plain(ref); if (ref.kind !== "image" || ref.role !== "image" ||
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(ref.mime_type) || !Number.isSafeInteger(ref.size) || ref.size < 1 || ref.size > 26_214_400 ||
      !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) || !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width! < 1 || ref.height! < 1 ||
      ref.width! > 8400 || ref.height! > 8400 || ref.width! * ref.height! > 52_500_000) invalid(); return Object.freeze({ ...ref }); }));
  const settings = Object.freeze({ model_type: model, gen_type: normalized.mode, quality: normalized.quality, video_duration: normalized.video_duration, aspect_ratio: normalized.aspect_ratio });
  const description: OwnerCurrentVideoIntentDescription = Object.freeze({ model_id: model, mode: normalized.mode, ai_name: "luma", prompt: normalized.prompt,
    settings, cost_parameters: Object.freeze({ quality: normalized.quality, video_duration: normalized.video_duration }), reference_metadata: refs,
    reference_prompt_mode: "ENABLED_ALIASES", intent_fingerprint: schemaHash({ source_profile_sha256: sourceHash, prompt: normalized.prompt, settings, references: refs }),
    source_profile_sha256: sourceHash, source_pins: pins });
  const token = Object.freeze({}) as OwnerLumaCurrentIntent; intents.set(token, description); return token;
}
export function inspectOwnerLumaCurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null { return value && typeof value === "object" && !types.isProxy(value) ? intents.get(value) ?? null : null; }
const definition: OwnerCurrentVideoFamilyDefinition<OwnerLumaCurrentNormalizedInput, OwnerLumaCurrentIntent> = Object.freeze({ model_ids: Object.freeze([model]), source_profile_sha256: sourceHash,
  source_pins: pins, normalize: normalizeOwnerLumaCurrentInput, compile: compileOwnerLumaCurrentIntent, inspect: inspectOwnerLumaCurrentIntent });
export function getOwnerLumaCurrentFamilyDefinition() { return definition; }
function plain(value: unknown) { if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
  Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key => typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) invalid(); }
function invalid(): never { throw new Error("OWNER_LUMA_CURRENT_INTENT_INVALID"); }

function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
