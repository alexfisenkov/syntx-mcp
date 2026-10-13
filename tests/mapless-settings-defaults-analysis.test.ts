import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import {
  analyzeMaplessSettingsDefaults,
  type PinnedModuleText
} from "../tools/mapless-settings-defaults-analysis.js";

const inventoryVersion = "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json";

function testInventoryAndSources(): { inventory: ReturnType<typeof loadMaplessSettingsInventoryVersion>; sources: PinnedModuleText[] } {
  const inventory = structuredClone(loadMaplessSettingsInventoryVersion(inventoryVersion, join(process.cwd(), "catalog")));
  const sources: PinnedModuleText[] = [
    {
      moduleName: "app.js",
      text: `function Qr(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e;} const Ywe=()=>({__esModule:true,default:normalize}); const Gwe=Ywe(); const Xwe=Qr(Gwe); export {Xwe as c2};`
    },
    {
      moduleName: "settings3.js",
      text: `import { c2 as d } from "./app.js"; const hook={ setDefault(input){ Object.keys(modelSettings).forEach(key=>{ if(input!==null&&input[key]) state.settings[key]=d(input[key]); else state.settings[key]=d(modelSettings[key]); }); }, setSettingsByModel(value){ const model=getModelByValue(value); Object.keys(model.settings).forEach(key=>{ if(key==="max_prompt_length") setInputMaxLength(model.settings[key]); }); }, checkSettingAvailability(allowed,key,value){ if(allowed.some(item=>item===key)) state.settings[key]=value; } }; function K(c,r,n,o){ return hook; } export {K as u};`
    },
    {
      moduleName: "useSettingsParams.js",
      text: `const fields=["model_type","mode"]; function toPayload(settings){ if(settings.resolution) payload.resolution=settings.resolution; }`
    },
    {
      moduleName: "banana.js",
      text: `import {u as kt} from "./settings3.js"; const defaults={aspect_ratio:"9:16",image_size:"2K",model_type:getDefaultModelByAiName("banana")==null?undefined:selectedModel.value}; kt("image","banana",defaults); const props={modelValue:state.settings.image_size};`
    },
    {
      moduleName: "seedance2.js",
      text: `import {u as gt} from "./settings3.js"; const defaults={model_type:getDefaultModelByAiName("seedance")==null?undefined:selectedModel.value,resolution:"720p",mode:"mini",aspect_ratio:"16:9",video_duration:5,generate_audio:!0,camera_fixed:void 0}; gt("video","seedance",defaults,extra); const props={modelValue:state.settings.model_type}; const ratio={modelValue:state.settings.aspect_ratio}; if(state.settings.model_type==="seedance_pro"){ const x=state.settings.camera_fixed; } if(state.settings.model_type==="seedance-2.0"){ const y=state.settings.video_duration; }`
    }
  ];
  for (const source of sources) {
    const sha256 = `sha256:${createHash("sha256").update(source.text, "utf8").digest("hex")}`;
    const bytes = Buffer.byteLength(source.text, "utf8");
    if (source.moduleName === "app.js") Object.assign(inventory, { app_sha256: sha256 });
    else if (source.moduleName === "settings3.js") Object.assign(inventory.framework.settings3, { sha256, bytes });
    else if (source.moduleName === "useSettingsParams.js") Object.assign(inventory.framework.useSettingsParams, { sha256, bytes });
    else {
      const form = inventory.forms.find((entry) => entry.module_name === source.moduleName);
      assert.ok(form);
      Object.assign(form.javascript, { sha256, bytes });
    }
  }
  return { inventory, sources };
}

test("pinned AST analysis extracts a data-driven fallback, model settings path and model_type conditions", () => {
  const { inventory, sources } = testInventoryAndSources();
  const result = analyzeMaplessSettingsDefaults(inventory, sources);
  assert.equal(result.runtime_usable, false);
  assert.equal(result.sources.length, 5);
  assert.equal(result.normalizer_chain.factory_semantics, "ES_MODULE_DEFAULT_UNWRAP");
  assert.equal(result.normalizer_chain.app_initializer_argument_callee, "Ywe");
  assert.ok(result.normalizer_chain.provider_location !== null);
  assert.equal(result.normalizer_chain.provider_status, "LOCAL_PROVIDER_GRAPH_CAPTURED");
  assert.ok(result.normalizer_chain.provider_graph.some((node) => node.symbol === "Ywe" && node.kind === "ArrowFunction" && node.return_expressions.length === 1));
  const defaultRule = result.generic_rules.find((rule) => rule.id === "settings3.setDefault");
  assert.ok(defaultRule);
  assert.equal(defaultRule.kind, "DYNAMIC_DEFAULT_FALLBACK");
  assert.equal(defaultRule.status, "AST_RULE_EXTRACTED_NOT_EVALUATED");
  assert.equal(defaultRule.source_module, "settings3.js");
  assert.deepEqual(defaultRule.assignment_sources.map((assignment) => assignment.branch).sort(), ["CONDITION_FALSE", "CONDITION_TRUE"]);
  assert.deepEqual(result.generic_setting_fields.includes("max_prompt_length"), true);
  assert.equal(result.form_fallback_defaults.banana.find((entry) => entry.field === "image_size")?.literal_value, "2K");
  assert.ok(result.form_conditions.seedance.some((rule) => rule.condition_field === "model_type" && rule.static_value === "seedance_pro"));
  assert.ok(result.form_conditions.seedance.some((rule) => rule.condition_field === "model_type" && rule.static_value === "seedance-2.0"));
  const banana = result.model_scopes.find((model) => model.model_id === "banana-2.1");
  assert.ok(banana);
  assert.ok(banana.controls_without_api_settings.includes("image_size"));
  assert.equal(banana.setting_defaults_status, "DATA_DRIVEN_FALLBACK_MAP_WITH_DYNAMIC_OVERRIDES");
  assert.equal(banana.form_fallback_defaults.find((entry) => entry.field === "image_size")?.literal_value, "2K");
  assert.equal(banana.form_fallback_defaults.find((entry) => entry.field === "aspect_ratio")?.literal_value, "9:16");
  assert.equal(banana.form_fallback_defaults.find((entry) => entry.field === "model_type")?.default_source, "SELECTED_MODEL_DEFAULT_VALUE");
  const seedance = result.model_scopes.find((model) => model.model_id === "seedance-2.0");
  assert.ok(seedance);
  assert.equal(seedance.form_fallback_defaults.find((entry) => entry.field === "generate_audio")?.literal_value, true);
  assert.equal(seedance.form_fallback_defaults.find((entry) => entry.field === "aspect_ratio")?.literal_value, "16:9");
  assert.equal(seedance.form_fallback_defaults.find((entry) => entry.field === "camera_fixed")?.value_status, "OMITTED");
  assert.equal(seedance.form_fallback_defaults.find((entry) => entry.field === "mode")?.literal_value, "mini");
});

test("pinned AST analysis rejects a hash mismatch before parsing source text", () => {
  const { inventory, sources } = testInventoryAndSources();
  const malformed = sources.map((source) => source.moduleName === "banana.js" ? { ...source, text: "not valid source {{{" } : source);
  assert.throws(() => analyzeMaplessSettingsDefaults(inventory, malformed), /MAPLESS_DEFAULTS_SOURCE_HASH_MISMATCH/);
});
