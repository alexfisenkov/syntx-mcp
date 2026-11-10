import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const newNames = [
  "syntx_get_gpt26_image_parameters", "syntx_upload_gpt26_image_reference",
  "syntx_owner_generate_gpt26_image", "syntx_owner_reconcile_gpt26_image", "syntx_owner_list_gpt26_image_recoveries",
  "syntx_get_seedream55_image_parameters", "syntx_upload_seedream55_image_reference",
  "syntx_owner_generate_seedream55_image", "syntx_owner_reconcile_seedream55_image", "syntx_owner_list_seedream55_image_recoveries",
  "syntx_owner_get_veo_omni12_current_source", "syntx_owner_generate_veo_omni12_current",
  "syntx_owner_get_veo_omni12_current_result", "syntx_owner_list_veo_omni12_current_recoveries"
] as const;

async function toolNames(runtime: ReturnType<typeof createObservedOwnerRuntime>): Promise<string[]> {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "nov10-runtime-composition", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  await server.connect(host); await client.connect(caller);
  try { return (await client.listTools()).tools.map(tool => tool.name); }
  finally { await client.close(); await server.close(); }
}

test("new media tools are default-off and opt-in to isolated fresh source instances", async () => {
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => { networkCalls++; throw new Error("Unexpected provider request during composition"); };
  const ordinary = createObservedOwnerRuntime({ fetchImpl });
  const defaultNames = await toolNames(ordinary);
  for (const name of newNames) assert.equal(defaultNames.includes(name), false, name);
  const enabled = createObservedOwnerRuntime({ fetchImpl, ownerStandardImageReferencesEnabled: true,
    ownerSeedreamImageReferencesEnabled: true, ownerCurrentVideoReferencesEnabled: true,
    ownerCurrentVideoFfprobePath: join(process.cwd(), "unused-current-video-probe") });
  try {
    assert.ok(enabled.serverOptions.ownerStandardImageReferences);
    assert.ok(enabled.serverOptions.ownerGpt26ImageReferences);
    assert.notEqual(enabled.serverOptions.ownerStandardImageReferences.generationService,
      enabled.serverOptions.ownerGpt26ImageReferences.generationService);
    assert.ok(enabled.serverOptions.ownerSeedreamImageReferences);
    assert.ok(enabled.serverOptions.ownerSeedream55ImageReferences);
    assert.notEqual(enabled.serverOptions.ownerSeedreamImageReferences.generationService,
      enabled.serverOptions.ownerSeedream55ImageReferences.generationService);
    assert.ok(enabled.serverOptions.ownerVeo3Current);
    assert.ok(enabled.serverOptions.ownerVeoOmni12Current);
    assert.notEqual(enabled.serverOptions.ownerVeo3Current.service, enabled.serverOptions.ownerVeoOmni12Current.service);
    const names = await toolNames(enabled);
    for (const name of newNames) assert.equal(names.filter(candidate => candidate === name).length, 1, name);
    for (const legacy of ["syntx_owner_generate_standard_image", "syntx_owner_generate_seedream_image", "syntx_owner_generate_veo3_current"])
      assert.ok(names.includes(legacy), legacy);
    assert.equal(networkCalls, 0);
  } finally {
    const closable = [enabled.serverOptions.ownerStandardImageReferences?.generationService,
      enabled.serverOptions.ownerGpt26ImageReferences?.generationService,
      enabled.serverOptions.ownerSeedreamImageReferences?.generationService,
      enabled.serverOptions.ownerSeedream55ImageReferences?.generationService,
      enabled.ownerCurrentVideoLifecycle];
    await Promise.all(closable.map(service => service === undefined ? Promise.resolve() :
      (service as { close(): Promise<void> }).close()));
  }
});
