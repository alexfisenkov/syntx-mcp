import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  archiveMaplessSettingsInventory,
  buildMaplessSettingsInventory,
  loadMaplessSettingsInventoryVersion,
  normalizePublicAiNameToFormId
} from "../src/catalog/mapless-settings-inventory.js";
import {
  analyzeMaplessCompiledModule,
  extractGenericSettingsKeys,
  extractPayloadFieldKeys,
  parseMaplessRegistryForms
} from "../tools/mapless-settings-ast.js";

const publicVersion = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

test("mapless coverage maps every model only through current AI family and exact registered form", async (t) => {
  const catalog = loadPublicCatalogVersion(publicVersion);
  const formIds = new Set([
    "banana", "beeble", "chatgpt", "clarity", "claude", "deepseek",
    "elevenlabs", "flux", "flux-3-video", "gemini", "grok", "grok-image",
    "grok-video", "hailuo-minimax", "happy-horse", "heygen", "higgsfield",
    "higgsfield-soul", "ideogram", "kling", "luma", "luma-image", "magnific",
    "perplexity", "qwen", "runway", "runway-frames", "seedance", "seedream",
    "sora", "sora-images", "suno", "topaz-ai", "topaz-astra", "veo-3",
    "video-2-audio", "wan-image", "wan-video", "zai"
  ]);
  const forms = [...formIds].map((form_id) => ({
    form_id,
    module_name: form_id === "seedance" ? "seedance2.js" : `${form_id}.js`,
    javascript: {
      url: `https://syntx.ai/assets/1791445568/${form_id}.js`,
      bytes: 100,
      sha256: `sha256:${"a".repeat(64)}`,
      parse_diagnostics: 0,
      model_value_settings_keys: form_id === "banana" ? ["aspect_ratio", "model_type"] : [],
      static_setting_defaults: {}
    }
  }));
  const inventory = buildMaplessSettingsInventory({
    publicCatalog: catalog,
    publicVersion,
    generatedAt: "2026-10-08T13:00:00.000Z",
    buildId: "1791445568",
    homepageSha256: `sha256:${"b".repeat(64)}`,
    appSha256: `sha256:${"c".repeat(64)}`,
    registry: {
      url: "https://syntx.ai/assets/1791445568/Settings2.js",
      bytes: 100,
      sha256: `sha256:${"d".repeat(64)}`
    },
    framework: {
      settings3: {
        url: "https://syntx.ai/assets/1791445568/settings3.js",
        bytes: 100,
        sha256: `sha256:${"e".repeat(64)}`,
        generic_setting_keys: ["max_prompt_length"]
      },
      useSettingsParams: {
        url: "https://syntx.ai/assets/1791445568/useSettingsParams.js",
        bytes: 100,
        sha256: `sha256:${"f".repeat(64)}`,
        payload_field_keys: ["model_type", "mode"]
      }
    },
    forms
  });

  assert.equal(inventory.models.length, 200);
  const banana = inventory.models.filter((model) => model.ai_name === "banana");
  assert.equal(banana.length, 5);
  assert.ok(banana.every((model) => model.form_id === "banana"));
  assert.ok(banana.every((model) => model.form_binding_status === "STRUCTURAL_MATCH"));
  assert.ok(banana.every((model) => model.model_value_settings_keys.includes("aspect_ratio")));
  assert.ok(banana.every((model) => model.unknown_reasons.includes("CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS")));
  assert.ok(banana.every((model) => model.defaults_status === "UNKNOWN"));
  assert.ok(banana.every((model) => model.runtime_usable === false));
  assert.ok(banana.every((model) => model.public_type_label === null));

  const unmapped = inventory.models.find((model) => model.ai_name === "audio2text");
  assert.equal(unmapped?.form_id, null);
  assert.equal(unmapped?.form_binding_status, "UNKNOWN");
  assert.ok(unmapped?.unknown_reasons.includes("NO_CURRENT_AI_FAMILY"));
  assert.equal(normalizePublicAiNameToFormId("flux3_video"), "flux-3-video");
  assert.equal(normalizePublicAiNameToFormId("luma_image"), "luma-image");
  assert.equal(normalizePublicAiNameToFormId("banana-inpaint"), "banana-inpaint");

  const catalogDirectory = await mkdtemp(join(tmpdir(), "syntx-mapless-settings-"));
  t.after(() => rm(catalogDirectory, { recursive: true, force: true }));
  const archived = await archiveMaplessSettingsInventory(inventory, catalogDirectory);
  assert.equal(archived.status, "created");
  assert.match(archived.path, /settings\/v2\/sha256-[a-f0-9]{64}\.json$/u);
  const loaded = loadMaplessSettingsInventoryVersion(archived.version, catalogDirectory);
  assert.deepEqual(loaded, inventory);
  assert.equal((await archiveMaplessSettingsInventory(inventory, catalogDirectory)).status, "existing");

  const corruptCatalog = await mkdtemp(join(tmpdir(), "syntx-mapless-corrupt-"));
  t.after(() => rm(corruptCatalog, { recursive: true, force: true }));
  const corruptHistory = join(corruptCatalog, "settings", "v2");
  await mkdir(corruptHistory, { recursive: true });
  const bytes = await readFile(archived.path);
  await writeFile(join(corruptHistory, archived.version), Buffer.concat([bytes, Buffer.from(" ")]));
  assert.throws(() => loadMaplessSettingsInventoryVersion(archived.version, corruptCatalog), /MAPLESS_SETTINGS_VERSION_HASH_MISMATCH/);
  assert.throws(() => loadMaplessSettingsInventoryVersion("../invalid.json", catalogDirectory), /MAPLESS_SETTINGS_VERSION_INVALID/);
});

test("mapless AST extractors keep registry, form controls, defaults and payload keys explicit", () => {
  const forms = parseMaplessRegistryForms(`const R={"./forms/settings/banana.vue":()=>import("./banana.js"),"./forms/settings/seedance.vue":()=>import("./seedance2.js")};`);
  assert.deepEqual(forms, [
    { form_id: "banana", module_name: "banana.js" },
    { form_id: "seedance", module_name: "seedance2.js" }
  ]);

  const analysis = analyzeMaplessCompiledModule(`const node={modelValue:model.settings.aspect_ratio};const other={modelValue:model.settings.model_type};const props={settings:{aspect_ratio:"1:1",model_type:"banana",ignored:"no"}};`, new Set(["aspect_ratio"]));
  assert.deepEqual(analysis.model_value_settings_keys, ["aspect_ratio", "model_type"]);
  assert.deepEqual(analysis.static_setting_defaults, { aspect_ratio: "1:1", model_type: "banana" });
  assert.deepEqual(extractGenericSettingsKeys(`const x={setSettingsByModel:()=>{const a="max_prompt_length";}};const y="aspect_ratio";`, new Set(["max_prompt_length", "aspect_ratio"])), ["max_prompt_length"]);
  assert.deepEqual(extractPayloadFieldKeys(`const keys=["model_type","mode"];const unrelated="ignore_me";`), ["mode", "model_type"]);
  assert.throws(() => parseMaplessRegistryForms(`const R={"./forms/settings/banana.vue":()=>import("./banana.js"),"./forms/settings/banana.vue":()=>import("./other.js")};`), /MAPLESS_REGISTRY_MAPPING_INVALID/);
});

test("v2.0 immutable inventory reads through the v2.1 structural-evidence migration", () => {
  const legacyVersion = "sha256-b71645ccff124f667763292cd627bbf5b2d3c2159cd9b6b63f7f7bf2831a5316.json";
  const inventory = loadMaplessSettingsInventoryVersion(legacyVersion);
  assert.equal(inventory.schema_version, "2.1.0");
  assert.equal(inventory.migrated_from_schema_version, "2.0.0");
  assert.equal(inventory.summary.structurally_mapped_models, 187);
  assert.equal(inventory.summary.unknown_form_models, 13);
  assert.ok(inventory.models.filter((model) => model.form_binding_status === "STRUCTURAL_MATCH").every((model) => model.unknown_reasons.includes("STRUCTURAL_MATCH_NOT_RUNTIME_ROUTE_PROOF")));
});

test("maintenance CLI imports its AST tool graph and refuses invalid arguments before network", async () => {
  const cliPath = fileURLToPath(new URL("../../scripts/sync-mapless-settings-inventory.mjs", import.meta.url));
  await import(pathToFileURL(cliPath).href);
  const exec = promisify(execFile);
  for (const args of [
    [],
    ["--public-version", "invalid.json", "--confirm-source-fetch"]
  ]) {
    await assert.rejects(exec(process.execPath, [cliPath, ...args], { timeout: 5_000 }), (error: unknown) => {
      const failure = error as Error & { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.equal(failure.stdout, "");
      assert.match(failure.stderr, /^Usage: sync-mapless-settings-inventory\.mjs /u);
      return true;
    });
  }
});
