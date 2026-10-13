import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { join } from "node:path";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { buildPinnedWanSourceReferences, decodeWanSourceText, extractWanConditionalControls, hasUtf8Bom, parseWanConditionalSourceArguments, runWanConditionalSourceCandidateCli, sourceSha256 } from "../tools/wan-conditional-source-candidates-v23.js";

const publicVersion = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const settingsVersion = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const sha = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function fixture() {
  const app = `const store = { settings: {} }; export { store };`;
  const settings3 = `import {store} from "./app.js"; export function useSettings(){return store;}`;
  const wan = `import {useSettings as use} from "./settings3.js"; const ratioOptions=[null,"16:9","9:16"]; const model=use(); const ratio={modelValue:model.settings.aspect_ratio,options:ratioOptions,required:true}; if(model.settings.model_type==="wan_27_t2v"){ const audio={modelValue:model.settings.audio_setting,options:makeOptions()}; }`;
  const sources = [
    { module_name: "app.js", url: "https://syntx.ai/assets/1791467421/app.js", bytes: Buffer.byteLength(app), sha256: sha(app), text: app, bom_present: false },
    { module_name: "settings3.js", url: "https://syntx.ai/assets/1791467421/settings3.js", bytes: Buffer.byteLength(settings3), sha256: sha(settings3), text: settings3, bom_present: false },
    { module_name: "wan-video.js", url: "https://syntx.ai/assets/1791467421/wan-video.js", bytes: Buffer.byteLength(wan), sha256: sha(wan), text: wan, bom_present: false }
  ];
  const inventory = {
    schema_version: "2.1.0", catalog_kind: "MAPLESS_FRONTEND_SETTINGS_INVENTORY", evidence_level: "STATIC_PUBLIC_API_AND_COMPILED_JS", runtime_usable: false,
    generated_at: "2026-10-08T00:00:00.000Z", build: { id: "1791467421", base_url: "https://syntx.ai/assets/1791467421/" },
    public_catalog: { version: publicVersion, fetched_at: "2026-10-08T00:00:00.000Z", models_sha256: sha("models") }, homepage_sha256: sha("home"), app_sha256: sources[0]!.sha256,
    registry: { url: "https://syntx.ai/assets/1791467421/Settings2.js", bytes: 1, sha256: sha("registry") },
    framework: { settings3: { url: sources[1]!.url, bytes: sources[1]!.bytes, sha256: sources[1]!.sha256, generic_setting_keys: [] }, useSettingsParams: { url: "https://syntx.ai/assets/1791467421/useSettingsParams.js", bytes: 1, sha256: sha("params"), payload_field_keys: [] } },
    forms: [{ form_id: "wan-video", module_name: "wan-video.js", javascript: { url: sources[2]!.url, bytes: sources[2]!.bytes, sha256: sources[2]!.sha256, parse_diagnostics: 0, model_value_settings_keys: ["aspect_ratio", "model_type", "audio_setting"], static_setting_defaults: {} } }],
    models: ["wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash", "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v", "wan_27_t2v", "wan_27_videoedit"].map(model_id => ({ model_id, ai_name: "wan_video", active: true, default: false, public_type_label: null, form_id: "wan-video", form_binding_status: "STRUCTURAL_MATCH", settings_status: "UNKNOWN", settings: null, model_value_settings_keys: [], generic_setting_keys: [], payload_field_keys: [], enum_constraints: {}, defaults_status: "UNKNOWN", static_setting_defaults: {}, unknown_reasons: [], runtime_usable: false })),
    summary: { total_models: 11, structurally_mapped_models: 11, unknown_form_models: 0, models_with_public_settings: 0, models_without_public_settings: 11 }, limitations: []
  };
  const catalog = { fetched_at: "2026-10-08T00:00:00.000Z", models: inventory.models.map(m => ({ model_id: m.model_id, ai_name: m.ai_name, active: true })) };
  return { inventory: inventory as unknown as MaplessSettingsInventory, catalog: catalog as unknown as SyntxPublicCatalogSnapshot, sources };
}

test("WAN source candidate analyzer preserves null options and leaves unproven defaults/backend values unknown", () => {
  const { sources } = fixture();
  const result = extractWanConditionalControls(sources[2]!.text, ["wan_26_t2v", "wan_27_t2v"]);
  const ratio = result.controls.find(control => control.field === "aspect_ratio");
  assert.ok(ratio);
  assert.deepEqual(ratio.option_values, [null, "16:9", "9:16"]);
  assert.equal(ratio.default_status, "UNKNOWN");
  assert.equal(result.models.find(model => model.model_id === "wan_27_t2v")?.controls.some(control => control.field === "audio_setting"), true);
  assert.equal(result.models.find(model => model.model_id === "wan_26_t2v")?.controls.find(control => control.field === "audio_setting")?.applicability, "UNKNOWN");
  assert.equal(result.controls.find(control => control.field === "audio_setting")?.options_status, "DYNAMIC");
});

test("WAN AST extractor fails closed on mutated malformed source", () => {
  const { sources } = fixture();
  const changed = sources.map(source => source.module_name === "wan-video.js" ? { ...source, text: "{{" } : source);
  assert.throws(() => extractWanConditionalControls(changed[2]!.text, ["wan_27_t2v"]), /AST_PARSE_FAILED/);
});

test("WAN source decoder preserves a leading UTF-8 BOM so verified bytes stay hash-identical", () => {
  const bytes = Buffer.from("\uFEFFconst exact = true;", "utf8");
  const text = decodeWanSourceText(bytes);
  assert.equal(Buffer.byteLength(text, "utf8"), bytes.length);
  assert.equal(hasUtf8Bom(bytes), true);
  assert.equal(sha(text), sha(bytes.toString("utf8")));
  assert.equal(hasUtf8Bom(Buffer.from("const exact = true;", "utf8")), false);
});

test("WAN source comparison uses the same sha256-prefixed identity as inventory pins", () => {
  const bytes = Buffer.from("source bytes");
  const expected = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(sourceSha256(bytes), expected);
  assert.notEqual(createHash("sha256").update(bytes).digest("hex"), expected);
});

test("WAN AST keeps same-line same-field controls under distinct guards", () => {
  const text = `if (s.settings.model_type === "wan_27_t2v") { const a={modelValue:s.settings.aspect_ratio}; } if (s.settings.model_type === "wan_26_t2v") { const b={modelValue:s.settings.aspect_ratio}; }`;
  const result = extractWanConditionalControls(text, ["wan_27_t2v", "wan_26_t2v"]);
  assert.equal(result.controls.length, 2);
  assert.equal(result.controls[0]!.source_line, result.controls[1]!.source_line);
  assert.notEqual(result.controls[0]!.source_column, result.controls[1]!.source_column);
  assert.equal(result.models[0]!.controls.filter(control => control.applicability === "SOURCE_GUARD_MATCH").length, 1);
  assert.equal(result.models[1]!.controls.filter(control => control.applicability === "SOURCE_GUARD_MATCH").length, 1);
});

test("WAN AST fails closed for shadowed option names and logical conditional RHS", () => {
  const text = `const options=[null,"16:9"]; function nested(){ const options=buildOptions(); const c={modelValue:s.settings.aspect_ratio,options}; } const rhs=s.settings.model_type==="wan_27_t2v" && {modelValue:s.settings.resolution};`;
  const result = extractWanConditionalControls(text, ["wan_27_t2v"]);
  const ratio = result.controls.find(control => control.field === "aspect_ratio");
  const resolution = result.controls.find(control => control.field === "resolution");
  assert.ok(ratio);
  assert.equal(ratio.options_status, "DYNAMIC");
  assert.deepEqual(ratio.option_values, []);
  assert.ok(resolution);
  assert.equal(resolution.rendered, "UNKNOWN");
  assert.equal(result.models[0]!.controls.find(control => control.field === "resolution")?.applicability, "UNKNOWN");
});

test("WAN source CLI requires exact source confirmation before any fetch", async () => {
  assert.throws(() => parseWanConditionalSourceArguments(["--probe"]), /Usage/);
  const { inventory, catalog, sources } = fixture();
  const calls: string[] = [];
  await assert.rejects(runWanConditionalSourceCandidateCli(["--probe", "--public-version", publicVersion, "--settings-version", settingsVersion, "--confirm-source-fetch"], {
    projectRoot: "/fixture", settingsInventory: inventory,
    publicCatalog: { ...catalog, models: [] } as unknown as SyntxPublicCatalogSnapshot,
    fetchImpl: async input => {
      calls.push(String(input));
      const source = sources.find(item => item.url === String(input));
      assert.ok(source);
      return new Response(source.text, { status: 200, headers: { "content-type": "application/javascript", "content-length": String(source.bytes) } });
    }
  }), /SOURCE_BINDING_INVALID/);
  assert.deepEqual(calls, []);
  assert.equal(sources.length, 3);
});

test("WAN source reference builder binds exactly current inventory URL/byte/SHA metadata", () => {
  const inventory = loadMaplessSettingsInventoryVersion(settingsVersion, join(process.cwd(), "catalog"));
  const refs = buildPinnedWanSourceReferences(inventory, publicVersion, settingsVersion);
  assert.deepEqual(refs.map(ref => [ref.module_name, ref.url, ref.bytes, ref.sha256]), [
    ["app.js", "https://syntx.ai/assets/1791467421/app.js", null, "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf"],
    ["settings3.js", "https://syntx.ai/assets/1791467421/settings3.js", 4123, "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe"],
    ["wan-video.js", "https://syntx.ai/assets/1791467421/wan-video.js", 19503, "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119"]
  ]);
});
