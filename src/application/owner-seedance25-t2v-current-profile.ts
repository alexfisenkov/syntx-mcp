import { createHash } from "node:crypto";
import { types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { createGenerationContractRegistryV2, serializeGenerationContractRegistryV2, type GenerationContractV2Input } from "../domain/generation-contract-v2.js";
import type { OwnerReviewedNoReferenceT2vNormalizedRequest, OwnerReviewedNoReferenceT2vProfile } from "./owner-hailuo01-t2v-profile.js";
import { buildOwnerSeedance25T2vGenerationContractInput, createOwnerSeedance25T2vProfile } from "./owner-seedance25-t2v-profile.js";

export const SEEDANCE25_CURRENT_VARIANT = "seedance-2.5-omni-no-media-current-controls-v1" as const;
const PUBLIC_VERSION = "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const;
const SOURCE = Object.freeze({ source_build_id: "1793890358", public_version: PUBLIC_VERSION,
  settings_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_sha256: "sha256:383bd2c5f8bd5f8e80cce6ef675f92693585cef502e1a93e59d4d865b8fbd9b6",
  helper_sha256: "sha256:3e9229fe7c238a1e7b95f22d313bc8c6ea3b1612c0c54bb9fa08d406c5711d28",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  cost_sha256: "sha256:395a9c51d508a20064bd8acd676ab1c8e3535889d28484e3df9679f23d3b59ca",
  resolutions: Object.freeze(["480p", "720p", "1080p"]),
  aspect_ratios: Object.freeze(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]),
  duration_seconds: Object.freeze({ minimum: 4, maximum: 30, step: 1, auto_value: 0 }),
  generate_audio: Object.freeze([false, true]), mode: "omni-references", reference_count: 0,
  omitted_input_values: Object.freeze({resolution:"720p",aspect_ratio:"16:9",video_duration:5,generate_audio:true}),
  defaults_scope: "LOCAL_COMPATIBILITY_VALUES_NOT_EFFECTIVE_UI_DEFAULTS", backend_acceptance:"UNPROVEN", rendered_ui:"NOT_CHECKED" });
export function getOwnerSeedance25CurrentControls() { return SOURCE; }

export function createOwnerSeedance25CurrentProfile(catalogDirectory?: string): OwnerReviewedNoReferenceT2vProfile<typeof SOURCE> {
  const old = createOwnerSeedance25T2vProfile(catalogDirectory);
  const catalog = loadSelectedDiscoveryCatalog(PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
  if (catalog.source_hashes.models !== "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438" ||
      catalog.getModel("seedance-2.5").active !== true) throw new Error("SEEDANCE25_CURRENT_SOURCE_INVALID");
  const build = (reviewedAt: string): GenerationContractV2Input => {
    const original = buildOwnerSeedance25T2vGenerationContractInput(old.catalog, reviewedAt);
    return { ...original, variant_id: SEEDANCE25_CURRENT_VARIANT,
      provenance: { settings_source_sha256: SOURCE.form_sha256, reviewed_at: reviewedAt, references: [
        {kind:"public_catalog",reference:`Pinned current public catalog ${PUBLIC_VERSION}`,sha256:catalog.source_hashes.models},
        {kind:"frontend_static",reference:"seedance2.js build 1793890358 model-specific UI options",sha256:SOURCE.form_sha256},
        {kind:"frontend_static",reference:"useEnrichFileMetaWithDuration.js model, mode and range constants",sha256:SOURCE.helper_sha256},
        {kind:"frontend_static",reference:"video.js native sender",sha256:SOURCE.sender_sha256},
        {kind:"frontend_static",reference:"cost2.js cost projection",sha256:SOURCE.cost_sha256},
        {kind:"manual_review",reference:"No-media mode and current control combinations remain provider-unproven."}
      ] }, parameters: { type:"object", additional_properties:false,
        required:["prompt","resolution","aspect_ratio","video_duration","generate_audio","mode"], properties:{
          prompt:{type:"string",min_length:1,max_length:5000}, resolution:{type:"string",enum:[...SOURCE.resolutions]},
          aspect_ratio:{type:"string",enum:[...SOURCE.aspect_ratios]}, video_duration:{type:"integer",enum:[0,...Array.from({length:27},(_,i)=>i+4)]},
          generate_audio:{type:"boolean"}, mode:{type:"string",enum:["omni-references"]}}, conditions:[],conditional_enums:[] } };
  };
  const registry = createGenerationContractRegistryV2({schema_version:"2.0.0", catalog_version:`${catalog.fetched_at}.${catalog.source_hashes.models.slice(7,19)}`,
    source_hashes:catalog.source_hashes,contracts:[build("2026-11-05T00:00:00.000Z")]});
  const version = `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
  return Object.freeze({catalog,registry,registryVersion:version,source:SOURCE,modelId:"seedance-2.5",aiName:"seedance",modelType:"seedance-2.5",
    operationId:"generate-video" as const,variantId:SEEDANCE25_CURRENT_VARIANT,costParameterFields:old.costParameterFields,
    normalizeGenerationInput:normalize,buildContractInput:build});
}

function normalize(value: unknown): OwnerReviewedNoReferenceT2vNormalizedRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_REQUEST");
  const d = Object.getOwnPropertyDescriptors(value), keys = ["attemptId","prompt","resolution","aspect_ratio","video_duration","generate_audio"];
  if (![Object.prototype,null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(d).length !== keys.length ||
      keys.some(k=>!d[k] || !("value" in d[k]!) || !d[k]!.enumerable)) throw new Error("INVALID_REQUEST");
  const q = Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
  if (typeof q.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(q.attemptId) ||
      typeof q.prompt !== "string" || !q.prompt.trim() || q.prompt.length > 5000 || !wellFormed(q.prompt) ||
      !SOURCE.resolutions.includes(q.resolution) || !SOURCE.aspect_ratios.includes(q.aspect_ratio) ||
      !Number.isInteger(q.video_duration) || !(q.video_duration === 0 || q.video_duration >= 4 && q.video_duration <= 30) ||
      typeof q.generate_audio !== "boolean") throw new Error("INVALID_REQUEST");
  const parameters = Object.freeze({prompt:q.prompt,resolution:q.resolution,aspect_ratio:q.aspect_ratio,
    video_duration:q.video_duration,generate_audio:q.generate_audio,mode:"omni-references"});
  return Object.freeze({attemptId:q.attemptId,prompt:q.prompt,parameters,semanticIntent:parameters});
}
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  } return true;
}
