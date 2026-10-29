import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
  assert.equal(pages.length, 124);
  assert.equal(new Set(pages.map((row) => row.model_id)).size, 124);
  assert.equal(pages.filter((row) => row.active).length, 121);
  assert.equal(pages.filter((row) => row.active && row.runtime_status === "CODE_MAPPED").length, 120);
  assert.equal(pages.filter((row) => row.runtime_status === "CODE_MAPPED").every((row) => row.mcp_tool_names.some((name) => /^syntx_owner_(?:generate|cover|extend)_/u.test(name))), true);
  const tupleOnlyIds = pages.filter((row) => row.settings_status === "LIMITED_RUNTIME_TUPLE_ONLY").map((row) => row.model_id).sort();
  assert.deepEqual(tupleOnlyIds, []);
  const mixedIds = pages.filter((row) => row.settings_status === "MIXED_LIMITED_AND_NATIVE").map((row) => row.model_id).sort();
  assert.deepEqual(mixedIds, ["banana", "banana-2.1", "flux-1", "flux3_t2v", "gpt-image-1", "gpt-image-1.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "grok_imagine_2", "grok_imagine_quality", "grok_t2i", "grok_t2i_pro", "happy_horse_t2v", "ideogram", "kling_text2video", "ray-3.14", "runway_frames", "seedance-1.5-pro", "seedance-2.0", "seedance_pro", "seedance_pro-fast", "seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-pro", "text2video-4.5", "uni-1", "wan_26_t2i", "wan_26_t2v", "wan_27_t2v"]);
  assert.deepEqual(pages.filter((row) => row.runtime_status !== "CODE_MAPPED").map((row) => row.model_id).sort(), ["hailuo-minimax", "wan_30", "wan_30_prime"]);
  assert.deepEqual(pages.reduce((counts, row) => {
    for (const modality of row.modalities) counts[modality] = (counts[modality] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>), { image: 45, video: 71, audio: 8 });
  assert.equal(pages.some((row) => row.model_id === "wan_30" && !row.active), true);
  assert.equal(pages.some((row) => row.model_id === "wan_30_prime" && !row.active), true);
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
  const seedanceEditor = pages.find((item) => item.model_id === "seedance-2.5");
  assert.ok(seedanceEditor?.mcp_tool_names.includes("syntx_owner_generate_seedance_editor_video"));
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
    const result = await client.callTool({ name: SYNTX_GET_MEDIA_COVERAGE_TOOL_NAME, arguments: { limit: 2 } });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as Record<string, unknown>;
    assert.equal(value.coverage_version, "3.0.0");
    assert.equal(value.total, 121);
    assert.equal(value.next_offset, 2);
    assert.equal(value.runtime_usable, false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("media coverage preserves unknowns and rejects invalid paging bounds", () => {
  const selected = loadCurrentDiscoveryReadCatalog();
  const catalog = new MediaCoverageCatalog(selected.discoveryCatalog, selected.runtimeCapabilities);
  const first = catalog.page({ limit: 3, include_inactive: true });
  assert.equal(first.total, 124);
  assert.equal(first.next_offset, 3);
  assert.throws(() => catalog.page({ offset: -1 }), /MEDIA_COVERAGE_PAGE_INVALID/);
  assert.throws(() => catalog.page({ limit: 101 }), /MEDIA_COVERAGE_PAGE_INVALID/);
});
