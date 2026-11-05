import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../src/mcp/server.js";
import { SYNTX_OWNER_UPLOAD_SUNO_AUDIO_TOOL_NAME as UPLOAD } from "../src/mcp/owner-suno-audio-upload-tool.js";
import { createSunoAudioProbe, consumeSunoAudioProbe, SUNO_AUDIO_UPLOAD_SOURCE } from "../src/application/owner-suno-audio-reference-probe.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerSunoTrackContextStore } from "../src/application/owner-suno-track-context.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";

const FFPROBE = process.env.SYNTX_SUNO_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const AVAILABLE = existsSync(FFPROBE);
const ATTEMPT = "link_suno_uploaded_audio_owner_0123456789";
const OTHER_ATTEMPT = "link_suno_uploaded_audio_other_0123456789";
const EXTEND = "syntx_owner_extend_suno_audio";
const RECONCILE = "syntx_owner_reconcile_suno_track_operation";
function wav(seconds = 24, sampleRate = 8_000): Buffer {
  const length = seconds * sampleRate * 2, bytes = Buffer.alloc(length + 44);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(length + 36, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(length, 40);
  for (let i = 0; i < length / 2; i += 1) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 1_000), 44 + i * 2);
  return bytes;
}
const WAV = wav();
const request = (model_id = "V6_wild") => ({ model_id, filename: "synthetic.wav", mime_type: "audio/wav", content_base64: WAV.toString("base64") });
function content(value: unknown): Record<string, any> {
  const result = value as { structuredContent?: Record<string, any> };
  assert.ok(result.structuredContent); return result.structuredContent;
}
function errorCode(value: unknown): string | undefined {
  const result = value as { content?: Array<{ text?: string }> };
  const text = result.content?.find((item) => typeof item.text === "string")?.text;
  return text ? (JSON.parse(text) as { error?: { code?: string } }).error?.code : undefined;
}
async function link(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string, now: number) {
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding: runtime.authBinding, expires_at_ms: now + 86_400_000 });
  await runtime.authStore.beginHandoff(runtime.authBinding, attemptId);
  await runtime.authStore.attachChallenge(runtime.authBinding, attemptId, "synthetic-audio-reference-challenge");
  await runtime.authStore.beginPoll(runtime.authBinding, attemptId);
  await runtime.authStore.markLinked(runtime.authBinding, attemptId, { scheme: "Bearer", value: "synthetic-audio-reference-credential" });
}
async function sdk(options: { loseUploadAck?: boolean; loseGenerationAck?: boolean; wrongReferenceEcho?: boolean; enableProbe?: boolean } = {}) {
  const now = Date.parse("2026-11-05T00:00:00.000Z");
  const counts = { upload: 0, generation: 0, chat: 0, history: 0, detail: 0 };
  const posts: Array<{ path: string; body: Record<string, any> }> = [];
  const jobs = new Map<string, { prompt: string; model: string; ack: string; url: string }>();
  const uploadUrl = "https://r2.syntx.ai/uploaded/synthetic-suno-reference.wav";
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31T00:00:00Z" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 1, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: null });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      counts.upload += 1;
      assert.ok(init?.body instanceof FormData);
      const form = init.body;
      assert.deepEqual([...form.keys()].sort(), ["check_duplicates", "destination", "files", "model_type"]);
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
      assert.ok(form.get("model_type") === "V6" || form.get("model_type") === "V6_wild");
      assert.equal(form.getAll("files").length, 1);
      const file = form.get("files") as File;
      assert.equal(file.name, "synthetic.wav"); assert.equal(file.type, "audio/wav");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), WAV);
      if (options.loseUploadAck) throw new Error("Synthetic lost upload ACK");
      return Response.json({ files: [{ url: uploadUrl, mime_type: "audio/wav", size: WAV.length, status: "accepted" }] });
    }
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, any> : undefined;
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      counts.chat += 1; return Response.json({ uuid: `suno-upload-chat-${counts.chat}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      counts.generation += 1; assert.ok(body); posts.push({ path: url.pathname, body });
      assert.equal(body.settings.source_clip_id, ""); assert.equal(body.settings.source_task_id, "");
      assert.deepEqual(body.settings.file_urls, [{ type: "audio", url: uploadUrl }]);
      jobs.set(String(body.chat_uuid), { prompt: String(body.prompt), model: String(body.settings.model_type),
        ack: `suno-upload-ack-${counts.generation}`, url: uploadUrl });
      if (options.loseGenerationAck) throw new Error("Synthetic lost generation ACK");
      return Response.json({ id: `suno-upload-ack-${counts.generation}` });
    }
    const history = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (history && method === "GET") {
      counts.history += 1; const job = jobs.get(history[1]!); assert.ok(job);
      return Response.json({ messages: [
        { id: job.ack, chat_id: 128, author_id: 9, message_object: [
          { id: `${job.ack}-text`, message_id: job.ack, object_type: "text", object_text: job.prompt || "Instrumental audio", model_type: job.model },
          { id: `${job.ack}-ref`, message_id: job.ack, object_type: "audio", model_type: job.model,
            object_url: options.wrongReferenceEcho ? "https://r2.syntx.ai/uploaded/foreign.wav" : job.url }
        ] },
        { id: `${job.ack}-bot`, chat_id: 128, author_id: -1, message_object: [
          { id: `${job.ack}-out`, message_id: `${job.ack}-bot`, object_type: "audio", model_type: job.model }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const detail = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (detail && method === "GET") {
      counts.detail += 1; const job = jobs.get(detail[1]!); assert.ok(job);
      return Response.json({ id: detail[2], chat_id: 128, author_id: -1, message_object: [
        { id: `${job.ack}-out`, message_id: detail[2], object_type: "audio", model_type: job.model, completed: true,
          object_url: "https://r2.syntx.ai/generated/synthetic-extension.mp3" }
      ] });
    }
    throw new Error("Unexpected synthetic route");
  };
  const runtime = createObservedOwnerRuntime({ ownerSunoGenerationEnabled: true, fetchImpl, now: () => now,
    ...(options.enableProbe === false ? {} : { ownerSunoFfprobePath: FFPROBE }) });
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "synthetic-suno-upload-sdk", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair(); await link(runtime, ATTEMPT, now); await link(runtime, OTHER_ATTEMPT, now);
  await server.connect(b); await client.connect(a); await client.listTools();
  return { client, counts, posts, runtime, async close() { await client.close(); await server.close(); await runtime.ownerSunoGenerationLifecycle?.close(); runtime.authStore.close?.(); } };
}
const operation = (handle: string, model_id = "V6_wild") => ({ link_attempt_id: ATTEMPT, model_id, track_handle: handle,
  prompt: "", is_custom_mode: true, is_instrumental: false, negative_tags: "", styles: "synthetic ambient", title: "Synthetic extension", continue_at: 10 });

test("Suno upload tool stays absent without trusted probe configuration", async () => {
  const f = await sdk({ enableProbe: false });
  try { assert.equal((await f.client.listTools()).tools.some((tool) => tool.name === UPLOAD), false); }
  finally { await f.close(); }
});

test("genuine uploaded audio reaches exact current multipart and Extend body for both Suno models", async (t) => {
  if (!AVAILABLE) { t.skip("trusted ffprobe unavailable"); return; }
  for (const model of ["V6", "V6_wild"]) {
    const f = await sdk();
    try {
      const uploaded = await f.client.callTool({ name: UPLOAD, arguments: { link_attempt_id: ATTEMPT, ...request(model) } });
      assert.equal(uploaded.isError, undefined, JSON.stringify(uploaded));
      const receipt = content(uploaded); assert.equal(receipt.source_kind, "UPLOADED_AUDIO"); assert.equal(receipt.duration_seconds, 24);
      assert.equal(receipt.sha256, createHash("sha256").update(WAV).digest("hex"));
      assert.equal(JSON.stringify(receipt).includes("https://"), false);
      const duplicate = await f.client.callTool({ name: UPLOAD, arguments: { link_attempt_id: ATTEMPT, ...request(model) } });
      assert.equal(content(duplicate).track_handle, receipt.track_handle); assert.equal(f.counts.upload, 1);
      const result = await f.client.callTool({ name: EXTEND, arguments: operation(String(receipt.track_handle), model) });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.equal(content(result).status, "completed"); assert.equal(content(result).diagnostic.owner_ack_status, "MATCHED");
      assert.deepEqual(f.posts[0]!.body.settings, { model_type: model, mode: "extend", is_custom_mode: true, is_instrumental: false,
        negative_tags: "", styles: "synthetic ambient", title: "Synthetic extension", continue_at: 10,
        source_clip_id: "", source_task_id: "", file_urls: [{ type: "audio", url: "https://r2.syntx.ai/uploaded/synthetic-suno-reference.wav" }] });
      await f.client.callTool({ name: EXTEND, arguments: operation(String(receipt.track_handle), model) });
      assert.equal(f.counts.generation, 1);
    } finally { await f.close(); }
  }
});

test("forged handles, caller URLs, cross-attempt/model and oversized continuation fail before generation", async (t) => {
  if (!AVAILABLE) { t.skip("trusted ffprobe unavailable"); return; }
  const f = await sdk();
  try {
    const uploaded = await f.client.callTool({ name: UPLOAD, arguments: { link_attempt_id: ATTEMPT, ...request() } });
    const handle = String(content(uploaded).track_handle), before = { ...f.counts };
    for (const input of [
      { ...operation(handle), source_url: "https://r2.syntx.ai/uploaded/forged.wav" },
      operation("track_00000000-0000-4000-8000-000000000001"), operation(handle, "V6"),
      { ...operation(handle), link_attempt_id: OTHER_ATTEMPT }, { ...operation(handle), continue_at: 25.1 }
    ]) assert.equal((await f.client.callTool({ name: EXTEND, arguments: input })).isError, true);
    assert.deepEqual(f.counts, before);
  } finally { await f.close(); }
});

test("lost upload acknowledgement is never retried and generation recovery remains GET-only", async (t) => {
  if (!AVAILABLE) { t.skip("trusted ffprobe unavailable"); return; }
  const lost = await sdk({ loseUploadAck: true });
  try {
    const args = { link_attempt_id: ATTEMPT, ...request() };
    assert.equal(errorCode(await lost.client.callTool({ name: UPLOAD, arguments: args })), "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(errorCode(await lost.client.callTool({ name: UPLOAD, arguments: args })), "UPLOAD_INTENT_ALREADY_CLAIMED");
    assert.equal(lost.counts.upload, 1); assert.equal(lost.counts.generation, 0);
  } finally { await lost.close(); }
  const f = await sdk({ loseGenerationAck: true });
  try {
    const upload = await f.client.callTool({ name: UPLOAD, arguments: { link_attempt_id: ATTEMPT, ...request() } });
    const result = await f.client.callTool({ name: EXTEND, arguments: operation(String(content(upload).track_handle)) });
    assert.equal(errorCode(result), "OUTCOME_UNKNOWN");
    const text = (result.content as Array<{ text?: string }>).find((item) => item.text)?.text ?? "{}";
    const recovery = (JSON.parse(text) as { error: { recovery_id: string } }).error.recovery_id;
    const before = { ...f.counts };
    const recovered = await f.client.callTool({ name: RECONCILE, arguments: { link_attempt_id: ATTEMPT, recovery_id: recovery } });
    assert.equal(recovered.isError, undefined, JSON.stringify(recovered));
    assert.equal(content(recovered).diagnostic.owner_ack_status, "MATCHED");
    assert.equal(f.counts.upload, before.upload); assert.equal(f.counts.generation, before.generation);
  } finally { await f.close(); }
});

test("a foreign uploaded-reference owner echo cannot mint result contexts", async (t) => {
  if (!AVAILABLE) { t.skip("trusted ffprobe unavailable"); return; }
  const f = await sdk({ wrongReferenceEcho: true });
  try {
    const upload = await f.client.callTool({ name: UPLOAD, arguments: { link_attempt_id: ATTEMPT, ...request() } });
    const result = await f.client.callTool({ name: EXTEND, arguments: operation(String(content(upload).track_handle)) });
    assert.equal(errorCode(result), "OUTCOME_UNKNOWN"); assert.equal(f.counts.detail, 0); assert.equal(f.counts.generation, 1);
  } finally { await f.close(); }
});

test("upload contexts reject forged receipts, another client and another owner; TTL and measured limits stay enforced", async (t) => {
  if (!AVAILABLE) { t.skip("trusted ffprobe unavailable"); return; }
  let now = Date.parse("2026-11-05T00:00:00.000Z"), calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential(operation) { return operation("synthetic-upload-credential"); } },
    fetchImpl: async () => { calls += 1; return Response.json({ files: [{ url: "https://r2.syntx.ai/uploaded/synthetic.wav" }] }); } });
  const otherClient = new SyntxChatHttpClient({ credentialBroker: { async useCredential(operation) { return operation("synthetic-other-credential"); } },
    fetchImpl: async () => { assert.fail("cross-client check cannot perform a request"); } });
  const principal: GenerationPrincipalRef = { tenant_id: "synthetic-tenant", subject_id: "synthetic-owner", connection_id: ATTEMPT };
  const binding = { tenant_id: principal.tenant_id, subject: principal.subject_id };
  const probe = createSunoAudioProbe(FFPROBE);
  await assert.rejects(client.uploadOwnedSunoAudio({ attemptId: ATTEMPT, principal, probe: { ...SUNO_AUDIO_UPLOAD_SOURCE } }));
  assert.equal(calls, 0);
  const measured = await probe.probe(request());
  const context = await client.uploadOwnedSunoAudio({ attemptId: ATTEMPT, principal, probe: measured });
  assert.throws(() => consumeSunoAudioProbe(measured));
  const store = new OwnerSunoTrackContextStore({ now: () => now });
  try {
    assert.throws(() => store.issueUploadedAudio({ binding, attemptId: ATTEMPT, principal, client, uploadContext: { ...context } }));
    assert.throws(() => store.issueUploadedAudio({ binding, attemptId: ATTEMPT, principal, client: otherClient, uploadContext: context }));
    const handle = store.issueUploadedAudio({ binding, attemptId: ATTEMPT, principal, client, uploadContext: context });
    assert.throws(() => store.resolve({ binding: { ...binding, subject: "another-owner" }, attemptId: ATTEMPT,
      principal: { ...principal, subject_id: "another-owner" }, trackHandle: handle }));
    now += 900_001; assert.throws(() => store.resolve({ binding, attemptId: ATTEMPT, principal, trackHandle: handle }));
    assert.equal(calls, 1);
    await assert.rejects(probe.probe({ ...request(), content_base64: wav(481).toString("base64") }));
    await assert.rejects(probe.probe({ ...request(), filename: "../synthetic.wav" }));
  } finally { store.close(); }
});
