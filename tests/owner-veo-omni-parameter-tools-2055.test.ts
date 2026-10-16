import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getOwnerVeoOmniGenerationParameterReport } from "../src/application/owner-veo-omni-parameters.js";
import { registerSyntxOwnerVeoOmniParameterTools } from "../src/mcp/owner-veo-omni-parameter-tools.js";

const TOOL_NAME = "syntx_get_veo_omni_parameters";

test("read-only Veo Omni parameter tool returns the pinned static report through the SDK", async () => {
  const server = new McpServer({ name: "veo-omni-parameter-fixture", version: "1.0.0" }, { capabilities: {} });
  const client = new Client({ name: "veo-omni-parameter-fixture-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerVeoOmniParameterTools(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), [TOOL_NAME]);
    const tool = listed.tools[0]!;
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.idempotentHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);

    const result = await client.callTool({ name: TOOL_NAME, arguments: {} });
    assert.equal(result.isError, undefined);
    const report = result.structuredContent as Record<string, any>;
    assert.equal(report.status, "SOURCE_REVIEWED_STATIC_ONLY");
    assert.equal(report.model_id, "veo_omni");
    assert.equal(report.ai_name, "veo3");
    assert.deepEqual(report.source_pins, {
      public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
      public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
      source_build_id: "1792133067",
      modules: {
        veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
        constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
        video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
        quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4"
      }
    });
    assert.deepEqual(report.controls.type, ["text", "image", "references"]);
    assert.deepEqual(report.controls.upscale.values, [0, 1, 2, 3]);
    assert.deepEqual(report.controls.upscale.labels, { 0: "720p", 1: "1080p", 2: "4K", 3: "360p Draft" });
    assert.deepEqual(report.controls.aspect_ratio, ["16:9", "9:16"]);
    assert.deepEqual(report.controls.video_duration, [4, 6, 8, 10]);
    assert.deepEqual(report.controls.reference_counts, {
      text: { images: [0, 0], videos: [0, 0] },
      image: { images: [1, 2], videos: [0, 0] },
      references: { images_only: { images: [1, 7], videos: [0, 0] }, one_video_with_images: { images: [0, 5], videos: [1, 1] } }
    });
    assert.deepEqual(report.controls.initializer_candidate, { type: "text", aspect_ratio: "16:9", video_duration: 8, upscale: 0,
      semantics: "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT" });
    assert.equal(report.effective_defaults, "UNKNOWN");
    assert.equal(report.duration_upscale_compatibility, "UNKNOWN_NOT_ENFORCED");
    assert.equal(report.settings_serializer, "PARTIALLY_JOINED_CALLER_ONLY_NOT_WIRE_CONTRACT");
    assert.equal(report.runtime_usable, false);
    assert.equal(report.dispatch_allowed, false);
    assert.equal(report.backend_acceptance, "UNPROVEN");
    const textBlocks = result.content as readonly { type: string; text?: string }[] | undefined;
    assert.deepEqual(JSON.parse(textBlocks?.find((item) => item.type === "text")?.text ?? "null"), report);
    assert.deepEqual(report, getOwnerVeoOmniGenerationParameterReport());

    const invalid = await client.callTool({ name: TOOL_NAME, arguments: { unexpected: true } });
    assert.equal(invalid.isError, true);
  } finally {
    await Promise.allSettled([client.close(), server.close(), clientTransport.close(), serverTransport.close()]);
  }
});
