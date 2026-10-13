import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { analyzePinnedStaticFormControlSource } from "../tools/static-form-control-extractor.js";

function pinnedSource(source: string, model_value_settings_keys?: string[]) {
  return {
    form_id: "seedance",
    module_name: "seedance2.js",
    url: "https://syntx.ai/assets/1791445568/seedance2.js",
    bytes: Buffer.byteLength(source, "utf8"),
    sha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`,
    model_value_settings_keys
  };
}

test("pinned form AST binds controls to literal enums, numeric widgets and conditional guards", () => {
  const source = [
    "import { remoteOptions } from './shared.js';",
    "const aspectOptions=[{label:'Portrait',value:'9:16'},{label:'Wide',value:'16:9'}];",
    "const ratioControl={modelValue:state.settings.aspect_ratio,component:'el-select',options:aspectOptions,defaultValue:'1:1'};",
    "const durationControl={modelValue:state.settings.video_duration,component:'el-input-number',min:2,max:15,step:1};",
    "if(state.settings.model_type==='seedance-2.0'){const audioControl={modelValue:state.settings.generate_audio,component:'el-switch'};}",
    "const importedControl={modelValue:state.settings.resolution,component:'el-select',options:remoteOptions};",
    "const guardedControl=state.settings.model_type==='seedance-2.0'?{modelValue:state.settings.mode,options:['fast','quality']}:null;",
    "watch(()=>state.settings.video_duration,(next)=>{state.settings.video_duration=normalize(next);});"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  const ratio = analysis.controls.find((control) => control.field === "aspect_ratio");
  assert.ok(ratio);
  assert.equal(ratio.value_type, "string");
  assert.deepEqual(ratio.option_values.map((option) => option.value), ["9:16", "16:9"]);
  assert.equal(ratio.literal_default.value, "1:1");
  const duration = analysis.controls.find((control) => control.field === "video_duration");
  assert.ok(duration);
  assert.equal(duration.value_type, "number");
  assert.deepEqual(duration.numeric_constraints, { minimum: 2, maximum: 15, step: 1 });
  const audio = analysis.controls.find((control) => control.field === "generate_audio");
  assert.ok(audio);
  assert.equal(audio.value_type, "boolean");
  assert.equal(audio.conditions.length, 1);
  assert.equal(audio.conditions[0]?.field, "model_type");
  assert.equal(audio.conditions[0]?.value, "seedance-2.0");
  assert.equal(audio.conditions[0]?.evaluated, false);
  const resolution = analysis.controls.find((control) => control.field === "resolution");
  assert.ok(resolution);
  assert.equal(resolution.options_status, "UNRESOLVED_LOCAL_IMPORT");
  assert.deepEqual(resolution.option_import_refs, ["./shared.js"]);
  const guarded = analysis.controls.find((control) => control.field === "mode");
  assert.ok(guarded);
  assert.equal(guarded.conditions[0]?.field, "model_type");
  assert.equal(guarded.conditions[0]?.evaluated, false);
  assert.equal(analysis.watch_effects.length, 1);
  assert.deepEqual(analysis.watch_effects[0]?.written_fields, ["video_duration"]);
  assert.equal(analysis.source_sha256, pinnedSource(source).sha256);
});

test("compiled VNode props retain their helper, component import alias and props argument position", () => {
  const source = [
    "import { h as vNode } from 'vue';",
    "import SelectBox from './widgets.js';",
    "const view=vNode(SelectBox,{modelValue:state.settings.aspect_ratio,ratios:['9:16','16:9']},null,8,[]);"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  const ratio = analysis.controls.find((control) => control.field === "aspect_ratio");
  assert.ok(ratio);
  assert.ok("source_context" in ratio, "analysis should retain VNode structure alongside the field binding");
  const context = ratio.source_context as {
    render_helper: string | null;
    component_local_name: string | null;
    component_import: { specifier: string; imported_name: string; local_name: string } | null;
    render_helper_import: { specifier: string; imported_name: string; local_name: string } | null;
    component_resolver_import: { specifier: string; imported_name: string; local_name: string } | null;
    props_argument_index: number | null;
    sibling_property_names: string[];
  };
  assert.equal(context.render_helper, "vNode");
  assert.equal(context.component_local_name, "SelectBox");
  assert.deepEqual(context.component_import, {
    specifier: "./widgets.js", imported_name: "default", local_name: "SelectBox"
  });
  assert.deepEqual(context.render_helper_import, {
    specifier: "vue", imported_name: "h", local_name: "vNode"
  });
  assert.deepEqual(context.component_resolver_import, null);
  assert.equal(context.props_argument_index, 1);
  assert.deepEqual(context.sibling_property_names, ["modelValue", "ratios"]);
});

test("minified local constants resolve within lexical scope instead of name-colliding across functions", () => {
  const source = [
    "function first(){const K=['9:16'];return h(Select,{modelValue:state.settings.aspect_ratio,ratios:K});}",
    "function second(){const K=['16:9'];return h(Select,{modelValue:state.settings.aspect_ratio,ratios:K});}"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  const ratios = analysis.controls.filter((control) => control.field === "aspect_ratio");
  assert.equal(ratios.length, 2);
  assert.deepEqual(ratios.map((control) => control.option_values.map((option) => option.value)), [["9:16"], ["16:9"]]);
});

test("dynamic display labels do not suppress proven option values, including null values", () => {
  const source = [
    "const K=[{ratio:t('localized'),value:null},{ratio:'Portrait',value:'9:16'}];",
    "const control={modelValue:state.settings.aspect_ratio,ratios:K};"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  const ratio = analysis.controls.find((control) => control.field === "aspect_ratio");
  assert.ok(ratio);
  assert.equal(ratio.options_status, "STATIC_LOCAL_CONSTANT");
  assert.equal(ratio.value_type, "string");
  assert.deepEqual(ratio.option_values, [
    { value: null, label: null },
    { value: "9:16", label: "Portrait" }
  ]);
});

test("direct computed getters bind the field and model_type guards retain comparable literals", () => {
  const source = [
    "const modelKind=computed(()=>state.settings.model_type);",
    "const durationRef=computed({get:()=>state.settings.video_duration});",
    "if(modelKind.value==='model-a'){const modeControl={modelValue:state.settings.mode,options:['fast','quality']};}",
    "const durationControl={modelValue:durationRef.value,component:'el-input-number',min:2,max:15};"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(
    pinnedSource(source, ["model_type", "mode", "video_duration"]), source
  );
  const mode = analysis.controls.find((control) => control.field === "mode");
  assert.ok(mode);
  assert.equal(mode.conditions[0]?.field, "model_type");
  assert.equal(mode.conditions[0]?.value, "model-a");
  assert.equal(mode.conditions[0]?.evaluated, false);
  const duration = analysis.controls.find((control) => control.field === "video_duration");
  assert.ok(duration);
  assert.equal(duration.source_context.setting_binding_kind, "COMPUTED_GETTER");
  assert.equal(duration.value_type, "number");
  assert.deepEqual(duration.numeric_constraints, { minimum: 2, maximum: 15 });
});

test("VNode child options retain literal value fields even when labels are dynamic", () => {
  const source = [
    "import {h, resolveComponent as _resolveComponent} from 'vue';",
    "const select=_resolveComponent('el-select');",
    "const option=_resolveComponent('el-option');",
    "function render(){return h(select,{modelValue:state.settings.mode},null,8,[",
    "h(option,{value:'fast'},'Fast'),",
    "h(option,{value:'quality'},translate('quality'))",
    "]);}"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source, ["mode"]), source);
  const mode = analysis.controls.find((control) => control.field === "mode");
  assert.ok(mode);
  assert.equal(mode.options_status, "STATIC_VNODE_CHILDREN");
  assert.deepEqual(mode.option_values.map((option) => option.value), ["fast", "quality"]);
  assert.equal(mode.option_children.length, 2);
  assert.deepEqual(mode.option_children.map((child) => child.resolved_component_name), ["el-option", "el-option"]);
  assert.ok(mode.option_children.every((child) =>
    child.component_resolver_import?.specifier === "vue" &&
    child.component_resolver_import.imported_name === "resolveComponent"
  ));
  assert.ok(mode.option_children.every((child) => child.value_status === "STATIC_LITERAL"));
});

test("a hash-pinned form with no recognized controls is explicitly unresolved", () => {
  const source = "const config={settings:model.settings};";
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  assert.equal(analysis.control_structure_status, "UNRESOLVED_STRUCTURE");
  assert.deepEqual(analysis.controls, []);
  assert.ok(analysis.blockers.includes("NO_STATIC_MODEL_VALUE_CONTROL_FOUND"));
});

test("settings3.u factory identity and UI fields are recorded separately from wire claims", () => {
  const source = [
    "import {u as settingsStore} from './settings3.js';",
    "import {C as appContext} from './app.js';",
    "const {setSettingsByModel,setDefault}=settingsStore('image','flux',{cfg:3,resolution:'1024x1024',enhance_prompt:!0,model_type:chooseModel()},()=>{});",
    "const cfgControl={modelValue:appContext(model).settings.cfg,component:'el-slider',min:1,max:4,step:0.1};"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  assert.ok("settings3_store_binding" in analysis);
  const store = analysis.settings3_store_binding as {
    status: string;
    operation_modality: string | null;
    ai_name: string | null;
    settings_root_status: string;
    returned_methods: { method_name: string; local_name: string }[];
    initial_factory_fallbacks: { field: string; value_status: string; value: unknown }[];
  };
  assert.equal(store.status, "SETTINGS3_U_STORE_BOUND");
  assert.equal(store.operation_modality, "image");
  assert.equal(store.ai_name, "flux");
  assert.equal(store.settings_root_status, "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED");
  assert.deepEqual(store.returned_methods.map((row) => row.method_name).sort(), ["setDefault", "setSettingsByModel"]);
  assert.ok(store.initial_factory_fallbacks.some((row) => row.field === "cfg" && row.value === 3));
  assert.ok(store.initial_factory_fallbacks.some((row) => row.field === "enhance_prompt" && row.value === true));
  const cfg = analysis.controls.find((control) => control.field === "cfg");
  assert.ok(cfg);
  assert.equal(cfg.source_context.setting_binding_kind, "DIRECT_COMPONENT_CONTEXT_SETTINGS_PROPERTY");
  assert.equal(cfg.source_context.settings_context_evidence.status, "IMPORTED_COMPONENT_HELPER_CHAIN");
  assert.equal(cfg.value_type, "number");
  assert.deepEqual(cfg.numeric_prop_facts, {
    minimum: 1, maximum: 4, step: 0.1, caller_value_type_proven: true
  });
});

test("nested slider controls preserve their settings collection source without flattening the field", () => {
  const source = [
    "import {h} from 'vue';",
    "import SliderForm from './SliderForm.js';",
    "const view=h('div',{},settings.motions.map(motion=>h(SliderForm,{modelValue:motion.strength,min:0,max:1,step:0.01})));"
  ].join("\n");
  const analysis = analyzePinnedStaticFormControlSource(pinnedSource(source), source);
  const nested = analysis.unresolved_model_value_controls[0];
  assert.ok(nested);
  assert.equal(nested.collection_source_settings_field, "motions");
  assert.deepEqual(nested.nested_property_path, ["strength"]);
  assert.deepEqual(nested.numeric_props.map((prop) => [prop.name, prop.value]), [
    ["min", 0], ["max", 1], ["step", 0.01]
  ]);
  assert.equal(nested.reason, "NON_SETTINGS_UI_CONTROL");
});
