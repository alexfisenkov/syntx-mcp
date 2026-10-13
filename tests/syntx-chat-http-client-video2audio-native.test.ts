import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OBSERVED_AUTHORIZATION_PROFILE } from "../src/auth/types.js";
import type { AuthBinding, AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { createOwnerVideo2AudioSourceProfile } from "../src/application/owner-video2audio-source-profile.js";
import { OwnerVideo2AudioOriginalReferenceService } from "../src/application/owner-video2audio-original-reference-service.js";
import { createOwnerVideo2AudioRequestPreparer } from "../src/application/owner-video2audio-request-preparer.js";
import { createOwnerVideo2AudioOneShotPermit } from "../src/application/owner-video2audio-one-shot-policy.js";

const ATTEMPT = "link_video2audio_native_owner_0123456789";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "video2audio-native-tenant", subject: "video2audio-native-owner" });
const OTHER_ATTEMPT = "link_video2audio_native_other_0123456789";
const OTHER_BINDING: AuthBinding = Object.freeze({ tenant_id: "video2audio-other-tenant", subject: "video2audio-other-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32]);
const ORIGINAL_URL = "https://r2.syntx.ai/video2audio/native-original.mp4";
const OTHER_ORIGINAL_URL = "https://r2.syntx.ai/video2audio/native-original-other.mp4";
const VIDEO_URL = "https://r2.syntx.ai/video2audio/native-result.mp4";
const AUDIO_URL = "https://r2.syntx.ai/video2audio/native-result.m4a";
const PROMPT = "Create a gentle acoustic track from the supplied pond video.";
const UNCERTAIN_PROMPT = `${PROMPT} Keep it instrumental.`;
const OTHER_PROMPT = "Create a different score for a separately linked owner.";

interface NativeVideo2AudioClient {
  createVideo2AudioChat(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  startVideo2AudioWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<{ readonly chat_uuid: string; readonly message_id: string }>;
  listOwnedVideo2AudioResultCandidates(input: unknown, signal?: AbortSignal): Promise<{
    readonly status: string; readonly owner_ack_status: string; readonly contexts: readonly unknown[];
  }>;
  getOwnedVideo2AudioResult(input: unknown, signal?: AbortSignal): Promise<{
    readonly ready_artifacts: readonly { readonly object_type: string }[];
  }>;
  invalidateVideo2AudioAttempt(attemptId: string): number;
}

function native(client: SyntxChatHttpClient): NativeVideo2AudioClient { return client as unknown as NativeVideo2AudioClient; }
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-video2audio-native-credential"); } };
}
function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("fresh Node process imports native client before Video2Audio upload/preparer/policy without an ESM cycle", () => {
  const clientUrl = new URL("../src/adapter/syntx/chat-http-client.js", import.meta.url).href;
  const originalUrl = new URL("../src/application/owner-video2audio-original-reference-service.js", import.meta.url).href;
  const preparerUrl = new URL("../src/application/owner-video2audio-request-preparer.js", import.meta.url).href;
  const policyUrl = new URL("../src/application/owner-video2audio-one-shot-policy.js", import.meta.url).href;
  const script = `const client = await import(${JSON.stringify(clientUrl)}); await import(${JSON.stringify(originalUrl)}); await import(${JSON.stringify(preparerUrl)}); await import(${JSON.stringify(policyUrl)}); if (typeof client.SyntxChatHttpClient.prototype.startVideo2AudioWithOwnedCandidate !== "function") process.exit(17);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 5_000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

async function linkedService(now: () => number, attemptId = ATTEMPT, binding = BINDING) {
  const provider: AuthLinkProvider = {
    authorizationProfile: OBSERVED_AUTHORIZATION_PROFILE,
    async createChallenge() { return { upstream_attempt_id: `synthetic-${attemptId}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_attempt, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-video2audio-native-token" });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(now);
  const links = new PerUserLinkService(provider, store, { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attemptId });
  await links.createAttempt(binding);
  await links.issueHandoff(binding, attemptId);
  await links.checkAttempt(binding, attemptId);
  return links;
}

test("SyntxChatHttpClient exposes the four nominal Video2Audio native generation/history/result methods", () => {
  const methods = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
  for (const name of ["createVideo2AudioChat", "startVideo2AudioWithOwnedCandidate",
    "listOwnedVideo2AudioResultCandidates", "getOwnedVideo2AudioResult"]) {
    assert.equal(typeof methods[name], "function", `MISSING_VIDEO2AUDIO_NATIVE_METHOD:${name}`);
  }
});

test("native Video2Audio chat needs no permit, dispatches exact owned body once, then binds video and audio GET results", async () => {
  let now = 2_000, uploadPosts = 0, chatPosts = 0, generationPosts = 0, historyGets = 0, resultGets = 0;
  const events: string[] = [];
  const links = await linkedService(() => now);
  const profile = createOwnerVideo2AudioSourceProfile();
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body instanceof FormData ? null : init?.body === undefined ? null : JSON.parse(String(init.body)) as unknown;
    events.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/v1/chats/upload-files" && method === "POST") {
      uploadPosts += 1;
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), "video2audio");
      return response({ total: 1, successful: 1, failed: 0, duplicates: 0, files: [{ filename: uploadPosts === 1 ? "original.mp4" : "other-original.mp4",
        url: uploadPosts === 1 ? ORIGINAL_URL : OTHER_ORIGINAL_URL, status: "success", content_type: "video/mp4", size: MP4.byteLength, duration: 5.64 }] });
    }
    if (url.pathname === "/api/v1/chats" && method === "POST") {
      chatPosts += 1;
      assert.deepEqual(body, { title: (body as { title: string }).title, scope: "audio" });
      return response({ uuid: `video2audio-native-chat-${chatPosts}` });
    }
    if (url.pathname === "/api/v1/audio/generate" && method === "POST") {
      generationPosts += 1;
      assert.equal(url.search, "?ai_name=video2audio");
      const request = body as { chat_uuid: string; prompt: string; settings: unknown };
      const expectedPrompt = request.chat_uuid.endsWith("-1") ? PROMPT
        : request.chat_uuid.endsWith("-2") ? UNCERTAIN_PROMPT : request.chat_uuid.endsWith("-3") ? OTHER_PROMPT : request.prompt;
      const expectedOriginalUrl = request.chat_uuid.endsWith("-3") ? OTHER_ORIGINAL_URL : ORIGINAL_URL;
      assert.deepEqual(body, { chat_uuid: request.chat_uuid, prompt: expectedPrompt, settings: {
        model_type: "video2audio", mode: "generate", duration: 5.64, negative_prompt: "", seed: 0,
        file_urls: [{ type: "video", url: expectedOriginalUrl }]
      } });
      if (request.chat_uuid.endsWith("-2")) throw new Error("server may have accepted generation before response was lost");
      return response({ id: request.chat_uuid.endsWith("-3") ? "video2audio-owner-ack-3" : "video2audio-owner-ack-1" });
    }
    if ((url.pathname === "/api/v1/chats/video2audio-native-chat-1/messages" ||
        url.pathname === "/api/v1/chats/video2audio-native-chat-3/messages") && method === "GET") {
      historyGets += 1;
      const page = Number(url.searchParams.get("page"));
      assert.ok(page === 1 || page === 2);
      assert.equal(url.searchParams.get("page_size"), "10");
      if (url.pathname.endsWith("chat-3/messages")) return response({ messages: [
        { id: "video2audio-owner-ack-3", chat_id: 41358, author_id: 7021, message_object: [{ id: "video2audio-owner-text-3",
          message_id: "video2audio-owner-ack-3", object_type: "text", object_text: OTHER_PROMPT, model_type: "video2audio" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
      const rows = [
        { id: "video2audio-owner-ack-1", chat_id: 41356, author_id: 7021, message_object: [{ id: "video2audio-owner-text-1",
          message_id: "video2audio-owner-ack-1", object_type: "text", object_text: PROMPT, model_type: "video2audio" }] },
        { id: "video2audio-bot-result-1", chat_id: 41356, author_id: -1, message_object: [
          { id: "video2audio-video-object-1", message_id: "video2audio-bot-result-1", object_type: "video", model_type: "video2audio" },
          { id: "video2audio-audio-object-1", message_id: "video2audio-bot-result-1", object_type: "audio", model_type: "video2audio" }
        ] },
        ...Array.from({ length: 8 }, (_, index) => ({ id: `video2audio-history-${index + 1}`, chat_id: 41356, author_id: 7021,
          message_object: [{ id: `video2audio-history-object-${index + 1}`, message_id: `video2audio-history-${index + 1}`,
            object_type: "text", object_text: "history" }] }))
      ];
      return response({ messages: page === 1 ? rows : [{ id: "video2audio-history-11", chat_id: 41356, author_id: 7021,
        message_object: [{ id: "video2audio-history-object-11", message_id: "video2audio-history-11",
          object_type: "text", object_text: "history" }] }],
      pagination: { page, page_size: 10, total_count: 11, total_pages: 2, has_next: page === 1, has_previous: page === 2 } });
    }
    if (url.pathname === "/api/v1/chats/video2audio-native-chat-1/video2audio-bot-result-1" && method === "GET") {
      resultGets += 1;
      return response({ id: "video2audio-bot-result-1", chat_id: 41356, author_id: -1, message_object: [
        { id: "video2audio-video-object-1", message_id: "video2audio-bot-result-1", object_type: "video", model_type: "video2audio",
          completed: true, object_url: VIDEO_URL },
        { id: "video2audio-audio-object-1", message_id: "video2audio-bot-result-1", object_type: "audio", model_type: "video2audio",
          completed: true, object_url: AUDIO_URL }
      ] });
    }
    throw new Error(`Unexpected synthetic route ${method} ${url.pathname}`);
  } });
  const originalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: BINDING, linkService: links,
    resolveClient: () => client, now: () => now });
  const preparer = createOwnerVideo2AudioRequestPreparer({ profile, originalReferenceService: originalService, now: () => now });
  const otherLinks = await linkedService(() => now, OTHER_ATTEMPT, OTHER_BINDING);
  const otherOriginalService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: OTHER_BINDING,
    linkService: otherLinks, resolveClient: () => client, now: () => now });
  const otherPreparer = createOwnerVideo2AudioRequestPreparer({ profile, originalReferenceService: otherOriginalService, now: () => now });
  try {
    const uploaded = await originalService.uploadOriginal({ attemptId: ATTEMPT, filename: "original.mp4", mime_type: "video/mp4", bytes: MP4 });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: PROMPT, video_original_handle: uploaded.video_original_handle });
    const candidateExpiresAt = candidate.expires_at;
    const binding = preparer.inspectCandidate(candidate);
    assert.ok(binding);
    const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
    const nativeClient = native(client);
    await assert.rejects(nativeClient.createVideo2AudioChat({ preparer, candidate, principal,
      attemptId: ATTEMPT, chat_uuid: "caller-selected" }), { code: "INVALID_REQUEST" });
    const preAborted = new AbortController();
    preAborted.abort();
    await assert.rejects(nativeClient.createVideo2AudioChat({ preparer, candidate, principal, attemptId: ATTEMPT }, preAborted.signal),
      { code: "REQUEST_ABORTED" });
    const chat = await nativeClient.createVideo2AudioChat({ preparer, candidate, principal, attemptId: ATTEMPT });
    assert.equal(chat.chat_uuid, "video2audio-native-chat-1");
    assert.equal(chat.dispatch_allowed, false);
    assert.equal(generationPosts, 0, "chat creation is not generation and requires no permit");
    await assert.rejects(nativeClient.listOwnedVideo2AudioResultCandidates({ chat: { ...chat }, authorizeGet: async () => {} }),
      { code: "CHAT_CONTEXT_INVALID" });
    const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
      throw new Error("foreign client must not fetch");
    } });
    await assert.rejects(native(foreignClient).listOwnedVideo2AudioResultCandidates({ chat, authorizeGet: async () => {} }),
      { code: "CHAT_CONTEXT_INVALID" });

    const permit = await createOwnerVideo2AudioOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
    await assert.rejects(nativeClient.startVideo2AudioWithOwnedCandidate({ preparer, candidate, permit, principal,
      attemptId: ATTEMPT, chat, extra: true }));
    await assert.rejects(nativeClient.startVideo2AudioWithOwnedCandidate({ preparer, candidate,
      permit: structuredClone(permit), principal, attemptId: ATTEMPT, chat }), { code: "INVALID_REQUEST" });
    const generationReceipt = await nativeClient.startVideo2AudioWithOwnedCandidate({ preparer, candidate, permit,
      principal, attemptId: ATTEMPT, chat });
    assert.deepEqual(generationReceipt, { chat_uuid: "video2audio-native-chat-1", message_id: "video2audio-owner-ack-1" });
    assert.equal(generationPosts, 1);

    const uncertainCandidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: UNCERTAIN_PROMPT,
      video_original_handle: uploaded.video_original_handle });
    const uncertainChat = await nativeClient.createVideo2AudioChat({ preparer, candidate: uncertainCandidate, principal, attemptId: ATTEMPT });
    const uncertainPermit = await createOwnerVideo2AudioOneShotPermit({ preparer, candidate: uncertainCandidate, principal, attemptId: ATTEMPT });
    const uncertainStart = { preparer, candidate: uncertainCandidate, permit: uncertainPermit, principal,
      attemptId: ATTEMPT, chat: uncertainChat };
    await assert.rejects(nativeClient.startVideo2AudioWithOwnedCandidate(uncertainStart), { code: "OUTCOME_UNKNOWN" });
    const uncertainList = await nativeClient.listOwnedVideo2AudioResultCandidates({ chat: uncertainChat, authorizeGet: async () => {} });
    assert.equal(uncertainList.status, "UNVERIFIED");
    assert.equal(uncertainList.owner_ack_status, "MISSING");
    assert.deepEqual(uncertainList.contexts, [], "lost ACK never creates speculative history/result authority");
    assert.equal(historyGets, 0, "without a source-backed original-reference echo, uncertain ACK is not correlated to results");
    await assert.rejects(nativeClient.startVideo2AudioWithOwnedCandidate(uncertainStart), { code: "CHAT_DISPATCH_ALREADY_STARTED" });
    assert.equal(generationPosts, 2, "a lost generation ACK is never replayed");

    const otherUploaded = await otherOriginalService.uploadOriginal({ attemptId: OTHER_ATTEMPT, filename: "other-original.mp4",
      mime_type: "video/mp4", bytes: MP4 });
    const otherCandidate = await otherPreparer.prepare({ attemptId: OTHER_ATTEMPT, prompt: OTHER_PROMPT,
      video_original_handle: otherUploaded.video_original_handle });
    const otherPrincipal = await resolveOwnerReferencePrincipal({ binding: OTHER_BINDING, attemptId: OTHER_ATTEMPT, linkService: otherLinks });
    const otherChat = await nativeClient.createVideo2AudioChat({ preparer: otherPreparer, candidate: otherCandidate,
      principal: otherPrincipal, attemptId: OTHER_ATTEMPT });
    const otherPermit = await createOwnerVideo2AudioOneShotPermit({ preparer: otherPreparer, candidate: otherCandidate,
      principal: otherPrincipal, attemptId: OTHER_ATTEMPT });
    await nativeClient.startVideo2AudioWithOwnedCandidate({ preparer: otherPreparer, candidate: otherCandidate,
      permit: otherPermit, principal: otherPrincipal, attemptId: OTHER_ATTEMPT, chat: otherChat });
    assert.equal(generationPosts, 3);

    for (let index = 0; index < 125; index += 1) {
      const overflowCandidate = await preparer.prepare({ attemptId: ATTEMPT, prompt: `${PROMPT} Take ${index}.`,
        video_original_handle: uploaded.video_original_handle });
      await nativeClient.createVideo2AudioChat({ preparer, candidate: overflowCandidate, principal, attemptId: ATTEMPT });
    }
    const overflowPreparer = createOwnerVideo2AudioRequestPreparer({ profile, originalReferenceService: originalService, now: () => now });
    try {
      const deniedCandidate = await overflowPreparer.prepare({ attemptId: ATTEMPT, prompt: `${PROMPT} 129th operation.`,
        video_original_handle: uploaded.video_original_handle });
      await assert.rejects(nativeClient.createVideo2AudioChat({ preparer: overflowPreparer, candidate: deniedCandidate,
        principal, attemptId: ATTEMPT }), { code: "CAPACITY_EXCEEDED" });
    } finally { await overflowPreparer.close(); }
    assert.equal(chatPosts, 128, "128 non-evicting chat/unknown holds fill the per-client bound; 129th fails before POST");

    now += 16 * 60_000;
    assert.ok(now > candidateExpiresAt, "input candidate TTL is expired before long-job reconciliation");
    const authorizeGet = async () => {
      const current = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
      assert.deepEqual(current, principal, "each GET gate re-resolves the same current owner principal");
    };
    let authorizationChecks = 0;
    await assert.rejects(nativeClient.listOwnedVideo2AudioResultCandidates({ chat, authorizeGet: async () => {
      authorizationChecks += 1;
      if (authorizationChecks === 3) throw new Error("principal changed");
    } }), { code: "GET_AUTHORIZATION_FAILED" });
    assert.equal(historyGets, 1, "second history GET is denied after current-principal recheck");
    const listed = await nativeClient.listOwnedVideo2AudioResultCandidates({ chat, authorizeGet });
    assert.equal(listed.status, "COMPLETE", JSON.stringify(listed));
    assert.equal(listed.owner_ack_status, "MATCHED");
    assert.equal(listed.contexts.length, 1);
    const context = listed.contexts[0] as Record<string, unknown>;
    assert.equal("url" in context, false);
    const result = await nativeClient.getOwnedVideo2AudioResult({ context, authorizeGet });
    assert.deepEqual(result.ready_artifacts.map((artifact: { object_type: string }) => artifact.object_type), ["video", "audio"]);
    assert.equal(nativeClient.invalidateVideo2AudioAttempt(ATTEMPT), 127);
    await assert.rejects(nativeClient.listOwnedVideo2AudioResultCandidates({ chat, authorizeGet }), { code: "CHAT_CONTEXT_INVALID" });
    await assert.rejects(nativeClient.getOwnedVideo2AudioResult({ context, authorizeGet }), { code: "RESULT_CONTEXT_INVALID" });
    assert.equal(historyGets, 3, "invalidated chat performs no further history GET");
    assert.equal(resultGets, 1, "invalidated result context performs no further GET");
    const otherListed = await nativeClient.listOwnedVideo2AudioResultCandidates({
      chat: otherChat,
      authorizeGet: async () => {
        const current = await resolveOwnerReferencePrincipal({ binding: OTHER_BINDING, attemptId: OTHER_ATTEMPT, linkService: otherLinks });
        assert.deepEqual(current, otherPrincipal);
      }
    });
    assert.equal(otherListed.owner_ack_status, "MATCHED", "invalidating one attempt leaves the other owner's native state intact");
    assert.deepEqual(events.slice(0, 3), ["POST /api/v1/chats/upload-files", "POST /api/v1/chats", "POST /api/v1/audio/generate"]);
    assert.equal(uploadPosts, 2);
    assert.equal(chatPosts, 128);
    assert.equal(historyGets, 4);
    assert.equal(resultGets, 1);
  } finally {
    await preparer.close();
    await originalService.close();
    await otherPreparer.close();
    await otherOriginalService.close();
  }
});
