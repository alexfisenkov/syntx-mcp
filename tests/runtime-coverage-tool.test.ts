import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  SYNTX_RUNTIME_COVERAGE_TOOL_NAME,
  registerSyntxRuntimeCoverageTool
} from "../src/mcp/runtime-coverage-tool.js";

async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(createDefaultApplication());
  await server.connect(serverTransport);
  const client = new Client({ name: "runtime-coverage-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("runtime coverage is a stable default read-only tool", async () => {
  await withClient(async (client) => {
    const listed = await client.listTools();
    const tool = listed.tools.find((item) => item.name === SYNTX_RUNTIME_COVERAGE_TOOL_NAME);
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.deepEqual(tool.inputSchema.required, undefined);
  });
});

test("runtime coverage returns exactly the redacted live profile inventory", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: SYNTX_RUNTIME_COVERAGE_TOOL_NAME,
      arguments: {}
    });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as Record<string, unknown>;
    assert.equal(value.schema_version, "2.0.0");
    assert.equal(value.runtime_scope, "owner");
    assert.equal(value.network_access, false);
    assert.equal(value.paid_operations, false);
    const profiles = value.profiles as Array<Record<string, unknown>>;
    assert.equal(profiles.length, 32);
    assert.deepEqual(
      profiles.filter((profile) => profile.modality === "image").map((profile) => profile.model_id),
      ["banana", "banana-2.1", "gpt-image-1", "gpt-image-1.5", "ideogram", "flux-1", "seedream-4", "seedream-4.5", "seedream-5", "seedream-5.0-pro", "grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality", "runway_frames", "wan_26_t2i", "uni-1", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare"]
    );
    assert.deepEqual(
      profiles.filter((profile) => profile.modality === "video").map((profile) => profile.model_id),
      ["seedance-2.0", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "kling_text2video", "ray-3.14", "sora_1", "wan_26_t2v", "wan_27_t2v", "flux3_t2v", "happy_horse_t2v", "text2video", "text2video-4.5"]
    );
    for (const profile of profiles) {
      assert.equal(profile.runtime_verified, true);
      assert.equal(profile.catalog_only, false);
      assert.equal(profile.one_copy_only, true);
      assert.ok(Array.isArray(profile.result_mime_types));
      assert.equal(profile.cancel_mode, "OPEN");
      const outputSchema = profile.output_schema as Record<string, unknown>;
      assert.equal(outputSchema.type, "object");
      assert.equal(
        outputSchema.artifact_field,
        profile.modality === "image" ? "images" : "videos"
      );
      assert.deepEqual(outputSchema.artifact_mime_types, profile.result_mime_types);
      assert.deepEqual(outputSchema.required_fields, [
        outputSchema.artifact_field,
        "requested_copies",
        "succeeded_copies",
        "notes"
      ]);
      assert.equal(outputSchema.additional_properties, false);
      assert.ok(Array.isArray(profile.unsupported_notes));
      assert.equal("prompt" in (profile.settings as Record<string, unknown>), false);
      assert.equal("credentials" in profile, false);
    }
    const sunburst = profiles.find((profile) => profile.model_id === "gpt-image-2.5-sunburst");
    assert.ok(sunburst);
    assert.deepEqual(sunburst.settings_variants, [{
      id: "sunburst-2k-high-16x9",
      settings: {
        model_type: "gpt-image-2.5-sunburst",
        aspect_ratio: "16:9",
        details_quality: "high",
        quality: "2K"
      },
      runtime_verified: true
    }, {
      id: "sunburst-4k-max-21x9",
      settings: {
        model_type: "gpt-image-2.5-sunburst",
        aspect_ratio: "21:9",
        details_quality: "max",
        quality: "4K"
      },
      runtime_verified: true
    }]);
    const flare = profiles.find((profile) => profile.model_id === "gpt-image-2.5-flare");
    assert.ok(flare);
    assert.deepEqual(flare.settings_variants, [{
      id: "flare-2k-high-16x9",
      settings: {
        model_type: "gpt-image-2.5-flare",
        aspect_ratio: "16:9",
        details_quality: "high",
        quality: "2K"
      },
      runtime_verified: true
    }]);
    const banana21 = profiles.find((profile) => profile.model_id === "banana-2.1");
    assert.ok(banana21);
    assert.equal(banana21.ai_name, "banana");
    assert.deepEqual(banana21.settings, {
      n: 1,
      model_type: "banana-2.1",
      aspect_ratio: "1:1",
      image_size: "1K",
      thinking_level: "minimal",
      file_urls: []
    });
    assert.deepEqual(banana21.result_mime_types, ["image/jpeg"]);
    const catalogOnly = value.catalog_only as Record<string, unknown>;
    assert.ok((catalogOnly.model_ids as string[]).includes("veo-omni-flash"));
    assert.ok((catalogOnly.model_ids as string[]).includes("hailuo-2.3-fast"));
  });
});

test("runtime coverage separates historical terminal proofs from current catalog availability", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: SYNTX_RUNTIME_COVERAGE_TOOL_NAME, arguments: {} });
    assert.equal(result.isError, undefined);
    const value = result.structuredContent as Record<string, unknown>;
    const profiles = value.profiles as Array<Record<string, unknown>>;
    assert.equal(profiles.length, 32);
    const byId = new Map(profiles.map((profile) => [profile.model_id, profile]));
    assert.equal(byId.get("sora_1")?.runtime_verified, true);
    assert.equal(byId.get("sora_1")?.current_catalog_status, "INACTIVE");
    assert.equal(byId.get("text2video")?.runtime_verified, true);
    assert.equal(byId.get("text2video")?.current_catalog_status, "NOT_IN_CATALOG");
    assert.equal([...byId.values()].filter((profile) => profile.current_catalog_status === "AVAILABLE_IN_SNAPSHOT").length, 30);
    assert.equal(byId.get("banana-2.1")?.current_catalog_status, "AVAILABLE_IN_SNAPSHOT");
    for (const profile of profiles) {
      assert.equal(profile.verification_scope, "HISTORICAL_OWNER_GENERATION_AND_TERMINAL_RESULT");
      assert.match((profile.verification_notes as string[]).join(" "), /does not establish current catalog availability, account entitlement, or current runtime behavior/u);
    }
  });
});

test("runtime coverage reports NOT_CHECKED when no official-current catalog binding exists", async () => {
  const server = new McpServer({ name: "runtime-coverage-unbound-test", version: "1.0.0" });
  registerSyntxRuntimeCoverageTool(server, {
    resolveCurrentModel: () => ({ catalog_kind: "PUBLIC_SAMPLE", model: { id: "banana", active: true } })
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "runtime-coverage-unbound-client", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: SYNTX_RUNTIME_COVERAGE_TOOL_NAME, arguments: {} });
    const profiles = (result.structuredContent as { profiles: Array<{ current_catalog_status: string }> }).profiles;
    assert.ok(profiles.every((profile) => profile.current_catalog_status === "NOT_CHECKED"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("runtime coverage rejects unknown input before any resolver or network path", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: SYNTX_RUNTIME_COVERAGE_TOOL_NAME,
      arguments: { model_id: "not-accepted" }
    });
    assert.equal(result.isError, true);
  });
});
