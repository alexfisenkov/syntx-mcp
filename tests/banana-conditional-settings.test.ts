import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "node:test";
import {
  analyzeBananaConditionalSettings,
  bananaConditionalSettingsArtifactSchema,
  type AnalyzeBananaConditionalSettingsInput
} from "../tools/banana-conditional-settings.js";

const modelIds = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"];
const fixtureSource = `import{u as factory}from"./settings3.js";const E={settings:{}};const F={"banana-2.1":["minimal","medium","high"]};const St="medium";const h="banana";factory("image","banana",{});const p=ref(()=>E.settings.model_type==="banana3_light"?"1K":"2K");const k=ref(()=>{switch(E.settings.model_type){case"banana2":case"banana-2.1":return["1K","2K","4K"];case"banana3":return["0.5K","1K","2K","4K"];case"banana3_light":return["1K"];default:return[]}});const d=ref(()=>F[E.settings.model_type]||null);const thinkingDefault=d.value?St:void 0;const modelControl={modelValue:E.settings.model_type};const imageControl=["banana2","banana3","banana3_light","banana-2.1"].includes(E.settings.model_type)?{modelValue:E.settings.image_size,options:k.value,default:p.value}:null;const thinkingControl=d.value?{modelValue:E.settings.thinking_level,options:d.value,default:St}:null;`;
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function fixtureInput(text = fixtureSource): AnalyzeBananaConditionalSettingsInput {
  const hash = sha256(fixtureSource);
  return {
    form_source: {
      module_name: "banana.js",
      url: "https://syntx.ai/assets/1791467421/banana.js",
      bytes: Buffer.byteLength(text, "utf8"),
      sha256: sha256(text),
      text
    },
    expected_source: {
      module_name: "banana.js",
      url: "https://syntx.ai/assets/1791467421/banana.js",
      bytes: Buffer.byteLength(fixtureSource, "utf8"),
      sha256: hash
    },
    public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    settings_inventory_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
    observed_homepage_build_id: "1791467421",
    models: modelIds.map((model_id) => ({ model_id, ai_name: "banana", active: true, form_id: "banana" })),
    form_control_ref: "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-26627f87a943cc9a.json",
    form_control_sha256: "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50",
    existing_ratio_evidence_ref: "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-26627f87a943cc9a.json#/forms/banana/controls/aspect_ratio",
    existing_ratio_evidence_sha256: "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50"
  };
}

it("resolves Banana model-specific UI candidates and rejects stale source bytes", () => {
  const result = analyzeBananaConditionalSettings(fixtureInput()) as {
    runtime_usable: boolean;
    current_ui_status: string;
    model_candidates: Array<{
      model_id: string;
      parameter_schema: { properties: Record<string, { type: string; enum?: readonly string[] }> };
      field_evidence: Record<string, { status: string; allowed_values: readonly string[]; default_candidate: string | null }>;
    }>;
  };
  const byId = new Map(result.model_candidates.map((item) => [item.model_id, item]));
  assert.equal(result.runtime_usable, false);
  assert.equal(result.current_ui_status, "SOURCE_BUILD_MATCHES_HOME_BUILD_NOT_UI_VERIFIED");
  assert.equal(byId.size, 5);
  assert.equal(byId.get("banana")?.field_evidence.image_size?.status, "CONTROL_NOT_RENDERED");
  assert.deepEqual(byId.get("banana-2.1")?.parameter_schema.properties.image_size?.enum, ["1K", "2K", "4K"]);
  assert.equal(byId.get("banana-2.1")?.field_evidence.image_size?.default_candidate, "2K");
  assert.deepEqual(byId.get("banana2")?.field_evidence.image_size?.allowed_values, ["1K", "2K", "4K"]);
  assert.deepEqual(byId.get("banana3")?.field_evidence.image_size?.allowed_values, ["0.5K", "1K", "2K", "4K"]);
  assert.deepEqual(byId.get("banana3_light")?.field_evidence.image_size?.allowed_values, ["1K"]);
  assert.equal(byId.get("banana3_light")?.field_evidence.image_size?.default_candidate, "1K");
  assert.deepEqual(byId.get("banana-2.1")?.parameter_schema.properties.thinking_level?.enum, ["minimal", "medium", "high"]);
  assert.equal(byId.get("banana-2.1")?.field_evidence.thinking_level?.default_candidate, "medium");
  for (const modelId of ["banana", "banana2", "banana3", "banana3_light"]) {
    assert.equal(byId.get(modelId)?.field_evidence.thinking_level?.status, "CONTROL_NOT_RENDERED");
  }
  assert.throws(() => analyzeBananaConditionalSettings(fixtureInput(fixtureSource.replace("St=\"medium\"", "St=\"miniml\""))), /SOURCE_HASH_MISMATCH/u);
});

it("keeps the pinned v19 artifact typed and non-executable", () => {
  const path = resolve(process.cwd(), "catalog/runtime/v19/banana-conditional-settings-v1.0.0.json");
  const artifact = bananaConditionalSettingsArtifactSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(artifact.runtime_usable, false);
  assert.equal(artifact.current_ui_status, "SOURCE_BUILD_MATCHES_HOME_BUILD_NOT_UI_VERIFIED");
  assert.deepEqual(artifact.model_candidates.map((candidate) => candidate.model_id), ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"]);
  assert.equal("enum" in artifact.model_candidates[0]!.parameter_schema.properties.aspect_ratio!, false);
});
