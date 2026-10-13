import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import {
  analyzeMaplessMediaRequestClosure,
  type PinnedMediaRequestSource
} from "../tools/mapless-media-request-closure.js";

const sha = (text: string): string => `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`;

function source(moduleName: string, text: string): PinnedMediaRequestSource {
  return {
    module_name: moduleName,
    url: `https://syntx.ai/assets/1791445568/${moduleName}`,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha(text),
    text
  };
}

function input(overrides: Partial<Record<string, string>> = {}) {
  const texts: Record<string, string> = {
    "settings3.js": `const setDefault=(incoming,fallback)=>incoming?incoming:fallback; const setSettingsByModel=(model)=>Object.keys(model.settings).forEach((key)=>{switch(key){case "aspect_ratio":setAspectRatio(model.settings[key]);break;case "files_mention":setFileMentions(model.settings[key]);}}); export {setDefault as d,setSettingsByModel as s};`,
    "mediaParams.js": `const makeParams=(settings)=>Object.keys(settings).map((key)=>({name:key})); export {makeParams as b};`,
    "index6.js": `const sendImage=(store)=>sender.sendMessage("chat", "banana", "prompt", store.session, store.customSettingPayload ? {...store.customSettingPayload} : undefined);`,
    "index7.js": `const makeVideoSettings=(store)=>store.customSettingPayload?{...store.customSettingPayload}:{...store.settings}; const sendVideo=(store)=>sender.sendMessage("chat", "seedance", "prompt", store.session, makeVideoSettings(store));`,
    "video.js": `async function image(chat,ai,prompt,attachments,custom){let settings={n:1,...store.settings};settings={...custom};settings.file_urls=attachments;const body={chat_uuid:chat,prompt,settings};return api.post("design/generate",body,{params:{ai_name:ai}})} async function video(chat,ai,prompt,attachments,settingsInput){const body={chat_id:chat,prompt,settings:{...settingsInput}};body.settings.file_urls=attachments;return api.post("video/generate",body,{params:{ai_name:ai}})}`,
    "form-a.js": `import {u as factory} from "./settings3.js"; const settings=factory("image","banana",{});`,
    "form-b.js": `import {u as f} from "./settings3.js"; const settings=f("video","seedance",{});`
  };
  Object.assign(texts, overrides);
  const sources = Object.entries(texts).map(([name, text]) => source(name, text)).map((item) => item.module_name === "video.js"
    ? { ...item, capture_status: "NEWLY_PINNED_BOUNDED_GET" as const, first_fetched_at: "2026-10-08T19:09:40.343Z" }
    : item);
  const forms = [
    { form_id: "form-a", module_name: "form-a.js", javascript: { url: sources.find((s) => s.module_name === "form-a.js")!.url, bytes: sources.find((s) => s.module_name === "form-a.js")!.bytes, sha256: sources.find((s) => s.module_name === "form-a.js")!.sha256, parse_diagnostics: 0, model_value_settings_keys: ["aspect_ratio"], static_setting_defaults: {} } },
    { form_id: "form-b", module_name: "form-b.js", javascript: { url: sources.find((s) => s.module_name === "form-b.js")!.url, bytes: sources.find((s) => s.module_name === "form-b.js")!.bytes, sha256: sources.find((s) => s.module_name === "form-b.js")!.sha256, parse_diagnostics: 0, model_value_settings_keys: ["duration"], static_setting_defaults: {} } }
  ];
  const models = [
    { model_id: "banana-test", ai_name: "banana", active: true, default: true, public_type_label: "image", form_id: "form-a", form_binding_status: "STRUCTURAL_MATCH", settings_status: "UNKNOWN", settings: null, model_value_settings_keys: ["aspect_ratio"], generic_setting_keys: [], payload_field_keys: [], enum_constraints: {}, defaults_status: "UNKNOWN", static_setting_defaults: {}, unknown_reasons: [], runtime_usable: false },
    { model_id: "seedance-test", ai_name: "seedance", active: true, default: true, public_type_label: "video", form_id: "form-b", form_binding_status: "STRUCTURAL_MATCH", settings_status: "UNKNOWN", settings: null, model_value_settings_keys: ["duration"], generic_setting_keys: [], payload_field_keys: [], enum_constraints: {}, defaults_status: "UNKNOWN", static_setting_defaults: {}, unknown_reasons: [], runtime_usable: false }
  ];
  return {
    inventory: ({ schema_version: "2.1.0", catalog_kind: "MAPLESS_FRONTEND_SETTINGS_INVENTORY", evidence_level: "STATIC_PUBLIC_API_AND_COMPILED_JS", runtime_usable: false, generated_at: "2026-10-08T13:31:46.244Z", build: { id: "1791445568", base_url: "https://syntx.ai/assets/1791445568/" }, public_catalog: { version: `sha256-${"a".repeat(64)}.json`, fetched_at: "2026-10-08T13:18:39.393Z", models_sha256: `sha256:${"a".repeat(64)}` }, homepage_sha256: `sha256:${"b".repeat(64)}`, app_sha256: `sha256:${"c".repeat(64)}`, registry: { url: "https://syntx.ai/assets/1791445568/index.js", bytes: 1, sha256: `sha256:${"d".repeat(64)}` }, framework: { settings3: { url: sources.find((s) => s.module_name === "settings3.js")!.url, bytes: sources.find((s) => s.module_name === "settings3.js")!.bytes, sha256: sources.find((s) => s.module_name === "settings3.js")!.sha256, generic_setting_keys: [] }, useSettingsParams: { url: sources.find((s) => s.module_name === "mediaParams.js")!.url, bytes: sources.find((s) => s.module_name === "mediaParams.js")!.bytes, sha256: sources.find((s) => s.module_name === "mediaParams.js")!.sha256, payload_field_keys: [] } }, forms, models, summary: { total_models: 2, structurally_mapped_models: 2, unknown_form_models: 0, models_with_public_settings: 0, models_without_public_settings: 2 }, limitations: [] } as unknown as MaplessSettingsInventory),
    settings_version: `sha256-${"a".repeat(64)}.json`,
    sources
  };
}

describe("mapless media request closure", () => {
  it("distinguishes image replacement from video store/custom spread and maps source callers to models", () => {
    const result = analyzeMaplessMediaRequestClosure(input());
    assert.deepEqual(result.operations.map((operation) => [operation.route, operation.settings_source]), [
      ["design/generate", "FIFTH_ARGUMENT_REPLACES_INITIAL_STORE_SPREAD"],
      ["video/generate", "FIFTH_ARGUMENT_OBJECT_SPREAD"]
    ]);
    assert.equal(result.operations[0]?.route_argument_source, "APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED");
    assert.equal(result.operations[0]?.settings_overwrite_guard, "UNCONDITIONAL");
    assert.equal(result.operations[0]?.settings_input_parameter_index, 4);
    assert.equal(result.operations[0]?.route_argument_index, 4);
    assert.equal(result.custom_payload_producer_status, "NO_CALLS_OBSERVED");
    assert.equal(result.sources.find((item) => item.module_name === "video.js")?.capture_status, "NEWLY_PINNED_BOUNDED_GET");
    assert.ok(result.operations[0]?.unresolved_reasons.includes("IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN"));
    assert.deepEqual(result.form_factory_calls.map((form) => [form.form_id, form.active_model_ids, form.status]), [
      ["form-a", ["banana-test"], "EXACTLY_ONE_FACTORY_CALL"],
      ["form-b", ["seedance-test"], "EXACTLY_ONE_FACTORY_CALL"]
    ]);
    assert.equal(result.runtime_usable, false);
  });

  it("records truthy fallback semantics but rejects unknown setter mappings instead of claiming payload constraints", () => {
    const dirty = input({ "settings3.js": `const setDefault=(incoming,fallback)=>incoming??fallback; const setSettingsByModel=(model)=>Object.keys(model.settings).forEach((key)=>setDynamic(model.settings[key]));` });
    const result = analyzeMaplessMediaRequestClosure(dirty);
    assert.equal(result.default_semantics.policy, "NULLISH_FALLBACK");
    assert.deepEqual(result.setter_mappings, []);
    assert.ok(result.blockers.includes("SETTER_KEY_TO_CALL_MAPPING_NOT_PROVEN"));
  });

  it("preserves guarded settings replacement rather than flattening it into an unconditional overwrite", () => {
    const guarded = input({ "video.js": `async function image(chat,ai,prompt,attachments,custom){let settings={n:1,...store.settings};if(custom)settings={...custom};settings.file_urls=attachments;const body={chat_uuid:chat,prompt,settings};return api.post("design/generate",body,{params:{ai_name:ai}})} async function video(chat,ai,prompt,attachments,settingsInput){const body={chat_id:chat,prompt,settings:{...settingsInput}};body.settings.file_urls=attachments;return api.post("video/generate",body,{params:{ai_name:ai}})}` });
    const result = analyzeMaplessMediaRequestClosure(guarded);
    assert.equal(result.operations[0]?.settings_overwrite_guard, "CONDITIONAL");
  });

  it("recognizes a short-circuit guard around the image settings replacement", () => {
    const guarded = input({ "video.js": `async function image(chat,ai,prompt,attachments,custom){let settings={n:1,...store.settings};custom&&(settings={...custom});settings.file_urls=attachments;const body={chat_uuid:chat,prompt,settings};return api.post("design/generate",body,{params:{ai_name:ai}})} async function video(chat,ai,prompt,attachments,settingsInput){const body={chat_id:chat,prompt,settings:{...settingsInput}};body.settings.file_urls=attachments;return api.post("video/generate",body,{params:{ai_name:ai}})}` });
    const result = analyzeMaplessMediaRequestClosure(guarded);
    assert.equal(result.operations.find((operation) => operation.route === "design/generate")?.settings_overwrite_guard, "CONDITIONAL");
  });

  it("fails closed on source hash mismatch and wrong form-module binding", () => {
    const bundle = input();
    const badHash = bundle.sources.map((item) => item.module_name === "video.js" ? { ...item, sha256: `sha256:${"0".repeat(64)}` } : item);
    assert.throws(() => analyzeMaplessMediaRequestClosure({ ...bundle, sources: badHash }), /SOURCE_HASH_MISMATCH/u);

    const wrongModule = input({ "form-a.js": `import {u as factory} from "./settings3.js"; const settings=factory("video","seedance",{});` });
    const result = analyzeMaplessMediaRequestClosure(wrongModule);
    assert.equal(result.form_factory_calls[0]?.status, "CALLER_DOES_NOT_MATCH_INVENTORY_FORM");
  });
});
