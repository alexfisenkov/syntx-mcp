import { OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE } from "./owner-kling-duration-current-source.js";
import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import type { OwnerKlingMediaModelId } from "./owner-kling-media-parameters.js";

export const OWNER_KLING_MEDIA_CURRENT_CONTROLS = Object.freeze({
  manual_duration_source: OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE,
  status: "FORM_SOURCE_REVIEWED", build: 1793890358,
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  form_sha256: "sha256:4763d9a9e3bdb5ee1361363764576e58c31000c15a899f48a21cd4fe84e1b46a",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  elements: Object.freeze({ version: "3.0", image_count: [1, 7], duration: [3, 15], modes: ["standart", "hd", "4K"],
    ratios: ["16:9", "1:1", "9:16"], native_audio: [false, true], multi_shots: [false, true] }),
  o1_i2v: Object.freeze({ version: "OMIT", mode: "hd", image_count: [1, 4], duration: [3, 10], ratios: ["16:9", "1:1", "9:16"], videos: "NOT_IN_CURRENT_UPLOADER_POLICY" }),
  o1_v2v: Object.freeze({ version: "OMIT", mode: "hd", video_count: 1, image_count: [0, 4], duration: "ROUND_TRUSTED_VIDEO_DURATION_3_TO_10", aspect_ratio: "OMIT" }),
  undefined_cost_values: "OMITTED_BY_BUNDLED_AXIOS_DEFAULT_SERIALIZER", provider_acceptance: "UNPROVEN"
});

export type OwnerKlingMediaCurrentParametersInput = Readonly<{
  model_id: OwnerKlingMediaModelId; prompt: string; mode: "standart" | "hd" | "4K";
  version?: "3.0"; aspect_ratio?: "16:9" | "1:1" | "9:16"; video_duration: number;
  native_audio?: boolean; multi_shots?: boolean;
}>;
export interface OwnerKlingMediaCurrentSourceParameters {
  readonly model_type: OwnerKlingMediaModelId; readonly mode: "standart" | "hd" | "4K";
  readonly video_duration: number; readonly version?: "3.0"; readonly aspect_ratio?: "16:9" | "1:1" | "9:16";
  readonly native_audio?: boolean; readonly multi_shots?: boolean;
}
export function ownerKlingMediaCurrentProfileHash(legacyHash: string): string {
  return schemaHash({ legacy_profile_sha256: legacyHash, current_controls: OWNER_KLING_MEDIA_CURRENT_CONTROLS });
}

export function normalizeOwnerKlingMediaCurrentParameters(value: unknown, legacyHash: string) {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalid();
  const proto = Object.getPrototypeOf(value), d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  if (![Object.prototype, null].includes(proto) || keys.some(key => typeof key !== "string" || !d[key]!.enumerable || !("value" in d[key]!))) invalid();
  const input = Object.fromEntries(Object.entries(d).map(([key, descriptor]) => [key, descriptor.value]));
  const model = input.model_id;
  if (!["kling_elements", "kling_o1_image2video", "kling_o1_video2video"].includes(model) ||
    typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 1000 || /\p{Cs}/u.test(input.prompt) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.prompt)) invalid();
  const expected = ["model_id", "prompt", "mode", "video_duration",
    ...(model === "kling_elements" ? ["version", "aspect_ratio", "native_audio", "multi_shots"] : model === "kling_o1_image2video" ? ["aspect_ratio"] : [])];
  if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(input, key)) ||
    (typeof input.video_duration !== "number" || !Number.isFinite(input.video_duration) || (model === "kling_o1_video2video" && !Number.isSafeInteger(input.video_duration))) || input.video_duration < 3 || input.video_duration > (model === "kling_elements" ? 15 : 10)) invalid();
  if (model === "kling_elements" ? input.version !== "3.0" || !["standart", "hd", "4K"].includes(input.mode) ||
      typeof input.native_audio !== "boolean" || typeof input.multi_shots !== "boolean" : input.mode !== "hd") invalid();
  if (model !== "kling_o1_video2video" && !["16:9", "1:1", "9:16"].includes(input.aspect_ratio)) invalid();
  const intent = Object.freeze(input) as OwnerKlingMediaCurrentParametersInput;
  const settings: OwnerKlingMediaCurrentSourceParameters = Object.freeze({ model_type: model as OwnerKlingMediaModelId,
    mode: intent.mode, video_duration: intent.video_duration, native_audio: model === "kling_elements" ? intent.native_audio! : false,
    ...(model === "kling_elements" ? { version: "3.0" as const, native_audio: intent.native_audio!, multi_shots: intent.multi_shots! } : {}),
    ...(model === "kling_o1_video2video" ? {} : { aspect_ratio: intent.aspect_ratio! }) });
  return Object.freeze({ status: "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" as const, intent, source_parameters: settings,
    source_profile_sha256: ownerKlingMediaCurrentProfileHash(legacyHash),
    current_source_controls: OWNER_KLING_MEDIA_CURRENT_CONTROLS,
    cost_query_keys: Object.freeze(model === "kling_elements" ? ["version", "mode", "video_duration", "native_audio"] : ["mode", "video_duration"]),
    prompt_limit_confidence: "CONSERVATIVE_LOCAL_BOUND_NOT_PROVIDER_LIMIT" as const, prompt_maximum_utf16_length: 1000 as const,
    dispatch_allowed: false as const, upload_authority: false as const, backend_acceptance: "UNPROVEN" as const });
}

function invalid(): never { throw new Error("INVALID_KLING_CURRENT_PARAMETERS"); }
