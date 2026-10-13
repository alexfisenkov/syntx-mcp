import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { analyzeWanFiniteGetterCandidates, buildWanFiniteSourceReferences, decodeWanFiniteSourceText, parseWanFiniteSourceArguments, wanFiniteHasBom, wanFiniteSourceSha256 } from "../tools/wan-finite-getter-candidates-v24.js";

const publicVersion = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const settingsVersion = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";

test("finite local getter values retain explicit null and remain UI-only candidates", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v"],
    source: `function durationOptions(){ return [null,{value:"5s"},{value:"10s"}]; } const field={modelValue:state.settings.video_duration,options:durationOptions(),defaultValue:"5s"};`
  });
  assert.equal(result.runtime_usable, false);
  assert.equal(result.backend_acceptance, false);
  assert.equal(result.controls.length, 1);
  assert.deepEqual(result.controls[0]?.options, { status: "FINITE_SOURCE_CANDIDATE", values: [null, "5s", "10s"], producer: "LOCAL_GETTER_RETURN" });
  assert.deepEqual(result.controls[0]?.ui_default_candidate, { status: "SOURCE_LITERAL_CANDIDATE", value: "5s" });
  assert.equal(result.controls[0]?.backend_default, "UNKNOWN");
});

test("parameter, let, and var shadows block outer finite option constants", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v"],
    source: `const options=[1,2]; function childParam(options){const a={modelValue:s.settings.resolution,options};} function childLet(){let options=dynamic();const b={modelValue:s.settings.video_duration,options};} function childVar(){var options=dynamic();const c={modelValue:s.settings.aspect_ratio,options};}`
  });
  assert.equal(result.controls.length, 3);
  assert.deepEqual(result.controls.map(control => control.options.status), ["UNKNOWN", "UNKNOWN", "UNKNOWN"]);
  assert.ok(result.controls.every(control => control.options.values.length === 0));
});

test("model-dependent local getter emits separate literal candidates for exact model IDs", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v", "wan_26_t2v"],
    source: `function durationOptions(modelType){if(modelType==="wan_27_t2v") return [null,5,10]; return [5];} const field={modelValue:state.settings.video_duration,options:durationOptions(state.settings.model_type)};`
  });
  assert.equal(result.controls.length, 1);
  assert.deepEqual(result.controls[0]?.model_options, [
    { model_id: "wan_27_t2v", status: "FINITE_SOURCE_CANDIDATE", values: [null, 5, 10] },
    { model_id: "wan_26_t2v", status: "FINITE_SOURCE_CANDIDATE", values: [5] }
  ]);
  assert.equal(result.controls[0]?.backend_default, "UNKNOWN");
});

test("child renderList producer contributes finite options without claiming backend acceptance", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v"],
    source: `const durationItems=[{value:5},{value:10}]; const control={modelValue:state.settings.video_duration,children:renderList(durationItems,item=>h("option",{value:item}))};`
  });
  assert.equal(result.controls.length, 1);
  assert.deepEqual(result.controls[0]?.options, { status: "FINITE_SOURCE_CANDIDATE", values: [5, 10], producer: "CHILD_RENDER_LIST" });
  assert.equal(result.backend_acceptance, false);
  assert.equal(result.controls[0]?.backend_default, "UNKNOWN");
});

test("Vue child render-list options are read from the render call sibling to the props object", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v"],
    source: `import {createElementVNode as V,renderList as R} from "vue";const values=["720p","1080p"];const view=V("select",{modelValue:state.settings.resolution},R(values,value=>V("option",{value})));`
  });
  assert.equal(result.controls.length, 1);
  assert.deepEqual(result.controls[0]?.options, { status: "FINITE_SOURCE_CANDIDATE", values: ["720p", "1080p"], producer: "CHILD_RENDER_LIST" });
  assert.equal(result.render_list_candidates.length, 1);
  assert.deepEqual(result.source_diagnostics.field_producers[0]?.render_call, {
    helper: "V",
    helper_import: { specifier: "vue", imported_name: "createElementVNode", local_name: "V" },
    props_argument_index: 1,
    target: { expression_kind: "StringLiteral", name: null, literal: "select", import_binding: null, lexical_binding: null, import_references: [], imported_calls: [] },
    child_arguments: [{
      argument_index: 2,
      expression_kind: "CallExpression",
      top_level_callee: "R",
      import_references: [
        { specifier: "vue", imported_name: "renderList", local_name: "R" },
        { specifier: "vue", imported_name: "createElementVNode", local_name: "V" }
      ],
      child_calls: [
        {
          callee: "R",
          import_binding: { specifier: "vue", imported_name: "renderList", local_name: "R" },
          argument_kinds: ["Identifier", "ArrowFunction"],
          first_argument_literal: null,
          argument_facts: [
            { kind: "Identifier", path: ["values"], literal: null, property_names: [], import_references: [] },
            { kind: "ArrowFunction", path: [], literal: null, property_names: [], import_references: [{ specifier: "vue", imported_name: "createElementVNode", local_name: "V" }] }
          ]
        },
        {
          callee: "V",
          import_binding: { specifier: "vue", imported_name: "createElementVNode", local_name: "V" },
          argument_kinds: ["StringLiteral", "ObjectLiteralExpression"],
          first_argument_literal: "option",
          argument_facts: [
            { kind: "StringLiteral", path: [], literal: "option", property_names: [], import_references: [] },
            { kind: "ObjectLiteralExpression", path: [], literal: null, property_names: ["value"], import_references: [] }
          ]
        }
      ],
      render_list_calls: [{ callee: "R", first_argument_kind: "Identifier", first_argument_path: ["values"], first_argument_binding_kind: "CONST", first_argument_import: null, option_callback_shape: true }]
    }]
  });
});

test("Vue renderList imported under an alias is recognized without executing the helper", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v"],
    source: `import {renderList as R} from "vue"; const values=[1,2]; const control={modelValue:state.settings.video_duration,children:R(values,item=>h("option",{value:item}))};`
  });
  assert.deepEqual(result.controls[0]?.options, { status: "FINITE_SOURCE_CANDIDATE", values: [1, 2], producer: "CHILD_RENDER_LIST" });
  assert.equal(result.render_list_candidates.length, 1);
  assert.deepEqual(result.source_diagnostics.imports_by_module[0]?.bindings, [{ specifier: "vue", imported_name: "renderList", local_name: "R", kind: "NAMED" }]);
  assert.equal(result.source_diagnostics.field_producers[0]?.child_render_list[0]?.callee, "R");
  assert.equal(result.source_diagnostics.field_producers[0]?.child_render_list[0]?.first_argument_binding?.kind, "CONST");
});

test("exported option-map keys remain separate from dynamic parameterized getter results", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: [],
    include_controls: false,
    module_name: "aspectRatioList.js",
    source: `export const ratios={"1:1":["square"],"16:9":["wide"]};export const optionsFor=model=>model==="wide"?["16:9"]:["1:1"];`
  });
  const ratioMap = result.source_diagnostics.module_exports.find(item => item.exported_name === "ratios");
  assert.deepEqual(ratioMap?.object_properties.map(item => [item.name, item.option_status, item.values]), [
    ["1:1", "FINITE_SOURCE_CANDIDATE", ["square"]],
    ["16:9", "FINITE_SOURCE_CANDIDATE", ["wide"]]
  ]);
  const optionsFor = result.source_diagnostics.module_exports.find(item => item.exported_name === "optionsFor");
  assert.equal(optionsFor?.candidate_status, "DYNAMIC");
  assert.equal(optionsFor?.parameters[0], "model");
  assert.ok(optionsFor?.return_facts.every(item => item.candidate_status === "DYNAMIC"));
});

test("conditional source guard is kept per model and unresolved branches do not promote", () => {
  const result = analyzeWanFiniteGetterCandidates({
    model_ids: ["wan_27_t2v", "wan_26_t2v"],
    source: `if(state.settings.model_type==="wan_27_t2v"){const c={modelValue:state.settings.video_duration,options:[5,10]};}`
  });
  assert.deepEqual(result.controls[0]?.model_applicability, [
    { model_id: "wan_27_t2v", status: "SOURCE_GUARD_MATCH" },
    { model_id: "wan_26_t2v", status: "SOURCE_GUARD_NO_MATCH" }
  ]);
  assert.equal(result.controls[0]?.guards[0]?.model_type, "model_type");
  assert.equal(result.controls[0]?.backend_default, "UNKNOWN");
});

test("v24 source gate pins exactly the three current public source identities", () => {
  const inventory = loadMaplessSettingsInventoryVersion(settingsVersion, join(process.cwd(), "catalog"));
  const refs = buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  assert.deepEqual(refs.map(ref => [ref.module_name, ref.url, ref.bytes, ref.sha256]), [
    ["app.js", "https://syntx.ai/assets/1791467421/app.js", null, "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"],
    ["settings3.js", "https://syntx.ai/assets/1791467421/settings3.js", 4123, "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"],
    ["wan-video.js", "https://syntx.ai/assets/1791467421/wan-video.js", 19503, "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119"]
  ]);
  assert.throws(() => parseWanFiniteSourceArguments(["--review"]), /Usage/);
});

test("v24 source hash format preserves prefix and BOM-aware decoded bytes", () => {
  const noBom = Buffer.from("const pinned = true;", "utf8");
  const withBom = Buffer.from("\uFEFFconst pinned = true;", "utf8");
  assert.match(wanFiniteSourceSha256(noBom), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(wanFiniteHasBom(noBom), false);
  assert.equal(wanFiniteHasBom(withBom), true);
  assert.equal(Buffer.byteLength(decodeWanFiniteSourceText(withBom), "utf8"), withBom.length);
  assert.equal(wanFiniteSourceSha256(Buffer.from(decodeWanFiniteSourceText(withBom), "utf8")), wanFiniteSourceSha256(withBom));
  assert.equal(createHash("sha256").update(withBom).digest("hex").length, 64);
});
