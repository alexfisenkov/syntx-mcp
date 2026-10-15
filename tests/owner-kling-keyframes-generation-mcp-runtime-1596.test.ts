import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { isOwnerKlingKeyframesGenerationService } from "../src/application/owner-kling-keyframes-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES } from "../src/mcp/owner-kling-keyframes-generation-tools.js";
import { registerSyntxOwnerKlingKeyframesGenerationTools } from "../src/mcp/owner-kling-keyframes-generation-tools.js";
import { closeOwnerImageReferenceServiceOnTransportEof } from "../src/transports/stdio-owner.js";

const nowStart = Date.parse("2026-10-15T04:00:00.000Z");
const firstAttempt = "link_keyframes_runtime_1596_0123456789";
const eofAttempt = "link_keyframes_runtime_eof_1596_0123456789";
const png = png300();
function png300(): Buffer {
  const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  b.writeUInt32BE(300, 16); b.writeUInt32BE(300, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b;
}
function crc32(bytes: Uint8Array): number { let c = 0xffff_ffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (c & 1 ? 0xedb8_8320 : 0); } return (c ^ 0xffff_ffff) >>> 0; }
async function link(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number): Promise<void> {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 3 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId); await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId); await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}
function dto(value: unknown): Record<string, unknown> { assert.ok(value && typeof value === "object"); const v = (value as Record<string, unknown>).structuredContent; assert.ok(v && typeof v === "object"); return v as Record<string, unknown>; }

test("actual Keyframes runtime, stock MCP SDK and fake HTTP complete generation, GET recovery, revoke and EOF drain", async () => {
  let now = nowStart;
  const counts = { upload: 0, account: 0, model: 0, chat: 0, generation: 0, history: 0, result: 0 };
  const requests: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  let postSignal: AbortSignal | undefined;
  let signalPostStarted!: () => void;
  const postStarted = new Promise<void>(resolve => { signalPostStarted = resolve; });
  let holdGeneration = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input)); const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : undefined;
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : undefined;
    requests.push({ method, path: url.pathname, ...(body ? { body } : {}) });
    if (url.pathname === "/api/v1/user/balance" && method === "GET") { counts.account += 1; return Response.json({ balance: "1000" }); }
    if (url.pathname === "/api/v1/user/subscription" && method === "GET") { counts.account += 1; return Response.json({ active: true, type: "PRO", end_date: new Date(now + 24 * 60 * 60_000).toISOString() }); }
    if (url.pathname === "/api/v2/get_model_info" && method === "GET") { counts.model += 1; return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null }); }
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      counts.upload += 1; const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File); assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      assert.equal((init?.body as FormData).get("model_type"), "kling_keyframes");
      return Response.json({ files: [{ id: `upload-${counts.upload}`, url: `https://r2.syntx.ai/keyframes/${counts.upload}.png`, filename: file.name, mime_type: "image/png", size: png.length }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") { counts.chat += 1; return Response.json({ uuid: `keyframes-chat-${counts.chat}` }); }
    if (url.pathname === "/api/v1/video/generate" && method === "POST") {
      counts.generation += 1; assert.equal(url.searchParams.get("ai_name"), "kling");
      const sent = body as { chat_uuid: string; prompt: string; settings: Record<string, unknown> };
      assert.equal(sent.prompt, holdGeneration ? "pending EOF request" : "exact preserved prompt");
      assert.equal(sent.settings.model_type, "kling_keyframes"); assert.equal(sent.settings.version, "3.0");
      assert.equal(sent.settings.temperature, 0.6); assert.equal(sent.settings.multi_shots, !holdGeneration); assert.equal(sent.settings.aspect_ratio, undefined);
      const n = counts.generation === 1 ? [1, 2] : [3, 4];
      assert.deepEqual(sent.settings.file_urls, n.map(id => ({ type: "image", url: `https://r2.syntx.ai/keyframes/${id}.png` })));
      if (holdGeneration) { postSignal = init?.signal ?? undefined; signalPostStarted(); return await new Promise<Response>((_resolve, reject) => postSignal?.addEventListener("abort", () => reject(new DOMException("drained", "AbortError")), { once: true })); }
      throw new Error("synthetic lost generation acknowledgement after POST start");
    }
    const hist = /^\/api\/v1\/chats\/[^/]+\/messages$/u.exec(url.pathname);
    if (hist && method === "GET") {
      counts.history += 1;
      return Response.json({ messages: [
        { id: "owner-ack-1596", chat_id: 421, author_id: 27, message_object: [{ id: "ack-text", message_id: "owner-ack-1596", object_type: "text", model_type: "kling_keyframes", object_text: "exact preserved prompt" }] },
        { id: "bot-video-1596", chat_id: 421, author_id: -1, message_object: [
          { id: "video-a", message_id: "bot-video-1596", object_type: "video", model_type: "kling_keyframes", completed: true, object_url: "https://r2.syntx.ai/generated/a.mp4" },
          { id: "video-b", message_id: "bot-video-1596", object_type: "video", model_type: "kling_keyframes", completed: true, object_url: "https://r2.syntx.ai/generated/b.webm" }
        ] }
      ], pagination: { page: Number(url.searchParams.get("page")), page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (result && method === "GET") {
      counts.result += 1; return Response.json({ id: result[2], chat_id: 421, author_id: -1, message_object: [
        { id: "video-a", message_id: "bot-video-1596", object_type: "video", model_type: "kling_keyframes", completed: true, object_url: "https://r2.syntx.ai/generated/a.mp4" },
        { id: "video-b", message_id: "bot-video-1596", object_type: "video", model_type: "kling_keyframes", completed: true, object_url: "https://r2.syntx.ai/generated/b.webm" }
      ] });
    }
    throw new Error(`Unexpected synthetic request ${method} ${url.pathname}`);
  };

  const defaults = createObservedOwnerRuntime({ now: () => now, fetchImpl });
  const defaultServer = createMcpServer(defaults.application, defaults.serverOptions); const defaultClient = new Client({ name: "keyframes-1596-default", version: "1" });
  const [dc, ds] = InMemoryTransport.createLinkedPair();
  try { await defaultServer.connect(ds); await defaultClient.connect(dc); const names = (await defaultClient.listTools()).tools.map(x => x.name); assert.equal(names.some(x => (OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES as readonly string[]).includes(x)), false); }
  finally { await defaultClient.close(); await defaultServer.close(); }

  const runtime = createObservedOwnerRuntime({ ownerKlingKeyframesEnabled: true, now: () => now, fetchImpl });
  const composition = runtime.serverOptions.ownerKlingKeyframes; assert.ok(composition);
  assert.equal(isOwnerKlingKeyframesGenerationService(composition.generationService), true);
  assert.throws(() => registerSyntxOwnerKlingKeyframesGenerationTools({} as never, {}), /OWNER_KLING_KEYFRAMES_GENERATION_SERVICE_INVALID/u);
  const server = createMcpServer(runtime.application, runtime.serverOptions); const client = new Client({ name: "keyframes-1596-optin", version: "1" });
  const [cc, cs] = InMemoryTransport.createLinkedPair();
  await link(runtime, firstAttempt, now); await link(runtime, eofAttempt, now);
  try {
    await server.connect(cs); await client.connect(cc);
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map(x => x.name).filter(x => (OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES as readonly string[]).includes(x)), [...OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES]);
    const tool = listed.find(x => x.name === OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[1]); assert.ok(tool);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; additionalProperties?: boolean };
    assert.equal(schema.additionalProperties ?? false, false);
    assert.deepEqual(Object.keys(schema.properties).sort(), ["link_attempt_id", "model_id", "prompt", "image_handles", "version", "mode", "video_duration", "native_audio", "aspect_ratio", "temperature", "multi_shots", "camera_movement"].sort());
    assert.equal(counts.generation, 0);
    const upload = async (attemptId: string, filename: string) => client.callTool({ name: "syntx_owner_upload_kling_keyframes_image", arguments: { link_attempt_id: attemptId, filename, mime_type: "image/png", content_base64: png.toString("base64") } });
    const a = dto(await upload(firstAttempt, "first.png")); const b = dto(await upload(firstAttempt, "last.png"));
    const handles = [a.image_handle, b.image_handle]; assert.equal(counts.upload, 2);
    const invalid = await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[1], arguments: { link_attempt_id: firstAttempt, model_id: "kling_keyframes", prompt: "missing explicit fields" } });
    assert.equal(invalid.isError, true); assert.equal(counts.generation, 0, "schema-invalid calls are rejected before POST");
    const started = await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[1], arguments: { link_attempt_id: firstAttempt, model_id: "kling_keyframes", prompt: "exact preserved prompt", image_handles: handles, version: "3.0", mode: "hd", video_duration: 5, native_audio: false, aspect_ratio: null, temperature: 0.6, multi_shots: true } });
    assert.equal(started.isError, true, "lost POST acknowledgement is reported as unknown, not success");
    const unknown = dto(started); assert.equal(unknown.code, "OUTCOME_UNKNOWN"); const recoveryId = String(unknown.recovery_id);
    assert.equal(counts.generation, 1); assert.equal(requests.filter(x => x.path === "/api/v1/chats").length, 1);
    const recoveriesResult = await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[3], arguments: { link_attempt_id: firstAttempt } });
    assert.equal(recoveriesResult.isError, undefined, JSON.stringify(recoveriesResult));
    const recoveries = dto(recoveriesResult);
    assert.deepEqual(Object.keys((recoveries.recoveries as Record<string, unknown>[])[0]!).sort(), ["created_at", "observed_artifact_count", "recovery_id", "status"].sort());
    assert.equal(JSON.stringify(recoveries).includes("object_url"), false);
    assert.equal(JSON.stringify(recoveries).includes("model_id"), false);
    now += 16 * 60_000;
    const recoveredResult = await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[2], arguments: { link_attempt_id: firstAttempt, recovery_id: recoveryId } });
    assert.equal(recoveredResult.isError, undefined, JSON.stringify(recoveredResult));
    const recovered = dto(recoveredResult);
    assert.equal(recovered.status, "completed"); assert.equal(recovered.status_semantics, "LOCAL_OBSERVED_AVAILABILITY_ONLY");
    assert.equal(recovered.source_binding, undefined); assert.equal(recovered.backend_acceptance, "UNPROVEN");
    assert.deepEqual((recovered.artifacts as Record<string, unknown>[]).map(x => x.mime_type), ["video/mp4", "video/webm"]);
    assert.equal(counts.history, 1); assert.equal(counts.result, 1); assert.equal(counts.generation, 1, "reconciliation is GET-only and never repeats generation");
    const page = dto(await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[4], arguments: { link_attempt_id: firstAttempt, recovery_id: recoveryId, offset: 1 } }));
    assert.equal(page.offset, 1); assert.equal(page.page_size, 1); assert.equal(counts.history, 1); assert.equal(counts.result, 1);
    const revoked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: firstAttempt } }); assert.equal(dto(revoked).status, "REVOKED");
    const deniedPage = await client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[4], arguments: { link_attempt_id: firstAttempt, recovery_id: recoveryId } });
    assert.equal(deniedPage.isError, true); assert.equal(counts.result, 1, "revoked owner cannot read cached results");

    const eofUploads = await upload(eofAttempt, "eof-first.png");
    const eofA = dto(eofUploads);
    const eofB = dto(await upload(eofAttempt, "eof-last.png")); holdGeneration = true;
    const pending = client.callTool({ name: OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES[1], arguments: { link_attempt_id: eofAttempt, model_id: "kling_keyframes", prompt: "pending EOF request", image_handles: [eofA.image_handle, eofB.image_handle], version: "3.0", mode: "hd", video_duration: 5, native_audio: false, aspect_ratio: null, temperature: 0.6, multi_shots: false } });
    let postStartTimer: NodeJS.Timeout | undefined;
    try { await Promise.race([postStarted, new Promise<never>((_resolve, reject) => { postStartTimer = setTimeout(() => reject(new Error(`generation POST did not start: ${JSON.stringify(counts)}`)), 5_000); })]); }
    finally { if (postStartTimer) clearTimeout(postStartTimer); }
    assert.equal(postSignal?.aborted, false);
    const eofInput = new PassThrough(); const closeOnEof = closeOwnerImageReferenceServiceOnTransportEof(cs, runtime.ownerKlingKeyframesLifecycle!, undefined, eofInput);
    eofInput.end(); await closeOnEof(); assert.equal(postSignal?.aborted, true, "group EOF lifecycle aborts and drains generation before reference/client cleanup");
    assert.equal((await pending).isError, true); assert.equal(counts.generation, 2);
  } finally { await client.close(); await server.close(); await runtime.ownerKlingKeyframesLifecycle?.close().catch(() => undefined); }
});
