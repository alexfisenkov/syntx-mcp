import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  OWNER_WAN30_REFERENCE_TOOL_NAMES,
  SYNTX_GET_WAN30_REFERENCE_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_WAN30_REFERENCE_IMAGE_TOOL_NAME,
  SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_WAN30_REFERENCE_VIDEO_TOOL_NAME,
  SYNTX_OWNER_LIST_WAN30_REFERENCE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_GET_WAN30_REFERENCE_RESULT_PAGE_TOOL_NAME
} from "../src/mcp/owner-wan30-reference-video-tools.js";
import { readOwnerWan30ReferenceVideosFlag } from "../src/transports/stdio-owner.js";

const CATALOG_VERSION = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
const CATALOG_DIRECTORY = fileURLToPath(new URL("../../catalog/", import.meta.url));

async function connected(ownerWan30ReferenceVideosEnabled?: boolean) {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCalls += 1;
    throw new Error("No provider network is allowed in this local MCP fixture.");
  };
  const runtime = createObservedOwnerRuntime({
    ...(ownerWan30ReferenceVideosEnabled === undefined ? {} : { ownerWan30ReferenceVideosEnabled }),
    publicCatalogVersion: CATALOG_VERSION,
    catalogDirectory: CATALOG_DIRECTORY,
    fetchImpl
  });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan30-reference-mcp-1876", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, runtime, fetchCalls: () => fetchCalls };
}

test("default runtime omits every WAN 3.0 Reference tool", async () => {
  const fixture = await connected();
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => (OWNER_WAN30_REFERENCE_TOOL_NAMES as readonly string[]).includes(name)), false);
    assert.equal(fixture.fetchCalls(), 0);
    assert.equal(readOwnerWan30ReferenceVideosFlag(undefined), false);
    assert.equal(readOwnerWan30ReferenceVideosFlag("0"), false);
    assert.equal(readOwnerWan30ReferenceVideosFlag("1"), true);
    assert.throws(() => readOwnerWan30ReferenceVideosFlag("true"), /SYNTX_OWNER_WAN30_REFERENCE_VIDEOS/u);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30ReferenceVideosLifecycle?.close();
  }
});

test("explicit owner opt-in registers exactly six tools and returns pinned source only", async () => {
  const fixture = await connected(true);
  try {
    const names = (await fixture.client.listTools()).tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (OWNER_WAN30_REFERENCE_TOOL_NAMES as readonly string[]).includes(name)).sort(),
      [...OWNER_WAN30_REFERENCE_TOOL_NAMES].sort());
    const source = await fixture.client.callTool({ name: SYNTX_GET_WAN30_REFERENCE_PARAMETERS_TOOL_NAME, arguments: {} });
    assert.equal(source.isError, undefined);
    const value = source.structuredContent as { model_id?: unknown; effective_defaults?: unknown; dispatch_allowed?: unknown;
      backend_acceptance?: unknown; wire_observation?: { settings_keys?: unknown }; quote_observation?: { path?: unknown } };
    assert.equal(value.model_id, "wan_30_reference");
    assert.equal(value.effective_defaults, "UNKNOWN");
    assert.equal(value.dispatch_allowed, false);
    assert.equal(value.backend_acceptance, "UNPROVEN");
    assert.equal(value.quote_observation?.path, "/api/v2/get_model_info");
    assert.equal((value.wire_observation?.settings_keys as unknown[])?.length, 12);
    assert.equal(JSON.stringify(source).includes("https://"), false);
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30ReferenceVideosLifecycle?.close();
  }
});

test("invalid upload and non-profile generation inputs fail without dispatch or structured error payload", async () => {
  const fixture = await connected(true);
  try {
    const badUpload = await fixture.client.callTool({ name: SYNTX_OWNER_UPLOAD_WAN30_REFERENCE_IMAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_reference_1876_000000000001", content_base64: "aGVsbG8=",
      filename: "image.png", mime_type: "image/gif"
    } });
    const badGeneration = await fixture.client.callTool({ name: SYNTX_OWNER_GENERATE_WAN30_REFERENCE_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_reference_1876_000000000001", prompt: "synthetic local validation only",
      parameters: { aspect_ratio: "16:9", resolution: "720P", video_duration: 2, prompt_extend: true,
        shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, duration: 0, rendering_speed: "basic" },
      image_handle: "wan30_reference_image_00000000-0000-4000-8000-000000000001"
    } });
    for (const result of [badUpload, badGeneration]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30ReferenceVideosLifecycle?.close();
  }
});

test("malformed recovery identifiers and list bounds fail with content-only errors", async () => {
  const fixture = await connected(true);
  try {
    const badReconcile = await fixture.client.callTool({ name: SYNTX_OWNER_RECONCILE_WAN30_REFERENCE_VIDEO_TOOL_NAME, arguments: {
      link_attempt_id: "not-a-linked-attempt", recovery_id: "not-a-recovery"
    } });
    const badList = await fixture.client.callTool({ name: SYNTX_OWNER_LIST_WAN30_REFERENCE_RECOVERIES_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_reference_1876_000000000001", limit: 129
    } });
    const badPage = await fixture.client.callTool({ name: SYNTX_OWNER_GET_WAN30_REFERENCE_RESULT_PAGE_TOOL_NAME, arguments: {
      link_attempt_id: "link_wan30_reference_1876_000000000001", recovery_id: "not-a-recovery", offset: 0
    } });
    for (const result of [badReconcile, badList, badPage]) {
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
    }
    assert.equal(fixture.fetchCalls(), 0);
  } finally {
    await fixture.client.close();
    await fixture.server.close();
    await fixture.runtime.ownerWan30ReferenceVideosLifecycle?.close();
  }
});
