import { types } from "node:util";
import { schemaHash } from "../domain/generation-contract.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";

export const OWNER_WAN25_T2V_MODEL_ID = "wan_25_t2v_preview" as const;
export const OWNER_WAN25_T2V_CATALOG_VERSION = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json" as const;
const RESOLUTIONS = ["480P", "720P", "1080P"] as const;
const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type OwnerWan25T2vResolution = typeof RESOLUTIONS[number];
export type OwnerWan25T2vAspect = typeof ASPECTS[number];
export interface OwnerWan25T2vParameters {
 readonly model_id: typeof OWNER_WAN25_T2V_MODEL_ID;
 readonly prompt: string;
 readonly resolution: OwnerWan25T2vResolution;
 readonly aspect_ratio: OwnerWan25T2vAspect;
 readonly video_duration: 5 | 10;
 readonly prompt_extend: boolean;
 readonly seed: null;
}
const FACTS = Object.freeze({
 profile_id: "owner-wan25-t2v-explicit-no-media-2309-v1",
 source_build: "1792363638",
 form_sha256: "308d9504b372088774bc543f1527a2b4413d5c8db078e00755088065b735bd8a",
 sender_sha256: "3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
 settings_sha256: "7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
 cost2_sha256: "3d9bb6b5fb2ee26c8cc61251777fa3bad121a7a5754150fdcfd2f7062bcbc8fa",
 model_id: OWNER_WAN25_T2V_MODEL_ID, ai_name: "wan_video", scope: "video",
 catalog_version: OWNER_WAN25_T2V_CATALOG_VERSION,
 media_policy: "INITIAL_EXPLICIT_NO_MEDIA_SLICE_NOT_AUDIO_INPUT_SUPPORT",
 seed_policy: "INITIAL_NULL_ONLY_NOT_ALL_SEED_CONTROL_VALUES",
 defaults_confidence: "ALL_FIELDS_EXPLICIT_INITIALIZERS_NOT_EFFECTIVE_DEFAULTS",
 prompt_limit: "CONSERVATIVE_LOCAL_UTF16_1500_PUBLIC_MAXIMUM_PROVIDER_UNIT_UNPROVEN",
 runtime_usable: false, dispatch_allowed: false, backend_acceptance: "UNPROVEN"
} as const);
export const OWNER_WAN25_T2V_PROFILE = Object.freeze({ ...FACTS, source_sha256: schemaHash(FACTS) });
export interface OwnerWan25T2vNormalized {
 readonly intent: Readonly<OwnerWan25T2vParameters>;
 readonly settings: Readonly<{
  model_type: typeof OWNER_WAN25_T2V_MODEL_ID;
  resolution: OwnerWan25T2vResolution; aspect_ratio: OwnerWan25T2vAspect;
  video_duration: 5 | 10; prompt_extend: boolean; seed: null; file_urls: readonly [];
 }>;
 readonly cost_inputs: Readonly<{resolution: OwnerWan25T2vResolution; video_duration: 5 | 10}>;
 readonly intent_fingerprint: string;
 readonly profile_sha256: string;
 readonly dispatch_allowed: false;
 readonly backend_acceptance: "UNPROVEN";
}
export class OwnerWan25T2vParametersError extends Error {
 readonly code = "INVALID_PARAMETERS";
 constructor() { super("WAN 2.5 T2V requires explicit supported parameters."); this.name = "OwnerWan25T2vParametersError"; }
}
export function normalizeOwnerWan25T2vParameters(input: unknown): Readonly<OwnerWan25T2vNormalized> {
 const row = exactRecord(input, ["model_id", "prompt", "resolution", "aspect_ratio", "video_duration", "prompt_extend", "seed"]);
 if (row.model_id !== OWNER_WAN25_T2V_MODEL_ID || typeof row.prompt !== "string" || !row.prompt.trim() ||
     row.prompt.length > 1500 || [...row.prompt].some(c => { const n = c.codePointAt(0)!; return n >= 0xd800 && n <= 0xdfff; }) ||
     !RESOLUTIONS.includes(row.resolution as OwnerWan25T2vResolution) || !ASPECTS.includes(row.aspect_ratio as OwnerWan25T2vAspect) ||
     (row.resolution === "480P" && row.aspect_ratio !== "16:9" && row.aspect_ratio !== "9:16" && row.aspect_ratio !== "1:1") ||
     (row.video_duration !== 5 && row.video_duration !== 10) || typeof row.prompt_extend !== "boolean" || row.seed !== null) invalid();
 const intent = Object.freeze({model_id: OWNER_WAN25_T2V_MODEL_ID, prompt: row.prompt as string,
  resolution: row.resolution as OwnerWan25T2vResolution, aspect_ratio: row.aspect_ratio as OwnerWan25T2vAspect,
  video_duration: row.video_duration as 5 | 10, prompt_extend: row.prompt_extend as boolean, seed: null});
 const settings = Object.freeze({model_type: intent.model_id, resolution: intent.resolution, aspect_ratio: intent.aspect_ratio,
  video_duration: intent.video_duration, prompt_extend: intent.prompt_extend, seed: null, file_urls: Object.freeze([]) as readonly []});
 return Object.freeze({intent,settings,cost_inputs:Object.freeze({resolution:intent.resolution,video_duration:intent.video_duration}),
  intent_fingerprint:schemaHash({intent,profile:OWNER_WAN25_T2V_PROFILE.source_sha256}),
  profile_sha256:OWNER_WAN25_T2V_PROFILE.source_sha256,dispatch_allowed:false,backend_acceptance:"UNPROVEN"});
}
export function loadOwnerWan25T2vRuntimeCatalog(catalogDirectory?: string) {
 const snapshot = loadPublicCatalogVersion(OWNER_WAN25_T2V_CATALOG_VERSION,catalogDirectory);
 const catalog = new DiscoveryCatalogRepository(snapshot), model = catalog.get(OWNER_WAN25_T2V_MODEL_ID);
 const ai = snapshot.ai.find(row => row.value === "wan_video");
 if (!ai?.active || ai.scope !== "video" || !model.active || model.ai_name !== "wan_video" ||
     model.upstream_id !== OWNER_WAN25_T2V_MODEL_ID ||
     JSON.stringify([...(model.settings?.get_cost_params ?? [])].sort()) !== '["resolution","video_duration"]') invalid();
 return Object.freeze({catalog,catalog_version:OWNER_WAN25_T2V_CATALOG_VERSION});
}
function exactRecord(input: unknown, keys: readonly string[]): Record<string,unknown> {
 if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) invalid();
 const proto = Object.getPrototypeOf(input), descriptors = Object.getOwnPropertyDescriptors(input);
 if ((proto !== Object.prototype && proto !== null) || Reflect.ownKeys(descriptors).length !== keys.length ||
     keys.some(key => !descriptors[key] || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true)) invalid();
 return Object.fromEntries(keys.map(key => [key,descriptors[key]!.value]));
}
function invalid(): never { throw new OwnerWan25T2vParametersError(); }
