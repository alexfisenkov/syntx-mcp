import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { snapshotGenerationPrincipal } from "../src/domain/generation-principal.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import { createOwnerTopazAstraOwnedRequestPreparer, type OwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import { createOwnerTopazAstraOwnedOneShotPermit } from "../src/application/owner-topaz-astra-owned-one-shot-policy.js";
import {
  createOwnerTopazAstraNativeChat, type OwnerTopazAstraNativeOperationInput
} from "../src/adapter/syntx/owner-topaz-astra-native-context.js";

const ATTEMPTS = ["link_topaz_native_0123456789", "link_topaz_native_1123456789", "link_topaz_native_2123456789", "link_topaz_native_3123456789"] as const;
const MODELS = ["slc-1", "slf-2", "slp-2", "slp-2.5"] as const;
const BINDING = Object.freeze({ tenant_id: "topaz-native-tenant", subject: "topaz-native-subject" });
const SOURCE = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);
const SOURCE_URL = "https://r2.syntx.ai/topaz/native-source.mp4";
const RESULT_URL = "https://r2.syntx.ai/topaz/native-result.mp4";
const CHAT = "topaz-native-chat";
const ACK = "topaz-native-ack";
const RESULT_MESSAGE = "topaz-native-result-message";
const RESULT_OBJECT = "topaz-native-result-object";

function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-topaz-native-credential"); } }; }
function response(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
async function ownerLinks() {
  let n = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `provider-${n}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => 1_000), { now: () => 1_000, attemptIdGenerator: () => ATTEMPTS[n++]! });
  for (const attemptId of ATTEMPTS) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, attemptId); await links.checkAttempt(BINDING, attemptId); }
  return links;
}

test("native Topaz binds genuine owned inputs, fixed wire, one-shot POST, owned history and GET-only result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-native-1480-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n"); await chmod(ffprobe, 0o700);
  const links = await ownerLinks(); let preparerNow = 1_000, generationCalls = 0, historyCalls = 0, resultCalls = 0, createCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4", duration: 3.2 }] });
    if (url.pathname.endsWith("/chats")) { createCalls++; const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["title", "scope"]); assert.match(String(body.title), /^owner-topaz-astra-[0-9a-f-]{36}$/u);
      assert.equal(body.scope, "tool_video_upscaler"); return response({ uuid: CHAT }); }
    if (url.pathname.endsWith("/video/generate")) {
      generationCalls++; const body = JSON.parse(String(init?.body)) as Record<string, any>;
      assert.equal(url.search, "?ai_name=topaz_astra"); assert.deepEqual(Object.keys(body), ["chat_id", "prompt", "settings"]);
      assert.equal(body.chat_id, CHAT); assert.equal(body.prompt, "Keep the motion natural.");
      assert.deepEqual(Object.keys(body.settings), ["model_type", "video_duration", "resolution", "frame_rate", "slowmo", "creativity", "file_urls"]);
      assert.equal(body.settings.model_type, "slc-1"); assert.deepEqual(body.settings.resolution, { width: 1920, height: 1080 });
      assert.equal(body.settings.frame_rate, 24); assert.equal(body.settings.slowmo, null); assert.equal(body.settings.creativity, "middle");
      assert.equal(body.settings.video_duration, 3); assert.deepEqual(body.settings.file_urls, [{ type: "video", url: SOURCE_URL }]);
      assert.equal(Object.hasOwn(body.settings, "n"), false);
      return response({ id: ACK });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`)) {
      historyCalls++; return response({ messages: [
        { id: ACK, chat_id: 77201, author_id: 17, message_object: [] },
        { id: RESULT_MESSAGE, chat_id: 77201, author_id: -1, message_object: [{ id: RESULT_OBJECT, message_id: RESULT_MESSAGE,
          object_type: "video", object_url: RESULT_URL, completed: true, model_type: "slc-1" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/${RESULT_MESSAGE}`)) {
      resultCalls++; return response({ id: RESULT_MESSAGE, chat_id: 77201, author_id: -1, message_object: [{ id: RESULT_OBJECT,
        message_id: RESULT_MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "slc-1" }] });
    }
    throw new Error(`unexpected synthetic route ${url.pathname}`);
  } });
  const service = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING, linkService: links, resolveClient: () => client, now: () => 1_000 });
  const preparer: OwnerTopazAstraOwnedRequestPreparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: service, now: () => preparerNow });
  try {
    const prepared: { attemptId: string; candidate: any; permit: any; principal: ReturnType<typeof snapshotGenerationPrincipal> }[] = [];
    for (let i = 0; i < MODELS.length; i++) {
      const attemptId = ATTEMPTS[i]!, model_id = MODELS[i]!;
      const uploaded = await service.uploadOriginal({ attemptId, model_id, filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
      const candidate = await preparer.prepare({ attemptId, topaz_original_handle: uploaded.topaz_original_handle, model_id,
        ...(i === 1 ? { prompt: "" } : { prompt: "Keep the motion natural." }), parameters: { resolution: i % 2 ? "3840x2160" : "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle" } });
      const request = preparer.getPrivateRequest(candidate);
      assert.deepEqual(request.settings.resolution, i % 2 ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 });
      assert.equal(Object.hasOwn(request.settings, "creativity"), model_id === "slc-1" || model_id === "slp-2.5");
      assert.equal(Object.hasOwn(request, "prompt"), i !== 1); assert.equal(request.settings.file_urls[0]?.type, "video");
      const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: attemptId });
      const permit = await createOwnerTopazAstraOwnedOneShotPermit({ preparer, candidate, principal, attemptId });
      prepared.push({ attemptId, candidate, permit, principal });
    }
    const selected = prepared[0]!;
    const operation: OwnerTopazAstraNativeOperationInput = { preparer, candidate: selected.candidate, permit: selected.permit, originalReferenceService: service, principal: selected.principal,
      attemptId: selected.attemptId, linkService: links, binding: BINDING };
    await assert.rejects(client.createOwnerTopazAstraChat({ ...operation, candidate: { ...selected.candidate } }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_INVALID");
    let foreignCalls = 0;
    const foreignClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => { foreignCalls++; return response({}); } });
    await assert.rejects(foreignClient.createOwnerTopazAstraChat(operation),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_INVALID");
    assert.equal(foreignCalls, 0, "client mismatch is rejected before free-chat POST");
    const chat = await client.createOwnerTopazAstraChat(operation);
    assert.equal(chat.model_id, "slc-1"); assert.equal(chat.dispatch_allowed, false); assert.equal(JSON.stringify(chat).includes(SOURCE_URL), false);
    const startInput = { ...operation, chat };
    const started = await client.startTopazAstraWithOwnedCandidate(startInput);
    assert.deepEqual(started, { chat_uuid: CHAT, message_id: ACK }); assert.equal(generationCalls, 1); assert.equal(createCalls, 1);
    await assert.rejects(client.startTopazAstraWithOwnedCandidate(startInput), (error: unknown) => error instanceof Error && "code" in error && error.code === "CHAT_CONTEXT_INVALID");
    const candidates = await client.listOwnedTopazAstraCandidates(chat);
    assert.equal(candidates.status, "COMPLETE"); assert.equal(candidates.owner_ack_status, "MATCHED"); assert.equal(candidates.contexts.length, 1);
    preparerNow += 16 * 60_000;
    const result = await client.getOwnedTopazAstraResult(candidates.contexts[0]);
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED"); assert.equal(result.ready_videos.length, 1);
    assert.equal(result.ready_videos[0]?.object_url, RESULT_URL); assert.equal(historyCalls, 1); assert.equal(resultCalls, 1);
    await assert.rejects(client.getOwnedTopazAstraResult({ ...candidates.contexts[0] }), (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_CONTEXT_INVALID");
    await assert.rejects(createOwnerTopazAstraNativeChat(operation, Object.freeze({})), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    const otherClient = foreignClient;
    await assert.rejects(otherClient.getOwnedTopazAstraResult(candidates.contexts[0]), (error: unknown) => error instanceof Error && "code" in error && error.code === "RESULT_CONTEXT_INVALID");
    assert.equal(generationCalls, 1, "replay and forged helper packets issue no second generation POST");
  } finally { await preparer.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Topaz native marks dispatch unknown before awaiting and prevents a concurrent second generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-pending-1480-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n"); await chmod(ffprobe, 0o700);
  const links = await ownerLinks(); let generationCalls = 0, resolveGeneration!: (value: Response) => void, entered!: () => void;
  const pending = new Promise<void>((resolve) => { entered = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, _init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ url: SOURCE_URL, status: "success", size: SOURCE.byteLength, content_type: "video/mp4", duration: 3.2 }] });
    if (url.pathname.endsWith("/chats")) return response({ uuid: CHAT });
    if (url.pathname.endsWith("/video/generate")) { generationCalls++; entered(); return new Promise<Response>((resolve) => { resolveGeneration = resolve; }); }
    throw new Error("unexpected route");
  } });
  const service = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING, linkService: links, resolveClient: () => client, now: () => 1_000 });
  const preparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: service, now: () => 1_000 });
  try {
    const uploaded = await service.uploadOriginal({ attemptId: ATTEMPTS[0], model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const candidate = await preparer.prepare({ attemptId: ATTEMPTS[0], topaz_original_handle: uploaded.topaz_original_handle, model_id: "slc-1", prompt: "x",
      parameters: { resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "low" } });
    const principal = snapshotGenerationPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPTS[0] });
    const permit = await createOwnerTopazAstraOwnedOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPTS[0] });
    const operation = { preparer, candidate, permit, originalReferenceService: service, principal, attemptId: ATTEMPTS[0], linkService: links, binding: BINDING };
    const chat = await client.createOwnerTopazAstraChat(operation), startInput = { ...operation, chat };
    const first = client.startTopazAstraWithOwnedCandidate(startInput); await pending;
    await assert.rejects(client.startTopazAstraWithOwnedCandidate(startInput));
    assert.equal(generationCalls, 1); resolveGeneration(response({ id: ACK })); await first;
  } finally { await preparer.close(); await service.close(); await rm(directory, { recursive: true, force: true }); }
});
