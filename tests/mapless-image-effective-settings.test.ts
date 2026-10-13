import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { maplessMediaRequestClosureSchema, type PinnedMediaRequestSource } from "../tools/mapless-media-request-closure.js";
import { analyzeMaplessImageEffectiveSettings } from "../tools/mapless-image-effective-settings.js";

function pinned(moduleName: string, text: string): PinnedMediaRequestSource {
  return {
    module_name: moduleName,
    url: `https://syntx.ai/assets/1791445568/${moduleName}`,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`,
    text
  };
}

function fixture(bananaText = `const model="banana-2.1";`, videoText = `import {b6 as getStore} from "./app.js"; async function image(chat,ai,prompt,files,payload){const store=getStore();let settings={n:1,...store.settings};payload&&(settings={...payload});settings.file_urls=files;const body={chat_uuid:chat,prompt,settings};return api.post("design/generate",body)}`) {
  const texts = {
    "app.js": `const gn=e=>e&&e.__v_isRef; class XV{constructor(t,n){this.__v_isRef=true;this._rawValue=t;this._value=t}get value(){return this._value}set value(t){this._value=t}} const zD=(e,t)=>gn(e)?e:new XV(e,t); const Y=e=>zD(e,true); function useStore(){const h={customSettingPayload:null};const tt=Y(h.customSettingPayload);const ut=ct=>tt.value=ct;return {customSettingPayload:tt,setCustomSettingPayload:ut,settings:{}}} const b6=()=>useStore(); export {b6};`,
    "index6.js": `const send=(store)=>chat.sendMessage("id","banana","prompt","session",store.customSettingPayload?{...store.customSettingPayload}:undefined);`,
    "video.js": videoText,
    "settings3.js": `export const u=()=>({})`,
    "banana.js": bananaText
  };
  const sources = Object.entries(texts).map(([name, text]) => pinned(name, text));
  const ref = (name: string) => sources.find((source) => source.module_name === name)!;
  const sha = `sha256:${"a".repeat(64)}`;
  const closure = maplessMediaRequestClosureSchema.parse({
    schema_version: "1.0.0", catalog_kind: "MAPLESS_MEDIA_REQUEST_CLOSURE", evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    runtime_usable: false, backend_accepted: false, vendor_code_executed: false, source_persisted: false,
    public_version: `sha256-${"a".repeat(64)}.json`, settings_version: `sha256-${"b".repeat(64)}.json`, build_id: "1791445568",
    sources: sources.map(({ module_name, url, bytes, sha256 }) => ({ module_name, url, bytes, sha256 })),
    default_semantics: { policy: "TRUTHY_FALLBACK", location: { line: 1, column: 1 } }, setter_mappings: [],
    form_factory_calls: [{ form_id: "banana", module_name: "banana.js", active_model_ids: ["banana-2.1"], status: "EXACTLY_ONE_FACTORY_CALL", imported_symbol: "u", local_symbol: "u", call_location: { line: 1, column: 1 }, call_kind: "image", call_ai_name: "banana" }],
    custom_payload_setter_calls: [], custom_payload_producer_status: "NO_CALLS_OBSERVED",
    operations: [
      { method: "POST", route: "design/generate", modality: "IMAGE", body_fields: ["chat_uuid", "prompt", "settings"], settings_source: "FIFTH_ARGUMENT_REPLACES_INITIAL_STORE_SPREAD", settings_overwrite_guard: "UNCONDITIONAL", settings_input_parameter_index: 4, settings_replacement_location: { line: 1, column: 1 }, settings_expression: "settings replaced", route_argument_source: "APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED", route_argument_index: 4, route_argument_location: { line: 1, column: 1 }, file_urls_overwritten_after_settings: true, constructor_location: { line: 1, column: 1 }, dispatch_location: { line: 1, column: 1 }, unresolved_reasons: ["IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN"] },
      { method: "POST", route: "video/generate", modality: "VIDEO", body_fields: ["chat_id", "prompt", "settings"], settings_source: "FIFTH_ARGUMENT_OBJECT_SPREAD", settings_overwrite_guard: "NOT_APPLICABLE", settings_input_parameter_index: 4, settings_replacement_location: { line: 1, column: 1 }, settings_expression: "settings spread", route_argument_source: "NOT_RESOLVED", route_argument_index: null, route_argument_location: null, file_urls_overwritten_after_settings: false, constructor_location: { line: 1, column: 1 }, dispatch_location: { line: 1, column: 1 }, unresolved_reasons: ["BACKEND_ACCEPTANCE_NOT_PROVEN"] }
    ], blockers: [], limitations: []
  });
  return { ref, sources, closure, sha };
}

describe("mapless image effective settings", () => {
  it("traces app custom-payload state to the image request without confusing factory fallback with observed wire settings", () => {
    const data = fixture();
    const result = analyzeMaplessImageEffectiveSettings({
      closure: data.closure,
      sources: data.sources,
      form: {
        form_id: "banana", module_name: "banana.js", source_sha256: data.ref("banana.js").sha256,
        control_artifact_ref: "catalog/runtime/v11/sha256-test-banana.json", control_artifact_sha256: `sha256:${"d".repeat(64)}`,
        control_structure_status: "CONTROLS_FOUND", settings_root_status: "NOT_CHECKED",
        model_ids: ["banana-2.1"],
        controls: [
          { field: "aspect_ratio", value_type: "string", options_status: "STATIC_LOCAL_CONSTANT", option_values: [{ label: "Square", value: "1:1" }, { label: "Portrait", value: "9:16" }], options_nullable: false, conditions: [], location: { line: 1, column: 1 } },
          { field: "image_size", value_type: null, options_status: "DYNAMIC", option_values: [], options_nullable: false, conditions: [{ field: "model_type", operator: "==", value: "banana-2.1", branch: "THEN", evaluated: false, source_location: { line: 1, column: 2 } }], location: { line: 1, column: 2 } }
        ]
      },
      fallback_candidates: [
        { model_id: "banana-2.1", field: "aspect_ratio", value: "9:16", status: "STATIC_FALLBACK_CANDIDATE", application_stage: "FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES", location: { line: 1, column: 3 } },
        { model_id: "banana-2.1", field: "image_size", value: "2K", status: "STATIC_FALLBACK_CANDIDATE", application_stage: "FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES", location: { line: 1, column: 4 } }
      ],
      owner_observation: {
        artifact_ref: "catalog/runtime/v12/owner-observed-banana-2.1-1k-minimal.json",
        artifact_sha256: `sha256:${"c".repeat(64)}`,
        model_id: "banana-2.1",
        public_catalog_sha256: `sha256:${"a".repeat(64)}`,
        settings_inventory_sha256: `sha256:${"b".repeat(64)}`,
        build_id: "1791445568",
        settings: { n: 1, model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", file_urls: [] }
      }
    });
    assert.equal(result.store_chain.initial_value, "NULL");
    assert.equal(result.store_chain.status, "LOCATED_MUTABLE_REF");
    assert.equal(result.target_form_producer_status, "NO_NON_NULL_SETTER_CALL_IN_TARGET_FORM");
    assert.equal(result.effective_settings_status, "OWNER_OBSERVED_PROFILE_ONLY");
    assert.equal(result.supersedes_inference.correction, "V14_MISCLASSIFIED_LOGICAL_AND_SETTINGS_REPLACEMENT_AS_UNCONDITIONAL");
    assert.ok(result.blockers.includes("FORM_CONTROL_SETTINGS_ROOT_NOT_CHECKED"));
    assert.equal(result.route_handoff.settings_overwrite_guard, "CONDITIONAL_LOGICAL_AND_TRUTHY");
    assert.equal(result.route_handoff.base_settings_source, "APP_STORE_SETTINGS");
    assert.equal(result.route_handoff.falsy_override_behavior, "RETAIN_BASE_SETTINGS");
    assert.deepEqual(result.fallback_candidates.map((item) => [item.field, item.value]), [["aspect_ratio", "9:16"], ["image_size", "2K"]]);
    assert.equal(result.owner_observation.settings.image_size, "1K");
    assert.deepEqual(result.form_controls[1]?.conditions[0], { field: "model_type", operator: "==", value: "banana-2.1", branch: "THEN", evaluated: false, source_location: { line: 1, column: 2 } });
    assert.equal(result.runtime_usable, false);
  });

  it("follows a destructured setter alias to a non-null Banana payload write", () => {
    const data = fixture(`const {setCustomSettingPayload: writePayload}=store; writePayload({aspect_ratio:"1:1"});`);
    const result = analyzeMaplessImageEffectiveSettings({
      closure: data.closure,
      sources: data.sources,
      form: { form_id: "banana", module_name: "banana.js", source_sha256: data.ref("banana.js").sha256, control_artifact_ref: "catalog/runtime/v11/sha256-test-banana.json", control_artifact_sha256: `sha256:${"d".repeat(64)}`, control_structure_status: "CONTROLS_FOUND", settings_root_status: "NOT_CHECKED", model_ids: ["banana-2.1"], controls: [] },
      fallback_candidates: [],
      owner_observation: { artifact_ref: "catalog/runtime/v12/owner-observed-banana-2.1-1k-minimal.json", artifact_sha256: `sha256:${"c".repeat(64)}`, model_id: "banana-2.1", public_catalog_sha256: `sha256:${"a".repeat(64)}`, settings_inventory_sha256: `sha256:${"b".repeat(64)}`, build_id: "1791445568", settings: { n: 1, model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", file_urls: [] } }
    });
    assert.equal(result.target_form_producer_status, "SOURCE_CALLER_FOUND");
    assert.ok(result.setter_calls.some((call) => call.module_name === "banana.js" && call.argument_kind === "OBJECT_LITERAL"));
  });

  it("detects a custom-payload write routed through a Pinia patch object", () => {
    const data = fixture(`const model="banana-2.1"; store.$patch({customSettingPayload:{aspect_ratio:"1:1"}});`);
    const result = analyzeMaplessImageEffectiveSettings({
      closure: data.closure,
      sources: data.sources,
      form: { form_id: "banana", module_name: "banana.js", source_sha256: data.ref("banana.js").sha256, control_artifact_ref: "catalog/runtime/v11/sha256-test-banana.json", control_artifact_sha256: `sha256:${"d".repeat(64)}`, control_structure_status: "CONTROLS_FOUND", settings_root_status: "NOT_CHECKED", model_ids: ["banana-2.1"], controls: [] },
      fallback_candidates: [],
      owner_observation: { artifact_ref: "catalog/runtime/v12/owner-observed-banana-2.1-1k-minimal.json", artifact_sha256: `sha256:${"c".repeat(64)}`, model_id: "banana-2.1", public_catalog_sha256: `sha256:${"a".repeat(64)}`, settings_inventory_sha256: `sha256:${"b".repeat(64)}`, build_id: "1791445568", settings: { n: 1, model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", file_urls: [] } }
    });
    assert.equal(result.target_form_producer_status, "SOURCE_CALLER_FOUND");
    assert.equal(result.state_mutation_scan.payload_patch_calls.length, 1);
    assert.equal(result.state_mutation_scan.payload_patch_calls[0]?.module_name, "banana.js");
  });

  it("resolves the app store settings spread through its enclosing image composable", () => {
    const nestedSender = `import {b6 as getStore} from "./app.js"; function useImage(){const store=getStore();return async function send(chat,ai,prompt,files,payload){let settings={n:1,...store.settings};payload&&(settings={...payload});settings.file_urls=files;const body={chat_uuid:chat,prompt,settings};return api.post("design/generate",body)}}`;
    const data = fixture(undefined, nestedSender);
    const result = analyzeMaplessImageEffectiveSettings({
      closure: data.closure,
      sources: data.sources,
      form: { form_id: "banana", module_name: "banana.js", source_sha256: data.ref("banana.js").sha256, control_artifact_ref: "catalog/runtime/v11/sha256-test-banana.json", control_artifact_sha256: `sha256:${"d".repeat(64)}`, control_structure_status: "CONTROLS_FOUND", settings_root_status: "NOT_CHECKED", model_ids: ["banana-2.1"], controls: [] },
      fallback_candidates: [],
      owner_observation: { artifact_ref: "catalog/runtime/v12/owner-observed-banana-2.1-1k-minimal.json", artifact_sha256: `sha256:${"c".repeat(64)}`, model_id: "banana-2.1", public_catalog_sha256: `sha256:${"a".repeat(64)}`, settings_inventory_sha256: `sha256:${"b".repeat(64)}`, build_id: "1791445568", settings: { n: 1, model_type: "banana-2.1", aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal", file_urls: [] } }
    });
    assert.equal(result.route_handoff.base_settings_source, "APP_STORE_SETTINGS");
    assert.equal(result.route_handoff.falsy_override_behavior, "RETAIN_BASE_SETTINGS");
  });
});
