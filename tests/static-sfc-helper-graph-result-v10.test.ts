import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadSettingsSourceInventoryVersion } from "../src/catalog/settings-source-history.js";
import { serializeSettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { serializeSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { validateStaticSfcHelperGraphResult } from "../tools/settings-ir/v10/static-sfc-helper-graph-result.js";

test("current archive fixtures expose a provider pair for v10 binding", () => {
  const pub = loadPublicCatalogVersion("sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json");
  const inv = loadSettingsSourceInventoryVersion("sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json", pub);
  const pair = inv.source_artifacts.filter((item) => item.role === "PROVIDER_FORM" && item.form_id === "veo-3");
  assert.equal(pair.filter((item) => item.kind === "JAVASCRIPT").length, 1);
  assert.equal(pair.filter((item) => item.kind === "SOURCE_MAP_V3").length, 1);
  assert.equal(inv.build.id, "1789134564");
});

test("v10 validation is structural and does not execute or re-derive provider source", () => {
  const pub = loadPublicCatalogVersion("sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json");
  const inv = loadSettingsSourceInventoryVersion("sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json", pub);
  const pair = inv.source_artifacts.filter((item) => item.role === "PROVIDER_FORM" && item.form_id === "veo-3");
  const js = pair.find((item) => item.kind === "JAVASCRIPT")!; const map = pair.find((item) => item.kind === "SOURCE_MAP_V3")!;
  const sourceSha = map.source_map!.settings_sources.find((item) => item.source_path.endsWith("/veo-3.vue"))!.source_content_sha256;
  const publicVersion = `sha256-${createHash("sha256").update(serializeSyntxPublicCatalogSnapshot(pub)).digest("hex")}.json`;
  const settingsVersion = `sha256-${createHash("sha256").update(serializeSettingsSourceInventory(inv)).digest("hex")}.json`;
  const result = { schema_version: 1 as const, kind: "STATIC_SFC_HELPER_GRAPH_RESULT" as const, public_version: publicVersion, settings_version: settingsVersion, observed_at: "2026-09-13T00:00:00.000Z", build_id: inv.build.id, form_id: "veo-3", provider_source_path: "/src/components/chat/forms/settings/veo-3.vue", provider_source_sha256: sourceSha, provider: { javascript: js, source_map: map }, graph: { profile: "STATIC_SFC_HELPER_GRAPH_V1" as const, form_id: "veo-3", provider_source_sha256: sourceSha, nodes: [{ module_name: js.module_name, source_path: "/src/components/chat/forms/settings/veo-3.vue", source_content_sha256: sourceSha, relation: "PROVIDER_ROOT" as const }], unresolved_imports: [], blockers: ["IMPORT_NON_RELATIVE_UNRESOLVED"], runtime_usable: false as const, vendor_code_executed: false as const, source_persisted: false as const }, runtime_usable: false as const, vendor_code_executed: false as const, source_persisted: false as const };
  assert.equal(validateStaticSfcHelperGraphResult(result, inv, pub).graph.nodes.length, 1);
});
