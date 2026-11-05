import { isKlingFiniteDuration, OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE } from "./owner-kling-duration-current-source.js";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { createGenerationContractRegistryV2, serializeGenerationContractRegistryV2, type GenerationContractV2Input } from "../domain/generation-contract-v2.js";
import type { OwnerReviewedNoReferenceT2vNormalizedRequest, OwnerReviewedNoReferenceT2vProfile } from "./owner-hailuo01-t2v-profile.js";
import { buildOwnerKlingT2vGenerationContractInput, createOwnerKlingT2vProfile, OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION } from "./owner-kling-t2v-profile.js";

export const KLING_T2V_CURRENT_VARIANT = "kling-text2video-current-explicit-controls-v1" as const;
export const KLING_O1_T2V_CURRENT_VARIANT = "kling-o1-text2video-current-omitted-version-v1" as const;
const PUBLIC_VERSION = "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json" as const;
const TEMPERATURE_VERSIONS = Object.freeze(["2.5", "2.6"] as const);
const VERSIONS = Object.freeze([...TEMPERATURE_VERSIONS, "3.0"] as const);
const SOURCE = Object.freeze({ status: "FORM_SOURCE_REVIEWED", source_build_id: "1793890358", public_version: PUBLIC_VERSION,
  settings_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  form_sha256: "sha256:4763d9a9e3bdb5ee1361363764576e58c31000c15a899f48a21cd4fe84e1b46a",
  sender_sha256: "sha256:b8fab1b729a53f72c815aa88bffca1701db42735d7e57190d9176791263f6684",
  cost_sha256: "sha256:395a9c51d508a20064bd8acd676ab1c8e3535889d28484e3df9679f23d3b59ca",
  slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
  model_id: "kling_text2video", current_selector_versions: Object.freeze(["2.5", "2.6", "3.0", "3.0-turbo"]), versions: VERSIONS, mode_values: Object.freeze(["standart", "hd", "4K"]),
  four_k_requires_version: "3.0", version_2_6_native_audio_requires_mode: "hd",
  temperature: Object.freeze({ versions: TEMPERATURE_VERSIONS, minimum: 0, maximum: 1, slider_step: 0.1, manual_quantization: false }),
  multi_shots: Object.freeze({ version: "3.0", values: Object.freeze([false, true]) }),
  duration: Object.freeze({ old_versions: Object.freeze([5, 10]), version_3_0: Object.freeze({ minimum: 3, maximum: 15, integer: false, manual_duration_source: OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE }) }),
  camera_movement: "NOT_A_T2V_CONTROL_CURRENT_GUARD_IS_I2V_OR_KEYFRAMES_VERSION_1_5_HD",
  defaults: "NO_DEFAULT_INJECTION_EXPLICIT_APPLICABLE_STATE", provider_acceptance: "UNPROVEN", frontend_source_execution: false });

export function getOwnerKlingT2vCurrentControls() { return SOURCE; }

const O1_SOURCE = Object.freeze({ status: "FORM_SOURCE_REVIEWED", source_build_id: SOURCE.source_build_id,
  public_version: PUBLIC_VERSION, form_sha256: SOURCE.form_sha256, sender_sha256: SOURCE.sender_sha256,
  cost_sha256: SOURCE.cost_sha256, model_id: "kling_o1_text2video", version: "OMITTED_BY_MODEL_WATCHER",
  mode: "hd", native_audio: "UI_FIXED_FALSE_NOT_A_CALLER_CONTROL", aspect_ratio: Object.freeze(["16:9", "1:1", "9:16"]),
  video_duration: Object.freeze({ minimum: 3, maximum: 10, manual_duration_source: OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE }), cost_fields: Object.freeze(["mode", "video_duration"]),
  undefined_query_values: "OMITTED_BY_BUNDLED_AXIOS_DEFAULT_SERIALIZER", provider_acceptance: "UNPROVEN" });
export function getOwnerKlingO1T2vCurrentControls() { return O1_SOURCE; }

export function createOwnerKlingO1T2vCurrentProfile(catalogDirectory?: string): OwnerReviewedNoReferenceT2vProfile<typeof O1_SOURCE> {
  const legacy = createOwnerKlingT2vProfile("kling_o1_text2video", catalogDirectory);
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  const catalog = loadSelectedDiscoveryCatalog(PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
  const model = catalog.getModel("kling_o1_text2video");
  if (!model.active || model.ai_name !== "kling" || catalog.source_hashes.models !== "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438" ||
    JSON.stringify(model.settings?.get_cost_params) !== JSON.stringify(["version", "mode", "video_duration"])) throw new Error("KLING_O1_CURRENT_SOURCE_INVALID");
  const build = (reviewedAt: string): GenerationContractV2Input => {
    const old = buildOwnerKlingT2vGenerationContractInput(legacy.catalog, inventory, "kling_o1_text2video", reviewedAt);
    const { version: _oldVersion, ...properties } = old.parameters.properties;
    const { version: _oldWireVersion, ...settings_fields } = old.wire.settings_fields;
    const { version: _oldCostVersion, ...cost_parameter_bindings } = old.cost_parameter_bindings!;
    return { ...old, variant_id: KLING_O1_T2V_CURRENT_VARIANT,
      provenance: { settings_source_sha256: SOURCE.form_sha256, reviewed_at: reviewedAt, references: [
        { kind: "public_catalog", reference: `Current O1 identity joined to ${PUBLIC_VERSION}`, sha256: catalog.source_hashes.models },
        { kind: "frontend_static", reference: "kling.js model watcher clears version, forces hd, preserves explicit aspect/duration and native_audiofalse", sha256: SOURCE.form_sha256 },
        { kind: "frontend_static", reference: "video.js first-submit settings spread", sha256: SOURCE.sender_sha256 },
        { kind: "frontend_static", reference: "cost2.js settings projection; bundled Axios default serializer omits undefined/null query values", sha256: SOURCE.cost_sha256 },
        { kind: "manual_review", reference: "FORM_SOURCE_REVIEWED only; no old version1.6 tuple observation transferred." }
      ] },
      parameters: { ...old.parameters, properties: { ...properties, video_duration: { type: "number", minimum: 3, maximum: 10 } }, required: old.parameters.required.filter(key => key !== "version"),
        conditions: old.parameters.conditions.filter(condition => condition.when.field !== "version"),
        conditional_enums: old.parameters.conditional_enums.filter(rule => rule.field !== "version" && rule.field !== "video_duration").map(rule => ({ ...rule,
          cases: rule.cases.filter(branch => branch.when.field !== "version") })).filter(rule => rule.cases.length > 0) },
      wire: { ...old.wire, settings_fields, fixed_settings: { ...old.wire.fixed_settings, native_audio: false } }, cost_parameter_bindings,
      limits: old.limits
    };
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0", catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes, contracts: [build("2026-11-06T00:00:00.000Z")] });
  const registryVersion = `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
  return Object.freeze({ catalog, registry, registryVersion, source: O1_SOURCE, modelId: "kling_o1_text2video", aiName: "kling", modelType: "kling_o1_text2video",
    operationId: "generate-video", variantId: KLING_O1_T2V_CURRENT_VARIANT, costParameterFields: O1_SOURCE.cost_fields, buildContractInput: build,
    normalizeGenerationInput(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_REQUEST");
      const fields = Object.getOwnPropertyDescriptors(value), required = ["attemptId", "prompt", "mode", "aspect_ratio", "video_duration"];
      if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(fields).length !== required.length || required.some(key =>
        !fields[key]?.enumerable || !("value" in fields[key]!))) throw new Error("INVALID_REQUEST");
      const request = Object.fromEntries(required.map(key => [key, fields[key]!.value]));
      if(!isKlingFiniteDuration(request.video_duration,3,10))throw new Error("INVALID_REQUEST");
      const normalized = legacy.normalizeGenerationInput({...request,video_duration:5});
      const { version: _discarded, ...parameters } = normalized.parameters;
      const { version: _discardedSemantic, ...semanticIntent } = normalized.semanticIntent;
      return Object.freeze({ ...normalized, parameters: Object.freeze({...parameters,video_duration:request.video_duration}), semanticIntent: Object.freeze({...semanticIntent,video_duration:request.video_duration}) });
    }
  });
}

export function createOwnerKlingT2vCurrentProfile(catalogDirectory?: string, manualDuration = false): OwnerReviewedNoReferenceT2vProfile<typeof SOURCE> {
  const legacy = createOwnerKlingT2vProfile("kling_text2video", catalogDirectory);
  const inventory = loadMaplessSettingsInventoryVersion(OWNER_KLING_T2V_SETTINGS_INVENTORY_VERSION, catalogDirectory);
  const catalog = loadSelectedDiscoveryCatalog(PUBLIC_VERSION, catalogDirectory).discoveryCatalog;
  const model = catalog.getModel("kling_text2video");
  if (catalog.source_hashes.models !== "sha256:11f085ad9b0dd97435d6ebece623fa85bce2870e714e876e6fbb041c562fb438" ||
      !model.active || model.ai_name !== "kling" || JSON.stringify(model.settings?.get_cost_params) !==
      JSON.stringify(["version", "mode", "video_duration", "native_audio"])) throw new Error("KLING_T2V_CURRENT_SOURCE_INVALID");
  const build = (reviewedAt: string): GenerationContractV2Input => {
    const old = buildOwnerKlingT2vGenerationContractInput(legacy.catalog, inventory, "kling_text2video", reviewedAt);
    const result: GenerationContractV2Input = { ...old, variant_id: KLING_T2V_CURRENT_VARIANT,
      provenance: { settings_source_sha256: SOURCE.form_sha256, reviewed_at: reviewedAt, references: [
        { kind: "public_catalog", reference: `Current source-only controls joined to ${PUBLIC_VERSION}`, sha256: catalog.source_hashes.models },
        { kind: "frontend_static", reference: "kling.js 1793890358 exact model/version mode, temperature, multi-shot and duration guards", sha256: SOURCE.form_sha256 },
        { kind: "frontend_static", reference: "video.js current first-submit settings spread; no replay observation transferred", sha256: SOURCE.sender_sha256 },
        { kind: "frontend_static", reference: "SliderForm current finite Number-and-clamp manual input", sha256: SOURCE.slider_sha256 },
        { kind: "frontend_static", reference: "cost2.js preserves four declared query fields; extra controls are not cost aliases", sha256: SOURCE.cost_sha256 },
        { kind: "manual_review", reference: "FORM_SOURCE_REVIEWED only; no current provider, rendered UI or billing acceptance." }
      ] },
      parameters: { ...old.parameters,
        properties: { ...old.parameters.properties,
          version: { type: "string", enum: [...VERSIONS] }, mode: { type: "string", enum: ["standart", "hd", "4K"] },
          video_duration: { type: "integer", minimum: 3, maximum: 15 },
          temperature: { type: "number", minimum: 0, maximum: 1 }, multi_shots: { type: "boolean" } },
        conditions: VERSIONS.map(version => ({ when: { field: "version", equals: version },
          require: version === "3.0" ? ["multi_shots"] : ["temperature"], forbid: version === "3.0" ? ["temperature"] : ["multi_shots"] })),
        conditional_enums: [
          { field: "mode", cases: VERSIONS.map(version => ({ when: { field: "version", equals: version },
            allowed_values: version === "3.0" ? ["standart", "hd", "4K"] : ["standart", "hd"] })) },
          { field: "video_duration", cases: VERSIONS.map(version => ({ when: { field: "version", equals: version },
            allowed_values: version === "3.0" ? Array.from({ length: 13 }, (_, i) => i + 3) : [5, 10] })) },
          { field: "native_audio", cases: VERSIONS.map(version => ({ when: { field: "version", equals: version },
            allowed_values: version === "2.6" || version === "3.0" ? [false, true] : [false] })) }
        ] },
      wire: { ...old.wire, settings_fields: { ...old.wire.settings_fields, temperature: "temperature", multi_shots: "multi_shots" } },
      limits: { ...old.limits, max_parameters: 8 }
    };
    if (!manualDuration) return result;
    return { ...result, parameters: { ...result.parameters,
      properties: { ...result.parameters.properties, version: {type:"string",enum:["3.0","3.0-turbo"]},
        video_duration: {type:"number",minimum:3,maximum:15} },
      conditions: [ {when:{field:"version",equals:"3.0"},forbid:["temperature"]},
        {when:{field:"version",equals:"3.0-turbo"},forbid:["multi_shots","temperature"]} ],
      conditional_enums: [ {field:"mode",cases:[{when:{field:"version",equals:"3.0"},allowed_values:["standart","hd","4K"]},
        {when:{field:"version",equals:"3.0-turbo"},allowed_values:["standart","hd"]}]},
        {field:"native_audio",cases:[{when:{field:"version",equals:"3.0"},allowed_values:[false,true]},
        {when:{field:"version",equals:"3.0-turbo"},allowed_values:[false]}]} ] } };
  };
  const registry = createGenerationContractRegistryV2({ schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`, source_hashes: catalog.source_hashes,
    contracts: [build("2026-11-06T00:00:00.000Z")] });
  const registryVersion = `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
  return Object.freeze({ catalog, registry, registryVersion, source: SOURCE, modelId: "kling_text2video", aiName: "kling", modelType: "kling_text2video",
    operationId: "generate-video" as const, variantId: KLING_T2V_CURRENT_VARIANT, costParameterFields: legacy.costParameterFields,
    normalizeGenerationInput: (value: unknown) => manualDuration ? normalizeManual(value, legacy.normalizeGenerationInput) : normalizeCurrent(value, legacy.normalizeGenerationInput), buildContractInput: build });
}

function normalizeCurrent(value: unknown, normalizeLegacy: (value: unknown) => OwnerReviewedNoReferenceT2vNormalizedRequest): OwnerReviewedNoReferenceT2vNormalizedRequest {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw new Error("INVALID_REQUEST");
  const descriptors = Object.getOwnPropertyDescriptors(value), required = ["attemptId", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio"];
  const allowed = [...required, "temperature", "multi_shots"];
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)) || required.some(key => !descriptors[key]) ||
      Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !allowed.includes(key) ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) throw new Error("INVALID_REQUEST");
  const fields = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  if (!(VERSIONS as readonly unknown[]).includes(fields.version) ||
      (fields.mode === "4K" && fields.version !== "3.0") ||
      (fields.version === "2.6" && fields.native_audio === true && fields.mode !== "hd") ||
      (fields.version === "3.0" && (!Number.isInteger(fields.video_duration) || fields.video_duration < 3 || fields.video_duration > 15 ||
        typeof fields.multi_shots !== "boolean" || Object.hasOwn(fields, "temperature"))) ||
      (fields.version !== "3.0" && (typeof fields.temperature !== "number" || !Number.isFinite(fields.temperature) ||
        fields.temperature < 0 || fields.temperature > 1 || Object.hasOwn(fields, "multi_shots")))) throw new Error("INVALID_REQUEST");
  const base = normalizeLegacy(Object.fromEntries(required.map(key => [key, key === "mode" && fields.mode === "4K" ? "hd" : key === "version" && fields.version === "2.5" ? "2.5-turbo" : fields[key]])));
  const projected: Record<string, string | number | boolean> = { ...base.semanticIntent, version: fields.version as string, mode: fields.mode as string };
  if (fields.version === "3.0") projected.multi_shots = fields.multi_shots as boolean;
  else projected.temperature = fields.temperature as number;
  const parameters = Object.freeze(projected);
  return Object.freeze({ attemptId: base.attemptId, prompt: base.prompt, parameters, semanticIntent: parameters });
}

function normalizeManual(value: unknown, legacy: (value:unknown)=>OwnerReviewedNoReferenceT2vNormalizedRequest):OwnerReviewedNoReferenceT2vNormalizedRequest {
  if(!value||typeof value!=="object"||Array.isArray(value)||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error("INVALID_REQUEST");
  const d=Object.getOwnPropertyDescriptors(value), required=["attemptId","prompt","version","mode","aspect_ratio","video_duration","native_audio"];
  if(required.some(k=>!d[k])||Reflect.ownKeys(d).some(k=>typeof k!=="string"||![...required,"multi_shots"].includes(k)||!("value"in d[k]!)||!d[k]!.enumerable))throw new Error("INVALID_REQUEST");
  const f=Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v.value]));
  if(!["3.0","3.0-turbo"].includes(f.version)||!isKlingFiniteDuration(f.video_duration,3,15)||
    (f.version==="3.0-turbo"&&Object.hasOwn(f,"multi_shots"))|| (Object.hasOwn(f,"multi_shots")&&typeof f.multi_shots!=="boolean") ||
    (f.mode==="4K"&&f.version!=="3.0"))throw new Error("INVALID_REQUEST");
  const base=legacy(Object.fromEntries(required.map(k=>[k,k==="video_duration"?5:k==="mode"&&f.mode==="4K"?"hd":f[k]])));
  const parameters=Object.freeze({...base.parameters,video_duration:f.video_duration,mode:f.mode as string,...(Object.hasOwn(f,"multi_shots")?{multi_shots:f.multi_shots}:{})}) as Readonly<Record<string,string|number|boolean>>;
  return Object.freeze({...base,parameters,semanticIntent:parameters});
}
