import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSyntxOwnerVeoOmniParameterTools } from "../src/mcp/owner-veo-omni-parameter-tools.js";

test("read-only Veo Omni tool exposes the current joined source and cost projection without dispatch capability", async () => {
  const server = new McpServer({ name: "veo-omni-source-2087", version: "1.0.0" }, { capabilities: {} });
  const client = new Client({ name: "veo-omni-source-2087-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    registerSyntxOwnerVeoOmniParameterTools(server);
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), ["syntx_get_veo_omni_parameters"]);
    assert.equal(listed.tools[0]?.annotations?.readOnlyHint, true);

    const result = await client.callTool({ name: "syntx_get_veo_omni_parameters", arguments: {} });
    assert.equal(result.isError, undefined);
    const report = result.structuredContent as Record<string, unknown>;
    const sourcePins = report.source_pins as Record<string, unknown>;
    assert.equal(sourcePins.source_build_id, "1792156098");
    assert.deepEqual(sourcePins.modules, {
      veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
      constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
      video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
      quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4",
      app: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042",
      settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
      video_route: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596"
    });
    assert.deepEqual(report.settings_selection, {
      helper_effect: "GLOBAL_SETTINGS_STORE_NOT_PAYLOAD_RETURN",
      dispatch_owner: "VIDEO_ROUTE_NOT_OMNI_FORM",
      truthy_custom_payload: "REPLACE_SETTINGS_SHALLOW_SNAPSHOT",
      otherwise: "SHALLOW_SETTINGS_SNAPSHOT",
      custom_payload_reset: "NULL_ON_RESET_PAGE_SETTINGS",
      references: "OWNED_BINDING_REQUIRED"
    });
    assert.deepEqual(report.cost_projection, {
      caller_keys: ["upscale", "video_duration"],
      video_reference_extra: { mode: "video_ref" },
      mode_in_generation_settings: "NOT_ESTABLISHED_BY_COST_QUERY",
      amount_or_quote: "UNPROVEN"
    });
    assert.equal(report.settings_serializer, "SOURCE_JOINED_COMMON_SETTINGS_BRANCH_REFERENCES_UNBOUND");
    assert.equal(report.runtime_usable, false);
    assert.equal(report.dispatch_allowed, false);
    assert.equal(report.backend_acceptance, "UNPROVEN");
    const content = result.content as readonly { type: string; text?: string }[] | undefined;
    assert.deepEqual(JSON.parse(content?.find((item) => item.type === "text")?.text ?? "null"), report);

    const invalid = await client.callTool({ name: "syntx_get_veo_omni_parameters", arguments: { prompt: "dispatch" } });
    assert.equal(invalid.isError, true);
  } finally {
    await Promise.allSettled([client.close(), server.close(), clientTransport.close(), serverTransport.close()]);
  }
});
