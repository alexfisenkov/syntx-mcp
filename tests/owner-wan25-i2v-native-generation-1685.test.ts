import assert from "node:assert/strict";
import test from "node:test";
import { consumeOwnerWan25I2vNativeInvocation, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import * as nativeContext from "../src/adapter/syntx/owner-wan25-i2v-native-context.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerWan25I2vUploadReferenceForClient, uploadOwnerWan25I2vImage } from "../src/adapter/syntx/wan25-i2v-upload-context.js";
import { releaseValidatedOwnerWan25I2vPreviewImage, validateOwnerWan25I2vPreviewImage } from "../src/application/owner-wan25-i2v-image-policy.js";
import { releaseValidatedOwnerWan26I2vImage, validateOwnerWan26I2vImage } from "../src/application/owner-wan26-i2v-image-policy.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerWan25I2vNativeError } from "../src/adapter/syntx/owner-wan25-i2v-native-context.js";
import { OwnerWan25I2vReferenceService } from "../src/application/owner-wan25-i2v-reference-service.js";
import { createOwnerWan25I2vRequestPreparer } from "../src/application/owner-wan25-i2v-request-preparer.js";
import { createOwnerWan25I2vOneShotPermit, revalidateOwnerWan25I2vOneShotPermit } from "../src/application/owner-wan25-i2v-one-shot-policy.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png384(): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("wan25-native-upload-test"); } };
}

test("uploads one genuine preview image into a private exact-client WAN25 context", async () => {
  let requests = 0; const source = png384(), expected = Buffer.from(source);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    requests += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST"); const form = init?.body; assert.ok(form instanceof FormData);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "wan_25_i2v_preview");
    const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.name, "preview.png");
    assert.equal(file.type, "image/png"); assert.deepEqual(Buffer.from(await file.arrayBuffer()), expected);
    return Response.json({ files: [{ id: "preview-image-1", url: "https://r2.syntx.ai/wan25/preview-image-1.png" }] });
  } });
  const receipt = validateOwnerWan25I2vPreviewImage({ model_id: "wan_25_i2v_preview", filename: "preview.png",
    mime_type: "image/png", bytes: source });
  source.fill(0);
  try {
    const context = await client.uploadWan25I2vImage(receipt);
    assert.equal(context.status, "uploaded"); assert.equal(context.model_id, "wan_25_i2v_preview");
    assert.equal(context.media_type, "image"); assert.equal(context.mime_type, "image/png");
    assert.equal(context.size, expected.byteLength); assert.equal(context.width, 384); assert.equal(context.height, 384);
    assert.equal(context.dispatch_allowed, false); assert.equal(context.generation_permit, false);
    assert.equal("url" in context, false); assert.equal(JSON.stringify(context).includes("r2.syntx.ai"), false);
    assert.deepEqual(readOwnerWan25I2vUploadReferenceForClient(client, context), { url: "https://r2.syntx.ai/wan25/preview-image-1.png" });
    assert.equal(readOwnerWan25I2vUploadReferenceForClient(new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: fetch }), context), null);
    assert.equal(readOwnerWan25I2vUploadReferenceForClient(client, { ...context }), null);
    assert.equal(readOwnerWan25I2vUploadReferenceForClient(client, new Proxy(context, {})), null);
    assert.equal(requests, 1);
  } finally { expected.fill(0); releaseValidatedOwnerWan25I2vPreviewImage(receipt); }
});

const ATTEMPT = "link_wan25_native_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan25-native-test", subject: "owner" });
function uploadPng384(): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}

test("WAN25 native image-only flow creates once, dispatches typed wire once, and reads exact retained result", async () => {
  let now = 1_000, serial = 0, chatCreates = 0, generations = 0, histories = 0, results = 0;
  let releaseConcurrentCreates!: () => void;
  const concurrentCreates = new Promise<void>((resolve) => { releaseConcurrentCreates = resolve; });
  const started = new Map<string, { prompt: string; settings: Record<string, unknown>; echo: string }>();
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `wan25-native-${serial++}`, approval_url: "https://example.invalid" }; },
    async pollChallenge(_challenge, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; }
  };
  const linkService = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), {
    now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT
  });
  await linkService.createAttempt(BINDING); await linkService.issueHandoff(BINDING, ATTEMPT); await linkService.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 5_000, fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    if (url.pathname.endsWith("/chats/upload-files")) {
      assert.equal(method, "POST"); const form = init?.body; assert.ok(form instanceof FormData);
      assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "wan_25_i2v_preview");
      const file = form.get("files"); assert.ok(file instanceof File); assert.equal(file.type, "image/png");
      return Response.json({ files: [{ id: "preview-upload", url: "https://r2.syntx.ai/wan25/preview.png" }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatCreates += 1; const body = JSON.parse(String(init?.body)); assert.equal(body.scope, "video");
      assert.match(body.title, /^owner-wan25-i2v-/u);
      const uuid = `preview-chat-${chatCreates}`;
      if (chatCreates === 2) releaseConcurrentCreates();
      await concurrentCreates;
      return Response.json({ uuid });
    }
    if (url.pathname.endsWith("/api/v1/video/generate") && method === "POST") {
      generations += 1; assert.equal(url.searchParams.get("ai_name"), "wan_video");
      const body = JSON.parse(String(init?.body)), echo = `${body.chat_id}-owner-echo`;
      started.set(body.chat_id, { prompt: body.prompt, settings: body.settings, echo });
      return Response.json({ id: echo });
    }
    const historyMatch = /^\/api\/v1\/chats\/([^/]+)\/messages$/u.exec(url.pathname);
    if (historyMatch && method === "GET") {
      histories += 1; const chatUuid = historyMatch[1]!, row = started.get(chatUuid)!;
      const model = row.settings.model_type;
      return Response.json({ messages: [
        { id: row.echo, chat_id: 4321, author_id: 7,
          message_object: [{ id: `${chatUuid}-owner-text`, message_id: row.echo, object_type: "text", model_type: model, object_text: row.prompt }] },
        { id: `${chatUuid}-video-message`, chat_id: 4321, author_id: -1,
          message_object: [{ id: `${chatUuid}-video-object`, message_id: `${chatUuid}-video-message`, object_type: "video", model_type: model, completed: true }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = /^\/api\/v1\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (resultMatch && method === "GET") {
      results += 1;
      const chatUuid = resultMatch[1]!;
      return Response.json({ id: resultMatch[2], chat_id: 4321, author_id: -1,
        message_object: [{ id: `${chatUuid}-video-object`, message_id: `${chatUuid}-video-message`, object_type: "video",
          model_type: "wan_25_i2v_preview", completed: true, object_url: "https://r2.syntx.ai/wan25/result.mp4" }] });
    }
    throw new Error(`UNEXPECTED_WAN25_REQUEST ${method} ${url.pathname}`);
  } });
  const referenceService = new OwnerWan25I2vReferenceService({ binding: BINDING, linkService,
    resolveClient: async () => client, now: () => now });
  const preparer = createOwnerWan25I2vRequestPreparer({ referenceService, now: () => now });
  const bytes = uploadPng384();
  try {
    const imageReceipt = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_25_i2v_preview",
      filename: "preview.png", mime_type: "image/png", content_base64: bytes.toString("base64") });
    const candidate = await preparer.prepare({ attempt_id: ATTEMPT, model_id: "wan_25_i2v_preview",
      image_handle: imageReceipt.image_handle, audio_handle: null, prompt: "A quiet preview scene.",
      parameters: { resolution: "480P", aspect_ratio: "16:9", video_duration: 5, prompt_extend: true, seed: 0 } });
    const binding = preparer.inspectCandidate(candidate)!;
    const permit = await createOwnerWan25I2vOneShotPermit({ preparer, candidate, principal: binding.principal, attemptId: ATTEMPT });
    const operation = Object.freeze({ preparer, candidate, permit, principal: binding.principal, attemptId: ATTEMPT,
      linkService, binding: BINDING });
    const candidate2 = await preparer.prepare({ attempt_id: ATTEMPT, model_id: "wan_25_i2v_preview",
      image_handle: imageReceipt.image_handle, audio_handle: null, prompt: "A different preview intent.",
      parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 10, prompt_extend: false, seed: 0 } });
    const binding2 = preparer.inspectCandidate(candidate2)!;
    const permit2 = await createOwnerWan25I2vOneShotPermit({ preparer, candidate: candidate2, principal: binding2.principal, attemptId: ATTEMPT });
    const operation2 = Object.freeze({ preparer, candidate: candidate2, permit: permit2, principal: binding2.principal, attemptId: ATTEMPT,
      linkService, binding: BINDING });
    const [chat, chat2] = await Promise.all([client.createOwnerWan25I2vChat(operation), client.createOwnerWan25I2vChat(operation2)]);
    assert.equal(chat.model_id, "wan_25_i2v_preview"); assert.equal(chat.dispatch_allowed, false);
    assert.equal(JSON.stringify(chat).includes("r2.syntx.ai"), false); assert.equal(chatCreates, 2);
    assert.notEqual(chat.chat_uuid, chat2.chat_uuid); assert.notEqual(chat.intent_fingerprint, chat2.intent_fingerprint);
    await assert.rejects(client.createOwnerWan25I2vChat(operation),
      (error: unknown) => error instanceof OwnerWan25I2vNativeError && error.code === "CHAT_ALREADY_CREATED");
    assert.equal(chatCreates, 2, "the same candidate is sticky before its permit is consumed");
    await revalidateOwnerWan25I2vOneShotPermit({ permit, preparer, candidate, principal: binding.principal, attemptId: ATTEMPT });
    await revalidateOwnerWan25I2vOneShotPermit({ permit: permit2, preparer, candidate: candidate2, principal: binding2.principal, attemptId: ATTEMPT });
    const startInput = { ...operation, chat };
    await assert.rejects(client.listOwnedWan25I2vCandidates({ ...operation, chat: Object.freeze({ ...chat }) }));
    const [acknowledgement, acknowledgement2] = await Promise.all([
      client.startOwnerWan25I2vWithOwnedCandidate(startInput),
      client.startOwnerWan25I2vWithOwnedCandidate({ ...operation2, chat: chat2 })
    ]);
    assert.equal(acknowledgement.chat_uuid, chat.chat_uuid); assert.equal(acknowledgement.message_id, started.get(chat.chat_uuid)!.echo);
    assert.equal(acknowledgement2.chat_uuid, chat2.chat_uuid); assert.equal(generations, 2);
    await assert.rejects(client.startOwnerWan25I2vWithOwnedCandidate(startInput),
      (error: unknown) => error instanceof OwnerWan25I2vNativeError && error.code === "CHAT_CONTEXT_INVALID");
    assert.equal(generations, 2, "neither chat may issue a second generation POST");
    const sentSettings = started.get(chat.chat_uuid)!.settings;
    assert.equal(sentSettings.model_type, "wan_25_i2v_preview");
    assert.deepEqual(sentSettings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/wan25/preview.png" }]);
    assert.equal(sentSettings.resolution, "480P"); assert.equal(sentSettings.video_duration, 5);
    assert.equal(sentSettings.native_audio, false); assert.equal(Object.hasOwn(sentSettings, "duration"), false);
    assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.native_audio_status, "UNPROVEN_NOT_ENABLED");
    const listing = await client.listOwnedWan25I2vCandidates({ ...operation, chat });
    assert.equal(listing.owner_ack_status, "MATCHED"); assert.equal(listing.history_binding_status, "BOUND");
    assert.equal(listing.history_page_status, "COMPLETE"); assert.equal(listing.backend_acceptance, "UNPROVEN");
    assert.equal(listing.contexts.length, 1); assert.equal(histories, 1);
    const context = listing.contexts[0]!;
    await assert.rejects(client.getOwnedWan25I2vResult({ ...operation, context: Object.freeze({ ...context }) }));
    const result = await client.getOwnedWan25I2vResult({ ...operation, context });
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.result_status, "OBSERVED"); assert.equal(result.gaps.length, 0); assert.equal(result.ready_videos.length, 1);
    assert.equal(result.provider_terminal_status, "UNPROVEN"); assert.equal(results, 1);
    const otherClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("unexpected"); } });
    await assert.rejects(otherClient.getOwnedWan25I2vResult({ ...operation, context }));
    await linkService.revoke(BINDING, ATTEMPT);
    await assert.rejects(client.getOwnedWan25I2vResult({ ...operation, context })); assert.equal(results, 1);
  } finally { bytes.fill(0); await preparer.close(); await referenceService.close(); }
});

test("rejects WAN26 receipts and overridden upload transports without minting a preview reference", async () => {
  let requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { requests += 1; return Response.json({}); } });
  const image = png384();
  const foreign = validateOwnerWan26I2vImage({ model_id: "wan_26_i2v", filename: "frame.png", mime_type: "image/png", bytes: image });
  const previewForCallerUrl = validateOwnerWan25I2vPreviewImage({ model_id: "wan_25_i2v_preview", filename: "caller.png", mime_type: "image/png", bytes: image });
  try {
    await assert.rejects(uploadOwnerWan25I2vImage(client, foreign as never));
    await assert.rejects(uploadOwnerWan25I2vImage(client, { ...previewForCallerUrl, url: "https://r2.syntx.ai/caller.png" }));
    class SubclassClient extends SyntxChatHttpClient {}
    const subclass = new SubclassClient({ credentialBroker: broker(), fetchImpl: async () => { requests += 1; return Response.json({}); } });
    const previewForSubclass = validateOwnerWan25I2vPreviewImage({ model_id: "wan_25_i2v_preview", filename: "subclass.png", mime_type: "image/png", bytes: image });
    try { await assert.rejects(uploadOwnerWan25I2vImage(subclass, previewForSubclass)); }
    finally { releaseValidatedOwnerWan25I2vPreviewImage(previewForSubclass); }
    Object.defineProperty(client, "uploadFileReferences", { value: async () => [{ url: "https://r2.syntx.ai/forged.png" }] });
    const preview = validateOwnerWan25I2vPreviewImage({ model_id: "wan_25_i2v_preview", filename: "frame.png", mime_type: "image/png", bytes: image });
    try { await assert.rejects(uploadOwnerWan25I2vImage(client, preview)); }
    finally { releaseValidatedOwnerWan25I2vPreviewImage(preview); }
    assert.equal(requests, 0);
  } finally {
    releaseValidatedOwnerWan26I2vImage(foreign); releaseValidatedOwnerWan25I2vPreviewImage(previewForCallerUrl); image.fill(0);
  }
});

test("native callback packet factory is private and forged packets fail before HTTP", async () => {
  let requests = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    requests += 1; return Response.json({});
  } });
  const input = Object.freeze({ callerControlled: true });
  assert.equal(Object.hasOwn(nativeContext, "createOwnerWan25I2vNativeInvocation"), false);
  assert.throws(() => consumeOwnerWan25I2vNativeInvocation(input, Object.freeze({}), "create"));
  await assert.rejects(nativeContext.createOwnerWan25I2vChat(input, Object.freeze({})));
  assert.equal(requests, 0);
  assert.equal(client.constructor, SyntxChatHttpClient);
});
