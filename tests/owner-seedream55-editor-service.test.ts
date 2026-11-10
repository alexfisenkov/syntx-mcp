import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { createOwnerSeedream55EditorNative } from "../src/adapter/syntx/owner-seedream55-editor-native.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerSeedream55EditorService, OwnerSeedream55EditorServiceError } from "../src/application/owner-seedream55-editor-service.js";

const ATTEMPT = "link_seedream55_editor_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "seedream55-editor-tenant", subject: "seedream55-editor-owner" });
const ORIGINAL_URL = "https://r2.syntx.ai/seedream55/editor-original.png";
const DRAWING_URL = "https://r2.syntx.ai/seedream55/editor-drawing.png";
const RESULT_URL = "https://r2.syntx.ai/seedream55/editor-result.png";
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
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function fixture(unknownPost = false, badHistory = false) {
  const calls = { uploadOriginal: 0, uploadDrawing: 0, chat: 0, post: 0, history: 0, result: 0, account: 0, access: 0 };
  let lastSettings: Record<string, unknown> | null = null, originalUrl = ORIGINAL_URL, drawingUrl = DRAWING_URL;
  const native = createOwnerSeedream55EditorNative({
    async createChat() { calls.chat += 1; return { chat_uuid: "editor-chat-1" }; },
    async uploadOriginal() { calls.uploadOriginal += 1; return { url: originalUrl }; },
    async uploadDrawing() { calls.uploadDrawing += 1; return { url: drawingUrl }; },
    async postGenerate(input) { calls.post += 1; lastSettings = input.settings as Record<string, unknown>;
      if (unknownPost) throw new Error("synthetic response loss"); return { message_id: "1" }; },
    async getHistoryPage() { calls.history += 1; const files = (lastSettings?.file_urls ?? []) as Array<{url:string}>;
      return { messages: [
        { id: 1, chat_id: 412, author_id: 100, message_object: [
          ...files.map((file, index) => ({ id: 10 + index, message_id: 1, object_type: "image", model_type: "seedream-5.5",
            object_url: badHistory ? "https://r2.syntx.ai/wrong.png" : file.url })),
          { id: 19, message_id: 1, object_type: "text", model_type: "seedream-5.5", object_text: "synthetic editor change" }
        ] },
        { id: 2, chat_id: 412, author_id: -1, message_object: [{ id: 20, message_id: 2,
          object_type: "image", model_type: "seedream-5.5" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }; },
    async getRawResult() { calls.result += 1; return { id: 2, chat_id: 412, author_id: -1,
      message_object: [{ id: 20, message_id: 2, object_type: "image", model_type: "seedream-5.5",
        completed: true, object_url: RESULT_URL }] }; }
  });
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-credential"); } };
  const http = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/user/balance") { calls.account += 1; return Response.json({ balance: "900" }); }
    if (path === "/api/v1/user/subscription") { calls.account += 1; return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00.000Z" }); }
    if (path === "/api/v2/get_model_info") { calls.access += 1; return Response.json({ access: true, cost: 3,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }
    throw new Error("unexpected fake route");
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return { attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const, linked: true,
    expires_at: null }; } };
  const service = new OwnerSeedream55EditorService({ binding: BINDING, linkService, resolveNative: () => native,
    createAccountStatusService: () => new AccountStatusService(http),
    createModelAccessService: (_attemptId, catalog) => new ModelAccessService(catalog, http) });
  return { service, calls, get settings() { return lastSettings; }, setUploadUrls(original: string, drawing: string) {
    originalUrl = original; drawingUrl = drawing; } };
}
const params = { aspect_ratio: "1:1", resolution: "2K", output_format: "png", background: "auto" };

test("55 Editor service sends one source-bound POST with owned original and GET result", async () => {
  const rig = fixture();
  try {
    const original = await rig.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"),
      filename: "original.png", mime_type: "image/png" });
    const result = await rig.service.generate({ attemptId: ATTEMPT, prompt: "synthetic editor change", parameters: params,
      original_handle: original.reference_handle, drawing_handle: null });
    assert.equal(result.status, "completed");
    assert.equal(result.artifacts[0]?.url, RESULT_URL);
    assert.deepEqual(rig.settings, { stream: false, model_type: "seedream-5.5", ...params,
      file_urls: [{ type: "image", url: ORIGINAL_URL }] });
    assert.deepEqual(result.cost_inputs, { batch_size: 1, resolution: "2K" });
    assert.deepEqual([rig.calls.uploadOriginal, rig.calls.chat, rig.calls.post, rig.calls.history, rig.calls.result], [1, 1, 1, 1, 1]);
    assert.equal(rig.calls.account, 4); assert.equal(rig.calls.access, 2);
    const page = await rig.service.getResultPage({ attemptId: ATTEMPT, result_id: result.result_id, offset: 0, limit: 64 });
    assert.equal(page.artifacts.length, 1);
  } finally { await rig.service.close(); }
});

test("55 Editor service pairs optional drawing and recovers unknown ACK with GET only", async () => {
  const rig = fixture(true);
  try {
    const original = await rig.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"),
      filename: "original.png", mime_type: "image/png" });
    const drawing = await rig.service.uploadDrawing({ attemptId: ATTEMPT, original_handle: original.reference_handle,
      content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, prompt: "synthetic editor change", parameters: params,
      original_handle: original.reference_handle, drawing_handle: drawing.reference_handle }), (error: unknown) => {
      if (!(error instanceof OwnerSeedream55EditorServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? ""; return recoveryId.length > 0;
    });
    assert.equal(rig.calls.post, 1);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "completed");
    assert.deepEqual(result.cost_inputs, { batch_size: 2, resolution: "2K" });
    assert.deepEqual(rig.settings?.file_urls, [{ type: "image", url: ORIGINAL_URL }, { type: "image", url: DRAWING_URL }]);
    assert.equal(rig.calls.post, 1);
  } finally { await rig.service.close(); }
});

test("55 Editor unknown paid intent stays claimed across unlink and relink of the same owner", async () => {
  const rig = fixture(true);
  const nextAttempt = "link_seedream55_editor_relinked_0123456789";
  try {
    const original = await rig.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"),
      filename: "original.png", mime_type: "image/png" });
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, prompt: "synthetic editor change", parameters: params,
      original_handle: original.reference_handle, drawing_handle: null }),
    (error: unknown) => error instanceof OwnerSeedream55EditorServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(rig.calls.post, 1);
    await rig.service.invalidateAttempt(ATTEMPT);
    const sameBytesNewAttempt = await rig.service.uploadOriginal({ attemptId: nextAttempt,
      content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
    const before = { chat: rig.calls.chat, post: rig.calls.post, account: rig.calls.account, access: rig.calls.access };
    await assert.rejects(rig.service.generate({ attemptId: nextAttempt, prompt: "synthetic editor change", parameters: params,
      original_handle: sameBytesNewAttempt.reference_handle, drawing_handle: null }),
    (error: unknown) => error instanceof OwnerSeedream55EditorServiceError && error.code === "SERVICE_BUSY");
    assert.deepEqual({ chat: rig.calls.chat, post: rig.calls.post, account: rig.calls.account, access: rig.calls.access }, before);
  } finally { await rig.service.close(); }
});

test("55 Editor no-ACK recovery refuses foreign file history without another POST or result GET", async () => {
  const rig = fixture(true, true);
  try {
    const original = await rig.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"),
      filename: "original.png", mime_type: "image/png" });
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, prompt: "synthetic editor change", parameters: params,
      original_handle: original.reference_handle, drawing_handle: null }), (error: unknown) => {
      if (!(error instanceof OwnerSeedream55EditorServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? ""; return recoveryId.length > 0;
    });
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerSeedream55EditorServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(rig.calls.post, 1);
    assert.equal(rig.calls.result, 0);
  } finally { await rig.service.close(); }
});

test("55 Editor drawing geometry must match the owned original before hidden upload", async () => {
  const rig = fixture();
  try {
    const original = await rig.service.uploadOriginal({ attemptId: ATTEMPT, content_base64: PNG.toString("base64"),
      filename: "original.png", mime_type: "image/png" });
    await assert.rejects(rig.service.uploadDrawing({ attemptId: ATTEMPT, original_handle: original.reference_handle,
      content_base64: PNG_1X1.toString("base64"), filename: "drawing.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerSeedream55EditorServiceError && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(rig.calls.uploadDrawing, 0);
  } finally { await rig.service.close(); }
});
