import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createOwnerVeoOmniT2vProfile, OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID } from "../src/application/owner-veo-omni-t2v-profile.js";
import { OwnerReviewedNoReferenceT2vServiceError } from "../src/application/owner-reviewed-no-reference-t2v-service.js";
import {
  registerSyntxOwnerVeoOmniT2vTools,
  SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES
} from "../src/mcp/owner-veo-omni-t2v-tools.js";

const ATTEMPT = "link_veo_omni_tools_attempt_00000001";
const RECOVERY = "recovery_00000000-0000-4000-8000-000000000209";
const SUCCESS = Object.freeze({
  status: "reviewed" as const,
  confidence_scope: "exact_result_only" as const,
  model_id: "veo_omni" as const,
  operation_id: "generate-video" as const,
  modality: "video" as const,
  variant_id: OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID,
  artifacts: Object.freeze([{ url: "https://media.example.test/reviewed.mp4", mime_type: "video/mp4" as const }])
});

async function setup(overrides: { readonly source?: unknown; readonly contractVariant?: string } = {}) {
  const profile = createOwnerVeoOmniT2vProfile("catalog");
  const calls: Array<{ method: string; input: unknown }> = [];
  let unknownGeneration = false;
  const service = {
    getParametersSource() { calls.push({ method: "source", input: {} }); return overrides.source ?? profile.source; },
    getReviewedContract() { return { variant_id: overrides.contractVariant ?? profile.registry.contracts[0]!.variant_id }; },
    async generate(input: unknown) {
      calls.push({ method: "generate", input });
      if (unknownGeneration) throw new OwnerReviewedNoReferenceT2vServiceError("OUTCOME_UNKNOWN", RECOVERY);
      return SUCCESS;
    },
    async reconcile(input: unknown) { calls.push({ method: "reconcile", input }); return SUCCESS; },
    listRecoveries(attemptId: string, limit = 20) {
      calls.push({ method: "list", input: { attemptId, limit } });
      return [{ recovery_id: RECOVERY, model_id: "veo_omni", operation_id: "generate-video", variant_id: OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID, created_at: "2026-10-17T00:00:00.000Z" }].slice(0, limit);
    }
  };
  const server = new McpServer({ name: "veo-omni-t2v-tools-test", version: "1.0.0" });
  registerSyntxOwnerVeoOmniT2vTools(server, { service });
  const client = new Client({ name: "veo-omni-t2v-tools-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client, calls, server,
    unknownGeneration(value: boolean) { unknownGeneration = value; },
    close: async () => { await client.close(); await server.close(); }
  };
}

test("Veo Omni T2V SDK tools expose one fixed model and static source flags", async () => {
  const state = await setup();
  try {
    const listed = await state.client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES);
    assert.deepEqual(listed.tools.map(({ annotations }) => annotations?.readOnlyHint), [true, false, true, true]);
    const source = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[0], arguments: {} }) as CallToolResult;
    assert.equal(source.isError, undefined, JSON.stringify(source));
    const value = source.structuredContent as { status: string; identity: Record<string, unknown>; runtime_usable: boolean; dispatch_allowed: boolean; backend_acceptance: string };
    assert.equal(value.status, "CURRENT_1792156098_SOURCE_JOIN_OMNI_T2V");
    assert.deepEqual(value.identity, { model_id: "veo_omni", ai_name: "veo3", model_type: "veo_omni", operation_id: "generate-video" });
    assert.equal(value.runtime_usable, false);
    assert.equal(value.dispatch_allowed, false);
    assert.equal(value.backend_acceptance, "UNPROVEN");
    assert.equal((await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[0], arguments: { model_id: "veo3" } })).isError, true);
    assert.deepEqual(state.calls.map(({ method }) => method), ["source"]);
  } finally { await state.close(); }
});

test("Veo Omni T2V generation has exact explicit controls and rejects caller-owned wire fields", async () => {
  const state = await setup();
  try {
    const base = { link_attempt_id: ATTEMPT, prompt: "A slow aerial view of a quiet harbor at dawn.", upscale: 3, aspect_ratio: "16:9", video_duration: 10 };
    const generated = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[1], arguments: base }) as CallToolResult;
    assert.equal(generated.isError, undefined, JSON.stringify(generated));
    assert.deepEqual(generated.structuredContent, SUCCESS);
    assert.deepEqual(state.calls.find(({ method }) => method === "generate")?.input, {
      attemptId: ATTEMPT, prompt: base.prompt, upscale: 3, aspect_ratio: "16:9", video_duration: 10
    });

    const invalidInputs = [
      { ...base, prompt: "short" }, { ...base, upscale: 4 }, { ...base, upscale: "4K" },
      { ...base, aspect_ratio: "1:1" }, { ...base, video_duration: 5 }, { ...base, model_id: "veo_omni" },
      { ...base, type: "text" }, { ...base, mode: "video_ref" }, { ...base, n: 2 },
      { ...base, file_urls: [] }, { ...base, raw_reference: "https://media.example.test/input.mp4" },
      { ...base, chat_id: "raw-chat" }, { ...base, url: "https://media.example.test/input.mp4" },
      { ...base, attemptId: ATTEMPT }, { ...base, recovery_id: RECOVERY }
    ];
    for (const arguments_ of invalidInputs) {
      const invalid = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[1], arguments: arguments_ });
      assert.equal(invalid.isError, true, JSON.stringify(arguments_));
    }
    assert.equal(state.calls.filter(({ method }) => method === "generate").length, 1);
  } finally { await state.close(); }
});

test("Veo Omni T2V unknown generation is surfaced with same-handle GET-only recovery", async () => {
  const state = await setup();
  try {
    state.unknownGeneration(true);
    const generated = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[1], arguments: {
      link_attempt_id: ATTEMPT, prompt: "A slow aerial view of a quiet harbor at dawn.", upscale: 1, aspect_ratio: "9:16", video_duration: 6
    } }) as CallToolResult;
    assert.equal(generated.isError, true);
    const text = generated.content.filter((item) => item.type === "text").map((item) => item.text).join(" ");
    assert.match(text, /OUTCOME_UNKNOWN/u);
    assert.match(text, /do not retry/u);
    assert.match(text, new RegExp(RECOVERY, "u"));
    assert.doesNotMatch(text, /attempt|tenant|subject|chat_id|media\.example\.test/u);

    const reconciled = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, recovery_id: RECOVERY
    } }) as CallToolResult;
    assert.equal(reconciled.isError, undefined, JSON.stringify(reconciled));
    assert.deepEqual(state.calls.find(({ method }) => method === "reconcile")?.input, { attemptId: ATTEMPT, recovery_id: RECOVERY });
    const listed = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[3], arguments: { link_attempt_id: ATTEMPT, limit: 1 } }) as CallToolResult;
    assert.equal(listed.isError, undefined, JSON.stringify(listed));
    assert.deepEqual((listed.structuredContent as { recoveries: unknown[] }).recoveries, [{ recovery_id: RECOVERY, model_id: "veo_omni", operation_id: "generate-video", variant_id: OWNER_VEO_OMNI_T2V_CONTRACT_VARIANT_ID, created_at: "2026-10-17T00:00:00.000Z" }]);
    assert.equal(state.calls.filter(({ method }) => method === "generate").length, 1, "recovery must never replay generation");
  } finally { await state.close(); }
});

test("Veo Omni T2V tool guards reject source/engine identity drift", async () => {
  const state = await setup({
    source: { ...createOwnerVeoOmniT2vProfile("catalog").source, identity: { model_id: "veo3", ai_name: "veo3", model_type: "veo3", operation_id: "generate-video" } },
    contractVariant: "some-other-variant"
  });
  try {
    const source = await state.client.callTool({ name: SYNTX_OWNER_VEO_OMNI_T2V_TOOL_NAMES[0], arguments: {} }) as CallToolResult;
    assert.equal(source.isError, true);
    assert.match(source.content.filter((item) => item.type === "text").map((item) => item.text).join(" "), /VEO_OMNI_T2V_UNAVAILABLE/u);
    assert.equal(state.calls.filter(({ method }) => method === "source").length, 1);
  } finally { await state.close(); }
});
