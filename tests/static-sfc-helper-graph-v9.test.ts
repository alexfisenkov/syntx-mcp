import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../src/catalog/settings-source-history.js";
import { deriveStaticSfcHelperGraph, type StaticSfcHelperGraphOptions } from "../tools/settings-ir/v9/static-sfc-helper-graph.js";

const sha = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

function fixture(source: string, options: {
  inventoryVersion?: string;
  formId?: string;
  providerSourcePath?: string;
} = {}): StaticSfcHelperGraphOptions {
  const formId = options.formId ?? "veo-3";
  const providerSourcePath = options.providerSourcePath ?? `/src/components/chat/forms/settings/${formId}.vue`;
  const publicCatalog = loadPublicCatalogVersion("sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json");
  const inventory = structuredClone(loadSettingsSourceInventoryVersion(options.inventoryVersion ?? "sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json", publicCatalog));
  const provider = inventory.source_artifacts.find((entry) => entry.role === "PROVIDER_FORM" && entry.form_id === formId && entry.source_map?.settings_sources.some((item) => item.source_path === providerSourcePath));
  assert.ok(provider?.source_map);
  const declared = provider.source_map.settings_sources.find((item) => item.source_path === providerSourcePath);
  assert.ok(declared);
  const oldHash = declared.source_content_sha256;
  const newHash = sha(source);
  declared.source_content_sha256 = newHash;
  // The inventory cross-check also binds model evidence to the same declared
  // provider identity; keep this synthetic fixture internally coherent.
  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) rewrite(item); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (item === oldHash) (value as Record<string, unknown>)[key] = newHash;
      else rewrite(item);
    }
  };
  rewrite(inventory);
  return { formId, providerSourcePath, providerSource: source, inventory };
}

test("v9 resolves VEO direct helper imports from exact source-map identities", () => {
  const result = deriveStaticSfcHelperGraph(fixture(`<script setup>\nimport "./data/veo/constants.js";\nimport "./data/veo/quality.js";\nimport "vue";\n</script>`));
  assert.equal(result.profile, "STATIC_SFC_HELPER_GRAPH_V1");
  assert.deepEqual(result.nodes.map(({ module_name, source_path, relation }) => ({ module_name, source_path, relation })), [
    { module_name: "veo-3.js", source_path: "/src/components/chat/forms/settings/veo-3.vue", relation: "PROVIDER_ROOT" },
    { module_name: "constants.js", source_path: "/src/components/chat/forms/settings/data/veo/constants.js", relation: "DIRECT_IMPORT" },
    { module_name: "quality.js", source_path: "/src/components/chat/forms/settings/data/veo/quality.js", relation: "DIRECT_IMPORT" }
  ]);
  assert.deepEqual(result.unresolved_imports.map((item) => item.specifier), ["vue"]);
  assert.ok(result.blockers.includes("IMPORT_NON_RELATIVE_UNRESOLVED"));
  assert.equal(result.source_persisted, false);
});

test("v9 resolves the rotated seedance2 provider mapping", () => {
  const result = deriveStaticSfcHelperGraph(fixture(`<script setup>\nimport "./data/seedance/constants.js";\n</script>`, {
    inventoryVersion: "sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json",
    formId: "seedance"
  }));
  assert.deepEqual(result.nodes.map(({ module_name, source_path, relation }) => ({ module_name, source_path, relation })), [
    { module_name: "seedance2.js", source_path: "/src/components/chat/forms/settings/seedance.vue", relation: "PROVIDER_ROOT" },
    { module_name: "constants2.js", source_path: "/src/components/chat/forms/settings/data/seedance/constants.js", relation: "DIRECT_IMPORT" }
  ]);
  assert.deepEqual(result.unresolved_imports, []);
});

test("v9 leaves unsafe, remote and missing imports unresolved with safe blockers", () => {
  const result = deriveStaticSfcHelperGraph(fixture(`<script>\nimport "../__proto__/x.js"; import "https://example.test/x.js"; import "./missing.js"; import "/src/x.js";\n</script>`));
  assert.deepEqual(result.unresolved_imports.map((item) => item.specifier), ["../__proto__/x.js", "https://example.test/x.js", "./missing.js", "/src/x.js"]);
  assert.ok(result.blockers.includes("IMPORT_PROTOTYPE_PATH_REJECTED"));
  assert.ok(result.blockers.includes("IMPORT_REMOTE_UNRESOLVED"));
  assert.ok(result.blockers.includes("IMPORT_HELPER_NOT_DECLARED"));
  assert.ok(result.blockers.includes("IMPORT_ABSOLUTE_UNRESOLVED"));
  assert.equal(JSON.stringify(result).includes("https://example.test"), true);
});

test("v9 rejects provider source hash drift and invalid provider path", () => {
  const options = fixture(`<script>import "./data/veo/constants.js"</script>`);
  assert.throws(() => deriveStaticSfcHelperGraph({ ...options, providerSource: `${options.providerSource}\nchanged` }), (error: unknown) => (error as { code?: string }).code === "PROVIDER_SOURCE_DRIFT");
  assert.throws(() => deriveStaticSfcHelperGraph({ ...fixture("<script />"), providerSourcePath: "/src/components/chat/forms/settings/other.vue" }), (error: unknown) => (error as { code?: string }).code === "PROVIDER_SOURCE_PATH_INVALID");
});
