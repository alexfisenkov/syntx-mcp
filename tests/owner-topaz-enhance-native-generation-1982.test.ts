import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readOwnerTopazEnhanceOriginalUploadForClient, SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { OwnerTopazEnhanceOriginalReferenceService } from "../src/application/owner-topaz-enhance-original-reference-service.js";
import { createOwnerTopazEnhanceOwnedRequestPreparer, isOwnerTopazEnhanceOwnedPreparedCandidate,
  isOwnerTopazEnhanceOwnedRequestPreparer } from "../src/application/owner-topaz-enhance-owned-request-preparer.js";
import { createOwnerTopazEnhanceOwnedOneShotPermit, revalidateOwnerTopazEnhanceOwnedOneShotPermit } from "../src/application/owner-topaz-enhance-owned-one-shot-policy.js";

const ATTEMPT = "link_topaz_enhance_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "topaz-enhance-native-tenant", subject: "topaz-enhance-native-owner" });
const MP4 = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x31, 0, 0, 0, 8, 0x6d, 0x64, 0x61, 0x74]);
const UPLOAD_URL = "https://r2.syntx.ai/topaz-enhance/hidden/native-source.mp4";
const CHAT = "topaz-enhance-native-chat";
const ACK = "topaz-enhance-native-ack";
const RESULT_MESSAGE = "topaz-enhance-native-result-message";
const RESULT_OBJECT = "topaz-enhance-native-result-object";
const RESULT_URL = "https://r2.syntx.ai/topaz-enhance/native-result.mp4";
const FFPROBE_JSON = JSON.stringify({ streams: [
  { codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "90", duration: "3.000000", disposition: { attached_pic: 0 } },
  { codec_type: "audio", codec_name: "aac", duration: "3.000000" }
], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" } });

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function ffprobeFixture(): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-native-1982-"));
  const binary = join(directory, "ffprobe-fixture");
  await writeFile(binary, `#!/bin/sh\nprintf '%s' ${shellQuote(FFPROBE_JSON)}\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}
function broker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-enhance-native-credential"); } }; }
function response(payload: unknown): Response { return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }); }
async function linkedOwner(now: () => number): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-topaz-enhance-native", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => ATTEMPT });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}

async function ownedInputs(input: {
  readonly client: SyntxChatHttpClient;
  readonly links: PerUserLinkService;
  readonly ffprobePath: string;
  readonly now: () => number;
  readonly blur?: number;
  readonly resolveClient?: () => unknown;
}) {
  const originalReferenceService = new OwnerTopazEnhanceOriginalReferenceService({ ffprobePath: input.ffprobePath, destination: "hidden",
    binding: BINDING, linkService: input.links, resolveClient: input.resolveClient ?? (() => input.client), now: input.now });
  const preparer = createOwnerTopazEnhanceOwnedRequestPreparer({ originalReferenceService, now: input.now });
  const uploaded = await originalReferenceService.uploadOriginal({ attemptId: ATTEMPT, model_id: "topaz_enhance", filename: "source.mp4", mime_type: "video/mp4", bytes: MP4 });
  const candidate = await preparer.prepare({ attemptId: ATTEMPT, topaz_original_handle: uploaded.topaz_original_handle, model_id: "topaz_enhance",
    parameters: { blur: input.blur ?? 0, halo: 0, focus: "off", grain: "off", model: "rhea-1", noise: 0, details: 0, preblur: 0,
      upscale: 1, prenoise: 0, compression: 0, interpolation: 60 } });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT } as const;
  const permit = await createOwnerTopazEnhanceOwnedOneShotPermit({ preparer, candidate, principal, attemptId: ATTEMPT });
  return { originalReferenceService, preparer, candidate, permit, principal,
    operation: { preparer, candidate, permit, originalReferenceService, principal, attemptId: ATTEMPT, linkService: input.links, binding: BINDING },
    close: async () => { await preparer.close(); await originalReferenceService.close(); } };
}

test("Topaz Enhance rejects an unbound native operation before credentials or network", async () => {
  let credentialCalls = 0, networkCalls = 0;
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1;
    return operation("synthetic-native-generation-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async () => {
    networkCalls += 1;
    return new Response("{}", { headers: { "content-type": "application/json" } });
  } });
  const create = Reflect.get(client, "createOwnerTopazEnhanceChat");

  await assert.rejects(
    async () => Reflect.apply(create as (...args: unknown[]) => unknown, client, [{}]),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST"
  );
  assert.equal(credentialCalls, 0);
  assert.equal(networkCalls, 0);
});

test("Topaz Enhance native chat can be created from a genuine owned candidate", async () => {
  const fixture = await ffprobeFixture();
  let mediaNow = 1_000;
  const linkNow = () => 1_000;
  const links = await linkedOwner(linkNow);
  let uploadCalls = 0, chatCalls = 0, generationCalls = 0, historyCalls = 0, resultCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) {
      uploadCalls += 1;
      return response({ files: [{ filename: "source.mp4", url: UPLOAD_URL, status: "success", size: MP4.byteLength, content_type: "video/mp4", duration: 3 }] });
    }
    if (url.pathname.endsWith("/chats")) {
      chatCalls += 1;
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["title", "scope"]);
      assert.equal(body.scope, "tool_video_upscaler");
      return response({ uuid: CHAT });
    }
    if (url.pathname.endsWith("/video/generate")) {
      generationCalls += 1;
      assert.equal(url.search, "?ai_name=topaz_ai");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body), ["chat_id", "settings"]);
      assert.equal(body.chat_id, CHAT);
      assert.equal(Object.hasOwn(body, "prompt"), false);
      assert.equal(Object.hasOwn(body, "n"), false);
      assert.deepEqual(body.settings, {
        model_type: "topaz_enhance", resolution: "1", video_duration: 3, width: 640, height: 360,
        parameters: { blur: 0, halo: 0, blend: 0, focus: "off", grain: "off", model: "rhea-1", noise: 0,
          details: 0, preblur: 0, promode: 0, upscale: 1, prenoise: 0, compression: 0, interpolation: 60 },
        file_urls: [{ type: "video", url: UPLOAD_URL }]
      });
      return response({ id: ACK });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`)) {
      historyCalls += 1;
      assert.equal(init?.method, "GET");
      assert.equal(url.search, "?page=1&page_size=10");
      return response({ messages: [
        { id: ACK, chat_id: 77201, author_id: 17, message_object: [] },
        { id: RESULT_MESSAGE, chat_id: 77201, author_id: -1, message_object: [{ id: RESULT_OBJECT,
          message_id: RESULT_MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "topaz_enhance" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    if (url.pathname.endsWith(`/chats/${CHAT}/${RESULT_MESSAGE}`)) {
      resultCalls += 1;
      assert.equal(init?.method, "GET");
      return response({ id: RESULT_MESSAGE, chat_id: 77201, author_id: -1, message_object: [{ id: RESULT_OBJECT,
        message_id: RESULT_MESSAGE, object_type: "video", object_url: RESULT_URL, completed: true, model_type: "topaz_enhance" }] });
    }
    throw new Error(`unexpected synthetic route ${url.pathname}`);
  } });
  const input = await ownedInputs({ client, links, ffprobePath: fixture.binary, now: () => mediaNow });
  try {
    assert.equal(isOwnerTopazEnhanceOwnedRequestPreparer(input.preparer), true);
    assert.equal(isOwnerTopazEnhanceOwnedPreparedCandidate(input.candidate), true);
    assert.equal(Object.getPrototypeOf(input.originalReferenceService), OwnerTopazEnhanceOriginalReferenceService.prototype);
    const candidateBinding = input.preparer.inspectCandidate(input.candidate);
    assert.ok(candidateBinding);
    assert.ok(candidateBinding.original_handle.length >= 36);
    assert.equal(candidateBinding.attempt_id, ATTEMPT);
    assert.equal(candidateBinding.model_id, "topaz_enhance");
    assert.equal(candidateBinding.source_binding.public_catalog_version, "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
    assert.equal(candidateBinding.original_sha256, input.candidate.original.sha256);
    assert.equal(candidateBinding.original_size, MP4.byteLength);
    assert.equal(candidateBinding.width, 640);
    assert.equal(candidateBinding.height, 360);
    assert.equal(candidateBinding.duration_seconds, 3);
    assert.equal(candidateBinding.frame_count, 90);
    assert.equal(input.candidate.dispatch_allowed, false);
    assert.equal(input.candidate.runtime_usable, false);
    assert.equal(input.candidate.backend_acceptance, "UNPROVEN");
    const preparedRequest = input.preparer.getPrivateRequest(input.candidate);
    assert.deepEqual(preparedRequest.settings, {
      model_type: "topaz_enhance", resolution: "1", video_duration: 3, width: 640, height: 360,
      parameters: { blur: 0, halo: 0, blend: 0, focus: "off", grain: "off", model: "rhea-1", noise: 0,
        details: 0, preblur: 0, promode: 0, upscale: 1, prenoise: 0, compression: 0, interpolation: 60 },
      file_urls: [{ type: "video", url: UPLOAD_URL }]
    });
    await input.preparer.revalidateCandidate(input.candidate);
    await revalidateOwnerTopazEnhanceOwnedOneShotPermit({ permit: input.permit, preparer: input.preparer,
      candidate: input.candidate, principal: input.principal, attemptId: ATTEMPT });
    const resolveInput = { attempt_id: ATTEMPT, topaz_original_handle: candidateBinding.original_handle };
    const resolution = await input.originalReferenceService.resolveOriginal(resolveInput);
    assert.equal(input.originalReferenceService.isOwnedOriginalResolution(resolution, resolveInput), true);
    const captured = input.originalReferenceService.withCapturedNativeOriginal(resolution, resolveInput,
      (capturedClient, nativeContext) => readOwnerTopazEnhanceOriginalUploadForClient(capturedClient, nativeContext));
    assert.equal(captured?.url, UPLOAD_URL);
    const create = Reflect.get(client, "createOwnerTopazEnhanceChat");
    await assert.rejects(Reflect.apply(create as (...args: unknown[]) => Promise<unknown>, client,
      [{ ...input.operation, candidate: { ...input.candidate } }]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_INVALID");
    assert.equal(chatCalls, 0, "a DTO-shaped candidate cannot cause a chat creation request");
    const chat = await Reflect.apply(create as (...args: unknown[]) => Promise<unknown>, client, [input.operation]);
    assert.equal(uploadCalls, 1);
    assert.equal(chatCalls, 1);
    assert.ok(chat && typeof chat === "object");
    assert.equal((chat as Record<string, unknown>).chat_uuid, CHAT);
    assert.equal((chat as Record<string, unknown>).model_id, "topaz_enhance");
    assert.equal((chat as Record<string, unknown>).dispatch_allowed, false);
    assert.equal((chat as Record<string, unknown>).backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(chat).includes(UPLOAD_URL), false);

    const start = Reflect.get(client, "startTopazEnhanceWithOwnedCandidate");
    const started = await Reflect.apply(start as (...args: unknown[]) => Promise<unknown>, client, [{ ...input.operation, chat }]);
    assert.deepEqual(started, { chat_uuid: CHAT, message_id: ACK });
    assert.equal(generationCalls, 1);

    mediaNow += 16 * 60_000;
    const list = Reflect.get(client, "listOwnedTopazEnhanceCandidates");
    const candidates = await Reflect.apply(list as (...args: unknown[]) => Promise<unknown>, client, [chat]) as Record<string, unknown>;
    assert.equal(candidates.status, "COMPLETE");
    assert.equal(candidates.owner_ack_status, "MATCHED");
    assert.equal(candidates.backend_acceptance, "UNPROVEN");
    assert.ok(Array.isArray(candidates.contexts));
    assert.equal(candidates.contexts.length, 1);
    const resultContext = (candidates.contexts as Record<string, unknown>[])[0];
    const get = Reflect.get(client, "getOwnedTopazEnhanceResult");
    const result = await Reflect.apply(get as (...args: unknown[]) => Promise<unknown>, client, [resultContext]) as Record<string, unknown>;
    assert.equal(result.message_binding, "BOUND");
    assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.ok(Array.isArray(result.ready_videos));
    assert.equal((result.ready_videos as Record<string, unknown>[])[0]?.object_url, RESULT_URL);
    assert.deepEqual({ uploadCalls, chatCalls, generationCalls, historyCalls, resultCalls },
      { uploadCalls: 1, chatCalls: 1, generationCalls: 1, historyCalls: 1, resultCalls: 1 });
  } finally { await input.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Topaz Enhance uncertain POST is never replayed and cannot invent an owner ACK", async () => {
  const fixture = await ffprobeFixture();
  let mediaNow = 1_000;
  const links = await linkedOwner(() => 1_000);
  let createCalls = 0, generationCalls = 0, historyCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: UPLOAD_URL,
      status: "success", size: MP4.byteLength, content_type: "video/mp4", duration: 3 }] });
    if (url.pathname.endsWith("/chats")) { createCalls += 1; return response({ uuid: CHAT }); }
    if (url.pathname.endsWith("/video/generate")) { generationCalls += 1; assert.equal(init?.method, "POST"); throw new Error("synthetic lost generation acknowledgement"); }
    if (url.pathname.endsWith(`/chats/${CHAT}/messages`)) {
      historyCalls += 1;
      return response({ messages: [
        { id: "unmatched-owner-message", chat_id: 77201, author_id: 17, message_object: [] },
        { id: RESULT_MESSAGE, chat_id: 77201, author_id: -1, message_object: [{ id: RESULT_OBJECT, message_id: RESULT_MESSAGE,
          object_type: "video", object_url: RESULT_URL, completed: true, model_type: "topaz_enhance" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_previous: false, has_next: false } });
    }
    throw new Error(`unexpected synthetic route ${url.pathname}`);
  } });
  const input = await ownedInputs({ client, links, ffprobePath: fixture.binary, now: () => mediaNow, blur: 1 });
  try {
    const create = Reflect.get(client, "createOwnerTopazEnhanceChat");
    const chat = await Reflect.apply(create as (...args: unknown[]) => Promise<unknown>, client, [input.operation]);
    const start = Reflect.get(client, "startTopazEnhanceWithOwnedCandidate");
    await assert.rejects(Reflect.apply(start as (...args: unknown[]) => Promise<unknown>, client, [{ ...input.operation, chat }]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
    await assert.rejects(Reflect.apply(start as (...args: unknown[]) => Promise<unknown>, client, [{ ...input.operation, chat }]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CHAT_CONTEXT_INVALID");
    assert.equal(generationCalls, 1);
    mediaNow += 16 * 60_000;
    const list = Reflect.get(client, "listOwnedTopazEnhanceCandidates");
    const candidates = await Reflect.apply(list as (...args: unknown[]) => Promise<unknown>, client, [chat]) as Record<string, unknown>;
    assert.equal(candidates.status, "INCOMPLETE");
    assert.equal(candidates.owner_ack_status, "MISSING");
    assert.equal(candidates.owner_echo_message_id, null);
    assert.deepEqual(candidates.contexts, []);
    assert.equal(candidates.backend_acceptance, "UNPROVEN");
    assert.deepEqual({ createCalls, generationCalls, historyCalls }, { createCalls: 1, generationCalls: 1, historyCalls: 1 });
  } finally { await input.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("Topaz Enhance refuses dispatch when the native owner client changes after chat creation", async () => {
  const fixture = await ffprobeFixture();
  let mediaNow = 1_000, generationCalls = 0, replacementCalls = 0;
  const links = await linkedOwner(() => 1_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files")) return response({ files: [{ filename: "source.mp4", url: UPLOAD_URL,
      status: "success", size: MP4.byteLength, content_type: "video/mp4", duration: 3 }] });
    if (url.pathname.endsWith("/chats")) return response({ uuid: CHAT });
    if (url.pathname.endsWith("/video/generate")) { generationCalls += 1; return response({ id: ACK }); }
    throw new Error(`unexpected synthetic route ${url.pathname}`);
  } });
  const replacement = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    replacementCalls += 1;
    return response({});
  } });
  let currentClient: unknown = client;
  const input = await ownedInputs({ client, links, ffprobePath: fixture.binary, now: () => mediaNow, blur: 2,
    resolveClient: () => currentClient });
  try {
    const create = Reflect.get(client, "createOwnerTopazEnhanceChat");
    const chat = await Reflect.apply(create as (...args: unknown[]) => Promise<unknown>, client, [input.operation]);
    currentClient = replacement;
    const start = Reflect.get(client, "startTopazEnhanceWithOwnedCandidate");
    await assert.rejects(Reflect.apply(start as (...args: unknown[]) => Promise<unknown>, client, [{ ...input.operation, chat }]),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CANDIDATE_INVALID");
    assert.equal(generationCalls, 0);
    assert.equal(replacementCalls, 0);
  } finally { await input.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});
