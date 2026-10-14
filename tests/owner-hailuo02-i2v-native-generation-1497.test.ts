import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  createOwnerHailuo02I2vChat,
  type OwnerHailuo02I2vNativeOperationInput
} from "../src/adapter/syntx/owner-hailuo02-i2v-native-context.js";
import { OwnerHailuo02I2vImageReferenceService } from "../src/application/owner-hailuo02-i2v-image-reference-service.js";
import { createOwnerHailuo02I2vOneShotPermit } from "../src/application/owner-hailuo02-i2v-one-shot-policy.js";
import { createOwnerHailuo02I2vRequestPreparer } from "../src/application/owner-hailuo02-i2v-request-preparer.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";

const ATTEMPT = "link_h02_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "h02-native-tenant", subject: "h02-native-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const INPUT_URL = "https://r2.syntx.ai/hailuo/native-input.png";
const OUTPUT_URL = "https://r2.syntx.ai/hailuo/native-output.mp4";
const CHAT = "hailuo02-native-chat";
const ACK = "hailuo02-native-ack";
const RESULT_MESSAGE = "hailuo02-native-result";
const RESULT_OBJECT = "hailuo02-native-video";

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-hailuo-native-credential"); } }; }
async function linked(now: () => number): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-h02", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}

test("native Hailuo02 I2V binds exact upload, one GEN, ACK-owned history and same-client GET; unknown GEN is not replayed", async () => {
  let now = 1_000, creates = 0, generations = 0, historyGets = 0, resultGets = 0, failUnknown = false;
  const links = await linked(() => now);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (request, init) => {
    const url = new URL(String(request));
    if (url.pathname.endsWith("/chats/upload-files")) {
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), "hailuo-02");
      const file = form.get("files"); assert.ok(file instanceof File); assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      return response({ files: [{ filename: "кадр.png", url: INPUT_URL, mime_type: "image/png", size: PNG.byteLength, status: "success" }] });
    }
    if (url.pathname.endsWith("/chats")) { creates++; const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["title", "scope"]); assert.equal(body.scope, "video");
      return response({ uuid: creates === 1 ? CHAT : `${CHAT}-unknown` }); }
    if (url.pathname.endsWith("/video/generate")) {
      generations++; assert.equal(url.search, "?ai_name=hailuo-minimax");
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      assert.deepEqual(Object.keys(body), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, failUnknown ? `${CHAT}-unknown` : CHAT);
      assert.equal(body.prompt, failUnknown ? "A second synthetic request that loses its response." : "A quiet garden path at dawn, one continuous shot.");
      assert.deepEqual(Object.keys(body.settings), ["model_type", "resolution", "video_duration", "file_urls"]);
      assert.equal(body.settings.model_type, "hailuo-02"); assert.equal(body.settings.resolution, "768p"); assert.equal(body.settings.video_duration, 6);
      assert.deepEqual(body.settings.file_urls, [{ type: "image", url: INPUT_URL }]); assert.equal(Object.hasOwn(body.settings, "n"), false);
      if (failUnknown) throw new Error("synthetic transport loss after dispatch");
      return response({ id: ACK });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`)) {
      historyGets++; return response({ messages: [
        { id: ACK, chat_id: 77202, author_id: 17, message_object: [] },
        { id: RESULT_MESSAGE, chat_id: 77202, author_id: -1, message_object: [{ id: RESULT_OBJECT, message_id: RESULT_MESSAGE,
          object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/${RESULT_MESSAGE}`)) {
      resultGets++; return response({ id: RESULT_MESSAGE, chat_id: 77202, author_id: -1, message_object: [{ id: RESULT_OBJECT,
        message_id: RESULT_MESSAGE, object_type: "video", object_url: OUTPUT_URL, completed: true, model_type: "hailuo-02" }] });
    }
    throw new Error(`unexpected synthetic route ${url.pathname}`);
  } });
  const imageService = new OwnerHailuo02I2vImageReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client, now: () => now });
  const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService: imageService, now: () => now });
  try {
    const uploaded = await imageService.uploadImage({ attemptId: ATTEMPT, filename: "кадр.png", mime_type: "image/png", bytes: new Uint8Array(PNG) });
    const makeOperation = async (prompt: string) => {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "hailuo-02", prompt, resolution: "768p", video_duration: 6, image_handle: uploaded.image_handle });
      const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
      const permit = await createOwnerHailuo02I2vOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
      return { preparer, candidate, permit, imageReferenceService: imageService, principal, attemptId: ATTEMPT, linkService: links, binding: BINDING } satisfies OwnerHailuo02I2vNativeOperationInput;
    };
    const operation = await makeOperation("A quiet garden path at dawn, one continuous shot.");
    const forged = Object.freeze(Object.create(null) as object);
    await assert.rejects(createOwnerHailuo02I2vChat(operation, forged), (error: unknown) => error instanceof Error && error.message.includes("safely"));
    const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { throw new Error("must not fetch"); } });
    await assert.rejects(foreignClient.createOwnerHailuo02I2vChat(operation));
    const chat = await client.createOwnerHailuo02I2vChat(operation);
    const startInput = { ...operation, chat };
    assert.deepEqual(await client.startOwnerHailuo02I2vWithOwnedCandidate(startInput), { chat_uuid: CHAT, message_id: ACK });
    await assert.rejects(client.startOwnerHailuo02I2vWithOwnedCandidate(startInput));
    assert.equal(generations, 1); assert.equal(creates, 1);
    const history = await client.listOwnedHailuo02I2vCandidates(chat);
    assert.equal(history.status, "COMPLETE"); assert.equal(history.owner_ack_status, "MATCHED"); assert.equal(history.contexts.length, 1);
    const unknownOperation = await makeOperation("A second synthetic request that loses its response.");
    const unknownChat = await client.createOwnerHailuo02I2vChat(unknownOperation);
    const unknownInput = { ...unknownOperation, chat: unknownChat }; failUnknown = true;
    await assert.rejects(client.startOwnerHailuo02I2vWithOwnedCandidate(unknownInput),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
    await assert.rejects(client.startOwnerHailuo02I2vWithOwnedCandidate(unknownInput));
    assert.equal(generations, 2, "unknown dispatch and replay attempt do not issue a second POST");

    now += 16 * 60_000;
    const resultContext = history.contexts[0]!;
    await assert.rejects(foreignClient.getOwnedHailuo02I2vResult(resultContext));
    const result = await client.getOwnedHailuo02I2vResult(resultContext);
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED"); assert.equal(result.ready_videos.length, 1);
    assert.equal(result.ready_videos[0]?.object_url, OUTPUT_URL); assert.equal(historyGets, 1); assert.equal(resultGets, 1);
    await assert.rejects(client.getOwnedHailuo02I2vResult({ ...resultContext }));
  } finally { await preparer.close(); await imageService.close(); }
});
