import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { join } from "node:path";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerWan25I2vPreviewFlag } from "../src/transports/stdio-owner.js";

const TOOL_NAMES = Object.freeze([
  "syntx_owner_get_wan25_i2v_preview_parameters",
  "syntx_owner_upload_wan25_i2v_preview_image",
  "syntx_owner_generate_wan25_i2v_preview_video",
  "syntx_owner_reconcile_wan25_i2v_preview_video",
  "syntx_owner_list_wan25_i2v_preview_recoveries",
  "syntx_owner_get_wan25_i2v_preview_result_page"
] as const);
const CATALOG_DIRECTORY = join(process.cwd(), "catalog");
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

interface SyntheticState {
  readonly wallNow: number;
  imageUploads: number;
  chatCreates: number;
  generationPosts: number;
  historyGets: number;
  resultGets: number;
  balanceReads: number;
  subscriptionReads: number;
  costParameters: Readonly<Record<string, string>>[];
  chatUuid?: string;
  prompt?: string;
  ack?: string;
}

function png384(): Buffer {
  const bytes = Buffer.from(PNG_BASE64, "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29); return bytes;
}

function json(value: unknown): Response { return Response.json(value); }
function page(messages: readonly unknown[]) {
  return { messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
    total_pages: messages.length === 0 ? 0 : 1, has_next: false, has_previous: false } };
}
function structured<T extends Record<string, unknown>>(result: unknown): T {
  assert.ok(result && typeof result === "object", "stock SDK returns a call result");
  const value = Reflect.get(result, "structuredContent"); assert.ok(value && typeof value === "object", "stock SDK returns structuredContent");
  return value as T;
}
function syntheticFetch(state: SyntheticState): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init.method ?? (input instanceof Request ? input.method : "GET");
    if (url.pathname === "/api/v1/auth/startauth" && method === "POST") {
      return json({ uuid: "00000000-0000-4000-8000-000000000190" });
    }
    if (url.pathname === "/api/v1/auth/token/00000000-0000-4000-8000-000000000190" && method === "GET") {
      return json({ valid: true, complete: true, token: "synthetic-wan25-1690-token", is_new_user: false });
    }
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      state.balanceReads += 1; return json({ balance: "920.5" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      state.subscriptionReads += 1; return json({ active: true, type: "PRO", end_date: new Date(state.wallNow + 60 * 60_000).toISOString() });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      state.costParameters.push(Object.freeze(Object.fromEntries(url.searchParams.entries())));
      return json({ access: true, cost: 7.5, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init.body as FormData, file = form.get("files"); assert.ok(file instanceof File);
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "wan_25_i2v_preview"); state.imageUploads += 1;
      return json({ files: [{ id: `wan25-image-${state.imageUploads}`, url: `https://r2.syntx.ai/uploaded/${file.name}`,
        filename: file.name, mime_type: file.type, content_type: file.type, media_type: "image", type: "image", size: file.size, status: "uploaded" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      state.chatCreates += 1; state.chatUuid = `wan25-preview-chat-${state.chatCreates}`; return json({ uuid: state.chatUuid });
    }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      const body = JSON.parse(String(init.body)) as { chat_id: string; prompt: string; settings: Record<string, unknown> };
      assert.equal(url.searchParams.get("ai_name"), "wan_video"); assert.equal(body.settings.model_type, "wan_25_i2v_preview");
      assert.equal(body.settings.native_audio, false); assert.equal(Object.hasOwn(body.settings, "duration"), false);
      assert.deepEqual(body.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/uploaded/preview.png" }]);
      state.prompt = body.prompt; state.generationPosts += 1; state.ack = `wan25-preview-ack-${state.generationPosts}`;
      return json({ id: state.ack });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      state.historyGets += 1; const chat = decodeURIComponent(history[1]!);
      const owner = { id: state.ack, chat_id: 421, author_id: 27,
        message_object: [{ id: `owner-text-${chat}`, message_id: state.ack, object_type: "text", model_type: "wan_25_i2v_preview", object_text: state.prompt }] };
      const bot = { id: `wan25-preview-video-message-${chat}`, chat_id: 421, author_id: -1,
        message_object: [{ id: `wan25-preview-video-${chat}`, message_id: `wan25-preview-video-message-${chat}`,
          object_type: "video", model_type: "wan_25_i2v_preview", completed: true }] };
      return json(page([owner, bot]));
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      state.resultGets += 1; const chat = decodeURIComponent(result[1]!); const message = decodeURIComponent(result[2]!);
      return json({ id: message, chat_id: 421, author_id: -1, message_object: [{ id: `wan25-preview-video-${chat}`,
        message_id: message, object_type: "video", model_type: "wan_25_i2v_preview", completed: true,
        object_url: `https://r2.syntx.ai/generated/${chat}.mp4` }] });
    }
    throw new Error(`unexpected synthetic request ${method} ${url.pathname}`);
  };
}

test("WAN25 preview registration is opt-in, schemas reject foreign input, and stock SDK drives one real composed image-only flow", async () => {
  assert.equal(readOwnerWan25I2vPreviewFlag(undefined), false);
  assert.equal(readOwnerWan25I2vPreviewFlag(""), false);
  assert.equal(readOwnerWan25I2vPreviewFlag("0"), false);
  assert.equal(readOwnerWan25I2vPreviewFlag("1"), true);
  assert.throws(() => readOwnerWan25I2vPreviewFlag("true"));

  const state: SyntheticState = { wallNow: Date.now(), imageUploads: 0, chatCreates: 0, generationPosts: 0,
    historyGets: 0, resultGets: 0, balanceReads: 0, subscriptionReads: 0, costParameters: [] };
  const fetchImpl = syntheticFetch(state);
  const baseline = createObservedOwnerRuntime({ fetchImpl, catalogDirectory: CATALOG_DIRECTORY, now: () => state.wallNow });
  const baselineServer = createMcpServer(baseline.application, baseline.serverOptions);
  const baselineClient = new Client({ name: "wan25-preview-default-off-1690", version: "1" });
  const [baselineClientTransport, baselineServerTransport] = InMemoryTransport.createLinkedPair();
  let baselineNames: string[] = [];
  try {
    await baselineServer.connect(baselineServerTransport); await baselineClient.connect(baselineClientTransport);
    baselineNames = (await baselineClient.listTools()).tools.map(({ name }) => name);
    assert.equal(baselineNames.some((name) => (TOOL_NAMES as readonly string[]).includes(name)), false);
  } finally {
    await baselineClient.close().catch(() => undefined); await baselineServer.close().catch(() => undefined);
    baseline.authStore.close?.();
  }

  const runtime = createObservedOwnerRuntime({ ownerWan25I2vPreviewEnabled: true, fetchImpl,
    catalogDirectory: CATALOG_DIRECTORY, now: () => state.wallNow, requestTimeoutMs: 10_000 });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "wan25-preview-stock-sdk-1690", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  const image = png384();
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const listed = await client.listTools(), names = listed.tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (TOOL_NAMES as readonly string[]).includes(name)), TOOL_NAMES);
    assert.ok(baselineNames.every((name) => names.includes(name)), "opt-in preserves the previous tool surface");
    const parameter = listed.tools.find(({ name }) => name === TOOL_NAMES[0]); assert.equal(parameter?.annotations?.readOnlyHint, true);
    const parameterResult = structured<{ status: string; model_id: string; public_catalog_version: string;
      files_mention: boolean; native_audio: boolean; audio_integration_status: string; dispatch_allowed: boolean;
      provider_acceptance: string; cost_keys: string[] }>(await call(TOOL_NAMES[0], {}));
    assert.equal(parameterResult.status, "ready"); assert.equal(parameterResult.model_id, "wan_25_i2v_preview");
    assert.equal(parameterResult.public_catalog_version, "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
    assert.equal(parameterResult.files_mention, false); assert.equal(parameterResult.native_audio, false);
    assert.equal(parameterResult.audio_integration_status, "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE");
    assert.equal(parameterResult.dispatch_allowed, false); assert.equal(parameterResult.provider_acceptance, "UNPROVEN");
    assert.deepEqual(parameterResult.cost_keys, ["resolution", "video_duration"]);

    const begin = structured<{ attempt_id: string; status: string }>(await call("syntx_begin_login", {}));
    assert.equal(begin.status, "HANDOFF_ISSUED");
    const attempt = structured<{ attempt_id: string; status: string; linked: boolean }>(await call("syntx_check_login", { attempt_id: begin.attempt_id }));
    assert.equal(attempt.status, "LINKED"); assert.equal(attempt.linked, true);

    const foreignModel = await call(TOOL_NAMES[1], { link_attempt_id: begin.attempt_id, model_id: "wan_26_i2v",
      filename: "preview.png", mime_type: "image/png", content_base64: PNG_BASE64 });
    assert.equal(foreignModel.isError, true, "SDK must reject the foreign model ID against the exact preview enum");
    const callerUrl = await call(TOOL_NAMES[1], { link_attempt_id: begin.attempt_id, model_id: "wan_25_i2v_preview",
      filename: "preview.png", mime_type: "image/png", content_base64: PNG_BASE64, image_url: "https://caller.invalid/frame.png" });
    assert.equal(callerUrl.isError, true, "SDK must reject unknown caller URL fields against the strict tool schema");
    assert.equal(state.imageUploads, 0, "invalid foreign/URL input must not upload");

    const uploaded = structured<{ status: string; image_handle: string; model_id: string; width: number; height: number;
      generation_permit: false; [key: string]: unknown }>(await call(TOOL_NAMES[1], { link_attempt_id: begin.attempt_id,
      model_id: "wan_25_i2v_preview", filename: "preview.png", mime_type: "image/png", content_base64: image.toString("base64") }));
    assert.equal(uploaded.status, "uploaded"); assert.equal(uploaded.model_id, "wan_25_i2v_preview");
    assert.equal(uploaded.width, 384); assert.equal(uploaded.height, 384); assert.equal(uploaded.generation_permit, false);
    assert.equal("url" in uploaded, false); assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);
    const generated = structured<{ status: string; model_id: string; recovery_id: string; observed_artifact_count: number;
      status_semantics: string; provider_terminal_status: string; backend_acceptance: string; cost_cap_enforced: false;
      artifacts: readonly { object_url: string; model_id: string }[] }>(await call(TOOL_NAMES[2], { link_attempt_id: begin.attempt_id,
      model_id: "wan_25_i2v_preview", image_handle: uploaded.image_handle, audio_handle: null, prompt: "A quiet preview shot.",
      resolution: "480P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0 }));
    assert.equal(generated.status, "completed"); assert.equal(generated.model_id, "wan_25_i2v_preview");
    assert.equal(generated.observed_artifact_count, 1); assert.equal(generated.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(generated.provider_terminal_status, "UNPROVEN"); assert.equal(generated.backend_acceptance, "UNPROVEN");
    assert.equal(generated.cost_cap_enforced, false); assert.equal(generated.artifacts[0]?.model_id, "wan_25_i2v_preview");

    const reconciled = structured<{ status: string; recovery_id: string }>(await call(TOOL_NAMES[3], {
      link_attempt_id: begin.attempt_id, recovery_id: generated.recovery_id }));
    assert.equal(reconciled.status, "completed"); assert.equal(reconciled.recovery_id, generated.recovery_id);
    const listedRecoveries = structured<{ status: string; recoveries: readonly { recovery_id: string }[] }>(await call(TOOL_NAMES[4], { link_attempt_id: begin.attempt_id }));
    assert.equal(listedRecoveries.status, "listed"); assert.equal(listedRecoveries.recoveries[0]?.recovery_id, generated.recovery_id);
    const resultPage = structured<{ status: string; recovery_id: string; artifacts: readonly { object_url: string }[] }>(await call(TOOL_NAMES[5], {
      link_attempt_id: begin.attempt_id, recovery_id: generated.recovery_id, offset: 0 }));
    assert.equal(resultPage.status, "completed"); assert.equal(resultPage.recovery_id, generated.recovery_id);
    assert.deepEqual(state.costParameters.map((values) => Object.keys(values).filter((key) => key !== "ai_name" && key !== "model_type").sort()),
      [["resolution", "video_duration"], ["resolution", "video_duration"]]);
    assert.equal(state.chatCreates, 1); assert.equal(state.generationPosts, 1); assert.equal(state.historyGets, 2);
    assert.ok(state.resultGets >= 2); assert.ok(state.balanceReads >= 2); assert.ok(state.subscriptionReads >= 2);
  } finally {
    image.fill(0); await client.close().catch(() => undefined); await server.close().catch(() => undefined);
    await runtime.ownerWan25I2vPreviewLifecycle?.close().catch(() => undefined); runtime.authStore.close?.();
  }
});
