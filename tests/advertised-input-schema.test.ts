import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod/v4";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { advertisedUnionInputSchema } from "../src/mcp/advertised-input-schema.js";
import { registerSyntxOwnerKlingT2vTools, SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME,
  type RegisterSyntxOwnerKlingT2vToolsOptions } from "../src/mcp/owner-kling-t2v-tools.js";
import { registerSyntxOwnerVeoT2vTools, SYNTX_OWNER_GENERATE_VEO_T2V_TOOL_NAME,
  type RegisterSyntxOwnerVeoT2vToolsOptions } from "../src/mcp/owner-veo-t2v-tools.js";
import { OWNER_KLING_T2V_CONTRACT_VARIANT_IDS } from "../src/application/owner-kling-t2v-profile.js";
import { OWNER_VEO_T2V_CONTRACT_VARIANT_IDS } from "../src/application/owner-veo-t2v-profile.js";

const ATTEMPT = "link_sdk_schema_projection_0123456789";
async function sdk(register: (server: McpServer) => void, run: (client: Client) => Promise<void>): Promise<void> {
  const server = new McpServer({ name: "advertised-input-test", version: "1" }); register(server);
  const client = new Client({ name: "advertised-input-client", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try { await server.connect(host); await client.connect(caller); await run(client); }
  finally { await client.close(); await server.close(); }
}

test("actual SDK advertises closed conditional object branches and preserves canonical defaults/transforms exactly once", async () => {
  let transformations = 0, calls = 0;
  const canonical = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("a"), text: z.string().min(2).transform(value => { transformations++; return value.toUpperCase(); }),
      count: z.number().int().min(1).max(4).default(3) }).strict(),
    z.object({ kind: z.literal("b"), enabled: z.boolean() }).strict()
  ]);
  await sdk(server => server.registerTool("synthetic_union", { inputSchema: advertisedUnionInputSchema(canonical) }, async input => {
    calls++; return { content: [{ type: "text", text: JSON.stringify(input) }] };
  }), async client => {
    const listed = (await client.listTools()).tools[0]!;
    assert.equal(listed.inputSchema.type, "object"); assert.equal(listed.inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(listed.inputSchema.properties!).sort(), ["count", "enabled", "kind", "text"]);
    assert.deepEqual(listed.inputSchema.required, ["kind"]);
    assert.equal((listed.inputSchema.oneOf as unknown[]).length, 2);
    const validate = new AjvJsonSchemaValidator().getValidator(listed.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    assert.equal(validate({ kind: "a", text: "ok" }).valid, true);
    assert.equal(validate({ kind: "a" }).valid, false);
    assert.equal(validate({ kind: "b", enabled: true, count: 2 }).valid, false);
    const good = await client.callTool({ name: listed.name, arguments: { kind: "a", text: "ok" } });
    assert.equal(good.isError, undefined);
    assert.deepEqual(JSON.parse((good.content as Array<{ text: string }>)[0]!.text), { kind: "a", text: "OK", count: 3 });
    assert.equal(transformations, 1); assert.equal(calls, 1);
    for (const bad of [{ kind: "a" }, { kind: "b", enabled: true, count: 2 }, { kind: "b", enabled: true, unknown: 1 }])
      assert.equal((await client.callTool({ name: listed.name, arguments: bad })).isError, true);
    assert.equal(calls, 1);
    assert.equal((await client.callTool({ name: listed.name, arguments: { kind: "b", enabled: false } })).isError, undefined);
    assert.equal(calls, 2);
  });
});

test("actual Kling T2V SDK discovery exposes both model branches and rejects cross-branch/version controls before dispatch", async () => {
  const received: unknown[] = [];
  const service: RegisterSyntxOwnerKlingT2vToolsOptions["service"] = {
    getParametersSource() { throw new Error("unused source getter"); },
    async generate(input) { received.push(input); return { status: "reviewed", confidence_scope: "exact_result_only",
      model_id: input.model_id, operation_id: "generate-video", modality: "video",
      variant_id: OWNER_KLING_T2V_CONTRACT_VARIANT_IDS[input.model_id], artifacts: [] }; },
    async reconcile() { throw new Error("unused reconcile"); }, listRecoveries() { return []; }
  };
  await sdk(server => registerSyntxOwnerKlingT2vTools(server, { service }), async client => {
    const tool = (await client.listTools()).tools.find(t => t.name === SYNTX_OWNER_GENERATE_KLING_T2V_TOOL_NAME)!;
    for (const key of ["link_attempt_id", "model_id", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio"])
      assert.ok(tool.inputSchema.properties?.[key], key);
    const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    const base = { link_attempt_id: ATTEMPT, model_id: "kling_text2video", prompt: "A synthetic test scene", version: "2.6",
      mode: "hd", aspect_ratio: "16:9", video_duration: 5, native_audio: true };
    const o1 = { link_attempt_id: ATTEMPT, model_id: "kling_o1_text2video", prompt: "A synthetic O1 scene", mode: "hd", aspect_ratio: "1:1", video_duration: 10 };
    for (const good of [base, o1]) {
      assert.equal(validate(good).valid, true); assert.equal((await client.callTool({ name: tool.name, arguments: good })).isError, undefined);
    }
    assert.equal(received.length, 2);
    for (const bad of [{ ...o1, version: "1.6" }, { ...o1, native_audio: false }, { ...base, version: "1.5", video_duration: 2 },
      { ...base, version: "2.1-master", mode: "standart" }, { ...base, version: "1.6" }, { ...base, file_urls: [] }]) {
      assert.equal(validate(bad).valid, false); assert.equal((await client.callTool({ name: tool.name, arguments: bad })).isError, true);
    }
    assert.equal(received.length, 2);
    assert.equal((received[0] as { attemptId: string }).attemptId, ATTEMPT);
  });
});

test("actual Veo T2V SDK discovery exposes all numeric choices and keeps its exact eight-second no-reference contract", async () => {
  const received: unknown[] = [];
  const service: RegisterSyntxOwnerVeoT2vToolsOptions["service"] = {
    getParametersSource() { throw new Error("unused source getter"); },
    async generate(input) { received.push(input); return { status: "reviewed", confidence_scope: "exact_result_only",
      model_id: input.model_id, operation_id: "generate-video", modality: "video",
      variant_id: OWNER_VEO_T2V_CONTRACT_VARIANT_IDS[input.model_id], artifacts: [] }; },
    async reconcile() { throw new Error("unused reconcile"); }, listRecoveries() { return []; }
  };
  await sdk(server => registerSyntxOwnerVeoT2vTools(server, { service }), async client => {
    const tool = (await client.listTools()).tools.find(t => t.name === SYNTX_OWNER_GENERATE_VEO_T2V_TOOL_NAME)!;
    for (const key of ["link_attempt_id", "model_id", "prompt", "upscale", "aspect_ratio", "video_duration"])
      assert.ok(tool.inputSchema.properties?.[key], key);
    const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    const base = { link_attempt_id: ATTEMPT, model_id: "veo3", prompt: "A synthetic Veo test", upscale: 2, aspect_ratio: "9:16", video_duration: 8 };
    for (const model_id of ["veo3", "veo3fast", "veo3fast_r"]) {
      const good = { ...base, model_id }; assert.equal(validate(good).valid, true);
      assert.equal((await client.callTool({ name: tool.name, arguments: good })).isError, undefined);
    }
    for (const bad of [{ ...base, upscale: 3 }, { ...base, upscale: "1080p" }, { ...base, video_duration: 6 },
      { ...base, aspect_ratio: "1:1" }, { ...base, file_urls: [] }, { ...base, unknown: true }]) {
      assert.equal(validate(bad).valid, false); assert.equal((await client.callTool({ name: tool.name, arguments: bad })).isError, true);
    }
    assert.equal(received.length, 3);
  });
});
