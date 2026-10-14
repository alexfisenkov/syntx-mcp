import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE, type AuthBinding, type AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { readOwnerKlingI2VUploadReferenceForClient } from "../src/adapter/syntx/kling-i2v-upload-context.js";
import { OwnerKlingI2VImageReferenceService } from "../src/application/owner-kling-i2v-reference-service.js";
import { createOwnerKlingI2vGenerationContext, inspectOwnerKlingI2vGenerationContext } from "../src/application/owner-kling-i2v-generation-context.js";

const ATTEMPT = "link_kling_i2v_generation_context_123456";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "kling-context-tenant", subject: "kling-context-owner" });
const IMAGE = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
const IMAGE_URL = "https://r2.syntx.ai/hidden/owner-frame.jpg";

function makeBroker() {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-kling-context-token"); } };
}

async function setup() {
  let now = Date.now();
  const authStore = new InMemoryAuthLinkStore();
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: "synthetic", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-linked-token" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, authStore, { defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: makeBroker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") return Response.json({ files: [{ id: "synthetic-private-file", url: IMAGE_URL }] });
    if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "kling-context-chat-1" });
    if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: "kling-context-message-1" });
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  } });
  const references = new OwnerKlingI2VImageReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, destination: "hidden", now: () => now });
  const uploaded = await references.upload({ attemptId: ATTEMPT, content_base64: IMAGE.toString("base64"), filename: "frame.jpg", mime_type: "image/jpeg" });
  const reference = { attempt_id: ATTEMPT, image_handle: String(uploaded.image_handle) };
  const resolution = await references.resolve(reference);
  const uploadContext = await references.withCapturedNativeImage(resolution, reference, (_client, context) => context);
  return { client, references, requests, reference, resolution, uploadContext, advance(milliseconds: number) { now += milliseconds; } };
}

test("builds and consumes one same-client Kling I2V context with a typed image file_urls record", async () => {
  const state = await setup();
  try {
    const context = await createOwnerKlingI2vGenerationContext({ referenceService: state.references,
      resolution: state.resolution, reference: state.reference,
      parameters: { model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
      controls: { temperature: 0.6, multi_shots: false } });
    assert.deepEqual(JSON.stringify(context), JSON.stringify({ status: "ready", model_id: "kling_image2video",
      reference_count: 1, generation_permit: "ONE_SHOT_RESERVED_ON_DISPATCH" }));
    assert.equal(JSON.stringify(context).includes(IMAGE_URL), false);
    const inspection = inspectOwnerKlingI2vGenerationContext(state.client, context);
    assert.equal(inspection?.dispatch_state, "READY");
    assert.equal(inspection?.settings.temperature, 0.6);
    const receipt = await state.client.startOwnerKlingI2vVideoWithContext(context);
    assert.equal(receipt.message_id, "kling-context-message-1");
    const post = state.requests.find((request) => request.path === "/api/v1/video/generate");
    assert.deepEqual(post?.body, { chat_id: "kling-context-chat-1", prompt: "A quiet shoreline at sunrise.", settings: {
      model_type: "kling_image2video", version: "3.0", mode: "hd", video_duration: 5, native_audio: false,
      temperature: 0.6, multi_shots: false, file_urls: [{ type: "image", url: IMAGE_URL }]
    } });
    assert.equal(inspectOwnerKlingI2vGenerationContext(state.client, context)?.dispatch_state, "RESERVED");
    await assert.rejects(state.client.startOwnerKlingI2vVideoWithContext(context));
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/video/generate").length, 1);
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/chats").length, 1);
  } finally { await state.references.close(); }
});

test("rechecks the owner image reference TTL immediately before generation dispatch", async () => {
  const state = await setup();
  try {
    const context = await createOwnerKlingI2vGenerationContext({ referenceService: state.references,
      resolution: state.resolution, reference: state.reference,
      parameters: { model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
      controls: { temperature: 0.6, multi_shots: false } });
    state.advance(15 * 60_000 + 1);
    await assert.rejects(state.client.startOwnerKlingI2vVideoWithContext(context));
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/video/generate").length, 0);
  } finally { await state.references.close(); }
});

test("rejects a structurally forged reference service before creating a video chat", async () => {
  const state = await setup();
  try {
    let forgedCaptureCalls = 0;
    const forgedService = {
      isOwnedResolution: () => true,
      async withCapturedNativeImage(_resolution: unknown, _reference: unknown,
        consume: (client: SyntxChatHttpClient, uploadContext: unknown, signal: AbortSignal) => unknown) {
        forgedCaptureCalls += 1;
        return consume(state.client, {}, new AbortController().signal);
      }
    };
    await assert.rejects(createOwnerKlingI2vGenerationContext({ referenceService: forgedService as never,
      resolution: state.resolution, reference: state.reference,
      parameters: { model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
      controls: { temperature: 0.6, multi_shots: false } }));
    assert.equal(forgedCaptureCalls, 0);
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/chats").length, 0);
  } finally { await state.references.close(); }
});

test("rejects an upload context after the native upload prototype identity changes", async () => {
  const state = await setup();
  const original = SyntxChatHttpClient.prototype.uploadKlingI2VImageReference;
  try {
    const context = await createOwnerKlingI2vGenerationContext({ referenceService: state.references,
      resolution: state.resolution, reference: state.reference,
      parameters: { model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false },
      controls: { temperature: 0.6, multi_shots: false } });
    Object.defineProperty(SyntxChatHttpClient.prototype, "uploadKlingI2VImageReference", {
      configurable: true, writable: true, value: async () => ({ url: IMAGE_URL })
    });
    const requestCount = state.requests.length;
    assert.equal(readOwnerKlingI2VUploadReferenceForClient(state.client, state.uploadContext), null);
    await assert.rejects(state.client.startOwnerKlingI2vVideoWithContext(context));
    assert.equal(state.requests.length, requestCount, "identity failure must stop before another upstream request");
  } finally {
    Object.defineProperty(SyntxChatHttpClient.prototype, "uploadKlingI2VImageReference", {
      configurable: true, writable: true, value: original
    });
    await state.references.close();
  }
});

test("rejects invalid hidden settings before creating a video chat", async () => {
  const state = await setup();
  try {
    await assert.rejects(createOwnerKlingI2vGenerationContext({ referenceService: state.references,
      resolution: state.resolution, reference: state.reference,
      parameters: { model_id: "kling_image2video", prompt: "A quiet shoreline at sunrise.", reference_count: 1,
        version: "3.0", mode: "hd", video_duration: 5, native_audio: false }, controls: {} }));
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/chats").length, 0);
    assert.equal(state.requests.filter((request) => request.path === "/api/v1/video/generate").length, 0);
  } finally { await state.references.close(); }
});
