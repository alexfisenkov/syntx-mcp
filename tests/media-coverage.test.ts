import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { MediaCoverageCatalog } from "../src/catalog/media-coverage.js";
import type { MediaCoverageRecord } from "../src/catalog/media-coverage.js";
import { registerSyntxMediaCoverageTools, SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME } from "../src/mcp/media-coverage-tools.js";
import { loadCurrentDiscoveryReadCatalog } from "../src/catalog/selected-discovery-catalog.js";

test("current media coverage pages the complete non-text census including inactive IDs", () => {
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const pages: MediaCoverageRecord[] = [];
  let offset = 0;
  while (true) {
    const page = catalog.page({ offset, limit: 17, include_inactive: true });
    pages.push(...page.items);
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  assert.equal(pages.length, 129);
  assert.equal(new Set(pages.map((row) => row.model_id)).size, 129);
  assert.equal(pages.filter((row) => row.active).length, 126);
  assert.equal(pages.filter((row) => row.active && row.runtime_status === "CODE_MAPPED").length, 123);
  assert.equal(pages.filter((row) => row.runtime_status === "CODE_MAPPED").every((row) => row.mcp_tool_names.some((name) => /^syntx_owner_(?:generate|cover|extend)_/u.test(name))), true);
  const tupleOnlyIds = pages.filter((row) => row.settings_status === "LIMITED_RUNTIME_TUPLE_ONLY").map((row) => row.model_id).sort();
  assert.deepEqual(tupleOnlyIds, []);
  const mixedIds = pages.filter((row) => row.settings_status === "MIXED_LIMITED_AND_NATIVE").map((row) => row.model_id).sort();
  assert.deepEqual(mixedIds, ["banana", "banana-2.1", "flux-1", "flux3_t2v", "gpt-image-1", "gpt-image-1.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "grok_imagine_2", "grok_imagine_quality", "grok_t2i", "grok_t2i_pro", "happy_horse_t2v", "ideogram", "kling_text2video", "ray-3.14", "runway_frames", "seedance-1.5-pro", "seedance-2.0", "seedance_pro", "seedance_pro-fast", "seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-pro", "text2video-4.5", "uni-1", "wan_26_t2i", "wan_26_t2v", "wan_27_t2v"]);
  assert.deepEqual(pages.filter((row) => row.runtime_status !== "CODE_MAPPED").map((row) => row.model_id).sort(), ["hailuo-minimax", "higgsfield-soul-train", "wan_30", "wan_30_prime"]);
  assert.deepEqual(pages.reduce((counts, row) => {
    for (const modality of row.modalities) counts[modality] = (counts[modality] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>), { image: 49, video: 72, audio: 8 });
  assert.equal(pages.some((row) => row.model_id === "wan_30" && row.active), true);
  assert.equal(pages.some((row) => row.model_id === "wan_30_prime" && row.active), true);
  assert.equal(pages.find((row) => row.model_id === "hailuo-minimax")?.operation_role, "SELECTOR");
  assert.equal(catalog.page({ limit: 1 }).interpretation_notes.some((note) => note.includes("attached to seedance-2.5")), true);
  for (const modelId of ["flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"]) {
    const row = pages.find((item) => item.model_id === modelId);
    assert.equal(row?.runtime_status, "CODE_MAPPED", modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_generate_video"), modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_get_expanded_t2v_parameters"), modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_generate_expanded_t2v"), modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_reconcile_expanded_t2v"), modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_list_expanded_t2v_recoveries"), modelId);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_GENERATE_VIDEO"), modelId);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_EXPANDED_T2V"), modelId);
    assert.equal(row?.settings_status, "MIXED_LIMITED_AND_NATIVE", modelId);
    assert.ok(row?.notes.some((note) => note.includes("full settings coverage is not inferred")), modelId);
  }
  for (const modelId of ["grok_i2i", "grok_i2i_pro"]) {
    const row = pages.find((item) => item.model_id === modelId);
    assert.equal(row?.runtime_status, "CODE_MAPPED", modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_generate_grok_reference"), modelId);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_GROK_IMAGE_REFERENCES"), modelId);
  }
  for (const modelId of ["seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-flash", "seedream-5.0-pro"]) {
    const row = pages.find((item) => item.model_id === modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_get_seedream_editor_image_parameters"), modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_generate_seedream_editor_image"), modelId);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES"), modelId);
  }
  const soulTrain = pages.find((row) => row.model_id === "higgsfield-soul-train");
  assert.equal(soulTrain?.active, false);
  assert.deepEqual(soulTrain?.mcp_tool_names, []);
  assert.notEqual(soulTrain?.runtime_status, "CODE_MAPPED");
  assert.equal(pages.find((row) => row.model_id === "grok_imagine_quality")?.active, true);
  assert.equal(pages.find((row) => row.model_id === "acttwo")?.active, false);
  assert.equal(pages.filter((row) => row.active && row.operation_role === "MODEL_OPERATION").length, 125);
  assert.deepEqual(pages.find((row) => row.model_id === "happy_horse_edit")?.settings?.max_file_size,
    { images: 10485760, videos: 104857600 });
  assert.ok(pages.find((row) => row.model_id === "seedance-2.5")?.settings?.accepted_file_types?.includes("audio/mpeg"));
  const seedanceEditor = pages.find((item) => item.model_id === "seedance-2.5");
  assert.ok(seedanceEditor?.mcp_tool_names.includes("syntx_owner_generate_seedance_editor_video"));
  assert.ok(seedanceEditor?.mcp_tool_names.includes("syntx_owner_upload_seedance_editor_frame"));
  assert.equal(seedanceEditor?.mcp_tool_names.includes("seedance-2.5-editor"), false);
  assert.ok(seedanceEditor?.operator_flags?.includes("SYNTX_OWNER_SEEDANCE_EDITOR"));
  assert.equal(pages.every((row) => row.result_status !== "HISTORICAL_RESULT" || (row.historical_evidence !== "NONE" && row.provider_case_status === "HISTORICAL_CASE")), true);
});

test("route v2 captures the expanded owner alias without inventing a tools/list total", () => {
  const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v2.json"), "utf8"));
  assert.equal(snapshot.schema_version, "2.0.0");
  assert.equal(snapshot.owner_tool_count, null);
  assert.equal(snapshot.owner_tool_count_status, "UNVERIFIED_FOR_ROUTE_EXTENSION");
  const alias = snapshot.native_alias_bindings.find((binding: { operator_flag: string }) => binding.operator_flag === "SYNTX_OWNER_EXPANDED_T2V");
  assert.deepEqual(alias?.public_model_ids.sort(), ["flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"].sort());
  assert.deepEqual(alias?.tool_names.sort(), ["syntx_owner_get_expanded_t2v_parameters", "syntx_owner_generate_expanded_t2v",
    "syntx_owner_reconcile_expanded_t2v", "syntx_owner_list_expanded_t2v_recoveries"].sort());
});

test("route v3 advertises only no-reference K4 recovery without granting generation", () => {
  const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v3.json"), "utf8"));
  assert.equal(snapshot.schema_version, "3.0.0");
  assert.equal(snapshot.owner_tool_count, null);
  assert.equal(snapshot.owner_tool_count_status, "UNVERIFIED_FOR_ROUTE_EXTENSION");
  const alias = snapshot.native_alias_bindings.find((binding: { operator_flag: string }) => binding.operator_flag === "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY");
  assert.deepEqual(alias?.public_model_ids.sort(), ["kling_4_keyframes", "kling_4_omni"].sort());
  assert.deepEqual(alias?.tool_names, ["syntx_owner_get_existing_video_recovery"]);
  assert.match(alias?.operation_note ?? "", /NO_REFERENCE_ONLY/u);

  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const rows: MediaCoverageRecord[] = [];
  let offset = 0;
  while (true) {
    const page = catalog.page({ include_inactive: true, offset, limit: 100 });
    rows.push(...page.items);
    if (page.next_offset === null) break;
    offset = page.next_offset;
  }
  for (const modelId of ["kling_4_keyframes", "kling_4_omni"]) {
    const row = rows.find((item) => item.model_id === modelId);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_get_existing_video_recovery"), modelId);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_EXISTING_VIDEO_RECOVERY"), modelId);
  }
});

test("MCP media coverage tool exposes a read-only page with source version and no dispatch", async () => {
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "coverage-test", version: "1.0.0" });
  registerSyntxMediaCoverageTools(server, catalog);
  await server.connect(serverTransport);
  const client = new Client({ name: "coverage-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const tool = (await client.listTools()).tools.find((item) => item.name === SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME);
    assert.equal(tool?.annotations?.readOnlyHint, true);
    assert.equal(tool?.outputSchema?.type, "object");
    const validate = new AjvJsonSchemaValidator().getValidator(tool!.outputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    const result = await client.callTool({ name: SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME, arguments: { limit: 2 } });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as Record<string, unknown>;
    assert.equal(value.coverage_version, "7.0.0");
    assert.equal(value.total, 126);
    assert.equal(value.next_offset, 2);
    assert.equal(value.runtime_usable, false);
    assert.deepEqual(value, catalog.page({ limit: 2 }));
    assert.deepEqual(JSON.parse((result.content as Array<{ type: string; text: string }>).find(item => item.type === "text")!.text), value);
    assert.equal(validate(value).valid, true);
    for (const offset of [0, 100, 10000]) {
      const page = await client.callTool({ name: SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME, arguments: { offset, limit: 100, include_inactive: true } });
      assert.equal(page.isError, undefined);
      assert.deepEqual(page.structuredContent, catalog.page({ offset, limit: 100, include_inactive: true }));
      assert.equal(validate(page.structuredContent).valid, true);
    }
    assert.equal(validate({ ...value, runtime_usable: true }).valid, false);
    assert.equal(validate({ ...value, items: [{ ...(value.items as object[])[0], runtime_status: "PAID_ALLOWED" }] }).valid, false);
    assert.equal(validate({ ...value, undocumented: true }).valid, false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("media coverage preserves unknowns and rejects invalid paging bounds", () => {
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const first = catalog.page({ limit: 3, include_inactive: true });
  assert.equal(first.total, 129);
  assert.equal(first.next_offset, 3);
  assert.throws(() => catalog.page({ offset: -1 }), /MEDIA_COVERAGE_PAGE_INVALID/);
  assert.throws(() => catalog.page({ limit: 101 }), /MEDIA_COVERAGE_PAGE_INVALID/);
});


test("v4 binds current public source and carries forward v3 route bytes without new evidence", () => {
  const v3Bytes = readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v3.json"));
  const v3 = JSON.parse(v3Bytes.toString());
  const v4 = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v4.json"), "utf8"));
  assert.equal(v4.public_catalog_version, "sha256-bca24244ca2a2ffc79e6788621993335181f0a44958d3b0ff0fac724326fd41b.json");
  assert.equal(v4.route_provenance.sha256, "sha256:" + createHash("sha256").update(v3Bytes).digest("hex"));
  assert.equal(v4.route_provenance.status, "REUSED_CODE_BINDINGS_NOT_NEW_RUNTIME_OR_PROVIDER_EVIDENCE");
  assert.deepEqual(v4.routes, v3.routes);
  assert.deepEqual(v4.native_alias_bindings, v3.native_alias_bindings);
});

test("v5 extends only the two Suno routes and pins immutable v4 bytes", () => {
  const v4Bytes = readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v4.json"));
  const v4 = JSON.parse(v4Bytes.toString());
  const v5 = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v5.json"), "utf8"));
  assert.equal("sha256:" + createHash("sha256").update(v4Bytes).digest("hex"), "sha256:2847eb6ca45ac5c820a8b51dfa6d622b382097e25310346588979c4fe94897e7");
  assert.equal(v5.route_provenance.source_v4_sha256, "sha256:" + createHash("sha256").update(v4Bytes).digest("hex"));
  assert.equal(v5.public_catalog_version, v4.public_catalog_version);
  assert.deepEqual(v5.public_source_hashes, v4.public_source_hashes);
  assert.deepEqual(v5.native_alias_bindings, v4.native_alias_bindings);
  const expected = structuredClone(v4.routes);
  for (const id of ["V6", "V6_wild"]) expected[id] = [...expected[id], "syntx_owner_upload_suno_audio_reference"].sort();
  assert.deepEqual(v5.routes, expected);
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const page = catalog.page({ limit: 100, include_inactive: true });
  const rows = [...page.items, ...catalog.page({ offset: 100, limit: 100, include_inactive: true }).items];
  for (const id of ["V6", "V6_wild"]) assert.ok(rows.find(row => row.model_id === id)?.mcp_tool_names.includes("syntx_owner_upload_suno_audio_reference"));
  assert.ok(page.interpretation_notes.some(note => note.includes("configured ffprobe")));
});

test("v6 adds source-bound current media routes and keeps inactive GPT2.6 source-only", () => {
  const historicalHashes = [
    "698416fa0a54168595c42da32fa8e8353e4d10da6149ef3d73549edea67a1dff",
    "546478d0ae1456f54f082c918f97e73fcd2e562b46e345b73aa2b86cf0563103",
    "209e4c7a6a7d9dcd1639e29da83e542892afddfed2ef0cbd5d366e958a06297c",
    "2847eb6ca45ac5c820a8b51dfa6d622b382097e25310346588979c4fe94897e7",
    "2a0da329494ae60a35f1df82b9d04e66dcd4c3cadda7cbbb49baaef07ee20790"
  ];
  historicalHashes.forEach((sha256, index) => assert.equal(createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), `catalog/media-coverage/owner-tool-routes-v${index + 1}.json`)))
    .digest("hex"), sha256));
  const v5Bytes = readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v5.json"));
  const v5 = JSON.parse(v5Bytes.toString());
  const v6 = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v6.json"), "utf8"));
  assert.equal(v6.schema_version, "6.0.0");
  assert.equal(v6.owner_tool_count, null);
  assert.equal(v6.public_catalog_version, "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json");
  assert.equal(v6.route_provenance.source_v5_sha256, "sha256:" + createHash("sha256").update(v5Bytes).digest("hex"));
  const expectedCurrentRoutes = structuredClone(v5.routes);
  const currentGroups = [[["seedance-2.0", "seedance-2.5", "seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"], ["syntx_owner_get_seedance_current_source", "syntx_owner_generate_seedance_current_video", "syntx_owner_get_seedance_current_result", "syntx_owner_list_seedance_current_recoveries"]], [["hailuo-3.0"], ["syntx_owner_get_hailuo3_current_source", "syntx_owner_generate_hailuo3_current", "syntx_owner_get_hailuo3_current_result", "syntx_owner_list_hailuo3_current_recoveries"]], [["ray-3.14"], ["syntx_owner_get_luma_current_source", "syntx_owner_generate_luma_current", "syntx_owner_get_luma_current_result", "syntx_owner_list_luma_current_recoveries"]], [["veo3", "veo3fast", "veo3fast_r"], ["syntx_owner_get_veo3_current_source", "syntx_owner_generate_veo3_current", "syntx_owner_get_veo3_current_result", "syntx_owner_list_veo3_current_recoveries"]], [["wan_30_reference", "wan_30_omni", "wan_30_edit", "wan_30_first_last_frame", "wan_25_t2v_preview", "wan_25_i2v_preview", "wan_27_i2v", "wan_27_r2v", "wan_27_videoedit", "wan_30_t2v"], ["syntx_owner_get_wan_current_source", "syntx_owner_generate_wan_current", "syntx_owner_get_wan_current_result", "syntx_owner_list_wan_current_recoveries"]], [["flux3_t2v", "flux3_i2v", "flux3_v2v"], ["syntx_owner_get_flux3_current_source", "syntx_owner_generate_flux3_current_video", "syntx_owner_get_flux3_current_result", "syntx_owner_list_flux3_current_recoveries"]]] as const;
  for (const [ids, names] of currentGroups) for (const id of ids) {
    const common = ["syntx_get_current_video_reference_policy"];
    if (!["flux3_t2v", "wan_30_t2v"].includes(id)) common.push("syntx_owner_upload_current_video_reference");
    expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], ...common, ...names])].sort();
  }
  for (const id of ["wan_26_t2v", "wan_27_t2v"]) expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], "syntx_owner_upload_wan_t2v_audio"])].sort();
  expectedCurrentRoutes.switchx = [...new Set([...expectedCurrentRoutes.switchx, "syntx_owner_upload_switchx_reference"])].sort();
  for (const [ids, name] of [[["clarity"], "syntx_owner_get_clarity_current_manual_source"], [["creative", "precision_v1", "precision_v2"], "syntx_owner_get_magnific_current_manual_source"], [["higgsfield-soul"], "syntx_owner_get_soul_current_manual_source"]] as const) for (const id of ids) expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], name])].sort();
  assert.deepEqual(v6.routes, expectedCurrentRoutes);
  const aliases = structuredClone(v5.native_alias_bindings);
  const editor = aliases.find((binding: { operator_flag: string }) => binding.operator_flag === "SYNTX_OWNER_SEEDANCE_EDITOR");
  editor.tool_names.push("syntx_owner_upload_seedance_editor_frame");
  editor.route_evidence_sources.push("src/application/owner-seedance-editor-frame-policy.ts");
  assert.deepEqual(v6.native_alias_bindings, aliases);
  assert.deepEqual(v6.source_only_model_ids, ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
});

test("v7 binds the new public source and preserves historical routes without promoting bare WAN", () => {
  const v6Bytes = readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v6.json"));
  const v6 = JSON.parse(v6Bytes.toString());
  const v7 = JSON.parse(readFileSync(resolve(process.cwd(), "catalog/media-coverage/owner-tool-routes-v7.json"), "utf8"));
  assert.equal(v7.schema_version, "7.0.0");
  assert.equal(v7.public_catalog_version, "sha256-49f41bb1565932456137e2a264a2904c441a95e9f5e0aa2a76a9a0c503fedc13.json");
  assert.equal(v7.route_provenance.source_v6_sha256, "sha256:" + createHash("sha256").update(v6Bytes).digest("hex"));
  assert.equal(v7.route_provenance.settings_inventory_version, "sha256-0a03f8d27f72361e8ca6cff628e2a6245e8fca11b338d0c996ecf71c79b43c32.json");
  assert.equal(v7.route_provenance.frontend_build_id, "1794311734");
  assert.equal(v7.owner_tool_count, null);
  assert.deepEqual(v7.native_alias_bindings, v6.native_alias_bindings);
  for (const [id, tools] of Object.entries(v6.routes) as Array<[string, string[]]>) {
    assert.deepEqual(v7.routes[id].filter((name: string) => tools.includes(name)), tools, id);
  }
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const rows = [...catalog.page({ limit: 100, include_inactive: true }).items,
    ...catalog.page({ offset: 100, limit: 100, include_inactive: true }).items];
  assert.deepEqual(v7.source_only_model_ids, ["wan_30", "wan_30_prime"]);
  for (const id of v7.source_only_model_ids) {
    const row = rows.find(item => item.model_id === id);
    assert.equal(row?.active, true, id);
    assert.equal(row?.runtime_status, "SOURCE_ONLY", id);
    assert.deepEqual(row?.mcp_tool_names, [], id);
    assert.ok(row?.notes.some(note => note.includes("no exact generator route")), id);
  }
  for (const id of ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]) {
    const row = rows.find(item => item.model_id === id);
    assert.equal(row?.active, true, id);
    assert.equal(row?.runtime_status, "CODE_MAPPED", id);
    assert.equal(row?.settings_status, "NATIVE_PARAMETER_ROUTE_PRESENT", id);
    assert.ok(row?.mcp_tool_names.includes("syntx_owner_generate_gpt26_image"), id);
    assert.ok(row?.operator_flags?.includes("SYNTX_OWNER_STANDARD_IMAGE_REFERENCES"), id);
  }
  const seedream = rows.find(item => item.model_id === "seedream-5.5");
  assert.equal(seedream?.settings_status, "NATIVE_PARAMETER_ROUTE_PRESENT");
  assert.ok(seedream?.mcp_tool_names.includes("syntx_owner_generate_seedream55_image"));
  assert.ok(seedream?.operator_flags?.includes("SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES"));
  assert.equal(seedream?.mcp_tool_names.includes("syntx_owner_generate_seedream_editor_image"), false);
  const veo = rows.find(item => item.model_id === "omni1.2");
  assert.ok(veo?.mcp_tool_names.includes("syntx_owner_generate_veo_omni12_current"));
  assert.ok(veo?.mcp_tool_names.includes("syntx_owner_upload_current_video_reference"));
  assert.ok(veo?.operator_flags?.includes("SYNTX_OWNER_CURRENT_VIDEO_REFERENCES"));
  assert.equal(rows.filter(row => row.active && row.runtime_status === "CODE_MAPPED").length, 123);
  assert.equal(rows.filter(row => row.active && row.operation_role === "MODEL_OPERATION" && row.runtime_status === "SOURCE_ONLY").length, 2);
  assert.equal(rows.filter(row => row.active && row.operation_role === "SELECTOR").length, 1);
});
