import { types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerCurrentVideoFamilyDefinition, OwnerCurrentVideoIntentDescription } from "./owner-current-video-generation-service.js";
import type { OwnerCurrentVideoReferenceMetadata } from "./owner-current-video-reference-types.js";

const models = ["veo3", "veo3fast", "veo3fast_r"] as const;
const pins = Object.freeze({ public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json", form_id: "veo-3",
  form_sha256: "sha256:fe7dbe3926f35a3fd55f49f46bbea816ae35228fb59a20b1faf3bd5ea7b280b9" });
export const OWNER_VEO3_CURRENT_SOURCE = deepFreeze({ status: "FORM_SOURCE_REVIEWED", model_ids: models, ai_name: "veo3", source_pins: pins,
  modes: { veo3: ["text", "image"], veo3fast: ["text", "image", "references"], veo3fast_r: ["text", "image", "references"] },
  references: { text: 0, image: [1, 2], references: [1, 3], roles: "GENERIC_IMAGE_SOURCE_ARRAY_ORDER", image_crop_gui: "SUPPLIED_OR_PREPARED_IMAGE_BYTES_SAME_WIRE_ROLE" },
  aspect_ratio: ["16:9", "9:16"], reference_mode_enter_reset: "16:9_INITIAL_RESET_NOT_A_CONTINUOUS_CONSTRAINT; BOTH_OPTIONS_REMAIN_VISIBLE",
  video_duration: [8], upscale: [0, 1, 2], canonical_image_bytes: 20_971_520,
  helpers: { constants: "sha256:a54f65eddc4c933c262d01951998098299ad93051c90938249eba9674b843d2c",
    common_input: "sha256:a5cda2ec36e1f9c2ee43cc0bf3ffc84e4537bc9ae19aa5301d4bf9e238bbd54e" },
  prompt: { minimum_utf16: 8, veo3_source_maximum: 50000, fast_source_zero_maximum: "COMMON_INPUT_UNLIMITED", local_maximum_utf16: 50000,
    fast_local_bound_kind: "OPERATOR_RESOURCE_GUARD_NOT_PROVIDER_LIMIT", file_mentions: false },
  cost: { caller_keys: ["upscale"] }, effective_saved_ui_defaults: "NOT_INFERRED", provider_acceptance: "UNPROVEN_NEW_REFERENCE_TUPLES" } as const);
const sourceHash = schemaHash(OWNER_VEO3_CURRENT_SOURCE);
const schema = z.object({ model_id: z.enum(models), type: z.enum(["text", "image", "references"]), prompt: z.string().max(50000),
  aspect_ratio: z.enum(["16:9", "9:16"]), video_duration: z.literal(8), upscale: z.union([z.literal(0), z.literal(1), z.literal(2)]) }).strict();
export type OwnerVeo3CurrentNormalizedInput = Readonly<z.infer<typeof schema> & { mode: "text" | "image" | "references" }>;
declare const veoIntentBrand: unique symbol;
export interface OwnerVeo3CurrentIntent { readonly [veoIntentBrand]: never; }
const intents = new WeakMap<object, Readonly<OwnerCurrentVideoIntentDescription>>();
export function normalizeOwnerVeo3CurrentInput(value: unknown): OwnerVeo3CurrentNormalizedInput {
  plain(value); const parsed = schema.parse(value), prompt = parsed.prompt.trim();
  if (prompt.length < 8 || /[\uD800-\uDFFF]/u.test(prompt) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt) || parsed.model_id === "veo3" && parsed.type === "references") invalid();
  return Object.freeze({ ...parsed, prompt, mode: parsed.type });
}
export function compileOwnerVeo3CurrentIntent(input: OwnerVeo3CurrentNormalizedInput, metadata: readonly Readonly<OwnerCurrentVideoReferenceMetadata>[]): OwnerVeo3CurrentIntent {
  plain(input); const { mode, ...fields } = input, normalized = normalizeOwnerVeo3CurrentInput(fields);
  if (mode !== normalized.mode || !Array.isArray(metadata) || types.isProxy(metadata) || metadata.length > 3 ||
      normalized.mode === "text" && metadata.length !== 0 || normalized.mode === "image" && (metadata.length < 1 || metadata.length > 2) ||
      normalized.mode === "references" && metadata.length < 1) invalid();
  const slots = Object.getOwnPropertyDescriptors(metadata);
  if (Object.getPrototypeOf(metadata) !== Array.prototype || Reflect.ownKeys(slots).length !== metadata.length + 1 || Array.from({ length: metadata.length }, (_, i) => slots[String(i)]).some(slot => !slot || !Object.hasOwn(slot, "value"))) invalid();
  const refs = Object.freeze(Array.from({ length: metadata.length }, (_, index) => { const ref = slots[String(index)]!.value as Readonly<OwnerCurrentVideoReferenceMetadata>; plain(ref); if (ref.kind !== "image" || ref.role !== "image" ||
      !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(ref.mime_type) || !Number.isSafeInteger(ref.size) || ref.size < 1 || ref.size > 20_971_520 ||
      !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) || !Number.isSafeInteger(ref.width) || !Number.isSafeInteger(ref.height) || ref.width! < 1 || ref.height! < 1 ||
      ref.width! > 8400 || ref.height! > 8400 || ref.width! * ref.height! > 52_500_000) invalid(); return Object.freeze({ ...ref }); }));
  const settings = Object.freeze({ model_type: normalized.model_id, type: normalized.type, aspect_ratio: normalized.aspect_ratio,
    video_duration: 8, upscale: normalized.upscale });
  const description: OwnerCurrentVideoIntentDescription = Object.freeze({ model_id: normalized.model_id, mode: normalized.mode, ai_name: "veo3", prompt: normalized.prompt,
    settings, cost_parameters: Object.freeze({ upscale: normalized.upscale }), reference_metadata: refs, reference_prompt_mode: "DISABLED_LITERAL",
    intent_fingerprint: schemaHash({ source_profile_sha256: sourceHash, prompt: normalized.prompt, settings, references: refs }), source_profile_sha256: sourceHash, source_pins: pins });
  const token = Object.freeze({}) as OwnerVeo3CurrentIntent; intents.set(token, description); return token;
}
export function inspectOwnerVeo3CurrentIntent(value: unknown): Readonly<OwnerCurrentVideoIntentDescription> | null { return value && typeof value === "object" && !types.isProxy(value) ? intents.get(value) ?? null : null; }
const definition: OwnerCurrentVideoFamilyDefinition<OwnerVeo3CurrentNormalizedInput, OwnerVeo3CurrentIntent> = Object.freeze({ model_ids: Object.freeze([...models]), source_profile_sha256: sourceHash,
  source_pins: pins, normalize: normalizeOwnerVeo3CurrentInput, compile: compileOwnerVeo3CurrentIntent, inspect: inspectOwnerVeo3CurrentIntent });
export function getOwnerVeo3CurrentFamilyDefinition() { return definition; }
function plain(value: unknown) { if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null ||
  Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).some(key => typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) invalid(); }
function invalid(): never { throw new Error("OWNER_VEO3_CURRENT_INTENT_INVALID"); }

function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
