import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { OwnerSeedream55EditorNativeError } from "../src/adapter/syntx/owner-seedream55-editor-native.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerSeedream55EditorService, OwnerSeedream55EditorServiceError } from "../src/application/owner-seedream55-editor-service.js";

const ATTEMPT = "link_seedream55_editor_client_0123456789";
function crc(bytes: Buffer) { let value = 0xffffffff; for (const byte of bytes) {
  value ^= byte; for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
} return (value ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4), check = Buffer.alloc(4); length.writeUInt32BE(data.length); check.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, check]); }
function png15() { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(15, 0); ihdr.writeUInt32BE(15, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.concat(Array.from({ length: 15 }, () => Buffer.from([0, ...Array.from({ length: 15 }, () => [0, 20, 40, 255]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]); }
const PNG = png15();
const CHAT = "editor55-client-chat-1";
const ORIGINAL_URL = "https://r2.syntx.ai/editor55/original.png";
const DRAWING_URL = "https://r2.syntx.ai/editor55/drawing.png";
const RESULT_URL = "https://r2.syntx.ai/editor55/result.png";
const PROMPT = "A precise synthetic Seedream Editor image adjustment";
const BINDING = Object.freeze({ tenant_id: "editor55-client-tenant", subject: "editor55-client-owner" });
const PARAMS = Object.freeze({ aspect_ratio: "1:1", resolution: "2K", output_format: "png", background: "auto" });

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function fixture(options: { losePostResponse?: boolean } = {}) {
  const calls = { chat: 0, original: 0, drawing: 0, generate: 0, history: 0, result: 0, account: 0, access: 0 };
  const uploaded: string[] = [];
  let posted: { chat_uuid: string; prompt: string; settings: Record<string, unknown> } | undefined;
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-editor55-only-credential");
    }
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    assert.equal(url.origin, "https://api.syntx.ai");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-editor55-only-credential");
    if (url.pathname === "/api/v1/user/balance" && method === "GET") {
      calls.account += 1; return response({ balance: "900" });
    }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") {
      calls.account += 1; return response({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" });
    }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") {
      calls.access += 1;
      assert.equal(url.searchParams.get("ai_name"), "seedream");
      assert.equal(url.searchParams.get("model_type"), "seedream-5.5");
      assert.ok(url.searchParams.get("batch_size") === "1" || url.searchParams.get("batch_size") === "2");
      assert.equal(url.searchParams.get("resolution"), "2K");
      return response({ access: true, cost: 3, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      calls.chat += 1;
      assert.deepEqual(JSON.parse(String(init?.body)), { title: "Seedream 5.5 Editor", scope: "tool_image_inpaint" });
      return response({ uuid: CHAT });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      const form = init?.body as FormData;
      assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "seedream-5.5");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      const destination = form.get("destination");
      assert.ok(destination === "uploaded" || destination === "hidden");
      const original = destination === "uploaded";
      assert.equal(file.name, original ? "original.png" : "drawing.png");
      calls[original ? "original" : "drawing"] += 1;
      const uploadUrl = original ? ORIGINAL_URL : DRAWING_URL;
      uploaded.push(uploadUrl);
      return response({ files: [{ id: original ? "1" : "2", url: uploadUrl, mime_type: "image/png", size: PNG.byteLength }] });
    }
    if (url.pathname === "/api/v1/design/generate" && method === "POST") {
      calls.generate += 1;
      assert.equal(url.searchParams.get("ai_name"), "seedream");
      const body = JSON.parse(String(init?.body)) as typeof posted;
      assert.ok(body);
      assert.deepEqual(Object.keys(body).sort(), ["chat_uuid", "prompt", "settings"]);
      assert.equal(body.chat_uuid, CHAT);
      assert.equal(body.prompt, PROMPT);
      assert.deepEqual(Object.keys(body.settings).sort(), ["aspect_ratio", "background", "file_urls", "model_type", "output_format", "resolution", "stream"]);
      assert.equal(Object.hasOwn(body.settings, "n"), false);
      assert.deepEqual(body.settings.file_urls, uploaded.map(entry => ({ type: "image", url: entry })));
      posted = body;
      if (options.losePostResponse) throw new Error("Synthetic post response lost after one dispatch");
      return response({ id: 11 });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/messages` && method === "GET") {
      calls.history += 1;
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("page_size"), "10");
      assert.ok(posted);
      return response({ messages: [
        { id: 11, chat_id: 412, author_id: 100, message_object: [
          ...uploaded.map((entry, index) => ({ id: 101 + index, message_id: 11, object_type: "image", model_type: "seedream-5.5", object_url: entry })),
          { id: 110, message_id: 11, object_type: "text", model_type: "seedream-5.5", object_text: PROMPT }
        ] },
        { id: 22, chat_id: 412, author_id: -1, message_object: [
          { id: 221, message_id: 22, object_type: "image", model_type: "seedream-5.5" }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === `/api/v1/chats/${CHAT}/22` && method === "GET") {
      calls.result += 1;
      return response({ id: 22, chat_id: 412, author_id: -1, message_object: [
        { id: 221, message_id: 22, object_type: "image", model_type: "seedream-5.5", completed: true, object_url: RESULT_URL }
      ] });
    }
    throw new Error(`Unexpected fake HTTP route ${method} ${url.pathname}`);
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
  const readClient = new SyntxHttpClient({ credentialBroker: broker, fetchImpl });
  const native = client.getSeedream55EditorNative();
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return { attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const, linked: true, expires_at: null }; } };
  const service = new OwnerSeedream55EditorService({ binding: BINDING, linkService,
    resolveNative: () => native,
    createAccountStatusService: () => new AccountStatusService(readClient),
    createModelAccessService: (_attemptId, catalog) => new ModelAccessService(catalog, readClient) });
  return { client, native, service, calls, uploaded };
}

async function prepare(fx: ReturnType<typeof fixture>, drawing: boolean) {
  assert.equal(fx.client.getSeedream55EditorNative(), fx.native, "one native adapter per real chat client");
  const original = await fx.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  assert.match(original.reference_handle, /^seedream55_editor_original_/u);
  let drawingHandle: string | null = null;
  if (drawing) {
    const overlay = await fx.service.uploadDrawing({ attemptId: ATTEMPT, original_handle: original.reference_handle,
      content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
    assert.match(overlay.reference_handle, /^seedream55_editor_drawing_/u);
    drawingHandle = overlay.reference_handle;
  }
  return { original_handle: original.reference_handle, drawing_handle: drawingHandle };
}

test("real chat HTTP client wires Editor 5.5 chat, original+drawing, numeric ACK and complete owned result", async () => {
  const fx = fixture();
  try {
    const prepared = await prepare(fx, true);
    const result = await fx.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, parameters: PARAMS,
      original_handle: prepared.original_handle, drawing_handle: prepared.drawing_handle });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.artifacts.map(item => item.url), [RESULT_URL]);
    assert.deepEqual(result.cost_inputs, { batch_size: 2, resolution: "2K" });
    assert.deepEqual(fx.calls, { chat: 1, original: 1, drawing: 1, generate: 1, history: 1, result: 1, account: 4, access: 2 });
    await assert.rejects(fx.native.start({ attemptId: ATTEMPT, chat_uuid: CHAT, token: {} as never }), OwnerSeedream55EditorNativeError);
    await assert.rejects(fx.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, parameters: PARAMS,
      original_handle: prepared.original_handle, drawing_handle: prepared.drawing_handle }),
      (error: unknown) => error instanceof OwnerSeedream55EditorServiceError && error.code === "SERVICE_BUSY");
    assert.equal(fx.calls.generate, 1);
  } finally { await fx.service.close(); }
});

test("real chat HTTP client keeps uncertain Editor 5.5 POST at one attempt and observe uses GET only", async () => {
  const fx = fixture({ losePostResponse: true });
  try {
    const prepared = await prepare(fx, false);
    let recoveryId = "";
    await assert.rejects(fx.service.generate({ attemptId: ATTEMPT, prompt: PROMPT, parameters: PARAMS,
      original_handle: prepared.original_handle, drawing_handle: null }),
      (error: unknown) => { if (!(error instanceof OwnerSeedream55EditorServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
        recoveryId = error.recovery_id ?? ""; return recoveryId.length > 0; });
    const before = { ...fx.calls };
    const result = await fx.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.artifacts.map(item => item.url), [RESULT_URL]);
    assert.deepEqual(result.cost_inputs, { batch_size: 1, resolution: "2K" });
    assert.equal(fx.calls.generate, before.generate);
    assert.equal(fx.calls.original, before.original);
    assert.equal(fx.calls.drawing, before.drawing);
    assert.equal(fx.calls.history, 1);
    assert.equal(fx.calls.result, 1);
  } finally { await fx.service.close(); }
});
