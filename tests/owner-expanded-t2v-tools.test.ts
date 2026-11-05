import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { createOwnerExpandedT2vProfiles, type OwnerExpandedT2vModelId } from "../src/application/owner-expanded-t2v-profile.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import {
  SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME,
  SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME,
  registerSyntxOwnerExpandedT2vTools
} from "../src/mcp/owner-expanded-t2v-tools.js";
import { isReviewedMediaFlagEnabled } from "../src/runtime/reviewed-media-profile.js";

type ChoiceSchema = { readonly enum?: unknown; readonly const?: unknown; readonly anyOf?: unknown; readonly allOf?: unknown };

/** Finite enum/const alternatives union; simultaneous allOf restrictions intersect. Unknown branches fail closed. */
function finiteStringChoices(value: unknown): string[] {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  const schema = value as ChoiceSchema;
  let choices: Set<string> | undefined;
  const constrain = (values: readonly string[]) => {
    const next = new Set(values);
    choices = choices === undefined ? next : new Set([...choices].filter(item => next.has(item)));
  };
  if (Object.hasOwn(schema, "const")) { assert.equal(typeof schema.const, "string"); constrain([schema.const as string]); }
  if (Object.hasOwn(schema, "enum")) {
    assert.ok(Array.isArray(schema.enum) && schema.enum.every(item => typeof item === "string"));
    constrain(schema.enum as string[]);
  }
  for (const key of ["anyOf"] as const) if (Object.hasOwn(schema, key)) {
    const branches = schema[key]; assert.ok(Array.isArray(branches) && branches.length > 0);
    constrain(branches.flatMap(finiteStringChoices));
  }
  if (Object.hasOwn(schema, "allOf")) {
    assert.ok(Array.isArray(schema.allOf) && schema.allOf.length > 0);
    for (const branch of schema.allOf) constrain(finiteStringChoices(branch));
  }
  assert.ok(choices !== undefined, "Expected explicitly finite string choices, not an unconstrained schema");
  return [...choices].sort();
}

test("expanded T2V MCP tool schemas expose reviewed controls and route GET recovery without generation", async () => {
  const profiles = createOwnerExpandedT2vProfiles(resolve(process.cwd(), "catalog"));
  const source = profiles.get("happy_horse_t2v")!.source;
  let generationCalls = 0;
  let reconcileCalls = 0;
  let listCalls = 0;
  const server = new McpServer({ name: "expanded-t2v-tools-test", version: "1.0.0" });
  registerSyntxOwnerExpandedT2vTools(server, { service: {
    getParametersSource: (modelId: OwnerExpandedT2vModelId) => profiles.get(modelId)!.source,
    async generate() { generationCalls += 1; return {} as never; },
    async reconcile() { reconcileCalls += 1; return {} as never; },
    listRecoveries() { listCalls += 1; return []; }
  } as never });
  const client = new Client({ name: "expanded-t2v-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listedTools = await client.listTools();
    assert.deepEqual(listedTools.tools.map((tool) => tool.name).sort(), [
      SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME,
      SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME,
      SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME
    ].sort());
    const generateTool = listedTools.tools.find((tool) => tool.name === SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME)!;
    const schema = generateTool.inputSchema as { properties?: Record<string, unknown>; required?: string[];
      additionalProperties?: boolean; oneOf?: Array<{ properties?: Record<string, unknown>; additionalProperties?: boolean }> };
    const models = ["flux3_t2v", "happy_horse_t2v", "seedance-1.5-pro", "seedance_pro", "seedance_pro-fast", "text2video-4.5"].sort();
    assert.deepEqual(finiteStringChoices(schema.properties?.model_id), models);
    assert.deepEqual(finiteStringChoices(schema.properties?.resolution), ["hd", "fhd", "720P", "1080P", "720p", "480p", "1080p"].sort());
    assert.deepEqual(finiteStringChoices(schema.properties?.aspect_ratio), ["auto", "21:9", "2:1", "16:9", "4:3", "1:1", "3:4", "9:16", "169", "916"].sort());
    assert.deepEqual(finiteStringChoices({ allOf: [{ anyOf: [{ const: "a" }, { enum: ["b", "c"] }] }, { enum: ["b", "d"] }] }), ["b"]);
    assert.deepEqual(schema.required?.slice().sort(), ["aspect_ratio", "link_attempt_id", "model_id", "prompt", "video_duration"]);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.oneOf?.length, models.length, "The advertised schema must retain all six discriminated model branches");
    assert.deepEqual(schema.oneOf!.flatMap(branch => finiteStringChoices(branch.properties?.model_id)).sort(), models);
    assert.ok(schema.oneOf!.every(branch => branch.additionalProperties === false));
    const validate = new AjvJsonSchemaValidator().getValidator(generateTool.inputSchema as Parameters<AjvJsonSchemaValidator["getValidator"]>[0]);
    const common = { link_attempt_id: "link_expanded_t2v_sdk_test_0123456789", prompt: "A reviewed synthetic schema scene" };
    const supported = [
      { model_id: "flux3_t2v", video_duration: 5, resolution: "hd", aspect_ratio: "auto", generate_audio: false },
      { model_id: "happy_horse_t2v", video_duration: 5.375, resolution: "720P", aspect_ratio: "16:9", seed: null },
      { model_id: "seedance-1.5-pro", video_duration: 5, resolution: "720p", aspect_ratio: "21:9", generate_audio: false, camera_fixed: false },
      { model_id: "seedance_pro", video_duration: 10, resolution: "480p", aspect_ratio: "16:9" },
      { model_id: "seedance_pro-fast", video_duration: 12, resolution: "1080p", aspect_ratio: "9:16" },
      { model_id: "text2video-4.5", video_duration: "5.0", aspect_ratio: "169", seed: null }
    ];
    for (const fields of supported) {
      assert.equal(validate({ ...common, ...fields }).valid, true, `Supported branch ${fields.model_id}`);
      assert.equal(validate({ ...common, ...fields, unknown_control: true }).valid, false);
    }
    for (const fields of [
      { ...supported[0], resolution: "720P" }, { ...supported[0], camera_fixed: true },
      { ...supported[1], resolution: "720p" }, { ...supported[1], video_duration: 16 }, { ...supported[1], seed: 0.5 }, { ...supported[1], generate_audio: true },
      { ...supported[2], resolution: "1080P" }, { ...supported[2], video_duration: 4 },
      { ...supported[3], video_duration: 7 }, { ...supported[4], aspect_ratio: "21:9" },
      { ...supported[5], video_duration: 5 }, { ...supported[5], resolution: "hd" }, { ...supported[5], seed: -1 }
    ]) assert.equal(validate({ ...common, ...fields }).valid, false, JSON.stringify(fields));
    const { generate_audio: _requiredControl, ...missingRequiredControl } = supported[2]!;
    assert.equal(validate({ ...common, ...missingRequiredControl }).valid, false);
    const parameters = await client.callTool({ name: SYNTX_OWNER_GET_EXPANDED_T2V_PARAMETERS_TOOL_NAME, arguments: { model_id: "happy_horse_t2v" } });
    assert.deepEqual((parameters.structuredContent as { controls: unknown }).controls, source.controls);
    const listed = await client.callTool({ name: SYNTX_OWNER_LIST_EXPANDED_T2V_RECOVERIES_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789"
    } });
    assert.equal(listed.isError, undefined);
    assert.equal(listCalls, 1);
    const reconciled = await client.callTool({ name: SYNTX_OWNER_RECONCILE_EXPANDED_T2V_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789",
      recovery_id: "recovery_00000000-0000-4000-8000-000000000000"
    } });
    assert.equal(reconciled.isError, true);
    assert.equal(reconcileCalls, 1);
    const invalid = await client.callTool({ name: SYNTX_OWNER_GENERATE_EXPANDED_T2V_TOOL_NAME, arguments: {
      model_id: "happy_horse_t2v", link_attempt_id: "link_expanded_t2v_sdk_test_0123456789", prompt: "invalid resolution",
      video_duration: 16, resolution: "720P", aspect_ratio: "16:9"
    } });
    assert.equal(invalid.isError, true);
    assert.equal(generationCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("all-supported profile includes expanded T2V while explicit group overrides retain precedence", () => {
  const env = { SYNTX_OWNER_MEDIA_PROFILE: "all-supported" };
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", undefined, env), true);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", "0", env), false);
  assert.equal(isReviewedMediaFlagEnabled("SYNTX_OWNER_EXPANDED_T2V", "1", { SYNTX_OWNER_MEDIA_PROFILE: "default" }), true);
});

test("expanded T2V owner composition starts only when the trusted owner flag is enabled", async () => {
  const fetchImpl: typeof fetch = async () => { throw new Error("Unexpected startup network request"); };
  const defaults = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(Reflect.get(defaults.serverOptions, "ownerExpandedT2v"), undefined);
  const enabled = createObservedOwnerRuntime({ ownerExpandedT2vEnabled: true, fetchImpl });
  try { assert.ok(Reflect.get(enabled.serverOptions, "ownerExpandedT2v")); }
  finally {
    const lifecycle = Reflect.get(enabled, "ownerExpandedT2vLifecycle") as { close?: () => Promise<void> } | undefined;
    await lifecycle?.close?.();
  }
});
